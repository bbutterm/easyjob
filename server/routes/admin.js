/* Маршруты владельца. Доступ по токену ADMIN_TOKEN в заголовке
   Authorization: Bearer <токен>. Usage также доступен роли admin из базы.
   Содержимого резюме и ответов здесь нет — только счётчики. */

'use strict';

const crypto = require('node:crypto');
const db = require('../lib/db.js');
const retention = require('../lib/retention.js');
const { HttpError, sendJson } = require('../lib/router.js');

function authorized(req, token) {
  if (!token) return false;
  const header = String(req.headers.authorization || '');
  if (header.indexOf('Bearer ') !== 0) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function register(r, cfg) {
  function guard(req) {
    if (!cfg.adminToken) throw new HttpError(404, 'Не найдено');
    if (!authorized(req, cfg.adminToken)) throw new HttpError(401, 'Нужен токен владельца');
  }

  r.get('/api/admin/usage', function ({ req, res, query, ctx }) {
    const user = ctx && ctx.session && db.users.get(ctx.session.user_id || '');
    if (!authorized(req, cfg.adminToken) && (!user || user.role !== 'admin')) {
      throw new HttpError(user ? 403 : 401, 'Доступ запрещён');
    }
    const value = query.get('days');
    if (value !== null && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 365)) throw new HttpError(400, 'Период: от 1 до 365 дней');
    const days = value === null ? 30 : Number(value);
    sendJson(res, 200, db.usage.summary(days));
  });

  r.post('/api/admin/retention/run', function ({ req, res }) {
    guard(req);
    sendJson(res, 200, retention.cleanup(cfg.retentionDays));
  });
}

module.exports = { register };
