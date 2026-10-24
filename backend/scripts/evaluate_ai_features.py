"""Reproducible evaluation. Real provider calls require --live AND RUN_REAL_AI_TESTS=1.

Default: evaluate actual managed KB retrieval and summarize persisted application
reviews/sessions. Fixture AI runs are kept separate from application analytics.
"""
import argparse
import csv
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.database import SessionLocal
from app.api.v1.ai_management import summarize, bounds
from app.services import support_knowledge as kb
from app.services.ai_metrics import measure
from app.services.ai_provider import AIProviderError, provider_diagnostics
from app.services.question_document_extract import extract_document, DocumentError
from app.services.question_document_drafts import normalized_content
from app.services import question_document_drafts as storage
from app.services.question_generation import get_question_generation_provider
from app.services.support_assistant_provider import get_support_provider

SCENARIOS = [
    ('student', 'exams', 'Làm thế nào để vào kỳ thi?', 'student-2'),
    ('student', 'student-card', 'Tôi muốn xác thực thẻ sinh viên', 'student-1'),
    ('student', 'camera', 'Camera hoặc microphone không hoạt động', 'student-3'),
    ('student', 'results', 'Tôi muốn xem kết quả bài thi', 'student-5'),
    ('student', 'live-class', 'Tham gia lớp học trực tuyến như thế nào?', 'student-6'),
    ('teacher', 'exams', 'Tôi muốn tạo đề thi', 'teacher-2'),
    ('teacher', 'question-bank', 'Tạo câu hỏi từ Word PDF', 'teacher-1'),
    ('teacher', 'monitoring', 'giám sát', 'teacher-6'),
    ('teacher', 'grading', 'Xem điểm và kết quả đã lưu', 'teacher-grading'),
    ('teacher', 'reports', 'Xem điểm sinh viên và báo cáo', 'teacher-5'),
    ('teacher', 'live-class', 'Bắt đầu lớp học trực tuyến', 'teacher-7'),
]


def write_csv(path, rows):
    with path.open('w', encoding='utf-8-sig', newline='') as target:
        if rows:
            columns = list(dict.fromkeys(key for row in rows for key in row))
            writer = csv.DictWriter(target, fieldnames=columns)
            writer.writeheader(); writer.writerows(rows)


def fixture_summary(questions, support):
    return {'question': {'documents': len(questions), 'requests': len(questions),
        'structured_parse_success_rate': sum(r.get('structured_parse_success') is True for r in questions) / len(questions) if questions else None,
        **{key: sum(r.get(key, 0) or 0 for r in questions) for key in ('requested_questions', 'generated_questions', 'grounded_questions', 'questions_with_source', 'image_questions', 'provider_failure_count', 'retry_count')},
        'image_analysis_success': sum(r['image_analysis_success'] is True for r in questions),
        'image_analysis_samples': sum(r['image_analysis_success'] is not None for r in questions),
        'average_latency_ms': sum(r['latency_ms'] for r in questions) / len(questions) if questions else None},
        'support': {'scenarios': len(support), 'retrieval_hits': sum(r['retrieval_hit'] for r in support),
        'expected_article_selected': sum(r['expected_selected'] is True for r in support),
        'selection_samples': sum(r['expected_selected'] is not None for r in support),
        'kb_not_found_count': sum(r['kb_not_found'] for r in support),
        'provider_failure_count': sum(r['provider_failure_count'] for r in support),
        'average_response_latency_ms': sum(r['latency_ms'] for r in support) / len(support) if support and any(r['provider_attempts'] for r in support) else None,
        'resolved_by_ai_count': None, 'escalated_count': None, 'helpful_rate': None}}


def documents():
    from docx import Document
    from pypdf import PdfReader, PdfWriter
    from scripts.create_ai_review_fixture import TEXT, review_docx, review_pdf
    def word(table=False):
        doc = Document(); doc.add_heading('Network fundamentals', 1); doc.add_paragraph(TEXT)
        if table:
            t = doc.add_table(rows=3, cols=2)
            for row, values in zip(t.rows, [('Device', 'Function'), ('Switch', 'MAC forwarding'), ('Router', 'IP forwarding')]):
                for cell, value in zip(row.cells, values): cell.text = value
        stream = BytesIO(); doc.save(stream); return stream.getvalue()
    pdf = review_pdf(); writer = PdfWriter(); writer.add_page(PdfReader(BytesIO(pdf)).pages[0]); stream = BytesIO(); writer.write(stream)
    return [('text.docx', word(), False), ('table.docx', word(True), False), ('image.docx', review_docx(), True),
            ('text.pdf', stream.getvalue(), False), ('image.pdf', pdf, True)]


def evaluate_questions():
    results, reviewed_drafts = [], []
    previous_root = storage.DOCUMENT_ROOT
    try:
        with TemporaryDirectory() as root:
            storage.DOCUMENT_ROOT = Path(root)
            for filename, content, image_case in documents():
                extracted = extract_document(content, filename.rsplit('.', 1)[-1])
                session = storage.new_session(uuid4(), uuid4(), filename, extracted)
                sources = storage.generation_sources(session, session['chunks'])
                if image_case: sources = [next(s for s in sources if s.get('images') and s.get('question_key'))]
                else: sources = sources[:1]
                requested = 1 if image_case else 3
                requirements = {sources[0]['id']: requested}; output = []; failure = None
                with measure() as metrics:
                    try:
                        output = get_question_generation_provider().generate(sources=sources, requirements=requirements,
                            config={'question_type': 'mcq_single', 'difficulty': 'easy', 'topic': None}, excluded=[])
                    except DocumentError as exc: failure = exc.code
                source_map = {s['id']: s for s in sources}
                grounded = sum(d['source_chunk_id'] in source_map and normalized_content(d['source_excerpt']) in
                    normalized_content(source_map[d['source_chunk_id']].get('question_context') or source_map[d['source_chunk_id']]['text']) for d in output)
                image_pass = (bool(output) and all(d['images'] and 'IMAGE_REQUIRES_VISION' not in d.get('warning_codes', [])
                    and re.search(r'(?<!\d)3(?!\d)', ' '.join(d['answers'])) for d in output)) if image_case else None
                row = {**metrics, 'timestamp': datetime.now(timezone.utc).isoformat(), 'document_type': filename,
                    'requested_questions': requested, 'generated_questions': len(output), 'grounded_questions': grounded,
                    'questions_with_source': sum(bool(d.get('source_excerpt')) for d in output),
                    'image_questions': sum(bool(d.get('images')) for d in output), 'image_analysis_success': image_pass,
                    'provider_error': failure, 'accepted': None, 'edited': None, 'rejected': None}
                results.append(row)
                # Review artifact contains only validated course fixtures, never raw provider responses.
                reviewed_drafts.extend({'fixture': filename, 'draft': d, 'teacher_decision': None} for d in output)
                print(f"  {filename}: {len(output)}/{requested} drafts; status={failure or 'validated'}", flush=True)
    finally:
        storage.DOCUMENT_ROOT = previous_root
    return results, reviewed_drafts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--live', action='store_true'); parser.add_argument('--output', type=Path, default=Path('artifacts/ai-evaluation'))
    args = parser.parse_args()
    if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
    if args.live and os.getenv('RUN_REAL_AI_TESTS') != '1':
        parser.error('Real calls require RUN_REAL_AI_TESTS=1; omit --live for retrieval and DB reports only.')
    with SessionLocal() as db:
        since, until = bounds(None, None); observed = summarize(db, since, until)
        support = []
        for role, category, query, expected in SCENARIOS:
            articles = kb.retrieve(role, category, query, db=db)
            selected = None; error = None
            with measure() as metrics:
                if args.live and articles:
                    try: selected = get_support_provider().answer(role=role, category=category, query=query, sources=articles).article_ids
                    except AIProviderError as exc: error = exc.code
            support.append({**metrics, 'role': role, 'category': category, 'expected_article': expected,
                'retrieved_ids': [a['id'] for a in articles], 'retrieval_hit': expected in [a['id'] for a in articles],
                'selected_ids': selected, 'expected_selected': expected in selected if selected is not None else None,
                'kb_not_found': not articles, 'provider_error': error, 'resolved_by_ai': None, 'escalated': None})
    print('Question Generation\n-------------------')
    questions, review = evaluate_questions() if args.live else ([], [])
    print(f"Documents: {len(questions)}; Requests: {len(questions)}; Structured success: {sum(r.get('structured_parse_success') is True for r in questions)}/{len(questions)}")
    print(f"Provider failures: {sum(r['provider_failure_count'] for r in questions)}; Teacher reviewed samples (DB, last 7 days): {observed['question']['reviewed']}")
    if observed['question']['insufficient_reviewed_samples']: print('Insufficient reviewed samples')
    print(f"Observed application DB (last 7 days): requests={observed['question']['requests']}; accepted={observed['question']['accepted']}; edited={observed['question']['edited']}; rejected={observed['question']['rejected']}")
    print(f"Support\n-------\nScenarios: {len(support)}; Retrieval hits: {sum(r['retrieval_hit'] for r in support)}/{len(support)}; KB misses: {sum(r['kb_not_found'] for r in support)}")
    print(f"Provider failures: {sum(r['provider_failure_count'] for r in support)}; provider_called: {args.live}")
    print(f"Observed application DB (last 7 days): sessions={observed['support']['sessions']}; resolved={observed['support']['resolved_by_ai_count']}; escalated={observed['support']['escalated_count']}")
    if not args.live: print('Question generation and Support model evaluation: NOT RUN (opt-in required).')
    args.output.mkdir(parents=True, exist_ok=True)
    fixtures_path = args.output / 'documents'; fixtures_path.mkdir(exist_ok=True)
    for filename, content, _ in documents(): (fixtures_path / filename).write_bytes(content)
    report = {'run_at': datetime.now(timezone.utc).isoformat(), 'live': args.live, 'configuration': provider_diagnostics(),
        'fixture_summary': fixture_summary(questions, support),
        'fixture_questions': questions, 'fixture_support': support, 'observed_application_data': observed,
        'limitations': ['Source grounding checks mappings/excerpts, not semantic correctness.',
            'Image correctness uses a fixture answer key: exactly three PCs.', 'No teacher feedback is inferred from import or provider output.',
            'Support resolution is not simulated for fixture scenarios.']}
    (args.output / 'evaluation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    if args.live: (args.output / 'teacher-review.json').write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding='utf-8')
    for name, rows in [('question', questions), ('support', support)]:
        write_csv(args.output / f'{name}.csv', rows)
    print(f'Report directory: {args.output}')


if __name__ == '__main__': main()
