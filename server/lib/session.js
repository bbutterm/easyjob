/* Анонимная сессия по cookie. Вход по почте — позже, когда будет что
   восстанавливать. Cookie подписана, чтобы нельзя было подставить чужой
   идентификатор, зная его формат. */

'use strict';

const crypto = require('node:crypto');
const db = require('./db.js');

const COOKIE = 'ch_session';
const YEAR = 365 * 24 * 3600;

let secret = '';

function init(value) {
  secret = value || crypto.randomBytes(32).toString('hex');
}

function sign(id) {
  return id + '.' + crypto.createHmac('sha256', secret).update(id).digest('base64url');
}

function verify(value) {
  if (!value) return null;
  const i = value.lastIndexOf('.');
  if (i < 0) return null;
  const id = value.slice(0, i);
  const expected = sign(id);
  if (expected.length !== value.length) return null;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(value)) ? id : null;
}

function cookieHeader(id, secure) {
  return COOKIE + '=' + encodeURIComponent(sign(id)) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + YEAR
    + (secure ? '; Secure' : '');
}

/* Возвращает существующую сессию или создаёт новую. Заголовок Set-Cookie
   выставляется только при создании. */
function resolve(cookies, res, secure, ipHash) {
  const id = verify(cookies[COOKIE]);
  let session = id ? db.sessions.get(id) : null;
  let created = false;
  if (!session) {
    session = db.sessions.create(ipHash);
    created = true;
    res.setHeader('set-cookie', cookieHeader(session.id, secure));
  } else {
    db.sessions.touch(session.id);
    if (ipHash && !session.ip_hash) { db.sessions.touchIp(session.id, ipHash); session.ip_hash = ipHash; }
  }
  return { session, created };
}

/* Хэш адреса с секретом: сам адрес в базе не хранится. */
function hashAddress(address) {
  return crypto.createHmac('sha256', secret).update('ip:' + String(address || '')).digest('base64url').slice(0, 24);
}

function clearCookieHeader(secure) {
  return COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '');
}

module.exports = { init, resolve, hashAddress, clearCookieHeader, COOKIE, sign, verify };
