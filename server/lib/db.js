/* База данных: встроенный SQLite Node.js, без нативных зависимостей.

   Одна таблица на сущность из docs/context-model.md. JSON-поля хранят
   структуры как есть: на этой стадии схема меняется чаще, чем нужна
   реляционная строгость. Версии резюме и вакансии переносятся в подготовку,
   чтобы отмечать устаревшие отчёты — та же логика, что в макете. */

'use strict';

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  paid_until INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,
  review TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS resumes_session ON resumes(session_id);
CREATE TABLE IF NOT EXISTS vacancies (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT,
  raw_text TEXT NOT NULL,
  requirements TEXT,
  rev INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vacancies_session ON vacancies(session_id);
CREATE TABLE IF NOT EXISTS preps (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  resume_id TEXT NOT NULL,
  vacancy_id TEXT NOT NULL,
  resume_rev INTEGER NOT NULL,
  vacancy_rev INTEGER NOT NULL,
  profession TEXT,
  match TEXT,
  questions TEXT,
  answers TEXT NOT NULL DEFAULT '{}',
  ready TEXT NOT NULL DEFAULT '{}',
  card TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS preps_session ON preps(session_id);
CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  prep_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turns TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  finished INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS interviews_prep ON interviews(prep_id);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  ok INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_session_day ON usage(session_id, created_at);
`;

function open(file) {
  if (file && file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file || ':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  /* Поле добавлено позже схемы: у существующих баз его нет. */
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map(function (c) { return c.name; });
  if (cols.indexOf('ip_hash') < 0) db.exec('ALTER TABLE sessions ADD COLUMN ip_hash TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS sessions_ip ON sessions(ip_hash)');
  /* Учёт по попыткам: запрос, фаза, статус расхода, число попыток, стоимость. */
  const ucols = db.prepare('PRAGMA table_info(usage)').all().map(function (c) { return c.name; });
  [['request_id', 'TEXT'], ['phase', "TEXT DEFAULT 'main'"], ['usage_status', "TEXT DEFAULT 'reported'"],
    ['attempts', 'INTEGER DEFAULT 1'], ['tokens_cache_read', 'INTEGER DEFAULT 0'],
    ['tokens_reasoning', 'INTEGER DEFAULT 0'], ['cost', 'REAL'], ['outcome', 'TEXT']].forEach(function (col) {
    if (ucols.indexOf(col[0]) < 0) db.exec('ALTER TABLE usage ADD COLUMN ' + col[0] + ' ' + col[1]);
  });
  return db;
}

function close() {
  if (db) { db.close(); db = null; }
}

/* Закрыть только ту базу, которую открыл вызывающий: событие close у
   http-сервера приходит асинхронно и не должно закрывать базу, уже
   открытую следующим экземпляром (важно для проверок). */
function closeIf(handle) {
  if (db && db === handle) { db.close(); db = null; }
}

function id(prefix) {
  return prefix + '_' + crypto.randomBytes(9).toString('base64url');
}

function now() { return Date.now(); }

function parse(text, fallback) {
  if (text === null || text === undefined) return fallback;
  try { return JSON.parse(text); } catch (e) { return fallback; }
}

/* ---- Сессии ---- */

const sessions = {
  create(ipHash) {
    const row = { id: id('s'), created_at: now(), last_seen_at: now(), paid_until: 0, ip_hash: ipHash || '' };
    db.prepare('INSERT INTO sessions (id, created_at, last_seen_at, paid_until, ip_hash) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.created_at, row.last_seen_at, row.paid_until, row.ip_hash);
    return row;
  },
  touchIp(sid, ipHash) {
    if (ipHash) db.prepare('UPDATE sessions SET ip_hash = ? WHERE id = ? AND (ip_hash IS NULL OR ip_hash = \'\')').run(ipHash, sid);
  },
  /* Удалить сессию со всем содержимым по запросу пользователя. Учёт
     расходов остаётся: в нём нет содержимого, только счётчики. */
  removeOne(sid) {
    db.exec('BEGIN');
    try {
      const resumes = db.prepare('DELETE FROM resumes WHERE session_id = ?').run(sid).changes;
      db.prepare('DELETE FROM vacancies WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM interviews WHERE session_id = ?').run(sid);
      const preps = db.prepare('DELETE FROM preps WHERE session_id = ?').run(sid).changes;
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      db.exec('COMMIT');
      return { resumes, preps };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
  get(sid) {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid) || null;
  },
  touch(sid) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), sid);
  },
  setPaidUntil(sid, ts) {
    db.prepare('UPDATE sessions SET paid_until = ? WHERE id = ?').run(ts, sid);
  },
  /* Удалить сессии, к которым не обращались с указанного момента, вместе
     с их резюме, вакансиями, подготовками и интервью. Оплаченные сессии
     сохраняются до конца оплаченного периода. */
  removeInactiveSince(cutoff) {
    const stale = db.prepare('SELECT id FROM sessions WHERE last_seen_at < ? AND paid_until < ?')
      .all(cutoff, Date.now()).map(function (r) { return r.id; });
    let resumesRemoved = 0, prepsRemoved = 0;
    const tx = function () {
      stale.forEach(function (sid) {
        resumesRemoved += db.prepare('DELETE FROM resumes WHERE session_id = ?').run(sid).changes;
        db.prepare('DELETE FROM vacancies WHERE session_id = ?').run(sid);
        db.prepare('DELETE FROM interviews WHERE session_id = ?').run(sid);
        prepsRemoved += db.prepare('DELETE FROM preps WHERE session_id = ?').run(sid).changes;
        db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      });
    };
    db.exec('BEGIN');
    try { tx(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { sessions: stale.length, resumes: resumesRemoved, preps: prepsRemoved };
  }
};

/* ---- Резюме ---- */

function rowToResume(row) {
  if (!row) return null;
  return {
    id: row.id, title: row.title, rev: row.rev,
    data: parse(row.data, {}), review: parse(row.review, null),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

const resumes = {
  create(sid, title, data) {
    const t = now();
    const rid = id('res');
    db.prepare('INSERT INTO resumes (id, session_id, title, rev, data, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)')
      .run(rid, sid, title, JSON.stringify(data), t, t);
    return resumes.get(sid, rid);
  },
  get(sid, rid) {
    return rowToResume(db.prepare('SELECT * FROM resumes WHERE id = ? AND session_id = ?').get(rid, sid));
  },
  list(sid) {
    return db.prepare('SELECT * FROM resumes WHERE session_id = ? ORDER BY updated_at DESC').all(sid).map(rowToResume);
  },
  update(sid, rid, title, data) {
    /* Любая правка содержимого повышает версию — по ней отмечаются устаревшие отчёты. */
    db.prepare('UPDATE resumes SET title = ?, data = ?, rev = rev + 1, review = NULL, updated_at = ? WHERE id = ? AND session_id = ?')
      .run(title, JSON.stringify(data), now(), rid, sid);
    return resumes.get(sid, rid);
  },
  /* Переименование не меняет содержимое — версию не повышает. */
  rename(sid, rid, title) {
    db.prepare('UPDATE resumes SET title = ?, updated_at = ? WHERE id = ? AND session_id = ?')
      .run(title, now(), rid, sid);
    return resumes.get(sid, rid);
  },
  setReview(sid, rid, review) {
    db.prepare('UPDATE resumes SET review = ? WHERE id = ? AND session_id = ?')
      .run(JSON.stringify(review), rid, sid);
  },
  remove(sid, rid) {
    return db.prepare('DELETE FROM resumes WHERE id = ? AND session_id = ?').run(rid, sid).changes > 0;
  }
};

/* ---- Вакансии ---- */

function rowToVacancy(row) {
  if (!row) return null;
  return {
    id: row.id, title: row.title, company: row.company || '', rawText: row.raw_text,
    requirements: parse(row.requirements, null), rev: row.rev,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

const vacancies = {
  create(sid, title, company, rawText) {
    const t = now();
    const vid = id('vac');
    db.prepare('INSERT INTO vacancies (id, session_id, title, company, raw_text, rev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(vid, sid, title, company || '', rawText, t, t);
    return vacancies.get(sid, vid);
  },
  get(sid, vid) {
    return rowToVacancy(db.prepare('SELECT * FROM vacancies WHERE id = ? AND session_id = ?').get(vid, sid));
  },
  list(sid) {
    return db.prepare('SELECT * FROM vacancies WHERE session_id = ? ORDER BY updated_at DESC').all(sid).map(rowToVacancy);
  },
  setRequirements(sid, vid, requirements) {
    db.prepare('UPDATE vacancies SET requirements = ?, updated_at = ? WHERE id = ? AND session_id = ?')
      .run(JSON.stringify(requirements), now(), vid, sid);
  }
};

/* ---- Подготовки ---- */

function rowToPrep(row) {
  if (!row) return null;
  return {
    id: row.id, resumeId: row.resume_id, vacancyId: row.vacancy_id,
    resumeRev: row.resume_rev, vacancyRev: row.vacancy_rev,
    profession: row.profession || '',
    match: parse(row.match, null), questions: parse(row.questions, null),
    answers: parse(row.answers, {}), ready: parse(row.ready, {}),
    card: parse(row.card, null),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

const preps = {
  create(sid, resume, vacancy, profession) {
    const t = now();
    const pid = id('prep');
    db.prepare(`INSERT INTO preps (id, session_id, resume_id, vacancy_id, resume_rev, vacancy_rev, profession, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(pid, sid, resume.id, vacancy.id, resume.rev, vacancy.rev, profession || '', t, t);
    return preps.get(sid, pid);
  },
  get(sid, pid) {
    return rowToPrep(db.prepare('SELECT * FROM preps WHERE id = ? AND session_id = ?').get(pid, sid));
  },
  list(sid) {
    return db.prepare('SELECT * FROM preps WHERE session_id = ? ORDER BY updated_at DESC').all(sid).map(rowToPrep);
  },
  set(sid, pid, fields) {
    const allowed = ['match', 'questions', 'answers', 'ready', 'card'];
    const sets = [];
    const values = [];
    allowed.forEach(function (key) {
      if (fields[key] !== undefined) { sets.push(key + ' = ?'); values.push(JSON.stringify(fields[key])); }
    });
    if (!sets.length) return preps.get(sid, pid);
    sets.push('updated_at = ?'); values.push(now());
    values.push(pid, sid);
    const stmt = db.prepare('UPDATE preps SET ' + sets.join(', ') + ' WHERE id = ? AND session_id = ?');
    stmt.run.apply(stmt, values);
    return preps.get(sid, pid);
  },
  /* Пересборка под текущие версии исходников: старые отчёты сбрасываются. */
  rebuild(sid, pid, resume, vacancy) {
    db.prepare(`UPDATE preps SET resume_rev = ?, vacancy_rev = ?, match = NULL, questions = NULL, card = NULL, updated_at = ?
      WHERE id = ? AND session_id = ?`).run(resume.rev, vacancy.rev, now(), pid, sid);
    return preps.get(sid, pid);
  },
  remove(sid, pid) {
    db.prepare('DELETE FROM interviews WHERE prep_id = ? AND session_id = ?').run(pid, sid);
    return db.prepare('DELETE FROM preps WHERE id = ? AND session_id = ?').run(pid, sid).changes > 0;
  },
  /* Подготовок за сегодня: по сессии и по всем сессиям с того же адреса.
     Иначе лимит обходится сбросом cookie. */
  countToday(sid, ipHash) {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const bySession = db.prepare('SELECT COUNT(*) AS c FROM preps WHERE session_id = ? AND created_at >= ?')
      .get(sid, dayStart.getTime()).c;
    if (!ipHash) return bySession;
    const byIp = db.prepare(`SELECT COUNT(*) AS c FROM preps
      WHERE created_at >= ? AND session_id IN (SELECT id FROM sessions WHERE ip_hash = ?)`)
      .get(dayStart.getTime(), ipHash).c;
    return Math.max(bySession, byIp);
  }
};

/* ---- Интервью ---- */

function rowToInterview(row) {
  if (!row) return null;
  return {
    id: row.id, prepId: row.prep_id, turns: parse(row.turns, []), summary: parse(row.summary, null),
    finished: row.finished === 1, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

const interviews = {
  create(sid, pid) {
    const t = now();
    const iid = id('int');
    db.prepare('INSERT INTO interviews (id, prep_id, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(iid, pid, sid, t, t);
    return interviews.get(sid, iid);
  },
  get(sid, iid) {
    return rowToInterview(db.prepare('SELECT * FROM interviews WHERE id = ? AND session_id = ?').get(iid, sid));
  },
  latestForPrep(sid, pid) {
    return rowToInterview(db.prepare('SELECT * FROM interviews WHERE prep_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT 1').get(pid, sid));
  },
  setTurns(sid, iid, turns) {
    db.prepare('UPDATE interviews SET turns = ?, updated_at = ? WHERE id = ? AND session_id = ?')
      .run(JSON.stringify(turns), now(), iid, sid);
  },
  finish(sid, iid, summary) {
    db.prepare('UPDATE interviews SET summary = ?, finished = 1, updated_at = ? WHERE id = ? AND session_id = ?')
      .run(JSON.stringify(summary), now(), iid, sid);
    return interviews.get(sid, iid);
  }
};

/* ---- Учёт расходов ---- */

const usage = {
  /* usageStatus: reported — расход пришёл от сервиса; unknown — не пришёл,
     в токенах стоят нули, но это НЕ «бесплатно»; not_applicable — заглушка. */
  record(sid, entry) {
    db.prepare(`INSERT INTO usage (session_id, task, provider, model, tokens_in, tokens_out, ok, ms, created_at,
        request_id, phase, usage_status, attempts, tokens_cache_read, tokens_reasoning, cost, outcome)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sid, entry.task, entry.provider, entry.model || '', entry.tokensIn || 0, entry.tokensOut || 0,
        entry.ok ? 1 : 0, entry.ms || 0, now(),
        entry.requestId || null, entry.phase || 'main', entry.usageStatus || 'reported',
        entry.attempts || 1, entry.tokensCacheRead || 0, entry.tokensReasoning || 0,
        entry.cost === undefined ? null : entry.cost, entry.outcome || null);
  },
  byRequest(sid, requestId) {
    return db.prepare('SELECT * FROM usage WHERE session_id = ? AND request_id = ?').all(sid, requestId);
  },
  totals(sid) {
    return db.prepare(`SELECT COUNT(*) AS requests, COALESCE(SUM(tokens_in), 0) AS tokensIn,
      COALESCE(SUM(tokens_out), 0) AS tokensOut FROM usage WHERE session_id = ?`).get(sid);
  },
  /* Сводка для владельца: по задачам и по дням, без привязки к содержимому. */
  summary(days) {
    const since = Date.now() - (Number(days) || 30) * 24 * 3600 * 1000;
    return {
      since,
      byTask: db.prepare(`SELECT task, provider, phase, COUNT(*) AS requests, SUM(ok) AS succeeded,
          COALESCE(SUM(tokens_in), 0) AS tokensIn, COALESCE(SUM(tokens_out), 0) AS tokensOut,
          COALESCE(SUM(tokens_cache_read), 0) AS tokensCacheRead,
          SUM(CASE WHEN usage_status = 'unknown' THEN 1 ELSE 0 END) AS usageUnknown,
          COALESCE(SUM(attempts), 0) AS attempts, ROUND(AVG(ms)) AS avgMs
        FROM usage WHERE created_at >= ? GROUP BY task, provider, phase ORDER BY requests DESC`).all(since),
      byDay: db.prepare(`SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS requests,
          COUNT(DISTINCT session_id) AS sessions,
          COALESCE(SUM(tokens_in), 0) AS tokensIn, COALESCE(SUM(tokens_out), 0) AS tokensOut
        FROM usage WHERE created_at >= ? GROUP BY day ORDER BY day DESC`).all(since),
      sessions: db.prepare('SELECT COUNT(*) AS total, SUM(paid_until > ?) AS paid FROM sessions').get(Date.now()),
      preps: db.prepare('SELECT COUNT(*) AS total FROM preps WHERE created_at >= ?').get(since).total,
      resumes: db.prepare('SELECT COUNT(*) AS total FROM resumes').get().total
    };
  }
};

module.exports = { open, close, closeIf, id, sessions, resumes, vacancies, preps, interviews, usage };
