from unittest import TestCase
from unittest.mock import MagicMock, call, patch

from PIL import Image

from app.services.student_card_field_ocr import CODE_CHARSETS, NAME_PREPROCESSING, name_roi_variants, preprocess_roi, recognize_fields
from app.services.student_card_matching import (
    FieldOCR, OCRLine, OCRResult, OCRToken, compare_fields, field_regions, parse_fields,
)


class FieldOCRTests(TestCase):
    def test_lost_digits_get_bounded_roi_only_beside_student_label(self):
        raw = [OCRLine('dent ID', .71, (1831, 1033, 1956, 1076)),
               OCRLine('U22', .77, (1683, 1094, 1768, 1121))]
        region = field_regions(raw)[0]
        self.assertEqual(region['bbox'], (1573, 1076, 1977, 1140))
        read = FieldOCR('student_code', 0, 0, '102230057', .98, region['bbox'], 'eng', 7, 'gray-contrast-sharpen-3x')
        self.assertEqual(parse_fields(OCRResult(raw, [read]))[0]['student_code'], '102230057')
        for value in ('11247707', '10223O057', '9704150230145404'):
            invalid = FieldOCR('student_code', 0, 0, value, .99, region['bbox'], 'eng', 7, 'gray-contrast-sharpen-3x')
            self.assertIsNone(parse_fields(OCRResult(raw, [invalid]))[0]['student_code'])
        for unrelated in ('Barcode', 'DOB', 'Valid until'):
            self.assertEqual(field_regions([OCRLine('MS', .4, (100, 100, 140, 120)),
                                           OCRLine(unrelated, .99, (100, 125, 180, 145))]), [])

    def test_explicit_alphanumeric_candidate_keeps_letters_in_whitelist(self):
        _, engines, _ = self.recognize(lambda *_: ('001IT123', .98), lines=self.code_lines('001IT123'))
        self.assertEqual(engines['eng'].SetVariable.call_args.args,
                         ('tessedit_char_whitelist', CODE_CHARSETS['alphanumeric']))

    def code_lines(self, value='06031034', score=.8):
        return [OCRLine('MS', .71, (100, 100, 130, 120)),
                OCRLine(value, score, (90, 135, 230, 155))]

    def read(self, field='student_code', value='06031034', score=.98, label=0, target=1):
        return FieldOCR(field, label, target, value, score, (90, 135, 230, 155),
                        'eng' if field == 'student_code' else 'vie', 7, 'gray-contrast-sharpen-2x')

    def test_higher_confidence_roi_wins_without_overwriting_global(self):
        raw = self.code_lines('06031035')
        result = OCRResult(raw, [self.read()])
        fields, confidence = parse_fields(result)
        self.assertEqual(fields['student_code'], '06031034')
        self.assertEqual(confidence['student_code'], .98)
        self.assertEqual(result.raw_global_ocr, tuple(raw))
        self.assertEqual(result[1].text, '06031035')
        self.assertEqual(result.field_ocr[0].text, '06031034')

    def test_low_confidence_roi_cannot_replace_good_global_read(self):
        result = OCRResult(self.code_lines(score=.98), [self.read(value='87654321', score=.8)])
        fields, confidence = parse_fields(result)
        self.assertEqual(fields['student_code'], '06031034')
        self.assertEqual(confidence['student_code'], .98)

    def test_roi_recovers_spaced_global_value_without_string_repair(self):
        raw = self.code_lines('0603 1034')
        self.assertIsNone(parse_fields(raw)[0]['student_code'])
        self.assertEqual(field_regions(raw)[0]['candidate_line'], 1)
        self.assertEqual(parse_fields(OCRResult(raw, [self.read()]))[0]['student_code'], '06031034')

    def test_roi_cannot_override_ambiguous_geometry_or_conflicting_labels(self):
        raw = self.code_lines() + [OCRLine('87654321', .8, (90, 140, 230, 160))]
        self.assertEqual(field_regions(raw), [])
        self.assertIsNone(parse_fields(OCRResult(raw, [self.read()]))[0]['student_code'])
        raw = self.code_lines() + [OCRLine('MSSV: 87654321', .99)]
        self.assertIsNone(parse_fields(OCRResult(raw, [self.read()]))[0]['student_code'])

    def test_invalid_or_unrelated_roi_never_becomes_code(self):
        for read in (self.read(value='06031034 87654321'), self.read(value='09091990'),
                     self.read(value='20112014'), self.read(target=0)):
            self.assertEqual(parse_fields(OCRResult(self.code_lines(), [read]))[1]['student_code'], .8)

    def test_identity_confidence_gate_and_exact_mismatch_survive_field_ocr(self):
        raw = self.code_lines() + [OCRLine('Họ tên: Nguyễn Văn An', .99)]
        for score in (.8999, .98):
            fields, confidence = parse_fields(OCRResult(raw, [self.read(score=score)]))
            result = compare_fields(fields, confidence, 'Nguyễn Văn An', '102230057')
            self.assertEqual(fields['student_code'], '06031034')
            self.assertFalse(result['can_confirm'])
            self.assertEqual('STUDENT_CODE_MISMATCH' in result['blocking_errors'], score >= .90)
            self.assertEqual('STUDENT_CODE_UNREADABLE' in result['blocking_errors'], score < .90)

    def test_no_oi_conversion_in_roi_read(self):
        for value in ('O6031034', '0603I034'):
            self.assertEqual(parse_fields(OCRResult(self.code_lines(), [self.read(value=value)]))[0]['student_code'], value)

    def test_major_recognition_is_display_only_and_not_hardcoded(self):
        raw = [OCRLine('Ngành học: Ké toan doanh nghiép', .7)]
        read = self.read('major', 'Kế toán doanh nghiệp', .96, target=0)
        fields, confidence = parse_fields(OCRResult(raw, [read]))
        self.assertEqual(fields['major'], 'Kế toán doanh nghiệp')
        self.assertFalse(compare_fields(fields, confidence, 'Nguyễn Văn An', '06031034')['can_confirm'])
        self.assertEqual(parse_fields(raw)[0]['major'], 'Ké toan doanh nghiép')

    def test_text_value_confidence_ignores_weak_label(self):
        raw = [OCRLine('Họ tên: Nguyễn Văn An', .5, (0, 0, 300, 20), (
            OCRToken('Họ', .4, (0, 0, 20, 20)), OCRToken('tên:', .4, (25, 0, 50, 20)),
            OCRToken('Nguyễn', .98, (60, 0, 120, 20)), OCRToken('Văn', .98, (130, 0, 180, 20)),
            OCRToken('An', .98, (190, 0, 230, 20))))]
        self.assertEqual(parse_fields(raw)[1]['full_name'], .98)
        self.assertEqual(parse_fields([OCRLine('Họ tên', .5), OCRLine('Nguyễn Văn An', .98)])[1]['full_name'], .98)

    def test_mixed_token_uses_symbol_boxes_to_exclude_label(self):
        text = 'SV:11247707'
        symbols = tuple(OCRToken(char, .99, (40 + i * 10, 10, 50 + i * 10, 30))
                        for i, char in enumerate(text))
        line = OCRLine('Mã ' + text, .8, (0, 10, 150, 30), (
            OCRToken('Mã', .5, (0, 10, 30, 30)), OCRToken(text, .8, (40, 10, 150, 30), symbols)))
        self.assertEqual(field_regions([line])[0]['bbox'], (70, 10, 150, 30))
        self.assertEqual(parse_fields([line])[0]['student_code'], '11247707')

    def test_field_block_and_spatial_text_ignore_sparse_line_order(self):
        raw = [OCRLine('doanh nghiệp', .96, (100, 135, 230, 155)),
               OCRLine('Kế toán', .97, (100, 110, 200, 130)),
               OCRLine('Ngành học', .5, (0, 110, 90, 130)),
               OCRLine('Lớp: 21IT1', .98, (100, 160, 250, 180))]
        fields, confidence = parse_fields(raw)
        self.assertEqual(fields['major'], 'Kế toán doanh nghiệp')
        self.assertEqual(confidence['major'], .96)
        region = next(region for region in field_regions(raw) if region['field'] == 'major')
        self.assertEqual(region['bbox'], (100, 110, 230, 155))
        self.assertTrue(region['block'])

    def test_below_right_candidate_is_bounded(self):
        raw = [OCRLine('MS', .71, (100, 100, 130, 120)),
               OCRLine('06031034', .98, (150, 140, 280, 160))]
        self.assertEqual(parse_fields(raw)[0]['student_code'], '06031034')
        raw[1] = OCRLine('06031034', .98, (250, 140, 380, 160))
        self.assertIsNone(parse_fields(raw)[0]['student_code'])

    def test_crop_is_upscaled_gray_and_does_not_change_source(self):
        source = Image.new('RGB', (300, 200), (180, 200, 220))
        before = source.tobytes()
        for scale in (2, 3):
            crop = preprocess_roi(source, (90, 135, 230, 155), scale)
            self.assertEqual(crop.mode, 'L')
            self.assertEqual(crop.size, (144 * scale + 20, 24 * scale + 20))
        self.assertEqual(source.tobytes(), before)

    def test_name_crop_preserves_marks_above_value_box_and_uses_mild_threshold(self):
        from PIL import ImageDraw
        source = Image.new('RGB', (300, 200), (180, 200, 220))
        ImageDraw.Draw(source).rectangle((110, 126, 120, 130), fill='black')
        before = source.tobytes()
        variants = dict((tag, crop) for crop, tag in name_roi_variants(source, (90, 135, 230, 155)))
        self.assertEqual(set(variants), NAME_PREPROCESSING)
        for scale in (2, 3):
            original = variants[f'name-original-{scale}x']
            self.assertEqual(original.mode, 'RGB')
            self.assertEqual(original.size, (144 * scale + 20, 35 * scale + 20))
            # This detached accent lies above the global OCR bounding box.
            self.assertLess(max(original.getpixel((10 + 27 * scale, 10 + 3 * scale))), 10)
            threshold = variants[f'name-mild-threshold-{scale}x']
            self.assertEqual(threshold.mode, 'L')
            self.assertTrue(any(0 < level < 255 for _, level in threshold.getcolors()))
        self.assertEqual(source.tobytes(), before)

    def test_name_uses_vie_without_whitelist_and_selects_one_complete_best_pass(self):
        variants = [('ĐÔNG THỊ THUY LINH', .91), ('ĐỒNG THỊ THÙY LINH', .98),
                    ('ĐỒNG THỊ THỦY LINH', .92)]
        result, engines, calls = self.recognize(
            lambda _, call: variants[min(call - 1, 2)],
            lines=[OCRLine('Họ tên', .8, (0, 100, 80, 120)),
                   OCRLine('ĐÔNG THỊ THUY LINH', .91, (100, 100, 350, 120))])
        self.assertEqual(result[0]['text'], 'ĐỒNG THỊ THÙY LINH')
        self.assertEqual(result[0]['preprocessing'], 'name-gray-2x')
        self.assertEqual(calls, [('vie', 7)] * 10)
        self.assertEqual(engines['vie'].SetVariable.call_args_list,
                         [call('tessedit_char_whitelist', '')] * 10)
        self.assertEqual(engines['vie'].Clear.call_count, 10)
        engines['eng'].SetImage.assert_not_called()
        engines['vie+eng'].SetImage.assert_not_called()

    def test_name_variant_failure_does_not_skip_remaining_variants(self):
        def recognize(_, call):
            if call == 1:
                raise RuntimeError('Failed variant')
            return 'ĐỒNG THỊ THÙY LINH', .97
        result, engines, calls = self.recognize(recognize, lines=[
            OCRLine('Họ tên', .8, (0, 100, 80, 120)),
            OCRLine('ĐÔNG THỊ THUY LINH', .9, (100, 100, 350, 120))])
        self.assertEqual(result[0]['text'], 'ĐỒNG THỊ THÙY LINH')
        self.assertEqual(len(calls), 10)
        self.assertEqual(engines['vie'].Clear.call_count, 10)

    def test_unavailable_clahe_keeps_other_name_passes_usable(self):
        with patch.dict('sys.modules', {'cv2': None}):
            result, _, calls = self.recognize(lambda *_: ('ĐỒNG THỊ THÙY LINH', .97), lines=[
                OCRLine('Họ tên', .8, (0, 100, 80, 120)),
                OCRLine('ĐÔNG THỊ THUY LINH', .9, (100, 100, 350, 120))])
        self.assertEqual(result[0]['text'], 'ĐỒNG THỊ THÙY LINH')
        self.assertEqual(len(calls), 8)

    def recognize(self, rows_for_engine, *, lines=None, code_charset='alphanumeric'):
        engines = {language: MagicMock() for language in ('eng', 'vie', 'vie+eng')}
        languages = {id(engine): language for language, engine in engines.items()}
        calls = []
        def rows(engine):
            language = languages[id(engine)]
            psm = engine.SetPageSegMode.call_args.args[0]
            calls.append((language, psm))
            text, score = rows_for_engine(language, len(calls))
            return [{'text': text, 'tokens': [{'text': text, 'confidence': score}]}]
        result = recognize_fields(Image.new('RGB', (400, 250), 'white'),
                                  lines or self.code_lines(), engines, rows, code_charset=code_charset)
        return result, engines, calls

    def test_numeric_and_alphanumeric_whitelists_are_isolated(self):
        for charset in CODE_CHARSETS:
            result, engines, calls = self.recognize(lambda *_: ('06031034', .98), code_charset=charset)
            self.assertEqual(result[0]['text'], '06031034')
            self.assertTrue(all(language == 'eng' and psm == 7 for language, psm in calls))
            self.assertEqual(engines['eng'].SetVariable.call_args.args,
                             ('tessedit_char_whitelist', CODE_CHARSETS['numeric']))
            self.assertEqual(engines['eng'].Clear.call_count, len(calls))
            self.assertNotIn('otsu', result[0]['preprocessing'])

    def test_vie_wins_better_text_confidence_and_block_uses_psm6(self):
        raw = [OCRLine('Ngành học: Kế toán', .6, (0, 100, 250, 120), (
            OCRToken('Ngành', .5, (0, 100, 40, 120)), OCRToken('học:', .5, (45, 100, 80, 120)),
            OCRToken('Kế', .6, (100, 100, 120, 120)), OCRToken('toán', .6, (130, 100, 200, 120)))),
               OCRLine('doanh nghiệp', .6, (100, 125, 240, 145))]
        result, _, calls = self.recognize(lambda language, _: ('Kế toán doanh nghiệp', .98 if language == 'vie' else .8), lines=raw)
        self.assertEqual(result[0]['language'], 'vie')
        self.assertTrue(all(psm == 6 for _, psm in calls))

    def test_threshold_only_wins_when_confidence_improves(self):
        for threshold_score, expected in ((.8, 'gray-contrast-sharpen-2x'), (.98, 'otsu-3x')):
            result, _, _ = self.recognize(lambda _, call: ('06031034', .85 if call <= 2 else threshold_score))
            self.assertEqual(result[0]['preprocessing'], expected)

    def test_failed_field_pass_keeps_usable_global_result(self):
        def failure(*_):
            raise RuntimeError('Recognition failed')
        result, _, _ = self.recognize(failure)
        self.assertEqual(result, [])
