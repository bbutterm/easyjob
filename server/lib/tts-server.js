/* Синтез речи на сервере: пересылка текста в сервис синтеза и возврат
   аудио. Ключ сервиса остаётся здесь. Текст не хранится и не пишется в
   журнал; в журнал идут длина, длительность и исход.

   Провайдеры (TTS_PROVIDER):
     mock              — WAV тишины с длительностью как у речи; помечается
                         заголовком X-TTS-Mock: 1
     piper_http        — Piper (piper1-gpl): POST {text, voice} → WAV,
                         обычно http://127.0.0.1:5000
     openai_compatible — POST /v1/audio/speech {model, input, voice,
                         response_format} → аудио; так работают Kokoro-FastAPI,
                         openedai-speech и облачные сервисы; TTS_API_KEY — с сервера */

'use strict';

const { HttpError } = require('./router.js');

const MAX_TEXT = 600;
const MAX_AUDIO = 4 * 1024 * 1024;

function config(env) {
  const e = env || process.env;
  const provider = e.TTS_PROVIDER || 'mock';
  if (['mock', 'piper_http', 'openai_compatible'].indexOf(provider) < 0) throw new HttpError(503, 'Неизвестный TTS-провайдер на сервере.', { code: 'tts_unconfigured' });
  let endpoint = null;
  if (provider !== 'mock') {
    let url;
    try { url = new URL(e.TTS_ENDPOINT || (provider === 'piper_http' ? 'http://127.0.0.1:5000/' : '')); } catch (err) { url = null; }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      throw new HttpError(503, 'TTS_ENDPOINT должен быть адресом http(s) без логина.', { code: 'tts_unconfigured' });
    }
    endpoint = url.href;
  }
  return { provider, endpoint, voice: e.TTS_VOICE || '', model: e.TTS_MODEL || '', apiKey: e.TTS_API_KEY || '',
    format: e.TTS_FORMAT || 'wav', timeoutMs: Math.min(Number(e.TTS_TIMEOUT_MS) || 15000, 60000) };
}

function describe(env) {
  try {
    const c = config(env);
    return { provider: c.provider, live: c.provider !== 'mock', configured: true, voice: c.voice || null };
  } catch (e) {
    return { provider: (env || process.env).TTS_PROVIDER || 'mock', live: false, configured: false, voice: null };
  }
}

/* WAV тишины: 16 кГц, моно, 16 бит; длительность ≈ темп речи 15 зн/с, не больше 8 с. */
function silentWav(text) {
  const seconds = Math.min(8, Math.max(0.2, text.length / 15));
  const samples = Math.round(seconds * 16000);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0, 'latin1'); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1'); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

async function fetchAudio(url, init, c, o) {
  const fetcher = o.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, c.timeoutMs);
  if (o.signal) o.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
  let res;
  try {
    res = await fetcher(url, Object.assign({ signal: controller.signal, redirect: 'error' }, init));
  } catch (e) {
    clearTimeout(timer);
    if (o.signal && o.signal.aborted) throw new HttpError(499, 'Запрос отменён', { code: 'cancelled' });
    throw new HttpError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? 'Синтез не уложился в отведённое время.' : 'Сервис синтеза недоступен.',
      { code: controller.signal.aborted ? 'timeout' : 'tts_unavailable' });
  }
  try {
    if (!res.ok) throw new HttpError(502, 'Сервис синтеза ответил ошибкой (код ' + res.status + ').', { code: 'tts_unavailable' });
    const type = String(res.headers.get('content-type') || 'audio/wav');
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_AUDIO) throw new HttpError(502, 'Сервис синтеза вернул пустое или слишком большое аудио.', { code: 'tts_unavailable' });
    return { bytes, type: /^audio\//.test(type) || type.indexOf('octet-stream') >= 0 ? type.split(';')[0] : 'audio/wav' };
  } finally { clearTimeout(timer); }
}

async function speak(text, opts) {
  const o = opts || {};
  const c = config(o.env);
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new HttpError(400, 'Пустой текст.', { code: 'bad_text' });
  if (clean.length > MAX_TEXT) throw new HttpError(413, 'Текст фразы: не более ' + MAX_TEXT + ' знаков.', { code: 'bad_text' });
  const started = Date.now();
  const voice = o.voice || c.voice;
  if (c.provider === 'mock') {
    return { bytes: silentWav(clean), type: 'audio/wav', mock: true, latencyMs: Date.now() - started, provider: 'mock' };
  }
  let out;
  if (c.provider === 'piper_http') {
    out = await fetchAudio(c.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ text: clean }, voice ? { voice } : {})) }, c, o);
  } else {
    const headers = { 'content-type': 'application/json' };
    if (c.apiKey) headers.authorization = 'Bearer ' + c.apiKey;
    out = await fetchAudio(c.endpoint, { method: 'POST', headers,
      body: JSON.stringify({ model: c.model || 'tts-1', input: clean, voice: voice || 'alloy', response_format: c.format }) }, c, o);
  }
  return { bytes: out.bytes, type: out.type, mock: false, latencyMs: Date.now() - started, provider: c.provider };
}

module.exports = { speak, describe, config, silentWav, MAX_TEXT, MAX_AUDIO };
