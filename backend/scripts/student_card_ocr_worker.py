"""Persistent offline OCR worker. IPC only; no HTTP server or user file paths."""
import base64
import contextlib
import hashlib
import json
import math
import os
from pathlib import Path
import socket
import sys

ROOT = Path(__file__).resolve().parents[1] / 'models' / 'ocr'
MODEL_VERSION = 'tesseract-5.5.2-vie-eng-e12c65a'
EXPECTED_MODELS = {
    'vie.traineddata': 'b6b49293d95d0b6dbd8780174627e82c75be957b6f4ed9862155540d6b00bb45',
    'eng.traineddata': '8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba',
}


def read_rows(engine):
    from tesserocr import RIL
    iterator = engine.GetIterator()
    rows, row, word = [], None, None
    if iterator:
        while True:
            if row is None or iterator.IsAtBeginningOf(RIL.TEXTLINE):
                row = {'text': (iterator.GetUTF8Text(RIL.TEXTLINE) or '').strip(),
                       'confidence': max(0., min(1., iterator.Confidence(RIL.TEXTLINE) / 100)),
                       'bbox': iterator.BoundingBox(RIL.TEXTLINE), 'tokens': []}
                if row['text']:
                    rows.append(row)
            if word is None or iterator.IsAtBeginningOf(RIL.WORD):
                word = {'text': (iterator.GetUTF8Text(RIL.WORD) or '').strip(),
                        'confidence': max(0., min(1., iterator.Confidence(RIL.WORD) / 100)),
                        'bbox': iterator.BoundingBox(RIL.WORD), 'symbols': []}
                if word['text']:
                    row['tokens'].append(word)
            try:
                symbol = iterator.GetUTF8Text(RIL.SYMBOL)
                box = iterator.BoundingBox(RIL.SYMBOL)
                if symbol and symbol.strip() and box and box[2] > box[0] and box[3] > box[1]:
                    word['symbols'].append({'text': symbol,
                        'confidence': max(0., min(1., iterator.Confidence(RIL.SYMBOL) / 100)),
                        'bbox': box})
            except RuntimeError:
                # Some glyphs have no usable component geometry. Word/line
                # recognition remains usable; symbol boxes are optional.
                pass
            if not iterator.Next(RIL.SYMBOL):
                break
    return rows


def original_coordinates(rows, scale, width, height):
    """Scale line/word/symbol boxes together; all parser geometry stays original."""
    def convert(observation):
        box = observation.get('bbox')
        if box:
            observation['bbox'] = tuple(max(0, min(width if i % 2 == 0 else height,
                (math.floor if i < 2 else math.ceil)(value / scale))) for i, value in enumerate(box))
        for key in ('tokens', 'symbols'):
            if key in observation:
                observation[key] = [child for child in observation[key] if convert(child)]
        box = observation.get('bbox')
        return not box or box[2] > box[0] and box[3] > box[1]
    return [row for row in rows if convert(row)]


def observations_from_rows(rows):
    from app.services.student_card_matching import OCRLine, OCRToken
    return [OCRLine(row['text'], row['confidence'], row['bbox'], tuple(
        OCRToken(word['text'], word['confidence'], word['bbox'], tuple(
            OCRToken(symbol['text'], symbol['confidence'], symbol['bbox'])
            for symbol in word.get('symbols', ()))) for word in row['tokens'])) for row in rows]


def recognize_global(image, engine, read, diagnostics):
    """Retry sparse OCR on a gently enhanced 2x image if required fields are lost.

    Select a complete OCR pass by image evidence, never concatenate passes or
    consult profile data. ROI recognition still runs on original-image pixels.
    """
    from PIL import Image, ImageOps
    from app.services.student_card_matching import parse_fields
    def quality(rows):
        fields, confidence = parse_fields(observations_from_rows(rows))
        return (sum(bool(fields[field]) for field in ('full_name', 'student_code')),
                sum(confidence[field] or 0 for field in ('full_name', 'student_code')))
    engine.SetPageSegMode(11)
    engine.SetImage(image)
    engine.Recognize()
    rows = read(engine)
    diagnostics.append({'stage': 'global_ocr', 'status': 'ok' if rows else 'empty',
                        'lines': len(rows), 'scale': 1})
    if quality(rows)[0] == 2:
        return rows
    # Bound memory for large uploads. Small card text benefits from 2x; large
    # images already have sufficient pixels and receive only contrast recovery.
    scale = 2 if image.width * image.height * 4 <= 4_000_000 else 1
    gray = ImageOps.autocontrast(ImageOps.grayscale(image), cutoff=.5)
    if scale != 1:
        gray = gray.resize((image.width * scale, image.height * scale), Image.Resampling.LANCZOS)
    try:
        engine.Clear()
        engine.SetImage(gray)
        engine.Recognize()
        retry = original_coordinates(read(engine), scale, image.width, image.height)
        selected = quality(retry) > quality(rows)
        diagnostics.append({'stage': 'global_ocr_retry', 'status': 'selected' if selected else 'original_retained',
                            'preprocessing': 'gray-autocontrast', 'scale': scale, 'lines': len(retry),
                            'bbox_coordinate_system': 'original_image'})
        return retry if selected else rows
    except (RuntimeError, ValueError, OSError):
        diagnostics.append({'stage': 'global_ocr_retry', 'status': 'failed_original_retained'})
        return rows


def main():
    manifest = json.loads((ROOT / 'tessdata/manifest.json').read_text(encoding='utf-8'))
    if manifest.get('sha256') != EXPECTED_MODELS:
        raise RuntimeError('Unexpected OCR model manifest')
    for file, checksum in EXPECTED_MODELS.items():
        if hashlib.sha256((ROOT / 'tessdata' / file).read_bytes()).hexdigest() != checksum:
            raise RuntimeError('OCR model integrity check failed')
    # Block Internet sockets inside the isolated worker, including attempted
    # model metadata checks. All model paths are supplied explicitly below.
    def offline_connect(*_args, **_kwargs):
        raise OSError('OCR worker network is disabled')
    socket.socket.connect = offline_connect
    socket.socket.connect_ex = offline_connect
    protocol = sys.stdout
    with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
        from io import BytesIO
        from PIL import Image, ImageOps
        from tesserocr import PyTessBaseAPI, PSM, OEM
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from app.services.student_card_field_ocr import recognize_fields, recover_name_labels, recover_class_labels
        from app.services.student_card_matching import OCRLine, OCRToken
        engine = PyTessBaseAPI(path=str(ROOT / 'tessdata'), lang='vie+eng',
                              psm=PSM.SPARSE_TEXT, oem=OEM.LSTM_ONLY)
        engine.SetVariable('classify_enable_learning', '0')
        field_engines = {language: PyTessBaseAPI(path=str(ROOT / 'tessdata'), lang=language,
            psm=PSM.SINGLE_LINE, oem=OEM.LSTM_ONLY,
            variables={'load_system_dawg': '0', 'load_freq_dawg': '0'} if language == 'eng' else {})
            for language in ('eng', 'vie', 'vie+eng')}
        for field_engine in field_engines.values():
            field_engine.SetVariable('classify_enable_learning', '0')
        protocol.write(json.dumps({'ready': True, 'version': MODEL_VERSION}) + '\n')
        protocol.flush()
        for line in sys.stdin:
            request = json.loads(line)
            image = base64.b64decode(request['image'], validate=True)
            if len(image) > 8 * 1024 * 1024:
                result = {'id': request['id'], 'error': 'OCR_FAILED'}
            else:
                try:
                    with Image.open(BytesIO(image)) as source:
                        oriented = ImageOps.exif_transpose(source).convert('RGB')
                    diagnostics = []
                    rows = recognize_global(oriented, engine, read_rows, diagnostics)
                    observations = observations_from_rows(rows)
                    global_line_count = len(rows)
                    try:
                        recovered = recover_name_labels(oriented, observations, field_engines['vie+eng'],
                                                        read_rows, diagnostics=diagnostics,
                                                        name_debug=request.get('name_debug') is True)
                        for row in recovered:
                            rows.append(row)
                            observations.append(OCRLine(row['text'], row['confidence'], row['bbox'], tuple(
                                OCRToken(word['text'], word['confidence'], word['bbox']) for word in row['tokens'])))
                    except (RuntimeError, ValueError, TypeError, OSError):
                        diagnostics.append({'stage': 'name_label_recovery', 'status': 'failed_global_retained'})
                    try:
                        recovered = recover_class_labels(oriented, observations, field_engines['vie+eng'], read_rows, diagnostics=diagnostics)
                        rows.extend(recovered)
                        observations.extend(observations_from_rows(recovered))
                    except (RuntimeError, ValueError, TypeError, OSError):
                        diagnostics.append({'stage': 'class_label_recovery', 'status': 'failed_global_retained'})
                    try:
                        fields = recognize_fields(oriented, observations, field_engines, read_rows,
                            code_charset=request.get('code_charset', 'alphanumeric'), diagnostics=diagnostics,
                            name_debug=request.get('name_debug') is True)
                        diagnostics.append({'stage': 'field_ocr', 'status': 'ok', 'fields': len(fields)})
                    except (RuntimeError, ValueError, TypeError, OSError):
                        fields = []
                        diagnostics.append({'stage': 'field_ocr', 'status': 'failed_global_retained'})
                    result = {'id': request['id'], 'lines': rows, 'field_ocr': fields, 'global_line_count': global_line_count,
                              'diagnostics': diagnostics}
                except (RuntimeError, ValueError, OSError):
                    result = {'id': request['id'], 'error': 'OCR_FAILED'}
                finally:
                    engine.Clear()
            protocol.write(json.dumps(result, ensure_ascii=True) + '\n')
            protocol.flush()


if __name__ == '__main__':
    main()
