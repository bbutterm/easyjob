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

function config() {
  return {
    provider: process.env.AI_PROVIDER || 'mock',
    model: process.env.AI_MODEL || '',
    apiKey: process.env.AI_API_KEY || '',
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

function describe() {
  const c = config();
  const profile = Capabilities.profile(c.provider);
  return {
    provider: c.provider,
    title: profile.title,
    model: c.model || profile.defaultModel || '',
    live: c.provider !== 'mock',
    dataRegion: profile.dataRegion,
    hasKey: !!c.apiKey
  };
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
  const store = buildStore(taskId, parts);
  const built = store.build();
  const request = AiRequest.build(taskId, built.context, {
    provider: c.provider, model: c.model, locale: c.locale,
    endpoint: c.endpoint || undefined, streaming: opts.streaming
  });
  if (opts.onDelta) request.onDelta = opts.onDelta;

  const started = Date.now();
  const result = await Providers.execute(request, {
    apiKey: c.apiKey, endpoint: c.endpoint || undefined, folderId: c.folderId || undefined,
    timeoutMs: c.timeoutMs, signal: opts.signal
  });
  const ms = Date.now() - started;

  db.usage.record(sessionId, {
    task: taskId, provider: c.provider, model: request.model,
    tokensIn: result.usage ? result.usage.input : 0,
    tokensOut: result.usage ? result.usage.output : 0,
    ok: result.ok, ms
  });
  log.info('ai.task', { task: taskId, provider: c.provider, ok: result.ok, ms,
    attempts: result.attempts, dropped: built.report.dropped, error: result.error });

  if (!result.ok) return { ok: false, error: result.error || 'Сервис модели не ответил', dropped: built.report.dropped };

  const task = Variables.task(taskId);
  let json = null;
  if (task && task.output === 'json') {
    const parsed = AiRequest.parseJson(result.text);
    if (!parsed.ok) return { ok: false, error: 'Ответ модели не удалось разобрать: ' + parsed.error, raw: result.text };
    json = parsed.value;
  }
  return { ok: true, text: result.text, json, truncated: result.truncated === true,
    mock: result.mock === true, dropped: built.report.dropped, usage: result.usage };
}

module.exports = { run, config, isLive, describe };
