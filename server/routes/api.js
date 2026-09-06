/* Маршруты API. Все данные привязаны к сессии: чужие записи не видны
   даже при знании идентификатора. */

'use strict';

const db = require('../lib/db.js');
const ai = require('../lib/ai.js');
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

function prepView(sid, prep) {
  const resume = db.resumes.get(sid, prep.resumeId);
  const vacancy = db.vacancies.get(sid, prep.vacancyId);
  const s = stale(prep, resume, vacancy);
  const interview = db.interviews.latestForPrep(sid, prep.id);
  return Object.assign({}, prep, {
    stale: s.stale, staleReason: s.reason,
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
  if (!result.ok) throw new HttpError(result.overflow ? 422 : 502, result.error, result.overflow ? { overflow: true, sizing: result.sizing } : null);
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
  if (!result.ok) throw new HttpError(result.overflow ? 422 : 502, result.error, result.overflow ? { overflow: true, sizing: result.sizing } : null);
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
  return { items, mock: result.mock, dropped: result.dropped };
}

function register(r) {
  r.get('/api/health', function ({ res }) {
    sendJson(res, 200, { ok: true, ai: ai.describe(), time: Date.now() });
  });

  r.get('/api/me', function ({ res, ctx }) {
    const sid = ctx.session.id;
    sendJson(res, 200, {
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
    const result = await ai.run(sid, 'resume.review', { resume });
    if (!result.ok) throw new HttpError(result.overflow ? 422 : 502, result.error, result.overflow ? { overflow: true, sizing: result.sizing } : null);
    db.resumes.setReview(sid, resume.id, result.json);
    sendJson(res, 200, { review: result.json, mock: result.mock, dropped: result.dropped });
  });

  /* ---- Вакансии ---- */

  r.post('/api/vacancies', async function ({ res, body, ctx }) {
    const sid = ctx.session.id;
    const title = str(body.title, 200, 'title', true);
    const company = str(body.company, 200, 'company');
    const rawText = str(body.rawText, 40000, 'rawText', true);
    if (rawText.length < 40) throw new HttpError(400, 'Текст вакансии слишком короткий, чтобы выделить требования.');
    let vacancy = db.vacancies.create(sid, title, company, rawText);
    vacancy = await ensureRequirements(sid, vacancy);
    sendJson(res, 201, vacancy);
  });

  r.get('/api/vacancies', function ({ res, ctx }) {
    sendJson(res, 200, db.vacancies.list(ctx.session.id));
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
    prep = db.preps.set(sid, prep.id, { match: match.items });
    sendJson(res, 201, Object.assign(prepView(sid, prep), { mock: match.mock, dropped: match.dropped }));
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
    const resume = db.resumes.get(sid, prep.resumeId);
    let vacancy = db.vacancies.get(sid, prep.vacancyId);
    if (!resume || !vacancy) throw new HttpError(409, 'Исходники удалены: пересобрать нельзя.');
    vacancy = await ensureRequirements(sid, vacancy);
    prep = db.preps.rebuild(sid, prep.id, resume, vacancy);
    const match = await buildMatch(sid, prep, resume, vacancy);
    prep = db.preps.set(sid, prep.id, { match: match.items });
    sendJson(res, 200, Object.assign(prepView(sid, prep), { mock: match.mock }));
  });

  r.post('/api/preps/:id/questions', async function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const prep = db.preps.get(sid, params.id);
    if (!prep) throw new HttpError(404, 'Подготовка не найдена');
    const resume = db.resumes.get(sid, prep.resumeId);
    const vacancy = db.vacancies.get(sid, prep.vacancyId);
    const result = await ai.run(sid, 'questions.generate', { resume, vacancy, prep });
    if (!result.ok) throw new HttpError(result.overflow ? 422 : 502, result.error, result.overflow ? { overflow: true, sizing: result.sizing } : null);
    const questions = (result.json.questions || []).map(function (q, i) {
      return { id: safeId(q.id, 'q' + (i + 1)), topic: str(q.topic, 60, 'topic') || 'Общее',
        text: str(q.text, 500, 'text', true), why: str(q.why, 500, 'why'), guidance: str(q.guidance, 800, 'guidance') };
    });
    if (!questions.length) throw new HttpError(502, 'Модель не вернула ни одного вопроса.');
    db.preps.set(sid, prep.id, { questions });
    sendJson(res, 200, { questions, mock: result.mock, dropped: result.dropped });
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

  r.post('/api/preps/:id/card', async function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const prep = db.preps.get(sid, params.id);
    if (!prep) throw new HttpError(404, 'Подготовка не найдена');
    const resume = db.resumes.get(sid, prep.resumeId);
    const vacancy = db.vacancies.get(sid, prep.vacancyId);
    const result = await ai.run(sid, 'prep.card', { resume, vacancy, prep, includeAnswers: true });
    if (!result.ok) throw new HttpError(result.overflow ? 422 : 502, result.error, result.overflow ? { overflow: true, sizing: result.sizing } : null);
    db.preps.set(sid, prep.id, { card: result.json });
    sendJson(res, 200, { card: result.json, mock: result.mock, dropped: result.dropped });
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
    const send = function (event, data) { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); };
    try {
      const result = await interviewerTurn(sid, prep, fresh, function (delta) { send('delta', { text: delta }); });
      send('done', result);
    } catch (e) {
      send('error', { error: e.message });
    }
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

  r.post('/api/interviews/:id/finish', async function ({ res, params, ctx }) {
    const sid = ctx.session.id;
    const interview = db.interviews.get(sid, params.id);
    if (!interview) throw new HttpError(404, 'Интервью не найдено');
    const prep = db.preps.get(sid, interview.prepId);
    const resume = db.resumes.get(sid, prep.resumeId);
    const vacancy = db.vacancies.get(sid, prep.vacancyId);
    const result = await ai.run(sid, 'interview.summary', { resume, vacancy, prep, interview });
    if (!result.ok) throw new HttpError(result.overflow ? 422 : 502, result.error, result.overflow ? { overflow: true, sizing: result.sizing } : null);
    const finished = db.interviews.finish(sid, interview.id, result.json);
    sendJson(res, 200, Object.assign({}, finished, { mock: result.mock, context: result.context }));
  });

  async function interviewerTurn(sid, prep, interview, onDelta) {
    const resume = db.resumes.get(sid, prep.resumeId);
    const vacancy = db.vacancies.get(sid, prep.vacancyId);
    const result = await ai.run(sid, 'interview.turn', { resume, vacancy, prep, interview },
      { streaming: !!onDelta, onDelta });
    if (!result.ok) throw new HttpError(result.overflow ? 422 : 502, result.error, result.overflow ? { overflow: true, sizing: result.sizing } : null);
    const text = str(result.text, 2000, 'turn', true);
    const appended = db.interviews.appendTurn(sid, interview.id, { role: 'interviewer', text });
    return { interviewId: interview.id, turn: { role: 'interviewer', text, seq: appended.turn.seq },
      turns: appended.interview.turns.length, mock: result.mock, dropped: result.dropped, sizing: result.sizing,
      context: result.context };
  }
}

module.exports = { register, limitsFor };
