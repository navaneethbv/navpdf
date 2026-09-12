"""Single-process, in-memory PDF engine. Coordinates at the API are displayed points."""
import base64
import json
import math
import pathlib
import secrets
import sys
import pymupdf as fitz

fitz.TOOLS.set_small_glyph_heights(True)

ROOT = pathlib.Path(__file__).resolve().parent
MAX_BYTES = 100 * 1024 * 1024
HISTORY_BYTES = 128 * 1024 * 1024


def decode(data):
    if not isinstance(data, str) or len(data) > MAX_BYTES * 1.4:
        raise ValueError('File exceeds the 100 MB limit.')
    return base64.b64decode(data, validate=True)


def encode(data):
    return base64.b64encode(data).decode('ascii')


def number(value, low, high):
    value = float(value)
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'Value must be between {low} and {high}.')
    return value


def color(value):
    return tuple(int(value.lstrip('#')[i:i+2], 16) / 255 for i in (0, 2, 4))


def sample():
    doc = fitz.open()
    green, dark, muted = (0.14, 0.39, 0.30), (0.08, 0.11, 0.13), (0.39, 0.44, 0.49)
    for index, title in enumerate(['Your documents.\nYour workspace.', 'Work smarter,\nlocally.', 'A more private\nPDF experience.']):
        page = doc.new_page(width=612, height=792)
        page.insert_text((44, 49), 'NavPDF', fontsize=18, fontname='hebo', color=dark)
        page.insert_text((455, 48), 'Private. Local. Yours.', fontsize=9, color=muted)
        y = 153
        for line in title.split('\n'):
            page.insert_text((44, y), line, fontsize=37, fontname='hebo', color=dark)
            y += 48
        page.insert_text((44, y+2), 'A quieter way to work with PDFs.', fontsize=18, color=muted)
        page.draw_line((44, y+36), (568, y+36), color=green, width=2)
        sections = [('Open something.', 'Open your PDFs with all the tools you need close at hand.'), ('Make it yours.', 'Edit text, add notes, highlight, draw, insert images and sign.'), ('Keep it local.', 'Your documents stay on this device. Export a copy when ready.')]
        if index == 1:
            sections = [('Organize your pages.', 'Reorder, rotate, crop, merge, split and extract pages.'), ('Find the right words.', 'Search document text or recognize scanned pages with OCR.'), ('Make the final touches.', 'Fill form fields, update metadata and protect your export.')]
        if index == 2:
            sections = [('A workspace on your device.', 'No account, cloud upload, subscription or telemetry.'), ('Real PDF files.', 'Your changes are written to a PDF you can open anywhere.'), ('Try the tools.', 'This welcome document is a real PDF. Make it your own.')]
        for n, (heading, body) in enumerate(sections):
            top = y+100+n*110
            page.draw_circle((66, top-3), 22, color=None, fill=(0.89, 0.95, 0.92))
            page.insert_text((60, top+3), str(n+1), fontsize=14, color=green)
            page.insert_text((108, top), heading, fontsize=16, fontname='hebo', color=dark)
            page.insert_textbox((108, top+13, 560, top+60), body, fontsize=11, color=muted)
        page.draw_line((44, 738), (568, 738), color=(0.83, 0.86, 0.87))
        page.insert_text((44, 759), 'NavPDF', fontsize=10, color=muted)
        page.insert_text((484, 759), f'Getting started / {index+1}', fontsize=8, color=muted)
    doc.set_metadata({'title': 'Welcome to NavPDF', 'author': 'NavPDF'})
    return doc


class Engine:
    def __init__(self):
        self.doc = sample()
        self.name = 'Welcome to NavPDF.pdf'
        self.undo = []
        self.redo = []
        self.revision = 0
        self.sensitive = False
        self.dirty = False

    def snapshot(self):
        return (self.doc.tobytes(garbage=3, deflate=True, encryption=fitz.PDF_ENCRYPT_NONE), self.sensitive, self.dirty)

    def restore(self, state):
        old = self.doc
        self.doc = fitz.open(stream=state[0], filetype='pdf')
        self.sensitive, self.dirty = state[1:]
        old.close()

    def info(self):
        return {'name': self.name, 'count': len(self.doc), 'revision': self.revision, 'dirty': self.dirty,
                'undo': bool(self.undo), 'redo': bool(self.redo), 'metadata': self.doc.metadata,
                'ocr': (ROOT / 'tessdata/eng.traineddata').exists(), 'sensitive': self.sensitive,
                'pages': [{'width': p.rect.width, 'height': p.rect.height, 'rotation': p.rotation} for p in self.doc]}

    def page(self, args):
        index = args.get('page', 0)
        if not isinstance(index, int) or not 0 <= index < len(self.doc):
            raise ValueError('Page is out of range.')
        return self.doc[index]

    def rect(self, page, args):
        values = args['rect']
        if len(values) != 4:
            raise ValueError('Invalid selection.')
        r = fitz.Rect(*[number(v, -100000, 100000) for v in values]).normalize() & page.rect
        if r.is_empty or r.width < 1 or r.height < 1:
            raise ValueError('Draw a larger area within the page.')
        return r * page.derotation_matrix

    def dispatch(self, args):
        op = args['op']
        if op == 'info':
            return self.info()
        if op == 'open':
            candidate = fitz.open(stream=decode(args['data']), filetype='pdf')
            if candidate.needs_pass:
                if not candidate.authenticate(args.get('password', '')):
                    candidate.close()
                    raise ValueError('PASSWORD_REQUIRED: Enter the PDF password.')
                if not candidate.permissions & fitz.PDF_PERM_MODIFY:
                    candidate.close()
                    raise ValueError('This PDF restricts editing. Open it with the owner password.')
            if not len(candidate):
                candidate.close()
                raise ValueError('The PDF has no pages.')
            self.doc.close()
            self.doc = candidate
            self.name = pathlib.Path(args.get('name', 'Document.pdf')).name[:200]
            self.undo, self.redo, self.sensitive, self.dirty = [], [], False, False
            self.revision += 1
            return self.info()
        if op == 'render':
            page = self.page(args)
            scale = number(args.get('scale', 1), 0.1, 3)
            scale = min(scale, (16000000 / max(1, page.rect.width * page.rect.height)) ** 0.5)
            return {'image': 'data:image/png;base64,' + encode(page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).tobytes('png'))}
        if op == 'details':
            p = self.page(args)
            spans = []
            for block in p.get_text('dict')['blocks']:
                for line in block.get('lines', []):
                    for span in line['spans']:
                        spans.append({'text': span['text'], 'rect': list(fitz.Rect(span['bbox']) * p.rotation_matrix), 'origin': list(fitz.Point(span['origin']) * p.rotation_matrix), 'size': span['size'], 'font': span['font'], 'color': '#%06x' % span['color']})
            widgets = [{'id': w.xref, 'name': w.field_name, 'value': w.field_value, 'type': w.field_type_string,
                        'choices': w.choice_values, 'on': w.on_state(), 'readonly': bool(w.field_flags & 1)} for w in p.widgets()]
            annotations = [{'id': a.xref, 'text': a.info.get('content', ''), 'type': a.type[1]} for a in p.annots()]
            return {'spans': spans, 'widgets': widgets, 'annotations': annotations}
        if op == 'search':
            query = str(args['query'])[:500].strip()
            return [{'page': p.number, 'rect': list(r * p.rotation_matrix)} for p in self.doc for r in (p.search_for(query) if query else [])][:1000]
        if op in ('undo', 'redo'):
            source, target = (self.undo, self.redo) if op == 'undo' else (self.redo, self.undo)
            if source:
                target.append(self.snapshot())
                self.restore(source.pop())
                self.revision += 1
            return self.info()
        if op == 'export':
            return self.export(args)
        before = self.snapshot()
        try:
            self.mutate(op, args)
        except Exception:
            self.restore(before)
            raise
        self.undo.append(before)
        while len(self.undo) > 20 or (len(self.undo) > 1 and sum(len(s[0]) for s in self.undo) > HISTORY_BYTES):
            self.undo.pop(0)
        self.redo = []
        self.revision += 1
        self.dirty = True
        return self.info()

    def mutate(self, op, args):
        if op == 'new':
            self.doc.close()
            self.doc = fitz.open()
            self.doc.new_page()
            return
        if op == 'metadata':
            allowed = ('title', 'author', 'subject', 'keywords', 'creator')
            metadata = self.doc.metadata
            metadata.update({k: str(v)[:2000] for k, v in args['metadata'].items() if k in allowed})
            self.doc.set_metadata(metadata)
            return
        if op == 'merge':
            with fitz.open(stream=decode(args['data']), filetype='pdf') as source:
                if source.needs_pass and not source.authenticate(args.get('password', '')):
                    raise ValueError('PASSWORD_REQUIRED: Enter the PDF password.')
                self.doc.insert_pdf(source, widgets=True)
            return
        if op == 'reorder':
            order = args['order']
            if sorted(order) != list(range(len(self.doc))):
                raise ValueError('Page order must include every page exactly once.')
            # move_page preserves widgets, unlike Document.select.
            current = list(range(len(self.doc)))
            for target, original in enumerate(order):
                source = current.index(original)
                if source != target:
                    self.doc.move_page(source, target)
                    current.insert(target, current.pop(source))
            return
        if op == 'addPage':
            self.doc.new_page(pno=int(args.get('after', len(self.doc)-1))+1)
            return
        page = self.page(args)
        if op == 'deletePage':
            if len(self.doc) == 1:
                raise ValueError('Keep at least one page in the document.')
            self.doc.delete_page(page.number)
        elif op == 'rotate':
            page.set_rotation((page.rotation + 90) % 360)
        elif op == 'crop':
            r = self.rect(page, args)
            r += (page.cropbox_position.x, page.cropbox_position.y, page.cropbox_position.x, page.cropbox_position.y)
            page.set_cropbox(r)
        elif op in ('text', 'replaceText'):
            r = self.rect(page, args)
            text = str(args['text'])[:10000]
            if not text.strip():
                raise ValueError('Enter some text.')
            size = number(args.get('size', 14), 5, 144)
            font = args.get('font', 'helv')
            if font not in ('helv', 'hebo', 'heit', 'tiro', 'tibo', 'cour'):
                raise ValueError('Unsupported font.')
            if any(ord(c) > 255 for c in text):
                raise ValueError('This text tool currently supports Latin characters. Use an image for other scripts.')
            if op == 'replaceText':
                if '\n' in text or fitz.get_text_length(text, fontname=font, fontsize=size) > r.width + 0.5 or size > r.height + 0.5:
                    raise ValueError('Replacement does not fit this line. Shorten it or reduce the font size.')
                origin = fitz.Point(*args['origin']) * page.derotation_matrix
                if not r.contains(origin):
                    raise ValueError('Select the text line again.')
                page.add_redact_annot(r, fill=False)
                page.apply_redactions(images=0, graphics=0)
                page.insert_text(origin, text, fontsize=size, fontname=font, color=color(args.get('color', '#17221c')))
                self.sensitive = True
            else:
                remaining = page.insert_textbox(r, text, fontsize=size, fontname=font, color=color(args.get('color', '#17221c')), rotate=page.rotation)
                if remaining < 0:
                    raise ValueError('Text does not fit. Enlarge the area or reduce the font size.')
        elif op == 'highlight':
            r = self.rect(page, args)
            quads = [fitz.Rect(w[:4]).quad for w in page.get_text('words') if fitz.Rect(w[:4]).intersects(r)]
            a = page.add_highlight_annot(quads or [r])
            a.set_colors(stroke=color(args.get('color', '#f4cf55')))
            a.update()
        elif op in ('draw', 'signature'):
            points = args['points']
            if len(points) < 2 or len(points) > 20000:
                raise ValueError('Draw a stroke on the page.')
            points = [fitz.Point(number(x, 0, page.rect.width), number(y, 0, page.rect.height)) * page.derotation_matrix for x, y in points]
            a = page.add_ink_annot([[tuple(p) for p in points]])
            a.set_border(width=number(args.get('width', 2), 0.5, 20))
            a.set_colors(stroke=color(args.get('color', '#17221c')))
            a.update()
        elif op == 'comment':
            point = fitz.Point(*args['point']) * page.derotation_matrix
            page.add_text_annot(point, str(args['text'])[:10000])
        elif op == 'deleteAnnotation':
            page.delete_annot(page.load_annot(int(args['id'])))
        elif op == 'image':
            page.insert_image(self.rect(page, args), stream=decode(args['data']), rotate=page.rotation)
        elif op == 'redact':
            r = self.rect(page, args)
            for widget in list(page.widgets()):
                if widget.rect.intersects(r):
                    page.delete_widget(widget)
            for a in list(page.annots()):
                if a.rect.intersects(r):
                    page.delete_annot(a)
            for link in page.get_links():
                if fitz.Rect(link['from']).intersects(r):
                    page.delete_link(link)
            page.add_redact_annot(r, fill=(0, 0, 0))
            page.apply_redactions(images=2, graphics=2, text=0)
            self.sensitive = True
        elif op == 'form':
            w = page.load_widget(int(args['id']))
            if w.field_flags & 1:
                raise ValueError('This form field is read-only.')
            if w.field_type == fitz.PDF_WIDGET_TYPE_SIGNATURE:
                raise ValueError('Certificate signatures are not supported.')
            w.field_value = args['value']
            w.update()
        elif op == 'ocr':
            tessdata = ROOT / 'tessdata'
            if not (tessdata / 'eng.traineddata').exists():
                raise ValueError('English OCR data is missing. Run npm run setup.')
            index = page.number
            width, height = page.rect.width, page.rect.height
            if width * height * (200 / 72) ** 2 > 25000000:
                raise ValueError('Page is too large for OCR at 200 DPI.')
            data = page.get_pixmap(dpi=200).pdfocr_tobytes(language='eng', tessdata=str(tessdata))
            with fitz.open(stream=data, filetype='pdf') as result:
                self.doc.insert_pdf(result, start_at=index)
                self.doc.delete_page(index+1)
        else:
            raise ValueError('Unknown operation.')

    def export(self, args):
        with fitz.open(stream=self.doc.tobytes(encryption=fitz.PDF_ENCRYPT_NONE), filetype='pdf') as result:
            pages = args.get('pages')
            if pages is not None:
                if not pages or len(set(pages)) != len(pages) or any(not isinstance(i, int) or i < 0 or i >= len(result) for i in pages):
                    raise ValueError('Choose valid pages to export.')
                # Delete backwards to preserve form widgets and links on retained pages.
                for index in reversed(range(len(result))):
                    if index not in pages:
                        result.delete_page(index)
            if self.sensitive:
                # Remove non-page hiding places after a content-removal operation.
                result.scrub(attached_files=True, clean_pages=True, embedded_files=True, hidden_text=True,
                             javascript=True, metadata=True, redactions=True, redact_images=2,
                             remove_links=True, reset_fields=False, reset_responses=True, thumbnails=True, xml_metadata=True)
                result.set_toc([])
                for p in result:
                    for annot in list(p.annots()):
                        if annot.type[0] == fitz.PDF_ANNOT_TEXT:
                            p.delete_annot(annot)
            password = str(args.get('password', ''))
            if len(password) > 40 or len(password.encode('utf-8')) > 127:
                raise ValueError('Password must be at most 40 characters and 127 UTF-8 bytes.')
            options = {'garbage': 4, 'deflate': True, 'clean': True}
            if password:
                options.update(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=secrets.token_hex(20),
                               permissions=fitz.PDF_PERM_PRINT | fitz.PDF_PERM_COPY | fitz.PDF_PERM_ANNOTATE | fitz.PDF_PERM_MODIFY | fitz.PDF_PERM_FORM | fitz.PDF_PERM_ASSEMBLE)
            else:
                options['encryption'] = fitz.PDF_ENCRYPT_NONE
            data = result.tobytes(**options)
            return {'data': encode(data), 'name': pathlib.Path(self.name).stem + '-edited.pdf'}


def main():
    engine = Engine()
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            result = engine.dispatch(request['args'])
            response = {'id': request['id'], 'result': result}
        except Exception as exc:
            response = {'id': request.get('id'), 'error': str(exc)}
        sys.stdout.write(json.dumps(response) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
