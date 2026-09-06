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

/* Коды, при которых имеет смысл повторить запрос. Остальные ошибки
   означают неверный запрос или ключ — повтор их не исправит. */
var RETRIABLE = [408, 409, 425, 429, 500, 502, 503, 504, 529];

var DEFAULT_TIMEOUT_MS = 30000;
var DEFAULT_RETRIES = 2;

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/* Пауза перед повтором: сервис может назвать её сам заголовком
   retry-after, иначе растёт по степени двойки. */
function retryDelay(attempt, response) {
  if (response && response.headers && typeof response.headers.get === 'function') {
    var header = response.headers.get('retry-after');
    var seconds = Number(header);
    if (header && !isNaN(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60000);
  }
  return Math.min(500 * Math.pow(2, attempt), 8000);
}

/* execute — единственное место, где происходит сетевой вызов.
   fetchImpl передаётся снаружи, чтобы код оставался проверяемым
   и не тянул зависимости в браузерную часть.

   Запрос ограничен по времени и повторяется при временных отказах:
   без этого цикл помощника встаёт при первом же 429 или зависании. */
async function execute(request, runtime, fetchImpl) {
  var impl = adapter(request.provider);

  if (impl.run) return impl.run(request, runtime);

  var rt = runtime || {};
  var wire = impl.toWire(request, rt);
  var doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { ok: false, error: 'Нет реализации fetch для запроса' };

  var timeoutMs = rt.timeoutMs || DEFAULT_TIMEOUT_MS;
  var maxRetries = rt.retries === undefined ? DEFAULT_RETRIES : rt.retries;

  var response = null;
  var lastError = '';
  var attempts = 0;

  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    /* Внешняя отмена: сессия остановлена, ответ уже не нужен. */
    if (controller && rt.signal && typeof rt.signal.addEventListener === 'function') {
      rt.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
    }
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;

    try {
      response = await doFetch(wire.url, {
        method: wire.method,
        headers: wire.headers,
        body: JSON.stringify(wire.body),
        signal: controller ? controller.signal : undefined
      });
      lastError = '';
    } catch (e) {
      response = null;
      var aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      if (aborted && rt.signal && rt.signal.aborted) {
        return { ok: false, aborted: true, error: 'Запрос отменён.' };
      }
      lastError = aborted
        ? 'Превышено время ожидания ответа ('
          + (timeoutMs >= 1000 ? Math.round(timeoutMs / 1000) + ' с' : timeoutMs + ' мс') + ')'
        : 'Сеть недоступна: ' + e.message;
    } finally {
      if (timer) clearTimeout(timer);
    }

    var shouldRetry = !response
      ? true
      : (!response.ok && RETRIABLE.indexOf(response.status) >= 0);

    if (!shouldRetry) break;
    if (attempt === maxRetries) break;
    await wait(retryDelay(attempt, response));
  }

  if (!response) {
    return { ok: false, error: lastError || 'Запрос не выполнен', attempts: attempts };
  }

  /* Потоковый ответ приходит событиями Server-Sent Events, а не одним
     объектом JSON: разбирать его через response.json() нельзя. */
  if (response.ok && wire.body && wire.body.stream) {
    var streamed = await readStream(response, impl, request);
    streamed.attempts = attempts;
    return streamed;
  }

  var json;
  try {
    json = await response.json();
  } catch (e) {
    return { ok: false, error: 'Ответ не является JSON (код ' + response.status + ')' };
  }

  if (!response.ok) {
    var parsed = impl.fromWire(json);
    return { ok: false, status: response.status, attempts: attempts,
      retriable: RETRIABLE.indexOf(response.status) >= 0,
      error: parsed.error || ('Ошибка сервиса, код ' + response.status) };
  }
  var result = impl.fromWire(json);
  result.attempts = attempts;
  return result;
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

module.exports = { adapter: adapter, execute: execute, ids: Object.keys(ADAPTERS),
  RETRIABLE: RETRIABLE };
