/* Сервер «Карьерного помощника».

   Один процесс: отдаёт собранный index.html и API. Ключ провайдера
   модели живёт только в окружении этого процесса. Настройки — через
   переменные окружения, см. .env.example. */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const db = require('./lib/db.js');
const session = require('./lib/session.js');
const log = require('./lib/log.js');
const Router = require('./lib/router.js');
const api = require('./routes/api.js');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(file) {
  try {
    fs.readFileSync(file, 'utf8').split('\n').forEach(function (line) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* файла нет — работаем на переменных окружения */ }
}

function createApp(options) {
  const opts = options || {};
  loadEnvFile(opts.envFile || path.join(ROOT, '.env'));

  const cfg = {
    dbFile: opts.dbFile || process.env.DB_FILE || path.join(ROOT, 'data', 'app.sqlite'),
    freePrepsPerDay: opts.freePrepsPerDay !== undefined ? opts.freePrepsPerDay
      : (Number(process.env.FREE_PREPS_PER_DAY) || 1),
    secure: opts.secure !== undefined ? opts.secure : process.env.TRUST_PROXY === '1',
    staticDir: opts.staticDir || process.env.STATIC_DIR || ROOT
  };

  log.setLevel(process.env.LOG_LEVEL || 'info');
  db.open(cfg.dbFile);
  session.init(process.env.SESSION_SECRET);
  if (!process.env.SESSION_SECRET) {
    log.warn('SESSION_SECRET не задан: сессии сбросятся при перезапуске сервера');
  }

  const router = Router.create();
  api.register(router);

  const indexFile = path.join(cfg.staticDir, 'index.html');

  function serveStatic(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' || (url.pathname !== '/' && url.pathname !== '/index.html')) {
      Router.sendJson(res, 404, { error: 'Не найдено' });
      return;
    }
    fs.readFile(indexFile, function (err, data) {
      if (err) { Router.sendJson(res, 404, { error: 'index.html не собран: node build.js' }); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      res.end(data);
    });
  }

  /* Запросы, меняющие состояние, принимаются только со своего адреса. */
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
  }

  async function handle(req, res) {
    const started = Date.now();
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
        throw new Router.HttpError(403, 'Запрос с чужого адреса');
      }
      const cookies = Router.parseCookies(req.headers.cookie);
      const { session: current } = session.resolve(cookies, res, cfg.secure);
      const ctx = { session: current, freePrepsPerDay: cfg.freePrepsPerDay };
      const handled = await router.dispatch(req, res, ctx);
      if (handled === undefined && !res.headersSent) {
        if (req.url.indexOf('/api/') === 0) Router.sendJson(res, 404, { error: 'Нет такого маршрута' });
        else serveStatic(req, res);
      }
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) log.error('request.failed', { method: req.method, url: req.url, error: e.message, stack: e.stack });
      if (!res.headersSent) Router.sendJson(res, status, Object.assign({ error: e.message }, e.extra || {}));
      else res.end();
    } finally {
      log.debug('request', { method: req.method, url: req.url, ms: Date.now() - started });
    }
  }

  const server = http.createServer(handle);
  server.on('close', function () { db.close(); });
  return { server, cfg };
}

if (require.main === module) {
  const { server, cfg } = createApp();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, function () {
    log.info('server.started', { host, port, db: cfg.dbFile, freePrepsPerDay: cfg.freePrepsPerDay,
      ai: require('./lib/ai.js').describe() });
  });
  process.on('SIGTERM', function () { server.close(function () { process.exit(0); }); });
  process.on('SIGINT', function () { server.close(function () { process.exit(0); }); });
}

module.exports = { createApp };
