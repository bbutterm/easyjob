/* Журнал: одна строка JSON на событие, персональные данные скрыты
   через AiRequest.redactForLog. Сюда никогда не попадают ключ провайдера,
   текст резюме и ответы пользователя. */

'use strict';

const AiRequest = require('../../shared/ai/request.js');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = LEVELS.info;

function setLevel(name) {
  threshold = LEVELS[name] || LEVELS.info;
}

function write(level, message, data) {
  if (LEVELS[level] < threshold) return;
  const entry = { ts: new Date().toISOString(), level, msg: message };
  if (data) entry.data = AiRequest.redactForLog(data);
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  setLevel,
  debug: (m, d) => write('debug', m, d),
  info: (m, d) => write('info', m, d),
  warn: (m, d) => write('warn', m, d),
  error: (m, d) => write('error', m, d)
};
