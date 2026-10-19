"""Extract slides in presentation order, following their actual notes relationships."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import posixpath
import zipfile
import xml.etree.ElementTree as ET

NS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}
PACKAGE_NS = '{http://schemas.openxmlformats.org/package/2006/relationships}'


def relationships(archive, part):
    path = PurePosixPath(part)
    rel_path = str(path.parent / '_rels' / (path.name + '.rels'))
    if rel_path not in archive.namelist():
        return {}
    result = {}
    for rel in ET.fromstring(archive.read(rel_path)).findall(PACKAGE_NS + 'Relationship'):
        if rel.attrib.get('TargetMode') == 'External':
            continue
        target = rel.attrib['Target']
        target = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join(str(path.parent), target))
        result[rel.attrib['Id']] = {'part': target, 'type': rel.attrib['Type']}
    return result


def paragraphs(xml):
    values = [''.join(t.text or '' for t in para.findall('.//a:t', NS)) for para in xml.findall('.//a:p', NS)]
    return '\n'.join(value for value in values if value.strip())


def extract_deck(source):
    slides = []
    with zipfile.ZipFile(source) as archive:
        presentation = ET.fromstring(archive.read('ppt/presentation.xml'))
        presentation_rels = relationships(archive, 'ppt/presentation.xml')
        for number, slide_id in enumerate(presentation.findall('p:sldIdLst/p:sldId', NS), 1):
            part = presentation_rels[slide_id.attrib['{' + NS['r'] + '}id']]['part']
            xml = ET.fromstring(archive.read(part))
            rels = relationships(archive, part)
            slide = {'slide': number, 'part': part, 'text': paragraphs(xml), 'images': len(xml.findall('.//a:blip', NS))}
            note_parts = [rel['part'] for rel in rels.values() if rel['type'].endswith('/notesSlide')]
            if note_parts:
                note_xml = ET.fromstring(archive.read(note_parts[0]))
                bodies = []
                for shape in note_xml.findall('.//p:sp', NS):
                    placeholder = shape.find('p:nvSpPr/p:nvPr/p:ph', NS)
                    if placeholder is not None and placeholder.attrib.get('type') in ('sldNum', 'hdr', 'ftr', 'dt'):
                        continue
                    body = paragraphs(shape)
                    if body:
                        bodies.append(body)
                slide['notesPart'] = note_parts[0]
                slide['notes'] = '\n'.join(bodies)
            slides.append(slide)
    return slides


def main():
    base = Path(__file__).resolve().parents[2]
    output = Path(__file__).resolve().parents[1] / 'analysis'
    output.mkdir(exist_ok=True)
    manifest = []
    for source in sorted((base / '수업자료').glob('*.pptx')):
        chapter = int(source.name[:2])
        slides = extract_deck(source)
        data = {'chapter': chapter, 'file': source.name, 'slides': slides}
        (output / f'chapter{chapter}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        text = '\n\n'.join(f'=== 슬라이드 {s["slide"]} (그림 {s["images"]}) ===\n{s["text"]}\n' + (f'발표자노트: {s["notes"]}' if s.get('notes') else '') for s in slides)
        (output / f'chapter{chapter}.txt').write_text(text, encoding='utf-8')
        manifest.append({'chapter': chapter, 'file': source.name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'slides': len(slides), 'images': sum(s['images'] for s in slides), 'textChars': sum(len(s['text']) for s in slides), 'sparseSlides': [s['slide'] for s in slides if len(s['text']) < 80]})
    (output / 'slide-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    main()
