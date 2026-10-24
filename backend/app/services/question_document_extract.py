"""Bounded PDF/DOCX extraction, executed in a disposable subprocess by HTTP routes."""
from io import BytesIO
import base64
from pathlib import Path
import re
from uuid import uuid4
from zipfile import ZipFile

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TEXT_CHARS = 500_000
MAX_PAGES = 200
MIME_TYPES = {'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
QUESTION_START = re.compile(
    r'^\s*(?=(?:(?:Câu(?:\s+hỏi)?|Question)\s*\d+(?:\s*[):\-]|\s*\.(?!\d)|\s+|$)'
    r'|\d+\s*(?:[):\-]|\.(?!\d))))'
    r'(?:(?:Câu(?:\s+hỏi)?|Question)\s*)?(\d+)'
    r'(?:\s*[):\-]\s*|\s*\.(?!\d)\s*|\s+|$)(.*)$', re.I)
MAX_IMAGE_BYTES = 24 * 1024 * 1024
MAX_IMAGES = 250


class DocumentError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(code)


def validate_file(filename: str, mime: str | None, content: bytes) -> str:
    extension = Path(filename.replace('\\', '/')).suffix.lower().lstrip('.')
    if extension not in MIME_TYPES or mime != MIME_TYPES[extension]:
        raise DocumentError('UNSUPPORTED_DOCUMENT', 'Vui lòng tải file PDF hoặc DOCX có đúng định dạng.')
    if not content or len(content) > MAX_FILE_BYTES:
        raise DocumentError('DOCUMENT_TOO_LARGE', 'Tài liệu phải có dữ liệu và không vượt quá 10 MB.')
    return extension


def clean_text(text):
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text).strip()


def extract_document(content: bytes, extension: str) -> dict:
    sections, warnings, images = [], [], []
    page_count = None
    page_count_estimated = False
    total = 0

    def add(text, page, label, image_ids=None, position=None):
        nonlocal total
        text = clean_text(text)
        total += len(text)
        if total > MAX_TEXT_CHARS:
            raise DocumentError('DOCUMENT_TOO_LONG', 'Tài liệu quá dài. Vui lòng tách thành các phần nhỏ hơn.')
        if text or image_ids:
            sections.append({'text': text, 'page': page, 'label': label,
                             'image_ids': image_ids or [], 'position': position})

    def add_image(data, page, position, paragraph=''):
        from PIL import Image
        if len(images) >= MAX_IMAGES:
            raise DocumentError('DOCUMENT_TOO_LARGE', 'Tài liệu có quá nhiều hình ảnh. Vui lòng chia nhỏ file.')
        with Image.open(BytesIO(data)) as image:
            if image.width * image.height > 20_000_000:
                raise DocumentError('DOCUMENT_TOO_LARGE', 'Hình ảnh trong tài liệu vượt giới hạn kích thước.')
            output = BytesIO()
            image.convert('RGBA' if 'A' in image.getbands() else 'RGB').save(output, format='PNG')
            data = output.getvalue()
        if len(data) + sum(item['byte_count'] for item in images) > MAX_IMAGE_BYTES:
            raise DocumentError('DOCUMENT_TOO_LARGE', 'Dung lượng hình ảnh trong tài liệu vượt giới hạn. Vui lòng chia nhỏ file.')
        image_id = str(uuid4())
        images.append({'id': image_id, 'page': page, 'position': position,
                       'nearby_paragraph': paragraph[:1000], 'question_number': None,
                       'mime_type': 'image/png', 'byte_count': len(data),
                       'data_base64': base64.b64encode(data).decode('ascii')})
        return image_id

    try:
        if extension == 'pdf':
            from pypdf import PdfReader
            if not content.lstrip().startswith(b'%PDF-'):
                raise ValueError('Not PDF')
            reader = PdfReader(BytesIO(content), strict=False)
            if reader.is_encrypted:
                raise DocumentError('ENCRYPTED_DOCUMENT', 'PDF có mật khẩu. Vui lòng tải bản không có mật khẩu.')
            if len(reader.pages) > MAX_PAGES:
                raise DocumentError('DOCUMENT_TOO_LONG', 'Chỉ hỗ trợ tài liệu tối đa 200 trang. Vui lòng chia nhỏ file.')
            empty_pages = []
            page_count = len(reader.pages)
            for number, page in enumerate(reader.pages, 1):
                # Coordinates are approximate for complex PDF transforms. Keep
                # page-local reading order, including each image occurrence.
                page_images = {}
                for key in page.images.keys():
                    item = page.images[key]
                    name = key[-1] if isinstance(key, (list, tuple)) else key
                    page_images.setdefault(str(name), []).append(item.data)
                events, used = [], set()

                def visit_text(value, cm, tm, font, size):
                    if not value.strip():
                        return
                    x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
                    y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
                    for line_index, line in enumerate(value.splitlines()):
                        if line.strip():
                            events.append((y - line_index * float(size or 12) * 1.2, x, line, None))

                def visit_operand(operator, args, cm, tm):
                    if operator != b'Do' or not args:
                        return
                    name = str(args[0])
                    candidates = page_images.get(name, [])
                    if len(candidates) != 1:
                        return  # ambiguous nested resource names remain page-only
                    points = [(cm[4], cm[5]), (cm[4] + cm[0], cm[5] + cm[1]),
                              (cm[4] + cm[2], cm[5] + cm[3]),
                              (cm[4] + cm[0] + cm[2], cm[5] + cm[1] + cm[3])]
                    bbox = [round(min(p[0] for p in points), 2), round(min(p[1] for p in points), 2),
                            round(max(p[0] for p in points), 2), round(max(p[1] for p in points), 2)]
                    position = {'bbox': bbox, 'coordinate_system': 'pdf_points_bottom_left', 'approximate': True}
                    image_id = add_image(candidates[0], number, position)
                    used.add(name)
                    events.append((bbox[3], bbox[0], '', image_id))

                text = page.extract_text(visitor_text=visit_text, visitor_operand_before=visit_operand) or ''
                if not text.strip():
                    empty_pages.append(number)
                if events:
                    for y, x, value, image_id in sorted(events, key=lambda item: (-item[0], item[1])):
                        add(value, number, f'Trang {number}', [image_id] if image_id else [],
                            {'x': round(x, 2), 'y': round(y, 2), 'approximate': True})
                else:
                    add(text, number, f'Trang {number}')
                for name, candidates in page_images.items():
                    if name not in used:
                        for data in candidates:
                            image_id = add_image(data, number, None)
                            # No invented question association for unknown positions.
                            add('', number, f'Trang {number}', [image_id], {'association_unknown': True})
            if empty_pages:
                warnings.append('Các trang không có text chưa được đọc: ' + ', '.join(map(str, empty_pages)) + '. Có thể đây là trang ảnh scan.')
        elif extension == 'docx':
            from docx import Document
            with ZipFile(BytesIO(content)) as archive:
                entries = archive.infolist()
                names = {entry.filename for entry in entries}
                if ('word/document.xml' not in names or '[Content_Types].xml' not in names
                        or any('vbaproject' in name.lower() or name.lower().endswith('.bin') for name in names)):
                    raise ValueError('Not a macro-free DOCX')
                if (len(entries) > 3000 or sum(entry.file_size for entry in entries) > 40 * 1024 * 1024
                        or any(entry.flag_bits & 1 for entry in entries)):
                    raise DocumentError('DOCUMENT_TOO_LARGE', 'Nội dung DOCX vượt giới hạn giải nén hoặc có mã hóa.')
            document = Document(BytesIO(content))
            with ZipFile(BytesIO(content)) as archive:
                if 'docProps/app.xml' in archive.namelist():
                    from xml.etree import ElementTree
                    props = ElementTree.fromstring(archive.read('docProps/app.xml'))
                    pages = props.find('{http://schemas.openxmlformats.org/officeDocument/2006/extended-properties}Pages')
                    if pages is not None and pages.text and pages.text.isdigit() and int(pages.text) > 1:
                        page_count, page_count_estimated = int(pages.text), True
            # iter_inner_content preserves paragraphs/table order. DOCX has no
            # reliable rendered page numbers; use actual paragraph/table labels.
            from docx.oxml.ns import qn
            paragraph_index = 0
            section_label = 'Tài liệu Word'
            referenced_parts = set()

            def paragraph(item):
                nonlocal paragraph_index, section_label
                paragraph_index += 1
                if item.style and item.style.name.startswith('Heading') and item.text.strip():
                    section_label = clean_text(item.text)[:255]
                buffer = ''
                for offset, node in enumerate(item._p.iter()):
                    if node.tag == qn('w:t'):
                        buffer += node.text or ''
                    elif node.tag in {qn('w:br'), qn('w:cr')}:
                        buffer += '\n'
                    elif node.tag == qn('w:tab'):
                        buffer += '\t'
                    elif node.tag in {qn('a:blip'), '{urn:schemas-microsoft-com:vml}imagedata'}:
                        relation = node.get(qn('r:embed')) or node.get(qn('r:id'))
                        part = item.part.related_parts.get(relation)
                        if part is None:
                            continue
                        referenced_parts.add(str(part.partname))
                        add(buffer, None, section_label); buffer = ''
                        position = {'paragraph': paragraph_index, 'offset': offset, 'coordinate_system': 'document_order'}
                        try:
                            image_id = add_image(part.blob, None, position, item.text)
                        except (OSError, ValueError):
                            raise DocumentError('UNSUPPORTED_DOCUMENT_IMAGE', 'Một hình ảnh Word không đọc được. Vui lòng chuyển hình sang PNG/JPEG rồi tải lại.') from None
                        add('', None, section_label, [image_id], position)
                add(buffer, None, section_label)

            def contents(container):
                for item in container.iter_inner_content():
                    if hasattr(item, '_p'):
                        paragraph(item)
                    else:
                        seen = set()
                        for row in item.rows:
                            for cell in row.cells:
                                if cell._tc not in seen:
                                    seen.add(cell._tc); contents(cell)
            contents(document)
            # Keep media embedded outside the body (e.g. header/footer) available
            # for review, without assigning it to the last body question.
            for part in document.part.package.parts:
                if (part.content_type.startswith('image/') and str(part.partname).startswith('/word/media/')
                        and str(part.partname) not in referenced_parts):
                    position = {'location': 'document_media', 'association_unknown': True}
                    try:
                        image_id = add_image(part.blob, None, position)
                    except (OSError, ValueError):
                        raise DocumentError('UNSUPPORTED_DOCUMENT_IMAGE', 'Một hình ảnh Word không đọc được. Vui lòng chuyển hình sang PNG/JPEG rồi tải lại.') from None
                    add('', None, 'Tài liệu Word', [image_id], position)
        else:
            raise ValueError('Unsupported format')
    except DocumentError:
        raise
    except Exception as exc:
        raise DocumentError('CORRUPT_DOCUMENT', 'Không đọc được tài liệu. File có thể bị hỏng hoặc sai định dạng.') from exc
    if not any(section['text'] for section in sections):
        raise DocumentError('DOCUMENT_HAS_NO_TEXT', 'Tài liệu không có text đọc được. Với PDF scan, vui lòng dùng bản có text hoặc chuyển đổi trước khi tải.')
    # Split text at actual lines so pictures between paragraphs/runs remain
    # associated with the preceding question, never the whole document.
    ordered, current_number, nearby, current_page = [], None, '', None
    question_key = 0
    by_id = {item['id']: item for item in images}
    for section in sections:
        if section['page'] != current_page:
            current_page = section['page']; nearby = ''
        for line in section['text'].splitlines():
            heading = QUESTION_START.match(line)
            if heading:
                current_number = int(heading[1])
                question_key += 1
            label = f'Câu {current_number}' if current_number is not None else section['label']
            ordered.append({**section, 'text': line, 'image_ids': [], 'label': label, 'question_number': current_number,
                            'question_key': question_key or None})
            if line.strip():
                nearby = line
        if section['image_ids']:
            known = not (section.get('position') or {}).get('association_unknown')
            for image_id in section['image_ids']:
                by_id[image_id]['nearest_section'] = section['label']
                by_id[image_id]['question_number'] = current_number if known else None
                by_id[image_id]['nearby_paragraph'] = by_id[image_id]['nearby_paragraph'] or (nearby[:1000] if known else '')
            ordered.append({**section, 'question_number': current_number if known else None,
                            'question_key': (question_key or None) if known else None,
                            'label': f'Câu {current_number}' if known and current_number is not None else section['label']})
    text = '\n'.join(section['text'] for section in ordered if section['text'])
    return {'sections': ordered, 'warnings': warnings, 'character_count': len(text),
            'images': images, 'image_count': len(images), 'page_count': page_count,
            'page_count_estimated': page_count_estimated, 'file_type': extension}


def chunk_sections(sections: list[dict], max_chars=2400) -> list[dict]:
    chunks = []
    grouped = []
    first_label = ''
    question_images = {}
    for section in sections:
        if section.get('question_key') is not None:
            question_images.setdefault(section['question_key'], []).extend(section.get('image_ids', []))
    for section in sections:
        # DOCX paragraphs often contain only a heading. Keep that heading with
        # its following text instead of asking the provider about it alone.
        if (grouped and section['page'] == grouped[-1]['page']
                and section.get('question_number') == grouped[-1].get('question_number')
                and section.get('question_key') == grouped[-1].get('question_key')
                and len(grouped[-1]['text']) + 1 + len(section['text']) <= max_chars):
            grouped[-1]['text'] += '\n' + section['text']
            if section['label'] != first_label and section.get('question_number') is None:
                grouped[-1]['label'] = first_label + ' – ' + section['label']
            grouped[-1]['image_ids'] = list(dict.fromkeys(grouped[-1].get('image_ids', []) + section.get('image_ids', [])))
        else:
            grouped.append(dict(section))
            first_label = section['label']
    for section in grouped:
        text = section['text']
        offset = 0
        while offset < len(text):
            end = min(offset + max_chars, len(text))
            if end < len(text):
                split = text.rfind(' ', offset + max_chars // 2, end)
                if split >= 0:
                    end = split
            part = text[offset:end].strip()
            if part:
                chunks.append({'id': f'chunk-{len(chunks) + 1}', 'text': part,
                               'page': section['page'], 'label': section['label'],
                               'image_ids': list(dict.fromkeys(question_images.get(section.get('question_key'), section.get('image_ids', [])))),
                               'question_number': section.get('question_number'), 'question_key': section.get('question_key')})
            offset = end
    return chunks
