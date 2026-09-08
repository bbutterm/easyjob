/* Браузерный адаптер hh.ru: страницы открываются настоящим Chromium
   (Playwright) на сервере — без API hh и без ключей. Что с этим делается:

     вакансия  hh.ru/vacancy/<id>          → поля по разметке data-qa + видимый текст
     резюме    hh.ru/resume/<hash>         → разбор разметки (adapters/hh.js) + видимый текст
     поиск     hh.ru/search/vacancy?text=… → карточки выдачи

   Видимый текст страницы дальше отдаётся задаче модели page.extract
   (server/routes/api.js): она выделяет из него саму вакансию или само
   резюме, отбрасывая меню и «похожие вакансии». Разметка — быстрый путь,
   модель — когда разметка не распозналась или это явно включено.

   Что не делается: капча и вход не обходятся (страница с проверкой →
   код blocked), куки пользователя не используются, картинки, шрифты и
   медиа не загружаются, одна вкладка на запрос, браузер закрывается после
   простоя. Скорость: 2–6 секунд на страницу против ~0,3 с у API. */

'use strict';

const { HttpError } = require('../router.js');
const UrlImport = require('../url-import.js');

const LIMITS = { navTimeoutMs: 20000, settleMs: 8000, maxTextChars: 60000, idleCloseMs: 30000, concurrency: 2, searchPerPage: 20 };
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/* Крупные регионы hh: id для параметра area. Остальные города добавляются в текст запроса. */
const AREAS = { 'москва': '1', 'санкт-петербург': '2', 'петербург': '2', 'спб': '2', 'екатеринбург': '3', 'новосибирск': '4',
  'казань': '88', 'нижний новгород': '66', 'краснодар': '53', 'самара': '78', 'ростов-на-дону': '76', 'уфа': '99',
  'челябинск': '104', 'пермь': '72', 'воронеж': '26', 'красноярск': '54', 'омск': '68', 'тюмень': '95', 'россия': '113',
  'алматы': '160', 'астана': '159', 'минск': '1002', 'ташкент': '2759' };

function fail(code, message, status) { return new HttpError(status || 422, message, { ok: false, code }); }
function siteBase(env) { return String((env || process.env).HH_SITE_BASE || 'https://hh.ru').replace(/\/$/, ''); }

let playwright = null;
function engine() {
  if (playwright) return playwright;
  try { playwright = require('playwright'); } catch (e) { playwright = null; }
  return playwright;
}
function available() { return !!engine(); }

/* Один браузер на процесс, закрывается после простоя. Таймер не держит
   процесс: это не фоновая задача, а уборка. */
let browser = null;
let launching = null;
let idleTimer = null;
let active = 0;
const waiters = [];

async function getBrowser(env) {
  const pw = engine();
  if (!pw) throw fail('browser_unavailable', 'Браузер на сервере не установлен: нужен пакет playwright и Chromium.', 503);
  if (browser && browser.isConnected()) return browser;
  if (!launching) {
    const e = env || process.env;
    launching = pw.chromium.launch({
      headless: true,
      executablePath: e.HH_BROWSER_PATH || undefined,
      args: ['--disable-dev-shm-usage', '--no-first-run', '--disable-extensions']
    }).then(function (b) { browser = b; launching = null; b.on('disconnected', function () { if (browser === b) browser = null; }); return b; },
      function (err) { launching = null; throw fail('browser_unavailable', 'Не удалось запустить браузер на сервере.', 503); });
  }
  return launching;
}
function touchIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(function () { if (!active) close(); }, LIMITS.idleCloseMs);
  if (idleTimer.unref) idleTimer.unref();
}
async function close() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  const b = browser; browser = null;
  if (b) { try { await b.close(); } catch (e) { /* уже закрыт */ } }
}
function acquire() {
  if (active < LIMITS.concurrency) { active++; return Promise.resolve(); }
  return new Promise(function (resolve) { waiters.push(resolve); }).then(function () { active++; });
}
function release() {
  active--;
  const next = waiters.shift();
  if (next) next();
  touchIdle();
}

/* Открыть страницу и выполнить extract(page). Куки пустые; тяжёлые ресурсы
   не грузятся; ошибки сети и таймауты — понятные коды. */
async function withPage(url, extract, opts) {
  const o = opts || {};
  const e = o.env || process.env;
  await acquire();
  let context = null;
  try {
    const b = await getBrowser(e);
    context = await b.newContext({
      userAgent: e.HH_BROWSER_UA || DEFAULT_UA, locale: 'ru-RU', viewport: { width: 1280, height: 900 },
      javaScriptEnabled: true, ignoreHTTPSErrors: false
    });
    await context.route('**/*', function (route) {
      const type = route.request().resourceType();
      if (['image', 'media', 'font', 'websocket', 'manifest'].indexOf(type) >= 0) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    if (o.signal) {
      if (o.signal.aborted) throw new HttpError(499, 'Запрос отменён', { code: 'cancelled' });
      o.signal.addEventListener('abort', function () { context.close().catch(function () {}); }, { once: true });
    }
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: LIMITS.navTimeoutMs });
    } catch (err) {
      if (o.signal && o.signal.aborted) throw new HttpError(499, 'Запрос отменён', { code: 'cancelled' });
      throw fail(/Timeout/i.test(String(err && err.message)) ? 'timeout' : 'unsupported_site',
        /Timeout/i.test(String(err && err.message)) ? 'hh.ru не открылся вовремя.' : 'Не удалось открыть страницу hh.ru.', 502);
    }
    const status = response ? response.status() : 0;
    if (status === 403 || status === 429) throw fail('blocked', 'hh.ru ограничил доступ (код ' + status + '). Повторите позже или вставьте текст вручную.');
    if (status === 404) throw fail('not_job_page', 'На hh.ru такой страницы нет или она скрыта.');
    if (status >= 400) throw fail('unsupported_site', 'hh.ru ответил ошибкой (код ' + status + ').');
    if (o.waitFor) {
      try { await page.waitForSelector(o.waitFor, { timeout: LIMITS.settleMs, state: 'attached' }); } catch (err) { /* разметка не появилась: работаем с тем, что есть */ }
    }
    const finalUrl = page.url();
    if (/\/captcha|\/account\/login|\/auth\b/i.test(finalUrl) || /^https?:\/\/[^/]+\/?$/.test(finalUrl) && !/^https?:\/\/[^/]+\/?$/.test(url)) {
      throw fail('blocked', 'hh.ru показал проверку или требует вход. Капча не обходится: вставьте текст вручную или выгрузите файл.');
    }
    const bodyText = String(await page.evaluate(function () { return document.body ? document.body.innerText : ''; }) || '');
    if (/подтвердите, что вы не робот|вы не робот|captcha/i.test(bodyText.slice(0, 2000)) && bodyText.length < 4000) {
      throw fail('blocked', 'hh.ru показал проверку «не робот». Капча не обходится: вставьте текст вручную или выгрузите файл.');
    }
    return await extract(page, { url: finalUrl, text: bodyText.slice(0, LIMITS.maxTextChars), status });
  } finally {
    if (context) await context.close().catch(function () {});
    release();
  }
}

function textOf(page, selector) {
  return page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    return el ? el.innerText.replace(/\s+\n/g, '\n').trim() : '';
  }, selector);
}
function textsOf(page, selector) {
  return page.evaluate(function (sel) {
    return Array.from(document.querySelectorAll(sel)).map(function (el) { return el.innerText.trim(); }).filter(Boolean);
  }, selector);
}

/* Вакансия: поля по разметке hh + видимый текст для модели. */
async function vacancyByUrl(hit, opts) {
  const url = siteBase(opts && opts.env) + '/vacancy/' + hit.id;
  return withPage(url, async function (page, got) {
    const title = await textOf(page, '[data-qa="vacancy-title"], h1');
    const company = await textOf(page, '[data-qa="vacancy-company-name"]');
    const salary = await textOf(page, '[data-qa="vacancy-salary"]');
    const experience = await textOf(page, '[data-qa="vacancy-experience"]');
    const employment = await textOf(page, '[data-qa="vacancy-view-employment-mode"], [data-qa="common-employment-text"]');
    const area = await textOf(page, '[data-qa="vacancy-view-location"], [data-qa="vacancy-view-raw-address"]');
    const description = await textOf(page, '[data-qa="vacancy-description"]');
    const skills = await textsOf(page, '[data-qa="skills-element"], [data-qa="bloko-tag__text"]');
    const structured = !!(title && description && description.length >= 40);
    const lines = [];
    if (company) lines.push('Компания: ' + company);
    if (area) lines.push('Регион: ' + area);
    if (salary) lines.push('Зарплата: ' + salary);
    if (experience) lines.push('Опыт: ' + experience);
    if (employment) lines.push('Занятость: ' + employment);
    let rawText = structured
      ? (lines.length ? lines.join('\n') + '\n\n' : '') + description + (skills.length ? '\n\nКлючевые навыки: ' + skills.join(', ') : '')
      : got.text;
    return {
      sourceUrl: 'https://hh.ru/vacancy/' + hit.id, title: String(title || '').slice(0, 200), company: String(company || '').slice(0, 200),
      rawText: rawText.slice(0, 40000), source: 'hh_browser', retrievedAt: Date.now(), needsReview: !structured, structured,
      pageText: got.text, hh: { id: String(hit.id), area: area || null, salary: salary || null, experience: experience || null, skills }
    };
  }, Object.assign({}, opts, { waitFor: '[data-qa="vacancy-description"], [data-qa="vacancy-title"]' }));
}

/* Резюме: разметка через общий разбор + видимый текст. */
async function resumeByUrl(hit, opts) {
  const Hh = require('./hh.js');
  const url = siteBase(opts && opts.env) + '/resume/' + hit.id;
  return withPage(url, async function (page, got) {
    const html = await page.content();
    let parsed;
    try { parsed = Hh.parseResumeHtml(html); } catch (e) {
      if (e instanceof HttpError && e.extra && e.extra.code === 'blocked') throw e;
      parsed = { title: 'Резюме с hh.ru', data: { profession: '', summary: '', experience: [], skills: [], achievements: [], education: [] }, structured: false, needsReview: true };
    }
    if (!parsed.structured) parsed.data.rawText = got.text.slice(0, 40000);
    return Object.assign(parsed, { sourceUrl: 'https://hh.ru/resume/' + hit.id, source: 'hh_browser', retrievedAt: Date.now(), pageText: got.text });
  }, Object.assign({}, opts, { waitFor: '[data-qa="resume-block-title-position"], [data-qa="resume-block-experience"]' }));
}

/* Выдача поиска: карточки по разметке. Регион — id из таблицы, иначе слово в запросе. */
async function search(params, opts) {
  const p = params || {};
  const text = String(p.text || '').trim().slice(0, 200);
  if (!text) throw new HttpError(400, 'Введите текст запроса.', { code: 'bad_query' });
  const page = Math.max(0, Math.min(19, Number(p.page) || 0));
  let areaId = String(p.area || '').trim();
  let areaName = '';
  let query = text;
  if (areaId && !/^\d+$/.test(areaId)) {
    const key = areaId.toLowerCase();
    if (AREAS[key]) { areaName = areaId; areaId = AREAS[key]; } else { query = text + ' ' + areaId; areaName = areaId; areaId = ''; }
  }
  const url = siteBase(opts && opts.env) + '/search/vacancy?text=' + encodeURIComponent(query) + '&page=' + page
    + '&items_on_page=' + LIMITS.searchPerPage + (areaId ? '&area=' + encodeURIComponent(areaId) : '');
  return withPage(url, async function (pg, got) {
    const items = await pg.evaluate(function () {
      function t(root, sel) { const el = root.querySelector(sel); return el ? el.innerText.trim() : ''; }
      const cards = Array.from(document.querySelectorAll('[data-qa="vacancy-serp__vacancy"], [data-qa^="vacancy-serp__vacancy"]'));
      const seen = {};
      return cards.map(function (c) {
        const a = c.querySelector('a[data-qa="serp-item__title"], a[data-qa="vacancy-serp__vacancy-title"], a[href*="/vacancy/"]');
        const href = a ? a.getAttribute('href') || '' : '';
        const m = /\/vacancy\/(\d+)/.exec(href);
        if (!m || seen[m[1]]) return null;
        seen[m[1]] = true;
        return { id: m[1], title: a ? a.innerText.trim() : '', company: t(c, '[data-qa="vacancy-serp__vacancy-employer"]'),
          area: t(c, '[data-qa="vacancy-serp__vacancy-address"]'), salary: t(c, '[data-qa="vacancy-serp__vacancy-compensation"]') || null,
          experience: t(c, '[data-qa="vacancy-serp__vacancy-work-experience"]'), schedule: '',
          requirement: t(c, '[data-qa="vacancy-serp__vacancy_snippet_requirement"]'), responsibility: t(c, '[data-qa="vacancy-serp__vacancy_snippet_responsibility"]'),
          url: 'https://hh.ru/vacancy/' + m[1], publishedAt: null };
      }).filter(Boolean);
    });
    const foundText = /найден[оа]?\s+([\d\s  ]+)\s+(вакансия|вакансии|вакансий)/i.exec(got.text);
    const found = foundText ? Number(foundText[1].replace(/\D/g, '')) : items.length;
    const pages = Math.max(1, Math.min(20, Math.ceil(found / LIMITS.searchPerPage) || 1));
    return { found, page, pages, items, query: text, areaId: areaId || null, areaName: areaName || null, via: 'browser' };
  }, Object.assign({}, opts, { waitFor: '[data-qa="vacancy-serp__vacancy"], [data-qa="vacancy-serp__results"], main' }));
}

module.exports = { available, vacancyByUrl, resumeByUrl, search, close, withPage, LIMITS, AREAS, _state: function () { return { active, open: !!browser }; } };
