/* Память интервью: форма, проверка ссылок, владение.

   Память — не итог и не стенограмма. Это компактный реестр фактов с
   указанием источника и статуса, затронутые темы, противоречия и
   открытые вопросы. Оригиналы реплик остаются источником истины в
   таблице interviews; память лишь ссылается на них по seq.

   Статусы факта:
     user_said   — сказал кандидат (реплика seq)
     in_document — есть в резюме или вакансии (поле)
     confirmed   — сказано и подтверждено документом
     conflict    — реплика противоречит документу или прежней реплике
     unknown     — упомянуто, но не подтверждено ничем
   Уверенный тон модели фактов не подтверждает. */

'use strict';

const db = require('./db.js');

const STATUSES = ['user_said', 'in_document', 'confirmed', 'conflict', 'unknown'];

function emptyMemory() {
  return { facts: [], askedTopics: [], contradictions: [], unresolvedQuestions: [], evidenceRefs: [] };
}

function str(v, max) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/* Проверка формы и ссылок. turns — реплики интервью (источник истины),
   docFields — допустимые имена полей документов. Возвращает
   { ok, memory, errors }: неверные записи выбрасываются, а не чинятся молча. */
function validate(raw, turns, docFields, knownIds) {
  const errors = [];
  const known = {};
  (knownIds || []).forEach(function (k) { known[k] = true; });
  const bySeq = {};
  (turns || []).forEach(function (t) { bySeq[t.seq] = t; });
  const fields = docFields || ['resume.summary', 'resume.experience', 'resume.skills', 'resume.achievements',
    'resume.education', 'vacancy.requirements', 'vacancy.rawText'];
  const out = emptyMemory();
  const input = raw && typeof raw === 'object' ? raw : {};

  const seenIds = {};
  (Array.isArray(input.facts) ? input.facts : []).forEach(function (f, i) {
    const factId = str(f.factId || ('f' + (i + 1)), 40);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(factId) || seenIds[factId]) { errors.push('факт ' + i + ': плохой или повторный factId'); return; }
    const value = str(f.value, 500);
    if (!value) { errors.push('факт ' + factId + ': пустое значение'); return; }
    const status = STATUSES.indexOf(f.status) >= 0 ? f.status : 'unknown';
    const ref = f.sourceRef && typeof f.sourceRef === 'object' ? f.sourceRef : null;
    let sourceRef = null;
    if (ref && ref.kind === 'turn') {
      const seq = Number(ref.seq);
      if (!bySeq[seq]) { errors.push('факт ' + factId + ': ссылка на несуществующую реплику ' + ref.seq); return; }
      sourceRef = { kind: 'turn', seq };
      /* Дословная цитата обязана быть в исходной реплике. */
      if (f.quote) {
        const q = str(f.quote, 300);
        if (bySeq[seq].text.indexOf(q) < 0) { errors.push('факт ' + factId + ': цитата не найдена в реплике ' + seq); return; }
        sourceRef.quote = q;
      }
    } else if (ref && ref.kind === 'document') {
      const field = str(ref.field, 60);
      if (fields.indexOf(field) < 0) { errors.push('факт ' + factId + ': неизвестное поле документа ' + field); return; }
      sourceRef = { kind: 'document', field };
    } else if (status !== 'unknown') {
      errors.push('факт ' + factId + ': статус ' + status + ' без источника');
      return;
    }
    const supersedes = f.supersedes ? str(f.supersedes, 40) : null;
    seenIds[factId] = true;
    const fact = { factId, value, status, sourceRef, supersedes };
    /* Отрицания, числа и даты, исправления и конфликты — то, что теряется
       первым при свёртке и дороже всего при ответе; при нехватке места
       такие факты уходят из запроса последними. */
    if (isImportant(fact)) fact.important = true;
    out.facts.push(fact);
  });
  /* supersedes должен указывать на существующий факт: из этого ответа или из прежней памяти. */
  out.facts.forEach(function (f) {
    if (f.supersedes && !seenIds[f.supersedes] && !known[f.supersedes]) {
      errors.push('факт ' + f.factId + ': supersedes на неизвестный факт'); f.supersedes = null;
    }
  });

  out.askedTopics = (Array.isArray(input.askedTopics) ? input.askedTopics : []).map(function (t) { return str(t, 80); })
    .filter(Boolean).slice(0, 60);
  out.contradictions = (Array.isArray(input.contradictions) ? input.contradictions : []).map(function (c) {
    const seqs = (Array.isArray(c.seqs) ? c.seqs : []).map(Number).filter(function (n) { return !!bySeq[n]; });
    return { text: str(c.text, 400), seqs };
  }).filter(function (c) { return c.text; }).slice(0, 30);
  out.unresolvedQuestions = (Array.isArray(input.unresolvedQuestions) ? input.unresolvedQuestions : [])
    .map(function (q) { return str(q, 300); }).filter(Boolean).slice(0, 30);
  out.evidenceRefs = (Array.isArray(input.evidenceRefs) ? input.evidenceRefs : []).map(Number)
    .filter(function (n) { return !!bySeq[n]; }).slice(0, 200);

  return { ok: errors.length === 0, memory: out, errors };
}

function isImportant(fact) {
  if (fact.supersedes || fact.status === 'conflict') return true;
  return /(^|[\s,(«"])(не|нет|ни|никогда)(?=[\s,.!?»")]|$)|\d|точнее|поправлю|исправлю|ошиб|(^|\s)(одн|дв[аеу]|тр[иёе]|четыр|пят|шест|сем|восьм|девят|десят)[а-яё]*\s(лет|год|мес|нед|дн|раз|сезон)/i
    .test(fact.value);
}

/* Прочитать память, принадлежащую сессии; чужая — null. */
function read(sid, interviewId) {
  return db.contextMemory.get(sid, interviewId);
}

/* Атомарная публикация с CAS. sourceRevisions — версии резюме и вакансии
   на момент сжатия; coveredThroughSeq — до какой реплики включительно. */
function publish(sid, interviewId, expectedVersion, memory, sourceRevisions, coveredThroughSeq) {
  return db.contextMemory.publish(sid, interviewId, expectedVersion, { memory, sourceRevisions, coveredThroughSeq });
}

/* Слияние: новые факты добавляются; факт с supersedes помечает прежний
   как замещённый (не удаляется — остаётся история исправления). */
function merge(previous, delta) {
  const base = previous ? JSON.parse(JSON.stringify(previous)) : emptyMemory();
  const byId = {};
  base.facts.forEach(function (f) { byId[f.factId] = f; });
  (delta.facts || []).forEach(function (f) {
    if (f.supersedes && byId[f.supersedes]) byId[f.supersedes].supersededBy = f.factId;
    if (byId[f.factId]) Object.assign(byId[f.factId], f);
    else { base.facts.push(f); byId[f.factId] = f; }
  });
  (delta.askedTopics || []).forEach(function (t) { if (base.askedTopics.indexOf(t) < 0) base.askedTopics.push(t); });
  base.contradictions = base.contradictions.concat(delta.contradictions || []).slice(-30);
  base.unresolvedQuestions = (delta.unresolvedQuestions && delta.unresolvedQuestions.length)
    ? delta.unresolvedQuestions : base.unresolvedQuestions;
  base.evidenceRefs = base.evidenceRefs.concat(delta.evidenceRefs || []).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(-200);
  return base;
}

/* Действующие факты: замещённые скрыты, но противоречия видны. */
function activeFacts(memory) {
  return (memory && memory.facts ? memory.facts : []).filter(function (f) { return !f.supersededBy; });
}

module.exports = { STATUSES, emptyMemory, validate, read, publish, merge, activeFacts, isImportant };
