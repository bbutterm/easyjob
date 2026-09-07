/* Storage, migrations and real route handlers without requiring a listening socket. */
'use strict';
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { mkdtempSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../server/lib/db.js');
const auth = require('../server/lib/auth.js');
const session = require('../server/lib/session.js');
const Router = require('../server/lib/router.js');
const { createApp } = require('../server/index.js');

process.env.NODE_ENV = 'test';
process.env.HOST = '127.0.0.1';
process.env.DEMO_AUTH = '0';
process.env.ADMIN_TOKEN = '';
process.env.SESSION_SECRET = 'auth-tests-only';
process.env.LOG_LEVEL = 'error';
process.env.AI_PROVIDER = 'mock';

async function run() {
  const dir = mkdtempSync(path.join(tmpdir(), 'easyjob-auth-'));
  try {
    const file = path.join(dir, 'migration.sqlite');
    const legacy = new DatabaseSync(file);
    legacy.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, paid_until INTEGER DEFAULT 0)');
    legacy.exec("INSERT INTO sessions VALUES ('legacy', 1, 1, 0)");
    legacy.close();
    db.open(file);
    assert.equal(db.sessions.get('legacy').user_id, null);
    auth.seedDemo({ demoAuth: false });
    assert.equal(db.users.byUsername('admin'), null);
    auth.seedDemo({ demoAuth: true });
    const seeded = db.users.byUsername('admin');
    assert.equal(await auth.verify('admin', seeded.password_hash), true);
    db.close();
    db.open(file);
    auth.seedDemo({ demoAuth: true });
    assert.deepEqual(db.users.byUsername('ADMIN'), seeded);
    assert.equal(db.sessions.get('legacy').id, 'legacy');
    console.log('PASS migration preserves legacy sessions; demo seed is opt-in and idempotent across reopen');

    const router = Router.create();
    require('../server/routes/auth.js').register(router);
    require('../server/routes/api.js').register(router);
    session.init('auth-tests-only');
    const guest = db.sessions.create('test-ip');
    let currentId = guest.id;
    async function call(method, url, body) {
      const req = Readable.from([Buffer.from(JSON.stringify(body || {}))]);
      req.method = method; req.url = url;
      req.headers = { 'content-type': 'application/json' };
      const out = { headers: {} };
      const res = {
        setHeader(k, v) { out.headers[k] = v; },
        writeHead(status, headers) { out.status = status; Object.assign(out.headers, headers); },
        end(text) { out.data = JSON.parse(text); }
      };
      const ctx = { session: db.sessions.get(currentId), secure: false, ipHash: 'test-ip', freePrepsPerDay: 1 };
      try { await router.dispatch(req, res, ctx); }
      catch (e) { if (!e.status) throw e; out.status = e.status; }
      const cookie = out.headers['set-cookie'];
      if (cookie && !cookie.includes('Max-Age=0')) currentId = session.verify(decodeURIComponent(cookie.split(';')[0].split('=')[1]));
      return out;
    }
    assert.equal((await call('POST', '/api/auth/register', null)).status, 400);
    assert.equal((await call('POST', '/api/auth/register', { username: 'bad name', password: 'long-password' })).status, 400);
    assert.equal((await call('POST', '/api/auth/register', { username: 'valid', password: 'short' })).status, 400);
    const guestResume = db.resumes.create(guest.id, 'Guest work', { profession: 'Designer' });
    const registered = await call('POST', '/api/auth/register', { username: 'Alice', password: 'correct horse', role: 'admin' });
    assert.equal(registered.status, 201);
    assert.equal(registered.data.user.role, 'user');
    assert.equal(registered.data.user.username, 'alice');
    assert.equal(registered.data.user.password_hash, undefined);
    assert.match(registered.headers['set-cookie'], /HttpOnly; SameSite=Lax/);
    assert.notEqual(currentId, guest.id);
    assert.equal(db.sessions.get(guest.id), null);
    assert.equal(db.resumes.get(currentId, guestResume.id).title, 'Guest work');
    assert.equal((await call('GET', '/api/me')).data.user.username, 'alice');
    const hash = db.users.byUsername('alice').password_hash;
    assert.match(hash, /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
    assert.notEqual(hash, await auth.hash('correct horse'));
    assert.equal(await auth.verify('wrong', hash), false);
    assert.equal(await auth.verify('anything', null), false);
    console.log('PASS validation, registration, scrypt salt/hash, role safety, guest data and authenticated /api/me');

    const loggedInId = currentId;
    assert.equal((await call('POST', '/api/auth/logout')).status, 200);
    assert.equal(db.sessions.get(loggedInId), null);
    currentId = db.sessions.create('test-ip').id;
    assert.equal((await call('GET', '/api/me')).data.user, null);
    assert.equal((await call('POST', '/api/auth/register', { username: 'ALICE', password: 'correct horse' })).status, 409);
    assert.equal((await call('POST', '/api/auth/login', { username: 'alice', password: 'wrong' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { username: 'unknown', password: 'wrong' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { username: 'alice', password: 'correct horse' })).status, 200);
    assert.equal(db.resumes.get(currentId, guestResume.id).title, 'Guest work');
    const beforeLogin = currentId;
    assert.equal((await call('POST', '/api/auth/login', { username: 'alice', password: 'correct horse' })).status, 200);
    assert.equal(db.sessions.get(beforeLogin), null);
    assert.equal((await call('GET', '/api/me')).data.user.username, 'alice');
    console.log('PASS wrong password/unknown user rejection, case-insensitive uniqueness, logout invalidation and login restores work');

    process.env.NODE_ENV = 'production';
    assert.throws(() => auth.seedDemo({ demoAuth: true }), /non-production/);
    db.close();
    process.env.DEMO_AUTH = '1';
    const prodFile = path.join(dir, 'production.sqlite');
    assert.throws(() => createApp({ dbFile: prodFile, retention: false }), /non-production/);
    assert.equal(existsSync(prodFile), false);
    process.env.DEMO_AUTH = '0';
    const prod = createApp({ dbFile: prodFile, retention: false });
    assert.equal(db.users.byUsername('admin'), null);
    await new Promise(resolve => prod.server.close(resolve));
    process.env.NODE_ENV = 'test';
    process.env.DEMO_AUTH = '1';
    process.env.HOST = '0.0.0.0';
    assert.throws(() => createApp({ dbFile: ':memory:', retention: false }), /loopback/);
    process.env.HOST = '127.0.0.1';
    assert.throws(() => createApp({ dbFile: ':memory:', adminToken: 'admin', retention: false }), /independent random secret/);
    console.log('PASS production refuses demo before opening DB; production without demo has no admin; non-local host and demo ADMIN_TOKEN rejected');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
