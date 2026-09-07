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
let ftsAvailable = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
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
CREATE TABLE IF NOT EXISTS context_memory (
  interview_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  memory_version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'valid',
  source_revisions TEXT NOT NULL DEFAULT '{}',
  covered_through_seq INTEGER NOT NULL DEFAULT 0,
  memory TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS context_memory_session ON context_memory(session_id);
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
  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userCols.includes('is_demo')) db.exec('ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');
  /* Поле добавлено позже схемы: у существующих баз его нет. */
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map(function (c) { return c.name; });
  if (cols.indexOf('ip_hash') < 0) db.exec('ALTER TABLE sessions ADD COLUMN ip_hash TEXT');
  if (cols.indexOf('user_id') < 0) db.exec('ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id)');
  const usageCols = db.prepare('PRAGMA table_info(usage)').all().map(c => c.name);
  const additions = { user_id: 'TEXT', stage: "TEXT NOT NULL DEFAULT 'unknown'",
    estimated: 'INTEGER NOT NULL DEFAULT 1', input_estimated: 'INTEGER NOT NULL DEFAULT 1',
    output_estimated: 'INTEGER NOT NULL DEFAULT 1', cost_usd: 'REAL NOT NULL DEFAULT 0',
    pricing_missing: 'INTEGER NOT NULL DEFAULT 1', pricing_version: "TEXT NOT NULL DEFAULT 'legacy-unpriced'" };
  for (const [name, type] of Object.entries(additions)) {
    if (!usageCols.includes(name)) db.exec('ALTER TABLE usage ADD COLUMN ' + name + ' ' + type);
  }
  db.exec('UPDATE usage SET user_id = (SELECT user_id FROM sessions WHERE sessions.id = usage.session_id) WHERE user_id IS NULL');
  for (const [task, stage] of Object.entries(require('../../shared/ai/routing.js').STAGES)) {
    db.prepare("UPDATE usage SET stage = ? WHERE task = ? AND stage = 'unknown'").run(stage, task);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS sessions_ip ON sessions(ip_hash)');
  /* Версия интервью для CAS: две вкладки не затирают реплики друг друга. */
  const icols = db.prepare('PRAGMA table_info(interviews)').all().map(function (c) { return c.name; });
  if (icols.indexOf('version') < 0) db.exec('ALTER TABLE interviews ADD COLUMN version INTEGER NOT NULL DEFAULT 0');
  if (icols.indexOf('compacting') < 0) db.exec('ALTER TABLE interviews ADD COLUMN compacting INTEGER NOT NULL DEFAULT 0');
  /* Снимок подготовки: компактный профиль, требования и версии исходников,
     на которых построена подготовка. Активное интервью идёт на снимке, а
     не на текущей версии резюме — подмена версии незаметно запрещена. */
  const pcols = db.prepare('PRAGMA table_info(preps)').all().map(function (c) { return c.name; });
  if (pcols.indexOf('answers_rev') < 0) db.exec('ALTER TABLE preps ADD COLUMN answers_rev INTEGER NOT NULL DEFAULT 0');
  if (pcols.indexOf('snapshot') < 0) db.exec('ALTER TABLE preps ADD COLUMN snapshot TEXT');
  /* Обратная связь на ответы: по questionId, с источником и отпечатком ответа. */
  if (pcols.indexOf('feedback') < 0) db.exec("ALTER TABLE preps ADD COLUMN feedback TEXT NOT NULL DEFAULT '{}'");
  /* Источник каждого результата модели: режим, провайдер, модель, этап, время. */
  if (pcols.indexOf('sources') < 0) db.exec("ALTER TABLE preps ADD COLUMN sources TEXT NOT NULL DEFAULT '{}'");
  /* Источник вакансии: адрес без токенов, способ получения, время. */
  const vcols = db.prepare('PRAGMA table_info(vacancies)').all().map(function (c) { return c.name; });
  if (vcols.indexOf('source_url') < 0) db.exec('ALTER TABLE vacancies ADD COLUMN source_url TEXT');
  if (vcols.indexOf('source') < 0) db.exec("ALTER TABLE vacancies ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
  if (vcols.indexOf('retrieved_at') < 0) db.exec('ALTER TABLE vacancies ADD COLUMN retrieved_at INTEGER');
  /* Индекс подтверждений: разделы резюме и реплики интервью для подбора
     evidence по текущему вопросу. FTS5 trigram — подстрочный поиск без
     морфологии; если сборка SQLite без FTS5, подбор идёт перебором в JS. */
  ftsAvailable = false;
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS evidence_fts USING fts5(
      session_id UNINDEXED, kind UNINDEXED, owner_id UNINDEXED, ref UNINDEXED, text, tokenize='trigram')`);
    ftsAvailable = true;
  } catch (e) {
    ftsAvailable = false;
  }
  /* Учёт по попыткам: запрос, фаза, статус расхода, число попыток, стоимость. */
  const ucols = db.prepare('PRAGMA table_info(usage)').all().map(function (c) { return c.name; });
  [['request_id', 'TEXT'], ['phase', "TEXT DEFAULT 'main'"], ['usage_status', "TEXT DEFAULT 'reported'"],
    ['attempts', 'INTEGER DEFAULT 1'], ['tokens_cache_read', 'INTEGER DEFAULT 0'],
    ['tokens_reasoning', 'INTEGER DEFAULT 0'], ['cost', 'REAL'], ['outcome', 'TEXT'],
    ['tokens_estimate', 'INTEGER DEFAULT 0'], ['estimate_exact', 'INTEGER DEFAULT 0']].forEach(function (col) {
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

const users = {
  byUsername(username) { return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null; },
  get(uid) { return db.prepare('SELECT * FROM users WHERE id = ?').get(uid) || null; },
  create(username, hash, role = 'user', isDemo = false) {
    const uid = id('u');
    db.prepare('INSERT INTO users (id, username, password_hash, role, created_at, is_demo) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid, username, hash, role, now(), isDemo ? 1 : 0);
    return users.get(uid);
  }
};

const sessions = {
  forUser(uid) { return db.prepare('SELECT * FROM sessions WHERE user_id = ?').get(uid) || null; },
  // Rotate the bearer identifier and all owned records atomically. On logout the
  // replacement stays private until the next login; saved work remains available.
  rotate(sid, uid, ipHash) {
    const next = id('s');
    db.exec('BEGIN');
    try {
      const changed = db.prepare('UPDATE sessions SET id = ?, user_id = ?, ip_hash = ?, last_seen_at = ? WHERE id = ?')
        .run(next, uid, ipHash || '', now(), sid).changes;
      if (!changed) throw new Error('Session no longer exists');
      for (const table of ['resumes', 'vacancies', 'preps', 'interviews', 'usage', 'context_memory']) {
        db.prepare('UPDATE ' + table + ' SET session_id = ? WHERE session_id = ?').run(next, sid);
      }
      if (ftsAvailable) db.prepare('UPDATE evidence_fts SET session_id = ? WHERE session_id = ?').run(next, sid);
      db.exec('COMMIT');
      return sessions.get(next);
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
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
      db.prepare('DELETE FROM context_memory WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM interviews WHERE session_id = ?').run(sid);
      const preps = db.prepare('DELETE FROM preps WHERE session_id = ?').run(sid).changes;
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      evidence.removeSession(sid);
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
        db.prepare('DELETE FROM context_memory WHERE session_id = ?').run(sid);
        db.prepare('DELETE FROM interviews WHERE session_id = ?').run(sid);
        prepsRemoved += db.prepare('DELETE FROM preps WHERE session_id = ?').run(sid).changes;
        db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
        evidence.removeSession(sid);
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
    evidence.replace(sid, 'resume', rid, resumeSections(data));
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
    const res = db.prepare('UPDATE resumes SET title = ?, data = ?, rev = rev + 1, review = NULL, updated_at = ? WHERE id = ? AND session_id = ?')
      .run(title, JSON.stringify(data), now(), rid, sid);
    if (res.changes) evidence.replace(sid, 'resume', rid, resumeSections(data));
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
    const removed = db.prepare('DELETE FROM resumes WHERE id = ? AND session_id = ?').run(rid, sid).changes > 0;
    if (removed) evidence.removeOwner(sid, 'resume', rid);
    return removed;
  }
};

/* Разделы резюме как отдельные документы для поиска подтверждений.
   Ссылка ref называет место в резюме, чтобы модель и память могли на
   него сослаться. Длинный исходный текст режется по абзацам. */
function resumeSections(data) {
  const d = data || {};
  const out = [];
  const push = function (ref, text) {
    const t = String(text || '').trim();
    if (t) out.push({ ref, text: t.slice(0, 1200) });
  };
  push('resume.summary', d.summary);
  (Array.isArray(d.experience) ? d.experience : []).forEach(function (e, i) {
    if (!e || typeof e !== 'object') return;
    push('resume.experience[' + i + ']', [e.role, e.company, e.period, e.details].filter(Boolean).join('. '));
  });
  if (Array.isArray(d.skills) && d.skills.length) push('resume.skills', d.skills.join(', '));
  (Array.isArray(d.achievements) ? d.achievements : []).forEach(function (a, i) { push('resume.achievements[' + i + ']', a); });
  (Array.isArray(d.education) ? d.education : []).forEach(function (e, i) {
    if (!e || typeof e !== 'object') return;
    push('resume.education[' + i + ']', [e.place, e.program, e.period].filter(Boolean).join('. '));
  });
  if (typeof d.rawText === 'string' && d.rawText.trim()) {
    d.rawText.split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 40)
      .forEach(function (par, i) { push('resume.rawText#' + (i + 1), par); });
  }
  return out;
}

/* ---- Вакансии ---- */

function rowToVacancy(row) {
  if (!row) return null;
  return {
    id: row.id, title: row.title, company: row.company || '', rawText: row.raw_text,
    requirements: parse(row.requirements, null), rev: row.rev,
    sourceUrl: row.source_url || '', source: row.source || 'manual', retrievedAt: row.retrieved_at || null,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

const vacancies = {
  create(sid, title, company, rawText, origin) {
    const t = now();
    const vid = id('vac');
    const o = origin || {};
    db.prepare(`INSERT INTO vacancies (id, session_id, title, company, raw_text, rev, created_at, updated_at, source_url, source, retrieved_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
      .run(vid, sid, title, company || '', rawText, t, t, o.sourceUrl || null, o.source || 'manual', o.retrievedAt || null);
    return vacancies.get(sid, vid);
  },
  /* Правка текста повышает версию и сбрасывает требования: их извлекут заново. */
  update(sid, vid, title, company, rawText) {
    const res = db.prepare(`UPDATE vacancies SET title = ?, company = ?, raw_text = ?, requirements = NULL, rev = rev + 1, updated_at = ?
      WHERE id = ? AND session_id = ?`).run(title, company || '', rawText, now(), vid, sid);
    return res.changes ? vacancies.get(sid, vid) : null;
  },
  remove(sid, vid) {
    return db.prepare('DELETE FROM vacancies WHERE id = ? AND session_id = ?').run(vid, sid).changes > 0;
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
    answersRev: row.answers_rev, card: parse(row.card, null), snapshot: parse(row.snapshot, null), feedback: parse(row.feedback, {}),
    sources: parse(row.sources, {}),
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
    const allowed = ['match', 'questions', 'answers', 'ready', 'card', 'feedback', 'sources'];
    const sets = [];
    const values = [];
    allowed.forEach(function (key) {
      if (fields[key] !== undefined) { sets.push(key + ' = ?'); values.push(JSON.stringify(fields[key])); }
    });
    if (!sets.length) return preps.get(sid, pid);
    if (fields.answers !== undefined) {
      sets.push('answers_rev = answers_rev + CASE WHEN answers <> ? THEN 1 ELSE 0 END');
      values.push(JSON.stringify(fields.answers));
    }
    sets.push('updated_at = ?'); values.push(now());
    values.push(pid, sid);
    const stmt = db.prepare('UPDATE preps SET ' + sets.join(', ') + ' WHERE id = ? AND session_id = ?');
    stmt.run.apply(stmt, values);
    return preps.get(sid, pid);
  },
  setFeedbackIfCurrent(sid, pid, answersRev, feedback) {
    return db.prepare('UPDATE preps SET feedback = ?, updated_at = ? WHERE id = ? AND session_id = ? AND answers_rev = ?')
      .run(JSON.stringify(feedback), now(), pid, sid, answersRev).changes > 0;
  },
  /* Снимок пишется один раз для версий, на которых построена подготовка;
     повторная запись для тех же версий не меняет его. */
  setSnapshot(sid, pid, snapshot) {
    db.prepare('UPDATE preps SET snapshot = ? WHERE id = ? AND session_id = ? AND resume_rev = ? AND vacancy_rev = ?')
      .run(JSON.stringify(snapshot), pid, sid, snapshot.resumeRev, snapshot.vacancyRev);
    return preps.get(sid, pid);
  },
  /* Пересборка под текущие версии исходников: старые отчёты и снимок сбрасываются. */
  rebuild(sid, pid, resume, vacancy) {
    db.prepare(`UPDATE preps SET resume_rev = ?, vacancy_rev = ?, match = NULL, questions = NULL, card = NULL,
      snapshot = NULL, sources = '{}', updated_at = ? WHERE id = ? AND session_id = ?`).run(resume.rev, vacancy.rev, now(), pid, sid);
    return preps.get(sid, pid);
  },
  remove(sid, pid) {
    db.prepare(`DELETE FROM context_memory WHERE session_id = ? AND interview_id IN
      (SELECT id FROM interviews WHERE prep_id = ? AND session_id = ?)`).run(sid, pid, sid);
    db.prepare('SELECT id FROM interviews WHERE prep_id = ? AND session_id = ?').all(pid, sid)
      .forEach(function (row) { evidence.removeOwner(sid, 'turn', row.id); });
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

/* Реплики получают устойчивый порядковый номер seq. Старые записи без
   seq нумеруются по позиции при чтении — это стабильно, потому что
   массив только дописывается. */
function withSeq(turns) {
  return (turns || []).map(function (t, i) {
    return Object.assign({}, t, { seq: typeof t.seq === 'number' ? t.seq : i + 1 });
  });
}

function rowToInterview(row) {
  if (!row) return null;
  return {
    id: row.id, prepId: row.prep_id, turns: withSeq(parse(row.turns, [])), summary: parse(row.summary, null),
    finished: row.finished === 1, version: row.version || 0, compacting: (row.compacting || 0) > 0,
    createdAt: row.created_at, updatedAt: row.updated_at
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
    const res = db.prepare('UPDATE interviews SET turns = ?, version = version + 1, updated_at = ? WHERE id = ? AND session_id = ?')
      .run(JSON.stringify(turns), now(), iid, sid);
    if (res.changes) {
      evidence.replace(sid, 'turn', iid, withSeq(turns).map(function (t) { return { ref: String(t.seq), text: t.text }; }));
    }
  },
  /* Добавить реплику идемпотентно и без потери обновления.
       clientTurnId — идентификатор от клиента: повторная отправка той же
                      реплики (обрыв сети, вторая вкладка) не создаёт дубля;
       CAS по version — если между чтением и записью интервью изменилось,
                      читаем заново и повторяем.
     Возвращает { interview, turn, duplicate }. */
  appendTurn(sid, iid, turn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = interviews.get(sid, iid);
      if (!current) return null;
      if (turn.clientTurnId) {
        const existing = current.turns.find(function (t) { return t.clientTurnId === turn.clientTurnId; });
        if (existing) return { interview: current, turn: existing, duplicate: true };
      }
      const nextSeq = current.turns.length ? current.turns[current.turns.length - 1].seq + 1 : 1;
      const stored = { seq: nextSeq, role: turn.role, text: turn.text, ts: turn.ts || now() };
      if (turn.clientTurnId) stored.clientTurnId = turn.clientTurnId;
      const turns = current.turns.concat([stored]);
      const res = db.prepare(`UPDATE interviews SET turns = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND session_id = ? AND version = ?`)
        .run(JSON.stringify(turns), now(), iid, sid, current.version);
      if (res.changes === 1) {
        evidence.add(sid, 'turn', iid, String(stored.seq), stored.text);
        return { interview: Object.assign({}, current, { turns, version: current.version + 1 }), turn: stored, duplicate: false };
      }
      /* Кто-то успел записать раньше — повторяем с новой версией. */
    }
    throw new Error('Не удалось добавить реплику: интервью меняется слишком часто');
  },
  /* Флаг «идёт сжатие»: один compaction на интервью одновременно.
     Хранится время захвата: замок старше двух минут считается брошенным
     (процесс упал посреди сжатия) и перехватывается. */
  tryLockCompaction(sid, iid, staleMs) {
    const t = now();
    return db.prepare(`UPDATE interviews SET compacting = ? WHERE id = ? AND session_id = ?
        AND (compacting = 0 OR compacting <= ?)`)
      .run(t, iid, sid, t - (typeof staleMs === 'number' ? staleMs : 120000)).changes === 1;
  },
  unlockCompaction(sid, iid) {
    db.prepare('UPDATE interviews SET compacting = 0 WHERE id = ? AND session_id = ?').run(iid, sid);
  },
  finish(sid, iid, summary) {
    db.prepare('UPDATE interviews SET summary = ?, finished = 1, updated_at = ? WHERE id = ? AND session_id = ?')
      .run(JSON.stringify(summary), now(), iid, sid);
    return interviews.get(sid, iid);
  }
};

/* ---- Память интервью ----
   Отдельно от итога interviews.summary. Публикуется атомарно с CAS по
   memory_version: неудачное сжатие не портит прежнюю валидную память. */

function rowToMemory(row) {
  if (!row) return null;
  return {
    interviewId: row.interview_id, memoryVersion: row.memory_version, status: row.status,
    sourceRevisions: parse(row.source_revisions, {}), coveredThroughSeq: row.covered_through_seq,
    memory: parse(row.memory, {}), createdAt: row.created_at, updatedAt: row.updated_at
  };
}

const contextMemory = {
  get(sid, iid) {
    return rowToMemory(db.prepare('SELECT * FROM context_memory WHERE interview_id = ? AND session_id = ?').get(iid, sid));
  },
  /* CAS: expectedVersion — версия, которую читал вызывающий. 0 — записи ещё нет. */
  publish(sid, iid, expectedVersion, payload) {
    const t = now();
    if (expectedVersion === 0) {
      try {
        db.prepare(`INSERT INTO context_memory (interview_id, session_id, memory_version, status, source_revisions,
            covered_through_seq, memory, created_at, updated_at) VALUES (?, ?, 1, 'valid', ?, ?, ?, ?, ?)`)
          .run(iid, sid, JSON.stringify(payload.sourceRevisions || {}), payload.coveredThroughSeq || 0,
            JSON.stringify(payload.memory || {}), t, t);
        return { ok: true, memoryVersion: 1 };
      } catch (e) {
        return { ok: false, conflict: true };
      }
    }
    const res = db.prepare(`UPDATE context_memory SET memory_version = memory_version + 1, status = 'valid',
        source_revisions = ?, covered_through_seq = ?, memory = ?, updated_at = ?
      WHERE interview_id = ? AND session_id = ? AND memory_version = ?`)
      .run(JSON.stringify(payload.sourceRevisions || {}), payload.coveredThroughSeq || 0,
        JSON.stringify(payload.memory || {}), t, iid, sid, expectedVersion);
    return res.changes === 1 ? { ok: true, memoryVersion: expectedVersion + 1 } : { ok: false, conflict: true };
  },
  /* Изменение исходников делает память устаревшей, но не удаляет её:
     активное интервью продолжается на старой версии с явной пометкой. */
  markStale(sid, iid) {
    db.prepare("UPDATE context_memory SET status = 'stale', updated_at = ? WHERE interview_id = ? AND session_id = ?")
      .run(now(), iid, sid);
  },
  markStaleForPrep(sid, pid) {
    db.prepare(`UPDATE context_memory SET status = 'stale', updated_at = ? WHERE session_id = ? AND interview_id IN
      (SELECT id FROM interviews WHERE prep_id = ? AND session_id = ?)`).run(now(), sid, pid, sid);
  },
  remove(sid, iid) {
    return db.prepare('DELETE FROM context_memory WHERE interview_id = ? AND session_id = ?').run(iid, sid).changes;
  }
};

/* ---- Индекс подтверждений ----
   Хранит только текст разделов резюме и реплик с владельцем; поиск —
   подстрочный (trigram), ранжирование bm25. Ничего сверх того, что уже
   лежит в resumes и interviews, не хранится; удаляется вместе с ними. */

const evidence = {
  available() { return ftsAvailable; },
  add(sid, kind, ownerId, ref, text) {
    if (!ftsAvailable) return;
    const t = String(text || '').trim();
    if (!t) return;
    db.prepare('INSERT INTO evidence_fts (session_id, kind, owner_id, ref, text) VALUES (?, ?, ?, ?, ?)')
      .run(sid, kind, ownerId, ref, t.slice(0, 4000));
  },
  replace(sid, kind, ownerId, docs) {
    if (!ftsAvailable) return;
    db.prepare('DELETE FROM evidence_fts WHERE session_id = ? AND kind = ? AND owner_id = ?').run(sid, kind, ownerId);
    (docs || []).forEach(function (d) { evidence.add(sid, kind, ownerId, d.ref, d.text); });
  },
  removeOwner(sid, kind, ownerId) {
    if (!ftsAvailable) return;
    db.prepare('DELETE FROM evidence_fts WHERE session_id = ? AND kind = ? AND owner_id = ?').run(sid, kind, ownerId);
  },
  removeSession(sid) {
    if (!ftsAvailable) return;
    db.prepare('DELETE FROM evidence_fts WHERE session_id = ?').run(sid);
  },
  /* match — выражение FTS5 (фразы в кавычках через OR). Только свои документы. */
  search(sid, kind, ownerId, match, limit) {
    if (!ftsAvailable || !match) return [];
    try {
      return db.prepare(`SELECT ref, text, bm25(evidence_fts) AS rank FROM evidence_fts
          WHERE evidence_fts MATCH ? AND session_id = ? AND kind = ? AND owner_id = ? ORDER BY rank LIMIT ?`)
        .all(match, sid, kind, ownerId, Math.max(1, Number(limit) || 5))
        .map(function (r) { return { ref: r.ref, text: r.text, rank: r.rank }; });
    } catch (e) {
      /* Неразборчивое выражение — не ошибка запроса пользователя, а пустой результат. */
      return [];
    }
  },
  count(sid, kind, ownerId) {
    if (!ftsAvailable) return 0;
    return db.prepare('SELECT COUNT(*) AS c FROM evidence_fts WHERE session_id = ? AND kind = ? AND owner_id = ?')
      .get(sid, kind, ownerId).c;
  }
};

/* ---- Учёт расходов ---- */

const usage = {
  /* Одна запись на попытку. usageStatus: reported — расход пришёл от
     сервиса; unknown — не пришёл, токены оценены и помечены как оценка,
     это НЕ «бесплатно»; not_applicable — заглушка. Содержимого здесь нет:
     лишние поля записи (текст, ключи) не сохраняются. */
  forSession(sid) {
    const uid = sessions.get(sid)?.user_id || null;
    return entry => usage.record(sid, entry, uid);
  },
  record(sid, entry, uid = sessions.get(sid)?.user_id || null) {
    db.prepare(`INSERT INTO usage (session_id, user_id, stage, task, provider, model, tokens_in, tokens_out,
        estimated, input_estimated, output_estimated, cost_usd, pricing_missing, pricing_version, ok, ms, created_at,
        request_id, phase, usage_status, attempts, tokens_cache_read, tokens_reasoning, cost, outcome,
        tokens_estimate, estimate_exact)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sid, uid, entry.stage || require('../../shared/ai/routing.js').STAGES[entry.task] || 'unknown',
        entry.task, entry.provider, entry.model || '', entry.tokensIn || 0, entry.tokensOut || 0,
        entry.estimated !== false ? 1 : 0, entry.inputEstimated !== false ? 1 : 0, entry.outputEstimated !== false ? 1 : 0,
        entry.costUsd || 0, entry.pricingMissing !== false ? 1 : 0, entry.pricingVersion || 'legacy-unpriced',
        entry.ok ? 1 : 0, entry.ms || 0, now(),
        entry.requestId || null, entry.phase || 'main', entry.usageStatus || (entry.estimated === false ? 'reported' : 'unknown'),
        entry.attempts || 1, entry.tokensCacheRead || 0, entry.tokensReasoning || 0,
        entry.cost === undefined ? null : entry.cost, entry.outcome || null,
        entry.tokensEstimate || 0, entry.estimateExact ? 1 : 0);
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
    days = Math.min(365, Math.max(1, Math.floor(Number(days) || 30)));
    const until = Date.now();
    const since = until - days * 86400000;
    const metrics = `COUNT(*) AS requests, COUNT(DISTINCT session_id) AS sessions, COALESCE(SUM(ok),0) AS succeeded,
      COALESCE(SUM(1-ok),0) AS failures, COALESCE(SUM(tokens_in),0) AS tokensIn,
      COALESCE(SUM(tokens_out),0) AS tokensOut, COALESCE(SUM(cost_usd),0) AS estimatedCostUsd,
      COALESCE(SUM(estimated),0) AS estimatedRequests, COALESCE(SUM(1-estimated),0) AS reportedRequests,
      COALESCE(SUM(pricing_missing),0) AS unpricedRequests,
      COALESCE(SUM(CASE WHEN usage_status = 'unknown' THEN 1 ELSE 0 END),0) AS usageUnknown,
      COALESCE(SUM(attempts),0) AS attempts, COALESCE(ROUND(AVG(ms)),0) AS avgMs`;
    function group(columns, by) {
      return db.prepare(`SELECT ${columns}, ${metrics} FROM usage u LEFT JOIN users a ON a.id = u.user_id
        WHERE u.created_at >= ? AND u.created_at <= ? GROUP BY ${by} ORDER BY requests DESC`).all(since, until);
    }
    return { since, until, days,
      totals: db.prepare(`SELECT ${metrics} FROM usage WHERE created_at >= ? AND created_at <= ?`).get(since, until),
      byUser: group("u.user_id AS userId, a.username AS username", 'u.user_id'),
      byStage: group('stage', 'stage'), byProvider: group('provider', 'provider'),
      byModel: group('provider, model', 'provider, model'), byTask: group('task, provider', 'task, provider'),
      byPhase: group('phase', 'phase'),
      byDay: group("date(u.created_at / 1000, 'unixepoch') AS day", 'day').sort((a,b) => a.day.localeCompare(b.day)),
      sessions: db.prepare('SELECT COUNT(*) AS total, SUM(paid_until > ?) AS paid FROM sessions').get(until),
      preps: db.prepare('SELECT COUNT(*) AS total FROM preps WHERE created_at >= ?').get(since).total,
      resumes: db.prepare('SELECT COUNT(*) AS total FROM resumes').get().total
    };
  }
};

module.exports = { open, close, closeIf, id, users, sessions, resumes, vacancies, preps, interviews, contextMemory, evidence,
  resumeSections, usage };
