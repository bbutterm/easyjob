'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
Object.assign(process.env, { AI_PROVIDER: 'mock', AI_TIMEOUT_MS: '30', LOG_LEVEL: 'error' });
const db = require('../server/lib/db.js');
const Providers = require('../shared/ai/providers/index.js');
const ai = require('../server/lib/ai.js');
const Router = require('../server/lib/router.js');
const valid = { strengths: ['Synthetic strength'], vague: [], missing: [{ title: 'Detail', after: 'Add scale', why: 'Clarity' }] };
(async () => {
  const handle = db.open(':memory:'); const session = db.sessions.create();
  const router = Router.create(); require('../server/routes/api.js').register(router);
  const original = Providers.execute;
  async function call(path, body, res = new EventEmitter()) {
    const req = Readable.from([Buffer.from(JSON.stringify(body || {}))]);
    Object.assign(req, { method: 'POST', url: path, headers: { 'content-type': 'application/json' } });
    res.writeHead = function(status) { this.status = status; };
    res.end = function(body) { this.data = JSON.parse(body); this.writableEnded = true; };
    await router.dispatch(req, res, { session }); return res;
  }
  try {
    const extracted = await call('/api/resumes/extract', { name: 'synthetic.txt', base64: Buffer.from('Synthetic engineer resume with software testing experience.').toString('base64') });
    assert.match(extracted.data.rawText, /Synthetic engineer/);
    assert.equal(db.resumes.list(session.id).length, 0, 'extraction alone never stores bytes/text');
    const r = (await call('/api/resumes', { title: 'Synthetic', data: { rawText: extracted.data.rawText } })).data;
    const review = '/api/resumes/' + r.id + '/review';
    for (const result of [
      { ok: true, text: '{"strengths":[' },
      { ok: true, text: JSON.stringify(valid), stopReason: 'length', usage: { input: 10, output: 4000 } },
      { ok: true, text: 'Here is the report: ' + JSON.stringify(valid) },
      { ok: true, text: '{}' }
    ]) {
      Providers.execute = async () => result;
      await assert.rejects(call(review), e => e.extra.code === 'malformed_response');
      assert.equal(db.resumes.get(session.id, r.id).review, null);
    }
    Providers.execute = async () => new Promise(() => {});
    await assert.rejects(call(review), e => e.status === 504 && e.extra.code === 'timeout');
    const response = new EventEmitter();
    const pending = call(review, {}, response);
    await new Promise(r => setTimeout(r, 5));
    await assert.rejects(call(review), e => e.status === 409);
    response.emit('close');
    await assert.rejects(pending, e => e.extra.code === 'cancelled');
    assert.equal(db.resumes.get(session.id, r.id).review, null);
    Providers.execute = async (_, rt) => { assert.equal(rt.retries, 0); assert.equal(rt.disableReasoning, true); return { ok: true, text: JSON.stringify(valid) }; };
    const longText = 'Synthetic '.repeat(3999);
    Providers.execute = async request => { assert(request.userText.includes(longText), 'full accepted resume must reach provider'); return { ok: true, text: JSON.stringify(valid) }; };
    const longResult = await ai.run(session.id, 'resume.review', { resume: { data: { rawText: longText } } });
    assert.equal(longResult.ok, true, '40k resume must not be silently dropped');
    Providers.execute = async () => ({ ok: true, text: JSON.stringify(valid) });
    const done = await call(review);
    assert.deepEqual(done.data.review, valid);
    assert.equal(done.data.source.stage, 'pre_interview');
    const summary = db.usage.summary(7).totals;
    assert.equal(summary.failures, 6); assert.equal(summary.requests, 8);
    const wire = require('../shared/ai/providers/openai.js');
    assert.deepEqual(wire.toWire({ provider: 'openrouter', outputFormat: 'json' }, { disableReasoning: true }).body.reasoning, { enabled: false });
    assert.equal(wire.toWire({ provider: 'openrouter' }, {}).body.reasoning, undefined, 'live unchanged');
    assert.equal(wire.fromWire({ choices: [{ message: { content: '{}' }, finish_reason: 'length' }] }).truncated, true);
    const context = { window: { location: { protocol: 'http:' } }, AbortController, setTimeout, clearTimeout,
      fetch: (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort')))) };
    vm.createContext(context); vm.runInContext(fs.readFileSync('src/api.js', 'utf8'), context);
    await assert.rejects(context.Api.request('POST', '/test', {}, { timeoutMs: 5 }), e => e.extra.code === 'timeout');
    const aborter = new AbortController(); const request = context.Api.request('POST', '/test', {}, { signal: aborter.signal }); aborter.abort();
    await assert.rejects(request, e => e.extra.code === 'cancelled');
    context.fetch = async (_, options) => ({ ok: true, json: () => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort')))) });
    await assert.rejects(context.Api.request('POST', '/test', {}, { timeoutMs: 5 }), e => e.extra.code === 'timeout');
    let state = { upload: { fileName: 'synthetic.txt', text: 'Synthetic', analysisShown: true, decisions: {}, error: 'Retryable failure' }, pending: null };
    context.Store = { get: () => state };
    context.DEMO_DATA = { analysisReport: { strengths: ['DEMO_SENTINEL'], vague: [], missing: [] } };
    context.Api.live.enabled = true;
    vm.runInContext(fs.readFileSync('src/ui.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('src/screens-core.js', 'utf8'), context);
    let html = context.ScreensCore.upload();
    assert(!html.includes('DEMO_SENTINEL') && !html.includes('upload:show-analysis'));
    assert(html.includes('Повторить разбор') && html.includes('upload-error'));
    state.upload.report = structuredClone(valid); state.upload.source = { provider: 'openrouter', model: 'synthetic-model' }; state.upload.error = '';
    html = context.ScreensCore.upload();
    assert(html.includes('openrouter') && html.includes('synthetic-model') && html.includes('pre_interview'));
    assert(!html.includes('Демонстрационная версия резюме'));
    state.upload.busy = true; state.pending = 'Analyzing'; html = context.ScreensCore.upload();
    assert(/data-act="upload:review" disabled/.test(html) && html.includes('upload:cancel'));
    console.log('PASS resume reliability: bytes, no extraction persistence, strict JSON/schema/truncation, timeout/body timeout/cancel, duplicate, retry, ledger, source, reasoning capability');
  } finally { Providers.execute = original; db.closeIf(handle); }
})().catch(e => { console.error(e); process.exitCode = 1; });
