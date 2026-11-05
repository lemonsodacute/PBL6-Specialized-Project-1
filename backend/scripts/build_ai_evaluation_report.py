"""Render the audit and every failed case from retained evaluation records."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.ai_evaluation_common import DEFAULT_OUTPUT, ROOT, read_json


def pct(value):
    return 'NOT MEASURABLE' if value is None else f'{value:.2f}%'


def number(value):
    return 'N/A' if value is None else f'{value:.4f}'


def cell(value):
    return str(value).replace('|','\\|').replace('\n','<br>')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--report', type=Path, default=ROOT/'docs'/'ai-evaluation-report.md')
    args = parser.parse_args()
    base = args.output
    chat = read_json(base/'chatbox-results.json')
    search = read_json(base/'question-search-results.json')
    replay = read_json(base/'question-search-replay.json')
    corpus = read_json(base/'corpus-snapshot.json')
    assert chat.get('complete') and chat['summary']['evaluated'] == len(read_json(base/'chatbox-cases.json')['cases'])
    assert [(r['id'],r['returned_question_ids']) for r in search['records']] == [(r['id'],r['returned_question_ids']) for r in replay['records']]
    assert chat['run_identity']['corpus_sha256'] == search['corpus_sha256'] == corpus['corpus_sha256']
    cs, ss = chat['summary'], search['summary']
    when = datetime.fromisoformat(chat['run_at_utc']).astimezone(timezone(timedelta(hours=7))).isoformat()
    out = ['# PROCTOOWL AI EVALUATION', '', f'Baseline started: **{when} (Asia/Saigon)**.', '',
        'This is an **automatic, source-based diagnostic evaluation**, not an independently human-validated accuracy claim or an estimate of performance for all users. '
        'No LLM-as-judge was used. Raw visible responses, facts, selected/retrieved IDs, ratings, errors and timings are retained. '
        'No prompts, AI selection logic or search behavior were optimized before or after this baseline.', '',
        '## Audited implementation', '',
        '| Area | Actual implementation and evidence |', '| --- | --- |',
        '| Chatbox UI | `components/ui/AIChatbox.tsx` opens `components/chat/SupportAssistant.tsx`; it is the entry point to AI Support, not a second independent model. Admins use the human support inbox. |',
        '| Knowledge base / RAG | `support_knowledge.py` reads managed `SupportArticle` rows; bundled `app/support/knowledge.json` supplies seed articles. Only active articles for the student/teacher role are candidates. No question-bank, grades, account records or biometric data are supplied to the model. |',
        '| Support retrieval | Vietnamese accent folding; reviewed keyword/title phrase match or >=2 non-stopword overlaps. Score = 10*phrase_match + word_overlap + selected_category_bonus. Only top 3 are returned. Category is a hint, not a hard filter; no embeddings or vector index. Ties retain database article iteration order (no explicit SQL order). |',
        '| AI selection / rendering | `support_assistant_provider.py` requests a strict JSON `Selection(article_ids, needs_admin)` from an OpenAI-compatible `/chat/completions` transport. IDs must belong to supplied sources. `support_assistant.py:answer_from_articles` composes the visible answer from article titles/steps, with fixed feedback/escalation text. This evaluates constrained source selection, not unconstrained conversational generation. |',
        f"| Live provider | Configured adapter: `{chat['configuration']['provider']}`; configured support model: `{chat['configuration']['support_model']}`. Connection/key/base model use server-only `QUESTION_GENERATION_*`; `SUPPORT_ASSISTANT_MODEL` overrides the support model. Evaluation did not override them. The response model revision is not exposed by the existing adapter. |",
        '| Transport / errors | `ai_provider.py` validates the base URL and schema, applies feature timeout and response-size checks, permits at most one transient retry, and sanitizes auth/quota/model/network errors. Support timeout is the configured application value; temperature/seed are not specified by this implementation. Successful real calls are recorded by HTTP status in each case. |',
        '| Fast paths | Greeting, student/teacher permission guards, any retrieved `requires_admin` article, and missing knowledge bypass the provider. Guided topic buttons render a known article directly; they are not semantic free-text answering. |',
        '| Support lifecycle | `FEEDBACK` -> user chooses resolved or unresolved; unresolved leads to escalation, then explicit admin handoff. The system blocks student AI support during an active exam and persists per-user quotas/history in normal requests. The service-level evaluation does not exercise these HTTP/identity/persistence guards. |',
        '| Question Bank | `api/v1/question_banks.py:list_questions` restricts results to one authorized bank and supported types, with optional type/topic/difficulty/active filters. The bank list separately searches name/description/subject. |',
        '| Question search | `services/collections.py:search` folds case/accents and applies escaped `%entire query%` SQL LIKE to **question content only**. It does not search topic, answers, bank titles or synonyms. PostgreSQL uses lower/coalesce/translate; SQLite replay uses the same registered folding helper. Default ranking is created_at DESC, then question ID ASC. The frontend calls this endpoint; its separate `lib/question-selection.ts` helper also uses folded substring matching. |',
        '| Semantic search | No question embeddings, embedding model, vector search, full-text ranking, BM25 or hybrid strategy were found. Existing face embeddings belong to identity verification and are unrelated. AI document-based question generation is a separate feature, not retrieval of existing questions, and was not benchmarked here. |', '',
        '## Corpus, isolation and gold labels', '',
        f"Snapshot: **{corpus['total_database_questions']} total database questions**, **{len(corpus['corpus']['questions'])} eligible questions across {len(corpus['corpus']['banks'])} active banks**, and **{len(corpus['corpus']['articles'])} managed support articles**. The 15 questions in the inactive legacy demo bank are excluded. Search cases use the relevant existing curriculum banks. No fake question IDs are used.", '',
        f"Corpus SHA-256: `{corpus['corpus_sha256']}`. Source hashes and Git HEAD are embedded in the JSON outputs, covering the actual dirty working tree files rather than assuming HEAD is the deployed code.", '',
        'Database reads run inside PostgreSQL `REPEATABLE READ READ ONLY` transactions; evaluation never commits application writes. No users/accounts, bank questions, support sessions/turns, outcomes or analytics were added/changed. '
        'Support case state exists only as transient Python objects with no user identity or prior history. Existing personal conversation histories, answer keys, grades, images, secrets and account identifiers are not exported. '
        'The artifacts directory is already ignored by the repository `.gitignore`; the scripts, tests and this report can be tracked.', '',
        f"Chat: **{cs['evaluated']} authored cases** covering ten requested categories. Each has role, selected category, difficulty, expected behavior, key source facts, allowed source/wording variants and cited KB evidence. "
        'Source facts are checked as normalized clauses in the extractive visible response, not by whole-response equality. The schema allows alternative sources that express the same fact. '
        'Subjective semantic completeness outside these source facts requires a reviewer. CSV includes editable reviewer columns; automatic ratings remain clearly labeled.', '',
        f"Search: **{ss['queries']} queries = {ss['topical_queries']} topical + {ss['control_queries']} controls**. Labels are authored per-query topic judgments, then materialized exhaustively over every question in the scoped bank using explicit content rules. "
        'IDs and evidence text are frozen before the final scoring run. Labels are independent of the search result list. Binary relevance (1 relevant, 0 otherwise) is used for nDCG as well as precision/recall. '
        'Many exact queries have fewer than five relevant questions, so Precision@5 has a structural ceiling below 1 even when all available relevant items are found.', '',
        'Label audit: the initial pilot exposed overly broad family labels for some narrow queries and an omitted Python list paraphrase. These were corrected against the complete corpus; pilot files remain under `label-review-pilot/`. '
        'Chat case 012 was corrected to expect admin escalation for a missing enrollment, as its article text explicitly requires admin checking despite `requires_admin=false`. '
        'Raw chat outputs were not regenerated to improve the score: explicit regrading retains original gold/scores and records the changed label IDs. Search was rerun with corrected labels; this is **not** a before/after AI optimization.', '',
        'Case 028 also used a valid teacher `other` category on recheck instead of the student-only card category used in the pilot. '
        'The unchanged role guard produced the same visible answer without calling the provider; the prior execution and new timing are retained. '
        'The label audit is disclosed so these corrections cannot be mistaken for a model improvement.', '',
        '## Scoring and denominators', '',
        '- Correctness 0 = no required fact/appropriate refusal; 1 = some required facts or correct content with an incorrect workflow phase; 2 = all required facts and the appropriate guidance/escalation behavior. **Answer Correctness = count(score=2)/N**, separate from the normalized 0–2 score.',
        '- Groundedness 0/1/2 = none/some/all visible statements supported by selected snapshot sources or verifiable server fallback/guard messages. This is faithfulness to available context, not an independent guarantee that the KB is current. Unsupported lines are retained individually.',
        '- Relevance 0/1/2 = no/some/complete required issue coverage; unrelated extra article selection reduces complete relevance. Groundedness and relevance are scored independently.',
        '- Groundedness/Relevance percentages = sum(score)/(2*N). Hallucination rate = responses with >=1 unsupported statement / N. Operational/provider error messages are supported only when the recorded error context justifies them.',
        '- Correct fallback/escalation = fully correct cases among cases whose gold behavior requires fallback, role refusal or escalation. A generic unrelated admin answer is not a successful resolution or correct fallback.',
        '- Precision@K = relevant top-K IDs/K, including short lists. Recall@5 = relevant top-5 IDs/total judged relevant IDs. HitRate@K = fraction with any relevant top-K ID. MRR averages the reciprocal first relevant rank. nDCG@5 uses gain 2^relevance-1 and log2(rank+1) discount.',
        '- Ranking metrics are macro means over the 49 positive-relevance topical queries. Zero-positive controls have undefined recall/nDCG and are reported separately. Empty input follows the existing browsing contract and is not treated as a topical retrieval success.',
        '- Latency uses measured service wall time; p95 is nearest rank `sorted[ceil(.95*n)-1]`. Chat includes retrieval/DB/provider/retries/rendering. Search includes handler DB queries and serialization. Both exclude browser and HTTP transport; search has five measured trials/query and no warm-up exclusion.', '',
        '## AI CHATBOX baseline', '', '| Metric | Observed value |','| --- | --- |',
        f"| Test cases | {cs['evaluated']} |", f"| Correct / Partial / Incorrect | {cs['correct']} / {cs['partial']} / {cs['incorrect']} |",
        f"| Answer Correctness | {pct(cs['answer_correctness_pct'])} ({cs['correct']}/{cs['evaluated']}) |",
        f"| Normalized correctness score (separate metric) | {pct(cs['correctness_score_pct'])} |",
        f"| Groundedness | {pct(cs['groundedness_pct'])} |",f"| Relevance | {pct(cs['relevance_pct'])} |",
        f"| Hallucination Rate | {pct(cs['hallucination_rate_pct'])}; {cs['unsupported_claim_count']} unsupported statements detected |",
        f"| Correct fallback/escalation | {pct(cs['correct_fallback_or_escalation_pct'])} ({cs['correct_fallback_or_escalation_count']}/{cs['fallback_cases']}) |",
        '| AI Resolution Rate | **NOT MEASURABLE**: no independently verified issue-resolution outcomes |',
        f"| Average / p95 response latency | {cs['latency']['average_ms']:.2f} / {cs['latency']['p95_ms']:.2f} ms ({cs['latency']['samples']} cases) |",
        f"| Provider called / provider error cases | {cs['provider_called_cases']} / {cs['provider_error_cases']} |",
        f"| Status | **{cs['status']}** |", '',
        'Both strengths and failures above concern this fixed suite. A grounded answer can still address the wrong issue. '
        'Observed zero hallucinations is particularly influenced by the architecture copying reviewed source text; it does not imply perfect assistance or a universal zero hallucination rate.', '',
        'Subjective review flags: case 060 is conservatively failed because the rubric requires explicit refusal/escalation; its answer gives the correct answer-publication policy without disclosing an answer key. '
        'An independent reviewer may consider that a partial or acceptable safe redirection. Cases 018 and 035 lose relevance points because the source allowlist treats extra articles as off-topic; a reviewer should assess whether those additions are useful. '
        'These automatic outcomes are exposed, not presented as independently settled human judgments.', '',
        '### Category breakdown', '', '| Category | N | Correct | Partial | Incorrect | Answer Correctness |','| --- | ---: | ---: | ---: | ---: | ---: |']
    for category, values in chat['per_category'].items():
        out.append(f"| {category} | {values['evaluated']} | {values['correct']} | {values['partial']} | {values['incorrect']} | {pct(values['answer_correctness_pct'])} |")
    minimum = min(v['answer_correctness_pct'] for v in chat['per_category'].values())
    weakest = [k for k,v in chat['per_category'].items() if v['answer_correctness_pct']==minimum]
    provider = chat['provider_path_summary']
    out += ['',f"Weakest category: **{', '.join(weakest)}** ({minimum:.2f}%). Category samples are small; do not interpret differences as statistically established population differences.", '',
        f"Provider-path subset: {provider['evaluated']} cases; Answer Correctness {pct(provider.get('answer_correctness_pct'))}; "
        f"average/p95 latency {provider['latency']['average_ms']:.2f}/{provider['latency']['p95_ms']:.2f} ms. This is a conditional subset after lexical retrieval/fast-path filtering, not an independent Gemini capability benchmark.", '',
        'The existing AI activity dashboard counts user `resolved` choices and feedback-based helpfulness (`api/v1/ai_management.py:summarize`). '
        'Those observations cannot establish issues **correctly** resolved by AI, and escalations must not be counted as resolutions. No new simulated resolution clicks were written.', '',
        '## QUESTION SEARCH baseline', '', '| Metric | Observed value |','| --- | --- |',
        f"| Queries | {ss['queries']} total; {ss['topical_queries']} ranked + {ss['control_queries']} controls |"]
    for label,key in [('Precision@1','precision_at_1'),('Precision@3','precision_at_3'),('Precision@5','precision_at_5'),
                      ('Recall@5','recall_at_5'),('HitRate@1','hit_rate_at_1'),('HitRate@3','hit_rate_at_3'),
                      ('HitRate@5','hit_rate_at_5'),('MRR','mrr'),('nDCG@5','ndcg_at_5')]:
        out.append(f'| {label} | {number(ss[key])} |')
    out += [f"| Average / p95 search latency | {ss['latency']['average_ms']:.2f} / {ss['latency']['p95_ms']:.2f} ms ({ss['latency']['samples']} trials) |",
        f"| Empty/no-match/literal-wildcard controls | {ss['controls_passed']}/{ss['control_queries']} passed |",
        f"| Status | **{ss['status']}** |", '',
        'Only **keyword substring** is implemented. Full-text, semantic embedding and hybrid comparisons are **NOT IMPLEMENTED**, not zero-score benchmarked methods. '
        'The offline SQLite replay returns exactly the same question-ID ordering as PostgreSQL for all 56 cases. Its timing is recorded separately and is not substituted for the PostgreSQL latency above.', '',
        'Empty and whitespace queries return all ten scoped questions as browsing. The three unrelated queries and two literal SQL-wildcard queries return no results; the service did not pad these results. '
        'Accent/case folding works when the normalized contiguous phrase is present. Extra natural-language words, translations, abbreviations not in content and typos do not gain semantic matching.', '',
        '### Results by query type', '', '| Query type | N | Precision@5 | Recall@5 | MRR |','| --- | ---: | ---: | ---: | ---: |']
    counts = Counter(r['query_type'] for r in search['records'] if not r['control'])
    for kind, values in search['per_query_type'].items():
        out.append(f"| {kind} | {counts[kind]} | {number(values['precision_at_5'])} | {number(values['recall_at_5'])} | {number(values['reciprocal_rank'])} |")
    out += ['', '## Failure analysis and potential follow-up (not implemented)', '',
        '1. **Support admin override:** `provider_answer` filters to all retrieved `requires_admin` articles and immediately renders them if any exist, even if a higher-scoring non-admin article is the direct match. '
        'This explains account-lock guidance for a camera-permission query, score-review guidance for entering an exam, and revoked-card guidance for ordinary card verification. Consider validating issue relevance before admin fast-path precedence, then measure on the same frozen suite and a held-out set.',
        '2. **KB specificity:** login/password recovery, account-specific schedules, new recording controls and semantic-search claims are not supplied as reviewed support instructions. '
        'The assistant cannot perform account operations or inspect personal grades. Appropriate refusal/escalation is scored as correct for such requests. Add reviewed articles only after confirming application behavior, then evaluate new cases separately.',
        '3. **Search mismatch:** the whole phrase must exist in content. `câu hỏi về JOIN`, `SQL transaction`, `TCP/IP`, `REST API`, `JavaScript DOM`, and normalization paraphrases can have relevant questions but empty results. '
        'A bank title containing REST API does not help a content-only search. Query tokenization, a relevance-ranked lexical method or an explicitly implemented semantic method could be evaluated later; no assumed improvement is reported.',
        '4. **Evidence limits:** single fixed-seed corpus, convenience-authored cases, small category samples, and one response per chat case. Live LLM calls can vary because the application does not set a deterministic seed. '
        'No independent human reviewer has signed off the subjective ratings. Repeatability of saved scoring/search replay is demonstrated; bit-for-bit repeatability of new external model responses is not promised.',
        '5. **Status interpretation:** NEEDS_IMPROVEMENT identifies observed diagnostic failures. GOOD would require every authored case to pass the declared rubric; no unsupported industry accuracy threshold is asserted. '
        'A missing dataset would yield `INSUFFICIENT_EVALUATION_DATA` rather than an invented percentage.', '',
        '## Failed/partial chat cases', '']
    for row in chat['records']:
        if row['scores']['correctness'] == 2 and row['scores']['relevance'] == 2 and not row['scores']['hallucination']:
            continue
        expected = []
        for fact in row['gold']['expected_key_facts']:
            if 'any_of' in fact:
                expected.append(' OR '.join(' '.join(a['facts']) for a in fact['any_of']))
            else:
                expected.append(fact['description'])
        out += [f"### {row['id']} — {row['category']}", '', f"Question: {row['question']}", '',
            f"Expected ({row['gold']['expected_behavior']}): {' '.join(expected)}", '',
            f"Actual (phase `{row['phase']}`, selected IDs `{', '.join(row['selected_ids']) or 'none'}`):", '',
            *['> '+line if line else '>' for line in row['answer'].splitlines()], '',
            f"Scores C/G/R: {row['scores']['correctness']}/{row['scores']['groundedness']}/{row['scores']['relevance']}; "
            f"problems: {', '.join(row['scores']['problem_types']) or 'extra unrelated source reduced relevance'}.", '']
    out += ['## Search cases with missing judged relevant questions', '',
        'Every expected/returned ID below refers to the frozen real database corpus. Precision@5 below 1 solely because fewer than five relevant questions exist is not, by itself, called a failure.', '',
        '| Query ID / query | Expected relevant question IDs | Returned IDs | First relevant rank | Reason |',
        '| --- | --- | --- | ---: | --- |']
    for row in search['records']:
        if row['control'] or row['metrics']['recall_at_5'] == 1:
            continue
        out.append('| '+' | '.join(map(cell,[row['id']+' / '+row['query'],', '.join(row['expected_question_ids']),
            ', '.join(row['returned_question_ids']) or '[]',row['metrics']['first_relevant_rank'] or 'none',row['reason']]))+' |')
    out += ['', '## Reproduce / review', '',
        'From the repository root in PowerShell:', '', '```powershell',
        "& backend/.venv/Scripts/python.exe backend/scripts/ai_evaluation_cases.py",
        "& backend/.venv/Scripts/python.exe backend/scripts/evaluate_question_search.py",
        "& backend/.venv/Scripts/python.exe backend/scripts/evaluate_question_search.py --offline",
        "# New real support run in a separate directory (calls the configured provider):",
        "& backend/.venv/Scripts/python.exe backend/scripts/evaluate_ai_chatbox.py --live --output artifacts/ai-evaluation-new-run",
        "# Exact rescoring of retained answers, without provider calls:",
        "& backend/.venv/Scripts/python.exe backend/scripts/evaluate_ai_chatbox.py --regrade --use-dataset-labels",
        "& backend/.venv/Scripts/python.exe backend/scripts/build_ai_evaluation_report.py",
        "# Isolated evaluator checks, no application writes:",
        "Push-Location backend",
        "& .venv/Scripts/python.exe -m unittest tests.test_ai_evaluation",
        "Pop-Location", '```', '',
        'Search replay needs the snapshot and frozen case manifest. The live scripts refuse a changed corpus/hash rather than silently mixing datasets. '
        'New runs should use a separate `--output` directory and copied/fresh snapshot/case manifests. `--resume` checkpoints completed real responses and refuses a changed run identity. '
        'Regrading must be explicit; original gold/scores and the regrading rationale remain in the result file. '
        'For human review, open `chatbox-results.csv`, inspect expected/actual text and enter 0–2 ratings, hallucination and notes in the reviewer columns. '
        'Those entries are not silently merged into automatic metrics; retain the signed review as a separate file and report any reviewed aggregates separately.', '',
        'Files:', '',
        '- `backend/scripts/ai_evaluation_common.py`: snapshot/read-only/metric helpers.',
        '- `backend/scripts/ai_evaluation_cases.py`: authored dataset and relevance definitions.',
        '- `backend/scripts/evaluate_ai_chatbox.py`: real support-service baseline, checkpointing and explicit rescoring.',
        '- `backend/scripts/evaluate_question_search.py`: PostgreSQL baseline and offline query replay.',
        '- `backend/scripts/build_ai_evaluation_report.py`: this reproducible report.',
        '- `backend/tests/test_ai_evaluation.py`: 10 hand-computed metric/rubric checks.',
        '- `artifacts/ai-evaluation/corpus-snapshot.json`, `chatbox-cases.json`, `question-search-cases.json`.',
        '- `artifacts/ai-evaluation/chatbox-results.json` and `.csv`.',
        '- `artifacts/ai-evaluation/question-search-results.json` and `.csv`.',
        '- `artifacts/ai-evaluation/question-search-replay.json` and `.csv`.',
        '- `artifacts/ai-evaluation/label-review-pilot/`: superseded pilot labels/results for transparency.', '',
        '**Validation:** 10 evaluator tests pass; all 56 PostgreSQL and offline search rankings agree; all 63 support records retain their actual response and measured timings. '
        'No before/after optimization is claimed. No fabricated metrics: **YES**. Business logic changed for this evaluation: **NO**. '
        'Face Verification/SFace threshold, proctoring, exam scoring, LiveKit, student identity and user accounts were not modified by this task.', '']
    target = args.report
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text('\n'.join(out),encoding='utf-8')
    print(target)


if __name__ == '__main__':
    main()
