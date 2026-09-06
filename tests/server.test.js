/* Сквозная проверка API на провайдере-заглушке.
   Запуск: node tests/server.test.js
   Сервер поднимается в памяти, сеть наружу не используется. */

'use strict';

const { createApp } = require('../server/index.js');

process.env.AI_PROVIDER = 'mock';
process.env.SESSION_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
}

function client(base) {
  let cookie = '';
  async function call(method, path, body, headers) {
    const res = await fetch(base + path, {
      method, headers: Object.assign({ 'content-type': 'application/json', cookie, origin: base }, headers || {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.indexOf('application/json') >= 0 ? await res.json() : await res.text();
    return { status: res.status, data, res };
  }
  return { call, get cookie() { return cookie; } };
}

const RESUME = {
  profession: 'Повар',
  summary: 'Повар горячего цеха, пять лет в ресторанах полного цикла.',
  experience: [{ role: 'Повар', company: 'Демо-Ресторан', period: '2021 — сейчас',
    details: 'Горячий цех, работа по технологическим картам, заготовки.' }],
  skills: ['Горячий цех', 'Технологические карты', 'Санитарные нормы'],
  achievements: [], education: []
};

const VACANCY_TEXT = 'Ищем повара в ресторан.\n\nТребования:\n— Опыт работы на горячем цехе от 2 лет\n'
  + '— Работа по технологическим картам\n— Действующая медицинская книжка\n— Опыт с авторским меню\n\nУсловия: сменный график.';

(async () => {
  const { server } = createApp({ dbFile: ':memory:', freePrepsPerDay: 2, secure: false });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const a = client(base);

  /* ---- Здоровье и сессия ---- */
  const health = await a.call('GET', '/api/health');
  ok('Сервер отвечает', health.status === 200 && health.data.ok);
  ok('Провайдер по умолчанию — заглушка', health.data.ai.provider === 'mock' && health.data.ai.live === false);
  ok('Cookie сессии выставлена', a.cookie.indexOf('ch_session=') === 0);
  ok('Cookie подписана', a.cookie.indexOf('.') > 0);

  const me = await a.call('GET', '/api/me');
  ok('Сессия видит лимиты', me.data.limits.freePerDay === 2 && me.data.limits.usedToday === 0);
  ok('Список профессий отдаётся', me.data.professions.length >= 8);

  /* ---- Валидация ---- */
  const empty = await a.call('POST', '/api/resumes', { title: 'Пустое', data: {} });
  ok('Пустое резюме отклоняется', empty.status === 400);
  const shortVac = await a.call('POST', '/api/vacancies', { title: 'Повар', rawText: 'коротко' });
  ok('Слишком короткая вакансия отклоняется', shortVac.status === 400);
  const badJson = await fetch(base + '/api/resumes', { method: 'POST',
    headers: { 'content-type': 'application/json', cookie: a.cookie, origin: base }, body: '{' });
  ok('Битый JSON даёт 400, а не 500', badJson.status === 400);
  const foreign = await fetch(base + '/api/resumes', { method: 'POST',
    headers: { 'content-type': 'application/json', cookie: a.cookie, origin: 'http://evil.example' },
    body: JSON.stringify({ title: 'x', data: RESUME }) });
  ok('Запрос с чужого адреса отклоняется', foreign.status === 403);

  /* ---- Резюме и вакансия ---- */
  const resume = await a.call('POST', '/api/resumes', { title: 'Повар — основное', data: RESUME });
  ok('Резюме создано', resume.status === 201 && resume.data.rev === 1, resume.data.id);
  const vacancy = await a.call('POST', '/api/vacancies', { title: 'Повар', company: 'Демо-Ресторан', rawText: VACANCY_TEXT });
  ok('Вакансия создана и требования извлечены', vacancy.status === 201 && vacancy.data.requirements.length >= 3,
    vacancy.data.requirements.length + ' требований');
  ok('Требования взяты из текста, а не выдуманы',
    vacancy.data.requirements.some(function (r) { return /медицинск/i.test(r.text); }));

  /* ---- Подготовка и сопоставление ---- */
  const prep = await a.call('POST', '/api/preps', { resumeId: resume.data.id, vacancyId: vacancy.data.id });
  ok('Подготовка создана с сопоставлением', prep.status === 201 && Array.isArray(prep.data.match) && prep.data.match.length > 0);
  ok('Каждое требование получило статус',
    prep.data.match.every(function (m) { return ['confirmed', 'unclear', 'missing'].indexOf(m.status) >= 0 && m.text; }));
  ok('Ответ помечен как заглушка', prep.data.mock === true);
  ok('Подготовка не устарела', prep.data.stale === false);
  const prepId = prep.data.id;

  /* ---- Вопросы, ответы, карточка ---- */
  const questions = await a.call('POST', '/api/preps/' + prepId + '/questions');
  ok('Вопросы сгенерированы', questions.status === 200 && questions.data.questions.length >= 5);
  const qid = questions.data.questions[0].id;
  const answers = await a.call('PUT', '/api/preps/' + prepId + '/answers', { answers: { [qid]: 'Мой ответ.' }, ready: { [qid]: true } });
  ok('Ответы сохранены', answers.status === 200 && answers.data.answers[qid] === 'Мой ответ.' && answers.data.ready[qid] === true);
  const card = await a.call('POST', '/api/preps/' + prepId + '/card');
  ok('Карточка подготовки собрана', card.status === 200 && Array.isArray(card.data.card.askThem));

  /* ---- Интервью: обычный ответ и поток ---- */
  const interview = await a.call('POST', '/api/preps/' + prepId + '/interviews');
  ok('Интервью начато с реплики интервьюера', interview.status === 201 && interview.data.turn.role === 'interviewer'
    && interview.data.turn.text.length > 10);
  const iid = interview.data.interviewId;
  const turn = await a.call('POST', '/api/interviews/' + iid + '/turns', { text: 'Отвечал за горячий цех.' });
  ok('Реплика кандидата принята, интервьюер ответил', turn.status === 200 && turn.data.turns === 3);

  const streamRes = await fetch(base + '/api/interviews/' + iid + '/turns', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', cookie: a.cookie, origin: base },
    body: JSON.stringify({ text: 'Второй ответ.' }) });
  const streamText = await streamRes.text();
  ok('Потоковый ответ отдаётся как события', streamRes.headers.get('content-type').indexOf('text/event-stream') >= 0
    && streamText.indexOf('event: done') >= 0);

  const finished = await a.call('POST', '/api/interviews/' + iid + '/finish');
  ok('Интервью завершено с итогом', finished.status === 200 && finished.data.finished === true && Array.isArray(finished.data.summary.repeat));
  const afterFinish = await a.call('POST', '/api/interviews/' + iid + '/turns', { text: 'Ещё' });
  ok('После завершения реплики не принимаются', afterFinish.status === 409);

  /* ---- Устаревание и пересборка ---- */
  await a.call('PUT', '/api/resumes/' + resume.data.id, { data: Object.assign({}, RESUME, { summary: 'Правка.' }) });
  const staleView = await a.call('GET', '/api/preps/' + prepId);
  ok('После правки резюме подготовка помечена устаревшей', staleView.data.stale === true, staleView.data.staleReason);
  const rebuilt = await a.call('POST', '/api/preps/' + prepId + '/rebuild');
  ok('Пересборка снимает отметку и обновляет версии', rebuilt.status === 200 && rebuilt.data.stale === false
    && rebuilt.data.resumeRev === 2);

  /* ---- Лимит ---- */
  const second = await a.call('POST', '/api/preps', { resumeId: resume.data.id, vacancyId: vacancy.data.id });
  ok('Вторая подготовка в пределах лимита', second.status === 201);
  const third = await a.call('POST', '/api/preps', { resumeId: resume.data.id, vacancyId: vacancy.data.id });
  ok('Третья — за лимитом, 429 с объяснением', third.status === 429 && /лимит/i.test(third.data.error));

  /* ---- Изоляция сессий ---- */
  const b = client(base);
  await b.call('GET', '/api/health');
  ok('У второго клиента своя сессия', b.cookie && b.cookie !== a.cookie);
  const stolen = await b.call('GET', '/api/preps/' + prepId);
  ok('Чужая подготовка не видна по идентификатору', stolen.status === 404);
  const forgedCookie = a.cookie.replace(/\.[^.]+$/, '.forged');
  const forged = await fetch(base + '/api/me', { headers: { cookie: forgedCookie } });
  const forgedMe = await forged.json();
  ok('Подделанная подпись cookie не даёт доступ к сессии', forgedMe.session.id !== me.data.session.id);

  /* ---- Учёт расходов и статика ---- */
  const usage = await a.call('GET', '/api/me');
  ok('Запросы к модели учтены', usage.data.usage.requests >= 8, usage.data.usage.requests + ' запросов');
  const page = await fetch(base + '/');
  ok('Корень отдаёт собранный index.html', page.status === 200 && (await page.text()).indexOf('<title>') >= 0);
  const missing = await fetch(base + '/api/nope');
  ok('Неизвестный маршрут API даёт 404', missing.status === 404);

  server.close();
  const failed = results.filter(function (r) { return !r.pass; });
  console.log('\nИтого: ' + (results.length - failed.length) + ' из ' + results.length + ' проверок пройдено.');
  process.exit(failed.length ? 1 : 0);
})().catch(function (e) { console.error('ОШИБКА ТЕСТА:', e.stack || e.message); process.exit(2); });
