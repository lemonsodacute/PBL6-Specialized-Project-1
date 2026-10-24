"""Deterministic course material: text, a table and a genuine topology diagram."""
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Inches
from pypdf import PdfWriter
from pypdf.generic import NameObject, NumberObject, DecodedStreamObject, DictionaryObject


def topology_png():
    image = Image.new('RGB', (900, 500), 'white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('arial.ttf', 28) if Path('C:/Windows/Fonts/arial.ttf').exists() else ImageFont.load_default(size=28)
    boxes = {'SW1': (350, 180, 550, 260), 'PC1': (40, 360, 220, 440),
             'PC2': (360, 360, 540, 440), 'PC3': (680, 360, 860, 440), 'R1': (350, 30, 550, 110)}
    for name in ('PC1', 'PC2', 'PC3', 'R1'):
        box = boxes[name]
        draw.line([(450, 220), ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2)], fill='#334155', width=5)
    for name, box in boxes.items():
        draw.rounded_rectangle(box, radius=10, fill='#e0f2f1', outline='#0f766e', width=4)
        draw.text(((box[0] + box[2]) // 2, (box[1] + box[3]) // 2), name, font=font, fill='#134e4a', anchor='mm')
    output = BytesIO(); image.save(output, 'PNG'); return output.getvalue()


TEXT = 'IPv4 addresses contain 32 bits. Ethernet connects devices in a local network. A switch forwards Ethernet frames using MAC addresses. A router forwards packets between IP networks.'
CAPTION = 'Question 1: Using only the topology diagram, how many PCs are directly connected to SW1?'
OPTIONS = ['A. 2 PCs', 'B. 3 PCs', 'C. 4 PCs', 'D. 5 PCs']


def review_docx():
    doc = Document(); doc.add_heading('Network fundamentals', level=1); doc.add_paragraph(TEXT)
    table = doc.add_table(rows=3, cols=2)
    for row, values in zip(table.rows, [('Device', 'Function'), ('Switch', 'Forwards frames by MAC address'), ('Router', 'Forwards packets between IP networks')]):
        for cell, value in zip(row.cells, values): cell.text = value
    doc.add_heading('Topology review', level=1)
    doc.add_paragraph(CAPTION); doc.add_picture(BytesIO(topology_png()), width=Inches(6))
    for option in OPTIONS: doc.add_paragraph(option)
    output = BytesIO(); doc.save(output); return output.getvalue()


def review_pdf():
    writer = PdfWriter()
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    font_ref = writer._add_object(font)
    for number in (1, 2):
        page = writer.add_blank_page(width=612, height=792)
        resources = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font_ref})})
        lines = ['Network fundamentals', *TEXT.split('. '), 'Device | Function', 'Switch | MAC forwarding', 'Router | IP forwarding'] if number == 1 else [CAPTION, *OPTIONS]
        commands = []
        for i, line in enumerate(lines):
            y = 740 - i * 22 if number == 1 or i == 0 else 290 - i * 22
            commands.append(f'BT /F1 10 Tf 30 {y} Td ({line}) Tj ET')
        if number == 2:
            picture = Image.open(BytesIO(topology_png())).convert('RGB')
            stream = DecodedStreamObject(); stream.set_data(picture.tobytes())
            stream.update({NameObject('/Type'): NameObject('/XObject'), NameObject('/Subtype'): NameObject('/Image'),
                NameObject('/Width'): NumberObject(picture.width), NameObject('/Height'): NumberObject(picture.height),
                NameObject('/ColorSpace'): NameObject('/DeviceRGB'), NameObject('/BitsPerComponent'): NumberObject(8)})
            resources[NameObject('/XObject')] = DictionaryObject({NameObject('/Topology'): writer._add_object(stream)})
            commands.append('q 540 0 0 300 30 380 cm /Topology Do Q')
        page[NameObject('/Resources')] = resources
        content = DecodedStreamObject(); content.set_data('\n'.join(commands).encode('ascii'))
        page[NameObject('/Contents')] = writer._add_object(content)
    output = BytesIO(); writer.write(output); return output.getvalue()


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures'
    root.mkdir(exist_ok=True)
    (root / 'ai-review-topology.docx').write_bytes(review_docx())
    (root / 'ai-review-topology.pdf').write_bytes(review_pdf())
    print('Created ai-review-topology.docx and ai-review-topology.pdf in backend/tests/fixtures.')
