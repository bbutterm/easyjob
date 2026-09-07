/* Бенчмарк живого интервью: деление текста, ранняя первая фраза,
   реплики из распознанного текста, сквозная задержка конвейера
   (поток модели → фразы → синтез) на заглушках. Без сети.

   Запуск: node tools/live-bench.js [--mode naive|segment] [--json]
   Виртуальное время: поток модели 120 знаков/с, синтез заглушки
   считает длительность речи 15 знаков/с и задержку запроса. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const S = require('../shared/text/segment.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'segmentation-ru.json'), 'utf8'));
const args = process.argv.slice(2);
const mode = args[args.indexOf('--mode') + 1] && args.indexOf('--mode') >= 0 ? args[args.indexOf('--mode') + 1] : 'segment';
const asJson = args.indexOf('--json') >= 0;
const opt = function (name, fallback) { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : fallback; };
const STREAM_OPTS = { firstChunkMin: opt('first', undefined), minChars: opt('min', undefined), maxChars: opt('max', undefined), firstChunkMax: opt('firstmax', undefined) };
Object.keys(STREAM_OPTS).forEach(function (k) { if (STREAM_OPTS[k] === undefined) delete STREAM_OPTS[k]; });
const CHARS_PER_SEC = 120;     /* поток модели ≈ 30 токенов/с */
const SPEECH_CHARS_PER_SEC = 15; /* темп речи синтеза */
const TTS_REQUEST_MS = 250;    /* задержка одного запроса к синтезу на сервере */

/* Базовая линия: наивное деление по [.!?] и потоковый режим «по размеру». */
function naiveSentences(text) {
  return String(text).split(/(?<=[.!?])\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
}
function naiveStream() {
  let buf = '';
  return { feed(d) { buf += d; return []; }, flush() { const out = naiveSentences(buf); buf = ''; return out; } };
}

function segmentation() {
  let predicted = 0, expected = 0, correct = 0;
  const failures = [];
  fixture.texts.forEach(function (t) {
    const got = mode === 'naive' ? naiveSentences(t.text) : S.sentences(t.text);
    predicted += got.length; expected += t.sentences.length;
    const exp = t.sentences.slice();
    got.forEach(function (g) { const i = exp.indexOf(g); if (i >= 0) { correct++; exp.splice(i, 1); } });
    if (exp.length || got.length !== t.sentences.length) failures.push({ id: t.id, got, expected: t.sentences });
  });
  const p = predicted ? correct / predicted : 0, r = expected ? correct / expected : 0;
  return { precision: p, recall: r, f1: p + r ? 2 * p * r / (p + r) : 0, failures };
}

/* Поток: символы приходят по 3 за 25 мс; первая фраза → время до речи. */
function streaming() {
  const rows = fixture.replies.map(function (reply) {
    const seg = mode === 'naive' ? naiveStream() : S.createStream(STREAM_OPTS);
    let consumed = 0, firstAt = null, chunks = [];
    for (let i = 0; i < reply.length; i += 3) {
      const delta = reply.slice(i, i + 3);
      consumed += delta.length;
      const out = seg.feed(delta);
      if (out.length && firstAt === null) firstAt = consumed;
      chunks = chunks.concat(out);
    }
    const tail = seg.flush();
    if (tail.length && firstAt === null) firstAt = consumed;
    chunks = chunks.concat(tail);
    const lengths = chunks.map(function (c) { return c.length; });
    return { chars: reply.length, ttfcMs: Math.round(firstAt / CHARS_PER_SEC * 1000), chunks: chunks.length,
      minLen: Math.min.apply(null, lengths), maxLen: Math.max.apply(null, lengths),
      short: lengths.filter(function (l) { return l < 15; }).length, over: lengths.filter(function (l) { return l > 220; }).length,
      joined: chunks.join(' ') === reply.replace(/\s+/g, ' ').trim() };
  });
  const avg = function (k) { return Math.round(rows.reduce(function (a, r) { return a + r[k]; }, 0) / rows.length); };
  return { rows, avgTtfcMs: avg('ttfcMs'), avgChunks: avg('chunks'), short: rows.reduce(function (a, r) { return a + r.short; }, 0),
    over: rows.reduce(function (a, r) { return a + r.over; }, 0), lossless: rows.every(function (r) { return r.joined; }) };
}

/* Реплики из распознанного текста: без пунктуации — одна реплика; с
   пунктуацией — по предложениям, не длиннее предела. */
function utterances() {
  return fixture.transcripts.map(function (t) {
    const parts = mode === 'naive' ? [t] : S.utterances(t, 200);
    return { chars: t.length, parts: parts.length, maxLen: Math.max.apply(null, parts.map(function (p) { return p.length; })),
      cutMidSentence: parts.some(function (p) { return /[а-яё],$/.test(p); }) };
  });
}

/* Сквозной конвейер в виртуальном времени: поток модели → фразы → синтез.
   prefetch — сколько фраз синтезируются заранее, пока играет текущая. */
function pipeline(prefetch) {
  const rows = fixture.replies.map(function (reply) {
    const seg = mode === 'naive' ? naiveStream() : S.createStream(STREAM_OPTS);
    let t = 0; const ready = []; /* {text, readyAt} */
    for (let i = 0; i < reply.length; i += 3) {
      t = (i + 3) / CHARS_PER_SEC * 1000;
      seg.feed(reply.slice(i, i + 3)).forEach(function (c) { ready.push({ text: c, at: t }); });
    }
    t = reply.length / CHARS_PER_SEC * 1000;
    seg.flush().forEach(function (c) { ready.push({ text: c, at: t }); });
    /* Синтез: запрос стартует, когда фраза готова и есть свободный слот предвыборки. */
    /* prefetch = 0: синтез следующей фразы начинается, когда текущая
       доиграла; prefetch = k: когда началась фраза i-k. */
    let playEnd = 0, firstAudio = null, gaps = 0, gapMs = 0;
    const playStarts = [];
    ready.forEach(function (c, i) {
      const slotFree = prefetch === 0 ? playEnd : (i - prefetch >= 0 ? playStarts[i - prefetch] : 0);
      const start = Math.max(c.at, slotFree);
      const done = start + TTS_REQUEST_MS;
      const playStart = Math.max(done, playEnd);
      if (firstAudio === null) firstAudio = playStart;
      else if (playStart > playEnd) { gaps++; gapMs += playStart - playEnd; }
      playStarts.push(playStart);
      playEnd = playStart + c.text.length / SPEECH_CHARS_PER_SEC * 1000;
    });
    return { firstAudioMs: Math.round(firstAudio), totalMs: Math.round(playEnd), gaps, gapMs: Math.round(gapMs), chunks: ready.length };
  });
  const avg = function (k) { return Math.round(rows.reduce(function (a, r) { return a + r[k]; }, 0) / rows.length); };
  return { avgFirstAudioMs: avg('firstAudioMs'), avgTotalMs: avg('totalMs'), gaps: rows.reduce(function (a, r) { return a + r.gaps; }, 0), avgGapMs: avg('gapMs') };
}

const result = { mode, segmentation: segmentation(), streaming: streaming(), utterances: utterances(),
  pipelineNoPrefetch: pipeline(0), pipelinePrefetch2: pipeline(2) };
if (asJson) { console.log(JSON.stringify(result, null, 1)); process.exit(0); }
const seg = result.segmentation, st = result.streaming;
console.log('Режим: ' + mode);
console.log('Деление на предложения: precision ' + seg.precision.toFixed(3) + ', recall ' + seg.recall.toFixed(3) + ', F1 ' + seg.f1.toFixed(3)
  + (seg.failures.length ? '; расхождения: ' + seg.failures.map(function (f) { return f.id; }).join(', ') : ''));
console.log('Поток: время до первой фразы ' + st.avgTtfcMs + ' мс (среднее по ' + st.rows.length + ' репликам), фраз на реплику ' + st.avgChunks
  + ', коротких (<15) ' + st.short + ', длинных (>220) ' + st.over + ', без потерь: ' + (st.lossless ? 'да' : 'нет'));
console.log('Реплики STT: ' + result.utterances.map(function (u) { return u.chars + ' зн. → ' + u.parts + ' частей, макс ' + u.maxLen + (u.cutMidSentence ? ', обрыв внутри' : ''); }).join(' | '));
console.log('Конвейер без предвыборки: первая речь ' + result.pipelineNoPrefetch.avgFirstAudioMs + ' мс, всего ' + result.pipelineNoPrefetch.avgTotalMs + ' мс, пауз ' + result.pipelineNoPrefetch.gaps + ' (≈' + result.pipelineNoPrefetch.avgGapMs + ' мс на реплику)');
console.log('Конвейер с предвыборкой 2: первая речь ' + result.pipelinePrefetch2.avgFirstAudioMs + ' мс, всего ' + result.pipelinePrefetch2.avgTotalMs + ' мс, пауз ' + result.pipelinePrefetch2.gaps + ' (≈' + result.pipelinePrefetch2.avgGapMs + ' мс на реплику)');
if (seg.failures.length) seg.failures.forEach(function (f) { console.log('  ' + f.id + ': получено ' + JSON.stringify(f.got)); });
