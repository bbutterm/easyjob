/* Обёртка над shared/ai для сервера.

   Здесь единственное место, где живёт ключ провайдера: он берётся из
   окружения и никогда не уходит в ответы и журналы. Контекст собирается
   из записей базы по слоям из docs/context-model.md, расход токенов
   пишется в таблицу usage. */

'use strict';

const ContextStore = require('../../shared/context/store.js');
const AiRequest = require('../../shared/ai/request.js');
const Providers = require('../../shared/ai/providers/index.js');
const Capabilities = require('../../shared/ai/capabilities.js');
const Variables = require('../../shared/ai/variables.js');
const db = require('./db.js');
const log = require('./log.js');

const GigaChatAuth = require('./gigachat-auth.js');

function config() {
  return {
    provider: process.env.AI_PROVIDER || 'mock',
    model: process.env.AI_MODEL || '',
    apiKey: process.env.AI_API_KEY || '',
    /* GigaChat: ключ авторизации обменивается на временный токен сам. */
    authKey: process.env.AI_AUTH_KEY || '',
    scope: process.env.AI_SCOPE || '',
    endpoint: process.env.AI_ENDPOINT || '',
    folderId: process.env.AI_FOLDER_ID || '',
    locale: process.env.AI_LOCALE || 'ru-RU',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 60000
  };
}

function isLive() {
  const c = config();
  return c.provider !== 'mock';
}

/* Политика продукта: закрытые провайдеры и модели не используются.
   Обход только явной переменной AI_ALLOW_CLOSED_PROVIDERS=1 — для
   сравнительной оценки на обезличенных данных, не для пользователей. */
function policyCheck(c) {
  if (!Capabilities.isKnown(c.provider)) {
    return { ok: false, reason: 'неизвестный провайдер «' + c.provider + '»' };
  }
  const verdict = Capabilities.productAllowed(c.provider, c.model);
  if (!verdict.allowed && process.env.AI_ALLOW_CLOSED_PROVIDERS !== '1') {
    return { ok: false, reason: verdict.reason };
  }
  return { ok: true, reason: verdict.allowed ? '' : 'закрытый провайдер разрешён явно (AI_ALLOW_CLOSED_PROVIDERS=1)' };
}

function describe() {
  const c = config();
  const profile = Capabilities.profile(c.provider);
  const policy = policyCheck(c);
  return {
    provider: c.provider,
    known: !!profile,
    title: profile ? profile.title : 'неизвестный провайдер',
    model: c.model || (profile && profile.defaultModel) || '',
    live: c.provider !== 'mock' && !!profile,
    dataRegion: profile ? profile.dataRegion : 'unknown',
    openWeights: profile ? profile.openWeights === true : false,
    hasKey: !!(c.apiKey || c.authKey),
    policyOk: policy.ok,
    policyReason: policy.reason
  };
}

/* Ключ для запроса: как есть, либо временный токен GigaChat по ключу авторизации. */
async function resolveApiKey(c) {
  if (c.provider === 'gigachat' && c.authKey) {
    return GigaChatAuth.getToken(c.authKey, c.scope);
  }
  return c.apiKey;
}

/* ---- Единый сборщик контекста ----
   Порядок на каждом ходе (docs/adr/context-management.md):
     снимок подготовки → подтверждения по текущему вопросу → память →
     окно последних реплик и текущая реплика (ровно один раз).
   Других сборщиков нет: и интервью, и итог, и сжатие идут через buildStore. */
const ContextPolicy = require('../../shared/context/policy.js');
const ContextMemory = require('./context-memory.js');
const Evidence = require('./evidence.js');

/* Жёсткий предел на размер запроса включён всегда; CONTEXT_POLICY=legacy
   возвращает прежние широкие бюджеты слоёв (для сравнения). */
function policyMode() {
  return process.env.CONTEXT_POLICY === 'legacy' ? 'legacy' : 'policy';
}

/* Память интервью и подбор подтверждений — за флагом. Выключен —
   прежнее поведение: окно и свёртка без модели. */
function memoryEnabled() {
  return process.env.CONTEXT_MEMORY === '1';
}

/* Что включено — для /api/health и клиента; секретов здесь нет. */
function contextFlags() {
  return { memory: memoryEnabled(), policy: policyMode(), evidence: memoryEnabled() && db.evidence.available() };
}

const INTERVIEW_TASKS = ['interview.turn', 'interview.summary', 'context.compact'];

/* Компактный снимок подготовки: профиль, требования, версии исходников.
   Строится из версий резюме и вакансии, на которых создана подготовка,
   и сохраняется в preps.snapshot — дальнейшие правки резюме активное
   интервью не меняют. */
function makeSnapshot(prep, resume, vacancy) {
  const r = (resume && resume.data) || {};
  const cut = function (v, n) { return typeof v === 'string' && v.length > n ? v.slice(0, n - 1) + '…' : v; };
  return {
    resumeRev: resume ? resume.rev : prep.resumeRev,
    vacancyRev: vacancy ? vacancy.rev : prep.vacancyRev,
    builtAt: Date.now(),
    profession: prep.profession || r.profession || (vacancy && vacancy.title) || '',
    profile: {
      summary: cut(r.summary, 600),
      experience: (Array.isArray(r.experience) ? r.experience : []).slice(0, 8).map(function (e) {
        return { role: e.role, company: e.company, period: e.period, details: cut(e.details, 500) };
      }),
      skills: (Array.isArray(r.skills) ? r.skills : []).slice(0, 40),
      achievements: (Array.isArray(r.achievements) ? r.achievements : []).slice(0, 12).map(function (a) { return cut(a, 300); }),
      education: (Array.isArray(r.education) ? r.education : []).slice(0, 6)
    },
    vacancy: vacancy ? { title: vacancy.title, company: vacancy.company } : null,
    requirements: (vacancy && vacancy.requirements) || null
  };
}

/* Снимок для подготовки: сохранённый, если он соответствует версиям
   подготовки; иначе строится из текущих исходников и закрепляется.
   sourcesChanged — исходники правились после подготовки: интервью идёт
   на закреплённой версии, и это сообщается, а не скрывается. */
function snapshotFor(sid, prep, resume, vacancy) {
  const saved = prep.snapshot;
  if (saved && saved.resumeRev === prep.resumeRev && saved.vacancyRev === prep.vacancyRev) {
    return { snapshot: saved, pinned: true,
      sourcesChanged: !!((resume && resume.rev !== prep.resumeRev) || (vacancy && vacancy.rev !== prep.vacancyRev)) };
  }
  const fresh = makeSnapshot(prep, resume, vacancy);
  const matchesPrep = fresh.resumeRev === prep.resumeRev && fresh.vacancyRev === prep.vacancyRev;
  if (matchesPrep && sid) db.preps.setSnapshot(sid, prep.id, fresh);
  /* Исходники уже новее подготовки, а снимка не было: старой версии
     больше нет, берём текущую и говорим об этом. */
  return { snapshot: fresh, pinned: matchesPrep, sourcesChanged: !matchesPrep };
}

function buildStore(taskId, parts, sid) {
  const policy = ContextPolicy.policyFor(taskId);
  const legacy = policyMode() === 'legacy';
  const windowTurns = legacy ? 12 : Math.max(2, policy.windowTurns || 8);
  /* Доли слоёв: у задач интервью нет кадра экрана, а память и реплики
     важнее полного профиля — слой session получает больше. Жёсткий
     предел на весь запрос действует поверх долей. */
  const shares = legacy ? undefined
    : taskId === 'interview.turn' ? { identity: 0.05, preparation: 0.30, session: 0.60, moment: 0.02 }
    : (taskId === 'context.compact' || taskId === 'interview.summary') ? { identity: 0.05, preparation: 0.15, session: 0.75, moment: 0.02 }
    : undefined;
  const store = ContextStore.create({
    contextBudget: legacy ? AiRequest.defaultsFor(taskId).contextBudget : policy.inputCap,
    windowTurns, shares
  });
  const prep = parts.prep || {};
  const vacancy = parts.vacancy || null;
  const interview = parts.interview || null;
  const turns = interview ? interview.turns : (parts.turns || null);
  const isInterview = INTERVIEW_TASKS.indexOf(taskId) >= 0 && !!parts.prep;
  const info = { snapshotPinned: false, sourcesChanged: false, memoryVersion: 0, memoryStatus: 'none',
    windowFrom: turns && turns.length ? turns[0].seq || 1 : 0, evidence: [], evidenceVia: 'off' };

  /* Задачи интервью идут на снимке подготовки; остальные (разбор, обзор,
     сопоставление) — на текущих документах, потому что они их и пересобирают. */
  let resume = parts.resume ? parts.resume.data : {};
  let requirements = (vacancy && vacancy.requirements) || null;
  let vacancyBrief = vacancy ? { title: vacancy.title, company: vacancy.company } : undefined;
  if (isInterview) {
    const snap = snapshotFor(sid, prep, parts.resume, vacancy);
    info.snapshotPinned = snap.pinned;
    info.sourcesChanged = snap.sourcesChanged;
    resume = Object.assign({}, snap.snapshot.profile, { profession: snap.snapshot.profession });
    requirements = snap.snapshot.requirements;
    vacancyBrief = snap.snapshot.vacancy || undefined;
    info.snapshot = snap.snapshot;
  }
  const profession = prep.profession || resume.profession || (vacancy && vacancy.title) || '';

  store.set('identity', {
    language: config().locale,
    profession: profession,
    professionKnown: parts.professionKnown !== false
  });

  const weakSpots = (prep.match || []).filter(function (m) { return m.status !== 'confirmed'; })
    .map(function (m) { return m.text + ' — ' + (m.evidence || ''); });

  store.set('preparation', {
    summary: resume.summary || undefined,
    experience: resume.experience || [],
    skills: resume.skills || [],
    achievements: resume.achievements || [],
    education: resume.education || [],
    rawResumeText: resume.rawText || undefined,
    vacancy: vacancyBrief,
    vacancyRawText: vacancy && !isInterview ? vacancy.rawText : undefined,
    requirements: requirements || undefined,
    weakSpots: weakSpots.length ? weakSpots : undefined,
    questions: prep.questions || undefined,
    answers: parts.includeAnswers ? prep.answers : undefined
  });

  if (!turns || !turns.length) return { store, info };

  /* Сжатие: вход — прежняя память (если есть) и только диапазон новых
     реплик. Подтверждения не подбираются, порог не проверяется — из
     собственного сборщика сжатие не запускается. */
  if (taskId === 'context.compact') {
    const range = parts.range || { from: 1, to: Infinity };
    const rangeTurns = turns.filter(function (t) { return t.seq >= range.from && t.seq <= range.to; });
    const prev = parts.previousMemory || null;
    info.memoryVersion = parts.previousVersion || 0;
    info.memoryStatus = prev ? 'valid' : 'none';
    if (prev) {
      /* Прежняя память нужна модели как справочник: что уже известно и
         на какие factId ссылаться в supersedes. Значения укорочены —
         полные хранятся в базе, а не пересылаются каждый проход. */
      store.patch('session', {
        memory: {
          facts: ContextMemory.activeFacts(prev).slice(-40).map(function (f) {
            return Object.assign({}, f, { value: f.value.length > 100 ? f.value.slice(0, 99) + '…' : f.value });
          }),
          contradictions: (prev.contradictions || []).slice(-10),
          unresolvedQuestions: (prev.unresolvedQuestions || []).slice(-10),
          coveredThroughSeq: range.from - 1
        },
        askedTopics: (prev.askedTopics || []).slice(-30)
      });
    }
    rangeTurns.forEach(function (t) { store.addTurn(t); });
    info.windowFrom = rangeTurns.length ? rangeTurns[0].seq : 0;
    info.rangeTo = rangeTurns.length ? rangeTurns[rangeTurns.length - 1].seq : 0;
    return { store, info };
  }

  /* Память: действительная память заменяет покрытые ею реплики за окном.
     Устаревшая (исходники правились) в запрос не идёт — только сообщается. */
  let memoryRow = null;
  let covered = 0;
  if (isInterview && interview && memoryEnabled() && sid) {
    memoryRow = ContextMemory.read(sid, interview.id);
    if (memoryRow) {
      info.memoryVersion = memoryRow.memoryVersion;
      info.memoryStatus = memoryRow.status;
      if (memoryRow.status === 'valid' && taskId !== 'context.compact') {
        covered = memoryRow.coveredThroughSeq || 0;
        const m = memoryRow.memory || {};
        store.patch('session', {
          memory: {
            facts: ContextMemory.activeFacts(m).slice(-40),
            contradictions: m.contradictions || [],
            unresolvedQuestions: m.unresolvedQuestions || [],
            coveredThroughSeq: covered
          },
          askedTopics: (m.askedTopics || []).slice(-30)
        });
      }
    }
  }

  /* Окно: последние windowTurns реплик; реплики до covered за окном
     выбрасываются (их держит память), непокрытые — сворачиваются. */
  let start = Math.max(0, turns.length - windowTurns);
  const firstUncovered = turns.findIndex(function (t) { return (t.seq || 0) > covered; });
  if (covered > 0) start = Math.min(start, firstUncovered < 0 ? turns.length - 1 : firstUncovered);
  else start = 0;
  info.windowFrom = turns[start].seq || (start + 1);
  for (let i = start; i < turns.length; i++) store.addTurn(turns[i]);
  const windowSeqs = store.get('session').turns.map(function (t) { return t.seq; });

  /* Подтверждения по текущему вопросу: прямые ссылки, затем FTS. */
  if (isInterview && memoryEnabled() && sid && taskId !== 'context.compact') {
    let query = '';
    if (taskId === 'interview.summary') {
      query = weakSpots.concat((requirements || []).map(function (r) { return r.text; })).join(' ');
    } else {
      const lastTwo = turns.slice(-2);
      query = lastTwo.map(function (t) { return t.text; }).join(' ');
      if (parts.question) query = parts.question + ' ' + query;
    }
    const picked = Evidence.select(sid, {
      query, requirementId: parts.requirementId || null, prep, snapshot: info.snapshot,
      resumeId: taskId === 'interview.summary' ? null : prep.resumeId,
      interviewId: interview ? interview.id : null, turns, excludeSeqs: windowSeqs,
      limits: taskId === 'interview.summary' ? { direct: 6, resume: 0, turns: 8 } : undefined,
      maxTerms: taskId === 'interview.summary' ? 20 : 8
    });
    if (picked.items.length) store.patch('preparation', { evidence: picked.items });
    info.evidence = picked.items.map(function (e) { return e.source; });
    info.evidenceVia = picked.via;
  }
  return { store, info };
}

/* Выполнить задачу. Возвращает { ok, text, json, usage, error, truncated }. */
async function run(sessionId, taskId, parts, options) {
  const c = config();
  const opts = options || {};
  const requestId = opts.requestId || ('r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const phase = opts.phase || 'main';

  const policy = policyCheck(c);
  if (!policy.ok) {
    log.error('ai.policy', { provider: c.provider, reason: policy.reason, task: taskId });
    return { ok: false, error: 'Сервис модели не настроен: ' + policy.reason, requestId };
  }

  const assembled = buildStore(taskId, parts, sessionId);
  const store = assembled.store;
  const contextInfo = Object.assign({}, assembled.info);
  delete contextInfo.snapshot;
  const fitted = AiRequest.fit(taskId, store, {
    provider: c.provider, model: c.model, locale: c.locale,
    endpoint: c.endpoint || undefined, streaming: opts.streaming,
    thinkingKnownOff: process.env.AI_THINKING_OFF === '1'
  });
  if (!fitted.ok) {
    /* Не помещается даже после сброса всего необязательного — платный
       вызов не делается, пользователь получает понятную ошибку. */
    log.warn('ai.overflow', { requestId, task: taskId, sizing: fitted.sizing });
    db.usage.record(sessionId, { requestId, phase, task: taskId, provider: c.provider, model: c.model,
      ok: false, ms: 0, usageStatus: 'not_applicable', attempts: 0, outcome: 'overflow',
      tokensEstimate: fitted.sizing.inputTokens });
    return { ok: false, overflow: true, error: fitted.error, dropped: fitted.report.dropped, requestId,
      sizing: fitted.sizing, context: contextInfo };
  }
  const request = fitted.request;
  const built = { report: fitted.report };
  if (opts.onDelta) request.onDelta = opts.onDelta;

  const started = Date.now();
  let apiKey;
  try {
    apiKey = await resolveApiKey(c);
  } catch (e) {
    log.error('ai.auth', { provider: c.provider, error: e.message });
    return { ok: false, error: e.message, dropped: built.report.dropped };
  }
  const result = await Providers.execute(request, {
    apiKey, endpoint: c.endpoint || undefined, folderId: c.folderId || undefined,
    timeoutMs: c.timeoutMs, signal: opts.signal
  });
  const ms = Date.now() - started;

  /* Расход пишется по каждой попытке. Если сервис не вернул usage — статус
     «неизвестно», а не ноль: неуспешная попытка тоже может стоить денег. */
  const attemptLog = result.attemptLog && result.attemptLog.length ? result.attemptLog
    : [{ attempt: 1, ok: result.ok, ms, outcome: result.ok ? 'ok' : 'error', usageStatus: result.usage ? 'reported' : 'unknown' }];
  attemptLog.forEach(function (a, i) {
    const isFinal = i === attemptLog.length - 1;
    const u = isFinal ? result.usage : null;
    db.usage.record(sessionId, {
      requestId, phase, task: taskId, provider: c.provider, model: request.model,
      tokensIn: u ? u.input : 0, tokensOut: u ? u.output : 0,
      tokensCacheRead: u ? (u.cacheRead || 0) : 0, tokensReasoning: u ? (u.reasoning || 0) : 0,
      cost: u && u.cost !== undefined ? u.cost : undefined,
      usageStatus: c.provider === 'mock' ? 'not_applicable' : (u ? 'reported' : 'unknown'),
      attempts: attemptLog.length, outcome: a.outcome || null,
      tokensEstimate: request.sizing ? request.sizing.inputTokens : 0,
      estimateExact: request.sizing ? request.sizing.exact : false,
      ok: a.ok, ms: a.ms
    });
  });
  log.info('ai.task', { requestId, phase, task: taskId, provider: c.provider, ok: result.ok, ms,
    attempts: result.attempts, usageStatus: result.usage ? 'reported' : 'unknown',
    sizing: request.sizing, dropped: built.report.dropped, error: result.error });

  if (!result.ok) return { ok: false, error: result.error || 'Сервис модели не ответил', dropped: built.report.dropped, requestId };

  const task = Variables.task(taskId);
  let json = null;
  if (task && task.output === 'json') {
    const parsed = AiRequest.parseJson(result.text);
    if (!parsed.ok) return { ok: false, error: 'Ответ модели не удалось разобрать: ' + parsed.error, raw: result.text };
    json = parsed.value;
  }
  return { ok: true, text: result.text, json, truncated: result.truncated === true,
    mock: result.mock === true, dropped: built.report.dropped, usage: result.usage, requestId,
    sizing: request.sizing, context: contextInfo };
}

module.exports = { run, config, isLive, describe, policyCheck, buildStore, snapshotFor, makeSnapshot, memoryEnabled, contextFlags };
