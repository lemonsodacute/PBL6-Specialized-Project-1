"""Review-package integrity checks; no DB or external model calls."""
from copy import deepcopy
import csv
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from scripts.ai_evaluation_common import digest, require_legacy_evaluation_schema
from scripts.prepare_ai_golden_sets import build, export_review, propose, validate


def fixture():
    corpus = {'articles': [], 'banks': [dict(id='bank-sql', name='Transaction và thiết kế dữ liệu')],
              'questions': [dict(id='db-q-atomicity', bank_id='bank-sql', content='Thuộc tính Atomicity trong ACID có ý nghĩa gì?'),
                            dict(id='db-q-norm', bank_id='bank-sql', content='Chuẩn hóa dữ liệu thường giúp giảm vấn đề nào?')]}
    return dict(corpus=corpus, corpus_sha256=digest(corpus), collected_at_utc='2026-10-26T00:00:00+00:00')


class GoldenReviewTests(TestCase):
    def test_counts_pair_labels_and_pending_status(self):
        frozen = fixture()
        chat, search = build(frozen)
        validate(chat, search, frozen)
        self.assertEqual(len(chat['cases']), 60)
        self.assertEqual(len(search['cases']), 80)
        self.assertEqual(sum(c['source'] == 'user_request' for c in search['cases']), 70)
        atomicity = next(c for c in search['cases'] if c['id'] == 'SEARCH-SEM-002')
        self.assertEqual(atomicity['highly_relevant_question_ids'], ['db-q-atomicity'])
        self.assertTrue(all(c['review_status'] == 'NEEDS_HUMAN_REVIEW' for c in chat['cases'] + search['cases']))

    def test_reject_invented_id_even_with_recomputed_checksum(self):
        frozen = fixture()
        chat, search = build(frozen)
        search['cases'][0]['relevant_question_ids'].append('invented-id')
        search['cases_sha256'] = digest(search['cases'])
        with self.assertRaisesRegex(ValueError, 'real snapshot IDs'):
            validate(chat, search, frozen)

    def test_reject_corrupted_corpus(self):
        frozen = fixture()
        chat, search = build(frozen)
        frozen['corpus']['questions'][0]['content'] = 'Changed after snapshot'
        with self.assertRaisesRegex(ValueError, 'Snapshot checksum'):
            validate(chat, search, frozen)

    def test_normalization_does_not_include_ml_feature_scaling(self):
        corpus = deepcopy(fixture()['corpus'])
        corpus['banks'].append(dict(id='ml', name='Dữ liệu và đánh giá mô hình'))
        corpus['questions'].append(dict(id='ml-norm', bank_id='ml', content='Tiền xử lý chuẩn hóa dữ liệu nên fit trên tập nào?'))
        self.assertEqual([r['question_id'] for r in propose({'intent':'normalization'}, corpus)], ['db-q-norm'])

    def test_no_candidate_is_not_approved_negative(self):
        _, search = build(fixture())
        negatives = [c for c in search['cases'] if c['set_id'] == 13]
        self.assertTrue(all(c['relevant_question_ids'] == [] for c in negatives))
        self.assertTrue(all(c['negative_expectation'] == 'PENDING_CORPUS_REVIEW' for c in negatives))

    def test_pending_and_manual_rubrics_cannot_reach_legacy_scorer(self):
        for dataset in build(fixture()):
            with self.assertRaisesRegex(ValueError, 'human review'):
                require_legacy_evaluation_schema(dataset)
        with self.assertRaisesRegex(ValueError, 'schema 1 only'):
            require_legacy_evaluation_schema({'schema_version':2, 'cases':[]})
        require_legacy_evaluation_schema({'schema_version':1, 'cases':[]})

    def test_review_export_preserves_optional_accent_fields(self):
        frozen = fixture()
        chat, search = build(frozen)
        with TemporaryDirectory() as folder:
            output = Path(folder)
            export_review(output, chat, search, frozen)
            with (output / 'question-search-review.csv').open(encoding='utf-8-sig', newline='') as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 80)
            pair = next(r for r in rows if r['id'] == 'SEARCH-ACCENT-001')
            self.assertEqual(pair['paired_case_id'], 'SEARCH-ACCENT-001-ACCENTED')
            self.assertTrue((output / 'manifest.json').exists())
