"""Hand-computed metric checks; never connect to or mutate application data."""
import math
from unittest import TestCase
from scripts.ai_evaluation_common import digest, latency_summary, mean_metrics, retrieval_metrics
from scripts.evaluate_ai_chatbox import aggregate, score


class RetrievalMetricTests(TestCase):
    def test_short_results_keep_k_denominator(self):
        m = retrieval_metrics(['a'],{'a':1,'b':1})
        self.assertEqual(m['precision_at_1'],1)
        self.assertEqual(m['precision_at_3'],1/3)
        self.assertEqual(m['precision_at_5'],.2)
        self.assertEqual(m['recall_at_5'],.5)
        self.assertEqual(m['reciprocal_rank'],1)

    def test_rank_two_and_dcg_have_known_values(self):
        m = retrieval_metrics(['x','a','b'],{'a':1,'b':1})
        self.assertEqual(m['hit_rate_at_1'],0)
        self.assertEqual(m['hit_rate_at_3'],1)
        self.assertEqual(m['reciprocal_rank'],.5)
        self.assertAlmostEqual(m['ndcg_at_5'],(1/math.log2(3)+.5)/(1+1/math.log2(3)))

    def test_mrr_is_not_truncated_to_five(self):
        m = retrieval_metrics(['x','y','z','w','v','a'],{'a':1})
        self.assertEqual(m['reciprocal_rank'],1/6)
        self.assertEqual(m['recall_at_5'],0)

    def test_empty_results_and_no_positive_judgments(self):
        self.assertEqual(retrieval_metrics([],{'a':1})['reciprocal_rank'],0)
        self.assertIsNone(retrieval_metrics([],{})['recall_at_5'])
        self.assertIsNone(retrieval_metrics([],{})['ndcg_at_5'])

    def test_duplicate_ids_and_invalid_grades_are_rejected(self):
        with self.assertRaises(ValueError): retrieval_metrics(['a','a'],{'a':1})
        with self.assertRaises(ValueError): retrieval_metrics([] ,{'a':-1})

    def test_nearest_rank_p95_and_macro_mean(self):
        self.assertEqual(latency_summary(list(range(1,21)))['p95_ms'],19)
        self.assertEqual(mean_metrics([{'v':0},{'v':1},{'v':None}],['v']),{'v':.5})
        self.assertIsNone(latency_summary([])['average_ms'])

    def test_checksum_ignores_mapping_order_but_not_content(self):
        self.assertEqual(digest({'a':1,'b':2}),digest({'b':2,'a':1}))
        self.assertNotEqual(digest({'a':1}),digest({'a':2}))


class SupportRubricTests(TestCase):
    def test_unrelated_source_can_be_grounded_but_incorrect(self):
        case = {'expected_behavior':'guidance','expected_key_facts':[{'any_of':[
            {'article_id':'help','facts':['Enable the camera.']}]}]}
        articles = {'wrong':{'title':'Other issue','steps':['Ask the administrator.']}}
        actual = {'answer':'Other issue\n1. Ask the administrator.','phase':'ESCALATE',
                  'selected_ids':['wrong'],'provider_error':None}
        result = score(case,actual,articles)
        self.assertEqual(result['correctness'],0)
        self.assertEqual(result['groundedness'],2)
        self.assertEqual(result['relevance'],0)
        self.assertFalse(result['hallucination'])

    def test_partial_facts_do_not_require_full_answer_equality(self):
        case = {'expected_behavior':'guidance','expected_key_facts':[{'any_of':[
            {'article_id':'help','facts':['Enable the camera.','Check the microphone.']}]}]}
        articles = {'help':{'title':'Devices','steps':['Enable the camera.']}}
        actual = {'answer':'Devices\n1. ENABLE THE CAMERA!','phase':'FEEDBACK',
                  'selected_ids':['help'],'provider_error':None}
        result = score(case,actual,articles)
        self.assertEqual(result['correctness'],1)
        self.assertEqual(result['facts_met'],[True,False])

    def test_no_records_does_not_invent_percentages(self):
        result = aggregate([])
        self.assertEqual(result['status'],'INSUFFICIENT_DATA')
        self.assertNotIn('answer_correctness_pct',result)
