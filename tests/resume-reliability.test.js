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
  const handle = db.open(':memory:');
  const user = db.users.create('resume-regression', 'synthetic-password-hash');
  const session = db.sessions.rotate(db.sessions.create().id, user.id);
  const router = Router.create(); require('../server/routes/api.js').register(router);
  const original = Providers.execute;
  async function call(path, body, res = new EventEmitter(), method = 'POST') {
    const req = Readable.from([Buffer.from(JSON.stringify(body || {}))]);
    Object.assign(req, { method, url: path, headers: { 'content-type': 'application/json' } });
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
    // Socketless regressions exercise real routes, fitting, prompts and accounting.
    process.env.AI_TIMEOUT_MS = '5000';
    process.env.CONTEXT_MEMORY = '0';
    const marker = 'SYNTHETIC_RESUME_CONTEXT_7c91';
    const otherMarker = 'SYNTHETIC_OTHER_USER_9f24';
    const owned = db.resumes.create(session.id, 'Synthetic', { rawText: marker + ' x'.repeat(5000) });
    const other = db.sessions.create();
    db.resumes.create(other.id, 'Synthetic other', { rawText: otherMarker });
    const vacancy = db.vacancies.create(session.id, 'Synthetic role', '', 'Synthetic requirements');
    let prep = db.preps.create(session.id, owned, vacancy, 'Synthetic role');
    // A legacy pinned snapshot has no rawText and must not hide the current source.
    db.preps.setSnapshot(session.id, prep.id, ai.makeSnapshot(prep, owned, vacancy));
    prep = db.preps.get(session.id, prep.id);
    db.resumes.update(session.id, owned.id, owned.title, { rawText: marker + '_CURRENT' + ' x'.repeat(5000) });
    const requestBuilder = require('../shared/ai/request.js');
    Providers.execute = async request => {
      assert(request.userText.includes(marker + '_CURRENT'));
      assert(!request.userText.includes(otherMarker));
      assert(request.userText.length < owned.data.rawText.length);
      assert(request.sizing.inputTokens <= request.sizing.allowance);
      assert(!JSON.stringify(requestBuilder.redactForLog(request)).includes(marker));
      return { ok: true, text: 'Synthetic question' };
    };
    const parts = { prep, resume: db.resumes.get(session.id, prep.resumeId), vacancy,
      interview: { turns: [{ role: 'candidate', text: 'Synthetic introduction', seq: 1 }] } };
    assert(!JSON.stringify(requestBuilder.redactForLog(ai.buildStore('interview.turn', parts, session.id).store.get('preparation'))).includes(marker));
    const turn = await ai.run(session.id, 'interview.turn', parts);
    assert.equal(turn.ok, true);
    assert.equal(turn.context.evidenceVia, 'off');
    assert.equal(turn.context.resumeTextRev, 2);
    assert.equal(turn.context.resumeTextTruncated, true);
    assert.equal(turn.context.sourcesChanged, true);
    assert.equal(db.resumes.get(other.id, owned.id), null);
    console.log('PASS resume context: memory off, legacy snapshot, bounded prompt, redaction, session isolation');

    const cardPath = '/api/preps/' + prep.id + '/card';
    const card = { opening: 'Synthetic opening', strongPoints: [], risky: [], askThem: ['Synthetic question'], reminders: [] };
    const goodCard = () => ({ ok: true, text: JSON.stringify(card), mock: true });
    // Use a short source for prep tasks, which retain the full source.
    db.resumes.update(session.id, owned.id, owned.title, { rawText: marker });
    const invalidCards = [
      { ok: true, text: '{}' }, { ok: true, text: '{' },
      { ok: true, text: 'null' }, { ok: true, text: '[]' },
      { ok: true, text: JSON.stringify({ ...card, askThem: 'Synthetic' }) },
      { ok: true, text: JSON.stringify({ ...card, extra: 'Synthetic' }) },
      { ok: true, text: JSON.stringify({ ...card, opening: '   ' }) },
      { ok: true, text: JSON.stringify({ ...card, strongPoints: [42] }) },
      { ok: true, text: JSON.stringify({ ...card, risky: [{ topic: 'Synthetic' }] }) },
      { ok: true, text: JSON.stringify({ ...card, opening: 'x'.repeat(2001) }) },
      { ok: true, text: JSON.stringify({ ...card, reminders: Array(11).fill('Synthetic') }) },
      { ...goodCard(), truncated: true }
    ];
    for (const previous of [null, card]) {
      if (previous) {
        Providers.execute = async () => goodCard();
        assert.equal((await call(cardPath)).status, 200);
      }
      const before = db.preps.get(session.id, prep.id);
      for (const invalid of invalidCards) {
        const requestsBefore = db.usage.summary(7).totals;
        Providers.execute = async () => invalid;
        await assert.rejects(call(cardPath), e => e.status === 502 && e.extra.code === 'malformed_response');
        const requestsAfter = db.usage.summary(7).totals;
        assert.equal(requestsAfter.requests, requestsBefore.requests + 1);
        assert.equal(requestsAfter.failures, requestsBefore.failures + 1);
        const after = db.preps.get(session.id, prep.id);
        assert.deepEqual(after.card, previous);
        assert.deepEqual(after.sources, before.sources);
      }
    }
    Providers.execute = async () => goodCard();
    assert.deepEqual((await call(cardPath)).data.card, card, 'retry succeeds');
    assert.equal(db.preps.get(session.id, prep.id).sources.card.stage, 'pre_interview');
    console.log('PASS prep card: strict schema, truncation, prior card/source preservation, successful retry');

    const feedbackPath = '/api/preps/' + prep.id + '/feedback';
    db.preps.set(session.id, prep.id, { questions: [{ id: 'q1', text: 'Synthetic question' }], answers: { q1: 'Synthetic answer A' } });
    const feedbackResult = { ok: true, text: JSON.stringify({ strong: ['Synthetic strength'], gaps: [], rewrite: 'Synthetic rewrite' }), mock: true };
    Providers.execute = async () => feedbackResult;
    await call(feedbackPath, { questionId: 'q1' });
    const priorFeedback = db.preps.get(session.id, prep.id).feedback;
    for (const changeBack of [false, true]) {
      let release, entered;
      const started = new Promise(resolve => { entered = resolve; });
      Providers.execute = async request => {
        assert(request.userText.includes('Synthetic answer A'));
        entered(); return new Promise(resolve => { release = resolve; });
      };
      const pendingFeedback = call(feedbackPath, { questionId: 'q1' });
      await started;
      await call('/api/preps/' + prep.id + '/answers', { answers: { q1: 'Synthetic answer B' } }, new EventEmitter(), 'PUT');
      if (changeBack) db.preps.set(session.id, prep.id, { answers: { q1: 'Synthetic answer A' } });
      release(feedbackResult);
      await assert.rejects(pendingFeedback, e => e.status === 409 && e.extra.code === 'stale_answer');
      assert.deepEqual(db.preps.get(session.id, prep.id).feedback, priorFeedback);
      db.preps.set(session.id, prep.id, { answers: { q1: 'Synthetic answer A' } });
    }
    Providers.execute = async () => feedbackResult;
    assert.equal((await call(feedbackPath, { questionId: 'q1' })).status, 200);
    console.log('PASS feedback race: delayed model, changed answer, ABA revision, prior feedback preservation, retry');
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
