/* Проверки общего слоя: контекст, сборка запроса, адаптеры.
   Запуск: node tests/shared.test.js
   Сеть не используется: провайдер mock работает без запросов. */

'use strict';

var V = require('../shared/ai/variables.js');
var C = require('../shared/ai/capabilities.js');
var R = require('../shared/ai/request.js');
var P = require('../shared/ai/providers/index.js');
var CS = require('../shared/context/store.js');

var results = [];
function ok(name, cond, extra) {
  results.push({ name: name, pass: !!cond, extra: extra || '' });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
}

/* ---- Каталог переменных ---- */
ok('Каталог переменных не пуст', V.allVariables().length >= 40, V.allVariables().length + ' шт.');
ok('Все переменные имеют источник', V.allVariables().every(function (v) { return !!v.source; }));
ok('Все задачи описывают формат ответа', V.tasks.every(function (t) { return !!t.outputShape; }));
ok('Каждая задача имеет значения по умолчанию',
  V.tasks.every(function (t) { return R.defaultsFor(t.id).maxOutputTokens > 0; }));
ok('Подсказка на интервью ограничена по длине',
  R.defaultsFor('assistant.hint').maxWords > 0 && R.defaultsFor('assistant.hint').maxOutputTokens <= 400);

/* ---- Слои контекста ---- */
var store = CS.create({ contextBudget: 4000, windowTurns: 4 });
store.set('identity', { language: 'ru-RU', profession: 'Электрик', professionKnown: false });
store.set('preparation', {
  weakSpots: ['Допуск по электробезопасности не указан'],
  requirements: [{ text: 'Группа допуска' }, { text: 'Работа на высоте' }],
  experience: [{ role: 'Электрик', company: 'Демо' }, { role: 'Помощник', company: 'Демо-2' }],
  vacancyRawText: 'x'.repeat(20000)
});
for (var i = 0; i < 9; i++) {
  store.addTurn({ role: i % 2 ? 'candidate' : 'interviewer', text: 'Реплика ' + i, topic: 'тема' + i });
}
store.set('moment', { text: 'y'.repeat(9000), textDelta: 'новый фрагмент', image: 'z'.repeat(40000),
  captureConsent: true });
var built = store.build();

ok('Контекст уложился в бюджет', built.report.totalTokens <= built.report.budget,
  built.report.totalTokens + ' / ' + built.report.budget);
ok('Окно реплик ограничено', built.context.session.turns.length === 4,
  built.context.session.turns.length + ' реплик');
ok('Вытесненные реплики попали в свёртку', built.context.session.turnsSummary.length > 0);
ok('Слабые места сохранены при усечении',
  Array.isArray(built.context.preparation.weakSpots) && built.context.preparation.weakSpots.length === 1);
ok('Объёмный текст вакансии отброшен первым',
  built.context.preparation.vacancyRawText === undefined);
ok('Отчёт об усечении не пустой', built.report.dropped.length > 0,
  built.report.dropped.length + ' записей');

/* ---- Сборка запроса ---- */
var req = R.build('assistant.hint', built.context, { provider: 'anthropic', locale: 'ru-RU' });
ok('Запрос знает свою задачу', req.task === 'assistant.hint');
ok('Модель Anthropic подставлена по умолчанию', req.model === 'claude-opus-5', req.model);
ok('Системная инструкция запрещает выдумывать', /Не придумывай/.test(req.system));
ok('Профессия попала в текст запроса', req.userText.indexOf('Электрик') >= 0);
ok('Признак профессии вне справочника передан',
  req.userText.indexOf('в справочнике сервиса такой профессии нет') >= 0);
ok('Ограничение по числу слов включено в инструкцию', /не длиннее 40 слов/.test(req.system));

/* Изображение уходит только при согласии и поддержке провайдером */
var visionReq = R.build('screen.extract',
  { moment: { image: 'AAA', captureConsent: true } }, { provider: 'anthropic' });
ok('Кадр передаётся, когда провайдер умеет изображения и есть согласие', !!visionReq.image);

var noConsentReq = R.build('screen.extract',
  { moment: { image: 'AAA', captureConsent: false } }, { provider: 'anthropic' });
ok('Без согласия кадр не передаётся', noConsentReq.image === null);

var localReq = R.build('screen.extract',
  { moment: { image: 'AAA', captureConsent: true } }, { provider: 'openai_compatible' });
ok('Провайдеру без поддержки изображений кадр не отправляется', localReq.image === null);

/* ---- Адаптеры ---- */
var wire = P.adapter('anthropic').toWire(req, { apiKey: 'секрет' });
ok('Anthropic: системная инструкция отдельным полем', typeof wire.body.system === 'string');
ok('Anthropic: история в поле messages', Array.isArray(wire.body.messages));
ok('Anthropic: заголовок версии проставлен', !!wire.headers['anthropic-version']);
ok('Anthropic: короткой задаче задана низкая глубина рассуждения',
  wire.body.output_config && wire.body.output_config.effort === 'low');

var oaWire = P.adapter('openai').toWire(req, { apiKey: 'секрет' });
ok('OpenAI: системная инструкция первым сообщением',
  oaWire.body.messages[0].role === 'system');

var gemWire = P.adapter('gemini').toWire(req, { apiKey: 'секрет' });
ok('Gemini: системная инструкция отдельным полем', !!gemWire.body.system_instruction);
ok('Gemini: история называется contents', Array.isArray(gemWire.body.contents));

/* ---- Скрытие персональных данных в логах ---- */
var log = R.redactForLog({
  experience: [{ role: 'Электрик', company: 'Демо' }],
  answers: { q1: 'мой ответ' },
  skills: ['Группа допуска']
});
ok('Опыт скрыт в логе', log.experience === '[скрыто]');
ok('Ответы скрыты в логе', log.answers === '[скрыто]');
ok('Ненчувствительное поле осталось', Array.isArray(log.skills));

/* ---- Разбор ответа ---- */
ok('Чистый JSON разбирается', R.parseJson('{"a":1}').ok);
ok('JSON внутри текста разбирается', R.parseJson('Вот ответ: {"a":2} — всё').value.a === 2);
ok('Мусор не ломает разбор', R.parseJson('совсем не json').ok === false);

/* ---- Регрессии: три бага, найденные аудитом ---- */

/* Баг 1: кадр экрана оценивался как текст по длине base64 и всегда
   отбрасывался при сборке контекста. */
var frameStore = CS.create({ contextBudget: 12000 });
frameStore.set('identity', { profession: 'Повар' });
frameStore.set('moment', {
  captureConsent: true,
  image: { data: 'A'.repeat(600 * 1024), mediaType: 'image/png', width: 1280, height: 720 }
});
var frameBuilt = frameStore.build();
ok('Вес кадра считается по разрешению, а не по длине base64',
  CS.estimateImageTokens({ width: 1280, height: 720 }) < 2000,
  CS.estimateImageTokens({ width: 1280, height: 720 }) + ' токенов');
ok('Настоящий кадр доходит до контекста', frameBuilt.context.moment.image !== undefined);
var frameReq = R.build('screen.extract', frameBuilt.context, { provider: 'anthropic' });
ok('Настоящий кадр попадает в запрос', frameReq.image !== null && frameReq.image.data.length > 1000);
ok('Огромный кадр всё же отбрасывается по бюджету',
  (function () {
    var s2 = CS.create({ contextBudget: 2000 });
    s2.set('moment', { captureConsent: true,
      image: { data: 'A', mediaType: 'image/png', width: 4000, height: 4000 } });
    return s2.build().context.moment.image === undefined;
  })());

/* Баг 2: задачи с потоковым выводом падали, потому что ответ
   разбирался через response.json(). */
function fakeStream(events) {
  var lines = events.map(function (e) { return 'data: ' + JSON.stringify(e) + '\n\n'; });
  lines.push('data: [DONE]\n\n');
  return function () {
    var enc = new TextEncoder();
    var i = 0;
    return Promise.resolve({ ok: true, status: 200, body: { getReader: function () {
      return { read: function () {
        if (i >= lines.length) return Promise.resolve({ done: true });
        return Promise.resolve({ done: false, value: enc.encode(lines[i++]) });
      } };
    } } });
  };
}

/* Баг 3: скрытие персональных данных не покрывало реальные имена полей. */
var log2 = R.redactForLog({ rawResumeText: 'Иванов Иван, +7 900 000-00-00', skills: ['SQL'] });
ok('Текст загруженного резюме скрыт в логе', log2.rawResumeText === '[скрыто]');
ok('Нечувствительные поля в логе сохранены', Array.isArray(log2.skills));

/* ---- Заглушка провайдера ---- */
(async function () {
  var mockReq = R.build('assistant.hint', built.context, { provider: 'mock' });
  var res = await P.execute(mockReq, {}, function () {
    throw new Error('Заглушка не должна ходить в сеть');
  });
  ok('Заглушка отвечает без сети', res.ok && res.mock === true);
  var parsed = R.parseJson(res.text);
  ok('Ответ заглушки — корректный JSON с направлением ответа',
    parsed.ok && typeof parsed.value.direction === 'string');

  /* Поток событий собирается в текст, рассуждение в него не попадает. */
  var streamReq = R.build('assistant.hint', built.context, { provider: 'anthropic' });
  var chunks = [];
  streamReq.onDelta = function (d) { chunks.push(d); };
  var streamRes = await P.execute(streamReq, { apiKey: 'x' }, fakeStream([
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"direction":' } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'рассуждение' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: ' "Один пример"}' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
  ]));
  ok('Потоковый ответ собирается в текст', streamRes.ok && streamRes.text.length > 0, streamRes.text);
  ok('Блоки рассуждения не попадают в текст ответа', streamRes.text.indexOf('рассуждение') < 0);
  ok('Ответ из потока разбирается как JSON',
    R.parseJson(streamRes.text).ok && R.parseJson(streamRes.text).value.direction === 'Один пример');
  ok('Куски приходят по мере поступления', chunks.length === 2, chunks.length + ' кусков');

  var truncated = await P.execute(streamReq, { apiKey: 'x' }, fakeStream([
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"direction": "обрыв' } },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }
  ]));
  ok('Обрыв по лимиту длины помечается', truncated.ok === true && truncated.truncated === true);

  var failed = results.filter(function (r) { return !r.pass; });
  console.log('\nИтого: ' + (results.length - failed.length) + ' из ' + results.length + ' проверок пройдено.');
  process.exit(failed.length ? 1 : 0);
})();
