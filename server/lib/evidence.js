/* Подбор подтверждений (evidence) под текущий вопрос.

   Порядок источников, как в политике контекста:
     1. прямые ссылки — сопоставление по requirementId и требования,
        чьи формулировки пересекаются с вопросом;
     2. полнотекстовый поиск (SQLite FTS5 trigram) по разделам резюме и
        по прежним репликам интервью, которых нет в текущем окне;
     3. если FTS5 недоступен — перебор тех же документов в JS по тем же
        основам слов.

   Это подбор по совпадению слов, не «понимание»: результат помечается
   источником, а решать, подтверждает ли он что-то, будет модель и
   реестр фактов. Embeddings не используются: на объёме одного интервью
   преимущества не доказано. */

'use strict';

const db = require('./db.js');

/* Служебные слова, которые не годятся как ключ поиска. */
const STOP = ['этот', 'этой', 'этом', 'того', 'тому', 'этих', 'какой', 'какая', 'какие', 'какое', 'когда', 'почему',
  'зачем', 'сколько', 'расскажите', 'расскажи', 'опишите', 'пожалуйста', 'например', 'можете', 'можно', 'нужно',
  'было', 'были', 'быть', 'есть', 'если', 'чтобы', 'который', 'которая', 'которые', 'очень', 'тоже', 'также',
  'ваша', 'ваше', 'ваши', 'вашей', 'вашем', 'ваших', 'меня', 'мной', 'себя', 'него', 'ними', 'этого', 'просто',
  'самый', 'самая', 'самое', 'более', 'менее', 'about', 'what', 'which', 'your', 'have', 'with', 'this', 'that'];

/* Основа слова для подстрочного поиска: у коротких слов — целиком, у
   длинных отрезаются 2 последних символа (окончание), не длиннее 7.
   Грубая эвристика без морфологии; она честно называется таковой. */
function stem(word) {
  const w = word.toLowerCase();
  if (w.length <= 5) return w;
  return w.slice(0, Math.min(7, w.length - 2));
}

function terms(text, max) {
  const words = String(text || '').toLowerCase().match(/[a-zа-яё0-9]{4,}/g) || [];
  const out = [];
  words.forEach(function (w) {
    if (STOP.indexOf(w) >= 0) return;
    const st = stem(w);
    if (st.length < 3 || out.indexOf(st) >= 0) return;
    out.push(st);
  });
  return out.slice(0, max || 8);
}

function matchExpr(stems) {
  return stems.map(function (t) { return '"' + t.replace(/"/g, '') + '"'; }).join(' OR ');
}

/* Сколько основ встречается в тексте: для запасного перебора без FTS. */
function overlap(text, stems) {
  const low = String(text || '').toLowerCase();
  return stems.reduce(function (n, st) { return n + (low.indexOf(st) >= 0 ? 1 : 0); }, 0);
}

function rankByOverlap(docs, stems, limit) {
  return docs.map(function (d) { return { doc: d, score: overlap(d.text, stems) }; })
    .filter(function (x) { return x.score > 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, limit).map(function (x) { return x.doc; });
}

/* Подобрать подтверждения.
     sid            — сессия-владелец; чужие документы не ищутся
     opts.query     — текст текущего вопроса и ответа
     opts.requirementId — прямая ссылка от клиента (если есть)
     opts.prep      — подготовка (match с оценками по требованиям)
     opts.snapshot  — снимок подготовки (для перебора без FTS)
     opts.resumeId, opts.interviewId — владельцы документов в индексе
     opts.turns     — все реплики интервью (для перебора без FTS)
     opts.excludeSeqs — реплики, уже включённые в окно
     opts.limits    — { direct, resume, turns }
     opts.maxTerms  — сколько основ слов брать из запроса (по умолчанию 8)
   Возвращает { items: [{ source, text }], via: 'fts' | 'scan', stems }. */
function select(sid, opts) {
  const o = opts || {};
  const limits = Object.assign({ direct: 3, resume: 4, turns: 3 }, o.limits || {});
  const stems = terms(o.query, o.maxTerms || 8);
  const items = [];
  const seen = {};
  const push = function (source, text, cap) {
    if (!text || seen[source]) return;
    seen[source] = true;
    items.push({ source, text: String(text).slice(0, cap || 400) });
  };

  /* 1. Прямые ссылки: по requirementId и по пересечению с формулировкой требования. */
  const match = (o.prep && Array.isArray(o.prep.match)) ? o.prep.match : [];
  const direct = [];
  match.forEach(function (m) {
    if (!m || !m.id) return;
    if (o.requirementId && m.id === o.requirementId) direct.unshift(m);
    else if (stems.length && overlap(m.text, stems) > 0) direct.push(m);
  });
  direct.slice(0, limits.direct).forEach(function (m) {
    const status = m.status === 'confirmed' ? 'подтверждено' : (m.status === 'missing' ? 'в резюме нет' : 'нужно уточнить');
    push('match:' + m.id, m.text + ' — ' + status + (m.evidence ? ': ' + m.evidence : ''));
  });

  if (!stems.length) return { items, via: 'direct', stems };

  const useFts = db.evidence.available();
  const exclude = o.excludeSeqs || [];

  /* 2. Разделы резюме. */
  if (limits.resume > 0 && o.resumeId) {
    let rows;
    if (useFts) {
      rows = db.evidence.search(sid, 'resume', o.resumeId, matchExpr(stems), limits.resume);
    } else {
      rows = rankByOverlap(db.resumeSections((o.snapshot && o.snapshot.profile) || {}), stems, limits.resume);
    }
    rows.forEach(function (r) { push(r.ref, r.text); });
  }

  /* 3. Прежние реплики вне окна. */
  if (limits.turns > 0 && o.interviewId) {
    let rows;
    if (useFts) {
      rows = db.evidence.search(sid, 'turn', o.interviewId, matchExpr(stems), limits.turns + exclude.length)
        .filter(function (r) { return exclude.indexOf(Number(r.ref)) < 0; }).slice(0, limits.turns);
    } else {
      rows = rankByOverlap((o.turns || []).filter(function (t) { return exclude.indexOf(t.seq) < 0; })
        .map(function (t) { return { ref: String(t.seq), text: t.text, role: t.role }; }), stems, limits.turns);
    }
    const bySeq = {};
    (o.turns || []).forEach(function (t) { bySeq[t.seq] = t; });
    rows.forEach(function (r) {
      const t = bySeq[Number(r.ref)];
      const who = t && t.role === 'interviewer' ? 'интервьюер' : 'кандидат';
      push('turn:' + r.ref, who + ': ' + r.text);
    });
  }

  return { items, via: useFts ? 'fts' : 'scan', stems };
}

module.exports = { select, terms, stem, matchExpr, overlap };
