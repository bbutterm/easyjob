/* Проверки управления контекстом: счётчик, политики, жёсткий предел,
   сохранение обязательных полей. Без сети. Запуск: node tests/context.test.js */

'use strict';

const T = require('../shared/context/tokens.js');
const Pol = require('../shared/context/policy.js');
const CS = require('../shared/context/store.js');
const R = require('../shared/ai/request.js');
const P = require('../shared/ai/providers/index.js');

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
}

/* ---- Счётчик токенов ---- */
const c1 = T.count('Расскажите о самой сложной задаче в вашей работе.');
ok('Оценка помечена как неточная, когда токенизатора нет', c1.exact === false && c1.tokens > 0, c1.tokens + ' токенов');
ok('Оценка консервативна: не меньше символов/3', c1.tokens >= Math.ceil(50 / 3));
const req0 = T.countRequest({ system: 'x'.repeat(260), messages: [{ text: 'y'.repeat(260) }] });
ok('Размер запроса включает служебные токены сообщений', req0.tokens > 200 && req0.breakdown.system > 0);
const img = T.countRequest({ image: { width: 1280, height: 720 } });
ok('Изображение считается по разрешению', img.breakdown.image === 1229);

/* ---- Политики ---- */
const turnPol = Pol.policyFor('interview.turn');
ok('Политика интервью: предел 6000, окно 6', turnPol.inputCap === 6000 && turnPol.windowTurns === 6);
ok('Резерв на ответ зависит от подтверждённого выключения рассуждения',
  Pol.inputAllowance(turnPol, false) < Pol.inputAllowance(turnPol, true));
const over = Pol.policyFor('interview.turn', { tasks: { 'interview.turn': { inputCap: 9000 } } });
ok('Политику можно переопределить без правки кода', over.inputCap === 9000 && over.windowTurns === 6);
ok('Неизвестная задача получает политику по умолчанию', Pol.policyFor('nope').inputCap === Pol.DEFAULT.inputCap);

/* ---- Жёсткий предел после сериализации ---- */
function bigStore() {
  const st = CS.create({ contextBudget: 6000, windowTurns: 6 });
  st.set('identity', { profession: 'Повар' });
  st.set('preparation', {
    weakSpots: ['Медицинская книжка в резюме не указана'],
    requirements: [{ text: 'Горячий цех' }, { text: 'Медкнижка' }],
    experience: [{ role: 'Повар', details: 'x'.repeat(3000) }],
    vacancyRawText: 'v'.repeat(12000), rawResumeText: 'r'.repeat(12000)
  });
  for (let i = 0; i < 20; i++) st.addTurn({ role: i % 2 ? 'candidate' : 'interviewer', text: 'Реплика ' + i + ' ' + 'т'.repeat(300) });
  return st;
}
const fit1 = R.fit('interview.turn', bigStore(), { provider: 'groq', model: 'qwen/qwen3-32b' });
ok('Переполненный контекст подогнан под предел', fit1.ok && fit1.sizing.inputTokens <= fit1.sizing.allowance,
  fit1.sizing.inputTokens + '/' + fit1.sizing.allowance);
ok('Исходные тексты выброшены первыми', fit1.sizing.dropped.some(function (d) { return /rawResumeText/.test(d); })
  && fit1.sizing.dropped.some(function (d) { return /vacancyRawText/.test(d); }));
ok('Обязательное поле (слабые места) сохранено', fit1.request.userText.indexOf('Медицинская книжка') >= 0);
ok('Текущая реплика сохранена', fit1.request.userText.indexOf('Реплика 19') >= 0);
ok('Предел на ответ ограничен резервом политики', fit1.request.maxOutputTokens <= turnPol.outputReserve);
ok('Размер помечен как оценка', fit1.sizing.exact === false);

/* Обязательное не помещается — запрос не отправляется. */
const st2 = CS.create({ contextBudget: 6000, windowTurns: 6 });
st2.set('identity', { profession: 'Повар' });
st2.set('preparation', { weakSpots: ['w'.repeat(30000)] });
st2.addTurn({ role: 'interviewer', text: 'вопрос' });
const fit2 = R.fit('interview.turn', st2, { provider: 'groq' });
ok('Невместимое обязательное даёт контролируемую ошибку', !fit2.ok && fit2.overflow === true && /не помещается/.test(fit2.error));
ok('При переполнении сообщается размер и предел', fit2.sizing.inputTokens > fit2.sizing.allowance);

/* Длинная единственная реплика: не режется молча, а либо помещается, либо ошибка. */
const st3 = CS.create({ contextBudget: 6000, windowTurns: 6 });
st3.set('identity', { profession: 'Повар' });
st3.set('preparation', { weakSpots: ['Медкнижка'] });
st3.addTurn({ role: 'candidate', text: 'Начало ответа. ' + 'д'.repeat(9000) + ' Конец с числом 42.' });
const fit3 = R.fit('interview.turn', st3, { provider: 'groq' });
ok('Длинная единственная реплика не обрезается молча',
  (fit3.ok && fit3.request.userText.indexOf('Конец с числом 42') >= 0) || (!fit3.ok && fit3.overflow === true),
  fit3.ok ? 'поместилась целиком' : 'контролируемая ошибка');

/* Итог интервью использует широкое окно, а не последние 6 реплик. */
const st4 = CS.create({ contextBudget: 16000, windowTurns: Pol.policyFor('interview.summary').windowTurns });
st4.set('identity', { profession: 'Повар' });
st4.set('preparation', { weakSpots: ['Медкнижка'] });
for (let i = 0; i < 30; i++) st4.addTurn({ role: i % 2 ? 'candidate' : 'interviewer', text: 'Реплика ' + i + ' короткая' });
const fit4 = R.fit('interview.summary', st4, { provider: 'groq' });
ok('Итог видит ранние реплики (окно 40)', fit4.ok && fit4.request.userText.indexOf('Реплика 0 ') >= 0
  && fit4.request.userText.indexOf('Реплика 29') >= 0);

/* ---- Память интервью: проверка формы и ссылок ---- */
const CM = require('../server/lib/context-memory.js');
const turns = [{ seq: 1, role: 'interviewer', text: 'Расскажите об опыте' },
  { seq: 2, role: 'candidate', text: 'Я работал в 2019 году, не в 2020' },
  { seq: 3, role: 'candidate', text: 'Поправлюсь: в 2020 году' }];
const good = CM.validate({ facts: [
  { factId: 'year', value: '2019', status: 'user_said', sourceRef: { kind: 'turn', seq: 2 }, quote: '2019' },
  { factId: 'year2', value: '2020', status: 'user_said', sourceRef: { kind: 'turn', seq: 3 }, supersedes: 'year' },
  { factId: 'doc', value: 'Горячий цех', status: 'in_document', sourceRef: { kind: 'document', field: 'resume.experience' } }
], contradictions: [{ text: 'год: 2019 → 2020', seqs: [2, 3] }] }, turns);
ok('Память: исправление хранится как факт с supersedes, прежний не удаляется', good.ok && good.memory.facts.length === 3
  && good.memory.facts[1].supersedes === 'year');
const merged = CM.merge(null, good.memory);
ok('Память: после слияния замещённый факт скрыт из действующих, но остаётся', CM.activeFacts(merged).length === 2
  && merged.facts.length === 3 && merged.facts[0].supersededBy === 'year2');
const bad = CM.validate({ facts: [
  { factId: 'x', value: 'что-то', status: 'confirmed', sourceRef: { kind: 'turn', seq: 99 } },
  { factId: 'y', value: 'цитата', status: 'user_said', sourceRef: { kind: 'turn', seq: 2 }, quote: 'этого не было' },
  { factId: 'z', value: 'без источника', status: 'confirmed' },
  { factId: '__proto__', value: 'плохой id', status: 'unknown' }
] }, turns);
ok('Память: ссылка на несуществующую реплику, чужая цитата, статус без источника и плохой id отклоняются',
  !bad.ok && bad.memory.facts.length === 0 && bad.errors.length === 4, bad.errors.join(' | '));
ok('Память: существование ссылки не делает факт подтверждённым — статус берётся из записи, не выдумывается',
  good.memory.facts[0].status === 'user_said');

/* ---- Часть D: снимок, подтверждения, память в запросе ---- */
const Pr = require('../shared/ai/prompts.js');
const Ev = require('../server/lib/evidence.js');

const st5 = CS.create({ contextBudget: 6000, windowTurns: 6 });
st5.set('identity', { profession: 'Повар' });
st5.set('preparation', { weakSpots: ['Медкнижка не указана'],
  evidence: [{ source: 'resume.experience[0]', text: 'Повар горячего цеха, Пушкин' }, { source: 'turn:2', text: 'кандидат: готовил соусы' }] });
for (let i = 1; i <= 3; i++) st5.addTurn({ role: i % 2 ? 'interviewer' : 'candidate', text: 'Реплика ' + i, seq: i });
st5.patch('session', { memory: { facts: [{ factId: 'f1', value: 'Пять лет в горячем цехе', status: 'user_said',
  sourceRef: { kind: 'turn', seq: 2, quote: 'пять лет' } }], contradictions: [{ text: 'Срок опыта расходится', seqs: [2] }],
  unresolvedQuestions: ['Есть ли медкнижка?'], coveredThroughSeq: 2 } });
ok('Реплики в хранилище сохраняют seq', st5.get('session').turns.every(function (t, i) { return t.seq === i + 1; }));
const fit5 = R.fit('interview.turn', st5, { provider: 'groq' });
const u5 = fit5.ok ? fit5.request.userText : '';
const idx = function (m) { return u5.indexOf(m); };
ok('Порядок разделов: задача → снимок → подтверждения → память → реплики',
  idx('[ЗАДАЧА]') === 0 && idx('[СЛАБЫЕ МЕСТА') < idx('[ПОДТВЕРЖДЕНИЯ') && idx('[ПОДТВЕРЖДЕНИЯ') < idx('[ПАМЯТЬ ИНТЕРВЬЮ]')
  && idx('[ПАМЯТЬ ИНТЕРВЬЮ]') < idx('[ПОСЛЕДНИЕ РЕПЛИКИ]'), fit5.ok ? '' : fit5.error);
ok('Память в запросе — текст со статусом из реестра и ссылкой на реплику',
  /сказал кандидат: Пять лет в горячем цехе \(реплика 2\)/.test(u5) && /Противоречия/.test(u5) && /Открытые вопросы/.test(u5)
  && /до № 2/.test(u5));
ok('Подтверждения перечислены с источником', /\(resume\.experience\[0\]\) Повар горячего цеха/.test(u5) && /\(turn:2\)/.test(u5));
ok('Итог интервью тоже получает память и подтверждения',
  Pr.buildUser('interview.summary', { session: { memory: { facts: [] , unresolvedQuestions: ['x'] } },
    preparation: { evidence: [{ source: 'turn:3', text: 'y' }] } }).indexOf('[ПАМЯТЬ ИНТЕРВЬЮ]') >= 0);
ok('Разбор вакансии память и подтверждения не получает',
  Pr.buildUser('vacancy.parse', { session: { memory: { facts: [], unresolvedQuestions: ['x'] } },
    preparation: { evidence: [{ source: 'turn:3', text: 'y' }], vacancyRawText: 'z' } }).indexOf('ПАМЯТЬ') < 0);

/* Память укорачивается с ранних фактов, а не выбрасывается; последняя реплика остаётся. */
const st6 = CS.create({ contextBudget: 2000, windowTurns: 6 });
st6.set('identity', { profession: 'Повар' });
const manyFacts = [];
for (let i = 0; i < 60; i++) manyFacts.push({ factId: 'f' + i, value: 'Факт номер ' + i + ' ' + 'x'.repeat(60), status: 'unknown', sourceRef: null });
st6.addTurn({ role: 'candidate', text: 'Текущая реплика', seq: 1 });
st6.patch('session', { memory: { facts: manyFacts, coveredThroughSeq: 0 } });
const b6 = st6.build();
ok('При нехватке места память теряет ранние факты и сообщает об этом',
  b6.context.session.memory.facts.length < 60 && b6.context.session.memory.facts[0].factId !== 'f0'
  && b6.context.session.turns.length === 1 && b6.report.dropped.some(function (d) { return /session\.memory/.test(d); }),
  b6.context.session.memory.facts.length + ' фактов осталось');

/* Основы слов для подстрочного поиска. */
const stems = Ev.terms('Расскажите, пожалуйста, как вы работали в горячем цехе и какие соусы готовили?');
ok('Ключи поиска: без служебных слов, с основами длинных слов',
  stems.indexOf('расскаж') < 0 && stems.indexOf('пожалуй') < 0 && stems.indexOf('горяч') >= 0 && stems.indexOf('соусы') >= 0, stems.join(','));
ok('Выражение FTS — фразы через OR', Ev.matchExpr(['горяч', 'соусы']) === '"горяч" OR "соусы"');

/* Переполнение не доходит до провайдера. */
(async function () {
  let fetched = false;
  if (fit2.ok) await P.execute(fit2.request, {}, function () { fetched = true; return Promise.reject(new Error('x')); });
  ok('Переполненный запрос не отправляется в сеть', fetched === false);

  const failed = results.filter(function (r) { return !r.pass; });
  console.log('\nИтого: ' + (results.length - failed.length) + ' из ' + results.length + ' проверок пройдено.');
  process.exit(failed.length ? 1 : 0);
})();
