"""Run the unchanged support service using frozen gold facts and read-only DB.

No accounts, sessions, support turns or analytics are inserted. --live explicitly
enables the configured real provider. Ratings are deterministic source-fact checks,
not an LLM judging itself, and all outputs/ratings are exposed for human review.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import re
import sys
from types import SimpleNamespace
from uuid import NAMESPACE_URL, uuid5

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.ai_evaluation_common import (DEFAULT_OUTPUT, collect_snapshot, digest, latency_summary,
    provenance, read_json, readonly_session, require_legacy_evaluation_schema, snapshot, write_csv, write_json)
from app.services import support_knowledge as kb

SOURCE_FILES = ['backend/app/api/v1/support_assistant.py', 'backend/app/services/support_knowledge.py',
                'backend/app/services/support_assistant_provider.py', 'backend/app/services/ai_provider.py']


def fold(value):
    return ' '.join(re.findall(r'[a-z0-9]+', kb.normalize(value)))


def score(case, actual, articles):
    text, phase = actual['answer'], actual['phase']
    chosen = set(actual['selected_ids'])
    facts = []
    expected_ids = {a['article_id'] for f in case['expected_key_facts'] for a in f.get('any_of', [])}
    for fact in case['expected_key_facts']:
        if 'any_of' in fact:
            for index in range(len(fact['any_of'][0]['facts'])):
                facts.append(any(index < len(alternative['facts']) and
                    fold(alternative['facts'][index]) in fold(text) for alternative in fact['any_of']))
    if case['expected_behavior'] == 'role_refusal':
        anchors = (['sinh vien', 'khong co quyen', 'ngan hang cau hoi'] if case['guard'] == 'STUDENT_BANK_GUARD'
                   else ['giang vien', 'khong xac thuc', 'sinh vien'])
        facts = [all(a in fold(text) for a in anchors)]
    elif case['expected_behavior'] == 'fallback':
        facts = [not chosen and phase == 'ESCALATE' and 'chua tim thay huong dan phu hop' in fold(text)]
    fraction = sum(facts) / len(facts)
    expected_phase = 'FEEDBACK' if case['expected_behavior'] == 'guidance' else 'ESCALATE'
    correctness = 2 if fraction == 1 and phase == expected_phase else 1 if fraction > 0 else 0
    unrelated = chosen - expected_ids if expected_ids else chosen
    relevance = 2 if fraction == 1 and not unrelated else 1 if fraction > 0 else 0

    # The visible answer is extractive. Check every line against the actual supplied
    # KB and fixed server messages, rather than claiming arbitrary prose is grounded.
    from app.api.v1.support_assistant import GREETING, KNOWLEDGE_NOT_FOUND
    from app.services.ai_provider import AI_MESSAGES
    supplied = [articles[aid] for aid in chosen if aid in articles]
    supported = {fold(a['title']) for a in supplied}
    supported.update(fold(step) for a in supplied for step in a['steps'])
    boilerplate = [GREETING, KNOWLEDGE_NOT_FOUND,
        'Vấn đề này cần quản trị viên hệ thống kiểm tra.',
        'Bạn thử các bước trên xem vấn đề đã được giải quyết chưa.',
        'Bạn có thể chuyển yêu cầu tới quản trị viên.',
        'Tài khoản sinh viên không có quyền tạo đề thi hoặc quản lý ngân hàng câu hỏi.',
        'Xác thực thẻ sinh viên thuộc luồng của sinh viên và quản trị viên. Tài khoản giảng viên không xác thực thẻ thay sinh viên.',
        'Trợ lý AI hiện chưa được cấu hình']
    supported.update(map(fold, boilerplate))
    if phase == 'UNAVAILABLE' and actual.get('provider_error'):
        supported.update(fold(message + suffix) for message in AI_MESSAGES.values()
                         for suffix in ('', ' Bạn có thể liên hệ System Admin để được hỗ trợ.'))
    lines = [re.sub(r'^\d+\.\s*', '', line.strip()) for line in text.splitlines() if line.strip()]
    unsupported = [line for line in lines if fold(line) not in supported]
    # Fixed status boilerplate is counted as a statement for transparency, even
    # though source-faithfulness does not establish the truth/completeness of KB.
    groundedness = 2 if not unsupported else 1 if len(unsupported) < len(lines) else 0
    problems = []
    if actual.get('provider_error'):
        problems.append('PROVIDER_UNAVAILABLE')
    if correctness < 2:
        if case['expected_behavior'] in ('fallback', 'escalate', 'role_refusal') and phase != expected_phase:
            problems.append('BAD_ESCALATION')
        elif phase == 'ESCALATE' and case['expected_behavior'] == 'guidance':
            problems.append('BAD_ESCALATION')
        if not facts or not all(facts):
            problems.append('MISSING_CONTEXT')
    if relevance == 0:
        problems.append('IRRELEVANT')
    if unsupported:
        problems.append('HALLUCINATION')
    return {'correctness': correctness, 'groundedness': groundedness, 'relevance': relevance,
        'hallucination': bool(unsupported), 'unsupported_claim_count': len(unsupported),
        'statement_count': len(lines), 'unsupported_claims': unsupported, 'facts_met': facts,
        'expected_phase': expected_phase, 'unrelated_selected_ids': sorted(unrelated),
        'correct_fallback_or_escalation': correctness == 2 if case['expected_behavior'] != 'guidance' else None,
        'problem_types': list(dict.fromkeys(problems)),
        'notes': 'Automatic source-fact/phase rubric. Missing facts or wrong-issue guidance alone are not labeled fabricated facts. '
                 'Groundedness checks source support, independently of relevance and application truth.',
        'review_method': 'deterministic source-fact and constrained-renderer checks; no LLM judge',
        'human_reviewed': False}


def aggregate(rows):
    n = len(rows)
    if not n:
        return {'evaluated': 0, 'status': 'INSUFFICIENT_DATA', 'reason': 'INSUFFICIENT_EVALUATION_DATA'}
    fallback = [r for r in rows if r['scores']['correct_fallback_or_escalation'] is not None]
    result = {'evaluated': n, **{label: sum(r['scores']['correctness'] == value for r in rows)
                for label, value in [('correct',2),('partial',1),('incorrect',0)]},
        'answer_correctness_pct': sum(r['scores']['correctness'] == 2 for r in rows) / n * 100,
        'correctness_score_pct': sum(r['scores']['correctness'] for r in rows) / (2*n) * 100,
        'groundedness_pct': sum(r['scores']['groundedness'] for r in rows) / (2*n) * 100,
        'relevance_pct': sum(r['scores']['relevance'] for r in rows) / (2*n) * 100,
        'hallucination_rate_pct': sum(r['scores']['hallucination'] for r in rows) / n * 100,
        'unsupported_claim_count': sum(r['scores']['unsupported_claim_count'] for r in rows),
        'fallback_cases': len(fallback),
        'correct_fallback_or_escalation_count': sum(r['scores']['correct_fallback_or_escalation'] for r in fallback),
        'correct_fallback_or_escalation_pct': sum(r['scores']['correct_fallback_or_escalation'] for r in fallback) / len(fallback) * 100 if fallback else None,
        'ai_resolution_rate': None,
        'ai_resolution_reason': 'NOT MEASURABLE: no independently verified support outcomes; selecting resolved is user feedback, not proof of repair.',
        'latency': latency_summary([r['metrics']['latency_ms'] for r in rows]),
        'provider_called_cases': sum(r['used_provider'] for r in rows),
        'provider_error_cases': sum(bool(r['provider_error']) for r in rows),
        'human_reviewed_cases': sum(r['scores']['human_reviewed'] for r in rows)}
    result['status'] = 'NEEDS_IMPROVEMENT' if result['correct'] < n else 'GOOD'
    result['status_rule'] = 'GOOD only if every authored case passes; this is a diagnostic suite, not a population estimate.'
    return result


def persist(path, data):
    rows = data['records']
    data['summary'] = aggregate(rows)
    data['per_category'] = {category: aggregate([r for r in rows if r['category'] == category])
                            for category in sorted({r['category'] for r in rows})}
    provider_rows = [r for r in rows if r['used_provider']]
    data['provider_path_summary'] = aggregate(provider_rows)
    data['error_counts'] = dict(Counter(r['provider_error'] for r in rows if r['provider_error']))
    write_json(path, data)
    write_csv(path.with_suffix('.csv'), [{
        'id': r['id'], 'category': r['category'], 'question': r['question'],
        'expected': r['gold']['expected_key_facts'], 'actual': r['answer'],
        **{k:r['scores'][k] for k in ('correctness','groundedness','relevance','hallucination')},
        'notes': r['scores']['notes'], 'reviewer_correctness': '', 'reviewer_groundedness': '',
        'reviewer_relevance': '', 'reviewer_hallucination': '', 'reviewer_name': '', 'reviewer_notes': ''
    } for r in rows])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--regrade', action='store_true', help='Recompute ratings from stored outputs without calling the provider.')
    parser.add_argument('--use-dataset-labels', action='store_true', help='Explicitly apply corrected labels during regrading; retain original gold and score records.')
    args = parser.parse_args()
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    from app.services.ai_provider import provider_diagnostics
    from app.services.ai_metrics import measure
    from app.api.v1.support_assistant import provider_answer
    frozen = snapshot(args.output)
    cases_file = args.output / 'chatbox-cases.json'
    if not cases_file.exists():
        from scripts.ai_evaluation_cases import build_chat_cases
        cases = build_chat_cases(frozen)
        write_json(cases_file, {'corpus_sha256': frozen['corpus_sha256'], 'cases_sha256': digest(cases), 'cases': cases})
    dataset = read_json(cases_file)
    require_legacy_evaluation_schema(dataset)
    if dataset['corpus_sha256'] != frozen['corpus_sha256'] or dataset['cases_sha256'] != digest(dataset['cases']):
        raise ValueError('Dataset checksum/corpus mismatch.')
    result_path = args.output / 'chatbox-results.json'
    articles = {a['id']: a for a in frozen['corpus']['articles']}
    if args.regrade:
        data = read_json(result_path)
        labels = {c['id']:c for c in dataset['cases']}
        changed = []
        for row in data['records']:
            row.setdefault('original_scores',row['scores'])
            if args.use_dataset_labels and row['gold'] != labels[row['id']]:
                row.setdefault('original_gold',row['gold'])
                row['gold'] = labels[row['id']]
                changed.append(row['id'])
            row['scores'] = score(row['gold'], row, articles)
        data['regrading'] = {'at_utc':datetime.now(timezone.utc).isoformat(),'no_new_provider_calls':True,
            'label_changes':[r['id'] for r in data['records'] if 'original_gold' in r],
            'scored_cases_sha256':dataset['cases_sha256'],
            'reason':'Fact labels reviewed against the complete source corpus. Per-step partial credit and appropriate missing-enrollment escalation; application prompts and search are unchanged.',
            'evaluation_source_sha256':provenance(['backend/scripts/evaluate_ai_chatbox.py','backend/scripts/ai_evaluation_cases.py'])['source_sha256']}
        persist(result_path, data)
        print(data['summary'])
        return
    if not args.live:
        print(f"Prepared {len(dataset['cases'])} cases. No responses or accuracy measured. Use --live for real provider calls.")
        return
    if result_path.exists() and not args.resume:
        parser.error('An existing baseline is present. Use --resume, or --output with a new directory; existing answers will not be overwritten.')
    config = provider_diagnostics()
    identity = {'corpus_sha256': frozen['corpus_sha256'], 'cases_sha256': dataset['cases_sha256'],
                'support_model': config['support_model'], 'provider': config['provider'],
                'source_sha256': provenance(SOURCE_FILES)['source_sha256']}
    data = read_json(result_path) if args.resume and result_path.exists() else {
        'schema_version':1, 'run_at_utc': datetime.now(timezone.utc).isoformat(),
        'run_identity': identity, 'provenance': provenance(SOURCE_FILES), 'configuration': config,
        'evaluation_level': 'Real provider + unchanged provider_answer core in read-only PostgreSQL; not HTTP/browser end-to-end.',
        'isolation': 'Transient case rows with user_id=None, no saved history, no per-user quota exhaustion, no DB writes or account creation.',
        'rating_method': 'Automatic deterministic factual-source/phase checks; not independently human validated. CSV exposes every output and editable review columns.',
        'limitations': ['Convenience diagnostic dataset, not representative production sampling.',
            'Groundedness measures faithfulness to the available KB, not factual freshness of every KB statement.',
            'Provider errors count as failed supported answers and are separately disclosed.',
            'UI authorization, active-exam guard, persistent feedback, notifications and real-world support resolution are outside this service-level run.'],
        'records': []}
    if data['run_identity'] != identity:
        raise ValueError('Cannot resume with different corpus, source, labels or provider model. Use a new output directory.')
    done = {r['id'] for r in data['records']}
    with readonly_session() as db:
        if collect_snapshot(db)['corpus_sha256'] != frozen['corpus_sha256']:
            raise ValueError('Database corpus changed since snapshot; use a new baseline directory.')
        for case in dataset['cases']:
            if case['id'] in done:
                continue
            row = SimpleNamespace(id=uuid5(NAMESPACE_URL, 'proctoowl-evaluation/' + case['id']), user_id=None,
                role=case['role'], category=case['selected_category'], topic=None, phase='DETAIL', summary={})
            with measure() as metrics:
                answer, sources, used = provider_answer(db, row, kb.redact(case['question']), SimpleNamespace(route='',error_code=None))
            actual = {'id':case['id'], 'question':case['question'], 'category':case['category'], 'gold':case,
                'answer':answer, 'phase':row.phase, 'selected_ids':[a['id'] for a in sources], 'sources':sources,
                'used_provider':used, 'provider_error':(row.summary.get('ai_error') or {}).get('code'),
                'metrics':metrics}
            actual['scores'] = score(case, actual, articles)
            data['records'].append(actual)
            persist(result_path, data)
            print(f"{case['id']} {row.phase} correctness={actual['scores']['correctness']} provider={used} error={actual['provider_error']} {metrics['latency_ms']:.0f}ms", flush=True)
    data['completed_at_utc'] = datetime.now(timezone.utc).isoformat()
    data['complete'] = len(data['records']) == len(dataset['cases'])
    persist(result_path,data)
    print(data['summary'])


if __name__ == '__main__':
    main()
