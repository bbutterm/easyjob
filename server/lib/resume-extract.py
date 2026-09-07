"""Bounded stdin-only extraction; never persist bytes or echo parser exceptions."""
import io, json, sys, zipfile, resource
import xml.etree.ElementTree as ET
resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (10, 10))

def extract(kind, data):
    if kind == 'pdf':
        try:
            from pypdf import PdfReader
        except ImportError:
            return {'error': 'PDF: формат не поддерживается на сервере (нужен pypdf). Сохраните документ как TXT.'}
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            return {'error': 'PDF защищён паролем. Снимите защиту и загрузите снова.'}
        if len(reader.pages) > 100:
            return {'error': 'PDF: не более 100 страниц.'}
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or '')
            if sum(map(len, parts)) > 40000:
                return {'error': 'Текст резюме: не более 40 000 символов.'}
        text = '\n'.join(parts)
        if not text.strip():
            return {'error': 'PDF не содержит извлекаемого текста: возможно, это скан. OCR на сервере недоступен. Вставьте текст или загрузите TXT/DOCX.'}
        return {'text': text}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if len(z.infolist()) > 2000 or sum(i.file_size for i in z.infolist()) > 20 * 1024 * 1024:
            return {'error': 'DOCX: слишком большой распакованный документ (лимит 20 МБ).'}
        xml = z.read('word/document.xml')
        if b'<!DOCTYPE' in xml or b'<!ENTITY' in xml:
            return {'error': 'DOCX: недопустимая структура XML.'}
        root = ET.fromstring(xml)
        ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
        parts = []
        for p in root.iter(ns + 'p'):
            parts.append(''.join(n.text or '' if n.tag == ns + 't' else '\t' if n.tag == ns + 'tab' else '\n' if n.tag in (ns + 'br', ns + 'cr') else '' for n in p.iter()))
        return {'text': '\n'.join(parts)}
try:
    result = extract(sys.argv[1], sys.stdin.buffer.read(2 * 1024 * 1024 + 1))
except Exception:
    result = {'error': 'Документ повреждён или имеет неподдерживаемую структуру. Пересохраните его как PDF, DOCX или TXT.'}
print(json.dumps(result, ensure_ascii=True))
