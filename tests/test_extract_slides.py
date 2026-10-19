"""Regression for custom slide names, orphan parts, slide order and notes IDs."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('extract_slides', Path(__file__).resolve().parents[1] / 'scripts' / 'extract_slides.py')
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)
P = extractor.NS['p']
A = extractor.NS['a']
R = extractor.NS['r']
REL = extractor.PACKAGE_NS[1:-1]


def slide(text):
    return f'<p:sld xmlns:p="{P}" xmlns:a="{A}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'


class SlideExtractionTest(unittest.TestCase):
    def test_presentation_controls_order_membership_and_notes_relationship(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'fixture.pptx'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('ppt/presentation.xml', f'<p:presentation xmlns:p="{P}" xmlns:r="{R}"><p:sldIdLst><p:sldId id="900" r:id="second"/><p:sldId id="901" r:id="first"/></p:sldIdLst></p:presentation>')
                archive.writestr('ppt/_rels/presentation.xml.rels', f'<Relationships xmlns="{REL}"><Relationship Id="first" Type="{R}/slide" Target="slides/slide7.xml"/><Relationship Id="second" Type="{R}/slide" Target="/ppt/slides/lecture_slide1.xml"/></Relationships>')
                archive.writestr('ppt/slides/lecture_slide1.xml', slide('추가된 TCP 해제'))
                archive.writestr('ppt/slides/slide7.xml', slide('암호 개념'))
                archive.writestr('ppt/slides/slide1.xml', slide('삭제된 고아 슬라이드'))
                archive.writestr('ppt/slides/_rels/slide7.xml.rels', f'<Relationships xmlns="{REL}"><Relationship Id="notes" Type="{R}/notesSlide" Target="../notesSlides/notesSlide3.xml"/></Relationships>')
                archive.writestr('ppt/notesSlides/notesSlide7.xml', '<unrelated>잘못 연결하면 안 되는 노트</unrelated>')
                archive.writestr('ppt/notesSlides/notesSlide3.xml', f'<p:notes xmlns:p="{P}" xmlns:a="{A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>실제 암호 노트</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>99</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>')
            extracted = extractor.extract_deck(path)
            self.assertEqual([s['slide'] for s in extracted], [1, 2])
            self.assertEqual([s['text'] for s in extracted], ['추가된 TCP 해제', '암호 개념'])
            self.assertNotIn('notes', extracted[0])
            self.assertEqual(extracted[1]['notes'], '실제 암호 노트')
            self.assertEqual(extracted[1]['notesPart'], 'ppt/notesSlides/notesSlide3.xml')


if __name__ == '__main__':
    unittest.main()
