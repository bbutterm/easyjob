/* Распознавание речи на сервере: пересылка WAV в whisper.cpp, который
   запущен рядом с сервером (только loopback), либо заглушка.

   Ничего не хранится: ни аудио, ни текст. В журнал идут только длина
   аудио, длительность и исход. Согласие пользователя проверяет маршрут. */

'use strict';

const { HttpError } = require('./router.js');

const MAX_WAV = 1024 * 1024;
const MOCK_TEXT = 'Демонстрационная реплика: расскажите о вашем опыте.';

function config(env) {
  const e = env || process.env;
  const provider = e.STT_PROVIDER || 'mock';
  if (['mock', 'whisper_cpp'].indexOf(provider) < 0) throw new HttpError(503, 'Неизвестный STT-провайдер на сервере.', { code: 'stt_unconfigured' });
  let endpoint = null;
  if (provider === 'whisper_cpp') {
    let url;
    try { url = new URL(e.STT_ENDPOINT || 'http://127.0.0.1:8080/inference'); } catch (err) { url = null; }
    if (!url || url.protocol !== 'http:' || ['127.0.0.1', 'localhost', '[::1]'].indexOf(url.hostname) < 0
      || url.username || url.password || url.search || url.hash || url.pathname !== '/inference') {
      throw new HttpError(503, 'STT_ENDPOINT должен быть локальным адресом whisper.cpp /inference.', { code: 'stt_unconfigured' });
    }
    endpoint = url.href;
  }
  return { provider, endpoint, timeoutMs: Math.min(Number(e.STT_TIMEOUT_MS) || 20000, 60000) };
}

function describe(env) {
  try {
    const c = config(env);
    return { provider: c.provider, live: c.provider !== 'mock', configured: true };
  } catch (e) {
    return { provider: (env || process.env).STT_PROVIDER || 'mock', live: false, configured: false };
  }
}

/* Проверка формы WAV: RIFF/WAVE, размер, заголовок. */
function checkWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length <= 44 || bytes.length > MAX_WAV) throw new HttpError(413, 'Аудио: WAV от 45 байт до 1 МБ.', { code: 'bad_audio' });
  if (bytes.subarray(0, 4).toString('latin1') !== 'RIFF' || bytes.subarray(8, 12).toString('latin1') !== 'WAVE') {
    throw new HttpError(422, 'Ожидается WAV (RIFF/WAVE).', { code: 'bad_audio' });
  }
}

async function transcribe(bytes, opts) {
  const o = opts || {};
  const c = config(o.env);
  checkWav(bytes);
  const started = Date.now();
  if (c.provider === 'mock') {
    return { text: MOCK_TEXT, mock: true, latencyMs: Date.now() - started, provider: 'mock' };
  }
  const fetcher = o.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, c.timeoutMs);
  if (o.signal) o.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
  const body = new FormData();
  body.append('file', new Blob([bytes], { type: 'audio/wav' }), 'utterance.wav');
  body.append('response_format', 'json');
  body.append('language', 'ru');
  body.append('temperature', '0');
  let res;
  try {
    res = await fetcher(c.endpoint, { method: 'POST', body, signal: controller.signal, redirect: 'error' });
  } catch (e) {
    clearTimeout(timer);
    if (o.signal && o.signal.aborted) throw new HttpError(499, 'Запрос отменён', { code: 'cancelled' });
    throw new HttpError(controller.signal.aborted ? 504 : 502, controller.signal.aborted
      ? 'Распознавание не уложилось в отведённое время.' : 'Сервис распознавания недоступен.', { code: controller.signal.aborted ? 'timeout' : 'stt_unavailable' });
  }
  let text;
  try {
    if (!res.ok) throw new Error('status');
    const raw = await res.text();
    if (raw.length > 131072) throw new Error('size');
    const data = JSON.parse(raw);
    if (typeof data.text !== 'string' || data.text.length > 32000) throw new Error('shape');
    text = data.text.replace(/\s+/g, ' ').trim();
  } catch (e) {
    clearTimeout(timer);
    throw new HttpError(502, 'Сервис распознавания вернул некорректный ответ.', { code: 'stt_unavailable' });
  }
  clearTimeout(timer);
  return { text, mock: false, latencyMs: Date.now() - started, provider: c.provider };
}

module.exports = { transcribe, describe, config, checkWav, MAX_WAV, MOCK_TEXT };
