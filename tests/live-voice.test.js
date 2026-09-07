/* Живое интервью: деление текста, очередь синтеза, серверный синтез.
   Без сети и без звука: заглушки с виртуальными таймерами.
   Запуск: node --no-warnings tests/live-voice.test.js */

'use strict';

const http = require('node:http');
const S = require('../shared/text/segment.js');
const T = require('../shared/tts/index.js');
const TtsServer = require('../server/lib/tts-server.js');

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
}

/* ---- Деление ---- */
const fx = require('./fixtures/segmentation-ru.json');
let exact = 0;
fx.texts.forEach(function (t) { if (JSON.stringify(S.sentences(t.text)) === JSON.stringify(t.sentences)) exact++; });
ok('Деление на предложения совпадает с эталоном на всём корпусе', exact === fx.texts.length, exact + ' из ' + fx.texts.length);
ok('Сокращения, инициалы, числа и даты не рвут предложение',
  S.sentences('С 2019 г. по 2023 г. работал. А. С. Пушкин. Это 3.5 года, т.е. немало. Дата 12.09.2026.').length === 4);
ok('Реплики для модели режутся по предложениям и не превышают предел',
  S.utterances('Первое предложение достаточно длинное. Второе тоже длинное предложение. Третье.', 60).every(function (u) { return u.length <= 60; })
  && S.utterances('Первое предложение достаточно длинное. Второе тоже длинное предложение. Третье.', 60).length === 2);
ok('Длинная фраза режется по клаузам, потом по пробелам',
  S.splitLong('слово '.repeat(60).trim(), 100).every(function (p) { return p.length <= 100; }));
ok('Нормализация для речи раскрывает сокращения и убирает разметку и ссылки',
  S.forSpeech('Опыт 5 лет и т.д., **важно**: см. https://a.b/c, 30%') === 'Опыт 5 лет и так далее, важно: см. ссылка, 30 процентов', S.forSpeech('Опыт 5 лет и т.д., **важно**: см. https://a.b/c, 30%'));

/* Поток: первая фраза раньше конца предложения; ничего не теряется; порядок сохранён. */
const stream = S.createStream();
const reply = fx.replies[2];
let chunks = [], firstAt = null;
for (let i = 0; i < reply.length; i += 4) { const out = stream.feed(reply.slice(i, i + 4)); if (out.length && firstAt === null) firstAt = i + 4; chunks = chunks.concat(out); }
chunks = chunks.concat(stream.flush());
ok('Потоковое деление без потерь и в порядке', chunks.join(' ') === reply.replace(/\s+/g, ' ').trim(), chunks.length + ' фраз');
ok('Первая фраза отдаётся сразу после первого предложения, не дожидаясь второго', firstAt !== null && firstAt <= reply.indexOf('.') + 6, 'первая на ' + firstAt + ' зн., точка на ' + reply.indexOf('.'));
ok('Нет фраз короче 15 знаков (кроме, возможно, последней)', chunks.slice(0, -1).every(function (c) { return c.length >= 15; }));

/* ---- Очередь синтеза на заглушке с виртуальным временем ---- */
(async () => {
  let vnow = 0; const timers = [];
  const setTimer = function (fn, ms) { const t = { at: vnow + ms, fn, id: timers.length + 1 }; timers.push(t); return t.id; };
  const clearTimer = function (id) { const i = timers.findIndex(function (t) { return t.id === id; }); if (i >= 0) timers.splice(i, 1); };
  async function advance(ms) {
    const until = vnow + ms;
    while (true) {
      await new Promise(function (r) { setImmediate(r); });
      timers.sort(function (a, b) { return a.at - b.at; });
      if (!timers.length || timers[0].at > until) break;
      const t = timers.shift(); vnow = t.at; t.fn();
    }
    vnow = until;
    await new Promise(function (r) { setImmediate(r); });
  }
  const states = [];
  const mock = T.provider({ provider: 'mock', synthMs: 250 }, { setTimer, clearTimer });
  const speaker = T.createSpeaker({ provider: mock, prefetch: 2, now: function () { return vnow; }, onState: function (s) { states.push(s.state); } });
  speaker.beginTurn();
  speaker.enqueue('Первая фраза для проверки очереди синтеза.');
  speaker.enqueue('Вторая фраза, которая должна ждать первую.');
  speaker.enqueue('Третья фраза.');
  await advance(300);
  ok('Первый звук начинается после задержки синтеза, ttfa измерен', speaker.state() === 'speaking' && speaker.stats().ttfaMs === 250, JSON.stringify(speaker.stats()));
  await advance(8000);
  const st = speaker.stats();
  ok('Фразы играют строго по очереди, все три произнесены', st.spoken === 3 && speaker.state() === 'idle', JSON.stringify(st));
  ok('Состояния: synthesizing → speaking → idle', states[0] === 'synthesizing' && states.indexOf('speaking') > 0 && states[states.length - 1] === 'idle', states.join(','));

  /* Barge-in: отмена мгновенно останавливает звук и очередь. */
  speaker.beginTurn();
  speaker.enqueue('Длинная фраза интервьюера, которую кандидат перебивает своим ответом почти сразу после начала.');
  speaker.enqueue('Ещё одна фраза, которая уже не должна прозвучать.');
  await advance(400);
  ok('Перед прерыванием фраза играла', speaker.state() === 'speaking');
  speaker.cancel();
  ok('Прерывание: состояние idle сразу, очередь пуста', speaker.state() === 'idle');
  await advance(10000);
  ok('После прерывания ничего не доиграло и счётчик отмен вырос', speaker.stats().spoken === 3 && speaker.stats().cancelled === 1);

  /* Ошибка синтеза одной фразы не ломает очередь. */
  let calls = 0;
  const flaky = { id: 'mock', mock: true, async synth(text) { calls++; if (calls === 1) throw new Error('boom'); return { play: function (onEnd) { const t = setTimer(onEnd, 100); return { stop: function () { clearTimer(t); } }; } }; } };
  const errors = [];
  const sp2 = T.createSpeaker({ provider: flaky, prefetch: 1, now: function () { return vnow; }, onError: function (e) { errors.push(e.message); } });
  sp2.enqueue('Сломанная фраза.'); sp2.enqueue('Нормальная фраза после ошибки.');
  await advance(1000);
  ok('Ошибка синтеза пропускает фразу и продолжает очередь', errors.length === 1 && sp2.stats().spoken === 1 && sp2.stats().errors === 1);

  /* Слишком длинный текст делится на части ≤ 600. */
  const sp3 = T.createSpeaker({ provider: T.provider({ provider: 'mock', durationMs: 10 }, { setTimer, clearTimer }), now: function () { return vnow; } });
  sp3.enqueue(('Очень длинная фраза интервьюера. ').repeat(40));
  await advance(5000);
  ok('Фраза длиннее 600 знаков делится и произносится целиком', sp3.stats().spoken >= 3);

  /* Выбор голоса браузера. */
  const voices = [{ lang: 'en-US', name: 'A' }, { lang: 'ru-RU', name: 'B', localService: false }, { lang: 'ru-RU', name: 'C', localService: true }, { lang: 'ru', name: 'D' }];
  ok('Голос: точный ru-RU и локальный в приоритете', T.pickVoice(voices, 'ru-RU').name === 'C' && T.pickVoice([voices[0], voices[3]], 'ru-RU').name === 'D' && T.pickVoice([voices[0]], 'ru-RU') === null);

  /* Серверный провайдер в браузере: запрос, аудио, пометка заглушки. */
  const played = [];
  const fakeAudio = function (url) { const a = { src: url, play: function () { played.push(url); setTimer(function () { a.onended && a.onended(); }, 50); return Promise.resolve(); }, pause: function () {} }; return a; };
  let posted = null;
  const serverImpl = T.provider({ provider: 'server' }, { fetcher: async function (url, init) { posted = { url, body: JSON.parse(init.body) }; return { ok: true, headers: { get: function (k) { return k === 'x-tts-mock' ? '1' : 'audio/wav'; } }, blob: async function () { return 'blob'; } }; },
    Audio: fakeAudio, createObjectURL: function () { return 'blob:1'; }, revokeObjectURL: function () {} });
  const sp4 = T.createSpeaker({ provider: serverImpl, now: function () { return vnow; } });
  sp4.enqueue('Фраза для сервера, т.е. через API.');
  await advance(500);
  ok('Серверный провайдер шлёт нормализованный текст в /api/tts/speak и играет ответ',
    posted && posted.url === '/api/tts/speak' && posted.body.text === 'Фраза для сервера, то есть через API.' && played.length === 1 && sp4.stats().spoken === 1);

  /* ---- Серверный синтез: заглушка, Piper, OpenAI-совместимый ---- */
  const wav = await TtsServer.speak('Тишина вместо речи.', { env: { TTS_PROVIDER: 'mock' } });
  ok('Заглушка сервера: WAV тишины пропорционально длине, помечена', wav.mock && wav.bytes.subarray(0, 4).toString() === 'RIFF' && wav.bytes.length > 44 * 2 && wav.type === 'audio/wav');
  let piperReq = null;
  const piper = http.createServer(function (req, res) {
    let raw = ''; req.on('data', function (c) { raw += c; }); req.on('end', function () {
      piperReq = { url: req.url, body: JSON.parse(raw), auth: req.headers.authorization };
      res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(Buffer.from('RIFFxxxxWAVEdata'));
    });
  });
  await new Promise(function (r) { piper.listen(0, '127.0.0.1', r); });
  const pEnv = { TTS_PROVIDER: 'piper_http', TTS_ENDPOINT: 'http://127.0.0.1:' + piper.address().port + '/', TTS_VOICE: 'ru_RU-irina-medium' };
  const p1 = await TtsServer.speak('Здравствуйте, начнём.', { env: pEnv });
  ok('Piper: POST {text, voice} на локальный адрес, аудио возвращается как есть', p1.mock === false && piperReq.body.text === 'Здравствуйте, начнём.' && piperReq.body.voice === 'ru_RU-irina-medium' && p1.bytes.length === 16 && !piperReq.auth);
  const oEnv = { TTS_PROVIDER: 'openai_compatible', TTS_ENDPOINT: 'http://127.0.0.1:' + piper.address().port + '/v1/audio/speech', TTS_API_KEY: 'server-secret', TTS_MODEL: 'kokoro', TTS_VOICE: 'af_heart', TTS_FORMAT: 'wav' };
  const o1 = await TtsServer.speak('Тест совместимого сервиса.', { env: oEnv });
  ok('OpenAI-совместимый: /v1/audio/speech с model, input, voice и ключом с сервера',
    o1.provider === 'openai_compatible' && piperReq.url === '/v1/audio/speech' && piperReq.body.input === 'Тест совместимого сервиса.' && piperReq.body.model === 'kokoro'
    && piperReq.body.voice === 'af_heart' && piperReq.auth === 'Bearer server-secret');
  piper.close();
  const down = await TtsServer.speak('x', { env: { TTS_PROVIDER: 'piper_http', TTS_ENDPOINT: 'http://127.0.0.1:1/' } }).catch(function (e) { return e; });
  ok('Недоступный сервис — 502 tts_unavailable', down.status === 502 && down.extra.code === 'tts_unavailable');
  const long = await TtsServer.speak('x'.repeat(601), { env: { TTS_PROVIDER: 'mock' } }).catch(function (e) { return e; });
  ok('Фраза длиннее 600 знаков — 413', long.status === 413);
  const badEnv = await TtsServer.speak('x', { env: { TTS_PROVIDER: 'openai_compatible', TTS_ENDPOINT: 'ftp://x' } }).catch(function (e) { return e; });
  ok('Некорректная настройка — 503 tts_unconfigured', badEnv.status === 503 && badEnv.extra.code === 'tts_unconfigured');

  const failed = results.filter(function (r) { return !r.pass; });
  console.log('\nИтого: ' + (results.length - failed.length) + ' из ' + results.length + ' проверок пройдено.');
  process.exit(failed.length ? 1 : 0);
})().catch(function (e) { console.error('ОШИБКА ТЕСТА:', e); process.exit(1); });
