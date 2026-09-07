/* STT is separate from text LLM routing. No storage, telemetry or provider bodies in errors. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpeechToText = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MOCK_TEXT = 'Демонстрационная реплика: расскажите о вашем опыте.';
  function chunks(text, limit = 4000) {
    if (typeof text !== 'string' || !Number.isInteger(limit) || limit < 2) throw new Error('Некорректный текст STT.');
    let rest = text.replace(/\s+/g, ' ').trim();
    const out = [];
    while (rest.length) {
      let end = Math.min(limit, rest.length);
      if (end < rest.length) {
        const space = rest.lastIndexOf(' ', end);
        if (space > 0) end = space;
        else if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
      }
      out.push(rest.slice(0, end)); rest = rest.slice(end).trim();
    }
    return out;
  }
  function parse(payload) {
    if (!payload || typeof payload.text !== 'string' || payload.text.length > 32000) throw new Error('Некорректный ответ STT.');
    return chunks(payload.text);
  }
  function endpoint(value) {
    const url = new URL(value || 'http://127.0.0.1:8080/inference');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/inference') throw new Error('Нужен локальный адрес whisper.cpp /inference.');
    return url.href;
  }
  function provider(config = {}, fetcher = globalThis.fetch) {
    const id = config.provider || 'mock';
    if (!['mock', 'whisper_cpp', 'server'].includes(id)) throw new Error('Неизвестный STT-провайдер.');
    const url = id === 'whisper_cpp' ? endpoint(config.endpoint) : (id === 'server' ? '/api/stt/transcribe' : null);
    return {
      id,
      async transcribe(wav, signal) {
        if (signal && signal.aborted) throw new Error('Отменено.');
        if (id === 'mock') return { chunks: [MOCK_TEXT], mock: true };
        if (!(wav instanceof Blob) || wav.type !== 'audio/wav' || wav.size > 1000000 || wav.size <= 44) throw new Error('Некорректное аудио STT.');
        if (id === 'server') {
          /* Сервер Easyjob держит whisper.cpp у себя: фрагмент уходит как base64
             в JSON с cookie сессии; аудио не хранится. */
          const buf = new Uint8Array(await wav.arrayBuffer());
          let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
          let sres;
          try {
            sres = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ wavBase64: btoa(bin), consent: true }), signal, credentials: 'same-origin' });
          } catch (_) { throw new Error('STT сервера недоступен или запрос отменён.'); }
          let sdata = null;
          try { sdata = await sres.json(); } catch (_) { sdata = null; }
          if (!sres.ok || !sdata || sdata.ok !== true) throw new Error((sdata && sdata.error) || 'STT сервера недоступен.');
          return { chunks: parse({ text: sdata.text }), mock: sdata.mock === true };
        }
        const body = new FormData();
        body.append('file', wav, 'utterance.wav');
        body.append('response_format', 'json'); body.append('language', 'ru');
        body.append('temperature', '0');
        let res;
        try { res = await fetcher(url, { method: 'POST', body, signal, credentials: 'omit', redirect: 'error' }); }
        catch (_) { throw new Error('STT недоступен или запрос отменён.'); }
        if (!res.ok) throw new Error('STT недоступен.');
        // Bound the provider response before parsing it.
        const reader = res.body.getReader(); let size = 0; const parts = [];
        try {
          while (true) {
            const part = await reader.read(); if (part.done) break;
            size += part.value.byteLength;
            if (size > 131072) throw new Error('Слишком большой ответ STT.');
            parts.push(part.value);
          }
        } finally { await reader.cancel(); }
        let data;
        try { data = JSON.parse(await new Blob(parts).text()); } catch (_) { throw new Error('Некорректный JSON STT.'); }
        return { chunks: parse(data), mock: false };
      }
    };
  }
  // Mono PCM16 WAV at 16 kHz: whisper.cpp does not need --convert or temporary files.
  function wav(samples, rate) {
    const length = Math.floor(samples.length * 16000 / rate);
    const buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
    const str = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) {
      const from = Math.floor(i * rate / 16000), to = Math.max(from + 1, Math.floor((i + 1) * rate / 16000));
      let sum = 0; for (let j = from; j < to; j++) sum += samples[j] || 0;
      const value = Math.max(-1, Math.min(1, sum / (to - from)));
      view.setInt16(44 + i * 2, value * (value < 0 ? 32768 : 32767), true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }
  function capabilities(env = globalThis) {
    return { microphone: !!(env.navigator && env.navigator.mediaDevices && env.navigator.mediaDevices.getUserMedia && env.AudioContext), systemAudio: false };
  }
  async function capture(env = globalThis) {
    const stream = await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    let context, source, processor, parts = [], count = 0, closed = false;
    const release = () => {
      stream.getTracks().forEach(t => t.stop());
      if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
      if (source) source.disconnect();
      if (context) context.close().catch(() => {});
    };
    try {
      context = new env.AudioContext(); await context.resume();
      source = context.createMediaStreamSource(stream);
      // Bounded 30-second utterances; AudioWorklet can replace this older, widely supported API later.
      processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = event => {
        if (count >= context.sampleRate * 30) return;
        const data = event.inputBuffer.getChannelData(0).slice(0, context.sampleRate * 30 - count);
        parts.push(data); count += data.length;
      };
      source.connect(processor); processor.connect(context.destination); // output buffer stays silent
      return {
        finish() {
          if (closed) throw new Error('Запись закрыта.'); closed = true; release();
          const samples = new Float32Array(count); let offset = 0;
          parts.forEach(part => { samples.set(part, offset); offset += part.length; }); parts = [];
          if (!count) throw new Error('Нет аудио.');
          return wav(samples, context.sampleRate);
        },
        onEnded(callback) { stream.getAudioTracks().forEach(track => track.addEventListener('ended', callback, { once: true })); },
        cancel() { closed = true; parts = []; release(); }
      };
    } catch (_) { release(); throw new Error('Не удалось открыть микрофон.'); }
  }
  function create(options = {}) {
    const stt = options.adapter || provider(options.config);
    let state = 'idle', generation = 0, recording = null, aborter = null, timer = null, result = [], mock = stt.id === 'mock';
    function emit(error = '') { if (options.onState) options.onState({ state, chunks: result.slice(), mock, error }); }
    function cancel() {
      generation++; clearTimeout(timer); if (aborter) aborter.abort(); aborter = null;
      if (recording) recording.cancel(); recording = null; result = []; state = 'idle'; emit();
    }
    async function start(consent) {
      if (['requesting', 'recording', 'transcribing'].includes(state)) return;
      cancel(); const token = generation;
      if (consent !== true) { state = 'error'; emit('Подтвердите согласие на микрофон и обработку текста.'); return; }
      state = 'requesting'; emit();
      try {
        const pending = stt.id === 'mock' ? { finish: () => null, cancel() {} } : await (options.capture || capture)();
        if (token !== generation) { pending.cancel(); return; }
        recording = pending; state = 'recording'; emit();
        timer = setTimeout(stop, options.maxRecordingMs || 30000);
        if (recording.onEnded) recording.onEnded(stop);
      } catch (_) { if (token === generation) { state = 'error'; emit('Микрофон недоступен или разрешение отклонено. Проверьте разрешения и повторите.'); } }
    }
    async function stop() {
      if (state === 'requesting') { cancel(); return; }
      if (state !== 'recording') return;
      const token = generation; clearTimeout(timer);
      state = 'transcribing'; emit(); aborter = new AbortController();
      let deadline; const controller = aborter;
      try {
        const audio = recording.finish(); recording = null;
        const timeout = new Promise((_, reject) => { deadline = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, options.timeoutMs || 60000); });
        const response = await Promise.race([stt.transcribe(audio, aborter.signal), timeout]);
        if (token !== generation) return;
        result = response.chunks; mock = response.mock;
        if (!result.length) { state = 'error'; emit('Речь не найдена. Запишите реплику ещё раз.'); return; }
        state = 'ready'; emit();
      } catch (_) {
        if (token === generation) { if (recording) recording.cancel(); recording = null; state = 'error'; emit('Не удалось распознать реплику. Проверьте локальный STT, разрешения сети и повторите запись.'); }
      } finally { clearTimeout(deadline); if (token === generation) aborter = null; }
    }
    return { start, stop, cancel, state: () => state };
  }
  return { provider, create, capture, capabilities, wav, chunks, parse, endpoint, MOCK_TEXT };
});
