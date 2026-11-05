"""Evaluate the actual per-bank substring search; no semantic method is invented.

Default measures the unchanged endpoint handler against read-only PostgreSQL.
--offline replays the production search/order query helpers on the frozen corpus
in an in-memory SQLite database; its timing is not PostgreSQL/service latency.
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import sys
from time import perf_counter
from types import SimpleNamespace
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.ai_evaluation_common import (DEFAULT_OUTPUT, collect_snapshot, digest, latency_summary,
    mean_metrics, provenance, read_json, readonly_session, require_legacy_evaluation_schema, retrieval_metrics, snapshot, write_csv, write_json)

METRICS = ['precision_at_1','precision_at_3','precision_at_5','recall_at_5',
           'hit_rate_at_1','hit_rate_at_3','hit_rate_at_5','reciprocal_rank','ndcg_at_5']


def offline_search(frozen):
    from sqlalchemy import create_engine, Table, Column, MetaData, String, select
    from app.services.collections import search, ordered
    engine = create_engine('sqlite:///:memory:')
    metadata = MetaData()
    table = Table('evaluation_questions', metadata, *(Column(k,String,primary_key=k=='id')
                  for k in ('id','bank_id','content','created_at')))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(table.insert(),[{k:q[k] for k in ('id','bank_id','content','created_at')}
                                          for q in frozen['corpus']['questions']])
    def run(case):
        query = search(select(table.c.id).where(table.c.bank_id == case['bank_id']),case['query'],table.c.content)
        query = ordered(query,'newest',{'newest':table.c.created_at.desc()},table.c.id)
        with engine.connect() as connection:
            return list(connection.scalars(query))
    return engine, run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=DEFAULT_OUTPUT)
    parser.add_argument('--offline',action='store_true')
    parser.add_argument('--repeats',type=int,default=5)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 30:
        parser.error('--repeats must be between 1 and 30')
    frozen = snapshot(args.output)
    cases_path = args.output / 'question-search-cases.json'
    if not cases_path.exists():
        from scripts.ai_evaluation_cases import build_search_cases
        cases = build_search_cases(frozen)
        write_json(cases_path,{'corpus_sha256':frozen['corpus_sha256'],'cases_sha256':digest(cases),'cases':cases})
    dataset = read_json(cases_path)
    require_legacy_evaluation_schema(dataset)
    if dataset['corpus_sha256'] != frozen['corpus_sha256'] or digest(dataset['cases']) != dataset['cases_sha256']:
        raise ValueError('Dataset checksum/corpus mismatch.')
    known = {q['id']:q for q in frozen['corpus']['questions']}
    for case in dataset['cases']:
        for qid in case['relevance']:
            if qid not in known or known[qid]['bank_id'] != case['bank_id']:
                raise ValueError('A relevance label does not refer to a real question in the scoped bank.')
    engine = db = None
    if args.offline:
        engine, run = offline_search(frozen)
    else:
        from app.api.v1.question_banks import list_questions
        from app.models.entities import UserRole
        from app.schemas.collections import CollectionParams
        db = readonly_session()
        if collect_snapshot(db)['corpus_sha256'] != frozen['corpus_sha256']:
            db.close()
            raise ValueError('Database corpus changed since baseline snapshot; create a new baseline directory.')
        def run(case):
            result = list_questions(bank_id=UUID(case['bank_id']),type=None,topic=None,difficulty=None,
                params=CollectionParams(q=case['query'],page=1,limit=100,sort='newest'),is_active=None,
                db=db,user=SimpleNamespace(role=UserRole.admin,id=None))
            return [str(q['id']) for q in result['data']]
    records = []
    try:
        for case in dataset['cases']:
            timings = []
            returned = None
            for _ in range(args.repeats):
                start = perf_counter()
                ids = run(case)
                timings.append((perf_counter()-start)*1000)
                if returned is not None and ids != returned:
                    raise RuntimeError('Ranking changed between repeat measurements.')
                returned = ids
            metrics = retrieval_metrics(returned,case['relevance'])
            if case['control']:
                expected = case['judged_corpus_size'] if 'browse' in case['control'] else 0
                control_pass = len(returned) == expected
                reason = 'Empty search deliberately uses unfiltered bank browsing.' if 'browse' in case['control'] else (
                    'No unrelated filler results.' if control_pass else 'Unexpected non-empty results for no-match/literal input.')
            else:
                control_pass = None
                first = metrics['first_relevant_rank']
                if first is None:
                    reason = 'The entire normalized query must be a contiguous content substring; paraphrases, extra words, synonyms and typos are not expanded.'
                elif metrics['recall_at_5'] < 1:
                    reason = 'Some judged topic-relevant content does not contain the exact normalized phrase.'
                elif metrics['precision_at_5'] < 1:
                    reason = 'Fewer than five relevant results exist/are returned; Precision@5 denominator remains five.'
                else:
                    reason = None
            records.append({'id':case['id'],'query':case['query'],'query_type':case['query_type'],
                'bank_id':case['bank_id'],'bank_name':case['bank_name'],'control':case['control'],
                'relevance':case['relevance'],'expected_question_ids':sorted(case['relevance']),
                'returned_question_ids':returned,'top_5':[{'id':qid,'content':known[qid]['content'],
                    'relevance':case['relevance'].get(qid,0)} for qid in returned[:5]],
                'metrics':metrics,'latency_ms':timings,'control_pass':control_pass,'reason':reason})
    finally:
        if db is not None: db.close()
        if engine is not None: engine.dispose()
    topical = [r for r in records if not r['control']]
    controls = [r for r in records if r['control']]
    aggregate = mean_metrics([r['metrics'] for r in topical],METRICS)
    aggregate['mrr'] = aggregate.pop('reciprocal_rank')
    aggregate.update(queries=len(records),topical_queries=len(topical),control_queries=len(controls),
        controls_passed=sum(r['control_pass'] for r in controls),
        latency=latency_summary([t for r in records for t in r['latency_ms']]),
        topical_latency=latency_summary([t for r in topical for t in r['latency_ms']]),
        status='NEEDS_IMPROVEMENT' if any(r['metrics']['recall_at_5'] < 1 for r in topical) else 'GOOD')
    data = {'schema_version':1,'run_at_utc':datetime.now(timezone.utc).isoformat(),
        'provenance':provenance(['backend/app/api/v1/question_banks.py','backend/app/services/collections.py','lib/question-selection.ts']),
        'corpus_sha256':frozen['corpus_sha256'],'cases_sha256':dataset['cases_sha256'],
        'strategy':'accent-insensitive contiguous substring, newest timestamp then ascending question ID',
        'available_strategies':{'keyword_substring':'IMPLEMENTED','full_text':'NOT_IMPLEMENTED',
            'semantic_embedding':'NOT_IMPLEMENTED','hybrid':'NOT_IMPLEMENTED','embedding_model':None},
        'execution':'frozen in-memory SQLite replay of production query helpers' if args.offline else 'unchanged endpoint handler, read-only PostgreSQL, admin view scoped to each bank; no HTTP/auth latency',
        'repeats':args.repeats,'summary':aggregate,
        'aggregation':'Macro mean over topical queries with >=1 judged relevant ID. Controls are excluded from ranking metrics and reported separately. Precision denominator is K, even for <K results.',
        'relevance':'Binary authored topic labels, exhaustive within each selected bank; nDCG uses binary gains. MRR uses all returned ranks (banks have <=100 questions).',
        'status_rule':'NEEDS_IMPROVEMENT when any authored topical query misses a judged relevant item in the top five; diagnostic suite, no universal product-quality threshold.',
        'per_query_type':{kind:mean_metrics([r['metrics'] for r in topical if r['query_type']==kind],METRICS)
                          for kind in sorted({r['query_type'] for r in topical})},
        'records':records}
    filename = 'question-search-replay.json' if args.offline else 'question-search-results.json'
    write_json(args.output / filename,data)
    write_csv((args.output / filename).with_suffix('.csv'),[dict(id=r['id'],query=r['query'],
        bank_id=r['bank_id'],expected_question_ids=r['expected_question_ids'],returned_question_ids=r['returned_question_ids'],
        **r['metrics'],average_latency_ms=sum(r['latency_ms'])/len(r['latency_ms']),reason=r['reason']) for r in records])
    print(aggregate)


if __name__ == '__main__':
    main()
