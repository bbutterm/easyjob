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
  const { server } = createApp({ dbFile: ':memory:', freePrepsPerDay: 2, secure: false,
    adminToken: 'admin-test-token', retention: false, rateLimit: { perMinute: 1000, expensivePerMinute: 1000 } });
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

  /* ---- Сводка владельца ---- */
  const noToken = await fetch(base + '/api/admin/usage');
  ok('Сводка без токена недоступна', noToken.status === 401);
  const wrongToken = await fetch(base + '/api/admin/usage', { headers: { authorization: 'Bearer wrong' } });
  ok('Неверный токен отклоняется', wrongToken.status === 401);
  const summary = await (await fetch(base + '/api/admin/usage?days=7', {
    headers: { authorization: 'Bearer admin-test-token' } })).json();
  ok('Сводка отдаёт счётчики по задачам', Array.isArray(summary.byTask) && summary.byTask.length > 0);
  ok('В сводке нет содержимого резюме', JSON.stringify(summary).indexOf('горячего цеха') < 0);

  /* ---- Автоудаление по сроку хранения ---- */
  const db = require('../server/lib/db.js');
  const before = db.sessions.removeInactiveSince(Date.now() - 3600 * 1000);
  ok('Свежие сессии не удаляются', before.sessions === 0);
  const after = db.sessions.removeInactiveSince(Date.now() + 1000);
  ok('Неактивные сессии удаляются вместе с резюме и подготовками',
    after.sessions >= 2 && after.resumes >= 1 && after.preps >= 1, JSON.stringify(after));
  const gone = await a.call('GET', '/api/resumes/' + resume.data.id);
  ok('После удаления данных сессии резюме недоступно', gone.status === 404);

  server.close();

  /* ---- Ограничение частоты: отдельный сервер с низким порогом ---- */
  const strict = createApp({ dbFile: ':memory:', freePrepsPerDay: 100, secure: false, retention: false,
    rateLimit: { perMinute: 5, expensivePerMinute: 2 } });
  await new Promise(function (r) { strict.server.listen(0, '127.0.0.1', r); });
  const sbase = 'http://127.0.0.1:' + strict.server.address().port;
  const c = client(sbase);
  let last = null;
  for (let i = 0; i < 6; i++) last = await c.call('GET', '/api/health');
  ok('Шестой запрос в минуту с одного адреса получает 429', last.status === 429 && !!last.res.headers.get('retry-after'));
  strict.server.close();

  const strict2 = createApp({ dbFile: ':memory:', freePrepsPerDay: 100, secure: false, retention: false,
    rateLimit: { perMinute: 1000, expensivePerMinute: 2 } });
  await new Promise(function (r) { strict2.server.listen(0, '127.0.0.1', r); });
  const s2base = 'http://127.0.0.1:' + strict2.server.address().port;
  const d = client(s2base);
  await d.call('GET', '/api/health');
  const r1 = await d.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  const r2 = await d.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  const r3 = await d.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  ok('Третий запрос к модели в минуту с одной сессии получает 429',
    r1.status === 201 && r2.status === 201 && r3.status === 429 && /модели/.test(r3.data.error),
    [r1.status, r2.status, r3.status].join('/') + ' ' + (r3.data && r3.data.error));
  strict2.server.close();

  /* ---- Обмен ключа GigaChat на токен ---- */
  const GigaChatAuth = require('../server/lib/gigachat-auth.js');
  GigaChatAuth.reset();
  let exchanges = 0;
  const fakeOauth = function (url, opts) {
    exchanges += 1;
    const okAuth = opts.headers.authorization === 'Basic ключ' && /rquid/i.test(Object.keys(opts.headers).join(','));
    return Promise.resolve({ ok: okAuth, status: okAuth ? 200 : 401,
      json: () => Promise.resolve(okAuth ? { access_token: 'tok-' + exchanges, expires_at: Date.now() + 10 * 60 * 1000 }
        : { message: 'нет' }) });
  };
  const t1 = await GigaChatAuth.getToken('ключ', 'GIGACHAT_API_PERS', fakeOauth);
  const t2 = await GigaChatAuth.getToken('ключ', 'GIGACHAT_API_PERS', fakeOauth);
  ok('Токен GigaChat получен обменом ключа', t1 === 'tok-1');
  ok('Повторный вызов берёт токен из кэша', t2 === 'tok-1' && exchanges === 1);
  GigaChatAuth.reset();
  const [p1, p2] = await Promise.all([GigaChatAuth.getToken('ключ', '', fakeOauth), GigaChatAuth.getToken('ключ', '', fakeOauth)]);
  ok('Параллельные запросы делают один обмен', p1 === p2 && exchanges === 2);
  GigaChatAuth.reset();
  let authErr = null;
  try { await GigaChatAuth.getToken('плохой', '', fakeOauth); } catch (e) { authErr = e.message; }
  ok('Ошибка обмена объясняется', /токен GigaChat/.test(authErr || ''), authErr);

  const failed = results.filter(function (r) { return !r.pass; });
  console.log('\nИтого: ' + (results.length - failed.length) + ' из ' + results.length + ' проверок пройдено.');
  process.exit(failed.length ? 1 : 0);
})().catch(function (e) { console.error('ОШИБКА ТЕСТА:', e.stack || e.message); process.exit(2); });
