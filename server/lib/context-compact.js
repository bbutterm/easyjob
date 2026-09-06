/* Сжатие новых реплик интервью в память (задача context.compact).

   Правила (docs/adr/context-management.md):
   - вход — прежняя валидная память и только новый, ещё не покрытый
     диапазон реплик, не вся стенограмма заново;
   - порог — накопилось triggerNewTurns новых завершённых реплик либо
     память и окно заняли triggerShare бюджета задачи интервью, и при
     этом есть что вытеснять из окна;
   - один compaction на интервью одновременно (замок в interviews);
   - ответ модели проверяется по ссылкам и публикуется атомарно с CAS;
     сбой, переполнение или неразборчивый JSON прежнюю память не трогают;
   - реплики, пришедшие во время сжатия, остаются непокрытыми: покрытие
     фиксируется по диапазону, прочитанному в начале;
   - из собственного сборщика сжатие не запускается: сюда приходят только
     маршруты интервью, а ai.run задачу context.compact не рекурсирует. */

'use strict';

const db = require('./db.js');
const ai = require('./ai.js');
const ContextMemory = require('./context-memory.js');
const ContextPolicy = require('../../shared/context/policy.js');
const TokenCounter = require('../../shared/context/tokens.js');
const log = require('./log.js');

function uncoveredTurns(interview, memoryRow) {
  const covered = memoryRow ? (memoryRow.coveredThroughSeq || 0) : 0;
  return interview.turns.filter(function (t) { return (t.seq || 0) > covered; });
}

/* Нужно ли сжимать. Возвращает { needed, reason, uncovered, evictable }. */
function check(sid, interview) {
  if (!ai.memoryEnabled()) return { needed: false, reason: 'память выключена (CONTEXT_MEMORY)' };
  const memoryRow = ContextMemory.read(sid, interview.id);
  const policyC = ContextPolicy.policyFor('context.compact');
  const policyT = ContextPolicy.policyFor('interview.turn');
  const uncovered = uncoveredTurns(interview, memoryRow);
  const evictable = uncovered.length - policyT.windowTurns;
  if (evictable <= 0) return { needed: false, reason: 'нечего вытеснять из окна', uncovered: uncovered.length, evictable: 0 };
  if (uncovered.length >= policyC.triggerNewTurns) {
    return { needed: true, reason: 'накопилось ' + uncovered.length + ' новых реплик', uncovered: uncovered.length, evictable };
  }
  /* Доля бюджета: память и реплики окна против доли слоя session в задаче интервью. */
  const memoryText = memoryRow ? JSON.stringify(memoryRow.memory || {}) : '';
  const turnsText = uncovered.map(function (t) { return t.text; }).join('\n');
  const size = TokenCounter.count(memoryText + '\n' + turnsText).tokens;
  const sessionBudget = Math.floor(ContextPolicy.inputAllowance(policyT, false) * 0.40);
  if (size >= Math.floor(sessionBudget * policyC.triggerShare)) {
    return { needed: true, reason: 'память и окно заняли ' + size + ' из ' + sessionBudget + ' токенов', uncovered: uncovered.length, evictable };
  }
  return { needed: false, reason: 'порог не достигнут', uncovered: uncovered.length, evictable };
}

/* Выполнить сжатие. Возвращает
     { ran: false, reason }                         — не запускалось
     { ran: true, ok: false, error | conflict }     — память не изменилась
     { ran: true, ok: true, memoryVersion, coveredThroughSeq, newFacts, remaining, warnings } */
async function run(sid, prep, resume, vacancy, interview, opts) {
  const o = opts || {};
  if (!ai.memoryEnabled()) return { ran: false, reason: 'память выключена (CONTEXT_MEMORY)' };
  if (!db.interviews.tryLockCompaction(sid, interview.id)) return { ran: false, reason: 'сжатие уже идёт' };
  try {
    /* Перечитываем: за время ожидания могли прийти новые реплики или память. */
    const fresh = db.interviews.get(sid, interview.id);
    if (!fresh) return { ran: false, reason: 'интервью не найдено' };
    const memoryRow = ContextMemory.read(sid, interview.id);
    const expected = memoryRow ? memoryRow.memoryVersion : 0;
    const uncovered = uncoveredTurns(fresh, memoryRow);
    if (!uncovered.length) return { ran: false, reason: 'нет новых реплик' };
    const policyC = ContextPolicy.policyFor('context.compact');
    const range = uncovered.slice(0, policyC.maxRangeTurns);
    const from = range[0].seq;
    const to = range[range.length - 1].seq;
    const previous = memoryRow ? memoryRow.memory : null;

    const result = await ai.run(sid, 'context.compact', {
      prep, resume, vacancy, interview: fresh, range: { from, to },
      previousMemory: previous, previousVersion: expected
    }, { phase: 'compact', requestId: o.requestId, signal: o.signal });

    if (!result.ok) {
      log.warn('context.compact.failed', { interview: interview.id, error: result.error, overflow: result.overflow === true });
      return { ran: true, ok: false, error: result.error, overflow: result.overflow === true, memoryVersion: expected, requestId: result.requestId };
    }
    const known = (previous && previous.facts ? previous.facts : []).map(function (f) { return f.factId; });
    const checked = ContextMemory.validate(result.json, fresh.turns, undefined, known);
    const merged = ContextMemory.merge(previous, checked.memory);
    const snapshot = prep.snapshot || {};
    const revisions = { resumeRev: snapshot.resumeRev || prep.resumeRev, vacancyRev: snapshot.vacancyRev || prep.vacancyRev };
    const pub = ContextMemory.publish(sid, interview.id, expected, merged, revisions, to);
    if (!pub.ok) {
      log.warn('context.compact.conflict', { interview: interview.id, expected });
      return { ran: true, ok: false, conflict: true, error: 'Память изменилась во время сжатия', memoryVersion: expected, requestId: result.requestId };
    }
    log.info('context.compact', { interview: interview.id, memoryVersion: pub.memoryVersion, from, to,
      newFacts: checked.memory.facts.length, rejected: checked.errors.length, remaining: uncovered.length - range.length });
    return { ran: true, ok: true, memoryVersion: pub.memoryVersion, coveredThroughSeq: to, from,
      newFacts: checked.memory.facts.length, remaining: uncovered.length - range.length,
      warnings: checked.errors, mock: result.mock === true, requestId: result.requestId };
  } finally {
    db.interviews.unlockCompaction(sid, interview.id);
  }
}

/* Сжать, если порог достигнут. onStatus — короткое сообщение пользователю
   («обновляю память»), чтобы ожидание не выглядело зависанием. */
async function maybeRun(sid, prep, resume, vacancy, interview, opts) {
  const need = check(sid, interview);
  if (!need.needed) return { ran: false, reason: need.reason, uncovered: need.uncovered || 0 };
  if (opts && typeof opts.onStatus === 'function') opts.onStatus('Обновляю память интервью…');
  const res = await run(sid, prep, resume, vacancy, interview, opts);
  res.trigger = need.reason;
  return res;
}

module.exports = { check, run, maybeRun, uncoveredTurns };
