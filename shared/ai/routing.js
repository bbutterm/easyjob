/* Серверная конфигурация: JSON содержит только ссылки на переменные окружения. */
'use strict';
const Caps = require('./capabilities.js');
const Variables = require('./variables.js');
const STAGES = Object.freeze({
  'resume.draft': 'pre_interview', 'resume.review': 'pre_interview',
  'vacancy.parse': 'pre_interview', 'match.requirements': 'pre_interview',
  'questions.generate': 'pre_interview', 'answer.feedback': 'pre_interview',
  'prep.card': 'pre_interview', 'interview.summary': 'pre_interview',
  'interview.turn': 'live_interview', 'assistant.hint': 'live_interview',
  'screen.extract': 'live_interview',
  /* Сжатие памяти интервью — структурированная задача: идёт на профиль подготовки. */
  'context.compact': 'pre_interview'
});
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = () => { throw new Error('Некорректная конфигурация AI routing; проверьте docs/providers.md'); };
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value;
}
function json(value) {
  try { return object(JSON.parse(value || '{}')); } catch (_) { fail(); }
}
function positive(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) fail();
  return Number(value);
}
function validate(c, strict) {
  if (!Caps.ids().includes(c.provider)) fail();
  c.timeoutMs = positive(c.timeoutMs, 60000);
  c.maxOutputTokens = positive(c.maxOutputTokens, undefined);
  if (c.maxTokensField && !['max_tokens', 'max_completion_tokens'].includes(c.maxTokensField)) fail();
  if (c.endpoint) {
    let url;
    try { url = new URL(c.endpoint); } catch (_) { fail(); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail();
  }
  if (strict && c.provider !== 'mock' && (!c.model || (!c.apiKey && c.provider !== 'openai_compatible'))) fail();
  return c;
}
function load(env = process.env, legacy) {
  const base = legacy || {
    provider: env.AI_PROVIDER || 'mock', model: env.AI_MODEL || '', apiKey: env.AI_API_KEY || '',
    endpoint: env.AI_ENDPOINT || '', authKey: env.AI_AUTH_KEY || '', scope: env.AI_SCOPE || '',
    folderId: env.AI_FOLDER_ID || '', locale: env.AI_LOCALE || 'ru-RU',
    timeoutMs: env.AI_TIMEOUT_MS || 60000, maxTokensField: env.AI_MAX_TOKENS_FIELD || '',
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS || undefined
  };
  const profiles = Object.create(null);
  profiles.legacy = validate({ ...base }, false);
  const fields = ['provider', 'model', 'endpoint', 'apiKey', 'timeoutMs', 'maxTokensField', 'maxOutputTokens'];
  for (const [name, refs] of Object.entries(json(env.AI_PROFILES_JSON))) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || name === 'legacy') fail();
    object(refs);
    const c = { locale: base.locale, timeoutMs: 60000 };
    for (const [field, ref] of Object.entries(refs)) {
      if (!fields.includes(field) || typeof ref !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(ref)) fail();
      if (!own(env, ref) || !env[ref]) fail();
      c[field] = env[ref];
    }
    profiles[name] = validate(c, true);
  }
  const defaultProfile = env.AI_DEFAULT_PROFILE || 'legacy';
  if (!own(profiles, defaultProfile)) fail();
  const routes = json(env.AI_TASK_ROUTES_JSON);
  for (const [task, name] of Object.entries(routes)) {
    if (!Variables.task(task) || typeof name !== 'string' || !own(profiles, name)) fail();
  }
  const stages = json(env.AI_STAGE_ROUTES_JSON);
  for (const [stage, name] of Object.entries(stages)) {
    if (!['pre_interview', 'live_interview'].includes(stage) || typeof name !== 'string' || !own(profiles, name)) fail();
  }
  return {
    resolve(task) { return { ...profiles[own(routes, task) ? routes[task] : stages[STAGES[task]] || defaultProfile], stage: STAGES[task] || null }; },
    isLive() { return [defaultProfile, ...Object.values(routes), ...Object.values(stages)].some(n => profiles[n].provider !== 'mock'); }
  };
}
module.exports = { load, STAGES };
