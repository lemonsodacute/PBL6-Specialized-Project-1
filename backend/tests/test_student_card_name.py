import unicodedata
from unittest import TestCase
from unittest.mock import MagicMock, patch

from PIL import Image

from app.services.student_card_field_ocr import recover_name_labels
from app.services.student_card_matching import (
    FieldOCR, OCRLine, OCRResult, OCRToken, best_name_read, compare_fields, field_regions, parse_fields,
)
from app.services.student_card_ocr import log_name_debug


class NameExtractionTests(TestCase):
    def test_bilingual_labels_unicode_spacing_and_missing_separator(self):
        for label in ('Họ tên', 'Họ và tên', 'Họ tên / Full name:', 'Họ và tên / Full name',
                      'Full name', 'Name', 'Họ tên/Full name:', 'HỌ TÊN / FULL NAME',
                      'Ho ten / Full name', 'Ho tên, Full nome:', 'Ho tên. Full nome:',
                      '  Họ   và tên /  Full   name : '):
            for text in (label, unicodedata.normalize('NFD', label)):
                with self.subTest(label=text):
                    fields, _ = parse_fields([OCRLine(text + ' ĐẶNG THỊ CÚC', .98)])
                    self.assertEqual(fields['full_name'], 'ĐẶNG THỊ CÚC')

    def test_spatial_name_right_precedes_below_and_does_not_consume_dob(self):
        label = OCRLine('Họ tên/Full name', .6, (70, 240, 225, 258))
        name = OCRLine('ĐẶNG THỊ CÚC', .97, (241, 239, 483, 255))
        unrelated = [OCRLine('27/03/2005', .99, (240, 264, 336, 278)),
                     OCRLine('23KT2', .99, (240, 284, 297, 298)),
                     OCRLine('121234567', .99, (240, 308, 350, 322)),
                     OCRLine('TRẦN VĂN BÌNH', .99, (70, 265, 220, 281))]
        for lines in ([*unrelated, name, label], [label, name, *unrelated]):
            self.assertEqual(parse_fields(lines)[0]['full_name'], name.text)
            self.assertEqual(next(r for r in field_regions(lines) if r['field'] == 'full_name')['bbox'], name.bbox)

    def test_below_label_is_used_when_no_right_name(self):
        fields, _ = parse_fields([OCRLine('Full name', .8, (70, 240, 225, 258)),
                                 OCRLine('ĐẶNG THỊ CÚC', .98, (70, 265, 230, 283))])
        self.assertEqual(fields['full_name'], 'ĐẶNG THỊ CÚC')

    def test_unlabelled_name_is_not_invented_as_profile_value(self):
        fields, scores = parse_fields([OCRLine('ĐẶNG THỊ CÚC', .99), OCRLine('MSSV: 001IT123', .99)])
        result = compare_fields(fields, scores, 'ĐẶNG THỊ CÚC', '001IT123')
        self.assertIsNone(fields['full_name'])
        self.assertEqual(result['blocking_errors'], ['NAME_UNREADABLE'])
        self.assertEqual(fields['student_code'], '001IT123')

    def test_accented_complete_pass_wins_over_confident_ascii_or_prefix(self):
        choices = [{'text': 'DANG THI CUC', 'confidence': .98},
                   {'text': 'ĐẶNG THỊ CÚC', 'confidence': .95},
                   {'text': 'ĐẶNG THỊ', 'confidence': .99}]
        for ordered in (choices, list(reversed(choices))):
            self.assertEqual(best_name_read(ordered)['text'], 'ĐẶNG THỊ CÚC')
        self.assertIsNone(best_name_read([{'text': '23KT2', 'confidence': .99}]))

    def test_roi_can_recover_name_when_global_has_no_usable_value(self):
        lines = [OCRLine('Họ tên / Full name', .8, (70, 240, 225, 258)),
                 OCRLine('MSSV: 001IT123', .99, (70, 330, 225, 350))]
        regions = [r for r in field_regions(lines) if r['field'] == 'full_name']
        self.assertEqual(len(regions), 2)
        for region in regions:
            with self.subTest(region=region):
                read = FieldOCR('full_name', 0, 0, 'ĐẶNG THỊ CÚC', .98, region['bbox'], 'vie', 7, 'name-gray-3x')
                fields, scores = parse_fields(OCRResult(lines, [read]))
                self.assertEqual(fields['full_name'], 'ĐẶNG THỊ CÚC')
                self.assertTrue(compare_fields(fields, scores, 'ĐẶNG THỊ CÚC', '001IT123')['can_confirm'])
        self.assertIsNone(parse_fields(OCRResult(lines, []))[0]['full_name'])

    def test_faint_label_recovery_translates_all_boxes_to_original(self):
        source = Image.new('RGB', (720, 454), 'white')
        anchor = OCRLine('ĐẶNG THỊ CÚC', .9, (241, 239, 483, 255))
        row = {'text': 'Ho tên, Full nome:', 'confidence': .88, 'bbox': (60, 30, 370, 66),
               'tokens': [{'text': 'Ho', 'confidence': .9, 'bbox': (60, 30, 80, 60),
                           'symbols': [{'text': 'H', 'confidence': .9, 'bbox': (60, 30, 70, 60)}]}]}
        engine = MagicMock()
        recovered = recover_name_labels(source, [anchor], engine, lambda _: [row])
        self.assertEqual(recovered[0]['bbox'], (74, 241, 229, 259))
        self.assertEqual(recovered[0]['tokens'][0]['bbox'], (74, 241, 84, 256))
        self.assertEqual(recovered[0]['tokens'][0]['symbols'][0]['bbox'], (74, 241, 79, 256))
        self.assertEqual(engine.SetVariable.call_args.args, ('tessedit_char_whitelist', ''))
        self.assertEqual(engine.SetPageSegMode.call_args.args, (7,))
        self.assertEqual(engine.Clear.call_count, 1)

    def test_missing_name_roi_never_crops_through_another_field(self):
        label = OCRLine('Họ tên', .8, (70, 240, 225, 258))
        for other in ('Ngày sinh', 'Lớp', 'Khoa / Faculty', 'MSSV'):
            with self.subTest(other=other):
                regions = field_regions([label, OCRLine(other, .99, (70, 265, 220, 283))])
                names = [r for r in regions if r['field'] == 'full_name']
                self.assertEqual(len(names), 1)
                self.assertEqual(names[0]['bbox'], (227, 240, 513, 258))

    def test_recovery_failure_does_not_erase_global_or_create_a_label(self):
        raw = [OCRLine('ĐẶNG THỊ CÚC', .9, (241, 239, 483, 255))]
        engine = MagicMock()
        self.assertEqual(recover_name_labels(Image.new('RGB', (720, 454)), raw, engine,
                         lambda _: [{'text': 'Faculty', 'confidence': .99, 'bbox': (1, 1, 50, 20)}]), [])
        engine.Clear.assert_called()
        self.assertEqual(raw[0].text, 'ĐẶNG THỊ CÚC')

    def test_matching_types_and_low_confidence_are_independent_from_readability(self):
        for text, expected in (('ĐẶNG THỊ CÚC', 'EXACT'), ('DANG THI CUC', 'NORMALIZED'),
                               ('TRẦN VĂN BÌNH', 'MISMATCH'), (None, 'UNREADABLE')):
            fields = {'full_name': text, 'student_code': '001IT123'}
            result = compare_fields(fields, {'full_name': .98, 'student_code': .99}, 'ĐẶNG THỊ CÚC', '001IT123')
            self.assertEqual(result['comparison']['name_match_type'], expected)
            self.assertEqual(result['warnings'], ['NAME_NORMALIZED'] if expected == 'NORMALIZED' else [])
        result = compare_fields({'full_name': 'ĐẶNG THỊ CÚC', 'student_code': '001IT123'},
                                {'full_name': .89, 'student_code': .99}, 'ĐẶNG THỊ CÚC', '001IT123')
        self.assertEqual(result['blocking_errors'], ['NAME_LOW_CONFIDENCE'])
        self.assertFalse(result['can_confirm'])

    def test_debug_has_real_name_tokens_candidate_bbox_and_reject_reason(self):
        lines = [OCRLine('Họ tên', .8, (70, 240, 225, 258), (
                    OCRToken('Họ', .8, (70, 240, 90, 258)), OCRToken('tên', .8, (100, 240, 225, 258)))),
                 OCRLine('ĐẶNG THỊ CÚC', .98, (241, 239, 483, 255))]
        events = []
        parse_fields(lines, diagnostics=events)
        label = next(e for e in events if e.get('event') == 'NAME_LABEL')
        candidate = next(e for e in events if e.get('event') == 'NAME_CANDIDATE')
        self.assertEqual(label['tokens'][0]['text'], 'Họ')
        self.assertEqual(candidate['text'], 'ĐẶNG THỊ CÚC')
        self.assertEqual(candidate['bbox'], (241, 239, 483, 255))
        self.assertIsNone(candidate['reject_reason'])

    def test_identity_debug_never_logs_in_production(self):
        result = OCRResult([OCRLine('Họ tên: ĐẶNG THỊ CÚC', .99)])
        with patch('app.services.student_card_ocr.settings') as settings, patch('app.services.student_card_ocr.logger') as logger:
            for environment in ('production', 'staging', 'test'):
                settings.ENVIRONMENT = environment
                log_name_debug(result)
                logger.info.assert_not_called()
            settings.ENVIRONMENT = 'development'
            log_name_debug(result)
            self.assertTrue(logger.info.called)
