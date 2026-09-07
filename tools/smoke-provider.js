/* Живая проверка провайдера через серверный конвейер (маршрутизация,
   пределы, учёт расхода) на синтетических данных без персональных сведений.

   Запуск на сервере с .env:  node tools/smoke-provider.js [--tasks a,b]
   Печатает по каждой задаче: провайдер, модель, задача, статус, задержка,
   расход (сообщён или оценка), проверка схемы, оценка стоимости.
   Промпт и сырой ответ модели НЕ печатаются. База — в памяти. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
try {
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').forEach(function (line) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* .env нет — берём переменные окружения */ }
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const db = require('../server/lib/db.js');
const ai = require('../server/lib/ai.js');
const Routing = require('../shared/ai/routing.js');

const RESUME = { profession: 'Повар', summary: 'Повар горячего цеха, пять лет в ресторанах полного цикла.',
  experience: [{ role: 'Повар', company: 'Учебный ресторан', period: '2021 — сейчас', details: 'Горячий цех, технологические карты, заготовки.' }],
  skills: ['Горячий цех', 'Технологические карты', 'Санитарные нормы'], achievements: [], education: [] };
const VACANCY = 'Ищем повара в ресторан.\n\nТребования:\n— Опыт на горячем цехе от 2 лет\n— Работа по технологическим картам\n— Действующая медицинская книжка\n\nУсловия: сменный график.';

const SCHEMAS = {
  'vacancy.parse': function (j) { return Array.isArray(j.requirements) && j.requirements.every(function (r) { return r && typeof r.text === 'string'; }); },
  'resume.review': function (j) { return ai.validReview(j); },
  'match.requirements': function (j) { return Array.isArray(j.items) && j.items.every(function (m) { return m && ['confirmed', 'unclear', 'missing'].indexOf(m.status) >= 0; }); },
  'questions.generate': function (j) { return Array.isArray(j.questions) && j.questions.length > 0 && j.questions.every(function (q) { return q && typeof q.text === 'string'; }); }
};

const args = process.argv.slice(2);
const tasks = (args[args.indexOf('--tasks') + 1] && args.indexOf('--tasks') >= 0 ? args[args.indexOf('--tasks') + 1] : 'vacancy.parse,resume.review,match.requirements,questions.generate').split(',');

(async () => {
  db.open(':memory:');
  const sid = db.sessions.create('smoke').id;
  const resume = db.resumes.create(sid, 'Учебное', RESUME);
  let vacancy = db.vacancies.create(sid, 'Повар', 'Учебный ресторан', VACANCY);
  const rows = [];
  let failed = 0;
  for (const task of tasks) {
    const route = Routing.load().resolve(task);
    const parts = { resume, vacancy, prep: null };
    if (task === 'match.requirements' || task === 'questions.generate') {
      if (!vacancy.requirements) {
        vacancy.requirements = [{ id: 'req-1', text: 'Опыт на горячем цехе от 2 лет', kind: 'hard', weight: 2 },
          { id: 'req-2', text: 'Работа по технологическим картам', kind: 'hard', weight: 1 }, { id: 'req-3', text: 'Действующая медицинская книжка', kind: 'formal', weight: 1 }];
      }
      parts.prep = db.preps.create(sid, resume, vacancy, 'Повар');
      if (task === 'questions.generate') parts.prep.match = [{ id: 'req-3', text: 'Действующая медицинская книжка', status: 'missing', evidence: 'В резюме нет' }];
    }
    const started = Date.now();
    const result = await ai.run(sid, task, parts);
    const ms = Date.now() - started;
    const usage = db.usage.byRequest(sid, result.requestId);
    const last = usage[usage.length - 1] || {};
    const schemaOk = result.ok && SCHEMAS[task] ? SCHEMAS[task](result.json || {}) : (result.ok ? true : false);
    if (!result.ok || !schemaOk) failed++;
    if (result.ok && task === 'vacancy.parse' && result.json.requirements) { db.vacancies.setRequirements(sid, vacancy.id, result.json.requirements.map(function (r, i) { return { id: r.id || ('req-' + (i + 1)), text: r.text, kind: r.kind || 'hard', weight: 1 }; })); vacancy = db.vacancies.get(sid, vacancy.id); }
    rows.push({
      task, provider: route.provider, model: (result.source && result.source.model) || route.model || '',
      status: result.ok ? (schemaOk ? 'ok' : 'schema_invalid') : (result.code || 'error'),
      latencyMs: ms, tokensIn: last.tokens_in, tokensOut: last.tokens_out,
      usage: last.usage_status === 'reported' ? 'сообщён' : (last.usage_status === 'not_applicable' ? 'заглушка' : 'оценка'),
      schema: schemaOk ? 'да' : 'нет', costUsd: last.cost_usd, pricing: last.pricing_missing ? 'цены нет' : last.pricing_version,
      mock: result.mock === true, error: result.ok ? '' : String(result.error || '').slice(0, 80)
    });
  }
  db.close();
  console.log('Провайдер / модель / задача / статус / задержка / расход / схема / стоимость');
  rows.forEach(function (r) {
    console.log([r.provider, r.model || '(по умолчанию)', r.task, r.status + (r.mock ? ' (заглушка)' : ''), r.latencyMs + ' мс',
      'вход ' + r.tokensIn + ', выход ' + r.tokensOut + ' (' + r.usage + ')', 'схема: ' + r.schema, '≈ $' + Number(r.costUsd || 0).toFixed(6) + ' (' + r.pricing + ')'].join(' | ')
      + (r.error ? '\n    ошибка: ' + r.error : ''));
  });
  console.log('');
  console.log(failed ? 'ПРОВАЛ: ' + failed + ' из ' + rows.length + ' задач не прошли.' : 'Пройдено: ' + rows.length + ' задач.');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('Ошибка проверки:', e.message); process.exit(1); });
