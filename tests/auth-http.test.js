'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/index.js');
const db = require('../server/lib/db.js');

Object.assign(process.env, { NODE_ENV: 'test', HOST: '127.0.0.1', DEMO_AUTH: '1', AI_PROVIDER: 'mock',
  SESSION_SECRET: 'auth-http-test-secret', ADMIN_TOKEN: '', LOG_LEVEL: 'error' });

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyjob-auth-http-'));
  const dbFile = path.join(dir, 'demo.sqlite');
  let server;
  try {
    async function start(authPerMinute = 100) {
      server = createApp({ dbFile, retention: false, secure: false, rateLimit: { authPerMinute } }).server;
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      return 'http://127.0.0.1:' + server.address().port;
    }
    let base = await start();
    let cookie = '';
    async function call(method, route, body, overrideCookie) {
      const res = await fetch(base + route, { method,
        headers: { 'content-type': 'application/json', origin: base, cookie: overrideCookie === undefined ? cookie : overrideCookie },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (overrideCookie === undefined && res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      return { status: res.status, data: await res.json(), headers: res.headers };
    }
    assert.equal((await call('GET', '/api/me')).data.user, null);
    const anonCookie = cookie;
    const login = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin' });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.role, 'admin');
    assert.notEqual(cookie, anonCookie);
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    assert.equal((await call('GET', '/api/me')).data.user.username, 'admin');
    assert.equal((await call('GET', '/api/admin/usage')).status, 200); // Database admin role works without ADMIN_TOKEN.
    const adminCookie = cookie;
    const logout = await call('POST', '/api/auth/logout');
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await call('GET', '/api/me', undefined, adminCookie)).data.user, null);
    assert.equal((await call('GET', '/api/me')).data.user, null);
    assert.equal((await call('POST', '/api/auth/register', { username: 'http-user', password: 'http-password', role: 'admin' })).status, 201);
    assert.equal((await call('GET', '/api/me')).data.user.role, 'user');
    await call('POST', '/api/auth/logout');
    assert.equal((await call('POST', '/api/auth/login', { username: 'http-user', password: 'wrong' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { username: 'http-user', password: 'http-password' })).status, 200);
    assert.equal((await call('GET', '/api/me')).data.user.username, 'http-user');
    const foreign = await fetch(base + '/api/auth/register', { method: 'POST', headers: {
      origin: 'https://foreign.example', 'content-type': 'application/json'
    }, body: JSON.stringify({ username: 'foreign', password: 'long-password' }) });
    assert.equal(foreign.status, 403);
    const seeded = db.users.byUsername('admin');
    await new Promise(resolve => server.close(resolve));
    base = await start(2);
    assert.deepEqual(db.users.byUsername('admin'), seeded);
    const restartedLogin = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin' }, '');
    assert.equal(restartedLogin.status, 200);
    const restartedCookie = restartedLogin.headers.get('set-cookie').split(';')[0];
    await call('POST', '/api/auth/login', { username: 'admin', password: 'wrong' }, '');
    const limited = await call('POST', '/api/auth/register', { username: 'limited', password: 'long-password' }, '');
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
    await new Promise(resolve => server.close(resolve));
    process.env.NODE_ENV = 'production';
    process.env.DEMO_AUTH = '0';
    base = await start();
    assert.equal((await call('GET', '/api/me', undefined, restartedCookie)).data.user, null);
    assert.equal((await call('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { username: 'http-user', password: 'http-password' })).status, 200);
    console.log('PASS real HTTP: admin/admin, register/login/logout/me, old-cookie rejection, CSRF, restart seed, shared auth rate limit, demo disabled in production on reused DB');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
