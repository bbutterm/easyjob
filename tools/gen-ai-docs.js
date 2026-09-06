/* Генерация docs/ai-variables.md из каталога переменных и матрицы провайдеров.
   Запуск: node tools/gen-ai-docs.js
   Документация не пишется руками, чтобы не разойтись с кодом. */

'use strict';

var fs = require('fs');
var path = require('path');

var V = require('../shared/ai/variables.js');
var C = require('../shared/ai/capabilities.js');
var R = require('../shared/ai/request.js');

function esc(text) {
  return String(text === undefined || text === null ? '' : text).replace(/\|/g, '\\|');
}

var out = [];
out.push('# Переменные для запросов к модели');
out.push('');
out.push('> Файл сгенерирован из `shared/ai/variables.js`, `shared/ai/capabilities.js` и');
out.push('> `shared/ai/request.js` командой `node tools/gen-ai-docs.js`. Руками не править —');
out.push('> правьте исходники и перегенерируйте.');
out.push('');
out.push('Всего переменных: **' + V.allVariables().length + '**, из них с персональными данными: **'
  + V.piiKeys().length + '**. Задач: **' + V.tasks.length + '**. Провайдеров: **' + C.ids().length + '**.');
out.push('');

out.push('## Группы переменных');
out.push('');
V.groups.forEach(function (g) {
  out.push('### ' + g.title + ' (`' + g.id + '`)');
  out.push('');
  if (g.note) { out.push(g.note); out.push(''); }
  out.push('| Переменная | Тип | Обяз. | ПДн | Источник | Объём | Пояснение |');
  out.push('| --- | --- | --- | --- | --- | --- | --- |');
  g.vars.forEach(function (v) {
    out.push('| `' + v.key + '` | ' + esc(v.type) + ' | ' + (v.required ? 'да' : 'нет') + ' | '
      + (v.pii ? '**да**' : 'нет') + ' | ' + esc(v.source) + ' | ' + esc(v.budget) + ' | '
      + esc(v.note) + ' |');
  });
  out.push('');
});

out.push('## Задачи');
out.push('');
out.push('Для каждой задачи указано, какие переменные она использует, что возвращает и какие');
out.push('ограничения заданы по умолчанию в `shared/ai/request.js`.');
out.push('');
V.tasks.forEach(function (t) {
  var d = R.defaultsFor(t.id);
  out.push('### `' + t.id + '` — ' + t.title);
  out.push('');
  out.push('- **Переменные:** ' + t.uses.map(function (u) { return '`' + u + '`'; }).join(', '));
  out.push('- **Формат ответа:** ' + t.output + ' — `' + esc(t.outputShape) + '`');
  out.push('- **По умолчанию:** длина ответа ' + d.maxOutputTokens + ' токенов, бюджет контекста '
    + d.contextBudget + ' токенов, потоковый вывод: ' + (d.streaming ? 'да' : 'нет')
    + (d.maxWords ? ', предел ' + d.maxWords + ' слов' : ''));
  out.push('- **Правило:** ' + t.note);
  out.push('');
});

out.push('## Провайдеры');
out.push('');
out.push('Набор переменных одинаков для всех сервисов. Различается только способ их передачи.');
out.push('');
out.push('| Провайдер | Системная инструкция | Формат истории | Структурированный ответ | Поле длины | Изображения | Поток | Кэш префикса | Глубина рассуждения | Сверено |');
out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
C.ids().forEach(function (id) {
  var p = C.profile(id);
  out.push('| **' + p.title + '** (`' + id + '`) | ' + esc(p.systemChannel) + ' | ' + esc(p.messageShape)
    + ' | ' + esc(p.jsonMode) + ' | `' + esc(p.maxTokensField) + '` | ' + (p.vision ? 'да' : 'нет')
    + ' | ' + (p.streaming ? 'да' : 'нет') + ' | ' + esc(p.promptCache) + ' | ' + esc(p.reasoning)
    + ' | ' + (p.verified ? 'да' : '**нет**') + ' |');
});
out.push('');
out.push('Столбец «Сверено» означает, что форма запроса проверена по актуальной документации.');
out.push('Для остальных сервисов адаптер написан по общеизвестной схеме интерфейса и требует');
out.push('проверки перед боевым запуском.');
out.push('');

C.ids().forEach(function (id) {
  var p = C.profile(id);
  if (!p.notes || !p.notes.length) return;
  out.push('### ' + p.title);
  out.push('');
  p.notes.forEach(function (n) { out.push('- ' + n); });
  out.push('');
});

out.push('## Персональные данные');
out.push('');
out.push('Переменные ниже содержат персональные данные. Правила обращения с ними:');
out.push('');
out.push('- передавать только в те задачи, где они действительно нужны (список выше по задачам);');
out.push('- не записывать в журналы — `AiRequest.redactForLog()` заменяет их на `[скрыто]`;');
out.push('- не сохранять на диск в программе для компьютера;');
out.push('- удалять вместе с сессией.');
out.push('');
V.piiKeys().forEach(function (k) { out.push('- `' + k + '`'); });
out.push('');

var target = path.join(__dirname, '..', 'docs', 'ai-variables.md');
fs.writeFileSync(target, out.join('\n'), 'utf8');
console.log('docs/ai-variables.md обновлён: ' + out.length + ' строк');
