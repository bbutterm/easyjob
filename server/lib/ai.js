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

/* Сборка контекста из записей базы. resume.data — структура резюме
   ({ profession, summary, experience, skills, achievements, education }
   либо { rawText }). */
function buildStore(taskId, parts) {
  const store = ContextStore.create({ contextBudget: AiRequest.defaultsFor(taskId).contextBudget });
  const resume = parts.resume ? parts.resume.data : {};
  const prep = parts.prep || {};
  const vacancy = parts.vacancy || null;
  const profession = prep.profession || resume.profession || (vacancy && vacancy.title) || '';

  store.set('identity', {
    language: config().locale,
    profession: profession,
    professionKnown: parts.professionKnown !== false
  });

  const requirements = (vacancy && vacancy.requirements) || null;
  const weakSpots = (prep.match || []).filter(function (m) { return m.status !== 'confirmed'; })
    .map(function (m) { return m.text + ' — ' + (m.evidence || ''); });

  store.set('preparation', {
    summary: resume.summary || undefined,
    experience: resume.experience || [],
    skills: resume.skills || [],
    achievements: resume.achievements || [],
    education: resume.education || [],
    rawResumeText: resume.rawText || undefined,
    vacancy: vacancy ? { title: vacancy.title, company: vacancy.company } : undefined,
    vacancyRawText: vacancy ? vacancy.rawText : undefined,
    requirements: requirements || undefined,
    weakSpots: weakSpots.length ? weakSpots : undefined,
    questions: prep.questions || undefined,
    answers: parts.includeAnswers ? prep.answers : undefined
  });

  if (parts.turns) {
    parts.turns.forEach(function (t) { store.addTurn(t); });
  }
  return store;
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

  const store = buildStore(taskId, parts);
  const built = store.build();
  const request = AiRequest.build(taskId, built.context, {
    provider: c.provider, model: c.model, locale: c.locale,
    endpoint: c.endpoint || undefined, streaming: opts.streaming
  });
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
      ok: a.ok, ms: a.ms
    });
  });
  log.info('ai.task', { requestId, phase, task: taskId, provider: c.provider, ok: result.ok, ms,
    attempts: result.attempts, usageStatus: result.usage ? 'reported' : 'unknown',
    dropped: built.report.dropped, error: result.error });

  if (!result.ok) return { ok: false, error: result.error || 'Сервис модели не ответил', dropped: built.report.dropped, requestId };

  const task = Variables.task(taskId);
  let json = null;
  if (task && task.output === 'json') {
    const parsed = AiRequest.parseJson(result.text);
    if (!parsed.ok) return { ok: false, error: 'Ответ модели не удалось разобрать: ' + parsed.error, raw: result.text };
    json = parsed.value;
  }
  return { ok: true, text: result.text, json, truncated: result.truncated === true,
    mock: result.mock === true, dropped: built.report.dropped, usage: result.usage, requestId };
}

module.exports = { run, config, isLive, describe, policyCheck };
