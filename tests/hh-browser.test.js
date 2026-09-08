/* Браузерный адаптер hh.ru: Chromium на сервере открывает страницы
   поддельного сайта (tests/fixtures/hh-site.js), которые собираются
   JavaScript-ом — без браузера в них пусто. Затем маршруты в режимах
   browser / api / auto и извлечение полей задачей модели page.extract на
   заглушке. Наружу не ходит. Запуск: node tests/hh-browser.test.js */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

process.env.AI_PROVIDER = 'mock';
process.env.SESSION_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';

const Site = require('./fixtures/hh-site.js');
const Browser = require('../server/lib/adapters/hh-browser.js');
const Hh = require('../server/lib/adapters/hh.js');
const { createApp } = require('../server/index.js');

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
}
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
async function fails(fn) { try { await fn(); return null; } catch (e) { return e; } }

(async () => {
  ok('Playwright и Chromium доступны серверу', Browser.available());
  const site = Site.create();
  const siteBase = await site.listen();
  process.env.HH_SITE_BASE = siteBase;

  /* Без браузера страница пуста — это и есть причина браузерного режима. */
  const rawHtml = await (await fetch(siteBase + '/vacancy/123456')).text();
  ok('Поддельный hh: без JavaScript в HTML нет вакансии', /<div id="root"><noscript>Включите JavaScript/.test(rawHtml) && !/<h1[^>]*>Повар/.test(rawHtml));

  /* ---- Модуль ---- */
  const t0 = Date.now();
  const v = await Browser.vacancyByUrl({ id: '123456' });
  ok('Вакансия: поля по разметке, источник hh_browser, без проверки', v.title === 'Повар горячего цеха' && v.company === 'Ресторан «Север»'
    && v.source === 'hh_browser' && v.structured && v.needsReview === false, JSON.stringify(v).slice(0, 160));
  ok('Вакансия: текст с описанием, зарплатой и навыками, без меню сайта', /Зарплата: от 90000/.test(v.rawText) && /Ключевые навыки: Горячий цех/.test(v.rawText)
    && !/Работодателям/.test(v.rawText) && !/Похожие вакансии/.test(v.rawText));
  ok('Вакансия: видимый текст страницы отдельно (для модели)', v.pageText.length > 200 && /Похожие вакансии/.test(v.pageText));
  ok('Вакансия: время на странице приемлемо (< 15 с)', Date.now() - t0 < 15000, (Date.now() - t0) + ' мс');
  const plain = await Browser.vacancyByUrl({ id: '555' });
  ok('Страница без разметки: сырой текст, needsReview', !plain.structured && plain.needsReview && /Су-шеф/.test(plain.rawText) && /Работодателям/.test(plain.rawText));
  const r = await Browser.resumeByUrl({ id: '0123456789abcdef0123456789abcdef' });
  ok('Резюме: разметка разобрана из DOM после JavaScript', r.structured && r.data.experience.length === 2 && r.data.experience[1].company === 'Ресторан «Пушкин»' && r.data.skills.length === 3 && r.source === 'hh_browser');
  const s = await Browser.search({ text: 'повар', area: 'Санкт-Петербург' });
  ok('Поиск: карточки выдачи, регион из таблицы, id из ссылок', s.found === 2 && s.areaId === '2' && s.items.length === 2 && s.items[0].id === '123456'
    && s.items[0].url === 'https://hh.ru/vacancy/123456' && /горячем цехе/.test(s.items[0].requirement) && s.via === 'browser', JSON.stringify(s).slice(0, 200));
  const s2 = await Browser.search({ text: 'повар', area: 'Тула' });
  ok('Поиск: неизвестный город уходит словом в запрос', s2.areaId === null && s2.areaName === 'Тула' && /text=%D0%BF%D0%BE%D0%B2%D0%B0%D1%80%20%D0%A2%D1%83%D0%BB%D0%B0/.test(site.seen[site.seen.length - 1].url));
  const e403 = await fails(function () { return Browser.vacancyByUrl({ id: '403403' }); });
  ok('403 → blocked, без обхода', e403 && e403.extra.code === 'blocked');
  const eCap = await fails(function () { return Browser.vacancyByUrl({ id: '777777' }); });
  ok('Страница «не робот» → blocked', eCap && eCap.extra.code === 'blocked' && /Капча не обходится/.test(eCap.message));
  const e404 = await fails(function () { return Browser.vacancyByUrl({ id: '999' }); });
  ok('404 → not_job_page', e404 && e404.extra.code === 'not_job_page');
  const eRes = await fails(function () { return Browser.resumeByUrl({ id: 'cafecafecafecafecafecafecafecafe' }); });
  ok('Капча на резюме → blocked', eRes && eRes.extra.code === 'blocked');
  ok('Сайт не получал куки; User-Agent браузерный', site.seen.every(function (x) { return !x.cookie; }) && site.seen.slice(1).every(function (x) { return /Mozilla/.test(x.ua); }));
  const ctrl = new AbortController();
  const pCancel = Browser.vacancyByUrl({ id: '123456' }, { signal: ctrl.signal });
  ctrl.abort();
  const eCancel = await fails(function () { return pCancel; });
  ok('Отмена запроса закрывает вкладку и даёт cancelled', eCancel && (eCancel.status === 499 || (eCancel.extra && eCancel.extra.code === 'cancelled')), eCancel && eCancel.message);
  ok('Одновременные страницы ограничены', Browser.LIMITS.concurrency === 2);
  ok('Режим по умолчанию — браузер, без API', Hh.mode({}) === 'browser' && Hh.mode({ HH_MODE: 'api' }) === 'api' && Hh.mode({ HH_MODE: 'x' }) === 'browser');

  /* ---- Маршруты в режиме browser ---- */
  process.env.HH_MODE = 'browser';
  const app = createApp({ dbFile: ':memory:', freePrepsPerDay: 100, secure: false, retention: false,
    rateLimit: { perMinute: 10000, expensivePerMinute: 10000, sessionsPerHour: 1000 } });
  await new Promise(function (r2) { app.server.listen(0, '127.0.0.1', r2); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const c = client(base); await c.call('GET', '/api/me');

  const imp = await c.call('POST', '/api/vacancies/import-url', { url: 'https://hh.ru/vacancy/123456' });
  ok('Маршрут: вакансия через браузер, поля по разметке, модель не звалась', imp.status === 200 && imp.data.ok && imp.data.vacancy.source === 'hh_browser'
    && imp.data.vacancy.extract.by === 'markup' && imp.data.vacancy.pageText === undefined, JSON.stringify(imp.data).slice(0, 200));
  const impPlain = await c.call('POST', '/api/vacancies/import-url', { url: 'https://hh.ru/vacancy/555' });
  ok('Маршрут: страница без разметки → поля выделила модель (заглушка), меню сайта отброшено', impPlain.data.ok && impPlain.data.vacancy.extract.by === 'model'
    && impPlain.data.vacancy.extract.mock === true && impPlain.data.vacancy.title === 'Су-шеф в ресторан «Пушкин»' && impPlain.data.vacancy.company === 'Ресторан «Пушкин»'
    && !/Работодателям/.test(impPlain.data.vacancy.rawText) && !/Похожие вакансии/.test(impPlain.data.vacancy.rawText) && impPlain.data.vacancy.needsReview === true,
    JSON.stringify(impPlain.data).slice(0, 300));
  const dbA = require('../server/lib/db.js');
  const stages = dbA.usage.summary(1).byStage.map(function (x) { return x.stage; });
  ok('Маршрут: вызов модели учтён в расходе на этапе pre_interview, текст страницы в базе не хранится',
    stages.indexOf('pre_interview') >= 0 && !/Пушкин/.test(JSON.stringify(dbA.usage.summary(1))));
  const saved = await c.call('POST', '/api/vacancies', { title: imp.data.vacancy.title, company: imp.data.vacancy.company, rawText: imp.data.vacancy.rawText,
    sourceUrl: imp.data.vacancy.sourceUrl, source: imp.data.vacancy.source, retrievedAt: imp.data.vacancy.retrievedAt });
  ok('Маршрут: источник hh_browser сохраняется', saved.status === 201 && saved.data.source === 'hh_browser');
  const impCap = await c.call('POST', '/api/vacancies/import-url', { url: 'https://hh.ru/vacancy/777777' });
  ok('Маршрут: капча → 200 { ok:false, blocked }', impCap.status === 200 && impCap.data.ok === false && impCap.data.code === 'blocked');

  const ri = await c.call('POST', '/api/resumes/import-url', { url: 'https://hh.ru/resume/0123456789abcdef0123456789abcdef' });
  ok('Маршрут: резюме через браузер, разметка, без текста страницы в ответе', ri.data.ok && ri.data.resume.source === 'hh_browser' && ri.data.resume.extract.by === 'markup'
    && ri.data.resume.data.experience.length === 2 && ri.data.resume.pageText === undefined);
  process.env.HH_EXTRACT = 'model';
  const riModel = await c.call('POST', '/api/resumes/import-url', { url: 'https://hh.ru/resume/0123456789abcdef0123456789abcdef' });
  ok('HH_EXTRACT=model: модель вызывается всегда; поля из разметки не затираются', riModel.data.ok && riModel.data.resume.extract.by === 'model'
    && riModel.data.resume.data.experience[0].company === 'Ресторан «Север»' && riModel.data.resume.data.skills.length === 3);
  delete process.env.HH_EXTRACT;

  const js = await c.call('GET', '/api/jobs/search?text=' + encodeURIComponent('повар') + '&area=' + encodeURIComponent('Москва'));
  ok('Маршрут: поиск через браузер, регион по таблице', js.status === 200 && js.data.ok && js.data.via === 'browser' && js.data.areaId === '1' && js.data.items.length === 2, JSON.stringify(js.data).slice(0, 200));

  /* ---- Режим auto: браузер, при отказе — API ---- */
  const api = http.createServer(function (req, res) {
    res.setHeader('content-type', 'application/json');
    if (req.url.indexOf('/vacancies/777777') === 0) return res.end(JSON.stringify(Object.assign({}, JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hh-api.json'), 'utf8')).vacancy, { id: 777777, name: 'Из API' })));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(function (r2) { api.listen(0, '127.0.0.1', r2); });
  process.env.HH_API_BASE = 'http://127.0.0.1:' + api.address().port;
  process.env.HH_MODE = 'auto';
  const auto = await c.call('POST', '/api/vacancies/import-url', { url: 'https://hh.ru/vacancy/777777' });
  ok('auto: капча в браузере → та же вакансия из API', auto.data.ok && auto.data.vacancy.source === 'hh_api' && auto.data.vacancy.title === 'Из API');
  process.env.HH_MODE = 'api';
  const apiOnly = await c.call('POST', '/api/vacancies/import-url', { url: 'https://hh.ru/vacancy/123456' });
  ok('api: браузер не используется, 404 API → not_job_page', apiOnly.data.ok === false && apiOnly.data.code === 'not_job_page');
  api.close();
  delete process.env.HH_API_BASE; delete process.env.HH_MODE;

  app.server.close();
  await Browser.close();
  ok('Браузер закрыт после работы', Browser._state().open === false && Browser._state().active === 0);
  site.close();
  delete process.env.HH_SITE_BASE;

  const failed = results.filter(function (x) { return !x.pass; });
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
  process.exit(failed.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
