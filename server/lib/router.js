/* Маршрутизатор на встроенном http без внешних зависимостей.
   Умеет ровно то, что нужно: метод, путь с параметрами, JSON-тело
   с ограничением размера, cookie, единый формат ошибок. */

'use strict';

const MAX_BODY = 512 * 1024;

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}

function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, function (m, key) {
    keys.push(key);
    return '/([^/]+)';
  }) + '/?$');
  return { re, keys };
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Слишком большой запрос: не более ' + Math.round(MAX_BODY / 1024) + ' КБ'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function create() {
  const routes = [];

  function add(method, pattern, handler) {
    const c = compile(pattern);
    routes.push({ method, re: c.re, keys: c.keys, handler });
  }

  async function dispatch(req, res, ctx) {
    const url = new URL(req.url, 'http://localhost');
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const m = route.re.exec(url.pathname);
      if (!m) continue;
      const params = {};
      route.keys.forEach(function (key, i) { params[key] = decodeURIComponent(m[i + 1]); });

      let body = null;
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const type = String(req.headers['content-type'] || '');
        const length = Number(req.headers['content-length'] || 0);
        if (!type && !length) {
          /* Запрос без тела — допустимо для действий вроде «собрать вопросы». */
          body = {};
        } else {
          if (type.indexOf('application/json') < 0) throw new HttpError(415, 'Ожидается application/json');
          const raw = await readBody(req);
          try { body = raw ? JSON.parse(raw) : {}; } catch (e) { throw new HttpError(400, 'Тело запроса — не JSON'); }
        }
      }
      return route.handler({
        req, res, params, body, query: url.searchParams,
        cookies: parseCookies(req.headers.cookie), ctx
      });
    }
    return undefined;
  }

  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    del: (p, h) => add('DELETE', p, h),
    dispatch
  };
}

function sendJson(res, status, payload, headers) {
  const text = JSON.stringify(payload);
  res.writeHead(status, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }, headers || {}));
  res.end(text);
}

module.exports = { create, sendJson, HttpError, parseCookies };
