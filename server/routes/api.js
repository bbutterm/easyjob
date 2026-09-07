/* Маршруты API. Все данные привязаны к сессии: чужие записи не видны
   даже при знании идентификатора. */

'use strict';

const db = require('../lib/db.js');
const ai = require('../lib/ai.js');
const Compact = require('../lib/context-compact.js');
const UrlImport = require('../lib/url-import.js');
const SttServer = require('../lib/stt-server.js');
const TtsServer = require('../lib/tts-server.js');
const log = require('../lib/log.js');

/* Ошибка задачи модели → HTTP: переполнение контекста 422, таймаут 504,
   отмена 499, остальное 502. Код ошибки всегда в теле ответа. */
function aiError(result) {
  const status = result.overflow || result.code === 'context_limit' ? 422
    : result.code === 'timeout' ? 504 : result.code === 'cancelled' ? 499 : 502;
  const extra = { code: result.code || 'provider_failure' };
  if (result.overflow) { extra.overflow = true; extra.sizing = result.sizing; }
  return new HttpError(status, result.error, extra);
}
const { HttpError, sendJson } = require('../lib/router.js');
const Professions = require('../../src/professions.js');

function str(value, max, name, required) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (required && !s) throw new HttpError(400, 'Не заполнено поле: ' + name);
  if (s.length > max) throw new HttpError(400, 'Слишком длинное поле: ' + name);
  return s;
}

/* Идентификаторы из ответа модели: только буквы, цифры, дефис и
   подчёркивание. Иначе ключ вроде __proto__ попадёт в объект ответов. */
const FORBIDDEN_IDS = ['__proto__', 'constructor', 'prototype'];
function safeId(value, fallback) {
  const v = String(value === undefined || value === null ? '' : value);
  if (FORBIDDEN_IDS.indexOf(v) >= 0) return fallback;
  return /^[A-Za-z0-9_-]{1,32}$/.test(v) ? v : fallback;
}

function limitsFor(session, ctx) {
  const free = ctx.freePrepsPerDay;
  const paid = session.paid_until && session.paid_until > Date.now();
  const today = db.preps.countToday(session.id, ctx.ipHash);
  return { freePerDay: free, usedToday: today, paid, remaining: paid ? null : Math.max(0, free - today) };
}

function stale(prep, resume, vacancy) {
  if (!resume) return { stale: true, reason: 'Резюме удалено.' };
  if (!vacancy) return { stale: true, reason: 'Вакансия удалена.' };
  if (resume.rev !== prep.resumeRev) return { stale: true, reason: 'Резюме изменилось после анализа.' };
  if (vacancy.rev !== prep.vacancyRev) return { stale: true, reason: 'Вакансия изменилась после анализа.' };
  return { stale: false, reason: '' };
}

/* Состояние подготовки: цепочка шагов, каждый достигнут после сохранённого
   действия пользователя и переживает перезагрузку. Возвращается и самый
   дальний достигнутый шаг, и отметки по каждому. */
const PREP_STATES = ['resume_selected', 'vacancy_selected', 'vacancy_requirements_ready', 'match_ready', 'questions_ready',
  'answers_started', 'feedback_ready', 'prep_card_ready', 'text_interview_started', 'text_interview_finished', 'live_interview_available'];

function prepState(prep, resume, vacancy, interview) {
  const answers = prep.answers || {};
  const reached = {
    resume_selected: !!resume,
    vacancy_selected: !!vacancy,
    vacancy_requirements_ready: !!(vacancy && vacancy.requirements && vacancy.requirements.length),
    match_ready: !!(prep.match && prep.match.length),
    questions_ready: !!(prep.questions && prep.questions.length),
    answers_started: Object.keys(answers).some(function (k) { return String(answers[k] || '').trim(); }),
    feedback_ready: Object.keys(prep.feedback || {}).length > 0,
    prep_card_ready: !!prep.card,
    text_interview_started: !!(interview && interview.turns.length > 1),
    text_interview_finished: !!(interview && interview.finished),
    live_interview_available: !!(interview && interview.finished)
  };
  let current = 'resume_selected';
  for (let i = 0; i < PREP_STATES.length; i++) {
    if (reached[PREP_STATES[i]]) current = PREP_STATES[i]; else break;
  }
  return { current, reached };
}

function prepView(sid, prep) {
  const resume = db.resumes.get(sid, prep.resumeId);
  const vacancy = db.vacancies.get(sid, prep.vacancyId);
  const s = stale(prep, resume, vacancy);
  const interview = db.interviews.latestForPrep(sid, prep.id);
  const state = prepState(prep, resume, vacancy, interview);
  return Object.assign({}, prep, {
    stale: s.stale, staleReason: s.reason, state: state.current, states: state.reached,
    resume: resume ? { id: resume.id, title: resume.title, rev: resume.rev } : null,
    vacancy: vacancy ? { id: vacancy.id, title: vacancy.title, company: vacancy.company, rev: vacancy.rev,
      requirements: vacancy.requirements } : null,
    interview: interview ? { id: interview.id, finished: interview.finished, turns: interview.turns.length } : null
  });
}

/* Требования вакансии: если ещё не извлечены — извлечь. */
async function ensureRequirements(sid, vacancy) {
  if (vacancy.requirements && vacancy.requirements.length) return vacancy;
  const result = await ai.run(sid, 'vacancy.parse', { vacancy });
  if (!result.ok) throw aiError(result);
  const reqs = Array.isArray(result.json.requirements) ? result.json.requirements : [];
  if (!reqs.length) throw new HttpError(422, 'В тексте вакансии не удалось выделить требования.');
  const cleaned = reqs.map(function (r, i) {
    return { id: safeId(r.id, 'req-' + (i + 1)), text: str(r.text, 300, 'requirement', true),
      kind: r.kind || 'hard', weight: Number(r.weight) || 1 };
  });
  db.vacancies.setRequirements(sid, vacancy.id, cleaned);
  return db.vacancies.get(sid, vacancy.id);
}

/* Сопоставление резюме с требованиями. Результат хранится вместе с текстом
   требования, чтобы экран не зависел от изменения вакансии. */
async function buildMatch(sid, prep, resume, vacancy) {
  const result = await ai.run(sid, 'match.requirements', { resume, vacancy, prep });
  if (!result.ok) throw aiError(result);
  const byId = {};
  (vacancy.requirements || []).forEach(function (r) { byId[r.id] = r; });
  const items = (result.json.items || []).map(function (m) {
    const req = byId[m.requirementId] || {};
    const status = ['confirmed', 'unclear', 'missing'].indexOf(m.status) >= 0 ? m.status : 'unclear';
    return { id: m.requirementId, text: req.text || '', status,
      evidence: str(m.evidence, 600, 'evidence'), advice: str(m.advice, 600, 'advice') };
  }).filter(function (m) { return m.text; });
  /* Требования, которые модель пропустила, показываются как «нужно уточнить». */
  (vacancy.requirements || []).forEach(function (r) {
    if (!items.some(function (m) { return m.id === r.id; })) {
      items.push({ id: r.id, text: r.text, status: 'unclear', evidence: 'Модель не дала оценку по этому требованию.',
        advice: 'Проверьте вручную, есть ли подтверждение в резюме.' });
    }
  });
  return { items, mock: result.mock, dropped: result.dropped, source: sourceOf(result) };
}

/* Метаданные источника результата: режим, провайдер, модель, этап, время.
   Без секретов, промптов и текстов. */
function sourceOf(result) {
  return Object.assign({ mode: result.mock ? 'mock' : 'real', createdAt: Date.now() }, result.source || {});
}

function withSource(prep, key, source) {
  const sources = Object.assign({}, prep.sources || {});
  sources[key] = source;
  return sources;
}

/* Дорогие операции не дублируются: повторный запрос, пока первый в работе,
   получает 409 duplicate, а не второй платный вызов. */
const inflight = new Set();
function hold(key) {
  if (inflight.has(key)) throw new HttpError(409, 'Операция уже выполняется. Дождитесь ответа или отмените запрос.', { code: 'duplicate' });
  inflight.add(key);
  return function () { inflight.delete(key); };
}

function register(r) {
  const reviews = new Set();
  r.get('/api/health', function ({ res }) {
    sendJson(res, 200, { ok: true, ai: ai.describe(), context: ai.contextFlags(), time: Date.now() });
  });

  r.get('/api/me', function ({ res, ctx }) {
    const sid = ctx.session.id;
    sendJson(res, 200, {
      user: require('../lib/auth.js').publicUser(db.users.get(ctx.session.user_id || '')),
      auth: { mode: 'local', demo: ctx.demoAuth },
      session: { id: sid, createdAt: ctx.session.created_at },
      ai: ai.describe(),
      limits: limitsFor(ctx.session, ctx),
      usage: db.usage.totals(sid),
      professions: Professions.list(),
      resumes: db.resumes.list(sid).map(function (x) { return { id: x.id, title: x.title, rev: x.rev, updatedAt: x.updatedAt }; }),
      vacancies: db.vacancies.list(sid).map(function (x) { return { id: x.id, title: x.title, company: x.company, rev: x.rev }; }),
      preps: db.preps.list(sid).map(function (p) { return prepView(sid, p); })
    });
  });

  /* Удалить все свои данные немедленно: резюме, вакансии, подготовки,
     интервью и саму сессию. Cookie сбрасывается. */
  r.del('/api/me', function ({ res, ctx }) {
    const removed = db.sessions.removeOne(ctx.session.id);
    res.setHeader('set-cookie', require('../lib/session.js').clearCookieHeader(ctx.secure));
    sendJson(res, 200, Object.assign({ ok: true }, removed));
  });

  /* ---- Резюме ---- */

  r.post('/api/resumes/extract', async function ({ res, body }) {
    const rawText = await require('../lib/resume-extract.js').extract(body, require('../lib/request-scope.js').getStore()?.signal);
    sendJson(res, 200, { rawText });
  });

  r.post('/api/resumes', function ({ res, body, ctx }) {
    const sid = ctx.session.id;
    const title = str(body.title, 200, 'title', true);
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    if (data.rawText) data.rawText = str(data.rawText, 40000, 'rawText');
    const hasContent = data.rawText || (Array.isArray(data.experience) && data.experience.length)
      || (Array.isArray(data.skills) && data.skills.length) || data.summary;
    if (!hasContent) throw new HttpError(400, 'Резюме пустое: нужен текст или хотя бы опыт и навыки.');
    sendJson(res, 201, db.resumes.create(sid, title, data));
  });

  r.get('/api/resumes', function ({ res, ctx }) {
    sendJson(res, 200, db.resumes.list(ctx.session.id));
  });

  r.get('/api/resumes/:id', function ({ res, params, ctx }) {
    const resume = db.resumes.get(ctx.session.id, params.id);
    if (!resume) throw new HttpError(404, 'Резюме не найдено');
    sendJson(res, 200, resume);
  });

  r.put('/api/resumes/:id', function ({ res, params, body, ctx }) {
    const sid = ctx.session.id;
    const existing = db.resumes.get(sid, params.id);
    if (!existing) throw new HttpError(404, 'Резюме не найдено');
    const title = str(body.title !== undefined ? body.title : existing.title, 200, 'title', true);
    if (!body.data || typeof body.data !== 'object') {
      sendJson(res, 200, db.resumes.rename(sid, params.id, title));
      return;
    }
    const updated = db.resumes.update(sid, params.id, title, body.data);
    /* Память интервью по подготовкам с этим резюме устарела, но не удаляется:
       активное интервью продолжает работать на прежней версии с пометкой. */
    db.preps.list(sid).filter(function (p) { return p.resumeId === params.id; })
      .forEach(function (p) { db.contextMemory.markStaleForPrep(sid, p.id); });
    sendJson(res, 200, updated);
  });

  r.del('/api/resumes/:id', function ({ res, params, ctx }) {
    if (!db.resumes.remove(ctx.session.id, params.id)) throw new HttpError(404, 'Резюме не найдено');
    sendJson(res, 200, { ok: true });
  });

  r.post('/api/resumes/:id/review', async function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const resume = db.resumes.get(sid, params.id);
    if (!resume) throw new HttpError(404, 'Резюме не найдено');
    const key = sid + ':' + resume.id;
    if (reviews.has(key)) throw new HttpError(409, 'Разбор уже выполняется. Дождитесь ответа или отмените запрос.', { code: 'duplicate' });
    reviews.add(key);
    try {
      const result = await ai.run(sid, 'resume.review', { resume });
      if (!result.ok) throw aiError(result);
      const current = db.resumes.get(sid, resume.id);
      if (!current || current.rev !== resume.rev) throw new HttpError(409, 'Резюме изменилось во время разбора. Повторите запрос.');
      /* В базе разбор лежит вместе с источником (переживает перезагрузку);
         в ответе контракт разбора остаётся чистым, источник — отдельным полем. */
      const source = sourceOf(result);
      db.resumes.setReview(sid, resume.id, Object.assign({}, result.json, { source }));
      sendJson(res, 200, { review: result.json, mock: result.mock, source, dropped: result.dropped });
    } finally { reviews.delete(key); }
  });

  /* ---- Вакансии ---- */

  /* Получить вакансию по публичной ссылке. Сервер читает страницу сам,
     без куки и заголовков пользователя, с защитой от адресов внутренней
     сети (server/lib/url-import.js). Результат — предпросмотр: текст
     показывается пользователю и уходит в разбор только после его правки
     и подтверждения через POST /api/vacancies. */
  r.post('/api/vacancies/import-url', async function ({ res, body }) {
    const url = str(body.url, 2048, 'url', true);
    const signal = require('../lib/request-scope.js').getStore()?.signal;
    try {
      const vacancy = await UrlImport.importUrl(url, { signal });
      sendJson(res, 200, { ok: true, vacancy });
    } catch (e) {
      /* Ожидаемый отказ импорта — не ошибка запроса: { ok:false, code, error }
         с кодом 200, чтобы клиент показал причину и предложил вставить текст. */
      if (e instanceof HttpError && e.extra && e.extra.ok === false) {
        sendJson(res, 200, { ok: false, code: e.extra.code, error: e.message });
        return;
      }
      throw e;
    }
  });

  r.post('/api/vacancies', async function ({ res, body, ctx }) {
    const sid = ctx.session.id;
    const title = str(body.title, 200, 'title', true);
    const company = str(body.company, 200, 'company');
    const rawText = str(body.rawText, 40000, 'rawText', true);
    if (rawText.length < 40) throw new HttpError(400, 'Текст вакансии слишком короткий, чтобы выделить требования.');
    /* Источник — только из поддерживаемого набора; адрес сохраняется без токенов. */
    const origin = {};
    if (body.sourceUrl) {
      origin.sourceUrl = UrlImport.redactUrl(UrlImport.validateUrl(str(body.sourceUrl, 2048, 'sourceUrl')).url);
      origin.source = ['jsonld', 'meta', 'html', 'text'].indexOf(body.source) >= 0 ? body.source : 'html';
      origin.retrievedAt = Number(body.retrievedAt) || Date.now();
    }
    let vacancy = db.vacancies.create(sid, title, company, rawText, origin);
    vacancy = await ensureRequirements(sid, vacancy);
    sendJson(res, 201, vacancy);
  });

  r.get('/api/vacancies', function ({ res, ctx }) {
    sendJson(res, 200, db.vacancies.list(ctx.session.id));
  });

  r.get('/api/vacancies/:id', function ({ res, params, ctx }) {
    const vacancy = db.vacancies.get(ctx.session.id, params.id);
    if (!vacancy) throw new HttpError(404, 'Вакансия не найдена');
    sendJson(res, 200, vacancy);
  });

  /* Правка текста: версия растёт, требования извлекаются заново,
     подготовки на прежней версии помечаются устаревшими (по rev). */
  r.put('/api/vacancies/:id', async function ({ res, params, body, ctx }) {
    const sid = ctx.session.id;
    const current = db.vacancies.get(sid, params.id);
    if (!current) throw new HttpError(404, 'Вакансия не найдена');
    const title = str(body.title !== undefined ? body.title : current.title, 200, 'title', true);
    const company = str(body.company !== undefined ? body.company : current.company, 200, 'company');
    const rawText = str(body.rawText !== undefined ? body.rawText : current.rawText, 40000, 'rawText', true);
    if (rawText.length < 40) throw new HttpError(400, 'Текст вакансии слишком короткий, чтобы выделить требования.');
    let vacancy = db.vacancies.update(sid, current.id, title, company, rawText);
    vacancy = await ensureRequirements(sid, vacancy);
    sendJson(res, 200, vacancy);
  });

  r.del('/api/vacancies/:id', function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const used = db.preps.list(sid).some(function (p) { return p.vacancyId === params.id; });
    if (used) throw new HttpError(409, 'Вакансия используется в подготовке: сначала удалите подготовку.');
    if (!db.vacancies.remove(sid, params.id)) throw new HttpError(404, 'Вакансия не найдена');
    sendJson(res, 200, { ok: true });
  });

  /* ---- Подготовки ---- */

  r.post('/api/preps', async function ({ res, body, ctx }) {
    const sid = ctx.session.id;
    const limits = limitsFor(ctx.session, ctx);
    if (!limits.paid && limits.remaining <= 0) {
      throw new HttpError(429, 'Лимит на сегодня исчерпан: ' + limits.freePerDay + ' подготовк(и) в день.', { limits });
    }
    const resume = db.resumes.get(sid, str(body.resumeId, 64, 'resumeId', true));
    if (!resume) throw new HttpError(404, 'Резюме не найдено');
    let vacancy = db.vacancies.get(sid, str(body.vacancyId, 64, 'vacancyId', true));
    if (!vacancy) throw new HttpError(404, 'Вакансия не найдена');
    vacancy = await ensureRequirements(sid, vacancy);

    const profession = str(body.profession || resume.data.profession || vacancy.title, 200, 'profession');
    let prep = db.preps.create(sid, resume, vacancy, profession);
    const match = await buildMatch(sid, prep, resume, vacancy);
    prep = db.preps.set(sid, prep.id, { match: match.items, sources: withSource(prep, 'match', match.source) });
    sendJson(res, 201, Object.assign(prepView(sid, prep), { mock: match.mock, dropped: match.dropped, source: match.source }));
  });

  r.get('/api/preps', function ({ res, ctx }) {
    const sid = ctx.session.id;
    sendJson(res, 200, db.preps.list(sid).map(function (p) { return prepView(sid, p); }));
  });

  r.get('/api/preps/:id', function ({ res, params, ctx }) {
    const prep = db.preps.get(ctx.session.id, params.id);
    if (!prep) throw new HttpError(404, 'Подготовка не найдена');
    sendJson(res, 200, prepView(ctx.session.id, prep));
  });

  r.del('/api/preps/:id', function ({ res, params, ctx }) {
    if (!db.preps.remove(ctx.session.id, params.id)) throw new HttpError(404, 'Подготовка не найдена');
    sendJson(res, 200, { ok: true });
  });

  /* Пересборка под текущие версии исходников. */
  r.post('/api/preps/:id/rebuild', async function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    let prep = db.preps.get(sid, params.id);
    if (!prep) throw new HttpError(404, 'Подготовка не найдена');
    const release = hold(sid + ':rebuild:' + params.id);
    try {
      const resume = db.resumes.get(sid, prep.resumeId);
      let vacancy = db.vacancies.get(sid, prep.vacancyId);
      if (!resume || !vacancy) throw new HttpError(409, 'Исходники удалены: пересобрать нельзя.');
      vacancy = await ensureRequirements(sid, vacancy);
      /* Сначала новое сопоставление, потом сброс старого: неудачный вызов
         модели не стирает прежний результат подготовки. */
      const match = await buildMatch(sid, prep, resume, vacancy);
      prep = db.preps.rebuild(sid, prep.id, resume, vacancy);
      prep = db.preps.set(sid, prep.id, { match: match.items, sources: withSource(prep, 'match', match.source) });
      sendJson(res, 200, Object.assign(prepView(sid, prep), { mock: match.mock, source: match.source }));
    } finally { release(); }
  });

  r.post('/api/preps/:id/questions', async function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const prep = db.preps.get(sid, params.id);
    if (!prep) throw new HttpError(404, 'Подготовка не найдена');
    const release = hold(sid + ':questions:' + params.id);
    try {
      const resume = db.resumes.get(sid, prep.resumeId);
      const vacancy = db.vacancies.get(sid, prep.vacancyId);
      const result = await ai.run(sid, 'questions.generate', { resume, vacancy, prep });
      if (!result.ok) throw aiError(result);
      const questions = (result.json.questions || []).map(function (q, i) {
        return { id: safeId(q.id, 'q' + (i + 1)), topic: str(q.topic, 60, 'topic') || 'Общее',
          text: str(q.text, 500, 'text', true), why: str(q.why, 500, 'why'), guidance: str(q.guidance, 800, 'guidance') };
      });
      if (!questions.length) throw new HttpError(502, 'Модель не вернула ни одного вопроса.');
      db.preps.set(sid, prep.id, { questions });
      db.preps.set(sid, prep.id, { sources: withSource(db.preps.get(sid, prep.id), 'questions', sourceOf(result)) });
      sendJson(res, 200, { questions, mock: result.mock, dropped: result.dropped, source: sourceOf(result) });
    } finally { release(); }
  });

  r.put('/api/preps/:id/answers', function ({ res, params, body, ctx }) {
    const sid = ctx.session.id;
    const prep = db.preps.get(sid, params.id);
    if (!prep) throw new HttpError(404, 'Подготовка не найдена');
    const answers = {};
    Object.keys(body.answers || {}).forEach(function (key) {
      const k = safeId(key, null);
      if (!k) throw new HttpError(400, 'Недопустимый идентификатор вопроса');
      answers[k] = str(body.answers[key], 4000, 'answer');
    });
    const ready = {};
    Object.keys(body.ready || {}).forEach(function (key) {
      const k = safeId(key, null);
      if (!k) throw new HttpError(400, 'Недопустимый идентификатор вопроса');
      ready[k] = !!body.ready[key];
    });
    const updated = db.preps.set(sid, prep.id, { answers, ready });
    sendJson(res, 200, { answers: updated.answers, ready: updated.ready });
  });

  /* Обратная связь на один ответ. Модели уходят только этот вопрос и этот
     ответ. Результат хранится по questionId вместе с отпечатком ответа:
     когда ответ меняется, прежняя обратная связь помечается устаревшей. */
  const feedbacks = new Set();
  r.post('/api/preps/:id/feedback', async function ({ res, params, body, ctx }) {
    const sid = ctx.session.id;
    const prep = db.preps.get(sid, params.id);
    if (!prep) throw new HttpError(404, 'Подготовка не найдена');
    const questionId = safeId(body.questionId, null);
    const question = (prep.questions || []).find(function (q) { return q.id === questionId; });
    if (!question) throw new HttpError(404, 'Вопрос не найден в этой подготовке');
    const answer = String((prep.answers || {})[questionId] || '').trim();
    if (!answer) throw new HttpError(400, 'Сначала напишите ответ на вопрос.', { code: 'empty_answer' });
    const key = sid + ':' + prep.id + ':' + questionId;
    if (feedbacks.has(key)) throw new HttpError(409, 'Обратная связь уже готовится. Дождитесь ответа.', { code: 'duplicate' });
    feedbacks.add(key);
    try {
      const resume = db.resumes.get(sid, prep.resumeId);
      const vacancy = db.vacancies.get(sid, prep.vacancyId);
      const result = await ai.run(sid, 'answer.feedback', { resume, vacancy, prep, includeAnswers: true, questionId });
      if (!result.ok) throw aiError(result);
      const fb = result.json || {};
      const clean = {
        strong: (Array.isArray(fb.strong) ? fb.strong : []).map(function (x) { return str(x, 400, 'strong'); }).filter(Boolean).slice(0, 5),
        gaps: (Array.isArray(fb.gaps) ? fb.gaps : []).map(function (x) { return str(x, 400, 'gaps'); }).filter(Boolean).slice(0, 5),
        rewrite: str(fb.rewrite, 2000, 'rewrite')
      };
      if (!clean.strong.length && !clean.gaps.length && !clean.rewrite) {
        throw new HttpError(502, 'Модель вернула пустую обратную связь. Повторите запрос.', { code: 'malformed_response' });
      }
      const current = db.preps.get(sid, prep.id);
      const currentAnswer = String((current.answers || {})[questionId] || '').trim();
      const entry = Object.assign(clean, {
        answerText: currentAnswer.slice(0, 4000),
        source: Object.assign({ mode: result.mock ? 'mock' : 'real', createdAt: Date.now() }, result.source || {})
      });
      const feedback = Object.assign({}, current.feedback || {});
      feedback[questionId] = entry;
      const saved = db.preps.set(sid, prep.id, { feedback });
      sendJson(res, 200, { questionId, feedback: entry, mock: result.mock, source: entry.source, state: prepView(sid, saved).state });
    } finally { feedbacks.delete(key); }
  });

  r.post('/api/preps/:id/card', async function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const prep = db.preps.get(sid, params.id);
    if (!prep) throw new HttpError(404, 'Подготовка не найдена');
    const release = hold(sid + ':card:' + params.id);
    try {
      const resume = db.resumes.get(sid, prep.resumeId);
      const vacancy = db.vacancies.get(sid, prep.vacancyId);
      const result = await ai.run(sid, 'prep.card', { resume, vacancy, prep, includeAnswers: true });
      if (!result.ok) throw aiError(result);
      db.preps.set(sid, prep.id, { card: result.json });
      db.preps.set(sid, prep.id, { sources: withSource(db.preps.get(sid, prep.id), 'card', sourceOf(result)) });
      sendJson(res, 200, { card: result.json, mock: result.mock, dropped: result.dropped, source: sourceOf(result) });
    } finally { release(); }
  });

  /* ---- Распознавание речи на сервере ----
     Микрофон включает пользователь в браузере; сюда приходит только
     готовый WAV фрагмента (до 1 МБ) с явным согласием. Аудио и текст не
     сохраняются; в ответе — текст, признак заглушки и длительность. */
  r.post('/api/stt/transcribe', async function ({ res, body, ctx }) {
    if (body.consent !== true) throw new HttpError(400, 'Нужно подтвердить согласие на запись и распознавание.', { code: 'consent_required' });
    const b64 = typeof body.wavBase64 === 'string' ? body.wavBase64 : '';
    if (!b64 || b64.length > Math.ceil(SttServer.MAX_WAV / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
      throw new HttpError(413, 'Аудио: WAV до 1 МБ в base64.', { code: 'bad_audio' });
    }
    const bytes = Buffer.from(b64, 'base64');
    const signal = require('../lib/request-scope.js').getStore()?.signal;
    const result = await SttServer.transcribe(bytes, { signal });
    log.info('stt.transcribe', { session: ctx.session.id.slice(0, 6), bytes: bytes.length, ms: result.latencyMs, mock: result.mock, chars: result.text.length });
    sendJson(res, 200, { ok: true, text: result.text, mock: result.mock, provider: result.provider, latencyMs: result.latencyMs });
  });

  r.get('/api/stt', function ({ res }) {
    sendJson(res, 200, SttServer.describe());
  });

  /* ---- Синтез речи на сервере ----
     Фраза интервьюера (до 600 знаков) → аудио. Ключ сервиса синтеза на
     сервере, текст не хранится. Заглушка отдаёт тишину с пометкой. */
  r.post('/api/tts/speak', async function ({ res, body, ctx }) {
    const text = str(body.text, TtsServer.MAX_TEXT + 1, 'text', true);
    const voice = body.voice ? str(body.voice, 80, 'voice') : '';
    if (voice && !/^[A-Za-z0-9_.-]+$/.test(voice)) throw new HttpError(400, 'Недопустимое имя голоса.');
    const signal = require('../lib/request-scope.js').getStore()?.signal;
    const out = await TtsServer.speak(text, { voice, signal });
    log.info('tts.speak', { session: ctx.session.id.slice(0, 6), chars: text.length, ms: out.latencyMs, mock: out.mock, bytes: out.bytes.length });
    res.writeHead(200, { 'content-type': out.type, 'content-length': out.bytes.length, 'cache-control': 'no-store',
      'x-tts-mock': out.mock ? '1' : '0', 'x-tts-provider': out.provider });
    res.end(out.bytes);
  });

  r.get('/api/tts', function ({ res }) {
    sendJson(res, 200, TtsServer.describe());
  });

  /* ---- Помощник на собеседовании: текстовый контур через сервер ----
     Экран и звук веб-версия не захватывает: пользователь вставляет или
     диктует текст. Оба маршрута требуют явного согласия участников,
     идут на профиль живого интервью (Cerebras) и учитываются как
     stage live_interview. Ничего из текста не хранится. */
  r.post('/api/assistant/extract', async function ({ res, body, ctx }) {
    if (body.consent !== true) throw new HttpError(400, 'Нужно подтвердить согласие участников разговора.', { code: 'consent_required' });
    const text = str(body.text, 8000, 'text', true);
    const textDelta = str(body.textDelta, 4000, 'textDelta');
    const result = await ai.run(ctx.session.id, 'screen.extract', { moment: { text, textDelta: textDelta || undefined, captureConsent: true } });
    if (!result.ok) throw aiError(result);
    const j = result.json || {};
    const question = j.question === null || j.question === undefined ? null : str(j.question, 500, 'question');
    const confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0));
    const speakerGuess = ['interviewer', 'candidate', 'unknown'].indexOf(j.speakerGuess) >= 0 ? j.speakerGuess : 'unknown';
    sendJson(res, 200, { question: question || null, confidence, speakerGuess, mock: result.mock, source: sourceOf(result) });
  });

  r.post('/api/assistant/hint', async function ({ res, body, ctx }) {
    const sid = ctx.session.id;
    if (body.consent !== true) throw new HttpError(400, 'Нужно подтвердить согласие участников разговора.', { code: 'consent_required' });
    const prep = db.preps.get(sid, str(body.prepId, 64, 'prepId', true));
    if (!prep) throw new HttpError(404, 'Подготовка не найдена');
    const question = str(body.question, 1000, 'question', true);
    const askedTopics = (Array.isArray(body.askedTopics) ? body.askedTopics : []).slice(0, 30).map(function (t) { return str(t, 80, 'topic'); }).filter(Boolean);
    const resume = db.resumes.get(sid, prep.resumeId);
    const vacancy = db.vacancies.get(sid, prep.vacancyId);
    const result = await ai.run(sid, 'assistant.hint', { resume, vacancy, prep, askedTopics,
      moment: { detectedQuestion: question, captureConsent: true } });
    if (!result.ok) throw aiError(result);
    const j = result.json || {};
    const hint = { direction: str(j.direction, 600, 'direction'), remind: j.remind ? str(j.remind, 400, 'remind') : null,
      avoid: j.avoid ? str(j.avoid, 400, 'avoid') : null };
    if (!hint.direction) throw new HttpError(502, 'Модель не дала направление ответа. Повторите запрос.', { code: 'malformed_response' });
    sendJson(res, 200, Object.assign(hint, { question, mock: result.mock, source: sourceOf(result), dropped: result.dropped }));
  });

  /* ---- Интервью ---- */

  r.post('/api/preps/:id/interviews', async function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const prep = db.preps.get(sid, params.id);
    if (!prep) throw new HttpError(404, 'Подготовка не найдена');
    const interview = db.interviews.create(sid, prep.id);
    const first = await interviewerTurn(sid, prep, interview, null);
    sendJson(res, 201, first);
  });

  r.get('/api/interviews/:id', function ({ res, params, ctx }) {
    const interview = db.interviews.get(ctx.session.id, params.id);
    if (!interview) throw new HttpError(404, 'Интервью не найдено');
    sendJson(res, 200, interview);
  });

  /* Реплика кандидата → реплика интервьюера. Потоком, если клиент просит text/event-stream. */
  r.post('/api/interviews/:id/turns', async function ({ req, res, params, body, ctx }) {
    const sid = ctx.session.id;
    const interview = db.interviews.get(sid, params.id);
    if (!interview) throw new HttpError(404, 'Интервью не найдено');
    if (interview.finished) throw new HttpError(409, 'Интервью завершено');
    const prep = db.preps.get(sid, interview.prepId);
    const text = str(body.text, 4000, 'text', true);
    /* Идемпотентно: повтор с тем же clientTurnId не создаёт дубля;
       CAS по версии защищает от потери реплики из второй вкладки. */
    const clientTurnId = body.clientTurnId ? safeId(body.clientTurnId, null) : null;
    if (body.clientTurnId && !clientTurnId) throw new HttpError(400, 'Недопустимый clientTurnId');
    const appended = db.interviews.appendTurn(sid, interview.id, { role: 'candidate', text, clientTurnId });
    if (appended.duplicate) {
      /* Реплика уже есть: отдаём последний ответ интервьюера, если он был. */
      const after = appended.interview.turns.filter(function (t) { return t.seq > appended.turn.seq && t.role === 'interviewer'; });
      if (after.length) {
        sendJson(res, 200, { interviewId: interview.id, turn: { role: 'interviewer', text: after[0].text, seq: after[0].seq },
          turns: appended.interview.turns.length, duplicate: true });
        return;
      }
    }
    const fresh = appended.interview;

    const wantsStream = String(req.headers.accept || '').indexOf('text/event-stream') >= 0;
    if (!wantsStream) {
      sendJson(res, 200, await interviewerTurn(sid, prep, fresh, null));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
      connection: 'keep-alive' });
    const aborter = new AbortController();
    const disconnected = function () { if (!res.writableEnded) aborter.abort(); };
    res.on('close', disconnected);
    const send = function (event, data) { if (res.destroyed) return; res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); };
    try {
      const result = await interviewerTurn(sid, prep, fresh, function (delta) { send('delta', { text: delta }); },
        function (text) { send('status', { text }); }, aborter.signal);
      send('done', result);
    } catch (e) {
      send('error', { error: e.message });
    }
    res.off('close', disconnected);
    res.end();
  });

  /* Повторить реплику интервьюера без новой реплики кандидата:
     нужно, когда ответ модели не пришёл, а ответ кандидата уже сохранён. */
  r.post('/api/interviews/:id/continue', async function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const interview = db.interviews.get(sid, params.id);
    if (!interview) throw new HttpError(404, 'Интервью не найдено');
    if (interview.finished) throw new HttpError(409, 'Интервью завершено');
    const prep = db.preps.get(sid, interview.prepId);
    sendJson(res, 200, await interviewerTurn(sid, prep, interview, null));
  });

  /* Память интервью: реестр фактов с источниками. Только своя. */
  r.get('/api/interviews/:id/memory', function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const interview = db.interviews.get(sid, params.id);
    if (!interview) throw new HttpError(404, 'Интервью не найдено');
    const memory = db.contextMemory.get(sid, interview.id);
    sendJson(res, 200, memory || { interviewId: interview.id, memoryVersion: 0, status: 'none', memory: null,
      coveredThroughSeq: 0, sourceRevisions: {} });
  });

  /* Сжать новые реплики в память сейчас, без ожидания порога. Один
     compaction на интервью: повторный вызов во время работы отвечает
     ran:false. Прежняя память при любом сбое остаётся. */
  r.post('/api/interviews/:id/compact', async function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const interview = db.interviews.get(sid, params.id);
    if (!interview) throw new HttpError(404, 'Интервью не найдено');
    const prep = db.preps.get(sid, interview.prepId);
    const resume = db.resumes.get(sid, prep.resumeId);
    const vacancy = db.vacancies.get(sid, prep.vacancyId);
    const result = await Compact.run(sid, prep, resume, vacancy, interview, {});
    sendJson(res, 200, Object.assign({ interviewId: interview.id }, result));
  });

  r.post('/api/interviews/:id/finish', async function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const interview = db.interviews.get(sid, params.id);
    if (!interview) throw new HttpError(404, 'Интервью не найдено');
    const release = hold(sid + ':finish:' + params.id);
    try {
      const prep = db.preps.get(sid, interview.prepId);
      const resume = db.resumes.get(sid, prep.resumeId);
      const vacancy = db.vacancies.get(sid, prep.vacancyId);
      const result = await ai.run(sid, 'interview.summary', { resume, vacancy, prep, interview });
      if (!result.ok) throw aiError(result);
      const finished = db.interviews.finish(sid, interview.id, Object.assign({}, result.json, { source: sourceOf(result) }));
      sendJson(res, 200, Object.assign({}, finished, { mock: result.mock, context: result.context, source: finished.summary.source }));
    } finally { release(); }
  });

  async function interviewerTurn(sid, prep, interview, onDelta, onStatus, signal) {
    const resume = db.resumes.get(sid, prep.resumeId);
    const vacancy = db.vacancies.get(sid, prep.vacancyId);
    /* Память обновляется до реплики, когда порог достигнут: реплика
       интервьюера тогда идёт уже на свежей памяти. Сбой сжатия реплику
       не блокирует — окно и свёртка работают как прежде. */
    const compaction = await Compact.maybeRun(sid, prep, resume, vacancy, interview, { onStatus, signal });
    if (compaction.ran) prep = db.preps.get(sid, prep.id) || prep;
    const result = await ai.run(sid, 'interview.turn', { resume, vacancy, prep, interview },
      { streaming: !!onDelta, onDelta, signal });
    if (signal && signal.aborted) throw new HttpError(499, 'Запрос отменён', { code: 'cancelled' });
    if (!result.ok) throw aiError(result);
    const text = str(result.text, 2000, 'turn', true);
    const appended = db.interviews.appendTurn(sid, interview.id, { role: 'interviewer', text });
    return { interviewId: interview.id, turn: { role: 'interviewer', text, seq: appended.turn.seq },
      turns: appended.interview.turns.length, mock: result.mock, dropped: result.dropped, sizing: result.sizing,
      context: Object.assign({}, result.context, { compaction }) };
  }
}

module.exports = { register, limitsFor };
