/* Настройки программы.

   На диск записывается только то, что не является персональными данными
   и не является секретом: провайдер, модель, режим чтения экрана,
   интервал, факт принятия условий.

   Ключ доступа к сервису НЕ записывается на диск: он живёт в памяти
   процесса до закрытия программы. Это осознанное решение прототипа —
   безопасное хранение секретов требует отдельной проработки. */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  consentAccepted: false,
  consentAcceptedAt: '',
  provider: 'mock',
  model: '',
  endpoint: '',
  locale: 'ru-RU',
  /* vision — кадр отправляется мультимодальной модели;
     text   — на кадре сначала распознаётся текст (в прототипе не подключено);
     mock   — фиксированные ответы без сети. */
  readMode: 'mock',
  intervalSec: 12,
  overlayOpacity: 0.95,
  contextBudget: 12000
};

let dir = '';
let file = '';
let data = Object.assign({}, DEFAULTS);
let apiKey = process.env.ASSISTANT_API_KEY || '';

function init(userDataDir) {
  dir = userDataDir || '.';
  file = path.join(dir, 'settings.json');
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      data = Object.assign({}, DEFAULTS, sanitize(parsed));
    }
  } catch (e) {
    data = Object.assign({}, DEFAULTS);
  }
  return data;
}

const ALLOWED_PROVIDERS = ['mock', 'yandex', 'gigachat', 'openai_compatible',
  'anthropic', 'openai', 'gemini'];
const ALLOWED_READ_MODES = ['mock', 'vision', 'text'];

/* Защита от случайной записи лишнего: сохраняем только известные ключи
   и проверяем значения, а не только имена полей. */
function sanitize(input) {
  const out = {};
  Object.keys(DEFAULTS).forEach(function (key) {
    if (input[key] === undefined) return;
    const value = input[key];
    if (key === 'provider' && ALLOWED_PROVIDERS.indexOf(value) < 0) return;
    if (key === 'readMode' && ALLOWED_READ_MODES.indexOf(value) < 0) return;
    if (key === 'endpoint' && value && !/^https?:\/\//.test(String(value))) return;
    if (typeof DEFAULTS[key] === 'number' && typeof value !== 'number') return;
    if (typeof DEFAULTS[key] === 'boolean' && typeof value !== 'boolean') return;
    if (typeof DEFAULTS[key] === 'string' && typeof value !== 'string') return;
    if (key === 'intervalSec') { out[key] = Math.max(5, Math.min(120, value)); return; }
    out[key] = value;
  });
  return out;
}

function save() {
  if (!file) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(sanitize(data), null, 2), 'utf8');
  } catch (e) {
    /* Программа продолжает работать и без сохранения настроек. */
  }
}

function get() {
  return data;
}

function patch(partial) {
  Object.assign(data, sanitize(partial || {}));
  save();
  return data;
}

/* Представление для окон: без ключа, но с признаком его наличия. */
function publicView() {
  return Object.assign({}, data, { hasApiKey: hasApiKey(), keyStoredOnDisk: false });
}

function setApiKey(value) {
  apiKey = String(value || '');
}

function getApiKey() {
  return apiKey;
}

function hasApiKey() {
  return apiKey.length > 0;
}

function filePath() {
  return file;
}

module.exports = { init, get, patch, publicView, setApiKey, getApiKey, hasApiKey, filePath, DEFAULTS };
