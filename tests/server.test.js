/* Сквозная проверка API на провайдере-заглушке.
   Запуск: node tests/server.test.js
   Сервер поднимается в памяти, сеть наружу не используется. */

'use strict';

const { createApp } = require('../server/index.js');
const aiMod = require('../server/lib/ai.js');

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

  /* ---- Регрессии по проверке безопасности ---- */
  const net = require('node:net');
  const sec = createApp({ dbFile: ':memory:', freePrepsPerDay: 1, secure: true, retention: false,
    rateLimit: { perMinute: 1000, expensivePerMinute: 1, sessionsPerHour: 3 } });
  await new Promise(function (r) { sec.server.listen(0, '127.0.0.1', r); });
  const secPort = sec.server.address().port;
  const secBase = 'http://127.0.0.1:' + secPort;

  /* C1: сырой запрос с /../ в пути — fetch такое нормализует сам, поэтому через сокет. */
  function rawRequest(pathRaw, headers, body) {
    return new Promise(function (resolve, reject) {
      const sock = net.connect(secPort, '127.0.0.1', function () {
        const payload = body || '';
        const head = ['POST ' + pathRaw + ' HTTP/1.1', 'Host: 127.0.0.1:' + secPort, 'Origin: ' + secBase,
          'Content-Type: application/json', 'Content-Length: ' + Buffer.byteLength(payload)]
          .concat(headers || []).join('\r\n');
        sock.write(head + '\r\n\r\n' + payload);
      });
      let data = '';
      sock.on('data', function (chunk) { data += chunk.toString(); });
      sock.on('end', function () { resolve(Number((/HTTP\/1\.1 (\d+)/.exec(data) || [])[1])); });
      sock.on('error', reject);
      sock.setTimeout(3000, function () { sock.destroy(); resolve(Number((/HTTP\/1\.1 (\d+)/.exec(data) || [])[1])); });
    });
  }
  const vacBody = JSON.stringify({ title: 'Повар', rawText: VACANCY_TEXT });
  const sc = client(secBase);
  await sc.call('GET', '/api/health');
  const cookieLine = 'Cookie: ' + sc.cookie;
  const first = await rawRequest('/api/vacancies', [cookieLine, 'Connection: close'], vacBody);
  const traversal = await rawRequest('/api/x/../vacancies', [cookieLine, 'Connection: close'], vacBody);
  ok('C1: обход лимита через /../ в пути закрыт', first === 201 && traversal === 429, first + '/' + traversal);

  /* C3: за прокси берётся адрес от nginx, а не левый элемент X-Forwarded-For. */
  const spoofA = await rawRequest('/api/vacancies', [cookieLine, 'Connection: close',
    'X-Forwarded-For: 1.1.1.1, 10.0.0.1'], vacBody);
  const spoofB = await rawRequest('/api/vacancies', [cookieLine, 'Connection: close',
    'X-Forwarded-For: 2.2.2.2, 10.0.0.1'], vacBody);
  ok('C3: подделка левого X-Forwarded-For не даёт новый лимит', spoofA === 429 && spoofB === 429);

  /* C2: сброс cookie не обнуляет дневной лимит подготовок — считается и по адресу. */
  const s1 = client(secBase);
  const res1 = await s1.call('POST', '/api/resumes', { title: 'Р', data: RESUME });
  const vac1 = await s1.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  ok('C2: первая подготовка с адреса проходит', res1.status === 201 && vac1.status === 201);
  sec.cfg.rateLimit.expensivePerMinute = 1000;
  const secLoose = createApp({ dbFile: ':memory:', freePrepsPerDay: 1, secure: false, retention: false,
    rateLimit: { perMinute: 1000, expensivePerMinute: 1000, sessionsPerHour: 3 } });
  await new Promise(function (r) { secLoose.server.listen(0, '127.0.0.1', r); });
  const lb = 'http://127.0.0.1:' + secLoose.server.address().port;
  const u1 = client(lb);
  const ur = await u1.call('POST', '/api/resumes', { title: 'Р', data: RESUME });
  const uv = await u1.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  const up1 = await u1.call('POST', '/api/preps', { resumeId: ur.data.id, vacancyId: uv.data.id });
  const u2 = client(lb);
  const ur2 = await u2.call('POST', '/api/resumes', { title: 'Р', data: RESUME });
  const uv2 = await u2.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  const up2 = await u2.call('POST', '/api/preps', { resumeId: ur2.data.id, vacancyId: uv2.data.id });
  ok('C2: новая сессия с того же адреса не обходит дневной лимит',
    up1.status === 201 && up2.status === 429, up1.status + '/' + up2.status);
  const u3 = client(lb); await u3.call('GET', '/api/health');
  const u4 = client(lb);
  const tooMany = await u4.call('GET', '/api/health');
  ok('C2: поток новых сессий с одного адреса ограничен', tooMany.status === 429, String(tooMany.status));

  /* I1: идентификаторы ответов проверяются. */
  /* Литерал { '__proto__': 'x' } задаёт прототип, а не свойство, поэтому
     тело собирается из строки: так ключ действительно уходит на сервер. */
  const badKey = await u1.call('PUT', '/api/preps/' + up1.data.id + '/answers',
    JSON.parse('{"answers":{"__proto__":"x"}}'));
  const badKey2 = await u1.call('PUT', '/api/preps/' + up1.data.id + '/answers', { answers: { 'a.b': 'x' } });
  ok('I1: недопустимый идентификатор вопроса отклоняется', badKey.status === 400 && badKey2.status === 400,
    badKey.status + ' ' + JSON.stringify(badKey.data).slice(0, 80) + ' / ' + badKey2.status);

  /* I2: пользователь может удалить все свои данные немедленно. */
  const u1me = await u1.call('GET', '/api/me');
  const wipe = await u1.call('DELETE', '/api/me');
  ok('I2: удаление своих данных работает и сбрасывает cookie',
    wipe.status === 200 && wipe.data.resumes >= 1 && /Max-Age=0/.test(wipe.res.headers.get('set-cookie') || ''));
  const dbNow = require('../server/lib/db.js');
  ok('I2: после удаления данных в базе нет',
    dbNow.resumes.get(u1me.data.session.id, ur.data.id) === null && dbNow.sessions.get(u1me.data.session.id) === null);

  /* I3: заголовки безопасности на странице; страница не создаёт сессию. */
  const html = await fetch(lb + '/');
  ok('Страница отдаётся без создания сессии', !html.headers.get('set-cookie'));
  ok('I3: страница отдаётся с CSP и запретом встраивания',
    /frame-ancestors 'none'/.test(html.headers.get('content-security-policy') || '')
    && html.headers.get('x-frame-options') === 'DENY');

  sec.server.close(); secLoose.server.close();

  /* ---- Часть A: учёт по попыткам, политика провайдеров ---- */
  const polApp = createApp({ dbFile: ':memory:', freePrepsPerDay: 100, secure: false, retention: false,
    rateLimit: { perMinute: 1000, expensivePerMinute: 1000, sessionsPerHour: 1000 } });
  await new Promise(function (r) { polApp.server.listen(0, '127.0.0.1', r); });
  const pbase = 'http://127.0.0.1:' + polApp.server.address().port;
  const pc = client(pbase);
  const pv = await pc.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  const dbP = require('../server/lib/db.js');
  const pme = await pc.call('GET', '/api/me');
  const allUsage = dbP.usage.summary(1).byTask;
  ok('Расход заглушки помечен как «не применимо», а не ноль-по-умолчанию',
    pv.status === 201 && allUsage.length > 0 && allUsage.every(function (r) { return r.usageUnknown === 0; }));
  const usageRow = dbP.usage.summary(1);
  ok('В сводке есть фаза и число попыток', usageRow.byPhase.some(function (p) { return p.phase === 'main'; }) && usageRow.byTask[0].attempts >= 1);

  /* Закрытый провайдер отклоняется политикой. */
  const prevProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'anthropic';
  const hClosed = await pc.call('GET', '/api/health');
  ok('Здоровье сообщает, что провайдер не допущен политикой', hClosed.data.ai.known === true && hClosed.data.ai.policyOk === false);
  const closedCall = await pc.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  ok('Запрос к закрытому провайдеру отклоняется контролируемо, без вызова', closedCall.status === 502 && /политик/.test(closedCall.data.error));
  process.env.AI_PROVIDER = 'typo-provider';
  const hTypo = await pc.call('GET', '/api/health');
  ok('Неизвестный провайдер виден в здоровье как неизвестный', hTypo.data.ai.known === false && hTypo.data.ai.live === false);
  const typoCall = await pc.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  ok('Неизвестный провайдер не превращается в успешную заглушку', typoCall.status === 502 && /неизвестный провайдер/i.test(typoCall.data.error));
  process.env.AI_PROVIDER = prevProvider;
  polApp.server.close();

  /* ---- Часть C: seq, идемпотентность, CAS, память, владение, удаление ---- */
  const cApp = createApp({ dbFile: ':memory:', freePrepsPerDay: 100, secure: false, retention: false,
    rateLimit: { perMinute: 10000, expensivePerMinute: 10000, sessionsPerHour: 1000 } });
  await new Promise(function (r) { cApp.server.listen(0, '127.0.0.1', r); });
  const cbase = 'http://127.0.0.1:' + cApp.server.address().port;
  const cc = client(cbase);
  const cr = await cc.call('POST', '/api/resumes', { title: 'Р', data: RESUME });
  const cv = await cc.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  const cp = await cc.call('POST', '/api/preps', { resumeId: cr.data.id, vacancyId: cv.data.id });
  const ci = await cc.call('POST', '/api/preps/' + cp.data.id + '/interviews');
  const ciid = ci.data.interviewId;
  ok('C: реплика интервьюера получает устойчивый seq', ci.data.turn.seq === 1);

  const dbC = require('../server/lib/db.js');
  const cme = await cc.call('GET', '/api/me');
  const sidC = cme.data && cme.data.session ? cme.data.session.id : '';
  const ct1 = await cc.call('POST', '/api/interviews/' + ciid + '/turns', { text: 'Ответ один', clientTurnId: 'c1' });
  const ct1again = await cc.call('POST', '/api/interviews/' + ciid + '/turns', { text: 'Ответ один', clientTurnId: 'c1' });
  const afterDup = dbC.interviews.get(sidC, ciid);
  ok('C: повтор с тем же clientTurnId не создаёт дубля и отдаёт прежний ответ',
    ct1.status === 200 && ct1again.status === 200 && ct1again.data.duplicate === true
    && afterDup && afterDup.turns.filter(function (t) { return t.clientTurnId === 'c1'; }).length === 1,
    afterDup ? afterDup.turns.length + ' реплик' : 'нет доступа к интервью (' + sidC + ')');
  const badCid = await cc.call('POST', '/api/interviews/' + ciid + '/turns', { text: 'x', clientTurnId: 'a.b' });
  ok('C: недопустимый clientTurnId отклоняется', badCid.status === 400);

  /* Две вкладки одновременно: обе реплики должны сохраниться. */
  const [pa, pb] = await Promise.all([
    cc.call('POST', '/api/interviews/' + ciid + '/turns', { text: 'Вкладка А', clientTurnId: 'ta' }),
    cc.call('POST', '/api/interviews/' + ciid + '/turns', { text: 'Вкладка Б', clientTurnId: 'tb' })
  ]);
  const afterPar = dbC.interviews.get(sidC, ciid);
  ok('C: параллельные реплики не теряются (CAS)', pa.status === 200 && pb.status === 200
    && afterPar.turns.some(function (t) { return t.text === 'Вкладка А'; }) && afterPar.turns.some(function (t) { return t.text === 'Вкладка Б'; }));
  ok('C: seq строго возрастает без пропусков',
    afterPar.turns.every(function (t, i) { return t.seq === i + 1; }));

  /* Память: публикация с CAS. */
  const CM = require('../server/lib/context-memory.js');
  const mem0 = await cc.call('GET', '/api/interviews/' + ciid + '/memory');
  ok('C: памяти пока нет — версия 0', mem0.status === 200 && mem0.data.memoryVersion === 0 && mem0.data.status === 'none');
  const v = CM.validate({ facts: [{ factId: 'f1', value: 'Опыт на горячем цехе', status: 'user_said', sourceRef: { kind: 'turn', seq: 2 }, quote: 'Ответ один' }],
    askedTopics: ['опыт'] }, afterPar.turns);
  ok('C: проверка ссылок принимает верную память', v.ok && v.memory.facts.length === 1, v.errors.join('; '));
  const pub1 = CM.publish(sidC, ciid, 0, v.memory, { resumeRev: 1, vacancyRev: 1 }, 2);
  const pub1b = CM.publish(sidC, ciid, 0, v.memory, { resumeRev: 1, vacancyRev: 1 }, 2);
  ok('C: первая публикация создаёт память, повтор с той же версией — конфликт', pub1.ok && pub1.memoryVersion === 1 && pub1b.ok === false && pub1b.conflict);
  const pub2 = CM.publish(sidC, ciid, 1, v.memory, { resumeRev: 1, vacancyRev: 1 }, 3);
  const pub2stale = CM.publish(sidC, ciid, 1, v.memory, { resumeRev: 1, vacancyRev: 1 }, 3);
  ok('C: CAS пропускает только ожидаемую версию', pub2.ok && pub2.memoryVersion === 2 && !pub2stale.ok);
  const mem1 = await cc.call('GET', '/api/interviews/' + ciid + '/memory');
  ok('C: память читается владельцем с версией и покрытием', mem1.data.memoryVersion === 2 && mem1.data.coveredThroughSeq === 3
    && mem1.data.memory.facts[0].sourceRef.seq === 2);

  /* Владение: чужая сессия не видит ни интервью, ни память. */
  const stranger = client(cbase);
  await stranger.call('GET', '/api/health');
  const foreignMem = await stranger.call('GET', '/api/interviews/' + ciid + '/memory');
  ok('C: память не пересекает владельцев', foreignMem.status === 404 && CM.read('s_чужой', ciid) === null);

  /* Устаревание: правка резюме помечает память, не удаляя её. */
  await cc.call('PUT', '/api/resumes/' + cr.data.id, { data: Object.assign({}, RESUME, { summary: 'Правка.' }) });
  const memStale = await cc.call('GET', '/api/interviews/' + ciid + '/memory');
  ok('C: после правки резюме память помечена устаревшей, но сохранена', memStale.data.status === 'stale' && memStale.data.memory.facts.length === 1);

  /* Удаление: DELETE /api/me убирает память вместе со всем. */
  await cc.call('DELETE', '/api/me');
  ok('C: удаление данных пользователя удаляет и память', CM.read(sidC, ciid) === null && dbC.interviews.get(sidC, ciid) === null);
  cApp.server.close();

  /* ---- Часть D: снимок подготовки, подтверждения, память в окне ---- */
  const prevMem = process.env.CONTEXT_MEMORY;
  process.env.CONTEXT_MEMORY = '1';
  const dApp = createApp({ dbFile: ':memory:', freePrepsPerDay: 100, secure: false, retention: false,
    rateLimit: { perMinute: 10000, expensivePerMinute: 10000, sessionsPerHour: 1000 } });
  await new Promise(function (r) { dApp.server.listen(0, '127.0.0.1', r); });
  const dbase = 'http://127.0.0.1:' + dApp.server.address().port;
  const dc = client(dbase);
  const dme = await dc.call('GET', '/api/me');
  const sidD = dme.data.session.id;
  const dr = await dc.call('POST', '/api/resumes', { title: 'Р', data: Object.assign({}, RESUME,
    { experience: [{ role: 'Повар', company: 'Пушкин', period: '2019—2023', details: 'Горячий цех, авторские соусы, заготовки.' }] }) });
  const dv = await dc.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  const dp = await dc.call('POST', '/api/preps', { resumeId: dr.data.id, vacancyId: dv.data.id });
  const di = await dc.call('POST', '/api/preps/' + dp.data.id + '/interviews');
  const diid = di.data.interviewId;
  const dbD = require('../server/lib/db.js');
  const prepD = dbD.preps.get(sidD, dp.data.id);
  const hD = await dc.call('GET', '/api/health');
  ok('F: здоровье сервера сообщает флаги контекста без секретов', hD.data.context && hD.data.context.memory === true
    && hD.data.context.policy === 'policy' && hD.data.context.evidence === true && JSON.stringify(hD.data).indexOf('KEY') < 0);
  ok('D: первая реплика закрепляет снимок подготовки на версиях исходников',
    di.data.context && di.data.context.snapshotPinned === true && prepD.snapshot && prepD.snapshot.resumeRev === 1
    && prepD.snapshot.profile.experience[0].company === 'Пушкин', JSON.stringify(di.data.context));
  ok('D: индекс подтверждений содержит разделы резюме и реплику', dbD.evidence.available()
    && dbD.evidence.count(sidD, 'resume', dr.data.id) >= 3 && dbD.evidence.count(sidD, 'turn', diid) === 1);

  const dt1 = await dc.call('POST', '/api/interviews/' + diid + '/turns', { text: 'Я работал в горячем цехе и делал авторские соусы.' });
  ok('D: подтверждения подбираются по текущему ответу из резюме и сопоставления',
    dt1.status === 200 && dt1.data.context.evidenceVia === 'fts'
    && dt1.data.context.evidence.indexOf('resume.experience[0]') >= 0
    && dt1.data.context.evidence.some(function (e) { return /^match:/.test(e); }), JSON.stringify(dt1.data.context));

  /* Ранний ответ уходит за окно, но находится как подтверждение. */
  for (let i = 0; i < 5; i++) await dc.call('POST', '/api/interviews/' + diid + '/turns', { text: 'Ответ без деталей номер ' + i + '.' });
  const dt2 = await dc.call('POST', '/api/interviews/' + diid + '/turns', { text: 'Про соусы я уже говорил раньше.' });
  ok('D: реплика вне окна находится как подтверждение, реплики из окна не дублируются',
    dt2.data.context.evidence.indexOf('turn:2') >= 0
    && dt2.data.context.evidence.every(function (e) { return !/^turn:/.test(e) || Number(e.slice(5)) < dt2.data.turn.seq - 6; }),
    JSON.stringify(dt2.data.context));
  ok('D: до порога сжатия окно начинается с первой реплики (свёртка как раньше)',
    dt1.data.context.windowFrom === 1 && dt1.data.context.memoryStatus === 'none');

  /* Память покрывает первые реплики — они уходят из окна, свёртки по ним нет. */
  const intD = dbD.interviews.get(sidD, diid);
  const CMD = require('../server/lib/context-memory.js');
  const vD = CMD.validate({ facts: [{ factId: 'f1', value: 'Делал авторские соусы', status: 'user_said',
    sourceRef: { kind: 'turn', seq: 2 }, quote: 'авторские соусы' }], askedTopics: ['соусы'] }, intD.turns);
  const covered = intD.turns.length - 4;
  const rowD = CMD.read(sidD, diid);
  const pubD = CMD.publish(sidD, diid, rowD ? rowD.memoryVersion : 0, vD.memory, { resumeRev: 1, vacancyRev: 1 }, covered);
  const dt3 = await dc.call('POST', '/api/interviews/' + diid + '/turns', { text: 'Продолжаем.' });
  const expectedFrom = Math.min(covered + 1, intD.turns.length + 1 - 6 + 1);
  ok('D: действительная память вытесняет покрытые реплики из окна',
    pubD.ok && dt3.data.context.memoryVersion === pubD.memoryVersion && dt3.data.context.memoryStatus === 'valid'
    && dt3.data.context.windowFrom === expectedFrom, 'windowFrom=' + dt3.data.context.windowFrom + ' ожидалось ' + expectedFrom);

  /* Правка резюме: интервью остаётся на снимке, память помечена устаревшей и в запрос не идёт. */
  await dc.call('PUT', '/api/resumes/' + dr.data.id, { data: Object.assign({}, RESUME, { summary: 'Теперь кондитер.' }) });
  const dt4 = await dc.call('POST', '/api/interviews/' + diid + '/turns', { text: 'Ещё ответ.' });
  const prepD2 = dbD.preps.get(sidD, dp.data.id);
  ok('D: после правки резюме интервью идёт на закреплённом снимке и сообщает об изменении исходников',
    dt4.data.context.sourcesChanged === true && dt4.data.context.snapshotPinned === true
    && prepD2.snapshot.resumeRev === 1 && prepD2.snapshot.profile.summary !== 'Теперь кондитер.');
  ok('D: устаревшая память не подставляется в запрос, окно возвращается к свёртке',
    dt4.data.context.memoryStatus === 'stale' && dt4.data.context.windowFrom === 1);
  ok('D: индекс резюме обновлён под новую версию', dbD.evidence.search(sidD, 'resume', dr.data.id, '"кондитер"', 3).length === 1
    && dbD.evidence.search(sidD, 'resume', dr.data.id, '"пушкин"', 3).length === 0);

  /* Итог: подтверждения по всем ответам, а не только по окну. */
  const dfin = await dc.call('POST', '/api/interviews/' + diid + '/finish');
  ok('D: итог интервью собирает подтверждения из реплик', dfin.status === 200 && dfin.data.context
    && dfin.data.context.evidenceVia === 'fts', JSON.stringify(dfin.data.context));

  /* Чужая сессия ничего не находит в индексе. */
  ok('D: индекс подтверждений не пересекает владельцев', dbD.evidence.search('s_чужой', 'resume', dr.data.id, '"горяч"', 3).length === 0);

  /* Флаг выключен — прежнее поведение. */
  process.env.CONTEXT_MEMORY = '0';
  const di2 = await dc.call('POST', '/api/preps/' + dp.data.id + '/interviews');
  ok('D: без флага подтверждения и память не используются, снимок — используется',
    di2.data.context.evidenceVia === 'off' && di2.data.context.memoryStatus === 'none' && di2.data.context.snapshotPinned === true);
  process.env.CONTEXT_MEMORY = '1';

  /* Удаление подготовки чистит индекс реплик; удаление данных — всё. */
  await dc.call('DELETE', '/api/preps/' + dp.data.id);
  ok('D: удаление подготовки удаляет реплики из индекса', dbD.evidence.count(sidD, 'turn', diid) === 0
    && dbD.evidence.count(sidD, 'turn', di2.data.interviewId) === 0);
  await dc.call('DELETE', '/api/me');
  ok('D: удаление данных пользователя очищает индекс', dbD.evidence.count(sidD, 'resume', dr.data.id) === 0);
  process.env.CONTEXT_MEMORY = prevMem === undefined ? '' : prevMem;
  if (prevMem === undefined) delete process.env.CONTEXT_MEMORY;
  dApp.server.close();

  /* ---- Часть E: сжатие в память через общий pipeline ---- */
  process.env.CONTEXT_MEMORY = '1';
  const eApp = createApp({ dbFile: ':memory:', freePrepsPerDay: 100, secure: false, retention: false,
    rateLimit: { perMinute: 10000, expensivePerMinute: 10000, sessionsPerHour: 1000 } });
  await new Promise(function (r) { eApp.server.listen(0, '127.0.0.1', r); });
  const ebase = 'http://127.0.0.1:' + eApp.server.address().port;
  const ec = client(ebase);
  const sidE = (await ec.call('GET', '/api/me')).data.session.id;
  const er = await ec.call('POST', '/api/resumes', { title: 'Р', data: RESUME });
  const ev = await ec.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  const ep = await ec.call('POST', '/api/preps', { resumeId: er.data.id, vacancyId: ev.data.id });
  const ei = await ec.call('POST', '/api/preps/' + ep.data.id + '/interviews');
  const eiid = ei.data.interviewId;
  const dbE = require('../server/lib/db.js');
  const CME = require('../server/lib/context-memory.js');
  const Compact = require('../server/lib/context-compact.js');
  const answersE = ['Я пять лет работал в горячем цехе ресторана.', 'Медицинской книжки у меня сейчас нет.',
    'Авторское меню разрабатывал дважды в год.', 'Точнее, не пять лет, а четыре года.', 'Работал по технологическим картам.'];
  const replies = [];
  for (let i = 0; i < answersE.length; i++) replies.push(await ec.call('POST', '/api/interviews/' + eiid + '/turns', { text: answersE[i] }));
  const compacted = replies.map(function (r) { return r.data.context.compaction; }).filter(function (c) { return c && c.ran; });
  ok('E: сжатие запускается само после накопления новых реплик и проходит через заглушку',
    compacted.length === 1 && compacted[0].ok === true && compacted[0].memoryVersion === 1 && compacted[0].mock === true
    && compacted[0].newFacts >= 3 && compacted[0].warnings.length === 0 && /новых реплик/.test(compacted[0].trigger),
    JSON.stringify(compacted));
  const beforeE = replies.slice(0, replies.indexOf(replies.find(function (r) { return r.data.context.compaction.ran; })));
  ok('E: до порога сжатие не запускается и говорит почему', beforeE.length >= 2
    && beforeE.every(function (r) { return r.data.context.compaction.ran === false && !!r.data.context.compaction.reason; }));
  const usageE = dbE.usage.byRequest(sidE, compacted[0].requestId);
  ok('E: расход сжатия учтён отдельной фазой compact', usageE.length === 1 && usageE[0].phase === 'compact'
    && usageE[0].task === 'context.compact' && usageE[0].usage_status === 'not_applicable');
  const memE = await ec.call('GET', '/api/interviews/' + eiid + '/memory');
  const factsE = memE.data.memory.facts;
  const turnsE = dbE.interviews.get(sidE, eiid).turns;
  ok('E: факты памяти ссылаются на реплики с дословной цитатой из них',
    memE.data.status === 'valid' && factsE.length >= 3 && factsE.every(function (f) {
      const t = turnsE.find(function (x) { return x.seq === f.sourceRef.seq; });
      return f.status === 'user_said' && t && t.text.indexOf(f.sourceRef.quote) >= 0;
    }) && memE.data.coveredThroughSeq === compacted[0].coveredThroughSeq);
  const afterCompaction = replies.filter(function (r) { return r.data.context.memoryStatus === 'valid'; });
  ok('E: следующая реплика идёт уже на свежей памяти',
    afterCompaction.length >= 1 && afterCompaction[0].data.context.memoryVersion === 1);

  /* Второй проход берёт только новый диапазон и сливает факты с прежними. */
  await ec.call('POST', '/api/interviews/' + eiid + '/turns', { text: 'Ещё уточню: ресторан назывался «Север».' });
  const cmp2 = await ec.call('POST', '/api/interviews/' + eiid + '/compact');
  const memE2 = await ec.call('GET', '/api/interviews/' + eiid + '/memory');
  ok('E: повторное сжатие берёт только непокрытый диапазон и наращивает память',
    cmp2.data.ran && cmp2.data.ok && cmp2.data.from === compacted[0].coveredThroughSeq + 1 && cmp2.data.memoryVersion === 2
    && memE2.data.memory.facts.length > factsE.length && memE2.data.coveredThroughSeq > memE.data.coveredThroughSeq,
    JSON.stringify(cmp2.data));
  const cmp3 = await ec.call('POST', '/api/interviews/' + eiid + '/compact');
  ok('E: без новых реплик сжатие не запускается', cmp3.data.ran === false && /нет новых/.test(cmp3.data.reason));

  /* Сбой модели и неразборчивый JSON не портят память. */
  const mockAdapter = require('../shared/ai/providers/mock.js');
  const realRun = mockAdapter.run;
  mockAdapter.run = function (request) {
    if (request.task === 'context.compact') return { ok: true, text: 'это не JSON {', stopReason: 'end_turn', usage: null, mock: true };
    return realRun(request);
  };
  await ec.call('POST', '/api/interviews/' + eiid + '/turns', { text: 'Реплика при сломанной модели.' });
  const cmpBad = await ec.call('POST', '/api/interviews/' + eiid + '/compact');
  mockAdapter.run = realRun;
  const memE3 = await ec.call('GET', '/api/interviews/' + eiid + '/memory');
  ok('E: неразборчивый ответ модели оставляет прежнюю память нетронутой',
    cmpBad.data.ran && cmpBad.data.ok === false && /неполный|разобрать/.test(cmpBad.data.error)
    && memE3.data.memoryVersion === 2 && memE3.data.memory.facts.length === memE2.data.memory.facts.length, JSON.stringify(cmpBad.data));
  /* Ссылки на чужие реплики и цитаты не из реплики отбрасываются, остальное публикуется. */
  mockAdapter.run = function (request) {
    if (request.task === 'context.compact') {
      return { ok: true, mock: true, stopReason: 'end_turn', usage: null, text: JSON.stringify({ facts: [
        { factId: 'bad1', value: 'x', status: 'user_said', sourceRef: { kind: 'turn', seq: 999 } },
        { factId: 'bad2', value: 'y', status: 'confirmed', sourceRef: { kind: 'turn', seq: 2 }, quote: 'этого в реплике нет' },
        { factId: 'good', value: 'Ресторан «Север»', status: 'user_said', sourceRef: { kind: 'turn', seq: 2 } },
        { factId: 'fix', value: 'Четыре года, не пять', status: 'user_said', sourceRef: { kind: 'turn', seq: 2 }, supersedes: 'm2' }
      ], askedTopics: [] }) };
    }
    return realRun(request);
  };
  const cmpMixed = await ec.call('POST', '/api/interviews/' + eiid + '/compact');
  mockAdapter.run = realRun;
  const memE4 = await ec.call('GET', '/api/interviews/' + eiid + '/memory');
  const m2 = memE4.data.memory.facts.find(function (f) { return f.factId === 'm2'; });
  ok('E: плохие ссылки отбрасываются с предупреждением, годные факты публикуются, supersedes на прежний факт работает',
    cmpMixed.data.ok && cmpMixed.data.warnings.length === 2 && cmpMixed.data.newFacts === 2
    && memE4.data.memory.facts.some(function (f) { return f.factId === 'good'; }) && m2 && m2.supersededBy === 'fix'
    && !memE4.data.memory.facts.some(function (f) { return f.factId === 'bad1' || f.factId === 'bad2'; }), JSON.stringify(cmpMixed.data.warnings));

  /* Замок: одно сжатие на интервью; брошенный замок перехватывается. */
  ok('E: замок сжатия захватывается один раз', dbE.interviews.tryLockCompaction(sidE, eiid) === true
    && dbE.interviews.tryLockCompaction(sidE, eiid) === false);
  const lockedRun = await ec.call('POST', '/api/interviews/' + eiid + '/compact');
  ok('E: при занятом замке сжатие не запускается', lockedRun.data.ran === false && /уже идёт/.test(lockedRun.data.reason));
  ok('E: брошенный замок старше предела перехватывается', dbE.interviews.tryLockCompaction(sidE, eiid, 0) === true);
  dbE.interviews.unlockCompaction(sidE, eiid);

  /* Реплика, пришедшая после начала сжатия, остаётся непокрытой. */
  const memRow = CME.read(sidE, eiid);
  await ec.call('POST', '/api/interviews/' + eiid + '/turns', { text: 'Поздняя реплика.' });
  const chk = Compact.check(sidE, dbE.interviews.get(sidE, eiid));
  ok('E: реплики после покрытого диапазона считаются новыми', chk.uncovered >= 2 && chk.needed === false
    && CME.read(sidE, eiid).coveredThroughSeq === memRow.coveredThroughSeq);

  /* Поток: перед сжатием клиент получает короткое состояние. */
  let guard = 0;
  while (Compact.check(sidE, dbE.interviews.get(sidE, eiid)).uncovered < 7 && guard++ < 10) {
    await ec.call('POST', '/api/interviews/' + eiid + '/turns', { text: 'Ответ для потока ' + guard + '.' });
  }
  const sse = await fetch(ebase + '/api/interviews/' + eiid + '/turns', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', cookie: ec.cookie, origin: ebase },
    body: JSON.stringify({ text: 'Потоковая реплика.' }) });
  const sseText = await sse.text();
  ok('E: в потоке приходит состояние «обновляю память» и итог со сжатием',
    /event: status\ndata: \{"text":"Обновляю память/.test(sseText) && /event: done/.test(sseText)
    && /"compaction":\{"ran":true,"ok":true/.test(sseText), sseText.slice(0, 200));

  /* Флаг выключен — сжатие не запускается и память не трогается. */
  process.env.CONTEXT_MEMORY = '0';
  const cmpOff = await ec.call('POST', '/api/interviews/' + eiid + '/compact');
  ok('E: без флага сжатие не запускается', cmpOff.data.ran === false && /выключена/.test(cmpOff.data.reason));
  process.env.CONTEXT_MEMORY = prevMem === undefined ? '' : prevMem;
  if (prevMem === undefined) delete process.env.CONTEXT_MEMORY;
  eApp.server.close();

  /* ---- Импорт вакансии по ссылке и правка вакансии ---- */
  const iApp = createApp({ dbFile: ':memory:', freePrepsPerDay: 100, secure: false, retention: false,
    rateLimit: { perMinute: 10000, expensivePerMinute: 10000, sessionsPerHour: 1000 } });
  await new Promise(function (r) { iApp.server.listen(0, '127.0.0.1', r); });
  const ibase = 'http://127.0.0.1:' + iApp.server.address().port;
  const ic = client(ibase);
  await ic.call('GET', '/api/me');
  const imp1 = await ic.call('POST', '/api/vacancies/import-url', { url: 'http://127.0.0.1:' + iApp.server.address().port + '/api/health' });
  ok('Импорт: loopback-адрес отклоняется с кодом private_url', imp1.status === 200 && imp1.data.code === 'private_url' && imp1.data.ok === false, JSON.stringify(imp1.data));
  const imp2 = await ic.call('POST', '/api/vacancies/import-url', { url: 'ftp://example.com/job' });
  ok('Импорт: не http(s) отклоняется', imp2.data.ok === false && imp2.data.code === 'private_url');
  const imp3 = await ic.call('POST', '/api/vacancies/import-url', { url: 'http://169.254.169.254/latest/meta-data' });
  ok('Импорт: адрес метаданных облака отклоняется', imp3.data.ok === false && imp3.data.code === 'private_url');
  const imp4 = await ic.call('POST', '/api/vacancies/import-url', {});
  ok('Импорт: без ссылки — 400', imp4.status === 400);
  /* Сохранение с источником: адрес без токенов, способ и время. */
  const iv = await ic.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT,
    sourceUrl: 'https://jobs.example.com/v/1?token=secret&page=2', source: 'jsonld', retrievedAt: 1700000000000 });
  ok('Вакансия хранит источник без токена', iv.status === 201 && iv.data.sourceUrl === 'https://jobs.example.com/v/1?page=2'
    && iv.data.source === 'jsonld' && iv.data.retrievedAt === 1700000000000, JSON.stringify(iv.data.sourceUrl));
  const ivBad = await ic.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT, sourceUrl: 'http://127.0.0.1/x' });
  ok('Внутренний адрес как источник не принимается', ivBad.status === 400);
  const ivGet = await ic.call('GET', '/api/vacancies/' + iv.data.id);
  ok('Вакансию можно прочитать по id', ivGet.status === 200 && ivGet.data.id === iv.data.id);
  const ivPut = await ic.call('PUT', '/api/vacancies/' + iv.data.id, { rawText: VACANCY_TEXT + '\n— Знание кассы' });
  ok('Правка вакансии повышает версию и извлекает требования заново', ivPut.status === 200 && ivPut.data.rev === 2
    && Array.isArray(ivPut.data.requirements) && ivPut.data.requirements.length > 0 && ivPut.data.sourceUrl === iv.data.sourceUrl);
  const ir = await ic.call('POST', '/api/resumes', { title: 'Р', data: RESUME });
  const ip = await ic.call('POST', '/api/preps', { resumeId: ir.data.id, vacancyId: iv.data.id });
  await ic.call('PUT', '/api/vacancies/' + iv.data.id, { title: 'Су-шеф' });
  const ipView = await ic.call('GET', '/api/preps/' + ip.data.id);
  ok('Подготовка помечена устаревшей после правки вакансии', ipView.data.stale === true && /Вакансия/.test(ipView.data.staleReason));
  const ivDelUsed = await ic.call('DELETE', '/api/vacancies/' + iv.data.id);
  ok('Вакансию из подготовки удалить нельзя — 409', ivDelUsed.status === 409);
  await ic.call('DELETE', '/api/preps/' + ip.data.id);
  const ivDel = await ic.call('DELETE', '/api/vacancies/' + iv.data.id);
  ok('Свободная вакансия удаляется', ivDel.status === 200 && (await ic.call('GET', '/api/vacancies/' + iv.data.id)).status === 404);
  const stranger2 = client(ibase);
  await stranger2.call('GET', '/api/me');
  const iv2 = await ic.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  ok('Чужая вакансия не читается и не правится', (await stranger2.call('GET', '/api/vacancies/' + iv2.data.id)).status === 404
    && (await stranger2.call('PUT', '/api/vacancies/' + iv2.data.id, { title: 'x' })).status === 404);
  iApp.server.close();

  /* ---- Обратная связь на ответ и состояние подготовки ---- */
  const fApp = createApp({ dbFile: ':memory:', freePrepsPerDay: 100, secure: false, retention: false,
    rateLimit: { perMinute: 10000, expensivePerMinute: 10000, sessionsPerHour: 1000 } });
  await new Promise(function (r) { fApp.server.listen(0, '127.0.0.1', r); });
  const fbase = 'http://127.0.0.1:' + fApp.server.address().port;
  const fc = client(fbase);
  await fc.call('GET', '/api/me');
  const fr = await fc.call('POST', '/api/resumes', { title: 'Р', data: RESUME });
  const fv = await fc.call('POST', '/api/vacancies', { title: 'Повар', rawText: VACANCY_TEXT });
  const fp = await fc.call('POST', '/api/preps', { resumeId: fr.data.id, vacancyId: fv.data.id });
  ok('Состояние подготовки после сопоставления — match_ready', fp.data.state === 'match_ready' && fp.data.states.questions_ready === false);
  const noQ = await fc.call('POST', '/api/preps/' + fp.data.id + '/feedback', { questionId: 'q1' });
  ok('Обратная связь без вопросов — 404', noQ.status === 404);
  const fq = await fc.call('POST', '/api/preps/' + fp.data.id + '/questions');
  const qidF = fq.data.questions[0].id;
  const emptyA = await fc.call('POST', '/api/preps/' + fp.data.id + '/feedback', { questionId: qidF });
  ok('Обратная связь без ответа — 400 empty_answer', emptyA.status === 400 && emptyA.data.code === 'empty_answer');
  const answersF = {}; answersF[qidF] = 'Вёл горячий цех на сорок столов, отвечал за заготовки.';
  await fc.call('PUT', '/api/preps/' + fp.data.id + '/answers', { answers: answersF, ready: {} });
  ok('Состояние: answers_started после сохранённого ответа', (await fc.call('GET', '/api/preps/' + fp.data.id)).data.state === 'answers_started');
  const fb1 = await fc.call('POST', '/api/preps/' + fp.data.id + '/feedback', { questionId: qidF });
  ok('Обратная связь получена и подписана источником заглушки',
    fb1.status === 200 && fb1.data.feedback.strong.length > 0 && fb1.data.feedback.rewrite && fb1.data.source.mode === 'mock'
    && fb1.data.source.provider === 'mock' && fb1.data.source.stage === 'pre_interview' && fb1.data.state === 'feedback_ready', JSON.stringify(fb1.data).slice(0, 200));
  const fpView = await fc.call('GET', '/api/preps/' + fp.data.id);
  ok('Обратная связь сохранена по вопросу с отпечатком ответа', fpView.data.feedback[qidF] && fpView.data.feedback[qidF].answerText === answersF[qidF]);
  /* Модели уходят только этот вопрос и этот ответ. */
  const dbF = require('../server/lib/db.js');
  const fPrep = dbF.preps.get((await fc.call('GET', '/api/me')).data.session.id, fp.data.id);
  const builtF = aiMod.buildStore('answer.feedback', { prep: fPrep, includeAnswers: true, questionId: qidF }, null).store.build().context.preparation;
  ok('В задачу обратной связи уходит один вопрос и один ответ', builtF.questions.length === 1 && Object.keys(builtF.answers).length === 1);
  /* Неполный ответ модели не сохраняется. */
  const mockF = require('../shared/ai/providers/mock.js');
  const realF = mockF.run;
  mockF.run = function (request) { return request.task === 'answer.feedback' ? { ok: true, text: '{"strong": ["x"', mock: true, usage: null } : realF(request); };
  const fbBad = await fc.call('POST', '/api/preps/' + fp.data.id + '/feedback', { questionId: qidF });
  mockF.run = realF;
  ok('Неразборчивый ответ модели — 502 malformed_response, прежняя обратная связь сохранена',
    fbBad.status === 502 && fbBad.data.code === 'malformed_response'
    && (await fc.call('GET', '/api/preps/' + fp.data.id)).data.feedback[qidF].strong.length > 0);
  const strangerF = client(fbase);
  await strangerF.call('GET', '/api/me');
  ok('Чужая подготовка недоступна для обратной связи', (await strangerF.call('POST', '/api/preps/' + fp.data.id + '/feedback', { questionId: qidF })).status === 404);
  await fc.call('POST', '/api/preps/' + fp.data.id + '/card');
  const fi = await fc.call('POST', '/api/preps/' + fp.data.id + '/interviews');
  await fc.call('POST', '/api/interviews/' + fi.data.interviewId + '/turns', { text: 'Ответ.' });
  ok('Состояние: text_interview_started после первой реплики кандидата', (await fc.call('GET', '/api/preps/' + fp.data.id)).data.state === 'text_interview_started');
  await fc.call('POST', '/api/interviews/' + fi.data.interviewId + '/finish');
  ok('Состояние: live_interview_available после итога', (await fc.call('GET', '/api/preps/' + fp.data.id)).data.state === 'live_interview_available');
  const fpFinal = (await fc.call('GET', '/api/preps/' + fp.data.id)).data;
  ok('Источники результатов сохранены: сопоставление, вопросы, карточка — заглушка, этап подготовки',
    ['match', 'questions', 'card'].every(function (k) { return fpFinal.sources[k] && fpFinal.sources[k].mode === 'mock' && fpFinal.sources[k].stage === 'pre_interview' && fpFinal.sources[k].createdAt > 0; }),
    JSON.stringify(fpFinal.sources));
  ok('Источник не содержит промптов, текстов и ключей', !/резюме|KEY|prompt|rawText/i.test(JSON.stringify(fpFinal.sources)));
  const frv = await fc.call('POST', '/api/resumes/' + fr.data.id + '/review');
  ok('Разбор резюме хранится с источником', frv.status === 200 && frv.data.source && frv.data.source.mode === 'mock'
    && (await fc.call('GET', '/api/resumes/' + fr.data.id)).data.review.source.provider === 'mock');
  const fint = await fc.call('GET', '/api/interviews/' + fi.data.interviewId);
  ok('Итог интервью хранится с источником', fint.data.summary && fint.data.summary.source && fint.data.summary.source.stage === 'pre_interview');
  fApp.server.close();

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
