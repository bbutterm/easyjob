/* Реестр адаптеров и единая точка выполнения запроса.

   Прикладной код вызывает execute() и не знает, какой сервис работает.
   Ключ доступа не логируется и не покидает процесс, который делает запрос. */

'use strict';

var anthropic = require('./anthropic.js');
var openai = require('./openai.js');
var gemini = require('./gemini.js');
var mock = require('./mock.js');

var ADAPTERS = {
  anthropic: anthropic,
  openai: openai,
  /* Локальные и совместимые сервисы используют тот же формат запроса,
     что и OpenAI, но с другим адресом и часто без ключа. */
  openai_compatible: openai,
  gemini: gemini,
  mock: mock
};

function adapter(id) {
  return ADAPTERS[id] || mock;
}

/* execute — единственное место, где происходит сетевой вызов.
   fetchImpl передаётся снаружи, чтобы код оставался проверяемым
   и не тянул зависимости в браузерную часть. */
async function execute(request, runtime, fetchImpl) {
  var impl = adapter(request.provider);

  if (impl.run) return impl.run(request, runtime);

  var wire = impl.toWire(request, runtime || {});
  var doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { ok: false, error: 'Нет реализации fetch для запроса' };

  var response;
  try {
    response = await doFetch(wire.url, {
      method: wire.method,
      headers: wire.headers,
      body: JSON.stringify(wire.body)
    });
  } catch (e) {
    return { ok: false, error: 'Сеть недоступна: ' + e.message };
  }

  var json;
  try {
    json = await response.json();
  } catch (e) {
    return { ok: false, error: 'Ответ не является JSON (код ' + response.status + ')' };
  }

  if (!response.ok) {
    var parsed = impl.fromWire(json);
    return { ok: false, status: response.status,
      error: parsed.error || ('Ошибка сервиса, код ' + response.status) };
  }
  return impl.fromWire(json);
}

module.exports = { adapter: adapter, execute: execute, ids: Object.keys(ADAPTERS) };
