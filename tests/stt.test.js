'use strict';
const assert = require('node:assert/strict');
const STT = require('../shared/stt');
const Permission = require('../desktop/lib/audio-permission');
const Ai = require('../shared/ai/request');
const Providers = require('../shared/ai/providers');
const Session = require('../desktop/lib/session');
const Settings = require('../desktop/lib/settings');
process.env.AI_PROVIDER = 'mock';
for (const key of ['AI_PROFILES_JSON', 'AI_TASK_ROUTES_JSON', 'AI_DEFAULT_PROFILE']) delete process.env[key];
let checks = 0;
function ok(name) { checks++; console.log('PASS ' + name); }
(async () => {
  assert.deepEqual(STT.chunks('  один\n два  '), ['один два']);
  const long = '😀'.repeat(4100); const parts = STT.chunks(long);
  assert.equal(parts.join(''), long); assert(parts.every(p => p.length <= 4000));
  assert.deepEqual(STT.parse({ text: 'Привет\nмир' }), ['Привет мир']);
  for (const data of [{}, { text: null }, { text: 'x'.repeat(32001) }]) assert.throws(() => STT.parse(data));
  for (const url of ['https://example.org/inference', 'http://127.0.0.1:8080/other', 'http://user:secret@localhost/inference']) assert.throws(() => STT.endpoint(url));
  assert.throws(() => STT.provider({ provider: 'openrouter' })); ok('chunking, Unicode, provider payload validation and local-only endpoint');
  {
    const wav = new Blob([new Uint8Array(100)], { type: 'audio/wav' });
    let seen = null;
    const server = STT.provider({ provider: 'server' }, async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ ok: true, text: 'сервер распознал', mock: false }), { status: 200 }); });
    const out = await server.transcribe(wav);
    assert.equal(seen.url, '/api/stt/transcribe'); assert.equal(seen.init.credentials, 'same-origin'); assert.equal(seen.body.consent, true);
    assert.equal(Buffer.from(seen.body.wavBase64, 'base64').length, 100); assert.deepEqual(out, { chunks: ['сервер распознал'], mock: false });
    const failing = STT.provider({ provider: 'server' }, async () => new Response(JSON.stringify({ ok: false, error: 'private detail' }), { status: 502 }));
    await assert.rejects(failing.transcribe(wav));
    ok('server STT provider posts base64 WAV with consent and same-origin cookies, surfaces failure');
  }

  let snapshots = [], mic = 0;
  const machine = STT.create({ capture: () => { mic++; }, onState: s => snapshots.push(s) });
  await machine.start(false); assert.equal(machine.state(), 'error'); assert.equal(mic, 0);
  await machine.start(true); assert.equal(machine.state(), 'recording'); await machine.stop();
  assert.equal(machine.state(), 'ready'); assert.equal(mic, 0);
  assert.equal(snapshots.at(-1).chunks[0], STT.MOCK_TEXT); assert(snapshots.at(-1).mock);
  assert.deepEqual(snapshots.slice(-4).map(s => s.state), ['idle', 'requesting', 'recording', 'transcribing'].concat('ready').slice(-4));
  machine.cancel(); assert.deepEqual(snapshots.at(-1).chunks, []); ok('mock compatibility, explicit consent, all success states, no microphone in mock');

  const adapter = { id: 'whisper_cpp', transcribe: async () => ({ chunks: ['safe'], mock: false }) };
  const denied = STT.create({ adapter, capture: async () => { throw new Error('PII secret phone'); }, onState: s => snapshots.push(s) });
  await denied.start(true); assert.equal(denied.state(), 'error'); assert(!JSON.stringify(snapshots).includes('PII')); ok('permission denial errors are redacted');
  let resolveCapture, stopped = 0;
  const late = STT.create({ adapter, capture: () => new Promise(r => { resolveCapture = r; }) });
  const starting = late.start(true); await late.stop();
  resolveCapture({ cancel: () => stopped++ }); await starting;
  assert.equal(stopped, 1); assert.equal(late.state(), 'idle'); ok('stop during pending permission releases late stream');

  let resolveSTT, signal;
  const pending = STT.create({ adapter: { id: 'whisper_cpp', transcribe: (_, s) => { signal = s; return new Promise(r => { resolveSTT = r; }); } },
    capture: async () => ({ finish: () => null, cancel() {} }) });
  await pending.start(true); const transcribing = pending.stop(); pending.cancel();
  assert(signal.aborted); resolveSTT({ chunks: ['late private speech'], mock: false }); await transcribing;
  assert.equal(pending.state(), 'idle'); ok('cancellation aborts transport and suppresses late transcripts');
  const timeout = STT.create({ adapter: { id: 'whisper_cpp', transcribe: () => new Promise(() => {}) }, timeoutMs: 5,
    capture: async () => ({ finish: () => null, cancel() {} }) });
  await timeout.start(true); await timeout.stop(); assert.equal(timeout.state(), 'error'); timeout.cancel(); ok('timeout works even for a noncooperative provider');
  const auto = STT.create({ maxRecordingMs: 5 }); await auto.start(true);
  await new Promise(r => setTimeout(r, 15)); assert.equal(auto.state(), 'ready'); auto.cancel(); ok('bounded utterance automatically stops');

  const permission = Permission.create(sender => sender === 'control');
  assert(!permission.arm('overlay', true)); assert(!permission.arm('control', false));
  assert(!permission.request('control', 'media', { mediaTypes: ['audio'] }));
  assert(permission.arm('control', true)); assert(permission.check('control', 'media', { mediaType: 'audio' }));
  assert(permission.request('control', 'media', { mediaTypes: ['audio'] }));
  assert(!permission.request('control', 'media', { mediaTypes: ['audio', 'video'] }));
  assert(!permission.request('overlay', 'media', { mediaTypes: ['audio'] }));
  assert(permission.check('control', 'loopback-network'));
  assert(permission.request('control', 'local-network-access'));
  assert(!permission.check('control', 'local-network'));
  assert(!permission.request('overlay', 'loopback-network'));
  assert(!permission.request('control', 'media', { mediaTypes: ['audio'], isMainFrame: false }));
  permission.revoke(); assert(!permission.check('control', 'loopback-network')); assert(!permission.check('control', 'media', { mediaType: 'audio' })); ok('Electron microphone permission is scoped, explicit, revocable; camera denied');

  const audio = STT.wav(new Float32Array(48000).fill(0.25), 48000);
  const view = new DataView(await audio.arrayBuffer());
  assert.equal(audio.size, 32044); assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getInt16(44, true), 8191);
  let trackStops = 0, contextCloses = 0, processor, writes = 0;
  const track = { stop: () => trackStops++, addEventListener() {} };
  const env = { navigator: { mediaDevices: { getUserMedia: async constraints => {
    assert.deepEqual(constraints, { audio: true, video: false });
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } }, AudioContext: class {
    constructor() { this.sampleRate = 48000; this.destination = {}; }
    async resume() {} async close() { contextCloses++; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return processor; }
  } };
  const fs = require('node:fs'), syncWrite = fs.writeFileSync, asyncWrite = fs.writeFile;
  fs.writeFileSync = fs.writeFile = () => { writes++; throw new Error('Audio persistence forbidden'); };
  try {
    assert.deepEqual(STT.capabilities(env), { microphone: true, systemAudio: false });
    assert.equal(STT.capabilities({}).microphone, false);
    const recording = await STT.capture(env);
    processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4800).fill(0.5) } });
    const output = recording.finish(); assert.equal(output.size, 3244);
    assert.equal(trackStops, 1); assert.equal(contextCloses, 1); assert.equal(processor.onaudioprocess, null);
    const cancelledRecording = await STT.capture(env); cancelledRecording.cancel();
    assert.equal(trackStops, 2); assert.throws(() => cancelledRecording.finish());
    assert.equal(writes, 0);
  } finally { fs.writeFileSync = syncWrite; fs.writeFile = asyncWrite; }
  ok('capture/WAV lifecycle, capability fallback, track release and no raw audio filesystem writes');

  let bytes = 0, uploads = 0;
  const protocol = async (url, init) => {
    const wire = new Request(url, init); const body = await wire.arrayBuffer(); bytes = body.byteLength; uploads++;
    const parsed = await new Request(url, { method: 'POST', headers: wire.headers, body }).formData();
    assert.equal(new URL(url).pathname, '/inference'); assert.equal(init.method, 'POST');
    assert.equal(parsed.get('response_format'), 'json'); assert.equal(parsed.get('language'), 'ru');
    assert.equal(parsed.get('file').name, 'utterance.wav');
    assert.deepEqual(Buffer.from(await parsed.get('file').arrayBuffer()), Buffer.from(await audio.arrayBuffer()));
    return new Response(JSON.stringify({ text: 'Тестовый вопрос о работе команды.' }), { headers: { 'content-type': 'application/json' } });
  };
  const result = await STT.provider({ provider: 'whisper_cpp' }, protocol).transcribe(audio);
  assert.equal(result.mock, false); assert.equal(uploads, 1); assert(bytes > audio.size);
  ok('serialized multipart/WAV adapter roundtrip with Request/Response fixture (no sockets or speech recognition), bytes=' + bytes);
  for (const body of ['private@example.com', JSON.stringify({ error: 'private@example.com' })]) {
    const bad = STT.provider({ provider: 'whisper_cpp' }, async () => new Response(body));
    await assert.rejects(() => bad.transcribe(audio), e => !e.message.includes('private@example.com'));
  }
  const redacted = JSON.stringify(Ai.redactForLog({ transcript: 'private', audio: 'raw', chunks: ['private'], text: 'private', detectedQuestion: 'private' }));
  assert(!redacted.includes('private')); assert(!redacted.includes(':"raw"')); ok('provider errors and transcript/audio log fields redacted');

  let request, hint, captures = 0;
  const original = Providers.execute;
  Providers.execute = async (req, runtime) => { request = req; return original(req, runtime); };
  const session = Session.create({ settings: Settings, audioOnly: true, capture: () => captures++, onHint: value => { hint = value; } });
  try {
    assert((await session.start()).ok);
    assert(!(await session.transcript(result.chunks[0], false)).ok);
    assert((await session.transcript(result.chunks[0], true)).ok);
    assert.equal(request.task, 'assistant.hint'); assert(JSON.stringify(request).includes(result.chunks[0]));
    assert(hint.demo); assert.equal(captures, 0);
    assert(!(await session.transcript('repeat', true)).ok);
    session.stop(); assert(!(await session.transcript('late', true)).ok);
  } finally { session.stop(); Providers.execute = original; }
  ok('final transcript reaches existing assistant.hint mock, consent/rate limit/stop preserved, no screen capture');
  let resolveHint, aborted;
  Providers.execute = (_, runtime) => { aborted = runtime.signal; return new Promise(r => { resolveHint = r; }); };
  let hints = 0;
  const cancelled = Session.create({ settings: Settings, audioOnly: true, onHint: () => hints++ });
  try {
    await cancelled.start(); const waiting = cancelled.transcript('cancel me', true); cancelled.stop();
    assert(aborted.aborted); resolveHint({ ok: true, text: '{"direction":"late"}' });
    assert(!(await waiting).ok); assert.equal(hints, 0);
  } finally { cancelled.stop(); Providers.execute = original; }
  ok('desktop AI cancellation suppresses late hints');
  // Real web route and SQLite in memory, without a listening socket or provider tokens.
  const db = require('../server/lib/db');
  const { Readable } = require('node:stream');
  const { EventEmitter } = require('node:events');
  const router = require('../server/lib/router').create();
  require('../server/routes/api').register(router);
  process.env.AI_PROVIDER = 'mock';
  delete process.env.AI_PROFILES_JSON; delete process.env.AI_TASK_ROUTES_JSON; delete process.env.AI_DEFAULT_PROFILE;
  require('../server/lib/log').setLevel('error');
  db.open(':memory:');
  let webRequest;
  Providers.execute = (req, runtime) => { webRequest = req; return original(req, runtime); };
  try {
    const owner = db.sessions.create('stt-test');
    const resume = db.resumes.create(owner.id, 'Test', { profession: 'Повар' });
    const vacancy = db.vacancies.create(owner.id, 'Повар', 'Test', 'Работа на кухне');
    const prep = db.preps.create(owner.id, resume, vacancy, 'Повар');
    const interview = db.interviews.create(owner.id, prep.id);
    const req = Readable.from([Buffer.from(JSON.stringify({ text: STT.MOCK_TEXT }))]);
    req.method = 'POST'; req.url = '/api/interviews/' + interview.id + '/turns';
    req.headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
    const res = new EventEmitter(); let body = '';
    res.writeHead = code => assert.equal(code, 200);
    res.write = chunk => { body += chunk; }; res.end = () => { res.writableEnded = true; };
    await router.dispatch(req, res, { session: owner });
    assert.equal(webRequest.task, 'interview.turn'); assert(JSON.stringify(webRequest).includes(STT.MOCK_TEXT));
    assert(body.includes('event: done')); assert(body.includes('"mock":true'));
    const stored = db.interviews.get(owner.id, interview.id);
    assert.equal(stored.turns[0].text, STT.MOCK_TEXT); assert.equal(stored.turns[1].role, 'interviewer');
    assert(!JSON.stringify(stored).includes('audio/wav'));
    const stoppedInterview = db.interviews.create(owner.id, prep.id);
    let release, requestSignal, reached;
    const started = new Promise(resolve => { reached = resolve; });
    Providers.execute = (_, runtime) => {
      requestSignal = runtime.signal; reached();
      return new Promise(resolve => { release = resolve; });
    };
    const stoppedReq = Readable.from([Buffer.from(JSON.stringify({ text: 'Отменяемая реплика' }))]);
    stoppedReq.method = 'POST'; stoppedReq.url = '/api/interviews/' + stoppedInterview.id + '/turns';
    stoppedReq.headers = req.headers;
    const stoppedRes = new EventEmitter(); stoppedRes.writeHead = () => {};
    stoppedRes.write = () => { throw new Error('No writes after disconnect'); }; stoppedRes.end = () => {};
    const inFlight = router.dispatch(stoppedReq, stoppedRes, { session: owner });
    await started; stoppedRes.destroyed = true; stoppedRes.emit('close'); assert(requestSignal.aborted);
    release({ ok: true, mock: true, text: 'Поздняя реплика' }); await inFlight;
    assert.equal(db.interviews.get(owner.id, stoppedInterview.id).turns.length, 1);
    ok('SSE disconnect cancels provider and never persists a late interviewer answer');

  } finally { db.close(); Providers.execute = original; }
  ok('web E2E: finalized mock transcript → real SSE turns route → interview.turn → SQLite text + interviewer reply (no socket)');

  console.log('STT: ' + checks + ' checks passed; no model inference performed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
