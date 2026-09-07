/* ============================================================
   Синтез речи для живого интервью.

   Провайдеры:
     browser — Web Speech API (speechSynthesis) браузера: без сети и ключей,
               голоса системные. «Встроенный» вариант: ничего ставить не надо.
     server  — POST /api/tts/speak: сервер держит Piper, Kokoro или любой
               OpenAI-совместимый сервис синтеза; ответ — аудио, играет
               через <audio>. Ключи остаются на сервере.
     mock    — без звука: «играет» по времени, чтобы конвейер и тесты
               работали без динамиков и сети; помечается как заглушка.

   Speaker — очередь фраз: играет строго по порядку, заранее синтезирует
   следующие (prefetch) для сервера, умеет прерваться (barge-in), когда
   пользователь начинает говорить, и сообщает состояние и время до первого
   звука (ttfaMs). Текст перед синтезом нормализуется (TextSegment.forSpeech).
   ============================================================ */

(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('../text/segment.js') : root.TextSegment);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TextToSpeech = api;
})(typeof self !== 'undefined' ? self : this, function (TextSegment) {
  'use strict';

  var MAX_CHUNK = 600;
  var SPEECH_CHARS_PER_SEC = 15;

  function capabilities(env) {
    var g = env || (typeof window !== 'undefined' ? window : {});
    return { browser: !!(g.speechSynthesis && typeof g.SpeechSynthesisUtterance === 'function'),
      audio: typeof g.Audio === 'function' || !!(g.AudioContext) };
  }

  /* Голос браузера для языка: сначала точное совпадение (ru-RU), потом язык. */
  function pickVoice(voices, lang) {
    var list = voices || [];
    var exact = list.filter(function (v) { return String(v.lang || '').toLowerCase() === String(lang).toLowerCase(); });
    var byLang = list.filter(function (v) { return String(v.lang || '').toLowerCase().indexOf(String(lang).slice(0, 2).toLowerCase()) === 0; });
    var pool = exact.length ? exact : byLang;
    if (!pool.length) return null;
    var local = pool.filter(function (v) { return v.localService; });
    return (local[0] || pool[0]);
  }

  /* ---- Провайдеры ----
     Каждый: { id, mock, synth(text, signal) → { play(onEnd) → { stop } } }.
     play запускает звук и зовёт onEnd по окончании; stop прерывает. */

  function browserProvider(options) {
    var o = options || {};
    var g = o.env || window;
    var lang = o.lang || 'ru-RU';
    return {
      id: 'browser', mock: false,
      async synth(text) {
        return {
          play: function (onEnd) {
            var u = new g.SpeechSynthesisUtterance(text);
            u.lang = lang;
            var voice = pickVoice(g.speechSynthesis.getVoices ? g.speechSynthesis.getVoices() : [], lang);
            if (voice) u.voice = voice;
            u.rate = o.rate || 1;
            var done = false;
            var finish = function () { if (!done) { done = true; onEnd(); } };
            u.onend = finish; u.onerror = finish;
            g.speechSynthesis.speak(u);
            return { stop: function () { done = true; try { g.speechSynthesis.cancel(); } catch (e) { /* нет синтеза */ } } };
          }
        };
      },
      cancelAll: function () { try { g.speechSynthesis.cancel(); } catch (e) { /* нет синтеза */ } }
    };
  }

  function serverProvider(options) {
    var o = options || {};
    var fetcher = o.fetcher || (typeof fetch === 'function' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : null);
    var AudioCtor = o.Audio || (typeof Audio === 'function' ? Audio : null);
    var createUrl = o.createObjectURL || (typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL.bind(URL) : null);
    var revokeUrl = o.revokeObjectURL || (typeof URL !== 'undefined' && URL.revokeObjectURL ? URL.revokeObjectURL.bind(URL) : function () {});
    return {
      id: 'server', mock: false,
      async synth(text, signal) {
        var res;
        try {
          res = await fetcher(o.path || '/api/tts/speak', { method: 'POST', credentials: 'same-origin', signal: signal,
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text, voice: o.voice || undefined }) });
        } catch (e) { throw new Error(signal && signal.aborted ? 'Отменено.' : 'Синтез на сервере недоступен.'); }
        if (!res.ok) {
          var err = null; try { err = await res.json(); } catch (e) { err = null; }
          var error = new Error((err && err.error) || 'Синтез на сервере недоступен.');
          error.code = err && err.code; throw error;
        }
        var blob = await res.blob();
        var mock = res.headers && res.headers.get && res.headers.get('x-tts-mock') === '1';
        return {
          mock: mock,
          play: function (onEnd) {
            var url = createUrl(blob);
            var audio = new AudioCtor(url);
            var done = false;
            var finish = function () { if (!done) { done = true; revokeUrl(url); onEnd(); } };
            audio.onended = finish; audio.onerror = finish;
            var p = audio.play(); if (p && p.catch) p.catch(finish);
            return { stop: function () { done = true; try { audio.pause(); audio.src = ''; } catch (e) { /* уже остановлено */ } revokeUrl(url); } };
          }
        };
      }
    };
  }

  /* Заглушка: длительность как у речи, звука нет. setTimer подменяется в тестах. */
  function mockProvider(options) {
    var o = options || {};
    var setTimer = o.setTimer || setTimeout, clearTimer = o.clearTimer || clearTimeout;
    var synthMs = o.synthMs === undefined ? 0 : o.synthMs;
    return {
      id: 'mock', mock: true,
      async synth(text, signal) {
        if (synthMs) await new Promise(function (r) { setTimer(r, synthMs); });
        if (signal && signal.aborted) throw new Error('Отменено.');
        var ms = o.durationMs !== undefined ? o.durationMs : Math.max(120, Math.round(text.length / SPEECH_CHARS_PER_SEC * 1000));
        return { play: function (onEnd) { var t = setTimer(onEnd, ms); return { stop: function () { clearTimer(t); } }; } };
      }
    };
  }

  function provider(config, deps) {
    var c = config || {};
    var id = c.provider || 'browser';
    if (id === 'browser') return browserProvider(Object.assign({}, c, deps || {}));
    if (id === 'server') return serverProvider(Object.assign({}, c, deps || {}));
    if (id === 'mock') return mockProvider(Object.assign({}, c, deps || {}));
    throw new Error('Неизвестный TTS-провайдер.');
  }

  /* Очередь речи. options: { provider, prefetch (2), onState, now }.
     enqueue(text) → нормализует и ставит фразу; cancel() → мгновенно
     прерывает звук и отменяет синтез; state(): idle | synthesizing | speaking. */
  function createSpeaker(options) {
    var o = options || {};
    var impl = o.provider;
    var prefetch = o.prefetch === undefined ? 2 : o.prefetch;
    var now = o.now || function () { return Date.now(); };
    var queue = [];        /* { text, promise, aborter, ready } */
    var playing = null;    /* { stop } */
    var waitingFor = null; /* фраза, чьего синтеза уже ждём */
    var generation = 0;
    var state = 'idle';
    var stats = { spoken: 0, cancelled: 0, errors: 0, ttfaMs: null, turnStartedAt: null, lastError: '' };

    function emit() { if (o.onState) o.onState({ state: state, queued: queue.length, stats: Object.assign({}, stats), mock: !!impl.mock }); }
    function setState(s) { if (s !== state) { state = s; emit(); } }

    function beginTurn() { stats.ttfaMs = null; stats.turnStartedAt = now(); }

    function synthesize(item) {
      if (item.promise) return item.promise;
      item.aborter = typeof AbortController === 'function' ? new AbortController() : null;
      item.promise = impl.synth(item.text, item.aborter ? item.aborter.signal : undefined)
        .then(function (audio) { item.ready = audio; return audio; })
        .catch(function (e) { item.error = e; return null; });
      return item.promise;
    }

    function pump() {
      /* Предвыборка: синтезируем следующие prefetch фраз параллельно. */
      queue.slice(0, Math.max(1, prefetch)).forEach(synthesize);
      if (playing || !queue.length) { if (!queue.length && !playing) setState('idle'); return; }
      var item = queue[0];
      if (waitingFor === item) return;
      waitingFor = item;
      var token = generation;
      setState(item.ready ? 'speaking' : 'synthesizing');
      synthesize(item).then(function (audio) {
        if (token !== generation) return;
        waitingFor = null;
        queue.shift();
        if (!audio) {
          stats.errors++; stats.lastError = item.error ? item.error.message : 'ошибка синтеза';
          if (o.onError) o.onError(item.error, item.text);
          pump(); return;
        }
        if (stats.ttfaMs === null && stats.turnStartedAt !== null) stats.ttfaMs = now() - stats.turnStartedAt;
        setState('speaking');
        playing = audio.play(function () {
          if (token !== generation) return;
          playing = null; stats.spoken++;
          if (o.onSpoken) o.onSpoken(item.text);
          pump();
        });
      });
    }

    function enqueue(text) {
      var clean = TextSegment ? TextSegment.forSpeech(text) : String(text || '').trim();
      if (!clean) return false;
      (clean.length > MAX_CHUNK ? (TextSegment ? TextSegment.splitLong(clean, MAX_CHUNK) : [clean.slice(0, MAX_CHUNK)]) : [clean])
        .forEach(function (piece) { queue.push({ text: piece }); });
      pump();
      return true;
    }

    function cancel() {
      generation++;
      waitingFor = null;
      queue.forEach(function (item) { if (item.aborter) item.aborter.abort(); if (item.ready && item.ready.stop) item.ready.stop(); });
      if (queue.length || playing) stats.cancelled++;
      queue = [];
      if (playing) { playing.stop(); playing = null; }
      if (impl.cancelAll) impl.cancelAll();
      setState('idle');
    }

    return { enqueue: enqueue, cancel: cancel, beginTurn: beginTurn, state: function () { return state; },
      stats: function () { return Object.assign({}, stats); }, provider: impl.id, mock: !!impl.mock };
  }

  return { provider: provider, createSpeaker: createSpeaker, capabilities: capabilities, pickVoice: pickVoice, MAX_CHUNK: MAX_CHUNK };
});
