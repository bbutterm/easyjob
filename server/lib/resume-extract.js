'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const { HttpError } = require('./router.js');
const MAX_FILE = 2 * 1024 * 1024;
let active = 0;
function invalid(message, status = 422) { return new HttpError(status, message, { code: 'unsupported_file' }); }
function normalize(text) {
  const out = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (out.length > 40000) throw invalid('Текст резюме: не более 40 000 символов.');
  if (!out || /[\x00-\x08\x0e-\x1f]/.test(out)) throw invalid('Файл не содержит обычного текста. Пересохраните его как UTF-8 TXT.');
  return out;
}
async function extract(file, signal) {
  const ext = /\.([a-z0-9]+)$/i.exec(String(file?.name || ''))?.[1].toLowerCase();
  if (!['txt', 'pdf', 'docx', 'doc', 'rtf'].includes(ext)) throw invalid('Недопустимый формат. Выберите PDF, DOCX или TXT.');
  if (typeof file.base64 !== 'string' || file.base64.length > Math.ceil(MAX_FILE / 3) * 4) throw invalid('Размер файла: не более 2 МБ.', 413);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw invalid('Повреждённые данные файла. Выберите файл снова.');
  const bytes = Buffer.from(file.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE) throw invalid('Размер файла: от 1 байта до 2 МБ.', 413);
  if (['doc', 'rtf'].includes(ext)) throw invalid(ext.toUpperCase() + ': формат не поддерживается на сервере. Сохраните документ как DOCX, PDF или TXT.');
  if (signal?.aborted) throw new HttpError(499, 'Запрос отменён', { code: 'cancelled' });
  if (ext === 'txt') {
    let text;
    try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch (_) { text = new TextDecoder('windows-1251').decode(bytes); } }
    } catch (_) { throw invalid('Не удалось прочитать кодировку TXT. Сохраните файл как UTF-8.'); }
    return normalize(text);
  }
  if (ext === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw invalid('PDF: содержимое не соответствует формату.');
  if (ext === 'docx' && bytes.subarray(0, 2).toString() !== 'PK') throw invalid('DOCX: содержимое не соответствует формату.');
  if (active >= 2) throw new HttpError(429, 'Сервер извлекает другие документы. Повторите через несколько секунд.');
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const python = process.env.EASYJOB_PYTHON || 'python3';
      const child = spawn(python, [path.join(__dirname, 'resume-extract.py'), ext], { stdio: ['pipe', 'pipe', 'ignore'] });
      let output = '', stopped = false;
      const stop = () => { stopped = true; child.kill('SIGKILL'); };
      const timer = setTimeout(stop, 15000);
      signal?.addEventListener('abort', stop, { once: true });
      const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
      child.on('error', () => { clean(); reject(invalid(ext.toUpperCase() + ': формат не поддерживается на сервере (нужен Python 3). Вставьте текст.')); });
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 1024 * 1024) stop(); });
      child.stdin.on('error', () => {});
      child.on('close', code => {
        clean();
        if (signal?.aborted) return reject(new HttpError(499, 'Запрос отменён', { code: 'cancelled' }));
        if (stopped || code !== 0) return reject(invalid('Извлечение прервано: превышен лимит времени или памяти. Вставьте текст резюме.'));
        try { const data = JSON.parse(output); if (data.error) throw invalid(data.error); resolve(normalize(data.text)); }
        catch (e) { reject(e instanceof HttpError ? e : invalid('Не удалось извлечь текст. Пересохраните документ как TXT.')); }
      });
      child.stdin.end(bytes);
    });
  } finally { active--; }
}
module.exports = { extract, MAX_FILE };
