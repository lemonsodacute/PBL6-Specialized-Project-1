"""Compositional Vietnamese intent/entity extraction for trusted academic tools.

Patterns describe intent families; entities are subsequently resolved against
authorized database records, never against generated IDs or guessed exam names.
"""
import re


RULES = (
    ('STUDENT_PROCTOR_ALERT_SUMMARY', r'\b(canh bao|su kien giam sat)\b'),
    ('OPEN_EXAMS_LOOKUP', r'\b(dang mo|dang dien ra|hien.*lam duoc|bai nao lam duoc)\b'),
    ('STUDENTS_BELOW_SCORE', r'\bduoi\s+\d+(?:[.,]\d+)?\s*(?:diem|%|phan tram)?'),
    ('EXAM_RESULT_SUMMARY', r'\b(?:tren|hon)\s+\d+(?:[.,]\d+)?\s*(?:diem|%|phan tram)?'),
    ('EXAM_SUBMISSION_SUMMARY', r'\b(bao nhieu|may)\b.*\b(sinh vien|nguoi)\b.*\b(nop|lam|thi)\b'),
    ('STUDENTS_NOT_ATTEMPTED', r'\bchua\s+(?:lam|thi|nop)\b'),
    ('STUDENT_ATTEMPT_HISTORY', r'\blich su lam bai\b|\bda (?:lam|thi)\b.*\b(nhung|may|nao|bao nhieu)\b'),
    ('CLASS_SCORE_SUMMARY', r'\blop\b.*\b(hoc the nao|diem trung binh)\b|\b(?:thong ke|diem trung binh)\b.*\blop\b'),
    ('EXAM_RESULT_SUMMARY', r'\b(thong ke ket qua|diem trung binh|phan bo diem)\b'),
)


def clean_entity(text):
    text = text.strip()
    text = re.sub(r'\b(hom nay|tuan nay|thang nay)\b', '', text)
    text = re.split(r'\s+(?:la bao nhieu|co bao nhieu|co may|hoc the nao|hien co|dang |da nop|chua nop)', text)[0]
    text = re.sub(r'^(?:cua |trong |o )?(?:bai kiem tra|bai thi|de thi|ky thi|bai|de|mon)\s+', '', text)
    return text.strip(' ?!.,')


def extract_intent(text):
    if re.search(r'\b(xuat|export|tai ve)\b.*\b(toan bo|tat ca)\b', text):
        return {'intent': 'CLASS_SCORE_SUMMARY', 'scope_error': 'Chat không xuất toàn bộ dữ liệu sinh viên. Hãy dùng chức năng xuất dữ liệu được cấp quyền trong ứng dụng.'}
    intent = next((name for name, pattern in RULES if re.search(pattern, text)), None)
    if not intent:
        return None
    data = {'intent': intent}
    for phrase, value in (('hom nay', 'today'), ('tuan nay', 'week'), ('thang nay', 'month')):
        if phrase in text:
            data['date_range'] = value
    data['class_ref'] = 'lop nay' in text
    data['exam_ref'] = bool(re.search(r'\b(?:de|bai|ky thi) nay\b', text))
    data['student_ref'] = bool(re.search(r'\b(con lich su|sinh vien nay|ban ay|em ay)\b', text))
    threshold = re.search(r'\b(duoi|tren|hon)\s+(\d+(?:[.,]\d+)?)\s*(%|phan tram|diem)?', text)
    if threshold:
        data.update(threshold=threshold[2].replace(',', '.'), threshold_unit='percent' if threshold[3] in ('%', 'phan tram') else 'points',
            comparison='lt' if threshold[1] == 'duoi' else 'gt')
        if data['threshold_unit'] == 'percent' and float(data['threshold']) > 100:
            data['scope_error'] = 'Ngưỡng phần trăm phải nằm trong khoảng 0–100%.'
        if float(data['threshold']) > 1000000:
            data['scope_error'] = 'Ngưỡng điểm quá lớn. Vui lòng nhập ngưỡng điểm cụ thể của đề thi.'
            data.pop('threshold')
    if 'chua nop' in text:
        data['status_filter'] = 'not_submitted'
    elif re.search(r'\bchua (lam|thi)\b', text):
        data['status_filter'] = 'not_attempted'
    elif re.search(r'\bdang (lam|thi)\b', text):
        data['status_filter'] = 'in_progress'
    elif 'da nop' in text:
        data['status_filter'] = 'submitted'
    data['ranked'] = 'nhieu' in text and 'nhat' in text
    data['distribution'] = bool(re.search(r'\b(phan bo|loai su kien|theo loai)\b', text))
    for pattern, value in ((r'\b(?:muc )?(?:rat cao|nghiem trong)\b', 'critical'), (r'\b(?:muc )?cao\b', 'high'),
                           (r'\bmuc trung binh\b', 'medium'), (r'\bmuc thap\b', 'low')):
        if re.search(pattern, text):
            data['severity'] = value; break
    for pattern, value in ((r'chua (?:xu ly|xem xet)', 'unresolved'), (r'da xac nhan', 'confirmed'),
                           (r'da bo qua', 'dismissed'), (r'canh bao moi', 'new')):
        if re.search(pattern, text):
            data['review_status'] = value; break

    # Explicit class/exam clauses are split before extracting a student subject.
    working = re.sub(r'^(?:cho (?:toi|minh) (?:xem )?|vui long )', '', text)
    working = re.sub(r'\b(hom nay|tuan nay|thang nay)\b', '', working).strip()
    cls = re.search(r'\blop\s+(.+)', working)
    if cls:
        class_text = cls[1]
        exam_after_class = re.search(r'\s+(?:(?:trong|cua)\s+)?(?:bai kiem tra|bai thi|de thi|bai|de|ky thi)\s+(.+)', class_text)
        if exam_after_class:
            data['exam_query'] = clean_entity(exam_after_class[1])
            class_text = class_text[:exam_after_class.start()]
        name = clean_entity(class_text)
        name = re.split(r'\s+(?:trong |cua )?(?:bai|de|ky thi)\s+', name)[0]
        if name and name != 'nay':
            data['class_query'] = name
        working = working[:cls.start()] + working[cls.end():]
    code = re.search(r'\b(?:mssv|ma sinh vien)\s*[:=]?\s*([a-z0-9_-]+)', working)
    if code:
        data['student_code'] = code[1].upper()
    if intent in ('STUDENT_ATTEMPT_HISTORY', 'STUDENT_PROCTOR_ALERT_SUMMARY'):
        name = ''
        if 'lich su lam bai' in working:
            match = re.search(r'lich su lam bai(?:\s+cua\s+(.+))?$', working)
            name = match[1] or '' if match else ''
        elif intent == 'STUDENT_ATTEMPT_HISTORY':
            match = re.search(r'^(.*?)\s+da (?:lam|thi)\b', working)
            name = match[1] if match else ''
        else:
            match = re.search(r'^(.*?)\s+co\s+(?:bao nhieu|may)\s+(?:canh bao|su kien)', working)
            name = match[1] if match else ''
            if not name:
                match = re.search(r'canh bao(?: giam sat)?\s+cua\s+(.+?)(?:\s+trong\s+|$)', working)
                name = match[1] if match else ''
        name = re.sub(r'^(?:sinh vien|ban)\s+', '', name).strip()
        if name in ('toi', 'minh', 'em'):
            data['self_requested'] = True
        elif name and not code and name not in ('ai', 'sinh vien nao', 'nao'):
            data['student_name'] = name

    if intent == 'STUDENT_ATTEMPT_HISTORY':
        if data.get('student_name'):
            parts = re.split(r'\s+(?:trong|cua)\s+(?:bai|de|ky thi)\s+', data['student_name'], maxsplit=1)
            data['student_name'] = parts[0]
            if len(parts) > 1:
                data['exam_query'] = clean_entity(parts[1])
        return data
    # Titles can occur before or after the predicate; remove the predicate only,
    # retaining actual course/title words for scoped database resolution.
    exam = re.search(r'\b(?:trong|cua)\s+(?:bai kiem tra|bai thi|de thi|bai|de|ky thi)\s+(.+)', working)
    if not exam:
        exam = re.search(r'^(?:bai kiem tra|bai thi|de thi|bai|de|ky thi)\s+(.+?)\s+co\s+(?:bao nhieu|may)', working)
    if not exam:
        exam = re.search(r'\b(?:chua (?:lam|thi|nop)(?: bai| de)?|thong ke ket qua|diem trung binh|phan bo diem)\s+(.+)', working)
    name = clean_entity(exam[1]) if exam else ''
    if not name and threshold:
        local_threshold = re.search(r'\b(?:duoi|tren|hon)\s+\d+(?:[.,]\d+)?\s*(?:%|phan tram|diem)?', working)
        name = clean_entity(working[local_threshold.end():]) if local_threshold else ''
    if name not in ('', 'nay', 'nao', 'nhung bai nao', 'nhung de nao'):
        # "giữa kỳ Web" expresses both a period and a course. SQL resolution
        # matches tokens against exam and assigned-class titles together.
        data['exam_query'] = name
    if intent == 'OPEN_EXAMS_LOOKUP':
        data.pop('exam_query', None)
    return data
