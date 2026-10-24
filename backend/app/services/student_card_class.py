"""Class metadata extraction, isolated from authoritative name/ID matching."""
import re

# This is a display confidence gate only. Class never authorizes or blocks
# identity confirmation, which continues to require only name and student ID.
MIN_CLASS_CONFIDENCE = .90


def class_preview_metadata(extracted, confidence):
    score = confidence.get('class_name')
    readable = bool(extracted.get('class_name')) and (score or 0) >= MIN_CLASS_CONFIDENCE
    return {'class_name': extracted.get('class_name') if readable else None,
            'class_confidence': score, 'class_status': 'READABLE' if readable else 'CLASS_UNREADABLE'}


def clean_class_value(text):
    from app.services.student_card_matching import _clean_text
    return _clean_text(text).lstrip(':：').strip()


def class_rejection(text, *, excluded=()):
    from app.services.student_card_matching import normalize_name, _label, _other_label
    value = clean_class_value(text)
    if not 2 <= len(value) <= 30:
        return 'invalid_length'
    if '@' in value or '://' in value:
        return 'email_or_url'
    if _label(value) or _other_label(value):
        return 'contains_field_label'
    if re.match(r'^(?:kh[oa0d]{1,3}(?:\s+h[oa0]c)?|he|faculty|cohort|department)(?=$|[:：/])', normalize_name(value)):
        return 'contains_field_label'
    if re.fullmatch(r'[\d\s.-]+', value) and len(re.sub(r'\D', '', value)) >= 7:
        return 'student_id_or_date_like'
    if not any(char.isalnum() for char in value) or any(not (char.isalnum() or char in ' -./_()') for char in value):
        return 'invalid_characters'
    if len(value.split()) > 6:
        return 'sentence_like'
    if normalize_name(value) in {normalize_name(item) for item in excluded if item}:
        return 'belongs_to_name_or_major'
    return None


def _boundaries(text):
    """Embedded labels require a delimiter; ordinary value words stay intact."""
    from app.services.student_card_matching import LABELS, OTHER_LABELS, normalize_name
    aliases = [alias for values in LABELS.values() for alias in values] + list(OTHER_LABELS)
    pattern = r'(?<!\w)(?:' + '|'.join(re.escape(alias) for alias in sorted(aliases, key=len, reverse=True)) + r')(?=\s*[:：/])'
    return [match.start() for match in re.finditer(pattern, normalize_name(text))]


def _slice(line, start, end):
    """Use symbol boxes when punctuation and the class share one OCR word."""
    from app.services.student_card_matching import _clean_text, _union_box
    text, cursor, parts, scores = _clean_text(line.text), 0, [], []
    for token in line.tokens:
        word = _clean_text(token.text)
        offset = text.find(word, cursor)
        if offset < 0:
            continue
        cursor = offset + len(word)
        if cursor <= start or offset >= end:
            continue
        scores.append(token.confidence)
        if token.symbols and ''.join(symbol.text for symbol in token.symbols) == word:
            parts.extend(token.symbols[max(0, start-offset):min(len(word), end-offset)])
        else:
            parts.append(token)
    box = _union_box([part.bbox for part in parts])
    # No guessed character geometry for an inline crop without OCR tokens.
    if box is None and start == 0 and end == len(text):
        box = line.bbox
    score = min(scores, default=line.confidence)
    return box, score


def class_labels(line):
    from app.services.student_card_matching import _clean_text, _label, _parts
    text = _clean_text(line.text)
    labels = []
    for start in sorted({0, *_boundaries(text)}):
        labelled = _label(text[start:])
        if labelled and labelled[0] == 'class_name':
            value_start = start + labelled[2]
            box, _ = _slice(line, start, value_start)
            if start == 0:
                box = box or _parts(line, labelled[2])[0]
            labels.append({'start': start, 'value_start': value_start, 'bbox': box, 'text': text[start:value_start].strip()})
    return labels


def _segments(line):
    from app.services.student_card_matching import _clean_text
    text = _clean_text(line.text)
    boundaries = sorted({0, *_boundaries(text), len(text)})
    for start, end in zip(boundaries, boundaries[1:]):
        raw = text[start:end]
        value = clean_class_value(raw)
        offset = start + len(raw) - len(raw.lstrip(' :：'))
        box, confidence = _slice(line, offset, end - len(raw) + len(raw.rstrip()))
        yield value, box, confidence


def embedded_major(line):
    """Handle a class and major emitted together, without changing other fields."""
    from app.services.student_card_matching import _clean_text, _label
    text = _clean_text(line.text)
    for start in _boundaries(text):
        labelled = _label(text[start:])
        if labelled and labelled[0] == 'major' and labelled[1]:
            offset = start+labelled[2]
            end = min((boundary for boundary in _boundaries(text) if boundary > offset), default=len(text))
            _, confidence = _slice(line, offset, end)
            return _clean_text(text[offset:end]), confidence
    return None


def class_candidates(lines, index, label, *, diagnostics=None, include_invalid=False):
    from app.services.student_card_matching import _clean_text, _label, _other_label, _proximity, normalize_name
    candidates = []
    source = lines[index]
    text = _clean_text(source.text)
    boundaries = [start for start in _boundaries(text) if start > label['value_start']]
    end = min(boundaries, default=len(text))
    raw_inline = text[label['value_start']:end]
    inline = clean_class_value(raw_inline)
    if inline:
        start = label['value_start'] + len(raw_inline) - len(raw_inline.lstrip(' :：'))
        box, confidence = _slice(source, start, end - len(raw_inline) + len(raw_inline.rstrip()))
        candidates.append({'text': inline, 'bbox': box, 'confidence': confidence, 'candidate_line': index,
                           'relation': 'inline', 'distance': 0.})
    else:
        for target, line in enumerate(lines):
            if target == index:
                continue
            for value, box, confidence in _segments(line):
                if _label(value) or _other_label(value):
                    continue
                relation = _proximity(label['bbox'], box) if label['bbox'] and box else None
                if label['bbox'] and relation is None:
                    continue
                if not label['bbox'] and target != index + 1:
                    continue
                relation = relation or (1, 0., 'next_line')
                # All fields, including MSSV, own their values. Page order alone
                # never lets a class borrow another label's value.
                owned = False
                for owner_index, owner in enumerate(lines):
                    if owner_index in (index, target) or not owner.bbox:
                        continue
                    labelled = _label(owner.text)
                    if labelled is None and not _other_label(owner.text):
                        continue
                    if labelled and labelled[1]:
                        continue
                    other = _proximity(owner.bbox, box) if box else None
                    if other and (other[2] == 'right', -other[1]) >= (relation[2] == 'right', -relation[1]):
                        owned = True
                        break
                candidates.append({'text': value, 'bbox': box, 'confidence': confidence, 'candidate_line': target,
                                   'relation': relation[2], 'distance': relation[1], 'owned': owned})
    excluded = []
    for line in lines:
        labelled = _label(line.text)
        if labelled and labelled[0] in ('full_name', 'major', 'student_code'):
            if labelled[1]:
                excluded.append(labelled[1])
    for candidate in candidates:
        reason = 'belongs_to_other_label' if candidate.get('owned') else class_rejection(candidate['text'], excluded=excluded)
        candidate['rejection_reason'] = reason
        compact_code = bool(re.search(r'\d', candidate['text']) and any(c.isalpha() for c in candidate['text']))
        candidate['score'] = ({'inline': 3., 'right': 2., 'below': 1., 'next_line': 1., 'below_right': .5}[candidate['relation']]
                              + .5 * candidate['confidence'] + .15 * compact_code - .025 * candidate['distance'])
        if diagnostics is not None:
            diagnostics.append({'event': 'CLASS_CANDIDATE', 'field': 'class_name', 'label_line': index,
                                'label': label['text'], 'label_bbox': label['bbox'], **candidate})
    return sorted((candidate for candidate in candidates if include_invalid or not candidate['rejection_reason']),
                  key=lambda candidate: candidate['score'], reverse=True)


def class_regions(lines):
    regions = []
    for index, line in enumerate(lines):
        for label in class_labels(line):
            # An imperfect global value still supplies pixels for a bounded retry.
            candidates = class_candidates(lines, index, label, include_invalid=True)
            candidates = [candidate for candidate in candidates if candidate['bbox'] and not candidate.get('owned')
                          and candidate['rejection_reason'] not in ('contains_field_label', 'belongs_to_name_or_major', 'student_id_or_date_like')]
            if not candidates:
                # A visible class label may have no global value at all. Retry
                # its same-row value area, clipped before any other field label.
                if label['bbox'] and not line.text[label['value_start']:].strip():
                    left, top, right, bottom = label['bbox']
                    height = bottom-top
                    limit = right+12*height
                    from app.services.student_card_matching import _label, _other_label
                    for other in lines:
                        if other is line or not other.bbox or not (_label(other.text) or _other_label(other.text)):
                            continue
                        if other.bbox[0] > right and abs(other.bbox[1]-top) <= .5*height:
                            limit = min(limit, other.bbox[0]-3)
                    if limit > right+height:
                        regions.append({'field': 'class_name', 'label_line': index, 'candidate_line': index,
                                        'bbox': (right+2, max(0, top-round(height*.2)), limit, bottom),
                                        'numeric': False, 'block': False, 'source': 'missing_class_value'})
                continue
            best = candidates[0]
            if len(candidates) > 1 and abs(best['score']-candidates[1]['score']) < .08:
                continue
            code = bool(re.fullmatch(r'[A-Za-z0-9Đđ_.\-/]+', best['text']) and re.search(r'\d', best['text']))
            box = best['bbox']
            if not code:
                # Sparse OCR may omit the final short word of a named class.
                # Include a small trailing area, stopping before another label.
                from app.services.student_card_matching import _clean_text, _label, _other_label
                height = box[3]-box[1]
                right = box[2]+2*height
                for other in lines:
                    text = _clean_text(other.text)
                    for start in sorted({0, *_boundaries(text)}):
                        labelled = _label(text[start:])
                        if not labelled and not _other_label(text[start:]):
                            continue
                        label_box, _ = _slice(other, start, start+labelled[2] if labelled else len(text))
                        if label_box and label_box[0] > box[2] and abs(label_box[1]-box[1]) <= .5*height:
                            right = min(right, label_box[0]-3)
                box = (box[0], box[1], max(box[2], right), box[3])
            regions.append({'field': 'class_name', 'label_line': index, 'candidate_line': best['candidate_line'],
                            'bbox': box, 'value_bbox': best['bbox'], 'numeric': False, 'block': False, 'class_code': code})
    return regions


def resolve_class(lines, *, diagnostics=None):
    reads = []
    regions = class_regions(lines)
    for index, line in enumerate(lines):
        for label in class_labels(line):
            if diagnostics is not None:
                diagnostics.append({'event': 'CLASS_LABEL', 'field': 'class_name', 'label_line': index,
                                    'text': label['text'], 'bbox': label['bbox'], 'confidence': line.confidence})
            candidates = class_candidates(lines, index, label, diagnostics=diagnostics)
            for candidate in candidates:
                reads.append({**candidate, 'label_line': index, 'source': 'global_ocr'})
            for read in getattr(lines, 'field_ocr', ()):
                if read.field != 'class_name' or read.label_line != index or class_rejection(read.text):
                    continue
                region = next((region for region in regions if region['label_line'] == index
                               and region['candidate_line'] == read.candidate_line and region['bbox'] == read.bbox), None)
                if region is None:
                    continue
                anchor = next((candidate for candidate in class_candidates(lines, index, label, include_invalid=True)
                               if candidate['candidate_line'] == read.candidate_line
                               and candidate['bbox'] == region.get('value_bbox', read.bbox)), None)
                if anchor:
                    reads.append({**anchor, 'text': clean_class_value(read.text), 'confidence': read.confidence,
                                  # A confident value-only code pass breaks a near
                                  # tie with global OCR of a mixed punctuation word.
                                  'score': anchor['score'] + .5*(read.confidence-anchor['confidence'])
                                      + (.01 if region.get('class_code') and read.confidence >= .90 else 0),
                                  'label_line': index, 'source': 'class_roi_ocr'})
                elif region.get('source') == 'missing_class_value':
                    reads.append({'text': clean_class_value(read.text), 'confidence': read.confidence,
                                  'score': 2.+.5*read.confidence, 'label_line': index,
                                  'candidate_line': read.candidate_line, 'bbox': read.bbox, 'source': 'class_roi_ocr'})
    reads.sort(key=lambda read: read['score'], reverse=True)
    best = reads[0] if reads else None
    if best:
        from app.services.student_card_matching import normalize_name
        # A named class whose ROI reveals another word may be a truncated global
        # read. If neither complete pass is clearly stronger, keep it unreadable.
        truncated = best['source'] == 'global_ocr' and any(
            read['source'] == 'class_roi_ocr' and read['label_line'] == best['label_line']
            and read['candidate_line'] == best['candidate_line']
            and len(read['text'].split()) > len(best['text'].split())
            and normalize_name(read['text']) != normalize_name(best['text'])
            and abs(best['confidence']-read['confidence']) < .05 for read in reads)
        # A near-tie between different locations is uncertain; different OCR
        # passes over the same pixels may be ranked by confidence instead.
        rival = next((read for read in reads[1:] if read['text'] != best['text']
                      and (read['label_line'], read['candidate_line'], read['bbox']) !=
                          (best['label_line'], best['candidate_line'], best['bbox'])), None)
        if truncated or (rival and best['score'] - rival['score'] < .08):
            best = None
    if diagnostics is not None:
        diagnostics.append({'event': 'CLASS_RESULT', 'field': 'class_name', 'extracted': best['text'] if best else None,
                            'confidence': best['confidence'] if best else None, 'source': best['source'] if best else None})
    return (best['text'], best['confidence']) if best else (None, None)
