import os
from pathlib import Path
from unittest import TestCase, skipUnless
from unittest.mock import MagicMock

from PIL import Image

from app.services.student_card_matching import (
    FieldOCR, OCRLine, OCRResult, OCRToken, compare_fields, field_regions, normalize_name, parse_fields,
)
from scripts.student_card_ocr_worker import original_coordinates, recognize_global


class CardLayoutTests(TestCase):
    def layout(self):
        return [OCRLine('THẺ SINH VIÊN', .96, (340, 130, 780, 180)),
                OCRLine('TRẦN MINH AN', .96, (340, 220, 740, 260)),
                OCRLine('NGÀV SINH: 15/04/2004', .95, (340, 292, 770, 320)),
                OCRLine('Mã SV: 008IT123', .98, (40, 520, 250, 550))]

    def test_unlabelled_name_requires_card_layout_and_uses_original_roi(self):
        raw = self.layout()
        region = next(r for r in field_regions(raw) if r['field'] == 'full_name')
        self.assertEqual(region['source'], 'card_name_layout')
        self.assertEqual(region['bbox'], raw[1].bbox)
        read = FieldOCR('full_name', 0, 1, 'TRẦN MINH AN', .99, raw[1].bbox,
                        'vie', 7, 'name-gray-2x')
        fields, scores = parse_fields(OCRResult(raw, [read]))
        self.assertEqual(fields['full_name'], 'TRẦN MINH AN')
        self.assertEqual(scores['full_name'], .99)
        self.assertTrue(compare_fields(fields, scores, 'TRẦN MINH AN', '008IT123')['can_confirm'])

    def test_missing_title_id_geometry_or_following_field_never_infers_name(self):
        raw = self.layout()
        for lines in (raw[1:], raw[:-1], [raw[0], raw[1], raw[3]],
                      [OCRLine(line.text, line.confidence) for line in raw],
                      [OCRLine(raw[0].text, .1, raw[0].bbox), *raw[1:]]):
            with self.subTest(lines=lines):
                self.assertIsNone(parse_fields(lines)[0]['full_name'])

    def test_organisation_text_is_not_a_person_name(self):
        for text in ('TRƯỜNG ĐẠI HỌC TÀI CHÍNH', 'CHƯƠNG TRÌNH ĐÀO TẠO', 'UNIVERSITY OF FINANCE'):
            raw = self.layout()
            raw[1] = OCRLine(text, .99, raw[1].bbox)
            self.assertIsNone(parse_fields(raw)[0]['full_name'])

    def test_two_unlabelled_names_are_ambiguous_even_when_profile_matches_one(self):
        raw = self.layout()
        raw[1] = OCRLine('TRẦN MINH AN', .96, (350, 220, 520, 260))
        raw.insert(2, OCRLine('PHẠM MINH AN', .99, (550, 220, 740, 260)))
        fields, scores = parse_fields(raw)
        self.assertIsNone(fields['full_name'])
        self.assertFalse(compare_fields(fields, scores, 'TRẦN MINH AN', '008IT123')['can_confirm'])

    def test_explicit_name_label_prevents_layout_override(self):
        raw = self.layout() + [OCRLine('Họ tên: 123456', .99, (300, 350, 600, 380))]
        self.assertIsNone(parse_fields(raw)[0]['full_name'])

    def test_fuzzy_labels_do_not_repair_name_or_id_values(self):
        fields, scores = parse_fields([OCRLine('Họ vờ tên: PHẠM MINH AN', .99),
                                       OCRLine('Mõ SV: OO3IT009', .99)])
        self.assertEqual(fields['full_name'], 'PHẠM MINH AN')
        self.assertEqual(fields['student_code'], 'OO3IT009')
        self.assertIn('STUDENT_CODE_MISMATCH', compare_fields(fields, scores, 'PHẠM MINH AN', '003IT009')['blocking_errors'])

    def test_separate_colon_uses_only_id_word_confidence_and_not_bank_number(self):
        raw = [OCRLine('Mõ SV', .8, (250, 306, 316, 323)),
               OCRLine(': 003D0012345678', .6, (368, 306, 548, 323), (
                   OCRToken(':', .1, (368, 306, 372, 323)),
                   OCRToken('003D0012345678', .98, (381, 306, 548, 323)))),
               OCRLine('9704 1517 2048 8940', .99, (231, 437, 520, 460))]
        fields, scores = parse_fields(raw)
        self.assertEqual(fields['student_code'], '003D0012345678')
        self.assertEqual(scores['student_code'], .98)
        self.assertEqual(field_regions(raw)[0]['bbox'], (381, 306, 548, 323))

    def test_upscale_boxes_include_words_symbols_and_stay_in_original_coordinates(self):
        rows = [{'text': 'A', 'bbox': (11, 13, 19, 25), 'tokens': [
            {'text': 'A', 'bbox': (11, 13, 19, 25), 'symbols': [{'text': 'A', 'bbox': (11, 13, 19, 25)}]}]}]
        result = original_coordinates(rows, 2, 100, 100)
        self.assertEqual(result[0]['bbox'], (5, 6, 10, 13))
        self.assertEqual(result[0]['tokens'][0]['symbols'][0]['bbox'], (5, 6, 10, 13))

    def test_global_retry_selects_one_complete_pass_with_scaled_coordinates(self):
        engine = MagicMock()
        read = MagicMock(side_effect=[[], [
            {'text': 'Họ tên: TRẦN MINH AN', 'confidence': .99, 'bbox': (20, 20, 380, 70), 'tokens': []},
            {'text': 'Mã SV: 008IT123', 'confidence': .99, 'bbox': (20, 80, 380, 120), 'tokens': []}]])
        events = []
        rows = recognize_global(Image.new('RGB', (200, 100), 'white'), engine, read, events)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['bbox'], (10, 10, 190, 35))
        self.assertEqual(events[-1]['status'], 'selected')
        self.assertEqual(events[-1]['scale'], 2)

    def test_retry_failure_keeps_original_reading(self):
        engine = MagicMock()
        engine.Recognize.side_effect = [None, RuntimeError('optional retry')]
        raw = [{'text': 'Mã SV: 008IT123', 'confidence': .99, 'bbox': (10, 10, 180, 30), 'tokens': []}]
        read = MagicMock(return_value=raw)
        events = []
        self.assertEqual(recognize_global(Image.new('RGB', (200, 100)), engine, read, events), raw)
        self.assertEqual(events[-1]['status'], 'failed_original_retained')


@skipUnless(os.environ.get('STUDENT_CARD_NEW_FIXTURE_DIR'), 'Explicit private real-card fixtures only')
class NewRealCardOCRTests(TestCase):
    def test_uploaded_cards_have_real_name_and_exact_id_without_profile_hints(self):
        from app.services.student_card_ocr import LocalOCR
        folder = Path(os.environ['STUDENT_CARD_NEW_FIXTURE_DIR'])
        adapter = LocalOCR()
        self.addCleanup(adapter.close)
        adapter.start()
        for file, expected_name, expected_code in (
            ('34ed94b2-965b-4ae7-89c6-ac85ad9057aa.jpg', 'NGUYỄN PHƯƠNG THÚY', '177D3403010099'),
            ('e40ccf2a-2d12-4f16-9c18-5eab8a5860f0.jpg', 'HOÀNG MINH NGỌC', '11247707'),
            ('0fbcdae6-fdaa-45f9-8a2f-c2ff49f65a9f.jpg', 'NGUYỄN NGÔ THIÊN ĐỨC', '121230063'),
        ):
            with self.subTest(file=file):
                # These expectations are only assertions after recognition.
                # Production OCR never receives profile names or desired IDs.
                result = adapter.recognize((folder / file).read_bytes())
                fields, scores = parse_fields(result)
                self.assertEqual(normalize_name(fields['full_name']), normalize_name(expected_name))
                self.assertEqual(fields['student_code'], expected_code)
                self.assertGreaterEqual(scores['full_name'], .90)
                self.assertGreaterEqual(scores['student_code'], .90)
                validation = compare_fields(fields, scores, expected_name, expected_code)
                self.assertTrue(validation['can_confirm'])
                self.assertNotIn('NAME_UNREADABLE', validation['blocking_errors'])
                self.assertNotIn('STUDENT_CODE_UNREADABLE', validation['blocking_errors'])
                self.assertFalse(compare_fields(fields, scores, expected_name, expected_code + '0')['can_confirm'])
