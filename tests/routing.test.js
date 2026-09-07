'use strict';
const assert = require('node:assert/strict');
const Routing = require('../shared/ai/routing.js');
const R = require('../shared/ai/request.js');
const P = require('../shared/ai/providers/index.js');
const C = require('../shared/ai/capabilities.js');
const env = {
  AI_PROVIDER: 'mock', OR_PROVIDER: 'openrouter', OR_MODEL: '<structured-model-id>',
  OR_KEY: 'test-secret', CB_PROVIDER: 'cerebras', CB_MODEL: '<fast-model-id>', CB_KEY: 'other-secret',
  TIMEOUT: '2500', FIELD: 'max_tokens', LIMIT: '777',
  AI_PROFILES_JSON: JSON.stringify({ structured: { provider: 'OR_PROVIDER', model: 'OR_MODEL', apiKey: 'OR_KEY' },
    fast: { provider: 'CB_PROVIDER', model: 'CB_MODEL', apiKey: 'CB_KEY', timeoutMs: 'TIMEOUT', maxTokensField: 'FIELD', maxOutputTokens: 'LIMIT' } }),
  AI_DEFAULT_PROFILE: 'structured',
  AI_TASK_ROUTES_JSON: JSON.stringify({ 'assistant.hint': 'fast', 'interview.turn': 'fast' })
};
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
(async () => {
  check('legacy mock and environment preserved', () => {
    assert.equal(Routing.load({}).resolve('resume.review').provider, 'mock');
    const c = Routing.load({ AI_PROVIDER: 'openai', AI_MODEL: 'old', AI_API_KEY: 'old-key', AI_ENDPOINT: 'https://example.test/chat' }).resolve('vacancy.parse');
    assert.equal(c.model, 'old'); assert.equal(c.apiKey, 'old-key'); assert.equal(c.endpoint, 'https://example.test/chat');
  });
  check('routes, unmapped and unknown tasks use deterministic default', () => {
    const r = Routing.load(env);
    assert.equal(r.resolve('assistant.hint').model, env.CB_MODEL);
    assert.equal(r.resolve('resume.review').model, env.OR_MODEL);
    assert.equal(r.resolve('future.task').model, env.OR_MODEL);
    assert.equal(r.isLive(), true);
    assert.equal(Routing.load({ ...env, AI_DEFAULT_PROFILE: '' }).resolve('prep.card').provider, 'mock');
  });
  check('invalid config errors never echo values', () => {
    for (const patch of [
      { AI_PROFILES_JSON: 'test-secret' }, { AI_PROFILES_JSON: '[]' },
      { AI_PROFILES_JSON: '{"p":{"apiKey":"test-secret"}}' },
      { AI_DEFAULT_PROFILE: 'test-secret' }, { OR_PROVIDER: 'test-secret' }, { OR_KEY: '' },
      { TIMEOUT: '-1' }, { TIMEOUT: 'Infinity' }, { LIMIT: '1.5' }, { FIELD: 'authorization' },
      { AI_TASK_ROUTES_JSON: '{"assistant.hint":"missing"}' },
      { AI_TASK_ROUTES_JSON: '{"typo":"fast"}' },
      { AI_ENDPOINT: 'https://user:test-secret@example.test' }
    ]) assert.throws(() => Routing.load({ ...env, ...patch }), e => !e.message.includes('test-secret'));
  });
  for (const [provider, endpoint] of [['openrouter', 'https://openrouter.ai/api/v1/chat/completions'], ['cerebras', 'https://api.cerebras.ai/v1/chat/completions'], ['openai_compatible', 'http://localhost:11434/v1/chat/completions']]) {
    check(provider + ' payload, endpoint, capabilities', () => {
      const req = R.build('vacancy.parse', { moment: { image: 'secret-image', captureConsent: true } }, { provider, model: '<model-id>' });
      const wire = P.adapter(provider).toWire(req, { apiKey: 'test-secret' });
      assert.equal(wire.url, endpoint); assert.equal(wire.body.model, '<model-id>');
      assert.equal(wire.headers.authorization, 'Bearer test-secret');
      assert.equal(wire.body.messages[0].role, 'system'); assert.equal(wire.body.response_format.type, 'json_object');
      assert.equal(req.image, null);
      assert.equal(C.needsCrossBorderNotice(provider), provider !== 'openai_compatible');
      const custom = P.adapter(provider).toWire(req, { endpoint: 'https://example.test/chat', maxTokensField: 'max_tokens' });
      assert.equal(custom.url, 'https://example.test/chat'); assert.equal(custom.body.max_tokens, req.maxOutputTokens);
      assert.equal(custom.body.max_completion_tokens, undefined);
    });
  }
  check('secret and prompt fields redacted', () => {
    const out = JSON.stringify(R.redactForLog({ apiKey: 'test-secret', authKey: 'test-secret', authorization: 'test-secret', system: 'private-prompt', userText: 'private-resume', rawText: 'private-resume' }));
    assert(!/test-secret|private-/.test(out));
  });
  for (const mode of ['http', 'network', 'body']) {
    const result = await P.execute(R.build('vacancy.parse', {}, { provider: 'openrouter' }), { retries: 0 }, async () => {
      if (mode === 'network') throw new Error('test-secret private-resume');
      return { ok: mode === 'body', status: 401, json: async () => ({ error: { message: 'test-secret private-resume' } }) };
    });
    check('redacts ' + mode + ' error', () => { assert.equal(result.ok, false); assert(!/test-secret|private-resume/.test(result.error)); });
  }
  const mockResult = await P.execute(R.build('vacancy.parse', {}, Routing.load({}).resolve('vacancy.parse')), {}, () => { throw new Error('network forbidden'); });
  check('legacy mock executes without network', () => { assert(mockResult.ok && mockResult.mock); });
  for (const provider of ['openrouter', 'cerebras']) {
    const req = R.build('interview.turn', {}, { provider, model: '<stream-model-id>' });
    let calls = 0;
    const result = await P.execute(req, {}, async (url, opts) => {
      assert.equal(JSON.parse(opts.body).stream, true);
      return { ok: true, body: { getReader: () => ({ read: async () => calls++ ? { done: true } :
        { done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"reply"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') } }) } };
    });
    check(provider + ' streaming uses existing pipeline', () => { assert.equal(result.text, 'reply'); });
  }
  // Exercise actual server pipeline without a database or network.
  const records = [];
  require.cache[require.resolve('../server/lib/db.js')] = { exports: { usage: { forSession: sid => value => records.push(value) } } };
  const ai = require('../server/lib/ai.js');
  const saved = { ...process.env }; const oldFetch = global.fetch; const oldWrite = process.stdout.write;
  let logs = ''; let wire;
  try {
    Object.assign(process.env, env);
    process.stdout.write = value => { logs += value; return true; };
    global.fetch = async (url, opts) => { wire = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"direction":"ok"}' } }] }) }; };
    const result = await ai.run('test', 'assistant.hint', {}, { streaming: false });
    assert(result.ok); assert.equal(wire.body.model, env.CB_MODEL); assert.equal(wire.body.max_tokens, 777);
    assert.equal(wire.url, C.profile('cerebras').endpoint); assert.equal(records[0].provider, 'cerebras');
    assert(!/test-secret|other-secret|private-resume/.test(logs));
    assert(!JSON.stringify(ai.describe()).includes('test-secret'));
  } finally {
    global.fetch = oldFetch; process.stdout.write = oldWrite;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  check('server selects task model, token limit and records actual provider safely', () => {});
  console.log('Routing: ' + checks + ' checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
