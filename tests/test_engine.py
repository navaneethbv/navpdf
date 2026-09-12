import base64
import importlib.util
import pathlib
import pytest
import pymupdf as fitz

spec = importlib.util.spec_from_file_location('pdf_engine', pathlib.Path(__file__).parents[1] / 'engine/pdf_engine.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

@pytest.fixture
def engine():
    return module.Engine()

def exported(engine, **kwargs):
    return fitz.open(stream=base64.b64decode(engine.dispatch({'op':'export', **kwargs})['data']), filetype='pdf')

def open_doc(engine, doc):
    engine.dispatch({'op':'open','name':'test.pdf','data':base64.b64encode(doc.tobytes()).decode()})

def test_replace_heading_preserves_adjacent_line_and_baseline(engine):
    span = next(s for s in engine.dispatch({'op':'details'})['spans'] if s['text']=='Your documents.')
    engine.dispatch({'op':'replaceText','page':0,**span,'text':'My documents.','font':'hebo'})
    with exported(engine) as doc:
        text=doc[0].get_text()
        assert 'Your documents.' not in text
        assert 'My documents.' in text
        assert 'Your workspace.' in text
        new_span=next(s for b in doc[0].get_text('dict')['blocks'] for line in b.get('lines',[]) for s in line['spans'] if s['text']=='My documents.')
        assert new_span['origin']==pytest.approx(span['origin'])
    engine.dispatch({'op':'undo'})
    assert 'Your documents.' in engine.doc[0].get_text()
    engine.dispatch({'op':'redo'})
    assert 'My documents.' in engine.doc[0].get_text()

def test_failed_replacement_is_atomic(engine):
    span=next(s for s in engine.dispatch({'op':'details'})['spans'] if s['text']=='Your documents.')
    before=engine.doc[0].get_text()
    with pytest.raises(ValueError,match='does not fit'):
        engine.dispatch({'op':'replaceText',**span,'font':'helv','text':'Too long '*100})
    assert engine.doc[0].get_text()==before
    assert not engine.undo

def test_redaction_removes_text_images_metadata_and_attachments(engine):
    doc=fitz.open();p=doc.new_page(width=400,height=400)
    p.insert_text((40,60),'SECRET-123',fontsize=16)
    p.insert_text((40,200),'KEEP THIS',fontsize=16)
    p.add_text_annot((300,300),'SECRET-123')
    doc.set_metadata({'title':'SECRET-123'})
    doc.embfile_add('hidden.txt',b'SECRET-123')
    doc.set_toc([[1,'SECRET-123',1]])
    p.insert_link({'kind':fitz.LINK_URI,'from':fitz.Rect(300,30,360,60),'uri':'https://example.test/SECRET-123'})
    open_doc(engine,doc)
    engine.dispatch({'op':'redact','rect':[30,35,190,80]})
    with exported(engine) as result:
        assert 'SECRET-123' not in result[0].get_text()
        assert 'KEEP THIS' in result[0].get_text()
        assert result.embfile_count()==0
        assert not result.metadata['title']
        assert not result.get_toc()
        assert not result[0].get_links()
        assert not list(result[0].annots())
        # Check decompressed object streams as well as extracted page text.
        for xref in range(1,result.xref_length()):
            assert 'SECRET-123' not in result.xref_object(xref)
            if result.xref_is_stream(xref):
                assert b'SECRET-123' not in result.xref_stream(xref)

@pytest.mark.parametrize('rotation',[0,90,180,270])
def test_rotated_redaction_coordinates(engine,rotation):
    doc=fitz.open();p=doc.new_page(width=400,height=500)
    p.insert_text((50,70),'REMOVE',fontsize=14);p.insert_text((50,180),'RETAIN',fontsize=14);p.set_rotation(rotation)
    open_doc(engine,doc)
    hit=engine.dispatch({'op':'search','query':'REMOVE'})[0]
    engine.dispatch({'op':'redact',**hit})
    with exported(engine) as result:
        assert 'REMOVE' not in result[0].get_text()
        assert 'RETAIN' in result[0].get_text()

@pytest.mark.parametrize('rotation',[0,90,180,270])
def test_rotated_replacement_preserves_baseline(engine,rotation):
    doc=fitz.open();p=doc.new_page(width=400,height=500)
    p.insert_text((50,70),'Original heading',fontsize=14);p.insert_text((50,90),'Next line',fontsize=14);p.set_rotation(rotation)
    open_doc(engine,doc)
    span=next(s for s in engine.dispatch({'op':'details'})['spans'] if s['text']=='Original heading')
    engine.dispatch({'op':'replaceText',**span,'text':'New heading','font':'helv'})
    with exported(engine) as result:
        assert 'New heading' in result[0].get_text()
        assert 'Next line' in result[0].get_text()
        assert 'Original heading' not in result[0].get_text()

def test_password_export_and_reopen(engine):
    data=engine.dispatch({'op':'export','password':'test-password'})['data']
    with fitz.open(stream=base64.b64decode(data),filetype='pdf') as result:
        assert result.needs_pass
        assert not result.authenticate('incorrect')
        assert result.authenticate('test-password')
        assert 'Your documents.' in result[0].get_text()
    before=engine.doc[0].get_text()
    with pytest.raises(ValueError,match='PASSWORD_REQUIRED'):
        engine.dispatch({'op':'open','data':data,'password':'wrong'})
    assert before==engine.doc[0].get_text()
    engine.dispatch({'op':'open','data':data,'password':'test-password'})
    with exported(engine) as result:
        assert not result.needs_pass

def test_page_organization_and_merge(engine):
    engine.dispatch({'op':'reorder','order':[2,0,1]})
    assert 'A more private' in engine.doc[0].get_text()
    engine.dispatch({'op':'addPage','after':0})
    assert len(engine.doc)==4
    engine.dispatch({'op':'deletePage','page':1})
    with exported(engine,pages=[0,2]) as result:
        assert len(result)==2
        assert 'Work smarter' in result[1].get_text()
    engine.dispatch({'op':'merge','data':engine.dispatch({'op':'export','pages':[0]})['data']})
    assert len(engine.doc)==4

def test_forms_survive_reorder_merge_and_extract(engine):
    doc=fitz.open();p=doc.new_page();w=fitz.Widget();w.field_name='Name';w.field_type=fitz.PDF_WIDGET_TYPE_TEXT;w.rect=fitz.Rect(50,50,250,80);p.add_widget(w);doc.new_page()
    open_doc(engine,doc)
    field=engine.dispatch({'op':'details'})['widgets'][0]
    engine.dispatch({'op':'form','id':field['id'],'value':'Jane Example'})
    engine.dispatch({'op':'reorder','order':[1,0]})
    with exported(engine,pages=[1]) as result:
        assert list(result[0].widgets())[0].field_value=='Jane Example'
    engine.dispatch({'op':'merge','data':engine.dispatch({'op':'export','pages':[1]})['data']})
    assert list(engine.doc[2].widgets())[0].field_value=='Jane Example'

def test_annotation_drawing_text_and_crop(engine):
    engine.dispatch({'op':'text','rect':[50,670,350,710],'text':'Added text','size':14})
    engine.dispatch({'op':'highlight','rect':[40,130,360,165]})
    engine.dispatch({'op':'draw','points':[[50,710],[90,720],[140,710]],'width':3})
    engine.dispatch({'op':'signature','points':[[50,730],[90,740],[140,730]]})
    engine.dispatch({'op':'comment','point':[500,700],'text':'Review this'})
    with exported(engine) as result:
        assert 'Added text' in result[0].get_text()
        assert len(list(result[0].annots()))==4
    engine.dispatch({'op':'crop','rect':[20,20,590,760]})
    assert engine.doc[0].rect.width==570
    engine.dispatch({'op':'undo'})
    assert engine.doc[0].rect.width==612

def test_ocr_exports_searchable_scanned_page(engine):
    source=fitz.open();p=source.new_page(width=400,height=300);p.insert_text((40,90),'SEARCHABLE DOCUMENT',fontsize=22)
    scan=fitz.open();scan.new_page(width=400,height=300).insert_image(p.rect,stream=p.get_pixmap(dpi=150).tobytes('png'))
    open_doc(engine,scan)
    assert not engine.doc[0].get_text().strip()
    engine.dispatch({'op':'ocr'})
    with exported(engine) as result:
        assert 'SEARCHABLE' in result[0].get_text()
        assert result[0].rect.width==pytest.approx(400,abs=1)

def test_redaction_removes_image_pixels(engine):
    source=fitz.open();p=source.new_page(width=200,height=200);p.draw_rect(p.rect,fill=(1,0,0))
    image=p.get_pixmap().tobytes('png')
    doc=fitz.open();p=doc.new_page(width=300,height=300);p.insert_image(fitz.Rect(20,20,220,220),stream=image)
    open_doc(engine,doc)
    engine.dispatch({'op':'redact','rect':[20,20,120,120]})
    with exported(engine) as result:
        pix=result[0].get_pixmap()
        assert pix.pixel(50,50)==(0,0,0)
        assert pix.pixel(180,180)==(255,0,0)
        images=result[0].get_images()
        for info in images:
            raw=fitz.Pixmap(result,info[0])
            assert raw.pixel(30,30)!=(255,0,0)

def test_invalid_pdf_does_not_replace_workspace(engine):
    before=engine.doc[0].get_text()
    with pytest.raises(Exception):
        engine.dispatch({'op':'open','data':base64.b64encode(b'not a PDF').decode()})
    assert engine.doc[0].get_text()==before

@pytest.mark.parametrize('rotation',[0,90,180,270])
def test_added_text_and_crop_use_display_coordinates(engine,rotation):
    doc=fitz.open();p=doc.new_page(width=400,height=500);p.set_rotation(rotation)
    open_doc(engine,doc)
    rect=[40,50,250,110]
    engine.dispatch({'op':'text','rect':rect,'text':'Placed here','size':14})
    hit=engine.dispatch({'op':'search','query':'Placed here'})[0]['rect']
    assert hit[0]>=rect[0]-1 and hit[1]>=rect[1]-1
    assert hit[2]<=rect[2]+1 and hit[3]<=rect[3]+1
    engine.dispatch({'op':'crop','rect':[20,20,300,350]})
    assert engine.doc[0].rect.width==280
    assert engine.doc[0].rect.height==330

def test_insert_image_and_metadata_export(engine):
    src=fitz.open();p=src.new_page(width=40,height=40);p.draw_rect(p.rect,fill=(0,0,1))
    data=base64.b64encode(p.get_pixmap().tobytes('png')).decode()
    engine.dispatch({'op':'image','rect':[200,650,240,690],'data':data})
    engine.dispatch({'op':'metadata','metadata':{'title':'My local PDF','author':'Example'}})
    with exported(engine) as doc:
        assert doc.metadata['title']=='My local PDF'
        assert doc[0].get_pixmap().pixel(220,670)==(0,0,255)
