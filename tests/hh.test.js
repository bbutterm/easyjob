/* Адаптер hh.ru: распознавание ссылок, карточка вакансии из API, разбор
   страницы резюме, ранжирование и маршруты. Сеть наружу не используется:
   API и сайт hh подменяются локальными серверами через HH_API_BASE и
   HH_SITE_BASE. Запуск: node tests/hh.test.js */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

process.env.AI_PROVIDER = 'mock';
process.env.SESSION_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';
process.env.HH_MODE = 'api'; /* браузерный режим — в tests/hh-browser.test.js */

const Hh = require('../server/lib/adapters/hh.js');
const { createApp } = require('../server/index.js');

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
}
const fx = function (name) { return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'); };
const API = JSON.parse(fx('hh-api.json'));

function client(base) {
  let cookie = '';
  async function call(method, p, body) {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie, origin: base },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json() };
  }
  return { call };
}

(async () => {
  /* ---- detect ---- */
  ok('detect: вакансия с регионального поддомена и хвостом запроса', JSON.stringify(Hh.detect('https://spb.hh.ru/vacancy/123456?from=share')) === JSON.stringify({ kind: 'vacancy', id: '123456', url: 'https://spb.hh.ru/vacancy/123456?from=share' }));
  ok('detect: резюме по хэшу', Hh.detect('https://hh.ru/resume/0123456789abcdef0123456789abcdef').kind === 'resume');
  ok('detect: hh.kz', Hh.detect('https://hh.kz/vacancy/9999').kind === 'vacancy');
  ok('detect: другая страница hh — other', Hh.detect('https://hh.ru/search/vacancy?text=повар').kind === 'other');
  ok('detect: чужой сайт — null', Hh.detect('https://example.com/vacancy/123') === null && Hh.detect('https://nothh.ru/vacancy/123') === null);
  ok('detect: мусор — null', Hh.detect('не ссылка') === null);

  /* ---- toVacancy ---- */
  const v = Hh.toVacancy(API.vacancy);
  ok('toVacancy: заголовок, компания, источник hh_api', v.title === 'Повар горячего цеха' && v.company === 'Ресторан «Север»' && v.source === 'hh_api' && v.needsReview === false);
  ok('toVacancy: текст с полями, описанием без тегов и навыками', /Регион: Санкт-Петербург/.test(v.rawText) && /Зарплата: от 90000 до 120000 ₽/.test(v.rawText)
    && !/<[a-z]/.test(v.rawText) && /Ключевые навыки: Горячий цех/.test(v.rawText), v.rawText.slice(0, 200));
  ok('toVacancy: ссылка без параметров', v.sourceUrl === 'https://hh.ru/vacancy/123456');

  /* ---- parseResumeHtml ---- */
  const r = Hh.parseResumeHtml(fx('hh-resume.html'));
  ok('resume: должность и структура', r.title === 'Повар горячего цеха' && r.structured && r.needsReview);
  ok('resume: опыт с компанией, которая стоит перед должностью', r.data.experience.length === 2
    && r.data.experience[0].company === 'Ресторан «Север»' && r.data.experience[0].role === 'Повар'
    && r.data.experience[1].company === 'Ресторан «Пушкин»' && r.data.experience[1].role === 'Су-шеф', JSON.stringify(r.data.experience));
  ok('resume: периоды и описание', /Март 2019/.test(r.data.experience[0].period) && /настоящее время/.test(r.data.experience[1].period) && /горячий цех/i.test(r.data.experience[0].details));
  ok('resume: навыки, о себе, образование', r.data.skills.join('|') === 'Горячий цех|Технологические карты|ХАССП' && /обучаю новичков/.test(r.data.summary)
    && r.data.education[0].place === 'Кулинарный колледж' && r.data.education[0].program === 'Повар, кондитер');
  ok('resume: rawText не дублируется при структурном разборе', r.data.rawText === undefined);
  let captcha = null;
  try { Hh.parseResumeHtml(fx('hh-captcha.html')); } catch (e) { captcha = e; }
  ok('resume: капча → blocked без обхода', captcha && captcha.extra.code === 'blocked' && /PDF/.test(captcha.message));
  const plain = Hh.parseResumeHtml('<html><body><p>' + 'Текст резюме без разметки hh. '.repeat(20) + '</p></body></html>');
  ok('resume: без data-qa — неструктурно, текст в rawText', !plain.structured && plain.data.rawText.length > 200 && plain.title === 'Резюме с hh.ru');

  /* ---- rank / queryFromResume ---- */
  const resume = { data: r.data };
  const ranked = Hh.rank(resume, API.search.items.map(function (i) { return Hh.toVacancy ? { id: String(i.id), title: i.name, requirement: (i.snippet || {}).requirement || '', responsibility: (i.snippet || {}).responsibility || '' } : i; }));
  ok('rank: повар выше менеджера, есть объяснение', ranked[0].title === 'Повар горячего цеха' && ranked[0].score > ranked[1].score && ranked[0].why.length > 0 && ranked[1].score < 20, JSON.stringify(ranked.map(function (x) { return [x.title, x.score]; })));
  ok('rank: пустое резюме — нули без ошибки', Hh.rank({ data: {} }, ranked)[0].score === 0);
  ok('queryFromResume: профессия и до двух навыков', Hh.queryFromResume(resume) === 'Повар горячего цеха Горячий цех Технологические карты');

  /* ---- Поддельные API и сайт hh ---- */
  const seen = [];
  const api = http.createServer(function (req, res) {
    seen.push({ url: req.url, ua: req.headers['user-agent'], cookie: req.headers.cookie, auth: req.headers.authorization });
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/vacancies/123456') return res.end(JSON.stringify(API.vacancy));
    if (u.pathname === '/vacancies/404404') { res.statusCode = 404; return res.end('{}'); }
    if (u.pathname === '/vacancies/403403') { res.statusCode = 403; return res.end('{}'); }
    if (u.pathname === '/vacancies') {
      if (u.searchParams.get('text') === 'ничего') return res.end(JSON.stringify({ found: 0, page: 0, pages: 0, items: [] }));
      if (u.searchParams.get('text') === 'капча') { res.statusCode = 429; return res.end('{}'); }
      return res.end(JSON.stringify(Object.assign({}, API.search, { found: u.searchParams.get('area') === '2' ? 2 : 7 })));
    }
    if (u.pathname === '/suggests/areas') return res.end(JSON.stringify({ items: API.areas.items.filter(function (a) { return a.text.toLowerCase().indexOf(String(u.searchParams.get('text') || '').toLowerCase()) === 0; }) }));
    res.statusCode = 404; res.end('{}');
  });
  const site = http.createServer(function (req, res) {
    seen.push({ url: req.url, site: true, cookie: req.headers.cookie });
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (/^\/resume\/0123456789abcdef0123456789abcdef/.test(req.url)) return res.end(fx('hh-resume.html'));
    if (/^\/resume\/cafecafecafecafecafecafecafecafe/.test(req.url)) return res.end(fx('hh-captcha.html'));
    if (/^\/resume\/dead/.test(req.url)) { res.statusCode = 403; return res.end('<html></html>'); }
    if (/^\/resume\/e0e0/.test(req.url)) return res.end('<html><body><div class="resume-block"></div></body></html>');
    res.statusCode = 404; res.end('<html>404</html>');
  });
  await new Promise(function (r2) { api.listen(0, '127.0.0.1', r2); });
  await new Promise(function (r2) { site.listen(0, '127.0.0.1', r2); });
  process.env.HH_API_BASE = 'http://127.0.0.1:' + api.address().port;
  process.env.HH_SITE_BASE = 'http://127.0.0.1:' + site.address().port;
  process.env.HH_CONTACT = 'test@example.org';

  const vac = await Hh.vacancyById('123456');
  ok('api: карточка по id, User-Agent с контактом, без куки и токена', vac.title === 'Повар горячего цеха' && seen[0].ua === 'Easyjob/1.0 (test@example.org)' && !seen[0].cookie && !seen[0].auth);
  let e404 = null; try { await Hh.vacancyById('404404'); } catch (e) { e404 = e; }
  ok('api: 404 → not_job_page', e404 && e404.extra.code === 'not_job_page');
  let e403 = null; try { await Hh.vacancyById('403403'); } catch (e) { e403 = e; }
  ok('api: 403 → blocked', e403 && e403.extra.code === 'blocked');

  Hh._cache.clear();
  const s1 = await Hh.search({ text: 'повар', area: 'Санкт' });
  ok('search: регион разрешается через подсказки, результаты со сниппетами', s1.areaId === '2' && s1.areaName === 'Санкт-Петербург' && s1.found === 2 && s1.items.length === 2
    && s1.items[0].url === 'https://hh.ru/vacancy/123456' && /технологические карты/i.test(s1.items[0].requirement) && !/highlighttext/.test(s1.items[0].requirement), JSON.stringify(s1).slice(0, 200));
  const before = seen.length;
  const s2 = await Hh.search({ text: 'ПОВАР', area: '2' });
  ok('search: повтор из кэша без сетевого вызова', s2.cached === true && seen.length === before);
  const s3 = await Hh.search({ text: 'ничего' });
  ok('search: пустой результат — не ошибка', s3.found === 0 && s3.items.length === 0);
  let eq = null; try { await Hh.search({ text: '' }); } catch (e) { eq = e; }
  ok('search: пустой запрос — 400', eq && eq.status === 400);

  const rr = await Hh.resumeByUrl('https://hh.ru/resume/0123456789abcdef0123456789abcdef?from=x');
  ok('resumeByUrl: страница читается без куки, источник hh_page', rr.source === 'hh_page' && rr.sourceUrl === 'https://hh.ru/resume/0123456789abcdef0123456789abcdef'
    && rr.data.experience.length === 2 && !seen[seen.length - 1].cookie);
  let eb = null; try { await Hh.resumeByUrl('https://hh.ru/resume/cafecafecafecafecafecafecafecafe'); } catch (e) { eb = e; }
  ok('resumeByUrl: капча → blocked', eb && eb.extra.code === 'blocked');
  let ed = null; try { await Hh.resumeByUrl('https://hh.ru/resume/deaddeaddeaddeaddeaddeaddeaddead'); } catch (e) { ed = e; }
  ok('resumeByUrl: 403 → blocked с советом', ed && ed.extra.code === 'blocked' && /PDF/.test(ed.message));
  let ee = null; try { await Hh.resumeByUrl('https://hh.ru/resume/e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0'); } catch (e) { ee = e; }
  ok('resumeByUrl: пустая страница → empty_content', ee && ee.extra.code === 'empty_content');
  let ev = null; try { await Hh.resumeByUrl('https://hh.ru/vacancy/1'); } catch (e) { ev = e; }
  ok('resumeByUrl: ссылка не на резюме → unsupported_site', ev && ev.extra.code === 'unsupported_site');

  /* ---- Маршруты ---- */
  const app = createApp({ dbFile: ':memory:', freePrepsPerDay: 100, secure: false, retention: false,
    rateLimit: { perMinute: 10000, expensivePerMinute: 10000, sessionsPerHour: 1000 } });
  await new Promise(function (r2) { app.server.listen(0, '127.0.0.1', r2); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const c = client(base); await c.call('GET', '/api/me');

  const imp = await c.call('POST', '/api/vacancies/import-url', { url: 'https://spb.hh.ru/vacancy/123456?from=share' });
  ok('route: импорт вакансии hh идёт через API, источник hh_api', imp.status === 200 && imp.data.ok && imp.data.vacancy.source === 'hh_api' && imp.data.vacancy.title === 'Повар горячего цеха', JSON.stringify(imp.data).slice(0, 200));
  const impR = await c.call('POST', '/api/vacancies/import-url', { url: 'https://hh.ru/resume/0123456789abcdef0123456789abcdef' });
  ok('route: ссылка на резюме в импорте вакансии — понятный отказ', impR.status === 200 && impR.data.ok === false && impR.data.code === 'not_job_page' && /резюме/.test(impR.data.error));
  const saved = await c.call('POST', '/api/vacancies', { title: imp.data.vacancy.title, company: imp.data.vacancy.company, rawText: imp.data.vacancy.rawText,
    sourceUrl: imp.data.vacancy.sourceUrl, source: imp.data.vacancy.source, retrievedAt: imp.data.vacancy.retrievedAt });
  ok('route: вакансия сохраняется с источником hh_api', saved.status === 201 && saved.data.source === 'hh_api' && saved.data.sourceUrl === 'https://hh.ru/vacancy/123456', JSON.stringify(saved.data).slice(0, 200));

  const ri = await c.call('POST', '/api/resumes/import-url', { url: 'https://hh.ru/resume/0123456789abcdef0123456789abcdef' });
  ok('route: импорт резюме — предпросмотр, не сохранён', ri.status === 200 && ri.data.ok && ri.data.resume.data.profession === 'Повар горячего цеха' && (await c.call('GET', '/api/resumes')).data.length === 0);
  const rc = await c.call('POST', '/api/resumes/import-url', { url: 'https://hh.ru/resume/cafecafecafecafecafecafecafecafe' });
  ok('route: капча — 200 { ok:false, blocked }', rc.status === 200 && rc.data.ok === false && rc.data.code === 'blocked');
  const rv = await c.call('POST', '/api/resumes/import-url', { url: 'https://hh.ru/vacancy/123456' });
  ok('route: ссылка на вакансию в импорте резюме — подсказка', rv.data.ok === false && /вакансию/.test(rv.data.error));
  const rx = await c.call('POST', '/api/resumes/import-url', { url: 'https://example.com/resume/0123456789abcdef0123456789abcdef' });
  ok('route: чужой сайт — unsupported_site', rx.data.ok === false && rx.data.code === 'unsupported_site');
  const created = await c.call('POST', '/api/resumes', { title: ri.data.resume.title, data: ri.data.resume.data });
  ok('route: предпросмотр резюме сохраняется обычным POST /api/resumes', created.status === 201 && created.data.data.skills.length === 3);

  Hh._cache.clear();
  const js = await c.call('GET', '/api/jobs/search?resumeId=' + created.data.id);
  ok('route: поиск по резюме — запрос из профессии, ранжирование, ссылки', js.status === 200 && js.data.ok && js.data.ranked && js.data.query === 'Повар горячего цеха Горячий цех Технологические карты'
    && js.data.items[0].score > js.data.items[1].score && js.data.items[0].url === 'https://hh.ru/vacancy/123456' && js.data.items[0].why.length > 0, JSON.stringify(js.data).slice(0, 300));
  const outgoing = seen.filter(function (x) { return /\/vacancies\?/.test(x.url); }).pop();
  ok('route: наружу уходит только текст запроса, не резюме', outgoing && /text=/.test(outgoing.url) && !/Пушкин|about/.test(decodeURIComponent(outgoing.url)));
  const jt = await c.call('GET', '/api/jobs/search?text=' + encodeURIComponent('менеджер') + '&area=' + encodeURIComponent('Москва'));
  ok('route: поиск по тексту без резюме — без оценок, регион по названию', jt.data.ok && jt.data.ranked === false && jt.data.items[0].score === null && jt.data.areaName === 'Москва');
  const je = await c.call('GET', '/api/jobs/search');
  ok('route: без запроса и резюме — 400', je.status === 400);
  const jb = await c.call('GET', '/api/jobs/search?text=' + encodeURIComponent('капча'));
  ok('route: 429 от hh — 200 { ok:false, blocked }', jb.status === 200 && jb.data.ok === false && jb.data.code === 'blocked');
  const stranger = client(base); await stranger.call('GET', '/api/me');
  ok('route: чужое резюме в поиске — 404', (await stranger.call('GET', '/api/jobs/search?resumeId=' + created.data.id)).status === 404);
  const ja = await c.call('GET', '/api/jobs/areas?text=' + encodeURIComponent('Санкт'));
  ok('route: подсказка регионов', ja.data.items.length === 1 && ja.data.items[0].id === '2');
  ok('route: сайт hh не получал куки пользователя', seen.every(function (x) { return !x.cookie; }));

  app.server.close(); api.close(); site.close();
  delete process.env.HH_API_BASE; delete process.env.HH_SITE_BASE; delete process.env.HH_CONTACT;

  const failed = results.filter(function (x) { return !x.pass; });
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
  process.exit(failed.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
