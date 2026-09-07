/* Socketless integration: actual API handlers + Store/API adapters + Quick Start. */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { Readable } = require('node:stream');
Object.assign(process.env, { AI_PROVIDER: 'mock', LOG_LEVEL: 'error', SESSION_SECRET: 'quickstart-test', DEMO_AUTH: '0', NODE_ENV: 'test' });
const { createApp } = require('../server/index.js');
const db = require('../server/lib/db.js');
const session = require('../server/lib/session.js');
const router = require('../server/lib/router.js').create();
require('../server/routes/auth.js').register(router);
require('../server/routes/api.js').register(router);
const { server } = createApp({ dbFile: ':memory:', retention: false, secure: false });
let sid = db.sessions.create('qs-test').id;
async function api(method, url, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body || {}))]);
  Object.assign(req, { method, url, headers: { 'content-type': 'application/json' } });
  let result;
  const res = { setHeader(k, v) {
    if (k === 'set-cookie' && !v.includes('Max-Age=0')) sid = session.verify(decodeURIComponent(v.split(';')[0].split('=')[1]));
  }, writeHead() {}, end(text) { result = JSON.parse(text); } };
  await router.dispatch(req, res, { session: db.sessions.get(sid), ipHash: 'qs-test', secure: false, freePrepsPerDay: 100 });
  return result;
}
const storage = new Map(), events = {};
const ctx = vm.createContext({ console, setTimeout, clearTimeout,
  window: { addEventListener: (n, fn) => { events[n] = fn; }, location: { protocol: 'http:', hash: '#/quickstart' }, localStorage: {
    getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v)
  } }, document: { addEventListener: (n, fn) => { events[n] = fn; }, getElementById: () => null } });
for (const f of ['professions', 'data', 'state', 'ui', 'api', 'quickstart']) vm.runInContext(fs.readFileSync('src/' + f + '.js', 'utf8'), ctx);
const { Api, Store, QuickStart: Q } = ctx;
Api.request = api;
function state() { return JSON.parse(storage.get('easyjob:quickstart:v1:' + Api.live.user.id)); }
function fill(key, value) { events.input({ target: { getAttribute: () => key, value } }); }
async function hydrate() {
  const me = await api('GET', '/api/me'); Api.live.user = me.user;
  const resumes = await Promise.all(me.resumes.map(async r => Api.resumeFromServer(await api('GET', '/api/resumes/' + r.id))));
  Store.replaceData({ resumes, vacancies: (await api('GET', '/api/vacancies')).map(Api.vacancyFromServer), preps: me.preps.map(Api.prepFromServer) }); Q.bind();
}
(async () => {
  try {
    await api('POST', '/api/auth/register', { username: 'quick-user', password: 'quick-test-password' });
    await hydrate(); const alice = Api.live.user;
    assert.equal(Q.afterLogin(true), '#/quickstart');
    assert.equal(Q.afterLogin(), '#/overview');
    assert.match(Q.screen(), /Шаг 1 из 9/);
    await Q.act('continue'); assert.equal(state().step, 1); assert.deepEqual(state().completed, [0]);
    await Q.act('resume'); assert.match(Q.screen(), /не менее 40/); assert.equal(state().completed.includes(1), false);
    fill('resumeTitle', 'PRIVATE resume'); fill('resumeText', 'PRIVATE-TEXT Я повар горячего цеха с опытом пять лет, работа по технологическим картам.');
    await Q.act('resume'); assert.deepEqual(state().completed, [0, 1]);
    await Q.act('continue');
    Api.request = async (method, url, body) => { if (url === '/api/me') return api(method, url, body); throw new Error('Injected API failure'); };
    await Q.act('review'); assert.match(Q.screen(), /Повторить:/); assert.equal(state().completed.includes(2), false);
    Api.request = api; await Q.act('review'); assert.deepEqual(state().completed, [0, 1, 2]);
    assert.match(Q.screen(), /Заглушка: понятная/);
    await Q.act('continue');
    fill('vacancyTitle', 'PRIVATE vacancy'); fill('vacancyText', 'PRIVATE-VACANCY Ищем повара, опыт от двух лет, технологические карты, горячий цех, санитарные нормы.');
    await Q.act('vacancy'); assert.deepEqual(state().completed, [0, 1, 2, 3]);
    await Q.act('continue'); await Q.act('match'); assert.deepEqual(state().completed, [0, 1, 2, 3, 4]);
    await Q.act('continue'); await Q.act('questions'); assert.deepEqual(state().completed, [0, 1, 2, 3, 4, 5]);
    fill('answer', 'PRIVATE-ANSWER Мой опыт работы в горячем цехе'); await Q.act('answer');
    const prep = Store.get().preps[0];
    assert.equal((await api('GET', '/api/preps/' + prep.id)).answers[prep.questions[0].id], 'PRIVATE-ANSWER Мой опыт работы в горячем цехе');
    await Q.act('continue'); assert.match(Q.screen(), /Получить обратную связь с AI/);
    await Q.act('feedback'); assert.deepEqual(state().completed, [0, 1, 2, 3, 4, 5, 6]);
    assert.match(Q.screen(), /Заглушка: есть структура/);
    assert.equal(Object.keys((await api('GET', '/api/preps/' + prep.id)).feedback).length, 1);
    await Q.act('continue'); await Q.act('interview');
    assert.equal(ctx.window.location.hash, '#/prep/' + prep.id + '/interview'); assert.equal(state().completed.includes(7), false);
    const interview = await api('POST', '/api/preps/' + prep.id + '/interviews');
    prep.chat = { started: true, interviewId: interview.interviewId }; Q.sync();
    assert.equal(state().completed.includes(7), true);
    ctx.window.location.hash = '#/quickstart'; await Q.act('continue'); assert.match(Q.screen(), /Live-интервью/);
    await Q.act('continue'); assert.equal(state().finished, true); assert.equal(ctx.window.location.hash, '#/overview');
    assert.equal(state().completed.length, 9);
    for (const data of storage.values()) assert.doesNotMatch(data, /PRIVATE|password|rawText|token|secret|answers/);
    assert.deepEqual(Object.keys(state()).sort(), ['completed', 'finished', 'skipped', 'step', 'timestamp']);
    console.log('PASS real socketless API: register, first/returning login, each action, review failure/retry, answer and actual interview');
    await Q.act('restart'); assert.equal(state().step, 0); assert.equal(state().finished, false);
    Q.sync(); assert.deepEqual(state().completed, [1, 2, 3, 4, 5, 6, 7]);
    await Q.act('skip'); assert.deepEqual(state().skipped, [0]); assert.equal(state().completed.includes(0), false);
    await Q.act('back'); assert.equal(state().step, 0);
    await Q.act('later'); assert.equal(ctx.window.location.hash, '#/overview');
    ctx.window.location.hash = '#/settings'; Q.sync(); assert.equal(ctx.window.location.hash, '#/settings');
    Q.resetMemory(); await hydrate(); assert.equal(Q.afterLogin(), '#/overview'); Q.sync();
    assert.deepEqual(state().completed, [1, 2, 3, 4, 5, 6, 7]);
    Store.get().preps[0].interviewStarted = false; Q.sync(); assert.equal(state().completed.includes(7), false);
    Store.get().preps[0].stale = true; Q.sync(); assert.deepEqual(state().completed, [1, 2, 3]);
    console.log('PASS restart, skip, later, Back, navigation escape, hydrated existing data and stale preparation');
    await api('POST', '/api/auth/logout'); sid = db.sessions.create('qs-test').id; Q.resetMemory(); Api.live.user = null; Store.replaceData({});
    assert.equal(Q.eligible(), false); assert.equal(Q.screen(), '');
    await api('POST', '/api/auth/register', { username: 'second-user', password: 'second-password' }); await hydrate();
    assert.equal(Q.afterLogin(true), '#/quickstart'); assert.deepEqual(state().completed, []);
    fill('resumeText', 'SHARED-BROWSER-SECRET');
    // A request resolving after account switch must not enter the other user's Store or storage.
    fill('resumeTitle', 'stale'); fill('resumeText', 'STALE-PRIVATE ' + 'x'.repeat(50));
    let resolve;
    Api.request = (method, url) => url === '/api/me' ? Promise.resolve({ user: Api.live.user }) : new Promise(r => { resolve = r; });
    const pending = Q.act('resume');
    await new Promise(setImmediate);
    Q.resetMemory(); Api.live.user = alice; Store.replaceData({}); Q.bind();
    resolve({ id: 'stale-result', title: 'STALE-PRIVATE', data: {} }); await pending;
    assert.equal(Store.get().resumes.length, 0); assert.doesNotMatch(Q.screen(), /SHARED-BROWSER|STALE-PRIVATE/);
    Api.request = api;
    await Q.act('resume');
    assert.equal(Api.live.user, null); assert.equal(ctx.window.location.hash, '#/auth/login');
    assert.equal(Store.get().resumes.length, 0);
    Api.live.user = alice;
    ctx.window.location.protocol = 'file:'; Q.bind(); assert.equal(Q.eligible(), false); assert.equal(Q.screen(), '');
    console.log('PASS logout/account switch, stale response isolation, no sensitive persistence, file demo exemption');
    // Storage refusal and malformed status cannot break the flow or restore arbitrary fields.
    ctx.window.location.protocol = 'http:'; Q.resetMemory();
    storage.set('easyjob:quickstart:v1:' + alice.id, JSON.stringify({ step: 900, completed: [0, 0, 900, '1'], token: 'private' }));
    Q.bind(); Q.screen(); assert.equal(state().step, 0); assert.deepEqual(state().completed, [0]); assert.equal(state().token, undefined);
    ctx.window.localStorage.setItem = () => { throw new Error('blocked'); }; await Q.act('continue'); assert.match(Q.screen(), /Шаг 2 из 9/);
    console.log('PASS bounded status validation and unavailable localStorage');
    events.storage({ key: 'easyjob:auth:change' });
    assert.equal(Api.live.user, null); assert.equal(Store.get().resumes.length, 0);
    assert.equal(ctx.window.location.hash, '#/auth/login');
    console.log('PASS other-tab auth change invalidates in-memory owner, drafts and account data');
  } finally { server.close(); db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
