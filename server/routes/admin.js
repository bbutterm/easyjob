/* Маршруты владельца. Доступ по токену ADMIN_TOKEN в заголовке
   Authorization: Bearer <токен>. Без токена в настройках маршруты выключены.
   Содержимого резюме и ответов здесь нет — только счётчики. */

'use strict';

const crypto = require('node:crypto');
const db = require('../lib/db.js');
const ai = require('../lib/ai.js');
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

  r.get('/api/admin/usage', function ({ req, res, query }) {
    guard(req);
    const days = Math.min(365, Math.max(1, Number(query.get('days')) || 30));
    sendJson(res, 200, Object.assign({ days, ai: ai.describe() }, db.usage.summary(days)));
  });

  r.post('/api/admin/retention/run', function ({ req, res }) {
    guard(req);
    sendJson(res, 200, retention.cleanup(cfg.retentionDays));
  });
}

module.exports = { register };
