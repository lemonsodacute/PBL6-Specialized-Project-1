from unittest import TestCase
import unicodedata

from app.services.student_card_matching import MIN_FIELD_CONFIDENCE, OCRLine, OCRToken, compare_fields, names_match, normalize_code, parse_fields


class CardMatchingTests(TestCase):
    def test_long_bilingual_label_accepts_left_aligned_value_below(self):
        lines = [OCRLine('Số thẻ SV/Student ID:', .45, (1400, 900, 1900, 930)),
                 OCRLine('102230057', .98, (1400, 950, 1600, 980))]
        fields, confidence = parse_fields(lines)
        self.assertEqual(fields['student_code'], '102230057')
        self.assertEqual(confidence['student_code'], .98)

    def test_partial_student_anchor_requires_nine_exact_digits_and_geometry(self):
        for anchor in ('dent ID', '(Số thẻ bị mờ) / Student 1D:'):
            lines = [OCRLine(anchor, .3, (1400, 900, 1900, 930)),
                     OCRLine('102230057', .98, (1400, 950, 1600, 980))]
            self.assertEqual(parse_fields(lines)[0]['student_code'], '102230057')
            for value in ('10223O057', '11247707', '2011-2014', '09091990'):
                self.assertIsNone(parse_fields([lines[0], OCRLine(value, .99, lines[1].bbox)])[0]['student_code'])
        for label in ('Bank Student ID', 'Barcode Student ID', 'Ngày sinh Student ID', 'unreadable label'):
            self.assertIsNone(parse_fields([OCRLine(label, .3, (1400, 900, 1900, 930)),
                                           OCRLine('102230057', .99, (1400, 950, 1600, 980))])[0]['student_code'])

    def test_bach_khoa_separate_dob_and_class_values_do_not_extend_full_name(self):
        lines = [OCRLine('Họ tên/Full name: LE NGUYEN CHAU ANH', .95, (171, 673, 1299, 716), (
            OCRToken('Họ', .9, (171, 675, 237, 712)), OCRToken('tên/Full', .9, (278, 673, 453, 712)),
            OCRToken('name:', .9, (469, 684, 612, 712)), OCRToken('LE', .98, (659, 676, 724, 715)),
            OCRToken('NGUYEN', .98, (749, 676, 984, 716)), OCRToken('CHAU', .98, (1006, 675, 1161, 715)),
            OCRToken('ANH', .98, (1182, 675, 1299, 715)))),
            OCRLine('Ngay sinh/DoB', .8, (170, 731, 558, 785)),
            OCRLine('03/03/2005', .98, (651, 737, 938, 777)),
            OCRLine('Lop/Class', .4, (168, 795, 431, 845)),
            OCRLine('23T_NHAT2', .98, (654, 795, 971, 835)),
            OCRLine('Khoo/Fơculty.', .7, (167, 855, 520, 907)),
            OCRLine('Công nghệ thông tin', .97, (656, 860, 1208, 913))]
        fields, _ = parse_fields(lines)
        self.assertEqual(fields['full_name'], 'LE NGUYEN CHAU ANH')
        self.assertEqual(fields['class_name'], '23T_NHAT2')
        self.assertIsNone(fields['student_code'])

    def test_vietnamese_names_accents_case_whitespace_and_d_stroke(self):
        for a, b in [('Nguyễn Văn Thiện', 'NGUYEN VAN THIEN'), ('Đặng Thị Hồng', 'DANG THI HONG'),
                     ('  Nguyễn   Văn Thiện ', 'nguyen van thien'), (unicodedata.normalize('NFD', 'Đặng Thị Hồng'), 'dang thi hong')]:
            self.assertTrue(names_match(a, b))

    def test_fuzzy_is_one_character_in_one_long_token_only(self):
        self.assertTrue(names_match('Nguyễn Thị Thanh Hương', 'Nguyen Thi Thanh Huongg'))
        for b in ('Thi Thanh Huong', 'Huong Thanh Thi Nguyen', 'Nguyen Thi Thxnh Hxong', 'Nguyen Thanh Huong', 'Nguyen Thi Thanh Long'):
            self.assertFalse(names_match('Nguyễn Thị Thanh Hương', b))
        self.assertFalse(names_match('An', 'Anh'))
        self.assertFalse(names_match('Nguyễn Văn An', 'Nguyen Van Anh'))
        self.assertFalse(names_match('', ''))

    def test_code_exact_leading_zeros_and_ambiguous_characters(self):
        self.assertEqual(normalize_code(' 001it123 '), '001IT123')
        for code in ('1IT123', 'OO1IT123', '0011T123', '001IT12B', '001 IT123'):
            result = compare_fields({'full_name': 'Nguyen Van An', 'student_code': code}, {'full_name': 1, 'student_code': 1}, 'Nguyễn Văn An', '001IT123')
            self.assertFalse(result['can_confirm'])
            self.assertFalse(result['comparison']['student_code_match'])

    def test_labelled_multiline_parsing_and_optional_fields(self):
        fields, confidence = parse_fields([OCRLine('Họ và tên: Nguyễn Văn Thiện', .99), OCRLine('MSSV', .99), OCRLine('001IT123', .98), OCRLine('Lớp: 21IT1', .7), OCRLine('Ngành: Công nghệ thông tin', .8)])
        self.assertEqual(fields, {'full_name': 'Nguyễn Văn Thiện', 'student_code': '001IT123', 'class_name': '21IT1', 'major': 'Công nghệ thông tin'})
        self.assertTrue(compare_fields(fields, confidence, 'Nguyễn Văn Thiện', '001IT123')['can_confirm'])

    def test_missing_low_confidence_and_conflicting_fields_never_unlock(self):
        fields, confidence = parse_fields([OCRLine('Họ và tên: Nguyen Van An', .99), OCRLine('MSSV: 21IT123', .8)])
        self.assertIn('STUDENT_CODE_UNREADABLE', compare_fields(fields, confidence, 'Nguyễn Văn An', '21IT123')['blocking_errors'])
        fields, confidence = parse_fields([OCRLine('MSSV: 21IT123', 1), OCRLine('MSSV: 21IT124', 1)])
        self.assertIsNone(fields['student_code'])
        self.assertIsNone(fields['full_name'])
        fields, _ = parse_fields([OCRLine('Họ và tên', 1), OCRLine('MSSV: 21IT123', 1)])
        self.assertIsNone(fields['full_name'])

    def test_requested_student_code_layouts(self):
        for text, expected in (
            ('MSSV: 102230057', '102230057'),
            ('Mã sinh viên: 102230057', '102230057'),
            ('Số thẻ SV/Student ID:\n102230057', '102230057'),
            ('MS\n06031034', '06031034'),
            ('MS: 06031034', '06031034'),
            ('MS        06031034', '06031034'),
        ):
            with self.subTest(text=text):
                fields, _ = parse_fields([OCRLine(line, .98) for line in text.splitlines()])
                self.assertEqual(fields['student_code'], expected)
                self.assertIsInstance(fields['student_code'], str)

    def test_all_code_aliases_and_bilingual_label(self):
        for alias in ('MSSV', 'Mã sinh viên', 'Mã SV', 'Số thẻ SV', 'Số thẻ sinh viên',
                      'Student ID', 'Student No', 'Student Number', 'MS',
                      'Số thẻ SV / Student ID', 'Mã số sinh viên', 'Student code', 'MSV'):
            with self.subTest(alias=alias):
                fields, _ = parse_fields([OCRLine(alias + ': 001IT123', .99)])
                self.assertEqual(fields['student_code'], '001IT123')

    def test_longest_label_and_vietnamese_major_preserve_value(self):
        for text in ('Ngành học: Kế toán doanh nghiệp', 'Ngành: Kế toán doanh nghiệp',
                     '  Ngành   học :  Kế toán doanh nghiệp',
                     unicodedata.normalize('NFD', 'Ngành học: Kế toán doanh nghiệp')):
            with self.subTest(text=text):
                fields, _ = parse_fields([OCRLine(text, .98)])
                self.assertEqual(fields['major'], 'Kế toán doanh nghiệp')
        fields, _ = parse_fields([OCRLine('Họ và tên: Nguyễn Văn An', .99),
                                 OCRLine('Số thẻ sinh viên: 06031034', .99)])
        self.assertEqual(fields['full_name'], 'Nguyễn Văn An')
        self.assertEqual(fields['student_code'], '06031034')

    def test_ms_requires_exact_label_and_not_substring_or_fuzzy(self):
        for text in ('TERMS', 'Forms', 'SMS', 'MSX', 'MS06031034', 'M5', 'M S',
                     'Thông tin MS', 'MS Office', 'MS / barcode'):
            with self.subTest(text=text):
                fields, _ = parse_fields([OCRLine(text, .99), OCRLine('06031034', .99)])
                self.assertIsNone(fields['student_code'])

    def test_ms_rejects_dates_years_and_other_labelled_numbers(self):
        for text in ('Ngày sinh: 09/09/1990', '09/09/1990', '09091990', '19900909',
                     'Khóa học: 2011-2014', '2011-2014', '20112014', '2011',
                     'Card number: 87654321', 'Barcode: 87654321',
                     'Valid until: 09/09/2030', 'Lớp: 001IT123', '06031034 87654321'):
            with self.subTest(text=text):
                fields, _ = parse_fields([OCRLine('MS', .99), OCRLine(text, .99)])
                self.assertIsNone(fields['student_code'])

    def test_unlabelled_or_nonadjacent_number_is_not_a_code(self):
        for lines in ([OCRLine('87654321', .99)],
                      [OCRLine('MS', .99), OCRLine('Barcode', .99), OCRLine('87654321', .99)],
                      [OCRLine('MS', .99), OCRLine('Trường đại học', .99), OCRLine('87654321', .99)]):
            fields, _ = parse_fields(lines)
            self.assertIsNone(fields['student_code'])

    def test_real_ms_geometry_ignores_page_order_and_remote_numbers(self):
        lines = [OCRLine('87654321', .999, (800, 570, 940, 593)),
                 OCRLine('06031034', .9674441528320312, (90, 569, 230, 592)),
                 OCRLine('2011-2014', .96, (494, 522, 610, 540)),
                 OCRLine('MS', .9663357543945312, (144, 539, 175, 555))]
        for ordered in (lines, list(reversed(lines))):
            with self.subTest(order=ordered):
                diagnostics = []
                fields, confidence = parse_fields(ordered, diagnostics=diagnostics)
                self.assertEqual(fields['student_code'], '06031034')
                self.assertEqual(confidence['student_code'], .9674441528320312)
                selected = next(event for event in diagnostics if event.get('selected'))
                self.assertEqual(selected['relation'], 'below')
                self.assertEqual(selected['candidate_bbox'], (90, 569, 230, 592))
                self.assertTrue(any(event.get('rejection_reason') == 'outside_label_region' for event in diagnostics))

    def test_spatial_right_and_distance_bounds_override_raw_adjacency(self):
        label = OCRLine('MS', .99, (100, 100, 130, 120))
        fields, _ = parse_fields([label, OCRLine('87654321', .99, (700, 100, 840, 120)),
                                 OCRLine('06031034', .98, (145, 100, 285, 120))])
        self.assertEqual(fields['student_code'], '06031034')
        for box in ((700, 100, 840, 120), (100, 200, 240, 220), (400, 130, 540, 150),
                    (100, 50, 240, 70), (0, 100, 80, 120)):
            with self.subTest(box=box):
                fields, _ = parse_fields([label, OCRLine('87654321', .99, box)])
                self.assertIsNone(fields['student_code'])

    def test_near_below_beats_far_right_and_high_confidence_remote_value(self):
        fields, _ = parse_fields([OCRLine('MS', .97, (144, 539, 175, 555)),
                                 OCRLine('87654321', 1, (280, 539, 420, 555)),
                                 OCRLine('06031034', .96, (90, 569, 230, 592))])
        self.assertEqual(fields['student_code'], '06031034')

    def test_number_owned_by_barcode_or_other_field_is_rejected(self):
        for text in ('Barcode', 'Card number', 'Ngày sinh', 'Khóa học', 'Valid until', 'Lớp'):
            with self.subTest(label=text):
                fields, _ = parse_fields([OCRLine('MS', .99, (100, 100, 130, 120)),
                                         OCRLine('87654321', .99, (100, 150, 240, 170)),
                                         OCRLine(text, .99, (100, 125, 180, 145))])
                self.assertIsNone(fields['student_code'])

    def test_close_competing_codes_return_null_regardless_of_order(self):
        label = OCRLine('MS', .99, (100, 100, 130, 120))
        values = [OCRLine('06031034', .95, (70, 130, 160, 150)),
                  OCRLine('87654321', .99, (70, 138, 160, 158))]
        for ordered in (values, list(reversed(values))):
            fields, confidence = parse_fields([label, *ordered])
            self.assertIsNone(fields['student_code'])
            self.assertIsNone(confidence['student_code'])
        fields, _ = parse_fields([OCRLine('MS', .99), OCRLine('06031034', .99), OCRLine('87654321', .99)])
        self.assertIsNone(fields['student_code'])

    def test_conflicting_labels_return_null(self):
        fields, _ = parse_fields([OCRLine('MS: 06031034', .99), OCRLine('Student ID: 87654321', .99)])
        self.assertIsNone(fields['student_code'])

    def test_digits_keep_their_confidence_with_low_label_confidence(self):
        inline = OCRLine('MS: 06031034', .70, (100, 100, 285, 120), (
            OCRToken('MS:', .45, (100, 100, 130, 120)),
            OCRToken('06031034', .98, (145, 100, 285, 120))))
        for lines in ([OCRLine('MS', .45), OCRLine('06031034', .98)], [inline]):
            fields, confidence = parse_fields([OCRLine('Họ tên: Nguyễn Văn An', .99), *lines])
            self.assertEqual(confidence['student_code'], .98)
            self.assertTrue(compare_fields(fields, confidence, 'Nguyễn Văn An', '06031034')['can_confirm'])
        self.assertEqual(MIN_FIELD_CONFIDENCE, .90)

    def test_low_digits_confidence_is_preserved_and_still_blocks_confirmation(self):
        for score, readable in ((.8999, False), (.90, True)):
            fields, confidence = parse_fields([OCRLine('Họ tên: Nguyễn Văn An', .99),
                                              OCRLine('MS', .99), OCRLine('06031034', score)])
            self.assertEqual(fields['student_code'], '06031034')
            result = compare_fields(fields, confidence, 'Nguyễn Văn An', '06031034')
            self.assertEqual(result['can_confirm'], readable)
            self.assertEqual('STUDENT_CODE_UNREADABLE' in result['blocking_errors'], not readable)

    def test_no_oi_substitution_or_fuzzy_code_matching(self):
        for code in ('O6031034', '0603I034', '06031035', '6031034'):
            fields, confidence = parse_fields([OCRLine('Họ tên: Nguyễn Văn An', .99), OCRLine(f'MS: {code}', .99)])
            self.assertEqual(fields['student_code'], code)
            self.assertIn('STUDENT_CODE_MISMATCH', compare_fields(fields, confidence, 'Nguyễn Văn An', '06031034')['blocking_errors'])

    def test_read_success_mismatch_is_distinct_from_parse_failed(self):
        name = OCRLine('Họ tên: Nguyễn Văn An', .99)
        fields, confidence = parse_fields([name, OCRLine('MS', .99), OCRLine('06031034', .98)])
        result = compare_fields(fields, confidence, 'Nguyễn Văn An', '102230057')
        self.assertEqual(fields['student_code'], '06031034')
        self.assertEqual(result['blocking_errors'], ['STUDENT_CODE_MISMATCH'])
        fields, confidence = parse_fields([name, OCRLine('MS', .99)])
        self.assertIsNone(fields['student_code'])
        self.assertEqual(compare_fields(fields, confidence, 'Nguyễn Văn An', '102230057')['blocking_errors'], ['STUDENT_CODE_UNREADABLE'])
