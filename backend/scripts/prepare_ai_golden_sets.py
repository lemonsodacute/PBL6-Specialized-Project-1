"""Prepare user-requested golden sets for HUMAN review, without running AI or scoring.

Database IDs come only from a checksummed, read-only PostgreSQL snapshot. Rules
below propose judgments from corpus content, independently of search rankings.
They are deliberately inspectable proposals, not approved ground truth.
"""
import argparse
from collections import Counter
from copy import deepcopy
import hashlib
from pathlib import Path
import re
import sys
import unicodedata

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.ai_evaluation_common import DEFAULT_OUTPUT, ROOT, digest, read_json, snapshot, write_csv, write_json

SPECS = ROOT / 'backend/evaluation/golden_sets'
DEFAULT_REVIEW = DEFAULT_OUTPUT / 'golden-sets-v2'
PENDING = 'NEEDS_HUMAN_REVIEW'


def fold(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower().replace('đ', 'd'))
                   if not unicodedata.combining(c))


# A bank filter is required for ambiguous terms (e.g. database normalization vs
# ML feature normalization). Broad subject queries deliberately use whole banks.
SQL = ['SQL và truy vấn quan hệ', 'Transaction và thiết kế dữ liệu']
WEB = ['HTML và CSS nền tảng', 'JavaScript và REST API']
NETWORK = ['TCP/IP và dịch vụ mạng', 'Routing, VLAN và vận hành', 'Thi giữa kỳ Quản trị mạng']
SECURITY = ['Xác thực và phân quyền', 'Mật mã và bảo mật Web']


def rule(title, banks=(), high=(), related=(), whole_bank=False):
    return dict(title=title, banks=list(banks), high=list(high), related=list(related), whole_bank=whole_bank)


RULES = {
    'sql': rule('SQL và truy vấn quan hệ', SQL, [r'\bsql\b', r'\bselect\b', r'\bjoin\b', r'\border by\b', r'\bhaving\b', r'\bcount\b', 'truy van', 'gom nhom'], ['transaction', 'rollback', 'acid']),
    'transaction': rule('Giao dịch cơ sở dữ liệu', (), ['transaction', 'rollback', 'commit', 'atomicity', r'\bacid\b']),
    'join': rule('Kết nối dữ liệu nhiều bảng / JOIN', SQL, [r'\bjoin\b', 'dem so sinh vien theo lop'], ['nhieu-nhieu']),
    'rest': rule('REST API và request trình duyệt/backend', (), [r'http (get|put)', 'ma http', 'endpoint phan trang', 'request luu bai'], ['api contract', 'idempotent', 'csrf']),
    'tcp': rule('TCP/IP', NETWORK, [r'\btcp\b', r'\bipv4\b', r'\bip\b', 'subnet', 'gateway'], [r'\budp\b', r'\barp\b']),
    'vlan': rule('Phân chia mạng logic bằng VLAN', NETWORK, [r'\bvlan\b'], ['trunk 802.1q']),
    'authentication': rule('Xác thực người dùng', SECURITY, ['authentication', r'\bmfa\b'], ['mat khau', r'\bjwt\b']),
    'javascript': rule('Ngôn ngữ JavaScript', ['JavaScript và REST API'], ['javascript', 'promise', 'preventdefault', 'react']),
    'dom': rule('JavaScript tương tác HTML / DOM', ['JavaScript và REST API'], ['preventdefault'], ['render danh sach react']),
    'normalization': rule('Chuẩn hóa cơ sở dữ liệu', SQL, ['chuan hoa du lieu']),
    'database': rule('Cơ sở dữ liệu quan hệ', SQL, whole_bank=True),
    'http': rule('HTTP / HTTPS', (), [r'\bhttps?\b'], ['rest api', 'request luu bai']),
    'routing': rule('Định tuyến và chọn đường mạng', NETWORK, ['router chuyen tiep', 'default gateway', 'tuyen ngam dinh', 'cost.*ospf', 'ospf.*cost'], ['ospf', 'router', 'dinh tuyen giua vlan']),
    'access': rule('Kiểm soát truy cập / phân quyền', SECURITY, ['authorization', 'least privilege', 'kiem tra role', 'kiem tra quyen', 'idor']),
    'crypto': rule('Mật mã học', SECURITY, ['ham bam mat ma', 'https bao ve', 'jwt.*bi mat'], ['mat khau', 'khoa bi mat']),
    'atomicity': rule('SQL Atomicity / toàn bộ hoặc không gì', (), ['atomicity'], ['transaction chuyen tien', 'rollback']),
    'encryption': rule('Mã hóa dữ liệu', (), ['https.*bao ve', 'jwt.*bi mat'], ['ham bam mat ma']),
    'async': rule('JavaScript bất đồng bộ', ['JavaScript và REST API'], ['promise']),
    'web': rule('Lập trình Web', WEB, whole_bank=True),
    'network': rule('Mạng máy tính', NETWORK, whole_bank=True),
    'security': rule('An toàn thông tin', SECURITY, whole_bank=True),
    'rollback': rule('Rollback khi giao dịch lỗi', (), ['rollback'], ['atomicity', 'transaction boundary']),
    'http_update': rule('HTTP method cập nhật tài nguyên', (), ['http put'], ['http get']),
    'api_auth': rule('Xác thực REST API', SECURITY, [], ['authentication', r'\bjwt\b', 'endpoint quan tri']),
    'events': rule('JavaScript event listener', ['JavaScript và REST API'], [], ['preventdefault']),
    'trunk': rule('VLAN trunk', NETWORK, ['trunk 802.1q'], [r'\bvlan\b']),
    'handshake': rule('TCP handshake', NETWORK, ['handshake'], ['tcp cung cap']),
    'auth_access': rule('Xác thực người dùng và phân quyền', SECURITY, ['authentication', 'authorization', 'kiem tra quyen', 'kiem tra role', 'least privilege', 'idor', r'\bmfa\b'], [r'\bjwt\b', 'mat khau']),
    'web_security': rule('Bảo mật ứng dụng Web', SECURITY, ['xss', 'csrf', 'sql injection', 'httponly', 'https', 'upload anh', 'idor', 'kiem tra quyen', 'kiem tra role'], ['jwt', 'mat khau', 'khoa bi mat']),
    'acid': rule('Thuộc tính ACID của transaction', (), [r'\bacid\b', 'atomicity'], ['transaction chuyen tien', 'rollback']),
    'negative': rule('Chủ đề ngoài corpus; cần người review xác nhận không có câu phù hợp'),
}


def propose(case, corpus):
    """Return stable corpus-order proposals, never the system's ranked results."""
    spec = RULES[case['intent']]
    banks = {b['id']: b for b in corpus['banks']}
    candidates = []
    for question in corpus['questions']:
        bank = banks[question['bank_id']]
        if spec['banks'] and bank['name'] not in spec['banks']:
            continue
        content = fold(question['content'])
        high = [p for p in spec['high'] if re.search(p, content)]
        related = [p for p in spec['related'] if re.search(p, content)]
        grade = 2 if high or spec['whole_bank'] else 1 if related else 0
        if grade:
            candidates.append(dict(question_id=question['id'], bank_id=bank['id'], bank_name=bank['name'],
                content=question['content'], proposed_grade=grade,
                rationale='Broad subject query: bank membership' if spec['whole_bank'] else
                          'Content markers: ' + ', '.join(high or related)))
    return candidates


def build(frozen):
    chat = deepcopy(read_json(SPECS / 'chatbox.json')['cases'])
    search = deepcopy(read_json(SPECS / 'question-search.json')['cases'])
    for case in list(search):
        if 'accented_query' in case:
            pair = deepcopy(case)
            pair['id'] += '-ACCENTED'
            pair['query'] = pair.pop('accented_query')
            pair['paired_case_id'] = case['id']
            pair['source'] = 'accented_comparison'
            case['paired_case_id'] = pair['id']
            search.append(pair)
    for case in search:
        case['intent_key'] = case['intent']
        candidates = propose(case, frozen['corpus'])
        case['intent'] = RULES[case['intent_key']]['title']
        case['relevant_question_ids'] = [c['question_id'] for c in candidates]
        case['highly_relevant_question_ids'] = [c['question_id'] for c in candidates if c['proposed_grade'] == 2]
        case['candidate_questions'] = candidates
        case['candidate_status'] = ('HAS_DIRECT_CANDIDATES' if case['highly_relevant_question_ids'] else
                                    'RELATED_ONLY' if candidates else 'NO_CANDIDATE_MATCHES')
        case['negative_expectation'] = 'PENDING_CORPUS_REVIEW' if case['set_id'] == 13 else None
        case['search_scope'] = 'CORPUS_REVIEW_ONLY; production search is bank-scoped'
        case['bank_contexts'] = [dict(bank_id=bank_id,
            relevant_question_ids=[c['question_id'] for c in candidates if c['bank_id'] == bank_id],
            highly_relevant_question_ids=[c['question_id'] for c in candidates if c['bank_id'] == bank_id and c['proposed_grade'] == 2])
            for bank_id in sorted({c['bank_id'] for c in candidates})]
    common = dict(schema_version=2, review_status=PENDING, corpus_sha256=frozen['corpus_sha256'],
                  evaluation_status='NOT_RUN', labeling='Draft content-rule proposals; all require independent human review.')
    return ({**common, 'dataset_kind':'chatbox', 'cases':chat, 'cases_sha256':digest(chat)},
            {**common, 'dataset_kind':'question-search', 'cases':search, 'cases_sha256':digest(search)})


def validate(chat, search, frozen):
    if digest(frozen['corpus']) != frozen['corpus_sha256']:
        raise ValueError('Snapshot checksum mismatch.')
    known = {q['id']: q for q in frozen['corpus']['questions']}
    for dataset in (chat, search):
        cases = dataset['cases']
        if dataset['corpus_sha256'] != frozen['corpus_sha256'] or dataset['cases_sha256'] != digest(cases):
            raise ValueError('Dataset checksum/corpus mismatch.')
        if len({c['id'] for c in cases}) != len(cases):
            raise ValueError('Duplicate case IDs.')
        for c in cases:
            if c['review_status'] != PENDING:
                raise ValueError('Preparation must not auto-approve human judgments.')
    if Counter(c['set_id'] for c in chat['cases']) != Counter({i:10 for i in range(1,7)}):
        raise ValueError('Expected six chat sets of ten.')
    if Counter(c['set_id'] for c in search['cases']) != Counter({7:15,8:10,9:20,10:10,11:10,12:10,13:5}):
        raise ValueError('Expected 70 search queries plus ten accented comparisons.')
    for case in chat['cases']:
        if not case['expected_facts'] or not case['forbidden_claims']:
            raise ValueError('Missing chat rubric.')
        for path in case['application_evidence']:
            if not (ROOT / path).is_file():
                raise ValueError(f'Evidence file missing: {path}')
    cases_by_id = {c['id']:c for c in search['cases']}
    for case in search['cases']:
        relevant, high = case['relevant_question_ids'], case['highly_relevant_question_ids']
        if len(relevant) != len(set(relevant)) or len(high) != len(set(high)):
            raise ValueError('Duplicate relevance IDs.')
        if not set(high) <= set(relevant) or not set(relevant) <= known.keys():
            raise ValueError('Relevance labels must use real snapshot IDs; high must be a subset.')
        if {c['question_id'] for c in case['candidate_questions']} != set(relevant):
            raise ValueError('Candidate evidence does not match labels.')
        for candidate in case['candidate_questions']:
            question = known[candidate['question_id']]
            if candidate['bank_id'] != question['bank_id'] or candidate['content'] != question['content']:
                raise ValueError('Candidate content/bank mismatch.')
        for scope in case['bank_contexts']:
            if any(known[q]['bank_id'] != scope['bank_id'] for q in scope['relevant_question_ids']):
                raise ValueError('Wrong bank scope.')
        if 'paired_case_id' in case:
            pair = cases_by_id[case['paired_case_id']]
            if fold(case['query']) != fold(pair['query']) or relevant != pair['relevant_question_ids'] or high != pair['highly_relevant_question_ids']:
                raise ValueError('Accented pair mismatch.')


def export_review(output, chat, search, frozen):
    write_json(output / 'chatbox-cases.json', chat)
    write_json(output / 'question-search-cases.json', search)
    write_csv(output / 'chatbox-review.csv', chat['cases'])
    search_fields = sorted(set().union(*(c.keys() for c in search['cases'])) - {'candidate_questions','bank_contexts'})
    write_csv(output / 'question-search-review.csv', [{k:c.get(k, '') for k in search_fields} for c in search['cases']])
    rows = []
    for case in search['cases']:
        for candidate in case['candidate_questions']:
            rows.append(dict(case_id=case['id'], query=case['query'], **candidate, review_status=PENDING,
                             human_grade='', reviewer='', review_notes=''))
    write_csv(output / 'search-candidate-review.csv', rows)
    banks = {b['id']: b['name'] for b in frozen['corpus']['banks']}
    write_csv(output / 'question-corpus.csv', [dict(**q, bank_name=banks[q['bank_id']]) for q in frozen['corpus']['questions']])
    lines = ['# Golden sets: hồ sơ review', '', 'Tất cả nhãn đang NEEDS_HUMAN_REVIEW; chưa chạy và chưa có điểm đánh giá.', '',
        '60 câu Chatbox; 70 query gốc + 10 query có dấu để so sánh. ID lấy từ snapshot DB chỉ đọc.', '',
        'Mức đề xuất: 2 = trực tiếp; 1 = liên quan một phần; 0 = không liên quan. Người review có thể sửa, thêm hoặc bỏ ID từ question-corpus.csv.', '',
        'Danh sách dưới đây là đề xuất từ nội dung, không phải kết quả xếp hạng của hệ thống. ID được sắp theo snapshot, không theo độ liên quan.', '',
        '## Chatbox', '']
    for c in chat['cases']:
        lines += [f"### {c['id']} — {c['question']}", '', f"Role: {c['role']}; category: {c['category']}; {c['review_status']}", '',
            'Kỳ vọng: ' + '; '.join(c['expected_facts']), '', 'Không được khẳng định: ' + '; '.join(c['forbidden_claims']), '',
            'Lưu ý hiện thực: ' + (c['implementation_notes'] or 'Đối chiếu code và KB trước khi duyệt.'), '',
            'Code tham khảo: ' + ', '.join('`'+p+'`' for p in c['application_evidence']), '']
    lines += ['## Question Search', '', 'Chọn ngân hàng trước khi chạy endpoint thực tế; không gộp các ngân hàng thành bảng xếp hạng toàn cục giả lập.', '']
    for c in search['cases']:
        lines += [f"### {c['id']} — {c['query']}", '', f"Intent: {c['intent']}; {c['candidate_status']}; {c['review_status']}", '']
        if not c['candidate_questions']:
            lines += ['Chưa đề xuất được ID. Cần kiểm tra toàn corpus; đây không tự động là negative đã duyệt.', '']
        for candidate in c['candidate_questions']:
            lines += [f"- [{candidate['proposed_grade']}] `{candidate['question_id']}` — {candidate['bank_name']}: " + ' '.join(candidate['content'].split()),
                      '  Lý do đề xuất: ' + candidate['rationale']]
        lines += ['']
    (output / 'REVIEW.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')
    kb = ['# Snapshot KB để review mức độ bao phủ', '', 'Code có tính năng không có nghĩa support KB đã có hướng dẫn tương ứng. Không đưa đáp án golden vào prompt.', '']
    for article in frozen['corpus']['articles']:
        kb += [f"## {article['id']} — {article['title']}", '', f"Role: {article['role']}; category: {article['category']}; active: {article['is_active']}; requires_admin: {article['requires_admin']}", '']
        kb += ['- '+step for step in article['steps']] + ['']
    (output / 'KB-REVIEW.md').write_text('\n'.join(kb)+'\n', encoding='utf-8')
    paths = sorted({p for c in chat['cases'] for p in c['application_evidence']} |
                   {'backend/scripts/prepare_ai_golden_sets.py', 'backend/evaluation/golden_sets/chatbox.json', 'backend/evaluation/golden_sets/question-search.json'})
    manifest = dict(schema_version=2, review_status=PENDING, evaluation_status='NOT_RUN',
        corpus_sha256=frozen['corpus_sha256'], collected_at_utc=frozen['collected_at_utc'],
        questions=len(frozen['corpus']['questions']), banks=len(banks), articles=len(frozen['corpus']['articles']),
        chat_cases=len(chat['cases']), search_original_cases=70, accent_comparisons=10,
        candidate_status_counts=dict(Counter(c['candidate_status'] for c in search['cases'])),
        source_sha256={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths},
        limitations=['Pending human relevance, factual and KB-coverage review.',
                      'No live AI calls, no search rankings and no new accuracy scores.',
                      'Per-bank contexts must be fixed before scoring; negative controls need explicit bank scopes.',
                      'Schema 2 manual fact rubrics are not interchangeable with the legacy automatic scorer.'])
    write_json(output / 'manifest.json', manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_REVIEW)
    parser.add_argument('--validate-only', action='store_true', help='Validate existing draft artifacts without DB or writes.')
    args = parser.parse_args()
    output = args.output.resolve()
    if args.validate_only:
        frozen = read_json(output / 'corpus-snapshot.json')
        chat = read_json(output / 'chatbox-cases.json')
        search = read_json(output / 'question-search-cases.json')
    else:
        if (output / 'chatbox-cases.json').exists() or (output / 'question-search-cases.json').exists():
            parser.error('Review files already exist. Use --validate-only or a new --output directory; reviewed work is never overwritten.')
        frozen = snapshot(output)
        chat, search = build(frozen)
    validate(chat, search, frozen)
    if not args.validate_only:
        export_review(output, chat, search, frozen)
    print(f'Validated {len(chat["cases"])} chat cases and {len(search["cases"])} search cases. Status: {PENDING}.')


if __name__ == '__main__':
    main()
