'use strict';
const assert = require('node:assert/strict');
const db = require('../server/lib/db.js');
const Pricing = require('../server/lib/pricing.js');
const Routing = require('../shared/ai/routing.js');
const Providers = require('../shared/ai/providers/index.js');
const Router = require('../server/lib/router.js');
const ai = require('../server/lib/ai.js');
const pricing = Pricing.load({ AI_PRICING_VERSION: 'test-2026-09-07', AI_PRICES_JSON: '{"mock":{"m":{"input":2,"output":4}}}' });
const req = { provider: 'mock', model: 'm', system: 'private prompt', userText: 'private резюме' };
const reported = Pricing.account(req, { usage: { input: 100, output: 50 } }, pricing);
assert.equal(reported.costUsd, 0.0004); assert.equal(reported.estimated, false);
const estimated = Pricing.account(req, { text: 'private reply' }, pricing);
assert.equal(estimated.tokensIn, Buffer.byteLength(req.system + req.userText) + 32);
assert.equal(estimated.tokensOut, 13); assert.equal(estimated.estimated, true);
assert.equal(Pricing.account(req, { usage: { input: 0, output: 0 } }, pricing).tokensIn, 0);
assert.equal(Pricing.account(req, { usage: { input: -1, output: 2 } }, pricing).inputEstimated, true);
assert.equal(Pricing.account(req, {}, Pricing.load({})).pricingMissing, true);
for (const bad of ['secret', '[]', '{"p":{"m":{"input":-1,"output":0}}}', '{"p":{"m":{"input":"2","output":0}}}']) {
  assert.throws(() => Pricing.load({ AI_PRICES_JSON: bad }), e => !e.message.includes('secret'));
}
const env = { A: 'mock', M: 'prep-model', L: 'live-model', AI_PROFILES_JSON: JSON.stringify({
  prep: { provider: 'A', model: 'M' }, live: { provider: 'A', model: 'L' } }),
  AI_STAGE_ROUTES_JSON: '{"pre_interview":"prep","live_interview":"live"}' };
const routing = Routing.load(env);
for (const [task, stage] of Object.entries(Routing.STAGES)) {
  assert.equal(routing.resolve(task).stage, stage);
  assert.equal(routing.resolve(task).model, stage === 'pre_interview' ? 'prep-model' : 'live-model');
}
assert.throws(() => Routing.load({ ...env, AI_STAGE_ROUTES_JSON: '{"stt":"live"}' }));
assert.equal(Routing.load({}).resolve('interview.turn').provider, 'mock');
assert.equal(Routing.load({ ...env, AI_TASK_ROUTES_JSON: '{"prep.card":"live"}' }).resolve('prep.card').model, 'live-model');
(async () => {
  const handle = db.open(':memory:');
  const admin = db.users.create('usage-admin', 'private-hash', 'admin');
  const user = db.users.create('usage-user', 'private-hash');
  const sa = db.sessions.rotate(db.sessions.create().id, admin.id);
  const su = db.sessions.rotate(db.sessions.create().id, user.id);
  db.usage.record(sa.id, { ...reported, task: 'prep.card', provider: 'mock', model: 'm', ok: true, ms: 10, rawText: 'private resume', apiKey: 'secret' });
  db.usage.record(su.id, { ...estimated, task: 'interview.turn', provider: 'cerebras', model: 'live-model', ok: false, ms: 20 });
  let summary = db.usage.summary(7);
  assert.equal(summary.totals.requests, 2); assert.equal(summary.totals.failures, 1);
  assert.equal(summary.totals.estimatedRequests, 1); assert.equal(summary.totals.reportedRequests, 1);
  assert.equal(summary.byUser.length, 2); assert(summary.byUser.some(x => x.userId === admin.id && x.username === admin.username));
  assert.equal(summary.byStage.length, 2); assert.equal(summary.byProvider.length, 2); assert.equal(summary.byModel.length, 2);
  assert.equal(summary.byDay.length, 1);
  assert.equal(summary.totals.estimatedCostUsd, reported.costUsd + estimated.costUsd);
  assert(!/secret|private|password|session_id|transcript|audio/.test(JSON.stringify(summary)));
  const raw = handle.prepare('SELECT * FROM usage').all();
  assert(!/private|secret/.test(JSON.stringify(raw)));
  const router = Router.create(); require('../server/routes/admin.js').register(router, { adminToken: 'independent-token' });
  async function get(session, query = '', token = '') {
    let data;
    const res = { writeHead(status) { assert.equal(status, 200); }, end(body) { data = JSON.parse(body); } };
    await router.dispatch({ method: 'GET', url: '/api/admin/usage' + query, headers: { authorization: token } }, res, { session });
    return data;
  }
  assert.equal((await get(sa)).totals.requests, 2);
  await assert.rejects(get(su), e => e.status === 403);
  await assert.rejects(get(db.sessions.create()), e => e.status === 401);
  await assert.rejects(get(null, '', 'Bearer wrong'), e => e.status === 401);
  assert.equal((await get(null, '?days=1', 'Bearer independent-token')).days, 1);
  for (const query of ['0', '-1', '366', 'Infinity', '2.5', 'abc', '']) await assert.rejects(get(sa, '?days=' + query), e => e.status === 400);
  const oldExecute = Providers.execute; const oldEnv = { ...process.env };
  try {
    process.env.AI_PROVIDER = 'mock'; delete process.env.AI_PROFILES_JSON; delete process.env.AI_TASK_ROUTES_JSON; delete process.env.AI_STAGE_ROUTES_JSON;
    Providers.execute = async () => ({ ok: true, text: JSON.stringify({ opening: 'Synthetic opening', strongPoints: [], risky: [], askThem: [], reminders: [] }), usage: { input: 17, output: 4 } });
    assert.equal((await ai.run(sa.id, 'prep.card', { resume: { data: { rawText: 'private content' } } })).ok, true);
    Providers.execute = async () => ({ ok: true, text: 'invalid private json' });
    assert.equal((await ai.run(sa.id, 'prep.card', {})).ok, false);
    Providers.execute = async () => { throw new Error('secret private content'); };
    const failure = await ai.run(sa.id, 'assistant.hint', {});
    assert.equal(failure.ok, false); assert(!/secret|private/.test(JSON.stringify(failure)));
    summary = db.usage.summary(7); assert.equal(summary.totals.requests, 5); assert.equal(summary.totals.failures, 3);
    assert.equal(summary.byUser.find(x => x.userId === admin.id).requests, 4);
  } finally {
    Providers.execute = oldExecute;
    for (const k of Object.keys(process.env)) if (!(k in oldEnv)) delete process.env[k];
    Object.assign(process.env, oldEnv);
  }
  const lateRecorder = db.usage.forSession(sa.id);
  const rotated = db.sessions.rotate(sa.id, admin.id);
  db.sessions.removeOne(rotated.id);
  lateRecorder({ ...reported, task: 'prep.card', provider: 'mock', model: 'm', ok: true });
  assert.equal(db.usage.summary(7).byUser.find(x => x.userId === admin.id).requests, 5);
  let reads = 0;
  const stream = await Providers.execute({ provider: 'cerebras', model: 'fixture', system: '', userText: '', streaming: true }, {}, async () => ({ ok: true,
    body: { getReader: () => ({ read: async () => reads++ ? { done: true } : { done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n') } }) } }));
  assert.deepEqual(stream.usage, { input: 12, output: 3 });
  const attempts = []; let calls = 0;
  const retried = await Providers.execute({ ...req, provider: 'openrouter' }, { retries: 1, onAttemptFailure: r => attempts.push(r) }, async () => ({
    ok: calls++ > 0, status: calls === 1 ? 429 : 200,
    headers: { get: () => '0' }, json: async () => calls === 1 ? { usage: { prompt_tokens: 5, completion_tokens: 0 } } : { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 6, completion_tokens: 1 } }
  }));
  assert.equal(retried.ok, true); assert.equal(attempts.length, 1);
  assert.deepEqual(attempts[0].usage, { input: 5, output: 0 }); assert(attempts[0].ms >= 0);
  const refusal = await Providers.execute({ ...req, provider: 'openrouter' }, {}, async () => ({ ok: true,
    json: async () => ({ choices: [], usage: { prompt_tokens: 8, completion_tokens: 2 } }) }));
  assert.equal(refusal.ok, false); assert.equal(refusal.usage.input, 8);
  const roleOnly = Router.create(); require('../server/routes/admin.js').register(roleOnly, { adminToken: '' });
  const adminSession = db.sessions.rotate(db.sessions.create().id, admin.id);
  let roleOnlyStatus;
  await roleOnly.dispatch({ method: 'GET', url: '/api/admin/usage', headers: {} }, { writeHead(s) { roleOnlyStatus = s; }, end() {} }, { session: adminSession });
  assert.equal(roleOnlyStatus, 200);
  handle.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(admin.id);
  await assert.rejects(roleOnly.dispatch({ method: 'GET', url: '/api/admin/usage', headers: {} }, {}, { session: adminSession, role: 'admin' }), e => e.status === 403);
  const gigaAuth = require('../server/lib/gigachat-auth.js');
  const oldToken = gigaAuth.getToken; const savedEnv = { ...process.env };
  const beforeAuth = db.usage.summary(7).totals.requests;
  try {
    Object.assign(process.env, { AI_PROVIDER: 'gigachat', AI_AUTH_KEY: 'fixture-key', AI_MODEL: 'fixture' });
    delete process.env.AI_PROFILES_JSON; delete process.env.AI_TASK_ROUTES_JSON; delete process.env.AI_STAGE_ROUTES_JSON;
    gigaAuth.getToken = async () => { throw new Error('private-auth-secret'); };
    const result = await ai.run(adminSession.id, 'prep.card', {});
    assert.equal(result.ok, false); assert(!JSON.stringify(result).includes('private-auth-secret'));
    assert.equal(db.usage.summary(7).totals.requests, beforeAuth + 1);
  } finally {
    gigaAuth.getToken = oldToken;
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  }
  db.close();
  console.log('PASS usage: pricing, estimates, pipeline failures, identity retention, all aggregates, admin role/token, bounded periods, redaction, stage/legacy routing, streaming usage (no sockets)');
})().catch(e => { db.close(); console.error(e); process.exitCode = 1; });
