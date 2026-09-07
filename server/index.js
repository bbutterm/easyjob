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
const admin = require('./routes/admin.js');
const auth = require('./lib/auth.js');
const retention = require('./lib/retention.js');
const { createLimiter, clientAddress } = require('./lib/ratelimit.js');

/* Маршруты, которые вызывают модель: считаются отдельно и строже. */
const EXPENSIVE = /^\/api\/(preps(\/[^/]+\/(rebuild|questions|card|interviews))?|resumes\/[^/]+\/review|vacancies|interviews\/[^/]+\/(turns|continue|finish))\/?$/;

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
    demoAuth: process.env.DEMO_AUTH === '1',
    dbFile: opts.dbFile || process.env.DB_FILE || path.join(ROOT, 'data', 'app.sqlite'),
    freePrepsPerDay: opts.freePrepsPerDay !== undefined ? opts.freePrepsPerDay
      : (Number(process.env.FREE_PREPS_PER_DAY) || 1),
    secure: opts.secure !== undefined ? opts.secure : process.env.TRUST_PROXY === '1',
    staticDir: opts.staticDir || process.env.STATIC_DIR || ROOT,
    adminToken: opts.adminToken !== undefined ? opts.adminToken : (process.env.ADMIN_TOKEN || ''),
    retentionDays: opts.retentionDays !== undefined ? opts.retentionDays
      : (Number(process.env.DATA_RETENTION_DAYS) || 90),
    rateLimit: Object.assign({ perMinute: 120, expensivePerMinute: 12 }, opts.rateLimit || {})
  };
  if (process.env.RATE_LIMIT_PER_MINUTE) cfg.rateLimit.perMinute = Number(process.env.RATE_LIMIT_PER_MINUTE);
  if (process.env.RATE_LIMIT_EXPENSIVE_PER_MINUTE) cfg.rateLimit.expensivePerMinute = Number(process.env.RATE_LIMIT_EXPENSIVE_PER_MINUTE);
  if (process.env.RATE_LIMIT_SESSIONS_PER_HOUR) cfg.rateLimit.sessionsPerHour = Number(process.env.RATE_LIMIT_SESSIONS_PER_HOUR);

  auth.validateDemoEnvironment(cfg);
  if (['admin', 'admin/admin'].includes(cfg.adminToken)) {
    throw new Error('ADMIN_TOKEN must be an independent random secret, never demo credentials');
  }
  log.setLevel(process.env.LOG_LEVEL || 'info');
  const dbHandle = db.open(cfg.dbFile);
  auth.seedDemo(cfg);
  session.init(process.env.SESSION_SECRET);
  if (!process.env.SESSION_SECRET) {
    log.warn('SESSION_SECRET не задан: сессии сбросятся при перезапуске сервера');
  }

  const router = Router.create();
  api.register(router);
  require('./routes/auth.js').register(router);
  admin.register(router, cfg);

  const ipLimiter = createLimiter({ windowMs: 60000, max: cfg.rateLimit.perMinute });
  const authLimiter = createLimiter({ windowMs: 60000, max: cfg.rateLimit.authPerMinute || 10 });
  const expensiveLimiter = createLimiter({ windowMs: 60000, max: cfg.rateLimit.expensivePerMinute });
  /* Новые сессии с одного адреса: иначе сброс cookie обнуляет лимиты. */
  const sessionLimiter = createLimiter({ windowMs: 3600000, max: cfg.rateLimit.sessionsPerHour || 60 });
  const retentionTimer = opts.retention === false ? null : retention.schedule(cfg.retentionDays);

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
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
        /* Страница собрана в один файл со встроенными скриптами и стилями,
           поэтому inline разрешён; всё остальное — только с этого адреса. */
        'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; "
          + "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; "
          + "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
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
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('referrer-policy', 'no-referrer');
      res.setHeader('x-frame-options', 'DENY');

      /* Путь нормализуется один раз: сегменты вроде /../ в сыром адресе
         не должны отличать проверку лимитов от выбора маршрута. */
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const address = clientAddress(req, cfg.secure);
      const isApi = pathname.indexOf('/api/') === 0;
      if (isApi) {
        const byIp = ipLimiter.hit(address);
        if (!byIp.allowed) {
          res.setHeader('retry-after', String(byIp.retryAfterSec));
          throw new Router.HttpError(429, 'Слишком много запросов. Подождите ' + byIp.retryAfterSec + ' с.');
        }
      }

      /* Страница отдаётся без сессии: она создаётся при первом обращении
         к API. Иначе каждый заход на сайт из общей сети расходовал бы
         лимит новых сессий. */
      if (!isApi) { serveStatic(req, res); return; }

      if (req.method === 'POST' && /^\/api\/auth\/(login|register)\/?$/.test(pathname)) {
        const attempt = authLimiter.hit(address);
        if (!attempt.allowed) {
          res.setHeader('retry-after', String(attempt.retryAfterSec));
          throw new Router.HttpError(429, 'Слишком много попыток входа. Повторите через минуту.');
        }
      }
      const cookies = Router.parseCookies(req.headers.cookie);
      const ipHash = session.hashAddress(address);
      if (!session.verify(cookies[session.COOKIE])) {
        const newSessions = sessionLimiter.hit(address);
        if (!newSessions.allowed) {
          res.setHeader('retry-after', String(newSessions.retryAfterSec));
          throw new Router.HttpError(429, 'Слишком много новых сессий с этого адреса.');
        }
      }
      let { session: current } = session.resolve(cookies, res, cfg.secure, ipHash);
      const account = current.user_id ? db.users.get(current.user_id) : null;
      if (account && account.is_demo && !cfg.demoAuth) {
        db.sessions.rotate(current.id, current.user_id, ipHash);
        current = session.resolve({}, res, cfg.secure, ipHash).session;
      }
      const ctx = { session: current, ipHash, freePrepsPerDay: cfg.freePrepsPerDay, secure: cfg.secure, demoAuth: cfg.demoAuth };

      if (isApi && req.method === 'POST' && EXPENSIVE.test(pathname)) {
        const bySession = expensiveLimiter.hit(current.id);
        if (!bySession.allowed) {
          res.setHeader('retry-after', String(bySession.retryAfterSec));
          throw new Router.HttpError(429, 'Слишком частые запросы к модели. Подождите ' + bySession.retryAfterSec + ' с.');
        }
      }
      const handled = await router.dispatch(req, res, ctx);
      if (handled === undefined && !res.headersSent) Router.sendJson(res, 404, { error: 'Нет такого маршрута' });
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
  server.on('close', function () {
    ipLimiter.stop(); authLimiter.stop(); expensiveLimiter.stop(); sessionLimiter.stop();
    if (retentionTimer) clearInterval(retentionTimer);
    db.closeIf(dbHandle);
  });
  return { server, cfg };
}

if (require.main === module) {
  const { server, cfg } = createApp();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, function () {
    log.info('server.started', { host, port, db: cfg.dbFile, freePrepsPerDay: cfg.freePrepsPerDay,
      retentionDays: cfg.retentionDays, rateLimit: cfg.rateLimit, admin: !!cfg.adminToken,
      ai: require('./lib/ai.js').describe() });
  });
  process.on('SIGTERM', function () { server.close(function () { process.exit(0); }); });
  process.on('SIGINT', function () { server.close(function () { process.exit(0); }); });
}

module.exports = { createApp };
