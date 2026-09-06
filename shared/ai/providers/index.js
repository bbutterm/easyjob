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

  /* Потоковый ответ приходит событиями Server-Sent Events, а не одним
     объектом JSON: разбирать его через response.json() нельзя. */
  if (response.ok && wire.body && wire.body.stream) {
    return readStream(response, impl, request);
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

/* Сборка текста из потока событий.
   onDelta вызывается по мере поступления, чтобы окно подсказки
   могло показывать ответ до его завершения. */
async function readStream(response, impl, request) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    return { ok: false, error: 'Сервис вернул поток, но его нельзя прочитать в этой среде.' };
  }
  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '';
  var text = '';
  var stopReason = null;
  var onDelta = request && typeof request.onDelta === 'function' ? request.onDelta : null;

  try {
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      var lines = buffer.split('\n');
      buffer = lines.pop();

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.indexOf('data:') !== 0) continue;
        var payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        var event;
        try { event = JSON.parse(payload); } catch (e) { continue; }

        if (event.type === 'error' || event.error) {
          return { ok: false,
            error: (event.error && event.error.message) || 'Ошибка в потоке ответа' };
        }
        var delta = impl.streamDelta ? impl.streamDelta(event) : '';
        if (delta) {
          text += delta;
          if (onDelta) onDelta(delta, text);
        }
        var stop = impl.streamStop ? impl.streamStop(event) : null;
        if (stop) stopReason = stop;
      }
    }
  } catch (e) {
    return { ok: false, error: 'Поток ответа прервался: ' + e.message };
  }

  if (stopReason === 'refusal') {
    return { ok: false, refused: true, error: 'Запрос отклонён моделью' };
  }
  if (stopReason === 'max_tokens' || stopReason === 'length') {
    return { ok: true, text: text.trim(), stopReason: stopReason, truncated: true, usage: null };
  }
  return { ok: true, text: text.trim(), stopReason: stopReason, usage: null };
}

module.exports = { adapter: adapter, execute: execute, ids: Object.keys(ADAPTERS) };
