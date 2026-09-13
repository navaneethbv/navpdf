"""Optional QA-only fixture generation. PyMuPDF is not shipped with NavPDF."""
from pathlib import Path
import fitz
root = Path(__file__).resolve().parents[1] / 'tests/pdf-fixtures'
source = fitz.open(root / 'reader-5.pdf')
source.save(root / 'encrypted.pdf', encryption=fitz.PDF_ENCRYPT_AES_256,
            owner_pw='owner-fixture', user_pw='reader-fixture')
scanned = fitz.open()
for index in range(12):
    pix = source[index % 5].get_pixmap(dpi=220)
    page = scanned.new_page(width=612, height=792)
    page.insert_image(page.rect, stream=pix.tobytes('png'))
scanned.save(root / 'scanned-images.pdf', deflate=True)
font = Path(__file__).resolve().parents[1] / 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'
if font.exists():
    embedded = fitz.open()
    page = embedded.new_page()
    page.insert_font(fontname='FixtureSans', fontfile=str(font))
    page.insert_text((50, 100), 'Embedded font: café, résumé, naïve.', fontname='FixtureSans', fontsize=18)
    embedded.set_toc([[1, 'Embedded text', 1]])
    embedded.save(root / 'embedded-font.pdf')
print('Created encrypted, image-only scan, and embedded-font QA fixtures.')
