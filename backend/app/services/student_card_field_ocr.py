"""Value ROI recognition. Only the offline OCR worker imports imaging libraries."""
from app.services.student_card_matching import (
    _clean_text, _code_rejection, _label, best_name_read, field_regions, name_rejection,
)

CODE_CHARSETS = {
    'numeric': '0123456789',
    'alphanumeric': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
}
CLASS_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-./_Đđ'
MAX_REGIONS = 12
NAME_PREPROCESSING = frozenset(f'name-{variant}-{scale}x'
    for variant in ('original', 'gray', 'contrast-sharpen', 'clahe', 'mild-threshold')
    for scale in (2, 3))


def recover_class_labels(image, lines, engine, read_rows, *, diagnostics=None):
    """Search left of short code rows only; accept an actual OCR class label.

    A partial label can anchor a small full-row retry. No code is ever accepted
    from its shape or card position alone, and global observations stay intact.
    """
    import re
    from PIL import Image, ImageEnhance, ImageOps
    from app.services.student_card_class import class_labels, class_rejection
    from app.services.student_card_matching import normalize_name
    if any(class_labels(line) for line in lines):
        return []
    anchors = []
    for line in lines:
        if not line.bbox:
            continue
        partial = re.match(r'^(?:op|l[oe0]p)\s*[:：]', normalize_name(line.text)) is not None
        code = not class_rejection(line.text) and any(c.isalpha() for c in line.text) and any(c.isdigit() for c in line.text)
        if partial or (code and _label(line.text) is None):
            anchors.append((line, partial))
    for line, partial in anchors[:8]:
        left, top, right, bottom = line.bbox
        height = bottom-top
        box = (max(0, left-(4 if partial else 12)*height), max(0, top-max(2, round(height*.25))),
               min(image.width, right+20*height) if partial else max(1, left-2),
               min(image.height, bottom+max(2, round(height*.35))))
        crop = image.crop(box)
        for scale in (2, 3):
            gray = ImageEnhance.Contrast(ImageOps.autocontrast(ImageOps.grayscale(crop), cutoff=.5)).enhance(1.1)
            roi = ImageOps.expand(gray.resize((crop.width*scale, crop.height*scale), Image.Resampling.LANCZOS), border=10, fill=255)
            try:
                engine.SetPageSegMode(7)
                engine.SetVariable('tessedit_char_whitelist', '')
                engine.SetImage(roi)
                engine.Recognize()
                rows = read_rows(engine)
            except (RuntimeError, ValueError, OSError):
                rows = []
            finally:
                engine.Clear()
            recognized = [row for row in rows if (label := _label(row['text'])) and label[0] == 'class_name']
            if not recognized:
                continue
            def restore(item):
                import math
                if item.get('bbox'):
                    item['bbox'] = tuple(max(0, min(image.width if i%2 == 0 else image.height,
                        (box[0] if i%2 == 0 else box[1]) + (math.floor if i < 2 else math.ceil)((value-10)/scale)))
                        for i, value in enumerate(item['bbox']))
                for key in ('tokens', 'symbols'):
                    for child in item.get(key, ()):
                        restore(child)
            for row in recognized:
                restore(row)
            if diagnostics is not None:
                diagnostics.append({'stage': 'class_label_recovery', 'status': 'read', 'scale': scale})
            return recognized
    if diagnostics is not None:
        diagnostics.append({'stage': 'class_label_recovery', 'status': 'unreadable'})
    return []


def recover_name_labels(image, lines, engine, read_rows, *, diagnostics=None, name_debug=False):
    """Read faint labels immediately left of possible name rows.

    An alphabetic row is only a search anchor: it is never accepted without an
    actual recognized name label. Return original-image coordinates for every
    label, word and symbol; no other field's global OCR is replaced.
    """
    from PIL import Image, ImageEnhance, ImageOps
    if any((label := _label(line.text)) and label[0] == 'full_name' for line in lines):
        return []
    anchors = [line for line in lines if line.bbox and not name_rejection(line.text)
               and line.bbox[0] > 3 * (line.bbox[3] - line.bbox[1])][:8]
    for line in anchors:
        left, top, _, bottom = line.bbox
        height = bottom - top
        origin = (max(0, left - 12 * height), max(0, top - max(8, round(height * .5))))
        crop = image.crop((*origin, max(origin[0]+1, left-max(2, round(height*.12))),
                           min(image.height, bottom+max(4, round(height*.25)))))
        if diagnostics is not None and name_debug:
            diagnostics.append({'event': 'NAME_CANDIDATE', 'source': 'label_search_anchor',
                'text': line.text, 'confidence': line.confidence, 'bbox': line.bbox,
                'tokens': [{'text': word.text, 'confidence': word.confidence, 'bbox': word.bbox}
                           for word in line.tokens], 'detected_label': None,
                'candidate_value': line.text, 'reject_reason': 'name_label_not_yet_recognized'})
        for scale in (2, 3):
            gray = ImageOps.grayscale(crop)
            gray = ImageEnhance.Contrast(ImageOps.autocontrast(gray, cutoff=.5)).enhance(1.1)
            roi = ImageOps.expand(gray.resize((crop.width*scale, crop.height*scale),
                                  Image.Resampling.LANCZOS), border=10, fill=255)
            try:
                engine.SetPageSegMode(7)
                engine.SetVariable('tessedit_char_whitelist', '')
                engine.SetImage(roi)
                engine.Recognize()
                rows = read_rows(engine)
            except (RuntimeError, ValueError, OSError):
                rows = []
            finally:
                engine.Clear()
            for row in rows:
                label = _label(row['text'])
                if not label or label[0] != 'full_name' or label[1]:
                    continue
                def translate(observation):
                    box = observation.get('bbox')
                    if box:
                        observation['bbox'] = tuple(max(0, min(image.width if i % 2 == 0 else image.height,
                            round((value-10)/scale + origin[i % 2]))) for i, value in enumerate(box))
                    for child in observation.get('tokens', observation.get('symbols', [])):
                        translate(child)
                translate(row)
                if diagnostics is not None:
                    diagnostics.append({'stage': 'name_label_recovery', 'status': 'read', 'scale': scale})
                return [row]
    if diagnostics is not None:
        diagnostics.append({'stage': 'name_label_recovery', 'status': 'unreadable'})
    return []


def name_roi_variants(image, bbox):
    """Pad above the value box: global OCR can omit detached tone marks."""
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps
    try:
        import cv2
        import numpy as np
    except ImportError:
        # Optional CLAHE cannot turn otherwise usable recognition into OCR_FAILED.
        cv2 = None

    left, top, right, bottom = bbox
    height = bottom - top
    side = max(2, round(height * .12))
    crop = image.crop((max(0, left - side), max(0, top - max(8, round(height * .5))),
                       min(image.width, right + side), min(image.height, bottom + max(4, round(height * .25)))))
    for scale in (2, 3):
        original = crop.resize((crop.width * scale, crop.height * scale), Image.Resampling.LANCZOS)
        gray = ImageOps.grayscale(original)
        contrast = ImageEnhance.Contrast(ImageOps.autocontrast(gray, cutoff=.5)).enhance(1.1)
        sharpened = contrast.filter(ImageFilter.UnsharpMask(radius=1, percent=50, threshold=3))
        # Blend instead of forcing a binary image that can erase tone marks.
        mild_threshold = Image.blend(gray, _otsu(gray), .35)
        variants = [('original', original), ('gray', gray), ('contrast-sharpen', sharpened)]
        if cv2 is not None:
            try:
                clahe = Image.fromarray(cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 2)).apply(np.asarray(gray)))
                variants.append(('clahe', clahe.filter(ImageFilter.UnsharpMask(radius=1, percent=50, threshold=3))))
            except cv2.error:
                pass
        variants.append(('mild-threshold', mild_threshold))
        for variant, value in variants:
            yield (ImageOps.expand(value, border=10, fill='white' if value.mode == 'RGB' else 255),
                   f'name-{variant}-{scale}x')


def preprocess_roi(image, bbox, scale):
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps
    left, top, right, bottom = bbox
    # Preserve accents above the text, while avoiding neighboring labels.
    padding = max(2, round((bottom - top) * .12))
    crop = image.crop((max(0, left - padding), max(0, top - padding),
                       min(image.width, right + padding), min(image.height, bottom + padding)))
    crop = crop.resize((crop.width * scale, crop.height * scale), Image.Resampling.LANCZOS)
    gray = ImageOps.grayscale(crop)
    contrast = ImageEnhance.Contrast(ImageOps.autocontrast(gray, cutoff=.5)).enhance(1.1)
    sharpened = contrast.filter(ImageFilter.UnsharpMask(radius=1, percent=50, threshold=3))
    return ImageOps.expand(sharpened, border=10, fill=255)


def _otsu(image):
    histogram = image.histogram()
    total = sum(histogram)
    weighted = sum(level * count for level, count in enumerate(histogram))
    weight, moment, best, threshold = 0, 0, -1, 127
    for level, count in enumerate(histogram):
        weight += count
        moment += level * count
        if not weight or weight == total:
            continue
        variance = weight * (total - weight) * (moment / weight - (weighted - moment) / (total - weight)) ** 2
        if variance > best:
            best, threshold = variance, level
    return image.point(lambda pixel: 255 if pixel > threshold else 0)


def recognize_fields(image, lines, engines, read_rows, *, code_charset='alphanumeric', diagnostics=None, name_debug=False):
    """Try unthresholded crops first. Keep threshold only when confidence rises.

    No profile data, canonical substitutions, or ID character conversions are
    available to this function. Each engine has its own language/configuration.
    """
    if code_charset not in CODE_CHARSETS:
        raise ValueError('Unsupported student code charset')
    results = []
    regions = field_regions(lines)[:MAX_REGIONS]
    if diagnostics is not None:
        diagnostics.append({'stage': 'field_roi_detection', 'status': 'ok', 'regions': len(regions)})
    for region in regions:
        field = region['field']
        charset = 'numeric' if field == 'student_code' and region['numeric'] else code_charset
        languages = ('eng',) if field == 'student_code' else ('vie',) if field == 'full_name' else ('vie+eng', 'vie', 'eng') if field == 'class_name' else ('vie', 'vie+eng')
        best = None
        name_reads = []

        def attempt(crop, language, psm, preprocessing):
            nonlocal best
            engine = engines[language]
            engine.SetPageSegMode(psm)
            whitelist = CODE_CHARSETS[charset] if field == 'student_code' else CLASS_CODE_CHARSET if field == 'class_name' and region.get('class_code') else ''
            engine.SetVariable('tessedit_char_whitelist', whitelist)
            try:
                engine.SetImage(crop)
                engine.Recognize()
                rows = read_rows(engine)
            finally:
                engine.Clear()
            # Multiple numeric words/lines stay separated; never concatenate
            # numbers or silently remove a character excluded by validation.
            text = _clean_text(' '.join(row['text'] for row in rows))
            scores = [word['confidence'] for row in rows for word in row['tokens']]
            if not text or not scores or len(text) > 512:
                return
            if field == 'student_code' and _code_rejection(text) is not None:
                return
            if field == 'class_name':
                from app.services.student_card_class import clean_class_value, class_rejection
                text = clean_class_value(text)
                if class_rejection(text):
                    return
            # Names are a complete text line. Keep per-word minima for IDs;
            # name confidence is the mean of the recognized words, as for a
            # Tesseract text line, with completeness checked separately.
            confidence = sum(scores) / len(scores) if field == 'full_name' else min(scores)
            if diagnostics is not None and field == 'full_name':
                diagnostics.append({'stage': 'name_roi_variant', 'preprocessing': preprocessing,
                                    'language': language, 'psm': psm, 'confidence': confidence,
                                    'label_line': region['label_line']})
                if name_debug:
                    diagnostics.append({'event': 'NAME_CANDIDATE', 'source': 'name_roi_ocr',
                        'text': text, 'confidence': confidence, 'bbox': region['bbox'],
                        'token_coordinate_system': 'upscaled_roi',
                        'tokens': [word for row in rows for word in row['tokens']],
                        'detected_label': lines[region['label_line']].text if region.get('source') != 'card_name_layout' else None,
                        'layout_anchor': lines[region['label_line']].text if region.get('source') == 'card_name_layout' else None,
                        'candidate_value': text, 'reject_reason': name_rejection(text),
                        'preprocessing': preprocessing})
            if field == 'full_name':
                name_reads.append({**region, 'text': text, 'confidence': confidence,
                                   'language': language, 'psm': psm, 'preprocessing': preprocessing})
                best = best_name_read(name_reads)
                return
            if best is None or confidence > best['confidence']:
                best = {**region, 'text': text, 'confidence': confidence,
                        'language': language, 'psm': psm, 'preprocessing': preprocessing}

        try:
            if field == 'full_name':
                for crop, variant in name_roi_variants(image, region['bbox']):
                    try:
                        attempt(crop, 'vie', 6 if region['block'] else 7, variant)
                    except (RuntimeError, ValueError, OSError):
                        continue
            else:
                for scale in (2, 3):
                    crop = preprocess_roi(image, region['bbox'], scale)
                    for language in languages:
                        attempt(crop, language, 6 if region['block'] else 7, f'gray-contrast-sharpen-{scale}x')
                        if field not in ('student_code', 'class_name') and not region['block'] and (best is None or best['confidence'] < .90):
                            attempt(crop, language, 6, f'gray-contrast-sharpen-{scale}x')
                if field != 'class_name' and (best is None or best['confidence'] < .90):
                    crop = _otsu(preprocess_roi(image, region['bbox'], 3))
                    for language in languages:
                        attempt(crop, language, 6 if region['block'] else 7, 'otsu-3x')
        except (RuntimeError, ValueError, OSError):
            # A failed optional field pass cannot discard usable global OCR.
            pass
        if diagnostics is not None:
            diagnostics.append({'stage': 'student_code_roi_ocr' if field == 'student_code' else 'field_roi_ocr',
                                'field': field, 'label_line': region['label_line'],
                                'candidate_line': region['candidate_line'],
                                'status': 'read' if best else 'unreadable',
                                'confidence': best['confidence'] if best else None})
        if best:
            results.append(best)
    return results
