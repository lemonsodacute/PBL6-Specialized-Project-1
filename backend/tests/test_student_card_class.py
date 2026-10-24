import os
from io import BytesIO
from unittest import TestCase, skipUnless
from unittest.mock import MagicMock, patch

from PIL import Image

from app.services.student_card_class import class_rejection
from app.services.student_card_field_ocr import CLASS_CODE_CHARSET, recognize_fields, recover_class_labels
from app.services.student_card_matching import FieldOCR, OCRLine, OCRResult, OCRToken, compare_fields, field_regions, parse_fields
from app.services.student_card_ocr import log_name_debug


class ClassExtractionTests(TestCase):
    def test_labels_whitespace_case_accents_and_bounded_ocr_confusions(self):
        for label in ('Lớp', 'LỚP', 'Lop', 'Class', 'Lớp học', 'Lớp HC', '  Lớp   học  ',
                      'Lớp/Class', 'Lép', 'L0p', 'Lớp/Closs'):
            for value in ('22T1', '22TCLC', 'K22-CNTT1', '22T1.1', 'K22/CNTT', '23T_NHAT2', 'Kế toán'):
                with self.subTest(label=label, value=value):
                    fields, _ = parse_fields([OCRLine(f'{label}: {value}', .97)])
                    self.assertEqual(fields['class_name'], value)

    def test_class_and_major_on_one_ocr_line_are_separate_fields(self):
        for text in ('Ngành: Công nghệ thông tin Lớp: 22T1', 'Lớp: 22T1 Ngành: Công nghệ thông tin'):
            fields, _ = parse_fields([OCRLine(text, .97)])
            self.assertEqual(fields['class_name'], '22T1')
            self.assertEqual(fields['major'], 'Công nghệ thông tin')

    def test_spatial_right_precedes_below_and_ignores_emission_order(self):
        lines = [OCRLine('Lớp', .7, (10, 100, 50, 120)), OCRLine('22T1', .92, (100, 100, 180, 120)),
                 OCRLine('22T2', .99, (10, 135, 90, 155))]
        for ordered in (lines, list(reversed(lines))):
            self.assertEqual(parse_fields(ordered)[0]['class_name'], '22T1')
        self.assertEqual(parse_fields(lines[:1] + lines[2:])[0]['class_name'], '22T2')

    def test_near_equal_candidates_are_unreadable_instead_of_first_wins(self):
        lines = [OCRLine('Class', .9, (10, 100, 50, 120)),
                 OCRLine('22T1', .95, (100, 100, 170, 120)), OCRLine('22T2', .96, (101, 100, 171, 120))]
        self.assertIsNone(parse_fields(lines)[0]['class_name'])
        self.assertEqual([region for region in field_regions(lines) if region['field'] == 'class_name'], [])

    def test_other_labels_own_major_and_student_number_candidates(self):
        lines = [OCRLine('Lớp', .9, (10, 100, 50, 120)),
                 OCRLine('Ngành', .9, (10, 140, 60, 160)), OCRLine('Công nghệ thông tin', .99, (100, 140, 290, 160)),
                 OCRLine('MSSV', .9, (10, 180, 60, 200)), OCRLine('102230057', .99, (100, 180, 220, 200))]
        fields, _ = parse_fields(lines)
        self.assertIsNone(fields['class_name'])
        self.assertEqual(fields['major'], 'Công nghệ thông tin')
        for value in ('Công nghệ thông tin', '102230057', 'Nguyễn Văn An'):
            self.assertIsNone(parse_fields([OCRLine('Ngành: Công nghệ thông tin', .99),
                OCRLine('Họ tên: Nguyễn Văn An', .99), OCRLine('MSSV: 102230057', .99),
                OCRLine('Lớp: ' + value, .99)])[0]['class_name'])

    def test_mixed_faculty_row_uses_word_and_symbol_geometry_for_value_only_roi(self):
        code = ':59CPKTI'
        symbols = tuple(OCRToken(char, .99, (458+i*20, 472, 478+i*20, 493)) for i, char in enumerate(code))
        lines = [OCRLine('Lép', .88, (318, 472, 370, 500)),
                 OCRLine(code + ' Khoa: Kinh tế', .6, (458, 425, 870, 519), (
                     OCRToken(code, .53, (458, 472, 618, 493), symbols),
                     OCRToken('Khoa:', .97, (673, 472, 753, 493)),
                     OCRToken('Kinh', .97, (768, 472, 833, 493)), OCRToken('tế', .96, (846, 466, 870, 493))))]
        region = next(region for region in field_regions(lines) if region['field'] == 'class_name')
        self.assertEqual(region['bbox'], (478, 472, 618, 493))
        self.assertFalse(region['block'])
        read = FieldOCR('class_name', 0, 1, '59CĐKT1', .97, region['bbox'], 'vie+eng', 7, 'gray-contrast-sharpen-3x')
        fields, _ = parse_fields(OCRResult(lines, [read]))
        self.assertEqual(fields['class_name'], '59CĐKT1')
        self.assertEqual(lines[1].text, code + ' Khoa: Kinh tế')

    def test_roi_from_another_location_cannot_replace_the_class(self):
        lines = [OCRLine('Lớp', .9, (10, 100, 50, 120)), OCRLine('22T1', .93, (100, 100, 170, 120))]
        read = FieldOCR('class_name', 0, 1, 'CNTT', .99, (100, 150, 170, 170), 'vie+eng', 7, 'gray-contrast-sharpen-2x')
        self.assertEqual(parse_fields(OCRResult(lines, [read]))[0]['class_name'], '22T1')

    def test_value_missing_from_global_ocr_gets_bounded_same_row_retry(self):
        lines = [OCRLine('Lớp', .9, (10, 100, 50, 120)), OCRLine('Khoa:', .9, (200, 100, 260, 120))]
        region = next(region for region in field_regions(lines) if region['field'] == 'class_name')
        self.assertEqual(region['bbox'], (52, 96, 197, 120))
        read = FieldOCR('class_name', 0, 0, '22T1', .94, region['bbox'], 'vie+eng', 7, 'gray-contrast-sharpen-2x')
        self.assertEqual(parse_fields(OCRResult(lines, [read]))[0]['class_name'], '22T1')

    def test_possible_truncated_named_class_stays_unreadable_when_passes_disagree(self):
        lines = [OCRLine('Lớp', .9, (10, 100, 50, 120)), OCRLine('ĐẦU TƯ (CLC)', .94, (100, 100, 230, 120))]
        region = next(region for region in field_regions(lines) if region['field'] == 'class_name')
        read = FieldOCR('class_name', 0, 1, 'ĐẦU TƯ (CLC) B', .91, region['bbox'], 'vie+eng', 7, 'gray-contrast-sharpen-2x')
        self.assertIsNone(parse_fields(OCRResult(lines, [read]))[0]['class_name'])

    def test_named_class_roi_margin_stops_before_another_field_label(self):
        lines = [OCRLine('Lớp', .9, (10, 100, 50, 120)), OCRLine('Kế toán', .94, (100, 100, 160, 120)),
                 OCRLine('Khoa:', .9, (180, 100, 230, 120))]
        region = next(region for region in field_regions(lines) if region['field'] == 'class_name')
        self.assertEqual(region['bbox'], (100, 100, 177, 120))

    def test_validation_is_light_and_class_never_blocks_required_identity(self):
        for text in ('', 'x'*31, 'student@example.test', '102230057', '2026-10-13', 'Đây là một câu văn dài cần loại bỏ'):
            self.assertIsNotNone(class_rejection(text))
        for text in ('22TCLC', 'K22-CNTT1', '22T1.1', 'K22/CNTT', '23T_NHAT2', 'ĐẦU TƯ (CLC) B'):
            self.assertIsNone(class_rejection(text))
        fields, confidence = parse_fields([OCRLine('Họ tên: Nguyễn Văn An', .99), OCRLine('MSSV: 102230057', .99)])
        self.assertIsNone(fields['class_name'])
        self.assertTrue(compare_fields(fields, confidence, 'Nguyễn Văn An', '102230057')['can_confirm'])

    def test_class_roi_is_single_line_without_binary_threshold_or_numeric_only_whitelist(self):
        engines = {language: MagicMock() for language in ('vie', 'eng', 'vie+eng')}
        lines = [OCRLine('Lớp', .9, (10, 100, 50, 120)), OCRLine('K22-CNTT1/1.2', .7, (100, 100, 240, 120))]
        def rows(engine):
            return [{'text': 'K22-CNTT1/1.2', 'tokens': [{'text': 'K22-CNTT1/1.2', 'confidence': .98}]}]
        with patch('app.services.student_card_field_ocr._otsu', side_effect=AssertionError('Class must not use binary threshold')):
            reads = recognize_fields(Image.new('RGB', (300, 200), 'white'), lines, engines, rows)
        self.assertEqual(reads[0]['text'], 'K22-CNTT1/1.2')
        for engine in engines.values():
            self.assertTrue(all(call.args == (7,) for call in engine.SetPageSegMode.call_args_list))
            self.assertTrue(all(call.args == ('tessedit_char_whitelist', CLASS_CODE_CHARSET) for call in engine.SetVariable.call_args_list))

    def test_named_class_keeps_accents_and_disables_code_whitelist(self):
        engines = {language: MagicMock() for language in ('vie', 'eng', 'vie+eng')}
        lines = [OCRLine('Lớp', .9, (10, 100, 50, 120)), OCRLine('Kế toán', .7, (100, 100, 240, 120))]
        rows = lambda engine: [{'text': 'Kế toán', 'tokens': [{'text': 'Kế toán', 'confidence': .98}]}]
        result = recognize_fields(Image.new('RGB', (300, 200), 'white'), lines, engines, rows)
        self.assertEqual(result[0]['text'], 'Kế toán')
        for engine in engines.values():
            self.assertTrue(all(call.args == ('tessedit_char_whitelist', '') for call in engine.SetVariable.call_args_list))

    def test_label_recovery_requires_an_actual_class_label_and_restores_geometry(self):
        lines = [OCRLine('23KT2', .9, (240, 284, 297, 298))]
        engine = MagicMock()
        row = {'text': 'Lớp/Closs:', 'confidence': .92, 'bbox': (12, 14, 310, 40),
               'tokens': [{'text': 'Lớp/Closs:', 'confidence': .92, 'bbox': (12, 14, 310, 40), 'symbols': []}]}
        result = recover_class_labels(Image.new('RGB', (720, 450), 'white'), lines, engine, lambda _: [row])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['bbox'], (73, 282, 222, 295))
        self.assertEqual(result[0]['tokens'][0]['bbox'], result[0]['bbox'])
        self.assertEqual(recover_class_labels(Image.new('RGB', (720, 450), 'white'), lines, engine,
            lambda _: [{'text': 'Ngành:', 'confidence': .99, 'bbox': (10, 10, 40, 30), 'tokens': []}]), [])

    def test_production_logs_never_contain_class_or_card_data(self):
        with patch('app.services.student_card_ocr.settings.ENVIRONMENT', 'production'), patch('app.services.student_card_ocr.logger') as logger:
            log_name_debug(OCRResult([OCRLine('Lớp: PRIVATE-CLASS', .99)]))
        logger.info.assert_not_called()


@skipUnless(os.environ.get('RUN_LOCAL_OCR_SMOKE') == '1', 'Explicit offline OCR smoke only')
class RealClassEngineTests(TestCase):
    def test_actual_worker_reads_class_codes_and_keeps_major_and_identity_separate(self):
        from PIL import ImageDraw, ImageFont
        from app.services.student_card_ocr import LocalOCR
        adapter = LocalOCR()
        self.addCleanup(adapter.close)
        adapter.start()
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 38)
        for label, value in (('Lớp', '22T1'), ('Lớp HC', 'K22-CNTT1'), ('Class', '22T1.1'), ('Lớp học', '22TCLC')):
            with self.subTest(label=label, value=value):
                image = Image.new('RGB', (1200, 650), 'white')
                draw = ImageDraw.Draw(image)
                for top, text in ((80, 'Họ tên: Nguyễn Văn Thiện'), (200, 'MSSV: 102230057'),
                                  (320, 'Ngành: Công nghệ thông tin'), (440, label+': '+value)):
                    draw.text((50, top), text, font=font, fill='black')
                content = BytesIO()
                image.save(content, format='PNG')
                result = adapter.recognize(content.getvalue())
                fields, confidence = parse_fields(result)
                self.assertEqual(fields['class_name'], value)
                self.assertEqual(fields['major'], 'Công nghệ thông tin')
                self.assertEqual(fields['student_code'], '102230057')
                self.assertTrue(compare_fields(fields, confidence, 'Nguyễn Văn Thiện', '102230057')['can_confirm'])
