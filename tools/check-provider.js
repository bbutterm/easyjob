/* Проверка связи с провайдером модели.
   Запуск:  node tools/check-provider.js
   Читает .env (или переменные окружения), выполняет одну короткую задачу —
   извлечение требований из учебного текста вакансии — и печатает результат.
   База не нужна, персональные данные не отправляются. */

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

const ContextStore = require('../shared/context/store.js');
const AiRequest = require('../shared/ai/request.js');
const Providers = require('../shared/ai/providers/index.js');
const Capabilities = require('../shared/ai/capabilities.js');

const provider = process.env.AI_PROVIDER || 'mock';
const profile = Capabilities.profile(provider);
if (!profile) {
  console.log('Неизвестный провайдер: ' + provider + '. Доступные: ' + Capabilities.ids().join(', '));
  process.exit(2);
}
const model = process.env.AI_MODEL || profile.defaultModel || '';
const policy = Capabilities.productAllowed(provider, model);
if (!policy.allowed && process.env.AI_ALLOW_CLOSED_PROVIDERS !== '1') {
  console.log('Не допущено политикой продукта: ' + policy.reason + '. Для сравнительной оценки задайте AI_ALLOW_CLOSED_PROVIDERS=1.');
  process.exit(2);
}

console.log('Провайдер:  ' + provider + ' — ' + profile.title);
console.log('Модель:     ' + (model || '(не задана)'));
console.log('Регион:     ' + ({ ru: 'РФ', global: 'за рубежом', self: 'у себя', none: '—' }[profile.dataRegion] || '—'));
console.log('Ключ:       ' + (process.env.AI_API_KEY ? 'задан' : 'не задан'));
console.log('Сверено:    ' + (profile.verified ? 'да' : 'нет — первый живой вызов покажет, верна ли форма запроса'));
console.log('');

if (provider !== 'mock' && !process.env.AI_API_KEY && provider !== 'openai_compatible') {
  console.log('Нет ключа: задайте AI_API_KEY в .env.');
  process.exit(2);
}
if (provider === 'yandex' && !process.env.AI_FOLDER_ID) {
  console.log('Для YandexGPT нужен AI_FOLDER_ID — идентификатор каталога.');
  process.exit(2);
}

const store = ContextStore.create({ contextBudget: 8000 });
store.set('identity', { language: process.env.AI_LOCALE || 'ru-RU', profession: 'Повар', professionKnown: true });
store.set('preparation', {
  vacancy: { title: 'Повар', company: 'Учебный пример' },
  vacancyRawText: 'Ищем повара в ресторан.\n\nТребования:\n— Опыт на горячем цехе от 2 лет\n'
    + '— Работа по технологическим картам\n— Действующая медицинская книжка\n\nУсловия: сменный график.'
});

const request = AiRequest.build('vacancy.parse', store.build().context, {
  provider, model, locale: process.env.AI_LOCALE || 'ru-RU',
  endpoint: process.env.AI_ENDPOINT || undefined
});

const started = Date.now();
Providers.execute(request, {
  apiKey: process.env.AI_API_KEY || '',
  endpoint: process.env.AI_ENDPOINT || undefined,
  folderId: process.env.AI_FOLDER_ID || undefined,
  timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 60000,
  retries: 1
}).then(function (result) {
  const ms = Date.now() - started;
  if (!result.ok) {
    console.log('ОШИБКА за ' + ms + ' мс' + (result.status ? ', код ' + result.status : '') + ': ' + result.error);
    if (result.refused) console.log('Модель отклонила запрос.');
    console.log('\nЧто проверить: ключ, имя модели, адрес сервиса, доступ к сети с сервера. '
      + 'Подробности по провайдеру — docs/providers.md.');
    process.exit(1);
  }
  console.log('Ответ получен за ' + ms + ' мс' + (result.attempts > 1 ? ' (попыток: ' + result.attempts + ')' : '')
    + (result.mock ? ' — это заглушка, сети не было' : ''));
  if (result.usage) {
    console.log('Токены:     вход ' + result.usage.input + ', выход ' + result.usage.output
      + (result.usage.cacheRead ? ', из кэша ' + result.usage.cacheRead : '')
      + (result.usage.reasoning ? ', рассуждение ' + result.usage.reasoning : '')
      + (result.usage.cost !== undefined ? ', стоимость ' + result.usage.cost : ''));
  } else if (!result.mock) {
    console.log('Токены:     сервис не вернул расход — статус «неизвестно», не ноль.');
  }
  const parsed = AiRequest.parseJson(result.text);
  if (!parsed.ok) {
    console.log('Ответ пришёл, но это не JSON: ' + parsed.error);
    console.log('Первые 300 символов:\n' + String(result.text).slice(0, 300));
    process.exit(1);
  }
  const reqs = parsed.value.requirements || [];
  console.log('Требований извлечено: ' + reqs.length);
  reqs.forEach(function (r) { console.log('  — ' + r.text + (r.kind ? ' [' + r.kind + ']' : '')); });
  const hasMed = reqs.some(function (r) { return /медицинск/i.test(r.text || ''); });
  console.log('');
  console.log(hasMed ? 'Проверка пройдена: модель нашла требования из текста.'
    : 'Ответ есть, но медицинская книжка из текста не найдена — посмотрите на промпт или модель.');
  process.exit(hasMed ? 0 : 1);
});
