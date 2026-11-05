"""Deterministic quality boundaries; real semantic evaluation lives in artifacts.

No mocked successful AI response is used by this suite.
"""
from copy import deepcopy
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
import time

from app.services.ai_provider import AIProviderError
from app.services.question_document_extract import DocumentError
from app.services.question_generation import GeneratedBatch, validate_candidates, validate_generated
from app.services.question_quality import fingerprint, near_duplicate, obvious_recall, review_drafts
from app.services.question_document_drafts import generation_plan


class QuestionQualityTests(TestCase):
    source = {'id': 'chunk-1', 'text': 'HTML mô tả cấu trúc trang web; CSS mô tả hình thức trình bày.', 'page': None, 'label': 'Web'}
    config = {'question_type': 'mcq_single', 'difficulty': 'easy'}

    def candidate(self, **changes):
        return {'content': 'HTML mô tả thành phần nào của trang web?', 'options': ['Cấu trúc', 'Màu sắc', 'Phông chữ', 'Khoảng cách'],
            'answers': ['Cấu trúc'], 'explanation': 'HTML mô tả cấu trúc trang web.', 'source_chunk_id': 'chunk-1',
            'source_excerpt': self.source['text'], 'image_ids': [], **changes}

    def validate(self, values, config=None, limit=3):
        return validate_candidates(GeneratedBatch.model_validate({'questions': values}), sources=[self.source],
            requirements={'chunk-1': limit}, config=config or self.config, excluded=[])

    def test_translation_near_duplicates_preserve_negation_and_numbers(self):
        self.assertTrue(near_duplicate('What is REST API?', 'REST API là gì?'))
        self.assertTrue(near_duplicate('Định nghĩa RESTful', 'REST API là gì?'))
        self.assertFalse(near_duplicate('REST API sử dụng 2 bước', 'REST API sử dụng 3 bước'))
        self.assertFalse(near_duplicate('HTTP không lưu trạng thái', 'HTTP lưu trạng thái'))
        self.assertFalse(near_duplicate('Cách cấu hình router cho mạng nội bộ', 'Cách cấu hình DNS cho mạng nội bộ'))

    def test_partial_validation_keeps_good_candidate_and_counts_rejections(self):
        result = self.validate([self.candidate(), self.candidate(content='CSS mô tả thành phần nào của trang web?', answers=[]), self.candidate(source_excerpt='Không có trích dẫn này trong tài liệu')])
        self.assertEqual(len(result), 1)
        self.assertEqual(result.quality_summary['generated'], 3)
        self.assertEqual(result.quality_summary['rejected'], 2)
        self.assertEqual(result.quality_summary['unsupported'], 1)
        self.assertEqual(result.quality_summary['ambiguous'], 1)
        self.assertEqual(result[0]['source_chunk_id'], 'chunk-1')

    def test_multi_requires_two_correct_and_a_distractor(self):
        config = {**self.config, 'question_type': 'mcq_multi'}
        for answers in [['Cấu trúc'], ['Cấu trúc', 'Màu sắc', 'Phông chữ', 'Khoảng cách']]:
            with self.subTest(answers=answers), self.assertRaises(DocumentError):
                self.validate([self.candidate(answers=answers)], config)
        result = self.validate([self.candidate(answers=['Cấu trúc', 'Màu sắc'])], config)
        self.assertEqual(len(result[0]['answers']), 2)

    def test_duplicates_and_source_quotas_do_not_discard_valid_siblings(self):
        result = self.validate([self.candidate(), self.candidate()], limit=1)
        self.assertEqual(len(result), 1)
        self.assertEqual(result.quality_summary['rejected'], 1)
        with self.assertRaises(DocumentError):
            validate_generated(GeneratedBatch.model_validate({'questions': [self.candidate(), self.candidate()]}),
                sources=[self.source], requirements={'chunk-1': 2}, config=self.config, excluded=[])

    def test_essay_requires_model_answer_without_options(self):
        config = {**self.config, 'question_type': 'essay'}
        for values in [self.candidate(), self.candidate(options=[], answers=[])]:
            with self.subTest(values=values), self.assertRaises(DocumentError):
                self.validate([values], config)
        result = self.validate([self.candidate(options=[], answers=['HTML mô tả cấu trúc trang web.'],
            explanation='Cần nêu vai trò cấu trúc của HTML và phân biệt với hình thức trình bày.')], config)
        self.assertEqual(result[0]['options'], [])

    def test_quality_failure_is_unknown_never_automatic_pass_or_human_approval(self):
        draft = self.validate([self.candidate()])[0]
        draft['id'] = str(uuid4())
        settings = SimpleNamespace(QUESTION_GENERATION_SUPPORTS_VISION=False)
        with patch('app.services.question_quality.OpenAICompatibleClient') as client:
            client.return_value.complete.side_effect = AIProviderError('AI_TIMEOUT')
            result = review_drafts([draft], sources=[self.source], excluded=[], settings=settings, deadline=time.monotonic() + 10)
        self.assertEqual(result[0]['quality_check']['status'], 'review')
        self.assertIsNone(result[0]['quality_check']['grounded'])
        self.assertIn('REVIEW_UNAVAILABLE', result[0]['quality_check']['flags'])
        self.assertEqual(result.quality_summary['valid'], 0)
        self.assertNotIn('decision', result[0])

    def test_fingerprint_tracks_edits_but_not_presentation_metadata(self):
        draft = self.validate([self.candidate()])[0]
        old = fingerprint(draft)
        other = deepcopy(draft); other['duplicate'] = True
        self.assertEqual(fingerprint(other), old)
        other['answers'] = ['Màu sắc']
        self.assertNotEqual(fingerprint(other), old)

    def test_recall_with_scenario_is_not_hard_and_cover_page_is_not_a_source(self):
        self.assertTrue(obvious_recall('Khi router cần cập nhật, DR sẽ sử dụng địa chỉ IP đích nào?'))
        self.assertTrue(obvious_recall('REST API là gì?'))
        self.assertFalse(obvious_recall('Hãy so sánh hai phương án triển khai và giải thích lựa chọn theo ràng buộc chi phí.'))
        heading = {'id': 'cover', 'text': 'BÁO CÁO KỸ THUẬT\nDỰ ÁN QUẢN LÝ\nCHƯƠNG V DỰ TOÁN'}
        sources = [heading, self.source, {**self.source, 'id': 'chunk-2'}]
        plan = generation_plan(sources, 2)
        self.assertEqual(set(plan[0]['requirements']), {'chunk-1', 'chunk-2'})
