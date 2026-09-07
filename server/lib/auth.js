'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const db = require('./db.js');
const { HttpError } = require('./router.js');
const PARAMS = { N: 16384, r: 8, p: 1 };
const DUMMY = 'scrypt:' + '00'.repeat(16) + ':' + '00'.repeat(64);

function credentials(body, registering) {
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    throw new HttpError(400, 'Укажите имя пользователя и пароль.');
  }
  const username = body.username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
    throw new HttpError(400, 'Имя: 3–32 латинские буквы, цифры, дефис или подчёркивание.');
  }
  if (body.password.length < (registering ? 8 : 1) || body.password.length > 128) {
    throw new HttpError(400, registering ? 'Пароль: от 8 до 128 символов.' : 'Укажите пароль до 128 символов.');
  }
  return { username, password: body.password };
}

async function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, PARAMS);
  return 'scrypt:' + salt + ':' + key.toString('hex');
}

async function verify(password, encoded) {
  const parts = (encoded || DUMMY).split(':');
  const key = await scrypt(password, parts[1], 64, PARAMS);
  const expected = Buffer.from(parts[2], 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(key, expected) && !!encoded;
}

function publicUser(user) {
  return user ? { id: user.id, username: user.username, role: user.role, created_at: user.created_at } : null;
}

function validateDemoEnvironment(cfg) {
  if (cfg.demoAuth && (!['', 'development', 'test', 'local', 'demo'].includes(process.env.NODE_ENV || '')
      || !['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST || '127.0.0.1'))) {
    throw new Error('DEMO_AUTH requires a local non-production environment and a loopback HOST');
  }
}

function seedDemo(cfg) {
  validateDemoEnvironment(cfg);
  if (!cfg.demoAuth) return;
  // Never overwrite an existing account or promote its role.
  if (db.users.byUsername('admin')) return;
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync('admin', salt, 64, PARAMS);
  db.users.create('admin', 'scrypt:' + salt + ':' + key.toString('hex'), 'admin', true);
}

module.exports = { credentials, hash, verify, publicUser, seedDemo, validateDemoEnvironment };
