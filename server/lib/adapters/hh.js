/* Адаптер hh.ru: вакансии и поиск через публичный API, резюме — по
   публичной ссылке на страницу.

   Что доступно без договора с hh:
     GET api.hh.ru/vacancies?text=…      поиск (нужен только User-Agent с контактом)
     GET api.hh.ru/vacancies/{id}        карточка вакансии с описанием и навыками
     GET api.hh.ru/suggests/areas?text=… подсказка региона
   Резюме в API отдаются только владельцу по OAuth; здесь читается публичная
   страница hh.ru/resume/<hash>, если соискатель открыл её всем. Страница может
   отдать капчу или обрезанный текст — тогда честная ошибка и совет выгрузить
   резюме из hh в PDF или DOCX и загрузить файлом. Капча и вход не обходятся.

   Сетевые вызовы идут только на api.hh.ru и hh.ru (и региональные поддомены);
   адреса из переменных HH_API_BASE и HH_SITE_BASE — для проверок. Куки и
   заголовки пользователя не передаются, ответы ограничены по размеру и времени.
   Коммерческое использование API hh требует согласования с hh — см. docs/hh.md. */

'use strict';

const { HttpError } = require('../router.js');
const UrlImport = require('../url-import.js');
const Evidence = require('../evidence.js');

const LIMITS = { timeoutMs: 12000, maxBytes: 2 * 1024 * 1024, perPage: 20, cacheMs: 10 * 60 * 1000 };
const cache = new Map();

function fail(code, message, status) { return new HttpError(status || 422, message, { ok: false, code }); }

function apiBase(env) { return String((env || process.env).HH_API_BASE || 'https://api.hh.ru').replace(/\/$/, ''); }
function siteBase(env) { return String((env || process.env).HH_SITE_BASE || 'https://hh.ru').replace(/\/$/, ''); }
function headers(env) {
  const e = env || process.env;
  const h = { 'user-agent': 'Easyjob/1.0 (' + (e.HH_CONTACT || 'support@easyjob.local') + ')', accept: 'application/json' };
  if (e.HH_TOKEN) h.authorization = 'Bearer ' + e.HH_TOKEN;
  return h;
}

/* Распознать ссылку hh: вакансия или резюме. Иначе null. */
function detect(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch (e) { return null; }
  const host = url.hostname.toLowerCase();
  if (!/^(?:[a-z0-9-]+\.)?hh\.(ru|kz|uz|by)$/.test(host) && !/^(?:[a-z0-9-]+\.)?headhunter\.(kz|kg)$/.test(host)) return null;
  let m = /^\/vacancy\/(\d{3,12})\b/.exec(url.pathname);
  if (m) return { kind: 'vacancy', id: m[1], url: url.href };
  m = /^\/resume\/([0-9a-f]{20,64})\b/i.exec(url.pathname);
  if (m) return { kind: 'resume', id: m[1].toLowerCase(), url: url.href };
  return { kind: 'other', url: url.href };
}

async function request(url, opts) {
  const o = opts || {};
  const fetcher = o.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, LIMITS.timeoutMs);
  if (o.signal) o.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
  let res;
  try {
    res = await fetcher(url, { method: 'GET', headers: Object.assign({}, headers(o.env), o.headers || {}), signal: controller.signal, redirect: 'follow' });
  } catch (e) {
    clearTimeout(timer);
    if (o.signal && o.signal.aborted) throw new HttpError(499, 'Запрос отменён', { code: 'cancelled' });
    throw fail(controller.signal.aborted ? 'timeout' : 'unsupported_site', controller.signal.aborted ? 'hh.ru не ответил вовремя.' : 'Не удалось соединиться с hh.ru.', controller.signal.aborted ? 504 : 502);
  }
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > LIMITS.maxBytes) throw fail('too_large', 'Ответ hh.ru слишком большой.');
    return { status: res.status, type: String(res.headers.get('content-type') || ''), body: buf };
  } finally { clearTimeout(timer); }
}

function statusError(status) {
  if (status === 403 || status === 429) return fail('blocked', 'hh.ru ограничил доступ (код ' + status + '). Повторите позже или вставьте текст вручную.');
  if (status === 404) return fail('not_job_page', 'На hh.ru такой страницы нет или она скрыта.');
  return fail('unsupported_site', 'hh.ru ответил ошибкой (код ' + status + ').');
}

function salaryText(s) {
  if (!s || (!s.from && !s.to)) return '';
  const cur = s.currency === 'RUR' ? '₽' : (s.currency || '');
  const parts = [];
  if (s.from) parts.push('от ' + s.from);
  if (s.to) parts.push('до ' + s.to);
  return parts.join(' ') + ' ' + cur + (s.gross ? ' до вычета налогов' : '');
}

/* Карточка вакансии API → вакансия для подготовки. */
function toVacancy(v) {
  const lines = [];
  if (v.employer && v.employer.name) lines.push('Компания: ' + v.employer.name);
  if (v.area && v.area.name) lines.push('Регион: ' + v.area.name);
  const sal = salaryText(v.salary);
  if (sal) lines.push('Зарплата: ' + sal);
  if (v.experience && v.experience.name) lines.push('Опыт: ' + v.experience.name);
  if (v.employment && v.employment.name) lines.push('Занятость: ' + v.employment.name);
  if (v.schedule && v.schedule.name) lines.push('График: ' + v.schedule.name);
  const description = UrlImport.htmlToText(String(v.description || ''));
  const skills = (Array.isArray(v.key_skills) ? v.key_skills : []).map(function (k) { return k && k.name; }).filter(Boolean);
  let rawText = (lines.length ? lines.join('\n') + '\n\n' : '') + description;
  if (skills.length) rawText += '\n\nКлючевые навыки: ' + skills.join(', ');
  return {
    sourceUrl: v.alternate_url || ('https://hh.ru/vacancy/' + v.id),
    title: String(v.name || '').slice(0, 200), company: String((v.employer && v.employer.name) || '').slice(0, 200),
    rawText: rawText.slice(0, 40000), source: 'hh_api', retrievedAt: Date.now(), needsReview: false, structured: true,
    hh: { id: String(v.id), area: v.area && v.area.name, salary: sal || null, experience: v.experience && v.experience.name, skills }
  };
}

async function vacancyById(id, opts) {
  const res = await request(apiBase(opts && opts.env) + '/vacancies/' + encodeURIComponent(id), opts);
  if (res.status !== 200) throw statusError(res.status);
  let json;
  try { json = JSON.parse(res.body.toString('utf8')); } catch (e) { throw fail('unsupported_site', 'hh.ru вернул не JSON.'); }
  if (!json || !json.name) throw fail('not_job_page', 'В ответе hh.ru нет вакансии.');
  return toVacancy(json);
}

function clean(s) { return UrlImport.htmlToText(String(s || '')).replace(/\s+/g, ' ').trim(); }

/* Результат поиска API → строка списка. */
function toItem(v) {
  const sn = v.snippet || {};
  return {
    id: String(v.id), title: String(v.name || ''), company: (v.employer && v.employer.name) || '',
    area: (v.area && v.area.name) || '', salary: salaryText(v.salary) || null,
    url: v.alternate_url || ('https://hh.ru/vacancy/' + v.id), publishedAt: v.published_at || null,
    experience: (v.experience && v.experience.name) || '', schedule: (v.schedule && v.schedule.name) || '',
    requirement: clean(sn.requirement), responsibility: clean(sn.responsibility)
  };
}

async function areas(text, opts) {
  const res = await request(apiBase(opts && opts.env) + '/suggests/areas?text=' + encodeURIComponent(String(text || '').slice(0, 60)), opts);
  if (res.status !== 200) return [];
  try {
    const json = JSON.parse(res.body.toString('utf8'));
    return (json.items || []).slice(0, 10).map(function (a) { return { id: String(a.id), name: a.text }; });
  } catch (e) { return []; }
}

/* Поиск: text — запрос, area — id региона или его название (разрешается
   через подсказки), page с нуля. Результаты кэшируются на 10 минут. */
async function search(params, opts) {
  const p = params || {};
  const text = String(p.text || '').trim().slice(0, 200);
  if (!text) throw new HttpError(400, 'Введите текст запроса.', { code: 'bad_query' });
  let areaId = String(p.area || '').trim();
  let areaName = '';
  if (areaId && !/^\d+$/.test(areaId)) {
    const found = await areas(areaId, opts);
    if (found.length) { areaName = found[0].name; areaId = found[0].id; } else { areaId = ''; }
  }
  const page = Math.max(0, Math.min(19, Number(p.page) || 0));
  const key = [text.toLowerCase(), areaId, page].join('|');
  const hit = cache.get(key);
  if (hit && hit.at + LIMITS.cacheMs > Date.now() && !(opts && opts.noCache)) return Object.assign({}, hit.value, { cached: true });
  const q = '/vacancies?text=' + encodeURIComponent(text) + '&per_page=' + LIMITS.perPage + '&page=' + page + '&order_by=relevance'
    + (areaId ? '&area=' + encodeURIComponent(areaId) : '');
  const res = await request(apiBase(opts && opts.env) + q, opts);
  if (res.status !== 200) throw statusError(res.status);
  let json;
  try { json = JSON.parse(res.body.toString('utf8')); } catch (e) { throw fail('unsupported_site', 'hh.ru вернул не JSON.'); }
  const value = { found: Number(json.found) || 0, page: Number(json.page) || 0, pages: Number(json.pages) || 0,
    items: (json.items || []).map(toItem), query: text, areaId: areaId || null, areaName: areaName || null };
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

/* Насколько вакансия похожа на резюме: пересечение основ слов из профессии,
   навыков и должностей резюме с названием и сниппетом вакансии. Это
   совпадение слов, не оценка модели; объяснение — список совпавших слов. */
function resumeTerms(resume) {
  const d = (resume && resume.data) || resume || {};
  const parts = [d.profession || '', (d.skills || []).join(' '), (d.experience || []).map(function (e) { return (e.role || '') + ' ' + (e.details || ''); }).join(' ')];
  const terms = Evidence.terms(parts.join(' '), 40);
  const primary = Evidence.terms((d.profession || '') + ' ' + (d.skills || []).slice(0, 6).join(' '), 12);
  return { all: terms, primary };
}

function rank(resume, items) {
  const t = resumeTerms(resume);
  if (!t.all.length) return items.map(function (i) { return Object.assign({}, i, { score: 0, why: [] }); });
  return items.map(function (i) {
    const title = String(i.title || '').toLowerCase();
    const text = (i.title + ' ' + i.requirement + ' ' + i.responsibility).toLowerCase();
    const why = [];
    let score = 0;
    t.all.forEach(function (st) {
      if (text.indexOf(st) < 0) return;
      const w = (title.indexOf(st) >= 0 ? 2 : 1) * (t.primary.indexOf(st) >= 0 ? 2 : 1);
      score += w;
      /* В объяснение — целое слово из вакансии, а не основа. */
      const word = (new RegExp('(?<![а-яёa-z0-9])(' + st.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[а-яёa-z0-9-]*)', 'i').exec(text) || [])[1] || st;
      if (why.indexOf(word) < 0) why.push(word);
    });
    const max = t.all.length + t.primary.length * 3;
    return Object.assign({}, i, { score: Math.round(100 * score / max), why: why.slice(0, 8) });
  }).sort(function (a, b) { return b.score - a.score; });
}

/* Запрос для поиска из резюме: профессия и до трёх навыков. */
function queryFromResume(resume) {
  const d = (resume && resume.data) || resume || {};
  const skills = (d.skills || []).slice(0, 2).map(function (s) { return String(s).trim(); }).filter(Boolean);
  return [d.profession || ''].concat(skills).filter(Boolean).join(' ').slice(0, 120);
}

/* ---- Резюме по публичной ссылке ---- */

function attr(html, qa, tag) {
  const re = new RegExp('<(' + (tag || '[a-z0-9]+') + ')[^>]*data-qa="' + qa + '"[^>]*>([\\s\\S]*?)<\\/\\1>', 'i');
  const m = re.exec(html);
  return m ? clean(m[2]) : '';
}
function attrAll(html, qa) {
  const re = new RegExp('<([a-z0-9]+)[^>]*data-qa="' + qa + '"[^>]*>([\\s\\S]*?)<\\/\\1>', 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(clean(m[2]));
  return out;
}

const MONTHS = 'январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр';

function parseResumeHtml(html) {
  const s = String(html || '');
  if (/не робот|captcha|Подтвердите, что вы человек/i.test(s) && !/resume-block/i.test(s)) throw fail('blocked', 'hh.ru показал проверку «не робот». Выгрузите резюме с hh.ru в PDF или DOCX и загрузите файлом.');
  const profession = attr(s, 'resume-block-title-position') || attr(s, 'title-position');
  const about = attr(s, 'resume-block-skills-content') || attr(s, 'resume-block-about');
  const skills = attrAll(s, 'bloko-tag__text').filter(function (x, i, a) { return x && a.indexOf(x) === i; }).slice(0, 40);
  const experience = [];
  const expBlocks = s.split(/data-qa="resume-block-experience-position"/i);
  for (let i = 1; i < expBlocks.length; i++) {
    const before = expBlocks[i - 1].slice(-1500);
    const after = expBlocks[i];
    const role = clean((/^[^>]*>([\s\S]*?)<\/(?:div|span|p|h\d)>/i.exec(after) || [])[1]);
    const period = (new RegExp('((?:' + MONTHS + ')[а-яё]*\\s+\\d{4}\\s*[—–-]\\s*(?:(?:' + MONTHS + ')[а-яё]*\\s+\\d{4}|настоящее время|по настоящее время))', 'i').exec(before + after.slice(0, 400)) || [])[1] || '';
    /* В разметке hh компания стоит перед должностью: сначала ищем в конце
       предыдущего куска, затем — в начале текущего. */
    const compRe = /data-qa="resume-block-experience-company"[^>]*>([\s\S]*?)<\//gi;
    let company = '';
    let cm;
    while ((cm = compRe.exec(before))) company = clean(cm[1]);
    if (!company) company = clean((/data-qa="resume-block-experience-company"[^>]*>([\s\S]*?)<\//i.exec(after.slice(0, 3000)) || /\/employer\/\d+[^>]*>([\s\S]*?)<\//i.exec(after.slice(0, 3000)) || [])[1]);
    const details = clean((/data-qa="resume-block-experience-description"[^>]*>([\s\S]*?)<\/div>/i.exec(after.slice(0, 20000)) || [])[1]);
    if (role) experience.push({ role, company, period, details: details.slice(0, 2000) });
  }
  const education = [];
  const eduNames = attrAll(s, 'resume-block-education-name');
  const eduOrgs = attrAll(s, 'resume-block-education-organization');
  eduNames.forEach(function (name, i) { education.push({ place: name, program: eduOrgs[i] || '', period: '' }); });
  const main = UrlImport.htmlToText(s).slice(0, 40000);
  const structured = !!(profession || experience.length || skills.length);
  return { title: profession ? profession.slice(0, 120) : 'Резюме с hh.ru',
    data: { profession: profession.slice(0, 200), summary: about.slice(0, 2000), experience: experience.slice(0, 12), skills, achievements: [], education: education.slice(0, 8),
      rawText: structured ? undefined : main },
    structured, needsReview: true };
}

async function resumeByUrl(raw, opts) {
  const hit = detect(raw);
  if (!hit || hit.kind !== 'resume') throw fail('unsupported_site', 'Это не ссылка на резюме hh.ru вида https://hh.ru/resume/…');
  const res = await request(siteBase(opts && opts.env) + '/resume/' + hit.id, Object.assign({}, opts, { headers: { accept: 'text/html,application/xhtml+xml' } }));
  if (res.status === 403 || res.status === 429) throw fail('blocked', 'hh.ru не отдал страницу резюме (код ' + res.status + '). Выгрузите резюме с hh.ru в PDF или DOCX и загрузите файлом.');
  if (res.status !== 200) throw statusError(res.status);
  const parsed = parseResumeHtml(res.body.toString('utf8'));
  if (!parsed.structured && (!parsed.data.rawText || parsed.data.rawText.length < 200)) {
    throw fail('empty_content', 'Резюме на hh.ru закрыто или не содержит текста. Выгрузите его в PDF или DOCX и загрузите файлом.');
  }
  return Object.assign(parsed, { sourceUrl: 'https://hh.ru/resume/' + hit.id, source: 'hh_page', retrievedAt: Date.now() });
}

/* ---- Режим: браузер или API ----
   HH_MODE=browser (по умолчанию) — страницы открывает Chromium на сервере, API не
   используется. HH_MODE=api — только публичный API. HH_MODE=auto — браузер, а при
   его недоступности или отказе — API. Капча в любом режиме не обходится. */
function mode(env) {
  const m = String((env || process.env).HH_MODE || 'browser').toLowerCase();
  return ['api', 'browser', 'auto'].indexOf(m) >= 0 ? m : 'browser';
}
function isCancel(e) { return e instanceof HttpError && e.extra && e.extra.code === 'cancelled'; }
async function viaMode(opts, browserFn, apiFn) {
  const m = mode(opts && opts.env);
  if (m === 'api') return apiFn();
  const Browser = require('./hh-browser.js');
  if (m === 'browser') return browserFn(Browser);
  try { return await browserFn(Browser); } catch (e) {
    if (isCancel(e)) throw e;
    try { return await apiFn(); } catch (e2) { throw isCancel(e2) ? e2 : e; }
  }
}
function importVacancy(hit, opts) {
  return viaMode(opts, function (B) { return B.vacancyByUrl(hit, opts); }, function () { return vacancyById(hit.id, opts); });
}
function findVacancies(params, opts) {
  return viaMode(opts, function (B) { return B.search(params, opts); }, function () { return search(params, opts); });
}
function importResume(raw, opts) {
  const hit = detect(raw);
  if (!hit || hit.kind !== 'resume') throw fail('unsupported_site', 'Это не ссылка на резюме hh.ru вида https://hh.ru/resume/…');
  return viaMode(opts, function (B) { return B.resumeByUrl(hit, opts); }, function () { return resumeByUrl(raw, opts); });
}

module.exports = { detect, vacancyById, toVacancy, search, areas, rank, queryFromResume, parseResumeHtml, resumeByUrl,
  mode, importVacancy, findVacancies, importResume, LIMITS, _cache: cache };
