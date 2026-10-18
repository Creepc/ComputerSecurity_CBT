from pathlib import Path
import zipfile, re, json, xml.etree.ElementTree as ET

base = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parents[1] / 'analysis'
ns = {'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
manifest=[]
for p in sorted((base/'수업자료').glob('*.pptx')):
    chapter=int(p.name[:2]); slides=[]
    with zipfile.ZipFile(p) as z:
        names=sorted([n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+.xml', n)], key=lambda n:int(re.search(r'(\d+)\.xml',n).group(1)))
        for n in names:
            number=int(re.search(r'(\d+)\.xml',n).group(1))
            root=ET.fromstring(z.read(n))
            paragraphs=[''.join(x.itertext()) for x in []]
            paragraphs=[''.join(t.text or '' for t in para.findall('.//a:t',ns)) for para in root.findall('.//a:p',ns)]
            text='\n'.join(t for t in paragraphs if t.strip())
            slide={'slide':number,'text':text,'images':len(root.findall('.//{http://schemas.openxmlformats.org/presentationml/2006/main}pic'))}
            note=f'ppt/notesSlides/notesSlide{number}.xml'
            if note in z.namelist():
                slide['notes']='\n'.join(t.text or '' for t in ET.fromstring(z.read(note)).findall('.//a:t',ns))
            slides.append(slide)
    (out/f'chapter{chapter}.json').write_text(json.dumps({'chapter':chapter,'file':p.name,'slides':slides},ensure_ascii=False,indent=2),encoding='utf-8')
    (out/f'chapter{chapter}.txt').write_text('\n\n'.join(f'=== 슬라이드 {s["slide"]} (그림 {s["images"]}) ===\n{s["text"]}\n'+(f'발표자노트: {s["notes"]}' if s.get('notes') else '') for s in slides),encoding='utf-8')
    manifest.append({'chapter':chapter,'file':p.name,'slides':len(slides),'images':sum(s['images'] for s in slides),'textChars':sum(len(s['text']) for s in slides),'sparseSlides':[s['slide'] for s in slides if len(s['text'])<80]})
(out/'slide-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False))
