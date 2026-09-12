"""Install the local PDF engine and English OCR data. No documents are uploaded."""
import pathlib
import subprocess
import urllib.request

root = pathlib.Path(__file__).resolve().parent.parent
subprocess.run(['python3', '-m', 'venv', str(root / '.venv')], check=True)
subprocess.run([str(root / '.venv/bin/python'), '-m', 'pip', 'install', '-r', str(root / 'requirements.txt')], check=True)
target = root / 'engine/tessdata/eng.traineddata'
target.parent.mkdir(parents=True, exist_ok=True)
if not target.exists():
    urllib.request.urlretrieve('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata', target)
print('Local PDF engine and English OCR are ready.')
