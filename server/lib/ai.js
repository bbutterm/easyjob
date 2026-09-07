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
const Pricing = require('./pricing.js');

const GigaChatAuth = require('./gigachat-auth.js');

const Routing = require('../../shared/ai/routing.js');
function config(taskId) { return Routing.load().resolve(taskId); }
function isLive() { return Routing.load().isLive(); }

function describe() {
  const routing = Routing.load();
  const pre = routing.resolve('resume.review');
  const live = routing.resolve('interview.turn');
  const primary = pre.provider !== 'mock' ? pre : routing.resolve();
  const primaryProfile = Capabilities.profile(primary.provider);
  const liveProfile = Capabilities.profile(live.provider);
  const mixed = pre.provider !== live.provider || pre.model !== live.model;
  return {
    provider: primary.provider,
    title: mixed
      ? primaryProfile.title + ' (pre-interview) · ' + liveProfile.title + ' (live)'
      : primaryProfile.title,
    model: primary.model || primaryProfile.defaultModel || '',
    live: routing.isLive(),
    dataRegion: primaryProfile.dataRegion,
    hasKey: !!(primary.apiKey || primary.authKey),
    stages: {
      pre_interview: { provider: pre.provider, model: pre.model || '', live: pre.provider !== 'mock' },
      live_interview: { provider: live.provider, model: live.model || '', live: live.provider !== 'mock' }
    }
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
  const preparing = Routing.STAGES[taskId] === 'pre_interview' && taskId !== 'interview.summary';
  const store = ContextStore.create({ contextBudget: AiRequest.defaultsFor(taskId).contextBudget,
    shares: preparing ? { identity: 0.05, preparation: 0.90, session: 0, moment: 0 } : undefined });
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
  const c = config(taskId);
  const recordUsage = db.usage.forSession(sessionId);
  const opts = options || {};
  const store = buildStore(taskId, parts);
  const built = store.build();
  if (c.stage === 'pre_interview' && built.report.dropped.some(x => /^preparation\.(rawResumeText|vacancyRawText):/.test(x))) {
    return { ok: false, code: 'context_limit', error: 'Исходный текст не помещается в контекст модели. Сократите резюме или вакансию и повторите запрос.', dropped: built.report.dropped };
  }
  const request = AiRequest.build(taskId, built.context, {
    provider: c.provider, model: c.model, locale: c.locale,
    maxOutputTokens: c.maxOutputTokens, streaming: opts.streaming
  });
  if (opts.onDelta) request.onDelta = opts.onDelta;

  const pre = c.stage === 'pre_interview';
  const outerSignal = opts.signal || require('./request-scope.js').getStore()?.signal;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  outerSignal?.addEventListener('abort', cancel, { once: true });
  if (outerSignal?.aborted) cancel();
  let timedOut = false;
  const timeoutMs = Math.min(c.timeoutMs || 60000, 90000);
  const timer = pre ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
  const started = Date.now();
  const pricing = Pricing.load();
  let result;
  try {

    const execute = async () => Providers.execute(request, {
      apiKey: await resolveApiKey(c), endpoint: c.endpoint || undefined, folderId: c.folderId || undefined,
      timeoutMs: c.timeoutMs, maxTokensField: c.maxTokensField, signal: pre ? controller.signal : outerSignal,
      retries: pre ? 0 : undefined,
      disableReasoning: pre && request.outputFormat === 'json',
      onAttemptFailure: failure => recordUsage({
        task: taskId, stage: c.stage, provider: c.provider, model: request.model,
        ...Pricing.account(request, failure, pricing), ok: false, ms: failure.ms
      })
    });
    result = pre ? await new Promise(resolve => {
      const aborted = () => resolve({ ok: false, code: timedOut ? 'timeout' : 'cancelled',
        error: timedOut ? 'Превышено время ожидания модели. Повторите запрос.' : 'Запрос отменён.' });
      if (controller.signal.aborted) return aborted();
      controller.signal.addEventListener('abort', aborted, { once: true });
      execute().then(resolve, () => resolve({ ok: false, code: 'provider_failure', error: 'Сервис модели не ответил' }))
        .finally(() => controller.signal.removeEventListener('abort', aborted));
    }) : await execute();
  } catch (_) {
    result = { ok: false, error: 'Сервис модели не ответил' };
  }
  if (timer) clearTimeout(timer);
  outerSignal?.removeEventListener('abort', cancel);
  if (outerSignal?.aborted) result = { ...result, ok: false, code: 'cancelled', error: 'Запрос отменён.' };
  const ms = Date.now() - started;
  const task = Variables.task(taskId);
  let json = null;
  if (result.ok && task && task.output === 'json') {
    let parsed;
    try { parsed = { ok: true, value: JSON.parse(result.text) }; } catch (_) { parsed = { ok: false }; }
    if (!parsed.ok || result.truncated || ['length', 'max_tokens'].includes(result.stopReason)
      || (taskId === 'resume.review' && !validReview(parsed.value))) {
      result = { ...result, ok: false, code: 'malformed_response',
        error: 'Модель вернула неполный или некорректный структурированный ответ. Повторите разбор.' };
    }
    else json = parsed.value;
  }
  recordUsage({
    task: taskId, stage: c.stage, provider: c.provider, model: request.model,
    ...Pricing.account(request, result, pricing), ok: result.ok, ms
  });
  log.info('ai.task', { task: taskId, stage: c.stage, provider: c.provider, ok: result.ok, ms });

  if (!result.ok) return { ok: false, error: result.error || 'Сервис модели не ответил', code: result.code || 'provider_failure', dropped: built.report.dropped };

  return { ok: true, text: result.text, json, truncated: result.truncated === true,
    source: { provider: c.provider, model: request.model, stage: c.stage },
    mock: result.mock === true, dropped: built.report.dropped, usage: result.usage };
}

function validReview(value) {
  return value && typeof value === 'object' && ['strengths', 'vague', 'missing'].every(k => Array.isArray(value[k]))
    && value.strengths.every(x => typeof x === 'string')
    && value.vague.every(x => x && ['title', 'before', 'after', 'why'].every(k => typeof x[k] === 'string'))
    && value.missing.every(x => x && ['title', 'after', 'why'].every(k => typeof x[k] === 'string'));
}
module.exports = { validReview, run, config, isLive, describe };
