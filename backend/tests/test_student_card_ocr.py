from io import BytesIO
import os
from pathlib import Path
from unittest import TestCase, skipUnless
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

from app.services.student_card_ocr import BACKEND, LocalOCR, OCRError


class OCRAdapterTests(TestCase):
    def test_name_variants_survive_adapter_and_preserve_vietnamese_unicode(self):
        import unicodedata
        from app.services.student_card_field_ocr import NAME_PREPROCESSING
        from app.services.student_card_matching import parse_fields
        for preprocessing in NAME_PREPROCESSING:
            with self.subTest(preprocessing=preprocessing):
                result = self.response_lines([
                    {'text': 'Họ tên', 'confidence': .7, 'bbox': [0, 100, 80, 120]},
                    {'text': 'ĐÔNG THỊ THUY LINH', 'confidence': .9, 'bbox': [100, 100, 350, 120]},
                ], [{'field': 'full_name', 'label_line': 0, 'candidate_line': 1,
                     'text': unicodedata.normalize('NFD', 'ĐỒNG THỊ THÙY LINH'),
                     'confidence': .98, 'bbox': [100, 100, 350, 120],
                     'language': 'vie', 'psm': 7, 'preprocessing': preprocessing}])
                self.assertEqual(len(result.field_ocr), 1)
                self.assertEqual(parse_fields(result)[0]['full_name'], 'ĐỒNG THỊ THÙY LINH')

    def response_lines(self, rows, fields=None):
        adapter = LocalOCR()
        adapter.ready = True
        adapter.process = MagicMock()
        adapter.process.poll.return_value = None
        with patch('app.services.student_card_ocr.uuid4', return_value=SimpleNamespace(hex='test')):
            with patch.object(adapter, '_receive', return_value={'id': 'test', 'lines': rows, 'field_ocr': fields or []}):
                return adapter.recognize(b'image')

    def test_field_observations_remain_separate_and_feed_final_parser(self):
        from app.services.student_card_matching import parse_fields
        result = self.response_lines([
            {'text': 'MS', 'confidence': .71, 'bbox': [100, 100, 130, 120]},
            {'text': '0603 1034', 'confidence': .7, 'bbox': [90, 135, 230, 155]},
        ], [{'field': 'student_code', 'label_line': 0, 'candidate_line': 1,
             'text': '06031034', 'confidence': .98, 'bbox': [90, 135, 230, 155],
             'language': 'eng', 'psm': 7, 'preprocessing': 'gray-contrast-sharpen-2x'}])
        self.assertEqual(result.raw_global_ocr[1].text, '0603 1034')
        self.assertEqual(result.field_ocr[0].text, '06031034')
        self.assertEqual(parse_fields(result)[0]['student_code'], '06031034')

    def test_invalid_optional_field_metadata_retains_usable_global_ocr(self):
        raw = [{'text': 'MS', 'confidence': .71, 'bbox': [100, 100, 130, 120]}]
        valid = {'field': 'student_code', 'label_line': 0, 'candidate_line': 0,
                 'text': '06031034', 'confidence': .98, 'bbox': [90, 135, 230, 155],
                 'language': 'eng', 'psm': 7, 'preprocessing': 'gray-contrast-sharpen-2x'}
        for changes in ({'field': 'profile'}, {'label_line': -1}, {'candidate_line': 2},
                        {'label_line': True}, {'language': 'xyz'}, {'psm': True},
                        {'psm': 11}, {'bbox': None}, {'preprocessing': 'unknown'},
                        {'confidence': float('nan')}):
            with self.subTest(changes=changes):
                result = self.response_lines(raw, [valid | changes])
                self.assertEqual(result[0].text, 'MS')
                self.assertEqual(result.field_ocr, ())

    def test_invalid_code_charset_is_rejected_before_worker_spawn(self):
        with self.assertRaises(ValueError):
            LocalOCR(code_charset='guess')

    def test_bad_symbol_box_does_not_erase_readable_name_and_class(self):
        rows = [{'text': 'Họ tên: LE NGUYEN CHAU ANH', 'confidence': .98,
                 'tokens': [{'text': 'LE', 'confidence': .98, 'symbols': [
                     {'text': 'L', 'confidence': .99, 'bbox': [10, 10, 10, 20]},
                     {'text': ' ', 'confidence': .99, 'bbox': [10, 10, 15, 20]}]}]},
                {'text': 'Lớp: 23T_NHAT2', 'confidence': .97}]
        # Production symbol geometry is optional and may be empty/degenerate.
        from app.services.student_card_matching import parse_fields, compare_fields
        result = self.response_lines(rows)
        fields, confidence = parse_fields(result)
        self.assertEqual(fields['full_name'], 'LE NGUYEN CHAU ANH')
        self.assertEqual(fields['class_name'], '23T_NHAT2')
        self.assertIsNone(fields['student_code'])
        self.assertEqual(compare_fields(fields, confidence, 'LE NGUYEN CHAU ANH', '102230057')['blocking_errors'],
                         ['STUDENT_CODE_UNREADABLE'])

    def test_empty_global_output_is_engine_failure(self):
        with self.assertRaises(OCRError) as raised:
            self.response_lines([])
        self.assertEqual(raised.exception.code, 'OCR_FAILED')

    def test_keeps_word_confidence_and_geometry_for_parser(self):
        from app.services.student_card_matching import parse_fields
        lines = self.response_lines([{'text': 'MS: 06031034', 'confidence': .7,
            'bbox': [100, 100, 280, 120], 'tokens': [
                {'text': 'MS:', 'confidence': .45, 'bbox': [100, 100, 130, 120]},
                {'text': '06031034', 'confidence': .98, 'bbox': [140, 100, 280, 120]}]}])
        self.assertEqual(lines[0].bbox, (100, 100, 280, 120))
        self.assertEqual(lines[0].tokens[0].confidence, .45)
        fields, confidence = parse_fields(lines)
        self.assertEqual(fields['student_code'], '06031034')
        self.assertEqual(confidence['student_code'], .98)

    def test_legacy_lines_without_geometry_remain_usable(self):
        lines = self.response_lines([{'text': 'MS', 'confidence': .98}])
        self.assertIsNone(lines[0].bbox)
        self.assertEqual(lines[0].tokens, ())

    def test_malformed_geometry_tokens_and_confidence_fail_closed(self):
        valid = {'text': 'MS', 'confidence': .98, 'bbox': [100, 100, 130, 120]}
        for changes in ({'bbox': [0, 0, 0, 0]}, {'bbox': [-1, 0, 30, 20]},
                        {'bbox': [0, 0, 30]}, {'bbox': [0, 0, True, 20]},
                        {'bbox': [0, 0, float('nan'), 20]}, {'confidence': float('nan')},
                        {'confidence': True}, {'tokens': {}}, {'tokens': [None]},
                        {'tokens': [{'text': '06031034', 'confidence': 1.1}]}):
            with self.subTest(changes=changes), self.assertRaises(OCRError):
                self.response_lines([valid | changes])

    def test_unready_request_never_starts_a_worker_or_download(self):
        adapter = LocalOCR()
        with patch('subprocess.Popen') as popen, self.assertRaises(OCRError):
            adapter.recognize(b'image')
        popen.assert_not_called()

    def test_missing_model_fails_without_spawn(self):
        adapter = LocalOCR()
        with patch.object(Path, 'is_file', return_value=False), patch('subprocess.Popen') as popen, self.assertRaises(OCRError):
            adapter.start()
        popen.assert_not_called()

    def test_invalid_worker_result_fails_closed(self):
        adapter = LocalOCR()
        adapter.ready = True
        adapter.process = MagicMock()
        adapter.process.poll.return_value = None
        with patch.object(adapter, '_receive', return_value={'id': 'wrong'}), self.assertRaises(OCRError):
            adapter.recognize(b'image')
        self.assertFalse(adapter.ready)


@skipUnless(os.environ.get('RUN_LOCAL_OCR_SMOKE') == '1' and (BACKEND / 'models/ocr/tessdata/manifest.json').is_file(), 'Explicit offline local OCR smoke only')
class LocalOCRSmoke(TestCase):
    @skipUnless(os.environ.get('BACH_KHOA_CARD_FIXTURE'), 'Explicit real Bach Khoa fixture only')
    def test_real_bach_khoa_regression_through_production_worker(self):
        from app.services.student_card_matching import parse_fields, compare_fields
        adapter = LocalOCR()
        self.addCleanup(adapter.close)
        adapter.start()
        result = adapter.recognize(Path(os.environ['BACH_KHOA_CARD_FIXTURE']).read_bytes())
        fields, confidence = parse_fields(result)
        self.assertEqual(fields['full_name'], 'LE NGUYEN CHAU ANH')
        self.assertEqual(fields['class_name'], '23T_NHAT2')
        self.assertEqual(fields['student_code'], '102230057')
        self.assertGreaterEqual(confidence['student_code'], .90)
        self.assertTrue(compare_fields(fields, confidence, 'LE NGUYEN CHAU ANH', '102230057')['can_confirm'])

    def test_bach_khoa_lower_right_layout_through_production_worker(self):
        from PIL import Image, ImageDraw, ImageFont
        from app.services.student_card_matching import parse_fields
        adapter = LocalOCR()
        self.addCleanup(adapter.close)
        adapter.start()
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 32)
        label_font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 22)
        image = Image.new('RGB', (1200, 750), 'white')
        draw = ImageDraw.Draw(image)
        draw.text((200, 220), 'Họ tên: LE NGUYEN CHAU ANH', font=font, fill='black')
        draw.text((200, 300), 'Lớp: 23T_NHAT2', font=font, fill='black')
        draw.text((770, 580), 'Số thẻ SV/Student ID:', font=label_font, fill='black')
        draw.text((770, 625), '102230057', font=font, fill='black')
        data = BytesIO()
        image.save(data, format='PNG')
        result = adapter.recognize(data.getvalue())
        fields, _ = parse_fields(result)
        self.assertEqual(fields['full_name'], 'LE NGUYEN CHAU ANH')
        self.assertEqual(fields['class_name'], '23T_NHAT2')
        self.assertEqual(fields['student_code'], '102230057')
        self.assertTrue(any(read.field == 'student_code' and read.text == '102230057' for read in result.field_ocr))

    def test_requested_layouts_and_vietnamese_fields_use_production_roi_worker(self):
        from PIL import Image, ImageDraw, ImageFont
        from app.services.student_card_matching import parse_fields
        adapter = LocalOCR()
        self.addCleanup(adapter.close)
        adapter.start()
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 38)
        for label, code, multiline in (
            ('Số thẻ SV/Student ID:', '102230057', True),
            ('Mã SV:', '11247707', False),
            ('MS', '06031034', True),
            ('MSSV:', '001IT123', False),
        ):
            with self.subTest(label=label):
                image = Image.new('RGB', (1200, 600), 'white')
                draw = ImageDraw.Draw(image)
                draw.text((50, 50), label if multiline else label + code, font=font, fill='black')
                if multiline:
                    draw.text((50, 110), code, font=font, fill='black')
                draw.text((50, 230), 'Họ tên: Nguyễn Văn Thiện', font=font, fill='black')
                draw.text((50, 320), 'Ngành học: Kế toán doanh nghiệp', font=font, fill='black')
                draw.text((50, 410), 'Lớp: Kế toán', font=font, fill='black')
                data = BytesIO()
                image.save(data, format='PNG')
                result = adapter.recognize(data.getvalue())
                fields, _ = parse_fields(result)
                self.assertEqual(fields['student_code'], code)
                self.assertEqual(fields['major'], 'Kế toán doanh nghiệp')
                self.assertEqual(fields['class_name'], 'Kế toán')
                self.assertTrue(any(read.field == 'student_code' and read.text == code for read in result.field_ocr))
                self.assertTrue(any(read.field == 'major' and read.language == 'vie' for read in result.field_ocr))

    def test_provisioned_offline_model_reads_synthetic_card_text(self):
        from PIL import Image, ImageDraw, ImageFont
        from app.services.student_card_matching import parse_fields, compare_fields
        image = Image.new('RGB', (1200, 600), 'white')
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 48)
        draw = ImageDraw.Draw(image)
        draw.text((50, 100), 'Họ và tên: Nguyễn Văn Thiện', font=font, fill='black')
        draw.text((50, 250), 'MSSV: 001IT123', font=font, fill='black')
        data = BytesIO()
        image.save(data, format='PNG')
        adapter = LocalOCR()
        self.addCleanup(adapter.close)
        adapter.start()
        process_id = adapter.process.pid
        lines = adapter.recognize(data.getvalue())
        fields, confidence = parse_fields(lines)
        self.assertTrue(compare_fields(fields, confidence, 'Nguyễn Văn Thiện', '001IT123')['can_confirm'])
        adapter.recognize(data.getvalue())
        self.assertEqual(adapter.process.pid, process_id)

    def test_production_worker_preserves_ms_token_confidence_and_boxes(self):
        from PIL import Image, ImageDraw, ImageFont
        from app.services.student_card_matching import parse_fields
        image = Image.new('RGB', (900, 450), 'white')
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 48)
        draw = ImageDraw.Draw(image)
        draw.text((170, 100), 'MS', font=font, fill='black')
        draw.text((100, 160), '06031034', font=font, fill='black')
        draw.text((400, 320), '2011-2014', font=font, fill='black')
        data = BytesIO()
        image.save(data, format='PNG')
        adapter = LocalOCR()
        self.addCleanup(adapter.close)
        adapter.start()
        lines = adapter.recognize(data.getvalue())
        fields, confidence = parse_fields(lines)
        self.assertEqual(fields['student_code'], '06031034')
        self.assertGreaterEqual(confidence['student_code'], .90)
        for text in ('MS', '06031034'):
            row = next(line for line in lines if line.text == text)
            self.assertIsNotNone(row.bbox)
            self.assertEqual(row.tokens[0].text, text)
            self.assertEqual(row.tokens[0].confidence, row.confidence)

    @skipUnless(os.environ.get('STUDENT_CARD_OCR_FIXTURE'), 'Local real card supplied explicitly only')
    def test_local_real_card_ms_code_through_production_worker(self):
        from app.services.student_card_matching import parse_fields
        adapter = LocalOCR()
        self.addCleanup(adapter.close)
        adapter.start()
        lines = adapter.recognize(Path(os.environ['STUDENT_CARD_OCR_FIXTURE']).read_bytes())
        fields, confidence = parse_fields(lines)
        self.assertEqual(fields['student_code'], '06031034')
        self.assertGreaterEqual(confidence['student_code'], .90)
        self.assertFalse(fields['major'].startswith(('học:', 'hoc:')))
        self.assertEqual(fields['major'], 'Kế toán doanh nghiệp')
        # The supplied source prints ĐÔNG; THÙY's detached tone mark must survive.
        self.assertEqual(fields['full_name'], 'ĐÔNG THỊ THÙY LINH')
        self.assertGreaterEqual(confidence['full_name'], .90)
        name_read = next(read for read in lines.field_ocr if read.field == 'full_name')
        self.assertEqual(name_read.language, 'vie')
        self.assertEqual(name_read.psm, 7)

