"""Conservative parsing/matching. OCR never supplies authoritative profile data."""
from dataclasses import dataclass
from datetime import datetime
import re
import unicodedata

PARSER_VERSION = 'student-card-layout-roi-v8'
MATCHING_VERSION = 'student-card-match-v5'
MIN_FIELD_CONFIDENCE = 0.90


@dataclass(frozen=True)
class OCRToken:
    text: str
    confidence: float
    bbox: tuple[int, int, int, int] | None = None
    symbols: tuple['OCRToken', ...] = ()


@dataclass(frozen=True)
class OCRLine:
    text: str
    confidence: float
    bbox: tuple[int, int, int, int] | None = None
    tokens: tuple[OCRToken, ...] = ()


@dataclass(frozen=True)
class FieldOCR:
    field: str
    label_line: int
    candidate_line: int
    text: str
    confidence: float
    bbox: tuple[int, int, int, int]
    language: str
    psm: int
    preprocessing: str


class OCRResult(list):
    """List-compatible observations; global OCR is never overwritten by ROI OCR."""
    def __init__(self, lines, field_ocr=()):
        super().__init__(lines)
        self.raw_global_ocr = tuple(lines)
        self.field_ocr = tuple(field_ocr)


def normalize_name(value: str | None) -> str:
    value = unicodedata.normalize('NFKD', value or '').casefold().replace('đ', 'd')
    return ' '.join(''.join(char for char in value if not unicodedata.combining(char)).split())


def normalize_code(value: str | None) -> str:
    return value.strip().upper() if isinstance(value, str) else ''


def _one_edit(first, second):
    if abs(len(first) - len(second)) > 1:
        return False
    if len(first) == len(second):
        return sum(a != b for a, b in zip(first, second)) == 1
    short, long = sorted((first, second), key=len)
    return any(short == long[:index] + long[index + 1:] for index in range(len(long)))


def names_match(first, second):
    a, b = normalize_name(first), normalize_name(second)
    if not a or not b:
        return False
    if a == b:
        return True
    aa, bb = a.split(), b.split()
    # No reordered/dropped tokens. Short names and short tokens remain exact.
    if len(aa) != len(bb) or len(aa) < 3 or min(len(a), len(b)) < 20:
        return False
    differences = [(x, y) for x, y in zip(aa, bb) if x != y]
    return len(differences) == 1 and min(map(len, differences[0])) >= 4 and _one_edit(*differences[0])


LABELS = {
    'full_name': ('ho va ten', 'ho ten', 'full name', 'name', 'ten'),
    'student_code': ('ma so sinh vien', 'ma sinh vien', 'ma sv', 'so the sinh vien',
                     'so the sv', 'student number', 'student code', 'student id',
                     'student no', 'mssv', 'msv', 'ms'),
    'class_name': ('lop hoc', 'lop hc', 'lop', 'class'),
    'major': ('nganh', 'nganh hoc', 'major'),
}
SORTED_LABELS = sorted(((alias, field) for field, aliases in LABELS.items() for alias in aliases),
                       key=lambda item: len(item[0]), reverse=True)
OTHER_LABELS = ('ngay sinh', 'date of birth', 'dob', 'khoa hoc', 'nien khoa', 'nam hoc',
                'academic year', 'year', 'validity', 'valid until', 'expiry', 'expires',
                'ngay het han', 'han su dung', 'co gia tri den', 'barcode number',
                'barcode', 'ma vach', 'card number', 'card no', 'so the', 'ho khau', 'khoa')


def _clean_text(text):
    return ' '.join(unicodedata.normalize('NFC', text).split())


def _match_label(text):
    normalized = normalize_name(text)
    for alias, field in SORTED_LABELS:
        if re.match(re.escape(alias) + r'(?=\s|[:：/\-]|$)', normalized):
            return field, len(alias)
    return None


def _label(text):
    text = _clean_text(text)
    # Bounded label glyph confusion seen in global OCR; values are untouched.
    class_label = re.match(r'^(?:l[oe0]p(?:\s+(?:hoc|hc))?|c[l1i][ao]ss)(?=$|[\s:：/])'
                           r'(?:\s*/\s*(?:c[l1i][ao]ss|lop))?\s*[:：]?\s*', normalize_name(text))
    if class_label:
        offset = class_label.end()
        return 'class_name', text[offset:], offset
    # Name-only bilingual handling. Tesseract can read the slash as a comma
    # or period and "name" as "nome" on pale, italic card labels.
    name_label = re.match(
        r'^(?:ho\s+(?:v[ao]\s+)?ten|full\s+name|name|ten)(?=$|[\s:/：.,-])'
        r'(?:\s*[/.,-]?\s*full\s+n[ao]me(?=$|[\s:：]))?\s*[:：/.,-]?\s*',
        normalize_name(text))
    if name_label:
        offset = name_label.end()
        return 'full_name', text[offset:], offset
    match = _match_label(text)
    if match is None:
        # A diacritic misread can turn "Mã SV" into "Mõ SV". Tolerate
        # this bounded label spelling only; never alter any ID character.
        code_label = re.match(r'^m[ao]\s+(?:so\s+)?(?:sv|sinh\s+vien)(?=$|[\s:：/])', normalize_name(text))
        if code_label:
            match = ('student_code', code_label.end())
    if match is None:
        return None
    field, offset = match
    # Consume compound labels such as "Số thẻ SV/Student ID:" together.
    while text[offset:].lstrip().startswith('/'):
        start = offset + re.match(r'\s*/\s*', text[offset:]).end()
        extra = _match_label(text[start:])
        if extra is None or extra[0] != field:
            break
        offset = start + extra[1]
    offset += re.match(r'\s*[:：\-]?\s*', text[offset:]).end()
    return field, text[offset:], offset


def _other_label(text):
    normalized = normalize_name(text)
    return (any(re.match(re.escape(alias) + r'(?=\s|[:：/\-]|$)', normalized) for alias in OTHER_LABELS)
            or re.match(r'^ng[a-z]{1,4}\s+sinh(?=$|[\s:：/])', normalized) is not None
            or re.match(r'^khor(?=$|[\s:：/])', normalized) is not None
            or re.search(r'/\s*(?:f[ao]culty|cohort|dob)\b', normalized) is not None)


def _student_label(text):
    labelled = _label(text)
    if labelled is not None:
        return labelled
    clean = _clean_text(text)
    normalized = normalize_name(clean)
    # A fallback still needs an explicit student-ID anchor. Never infer an ID
    # from a nine-digit number or the lower-right corner alone. Only the label
    # may tolerate an OCR glyph error; the ID itself remains exact.
    if re.search(r'\b(?:barcode|bank|ngan hang|ma vach|dob|validity|expiry|ngay sinh)\b', normalized):
        return None
    anchor = re.search(r'\b(?:student\s+(?:id|1d|ld)|dent\s+id|so the (?:sv|sinh vien))(?=\s|[:：/]|$)', normalized)
    if anchor is None:
        return None
    offset = anchor.end()
    offset += re.match(r'\s*[:：]?\s*', clean[offset:]).end()
    return 'student_code', clean[offset:], offset


def _union_box(boxes):
    boxes = [box for box in boxes if box is not None]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes)) if boxes else None


def _parts(line, offset):
    """Value confidence uses only value words; a weak label cannot dilute it."""
    text, cursor, labels, values = _clean_text(line.text), 0, [], []
    for token in line.tokens:
        word = _clean_text(token.text)
        start = text.find(word, cursor)
        if start < 0:
            return line.bbox, line.bbox, line.confidence, line.confidence
        cursor = start + len(word)
        precise_symbols = (token.symbols and ''.join(symbol.text for symbol in token.symbols) == word
                           and all(len(symbol.text) == 1 and symbol.bbox for symbol in token.symbols))
        if start < offset:
            if cursor > offset and precise_symbols:
                labels.extend(token.symbols[:offset - start])
            else:
                labels.append(token)
        if cursor > offset:
            if start < offset and precise_symbols:
                # A token can contain both the label and digits (SV:11247707).
                # Use actual symbol boxes to crop after the colon, not guessed
                # character widths or the entire mixed word.
                symbols = token.symbols[offset - start:]
                values.extend(symbols or (token,))
            else:
                values.append(token)
    label_box = _union_box([t.bbox for t in labels]) or line.bbox
    value_box = _union_box([t.bbox for t in values]) or line.bbox
    label_confidence = min((t.confidence for t in labels), default=line.confidence)
    value_confidence = min((t.confidence for t in values), default=line.confidence)
    return label_box, value_box, label_confidence, value_confidence


def _code_rejection(value):
    # Exact ASCII reading, no character substitutions, integer conversion or
    # profile hints. A complete token of 6–32 characters must contain a digit.
    if not re.fullmatch(r'[A-Za-z0-9]{6,32}', value) or not re.search(r'[0-9]', value):
        return 'invalid_code_format'
    if value.isdigit() and len(value) == 8:
        for fmt in ('%d%m%Y', '%Y%m%d'):
            try:
                if 1900 <= datetime.strptime(value, fmt).year <= 2099:
                    return 'date_like_number'
            except ValueError:
                pass
        if '1900' <= value[:4] <= '2099' and '1900' <= value[4:] <= '2099':
            return 'year_range'
    return None


def _proximity(label, value):
    """Bounded right/below region measured in text heights, not page order."""
    height = max(label[3] - label[1], value[3] - value[1])
    dy = abs((label[1] + label[3] - value[1] - value[3]) / 2)
    right_gap = value[0] - label[2]
    if dy <= .6 * height and 0 <= right_gap <= 8 * height:
        return 1, (right_gap + dy) / height, 'right'
    below_gap = value[1] - label[3]
    center = (label[0] + label[2]) / 2
    aligned = (value[0] - .5 * height <= center <= value[2] + .5 * height
               or abs(value[0] - label[0]) <= .75 * height)
    if 0 <= below_gap <= 2.5 * height and aligned:
        return 1, (below_gap + abs(center - (value[0] + value[2]) / 2)) / height, 'below'
    if 0 <= below_gap <= 2.5 * height and 0 <= right_gap <= 3 * height:
        return 2, (below_gap + right_gap) / height, 'below_right'
    return None


def _owned_by_other_label(lines, candidate_index, candidate_box, source_index, proximity):
    for index, line in enumerate(lines):
        if index in (source_index, candidate_index):
            continue
        label = _label(line.text)
        if label is not None and label[0] == 'student_code':
            continue
        if not _other_label(line.text) and (label is None or label[0] == 'student_code'):
            continue
        # Only a label without its own value can own a separate numeric line.
        if label is not None and label[1]:
            continue
        if candidate_box and line.bbox:
            other = _proximity(line.bbox, candidate_box)
            if other and proximity and other[:2] <= proximity[:2]:
                return True
        elif index == candidate_index - 1:
            return True
    return False


def _student_candidates(lines, index, labelled, diagnostics, *, locate_roi=False):
    line = lines[index]
    _, inline, offset = labelled
    label_box, inline_box, label_confidence, inline_confidence = _parts(line, offset)
    matches = []
    # With geometry, inspect positions even when sparse OCR orders a value
    # before its label. Without geometry, only the immediate next line is safe.
    targets = [index] if inline else ([i for i in range(len(lines)) if i != index]
                                     if label_box else [index + 1])
    for target in targets:
        if target >= len(lines):
            continue
        candidate = lines[target]
        value = inline if target == index else _clean_text(candidate.text)
        box = inline_box if target == index else candidate.bbox
        confidence = inline_confidence if target == index else _parts(candidate, 0)[3]
        if target != index and (separator := re.match(r'^[:：]\s*', value)):
            # Sparse OCR can emit the colon with a separate value line.
            # Remove only field punctuation and use the value's token geometry.
            _, box, _, confidence = _parts(candidate, separator.end())
            value = value[separator.end():]
        reason = _code_rejection(value)
        if _label(line.text) is None and not re.fullmatch(r'[0-9]{9}', value):
            reason = 'fallback_requires_nine_digits'
        if (locate_roi and reason == 'invalid_code_format'
                and re.fullmatch(r'[A-Za-z0-9 ]{6,40}', value)
                and re.search(r'[0-9]', value)):
            # A garbled/spaced reading can still locate a value for a fresh
            # image recognition. It is never accepted as a parsed ID here.
            reason = None
        proximity = None
        if reason is None:
            if target == index:
                proximity = (0, 0., 'same_line')
                if label_box and box and label_box != box and _proximity(label_box, box) is None:
                    reason = 'outside_label_region'
            elif label_box:
                proximity = _proximity(label_box, box) if box else None
                if proximity is None:
                    reason = 'outside_label_region' if box else 'missing_candidate_bbox'
            else:
                proximity = (1, 0., 'next_line')
                if target + 1 < len(lines) and _code_rejection(_clean_text(lines[target + 1].text)) is None:
                    reason = 'ambiguous_without_geometry'
            if reason is None and _owned_by_other_label(lines, target, box, index, proximity):
                reason = 'belongs_to_other_label'
        event = {'field': 'student_code', 'label_line': index, 'candidate_line': target,
                 'candidate': value, 'label_bbox': label_box, 'candidate_bbox': box,
                 'label_confidence': label_confidence, 'value_confidence': confidence,
                 'relation': proximity[2] if proximity else None,
                 'distance': proximity[1] if proximity else None, 'rejection_reason': reason}
        if diagnostics is not None:
            diagnostics.append(event)
        if reason is None:
            matches.append((proximity, value, confidence, event))
    if not matches:
        return []
    matches.sort(key=lambda item: item[0][:2])
    best = matches[0]
    # Distances within half a text height are indistinguishable. Confidence is
    # a read-quality gate, never a way to choose the profile's desired digits.
    ambiguous = any(item[1] != best[1] and item[0][0] == best[0][0]
                    and item[0][1] - best[0][1] <= .5 for item in matches[1:])
    for item in matches:
        item[3]['rejection_reason'] = ('ambiguous_candidates' if ambiguous else
                                       None if item is best else 'less_proximate_candidate')
        item[3]['selected'] = not ambiguous and item is best
    # None poisons resolution across multiple student-code labels too.
    return [(None, None)] if ambiguous else [(best[1], best[2])]


def _text_block(lines, target, value, score, box, *, is_name=False):
    if box is None:
        return target, value, score, box
    consumed = {target}
    current = box
    # Tight left alignment and line spacing prevent swallowing another field.
    for _ in range(2):
        height = current[3] - current[1]
        nearby = [(line.bbox[1] - current[3], i, line) for i, line in enumerate(lines)
                  if i not in consumed and line.bbox
                  and 0 <= line.bbox[1] - current[3] <= .8 * height
                  and abs(line.bbox[0] - box[0]) <= .75 * height]
        if not nearby:
            break
        _, i, line = min(nearby, key=lambda item: item[:2])
        if _label(line.text) or _other_label(line.text):
            break
        if is_name and name_rejection(line.text):
            break
        # Sparse OCR often emits DOB/class labels separately from their value.
        # A label beside the continuation ends this field's block even if the
        # value is visually closer to the previous line than to its own label.
        if any(j not in consumed and j != i and other.bbox
               and (_label(other.text) or _other_label(other.text))
               and (relation := _proximity(other.bbox, line.bbox))
               and relation[2] == 'right' for j, other in enumerate(lines)):
            break
        value += ' ' + _clean_text(line.text)
        score = min(score, _parts(line, 0)[3])
        box = _union_box((box, line.bbox))
        current = line.bbox
        consumed.add(i)
    return target, value, score, box


def _text_candidate(lines, index, labelled):
    """Locate a value independently of sparse-text emission order."""
    _, inline, offset = labelled
    label_box, value_box, _, score = _parts(lines[index], offset)
    if inline:
        if labelled[0] == 'major':
            from app.services.student_card_class import class_labels
            embedded = [label['start'] for label in class_labels(lines[index]) if label['start'] >= offset]
            if embedded:
                inline = _clean_text(lines[index].text[offset:min(embedded)])
                from app.services.student_card_class import _slice
                value_box, score = _slice(lines[index], offset, min(embedded))
        if labelled[0] == 'full_name' and name_rejection(inline):
            return None
        return _text_block(lines, index, inline, score, value_box, is_name=labelled[0] == 'full_name')
    matches = []
    targets = range(len(lines)) if label_box else [index + 1]
    for target in targets:
        if target == index or target >= len(lines):
            continue
        line = lines[target]
        if _label(line.text) or _other_label(line.text):
            continue
        if labelled[0] == 'full_name' and name_rejection(line.text):
            continue
        proximity = _proximity(label_box, line.bbox) if label_box and line.bbox else None
        if label_box and proximity is None:
            continue
        proximity = proximity or (1, 0., 'next_line')
        if proximity[2] == 'right':
            proximity = (0, proximity[1], 'right')
        if _owned_by_other_label(lines, target, line.bbox, index, proximity):
            continue
        matches.append((proximity, target))
    matches.sort()
    if not matches or (len(matches) > 1 and matches[0][0][0] == matches[1][0][0]
                       and matches[1][0][1] - matches[0][0][1] <= .5):
        return None
    target = matches[0][1]
    line = lines[target]
    return _text_block(lines, target, _clean_text(line.text), _parts(line, 0)[3], line.bbox,
                       is_name=labelled[0] == 'full_name')


def name_rejection(text):
    value = _clean_text(text)
    if _other_label(value) or _label(value):
        return 'contains_field_label'
    words = value.split()
    if not 2 <= len(words) <= 12 or len(value) > 160:
        return 'incomplete_name'
    if any(not all(char.isalpha() or char in "'-’" for char in word) for word in words):
        return 'non_name_characters'
    if sum(char.isalpha() for char in value) < 5:
        return 'insufficient_letters'
    return None


def best_name_read(reads):
    """Choose a complete OCR pass, never repair a name from profile data.

    Prefer a Vietnamese reading over its accent-stripped equivalent when
    confidence is comparable. Unrelated spellings compete by confidence.
    """
    usable = [read for read in reads if not name_rejection(read['text'])]
    if not usable:
        return None
    best = max(usable, key=lambda read: read['confidence'])
    # A shorter, confident prefix is not a complete reading when another pass
    # contains that prefix plus the rest of the name at comparable confidence.
    complete = [read for read in usable if read['confidence'] >= max(MIN_FIELD_CONFIDENCE, best['confidence'] - .05)
                and (normalize_name(read['text']) == normalize_name(best['text'])
                     or normalize_name(read['text']).startswith(normalize_name(best['text']) + ' '))]
    if complete:
        best = max(complete, key=lambda read: (len(read['text'].split()), read['confidence']))
    equivalent = [read for read in usable
                  if normalize_name(read['text']) == normalize_name(best['text'])
                  and read['confidence'] >= max(MIN_FIELD_CONFIDENCE, best['confidence'] - .05)]
    def quality(read):
        marks = sum(unicodedata.combining(char) != 0
                    for char in unicodedata.normalize('NFD', read['text']))
        marks += sum(char.casefold() == 'đ' for char in read['text'])
        return marks, read['confidence']
    return max(equivalent, key=quality) if equivalent else best


def _missing_name_region(line, labelled):
    box = _parts(line, labelled[2])[0]
    if not box or labelled[1]:
        return None
    left, top, right, bottom = box
    height = bottom - top
    return right + 2, top, right + 16 * height, bottom


def _missing_name_regions(line, labelled, lines=()):
    right = _missing_name_region(line, labelled)
    if right is None:
        return []
    left, top, _, bottom = _parts(line, labelled[2])[0]
    height = bottom - top
    regions = [right, (left, bottom + 2, left + 16 * height, bottom + 2 * height)]
    def crosses_other_field(region):
        return any(other is not line and other.bbox
                   and (_other_label(other.text) or _label(other.text))
                   and max(other.bbox[0], region[0]) < min(other.bbox[2], region[2])
                   and max(other.bbox[1], region[1]) < min(other.bbox[3], region[3])
                   for other in lines)
    return [region for region in regions if not crosses_other_field(region)]


def _missing_code_region(line, labelled, lines=()):
    """Bounded image-only retry when detection found a label but lost digits.

    Truncated `dent ID` requires a fresh nine-digit reading in the region below
    it; it can never select an arbitrary global number.
    """
    label_box = _parts(line, labelled[2])[0]
    if not label_box or labelled[1]:
        return None
    left, top, right, bottom = label_box
    height = bottom - top
    if normalize_name(line.text).strip(' :：') == 'dent id':
        left = max(0, left - 6 * height)
    region = (left, bottom, right + max(2, height // 2), bottom + max(20, round(1.5 * height)))
    # Never crop through another field's label (DOB, bank/barcode, validity).
    for other in lines:
        if other is line or not other.bbox:
            continue
        label = _label(other.text)
        if not _other_label(other.text) and (label is None or label[0] == 'student_code'):
            continue
        box = other.bbox
        if max(box[0], region[0]) < min(box[2], region[2]) and max(box[1], region[1]) < min(box[3], region[3]):
            return None
    return region


def _layout_name_regions(lines):
    """Unlabelled prominent name between a student-card title and body fields.

    Require a real student-ID label, title geometry and a nearby field below.
    A name-looking string or a profile name alone is never sufficient.
    """
    if any((label := _label(line.text)) and label[0] == 'full_name' for line in lines):
        return []
    if not any(line.bbox and (label := _student_label(line.text))
               and label[0] == 'student_code' for line in lines):
        return []
    regions = []
    for anchor, title in enumerate(lines):
        if not title.bbox or title.confidence < .5 or not re.fullmatch(r'(?:the sinh vien|student (?:id )?card)', normalize_name(title.text)):
            continue
        height = title.bbox[3] - title.bbox[1]
        for target, line in enumerate(lines):
            if not line.bbox or line.confidence < .75 or name_rejection(line.text):
                continue
            text = _clean_text(line.text)
            if text != text.upper() or not 2 <= len(text.split()) <= 6:
                continue
            if re.search(r'\b(?:truong|dai hoc|hoc vien|giao duc|dao tao|chuong trinh|chuyen nganh|academy|university|sinh vien)\b', normalize_name(text)):
                continue
            box = line.bbox
            overlap = max(0, min(box[2], title.bbox[2]) - max(box[0], title.bbox[0]))
            if (not 0 <= box[1] - title.bbox[3] <= 3 * height
                    or box[3] - box[1] < .5 * height
                    or overlap < .65 * min(box[2] - box[0], title.bbox[2] - title.bbox[0])):
                continue
            following = [other for other in lines if other.bbox
                         and 0 <= other.bbox[1] - box[3] <= 3 * (box[3] - box[1])
                         and max(box[0], other.bbox[0]) < min(box[2], other.bbox[2])
                         and (_other_label(other.text) or _label(other.text))]
            if not following:
                continue
            regions.append({'field': 'full_name', 'label_line': anchor, 'candidate_line': target,
                            'bbox': box, 'numeric': False, 'block': False, 'source': 'card_name_layout'})
    return regions


def field_regions(lines):
    """Value-only boxes shared by worker recognition and final parsing."""
    regions = []
    for index, line in enumerate(lines):
        labelled = _student_label(line.text)
        if not labelled:
            continue
        field = labelled[0]
        if field == 'class_name':
            continue
        if field == 'student_code':
            events = []
            _student_candidates(lines, index, labelled, events, locate_roi=True)
            event = next((event for event in events if event.get('selected')), None)
            if event is None:
                if any(event.get('rejection_reason') == 'ambiguous_candidates' for event in events):
                    continue
                box = _missing_code_region(line, labelled, lines)
                if box is None:
                    continue
                target = index
            else:
                target, box = event['candidate_line'], event['candidate_bbox']
        else:
            candidate = _text_candidate(lines, index, labelled)
            if candidate is None:
                if field == 'full_name':
                    for box in _missing_name_regions(line, labelled, lines):
                        regions.append({'field': field, 'label_line': index, 'candidate_line': index,
                                        'bbox': box, 'numeric': False, 'block': False})
                continue
            else:
                target, _, _, box = candidate
        if box is None:
            continue
        # Do not OCR a mixed label/value word without symbol geometry. The
        # whitelist could otherwise turn a label into part of the code.
        parts = _parts(line, labelled[2])
        if target == index and labelled[1] and parts[0] == parts[1]:
            continue
        regions.append({'field': field, 'label_line': index,
                        'candidate_line': target, 'bbox': box,
                        'numeric': field == 'student_code' and (target == index and not labelled[1]
                            or re.fullmatch(r'[0-9 ]+', labelled[1] if target == index else lines[target].text.strip()) is not None),
                        'block': field != 'student_code' and lines[target].bbox is not None
                                 and box[3] - box[1] > 1.6 * (lines[target].bbox[3] - lines[target].bbox[1])})
    regions.extend(_layout_name_regions(lines))
    from app.services.student_card_class import class_regions
    regions.extend(class_regions(lines))
    return sorted(regions, key=lambda region: region['field'] != 'student_code')


def parse_fields(lines: list[OCRLine], *, diagnostics: list | None = None) -> tuple[dict, dict]:
    candidates = {field: [] for field in LABELS}
    for index, line in enumerate(lines):
        labelled = _student_label(line.text)
        if labelled is None:
            continue
        field, value, _ = labelled
        if field == 'class_name':
            from app.services.student_card_class import embedded_major
            major = embedded_major(line)
            if major:
                candidates['major'].append(major)
            continue
        roi_reads = [read for read in getattr(lines, 'field_ocr', ())
                     if read.field == field and read.label_line == index
                     and (field != 'student_code' or _code_rejection(read.text) is None)]
        if field == 'student_code':
            events = []
            values = _student_candidates(lines, index, labelled, events)
            if diagnostics is not None:
                diagnostics.extend(events)
            locations = []
            _student_candidates(lines, index, labelled, locations, locate_roi=True)
            selected = next((event for event in locations if event.get('selected')), None)
            roi_reads = [read for read in roi_reads if selected
                         and read.candidate_line == selected['candidate_line']]
            if selected is None and not values:
                region = _missing_code_region(line, labelled, lines)
                if region:
                    roi_reads = [read for read in getattr(lines, 'field_ocr', ())
                                 if read.field == 'student_code' and read.label_line == index
                                 and read.candidate_line == index and read.bbox == region
                                 and re.fullmatch(r'[0-9]{9}', read.text)]
            best = max(roi_reads, key=lambda read: read.confidence, default=None)
            if best and (not values or (values != [(None, None)]
                                       and best.confidence > values[0][1])):
                values = [(best.text, best.confidence)]
                if diagnostics is not None:
                    diagnostics.append({'field': field, 'source': 'field_ocr',
                                        'label_line': index, 'candidate_line': best.candidate_line,
                                        'candidate': best.text, 'value_confidence': best.confidence})
            candidates[field].extend(values)
            continue
        if field == 'full_name':
            label_box = _parts(line, labelled[2])[0]
            if diagnostics is not None:
                diagnostics.append({'event': 'NAME_LABEL', 'field': field, 'text': line.text,
                    'confidence': line.confidence, 'bbox': label_box, 'label_line': index,
                    'tokens': [{'text': word.text, 'confidence': word.confidence, 'bbox': word.bbox}
                               for word in line.tokens]})
            candidate = _text_candidate(lines, index, labelled)
            reads = []
            if candidate:
                target, text, score, box = candidate
                tokens = [word.confidence for word in lines[target].tokens
                          if not box or not word.bbox or word.bbox[0] >= box[0]]
                reads.append({'text': text, 'confidence': sum(tokens)/len(tokens) if tokens else score,
                              'bbox': box, 'candidate_line': target, 'source': 'global_ocr',
                              'tokens': [{'text': word.text, 'confidence': word.confidence, 'bbox': word.bbox}
                                         for word in lines[target].tokens
                                         if not box or not word.bbox or word.bbox[0] >= box[0]]})
                roi_reads = [read for read in roi_reads if read.candidate_line == target]
            else:
                regions = _missing_name_regions(line, labelled, lines)
                roi_reads = [read for read in roi_reads if read.candidate_line == index
                             and read.bbox in regions]
            reads.extend({'text': _clean_text(read.text), 'confidence': read.confidence,
                          'bbox': read.bbox, 'candidate_line': read.candidate_line,
                          'source': 'name_roi_ocr'} for read in roi_reads)
            best = best_name_read(reads)
            if diagnostics is not None:
                for read in reads:
                    diagnostics.append({'event': 'NAME_CANDIDATE', 'field': field, **read,
                        'label_line': index, 'detected_label': line.text,
                        'selected': read is best, 'reject_reason': name_rejection(read['text'])
                            or (None if read is best else 'lower_name_quality')})
            if best:
                candidates[field].append((best['text'], best['confidence']))
            continue
        candidate = _text_candidate(lines, index, labelled)
        if candidate is None:
            continue
        candidate_index, value, confidence, _ = candidate
        roi_reads = [read for read in roi_reads if read.candidate_line == candidate_index]
        best = max(roi_reads, key=lambda read: read.confidence, default=None)
        if best and (not value or best.confidence > confidence):
            value, confidence = _clean_text(best.text), best.confidence
            if diagnostics is not None:
                diagnostics.append({'field': field, 'source': 'field_ocr', 'candidate': value,
                                    'label_line': index, 'value_confidence': confidence})
        if value:
            candidates[field].append((value, confidence))
    for region in _layout_name_regions(lines):
        line = lines[region['candidate_line']]
        reads = [{'text': _clean_text(line.text), 'confidence': line.confidence,
                  'source': 'card_name_layout', 'bbox': line.bbox}]
        reads.extend({'text': _clean_text(read.text), 'confidence': read.confidence,
                      'source': 'name_roi_ocr', 'bbox': read.bbox}
                     for read in getattr(lines, 'field_ocr', ())
                     if read.field == 'full_name' and read.label_line == region['label_line']
                     and read.candidate_line == region['candidate_line'] and read.bbox == region['bbox'])
        best = best_name_read(reads)
        if diagnostics is not None:
            for read in reads:
                diagnostics.append({'event': 'NAME_CANDIDATE', 'field': 'full_name', **read,
                    'label_line': region['label_line'], 'candidate_line': region['candidate_line'],
                    'detected_label': None, 'layout_anchor': lines[region['label_line']].text,
                    'selected': read is best,
                    'reject_reason': name_rejection(read['text']) or (None if read is best else 'lower_name_quality')})
        if best:
            candidates['full_name'].append((best['text'], best['confidence']))
    extracted, confidence = {}, {}
    for field, values in candidates.items():
        if field == 'class_name':
            continue
        distinct = {value for value, _ in values}
        # Conflicting duplicate fields are ambiguous; never choose the profile's
        # desired value or silently pick the most convenient OCR candidate.
        unambiguous = len(distinct) == 1 and None not in distinct
        extracted[field] = next(iter(distinct)) if unambiguous else None
        confidence[field] = min(score for _, score in values) if unambiguous else None
        if diagnostics is not None:
            diagnostics.append({'field': field, 'extracted': extracted[field], 'confidence': confidence[field],
                                'rejection_reason': ('conflicting_candidates' if len(distinct) > 1 else
                                                     'no_unambiguous_candidate') if not unambiguous else None,
                                'confidence_rejection_reason': 'below_required_field_confidence'
                                    if unambiguous and field in ('full_name', 'student_code')
                                    and confidence[field] < MIN_FIELD_CONFIDENCE else None})
    from app.services.student_card_class import resolve_class
    extracted['class_name'], confidence['class_name'] = resolve_class(lines, diagnostics=diagnostics)
    if extracted['class_name'] and normalize_name(extracted['class_name']) in {
            normalize_name(extracted[field]) for field in ('full_name', 'major', 'student_code') if extracted[field]}:
        extracted['class_name'], confidence['class_name'] = None, None
    return extracted, confidence


def compare_fields(extracted: dict, confidence: dict, full_name: str, student_code: str | None, *, allow_missing_student_code=False) -> dict:
    ocr_display_name = extracted.get('ocr_display_name', extracted.get('full_name'))
    name_match = names_match(full_name, ocr_display_name)
    name_match_type = ('UNREADABLE' if not ocr_display_name else
                       'EXACT' if _clean_text(full_name) == _clean_text(ocr_display_name) else
                       'NORMALIZED' if name_match else 'MISMATCH')
    code = normalize_code(extracted.get('student_code'))
    code_will_update = bool(allow_missing_student_code and not normalize_code(student_code)
                            and code and _code_rejection(code) is None
                            and (confidence.get('student_code') or 0) >= MIN_FIELD_CONFIDENCE)
    code_match = bool(code and (code == normalize_code(student_code) or code_will_update))
    errors = []
    for field, matches, unreadable, mismatch in (
            ('full_name', name_match, 'NAME_UNREADABLE', 'NAME_MISMATCH'),
            ('student_code', code_match, 'STUDENT_CODE_UNREADABLE', 'STUDENT_CODE_MISMATCH')):
        if field == 'full_name' and extracted.get(field) and (confidence.get(field) or 0) < MIN_FIELD_CONFIDENCE:
            errors.append('NAME_LOW_CONFIDENCE')
        elif not extracted.get(field) or (confidence.get(field) or 0) < MIN_FIELD_CONFIDENCE:
            errors.append(unreadable)
        elif not matches:
            errors.append(mismatch)
    return {'comparison': {'name_match': name_match, 'name_match_type': name_match_type, 'student_code_match': code_match,
                           'student_code_will_update': code_will_update},
            'can_confirm': not errors, 'blocking_errors': errors,
            'warnings': ['NAME_NORMALIZED'] if name_match_type == 'NORMALIZED' else []}
