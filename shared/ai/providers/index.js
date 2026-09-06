/* Реестр адаптеров и единая точка выполнения запроса.

   Прикладной код вызывает execute() и не знает, какой сервис работает.
   Ключ доступа не логируется и не покидает процесс, который делает запрос. */

'use strict';

var anthropic = require('./anthropic.js');
var openai = require('./openai.js');
var gemini = require('./gemini.js');
var yandex = require('./yandex.js');
var mock = require('./mock.js');

var Capabilities = require('../capabilities.js');

var ADAPTERS = {
  anthropic: anthropic,
  openai: openai,
  /* Локальные и совместимые сервисы используют тот же формат запроса,
     что и OpenAI, но с другим адресом и часто без ключа. */
  openai_compatible: openai,
  gemini: gemini,
  yandex: yandex,
  /* Интерфейс GigaChat совместим с форматом OpenAI — адаптер тот же,
     отличается только адрес сервиса и способ получения токена. */
  gigachat: openai,
  /* Хостеры открытых весов: тот же формат, свои адреса и расширения. */
  cerebras: openai,
  groq: openai,
  fireworks: openai,
  together: openai,
  openrouter: openai,
  mock: mock
};

/* Настройки запроса из профиля провайдера: адрес по умолчанию, имя поля
   длины, расширения тела. Явные значения из runtime имеют приоритет. */
function runtimeFor(providerId, runtime) {
  var rt = Object.assign({}, runtime || {});
  var profile = Capabilities.profile(providerId);
  if (!profile) return rt;
  if (!rt.endpoint && profile.endpoint && ADAPTERS[providerId] === openai) rt.endpoint = profile.endpoint;
  if (!rt.maxTokensField && profile.maxTokensField && profile.maxTokensField.indexOf('.') < 0) {
    rt.maxTokensField = profile.maxTokensField;
  }
  if (!rt.reasoningParam && profile.reasoningParam) rt.reasoningParam = profile.reasoningParam;
  if (profile.extraBody) rt.extraBody = Object.assign({}, profile.extraBody, rt.extraBody || {});
  return rt;
}

/* Неизвестный провайдер — ошибка, а не заглушка: иначе опечатка в
   настройках превращается в «живой» сервер с фиксированными ответами. */
function adapter(id) {
  return ADAPTERS[id] || null;
}

function isKnown(id) {
  return Object.prototype.hasOwnProperty.call(ADAPTERS, id);
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
function timeoutText(ms) {
  return 'Превышено время ожидания ответа (' + (ms >= 1000 ? Math.round(ms / 1000) + ' с' : ms + ' мс') + ')';
}

/* Один вызов = одна или несколько попыток. Каждая попытка возвращает
   запись для учёта: длительность, исход, известен ли расход. */
async function execute(request, runtime, fetchImpl) {
  var impl = adapter(request.provider);
  if (!impl) {
    return { ok: false, error: 'Неизвестный провайдер модели: ' + request.provider,
      unknownProvider: true, attempts: 0, attemptLog: [] };
  }

  var rt = runtimeFor(request.provider, runtime);
  if (impl.run) {
    var canned = impl.run(request, rt);
    canned.attempts = 1;
    canned.attemptLog = [{ attempt: 1, ok: true, ms: 0, usageStatus: 'not_applicable' }];
    return canned;
  }

  var wire = impl.toWire(request, rt);
  var doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { ok: false, error: 'Нет реализации fetch для запроса', attempts: 0, attemptLog: [] };

  var timeoutMs = rt.timeoutMs || DEFAULT_TIMEOUT_MS;
  var maxRetries = rt.retries === undefined ? DEFAULT_RETRIES : rt.retries;
  var attemptLog = [];

  var response = null;
  var lastError = '';
  var attempts = 0;
  var controller = null;
  var timer = null;

  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    var started = Date.now();
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    /* Внешняя отмена: сессия остановлена, ответ уже не нужен. */
    if (controller && rt.signal && typeof rt.signal.addEventListener === 'function') {
      rt.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
    }
    /* Дедлайн покрывает и заголовки, и чтение тела: снимается только
       после полного ответа, а не после первого байта. */
    timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;

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
      if (timer) clearTimeout(timer);
      if (aborted && rt.signal && rt.signal.aborted) {
        attemptLog.push({ attempt: attempts, ok: false, ms: Date.now() - started, outcome: 'cancelled', usageStatus: 'unknown' });
        return { ok: false, aborted: true, error: 'Запрос отменён.', attempts: attempts, attemptLog: attemptLog };
      }
      lastError = aborted ? timeoutText(timeoutMs) : 'Сеть недоступна: ' + e.message;
      attemptLog.push({ attempt: attempts, ok: false, ms: Date.now() - started,
        outcome: aborted ? 'timeout' : 'network', usageStatus: 'unknown' });
    }

    var shouldRetry = !response
      ? true
      : (!response.ok && RETRIABLE.indexOf(response.status) >= 0);

    if (response && shouldRetry) {
      if (timer) clearTimeout(timer);
      attemptLog.push({ attempt: attempts, ok: false, ms: Date.now() - started, outcome: 'http_' + response.status,
        usageStatus: 'unknown' });
    }
    if (!shouldRetry) break;
    if (attempt === maxRetries) break;
    await wait(retryDelay(attempt, response));
  }

  if (!response) {
    return { ok: false, error: lastError || 'Запрос не выполнен', attempts: attempts, attemptLog: attemptLog };
  }

  var attemptStart = Date.now();
  var finish = function (result, outcome) {
    if (timer) clearTimeout(timer);
    result.attempts = attempts;
    result.attemptLog = attemptLog.concat([{ attempt: attempts, ok: !!result.ok, ms: Date.now() - attemptStart,
      outcome: outcome, usageStatus: result.usage ? 'reported' : 'unknown' }]);
    return result;
  };

  /* Потоковый ответ приходит событиями Server-Sent Events, а не одним
     объектом JSON: разбирать его через response.json() нельзя. */
  if (response.ok && wire.body && wire.body.stream) {
    var streamed = await readStream(response, impl, request, controller ? controller.signal : null, timeoutMs);
    return finish(streamed, streamed.ok ? 'ok' : (streamed.timedOut ? 'timeout' : 'stream_error'));
  }

  /* Чтение обычного тела — тоже под дедлайном: ждём либо JSON, либо отмену. */
  var json;
  try {
    var jsonPromise = response.json();
    if (controller && controller.signal) {
      var sig = controller.signal;
      var abortWait = new Promise(function (resolve, reject) {
        var fail = function () { var e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
        if (sig.aborted) fail(); else sig.addEventListener('abort', fail, { once: true });
      });
      json = await Promise.race([jsonPromise, abortWait]);
    } else {
      json = await jsonPromise;
    }
  } catch (e) {
    var aborted2 = controller && controller.signal && controller.signal.aborted;
    return finish({ ok: false, error: aborted2 ? timeoutText(timeoutMs) : 'Ответ не является JSON (код ' + response.status + ')' },
      aborted2 ? 'timeout' : 'bad_json');
  }

  if (!response.ok) {
    var parsed = impl.fromWire(json);
    return finish({ ok: false, status: response.status,
      retriable: RETRIABLE.indexOf(response.status) >= 0,
      error: parsed.error || ('Ошибка сервиса, код ' + response.status) }, 'http_' + response.status);
  }
  return finish(impl.fromWire(json), 'ok');
}

/* Сборка текста из потока событий.
   onDelta вызывается по мере поступления, чтобы окно подсказки
   могло показывать ответ до его завершения. */
async function readStream(response, impl, request, signal, timeoutMs) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    return { ok: false, error: 'Сервис вернул поток, но его нельзя прочитать в этой среде.' };
  }
  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '';
  var text = '';
  var stopReason = null;
  var usage = null;
  var onDelta = request && typeof request.onDelta === 'function' ? request.onDelta : null;

  /* Чтение тела тоже под дедлайном: если поток замолчал, reader.read()
     не завершится сам, поэтому ждём либо данные, либо отмену. */
  var abortPromise = signal ? new Promise(function (resolve) {
    if (signal.aborted) resolve({ aborted: true });
    else signal.addEventListener('abort', function () { resolve({ aborted: true }); }, { once: true });
  }) : null;

  try {
    while (true) {
      var chunk = abortPromise ? await Promise.race([reader.read(), abortPromise]) : await reader.read();
      if (chunk.aborted) {
        try { reader.cancel(); } catch (e) { /* поток уже закрыт */ }
        return { ok: false, timedOut: true, partialText: text.trim(),
          error: timeoutText(timeoutMs || DEFAULT_TIMEOUT_MS) + ' — поток ответа замолчал' };
      }
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
        /* Расход приходит частями (Anthropic: вход в первом событии, выход
           в последнем) или целиком в последнем событии (OpenAI-совместимые). */
        if (impl.streamUsage) {
          var part = impl.streamUsage(event);
          if (part) usage = mergeUsage(usage, part);
        }
      }
    }
  } catch (e) {
    return { ok: false, error: 'Поток ответа прервался: ' + e.message, partialText: text.trim() };
  }

  if (stopReason === 'refusal') {
    return { ok: false, refused: true, error: 'Запрос отклонён моделью', usage: usage };
  }
  if (stopReason === 'max_tokens' || stopReason === 'length') {
    return { ok: true, text: text.trim(), stopReason: stopReason, truncated: true, usage: usage };
  }
  return { ok: true, text: text.trim(), stopReason: stopReason, usage: usage };
}

function mergeUsage(current, part) {
  var out = current ? Object.assign({}, current) : { input: 0, output: 0, cacheRead: 0 };
  ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'].forEach(function (key) {
    if (part[key] !== undefined && part[key] !== null) out[key] = Number(part[key]) || 0;
  });
  if (part.cost !== undefined) out.cost = part.cost;
  return out;
}

module.exports = { adapter: adapter, isKnown: isKnown, execute: execute, runtimeFor: runtimeFor,
  ids: Object.keys(ADAPTERS), RETRIABLE: RETRIABLE };
