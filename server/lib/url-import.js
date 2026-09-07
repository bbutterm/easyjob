/* Получение вакансии по публичной ссылке.

   Это сетевая функция сервера, поэтому главное здесь — не содержимое, а
   границы: сервер не должен стать прокси во внутреннюю сеть (SSRF) и не
   должен читать бесконечные или бинарные ответы.

   Правила:
   - только http и https, без логина и пароля в адресе, порты 80/443;
   - имя хоста разрешается в адреса заранее; loopback, link-local,
     частные (RFC1918, CGNAT), multicast и IPv6-аналоги отклоняются;
     соединение идёт на проверенный адрес (lookup закреплён), поэтому
     подмена DNS между проверкой и соединением не работает;
   - не больше 3 переходов, каждый адрес перехода проверяется заново;
   - предел времени на весь запрос, предел байтов на тело (и после
     распаковки gzip), только HTML или текст;
   - куки и заголовки пользователя на сайт не передаются;
   - скрипты не выполняются: JSON-LD читается как данные, разметка
     превращается в текст;
   - параметры-токены в сохранённом адресе вырезаются.

   Доступ к частным адресам возможен только через явный список
   URL_IMPORT_ALLOW_HOSTS (для проверок и разработки), не через флаг
   «разрешить всё». */

'use strict';

const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const net = require('node:net');
const dns = require('node:dns').promises;
const { HttpError } = require('./router.js');

const LIMITS = { redirects: 3, timeoutMs: 12000, maxBytes: 2 * 1024 * 1024, maxText: 40000, minText: 120 };
const USER_AGENT = 'EasyjobVacancyImport/1.0 (+https://github.com/bbutterm/easyjob)';

function fail(code, message, status) {
  return new HttpError(status || 422, message, { ok: false, code });
}

/* ---- Адреса ---- */

function ipv4Private(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(function (n) { return !(n >= 0 && n <= 255); })) return true;
  if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;   /* CGNAT */
  if (p[0] === 169 && p[1] === 254) return true;                  /* link-local, metadata */
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 192 && p[1] === 0 && (p[2] === 0 || p[2] === 2)) return true;
  if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
  if (p[0] === 198 && p[1] === 51 && p[2] === 100) return true;
  if (p[0] === 203 && p[1] === 0 && p[2] === 113) return true;
  if (p[0] >= 224) return true;                                   /* multicast, reserved, broadcast */
  return false;
}

function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return ipv4Private(ip);
  if (v !== 6) return true;
  const low = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (low === '::' || low === '::1') return true;
  /* IPv4, вложенный в IPv6 (::ffff:a.b.c.d, NAT64 64:ff9b::), проверяется как IPv4. */
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(low) || /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(low);
  if (mapped) return ipv4Private(mapped[1]);
  const hexMapped = /^(?:::ffff|64:ff9b:):([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(low);
  if (hexMapped) {
    const a = parseInt(hexMapped[1], 16), b = parseInt(hexMapped[2], 16);
    return ipv4Private([a >> 8, a & 255, b >> 8, b & 255].join('.'));
  }
  const first = parseInt(low.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true;   /* fc00::/7 unique local */
  if ((first & 0xffc0) === 0xfe80) return true;   /* fe80::/10 link-local */
  if ((first & 0xff00) === 0xff00) return true;   /* ff00::/8 multicast */
  if (first === 0x2001 && /^2001:db8:/.test(low)) return true;
  return false;
}

/* Явный список хостов, которым разрешён частный адрес (проверки, разработка). */
function allowedHosts(env) {
  return String((env || process.env).URL_IMPORT_ALLOW_HOSTS || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
}

function hostKey(url) {
  return url.hostname.toLowerCase() + (url.port ? ':' + url.port : '');
}

/* Проверка адреса до сети: схема, учётные данные, хост, порт. */
function validateUrl(raw, env) {
  const text = String(raw || '').trim();
  if (!text || text.length > 2048) throw fail('private_url', 'Укажите ссылку на страницу вакансии.', 400);
  let url;
  try { url = new URL(text); } catch (e) { throw fail('private_url', 'Ссылка не распознана. Нужен адрес вида https://сайт/вакансия.', 400); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw fail('private_url', 'Поддерживаются только ссылки http и https.', 400);
  if (url.username || url.password) throw fail('private_url', 'Ссылка с логином и паролем не принимается.', 400);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowed = allowedHosts(env).indexOf(hostKey(url)) >= 0;
  if (!allowed) {
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
      || host.endsWith('.home.arpa') || host.indexOf('.') < 0) {
      throw fail('private_url', 'Внутренние и локальные адреса не импортируются.', 400);
    }
    if (net.isIP(host.replace(/^\[|\]$/g, '')) && isPrivateIp(host.replace(/^\[|\]$/g, ''))) {
      throw fail('private_url', 'Внутренние и локальные адреса не импортируются.', 400);
    }
    if (url.port && url.port !== '80' && url.port !== '443') {
      throw fail('private_url', 'Нестандартный порт в ссылке не поддерживается.', 400);
    }
  }
  url.hash = '';
  return { url, allowed };
}

/* Разрешить имя и проверить все адреса: один частный — отказ целиком. */
async function resolveTarget(url, opts) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return { address: host, family: net.isIP(host) };
  const lookup = (opts && opts.lookup) || function (h) { return dns.lookup(h, { all: true, verbatim: true }); };
  let addresses;
  try {
    addresses = await lookup(host);
  } catch (e) {
    throw fail('unsupported_site', 'Сайт не найден: проверьте адрес.');
  }
  if (!Array.isArray(addresses) || !addresses.length) throw fail('unsupported_site', 'Сайт не найден: проверьте адрес.');
  if (!(opts && opts.allowed) && addresses.some(function (a) { return isPrivateIp(a.address); })) {
    throw fail('private_url', 'Адрес сайта указывает во внутреннюю сеть: импорт запрещён.', 400);
  }
  return { address: addresses[0].address, family: addresses[0].family || net.isIP(addresses[0].address) };
}

/* ---- Сеть ---- */

/* Один HTTP-запрос на закреплённый адрес: без переходов, с пределами
   времени и размера; gzip и deflate распаковываются с тем же пределом. */
function fetchOnce(url, target, deadline, opts) {
  return new Promise(function (resolve, reject) {
    const mod = url.protocol === 'https:' ? https : http;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(fail('timeout', 'Сайт не ответил вовремя. Вставьте текст вакансии вручную.', 504));
    const connectAddress = (opts && opts.connectAddress) || target.address;
    const req = mod.request(url, {
      method: 'GET',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5,*/*;q=0.1',
        'accept-language': 'ru,en;q=0.7',
        'accept-encoding': 'gzip, deflate'
      },
      lookup: function (hostname, options, cb) {
        /* Соединение только на проверенный адрес: имя не разрешается повторно. */
        if (options && options.all) cb(null, [{ address: connectAddress, family: target.family || 4 }]);
        else cb(null, connectAddress, target.family || 4);
      },
      timeout: Math.min(remaining, LIMITS.timeoutMs)
    }, function (res) {
      const status = res.statusCode || 0;
      const type = String(res.headers['content-type'] || '').toLowerCase();
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        return resolve({ status, redirect: location });
      }
      const length = Number(res.headers['content-length'] || 0);
      if (length > LIMITS.maxBytes) { res.destroy(); return reject(fail('too_large', 'Страница слишком большая для импорта.')); }
      if (status >= 200 && status < 300 && !/text\/html|application\/xhtml\+xml|text\/plain/.test(type)) {
        res.destroy();
        return reject(fail('unsupported_site', 'По ссылке не HTML-страница. Вставьте текст вакансии вручную.'));
      }
      const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (encoding === 'gzip' || encoding === 'deflate') {
        const inflate = encoding === 'gzip' ? zlib.createGunzip() : zlib.createInflate();
        inflate.on('error', function () { finish(fail('unsupported_site', 'Не удалось прочитать ответ сайта.')); });
        stream = res.pipe(inflate);
      }
      const chunks = [];
      let size = 0;
      let done = false;
      const finish = function (err, result) {
        if (done) return;
        done = true;
        if (err) { res.destroy(); reject(err); } else resolve(result);
      };
      stream.on('data', function (chunk) {
        size += chunk.length;
        if (size > LIMITS.maxBytes) return finish(fail('too_large', 'Страница слишком большая для импорта.'));
        chunks.push(chunk);
      });
      stream.on('end', function () { finish(null, { status, type, body: Buffer.concat(chunks), headers: res.headers }); });
      stream.on('error', function () { finish(fail('unsupported_site', 'Соединение с сайтом прервалось.')); });
      const timer = setTimeout(function () { finish(fail('timeout', 'Сайт не ответил вовремя. Вставьте текст вакансии вручную.', 504)); }, remaining);
      stream.on('close', function () { clearTimeout(timer); });
    });
    req.on('timeout', function () { req.destroy(fail('timeout', 'Сайт не ответил вовремя. Вставьте текст вакансии вручную.', 504)); });
    req.on('error', function (e) {
      reject(e instanceof HttpError ? e : fail('unsupported_site', 'Не удалось соединиться с сайтом. Вставьте текст вакансии вручную.'));
    });
    req.end();
  });
}

/* Загрузка с переходами: каждый адрес перехода проверяется как первый. */
async function download(raw, opts) {
  const o = opts || {};
  const deadline = Date.now() + (o.timeoutMs || LIMITS.timeoutMs);
  let current = validateUrl(raw, o.env);
  for (let hop = 0; hop <= LIMITS.redirects; hop++) {
    const target = await resolveTarget(current.url, { lookup: o.lookup, allowed: current.allowed });
    const res = await fetchOnce(current.url, target, deadline, o);
    if (res.redirect !== undefined) {
      if (hop === LIMITS.redirects) throw fail('blocked', 'Слишком много переходов по ссылке.');
      let next;
      try { next = new URL(res.redirect, current.url).href; } catch (e) { throw fail('unsupported_site', 'Сайт вернул некорректный переход.'); }
      current = validateUrl(next, o.env);
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503 || res.status === 999) {
      throw fail('blocked', 'Сайт не разрешил автоматическое чтение. Вставьте текст вакансии вручную.');
    }
    if (res.status === 404 || res.status === 410) throw fail('not_job_page', 'Страница не найдена. Проверьте ссылку.');
    if (res.status < 200 || res.status >= 300) throw fail('unsupported_site', 'Сайт ответил ошибкой (код ' + res.status + ').');
    return { url: current.url, type: res.type, body: res.body };
  }
  throw fail('blocked', 'Слишком много переходов по ссылке.');
}

/* ---- Разбор HTML без выполнения скриптов ---- */

function decodeBody(body, type) {
  let charset = (/charset=([\w-]+)/i.exec(type) || [])[1];
  if (!charset) {
    const head = body.subarray(0, 4096).toString('latin1');
    charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  }
  charset = (charset || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset === 'cp1251' ? 'windows-1251' : charset).decode(body);
  } catch (e) {
    return body.toString('utf8');
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, code) {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] !== undefined ? ENTITIES[code.toLowerCase()] : m;
  });
}

/* Разметка → текст: блочные теги дают переводы строк, остальное убирается. */
function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|template|svg|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|ul|ol|dl|dd|dt|blockquote|pre|table|header|footer)>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '— ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

function stripChrome(html) {
  /* Навигация, шапка, подвал, боковые блоки и формы — не вакансия. */
  return String(html).replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
}

function mainBlock(html) {
  const m = /<main\b[\s\S]*?<\/main>/i.exec(html) || /<article\b[\s\S]*?<\/article>/i.exec(html);
  return m ? m[0] : null;
}

function meta(html, name) {
  const re = new RegExp('<meta\\s+[^>]*(?:property|name)=["\']' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>', 'i');
  const tag = re.exec(html);
  if (!tag) return '';
  const content = /content=["']([^"']*)["']/i.exec(tag[0]);
  return content ? decodeEntities(content[1]).trim() : '';
}

function findJobPosting(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) { const f = findJobPosting(node[i]); if (f) return f; }
    return null;
  }
  const type = node['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.indexOf('JobPosting') >= 0)) return node;
  if (node['@graph']) return findJobPosting(node['@graph']);
  return null;
}

function jsonLd(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch (e) { continue; }
    const job = findJobPosting(data);
    if (job) return job;
  }
  return null;
}

function plain(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return htmlToText(v);
  if (Array.isArray(v)) return v.map(plain).filter(Boolean).join(', ');
  if (typeof v === 'object') return plain(v.name || v.text || v['@value'] || '');
  return String(v);
}

/* Параметры-токены в адресе не хранятся и не показываются. */
function redactUrl(url) {
  const u = new URL(url.href || url);
  const keys = [];
  u.searchParams.forEach(function (v, k) { if (/token|key|auth|session|sig|secret|pass|utm_|fbclid|gclid|yclid/i.test(k)) keys.push(k); });
  keys.forEach(function (k) { u.searchParams.delete(k); });
  u.username = ''; u.password = ''; u.hash = '';
  return u.href;
}

function cut(s, n) { return String(s || '').slice(0, n); }

/* Разбор страницы: JSON-LD JobPosting → мета-теги и заголовки → основной текст. */
function extract(html, url) {
  const text = String(html || '');
  const job = jsonLd(text);
  const stripped = stripChrome(text);
  const main = mainBlock(stripped);
  const bodyText = htmlToText(main || stripped);
  const titleTag = htmlToText((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [])[1] || '');
  const h1 = htmlToText((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(stripped) || [])[1] || '');
  const ogTitle = meta(text, 'og:title');
  const site = meta(text, 'og:site_name');
  const host = url ? new URL(url.href || url).hostname.replace(/^www\./, '') : '';

  let title = '', company = '', rawText = '', source = 'html';
  if (job) {
    source = 'jsonld';
    title = plain(job.title);
    company = plain(job.hiringOrganization) || '';
    const parts = [];
    const desc = plain(job.description);
    if (desc) parts.push(desc);
    ['responsibilities', 'qualifications', 'skills', 'experienceRequirements', 'educationRequirements', 'employmentType', 'baseSalary']
      .forEach(function (k) { const v = plain(job[k]); if (v) parts.push(labelFor(k) + ': ' + v); });
    const loc = plain(job.jobLocation && (job.jobLocation.address || job.jobLocation));
    if (loc) parts.push('Местоположение: ' + loc);
    rawText = parts.join('\n\n');
  }
  if (!title) {
    title = ogTitle || h1 || titleTag;
    if (title) title = title.split(/\s[|—–-]\s/)[0].trim();
    if (source !== 'jsonld' && ogTitle) source = 'meta';
  }
  if (!company) company = site || host;
  if (!rawText) rawText = bodyText;
  /* Структурированные данные вакансии могут быть короткими и при этом
     полными; для разметки без них порог выше — иначе «пустая» страница
     со скриптом сойдёт за вакансию. */
  if (rawText.length < (source === 'jsonld' ? 40 : LIMITS.minText)) {
    throw fail('empty_content', 'На странице не нашлось текста вакансии: возможно, он подгружается скриптом. Вставьте текст вручную.');
  }
  let truncated = false;
  if (rawText.length > LIMITS.maxText) { rawText = rawText.slice(0, LIMITS.maxText); truncated = true; }
  return {
    sourceUrl: url ? redactUrl(url) : '',
    title: cut(title, 200), company: cut(company, 200), rawText,
    source, retrievedAt: Date.now(),
    needsReview: source !== 'jsonld' || truncated,
    truncated
  };
}

function labelFor(k) {
  return { responsibilities: 'Обязанности', qualifications: 'Требования', skills: 'Навыки', experienceRequirements: 'Опыт',
    educationRequirements: 'Образование', employmentType: 'Занятость', baseSalary: 'Оплата' }[k] || k;
}

async function importUrl(raw, opts) {
  const got = await download(raw, opts);
  const html = decodeBody(got.body, got.type);
  if (/text\/plain/.test(got.type) && !/<[a-z][\s\S]*>/i.test(html.slice(0, 2000))) {
    const rawText = htmlToText(html);
    if (rawText.length < LIMITS.minText) throw fail('empty_content', 'По ссылке пустой текст. Вставьте текст вакансии вручную.');
    return { sourceUrl: redactUrl(got.url), title: '', company: got.url.hostname.replace(/^www\./, ''),
      rawText: rawText.slice(0, LIMITS.maxText), source: 'text', retrievedAt: Date.now(), needsReview: true, truncated: rawText.length > LIMITS.maxText };
  }
  return extract(html, got.url);
}

module.exports = { importUrl, download, extract, validateUrl, isPrivateIp, resolveTarget, htmlToText, redactUrl, LIMITS };
