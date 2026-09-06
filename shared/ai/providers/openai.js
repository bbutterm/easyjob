/* Адаптер сервисов с интерфейсом чата в стиле OpenAI.
   ВНИМАНИЕ: форма запроса описана по общеизвестной схеме и не сверялась
   с живой документацией. Перед боевым запуском проверьте имя поля для
   ограничения длины ответа и способ запроса структурированного вывода —
   они менялись между версиями интерфейса. */

'use strict';

function toWire(request, runtime) {
  var userContent;
  if (request.image) {
    userContent = [
      { type: 'text', text: request.userText },
      { type: 'image_url', image_url: { url: 'data:' + request.image.mediaType + ';base64,' + request.image.data } }
    ];
  } else {
    userContent = request.userText;
  }

  var body = {
    model: request.model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: userContent }
    ]
  };

  /* Имя поля различается между версиями: max_tokens в старых,
     max_completion_tokens в новых. Настраивается в конфигурации. */
  var field = (runtime && runtime.maxTokensField) || 'max_completion_tokens';
  body[field] = request.maxOutputTokens;

  if (request.outputFormat === 'json' && !(runtime && runtime.noJsonMode)) body.response_format = { type: 'json_object' };
  if (request.streaming) {
    body.stream = true;
    /* Расход при потоке приходит в последнем событии только по запросу. */
    body.stream_options = { include_usage: true };
  }
  /* Расширения конкретных хостеров: передаются как есть из профиля/настроек. */
  if (runtime && runtime.extraBody && typeof runtime.extraBody === 'object') {
    Object.keys(runtime.extraBody).forEach(function (key) { body[key] = runtime.extraBody[key]; });
  }
  if (request.reasoning && runtime && runtime.reasoningParam) {
    /* Имя и форма параметра рассуждения различаются между хостерами и моделями:
       задаются в профиле, здесь только подставляются. */
    body[runtime.reasoningParam] = request.reasoning;
  }

  return {
    url: (runtime && runtime.endpoint) || 'https://api.openai.com/v1/chat/completions',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + ((runtime && runtime.apiKey) || '')
    },
    body: body
  };
}

function fromWire(json) {
  if (!json) return { ok: false, error: 'Пустой ответ' };
  if (json.error) return { ok: false, error: json.error.message || 'Ошибка запроса' };
  var choice = (json.choices || [])[0];
  if (!choice) return { ok: false, error: 'В ответе нет вариантов' };
  return {
    ok: true,
    text: String((choice.message && choice.message.content) || '').trim(),
    stopReason: choice.finish_reason || null,
    usage: usageFrom(json.usage)
  };
}

/* Общая форма usage OpenAI-совместимых сервисов, включая расширения
   (cached_tokens, reasoning_tokens, cost у OpenRouter). */
function usageFrom(u) {
  if (!u) return null;
  var details = u.prompt_tokens_details || {};
  var cdetails = u.completion_tokens_details || {};
  var out = { input: Number(u.prompt_tokens) || 0, output: Number(u.completion_tokens) || 0,
    cacheRead: Number(details.cached_tokens) || 0 };
  if (cdetails.reasoning_tokens !== undefined) out.reasoning = Number(cdetails.reasoning_tokens) || 0;
  if (u.cache_write_tokens !== undefined) out.cacheWrite = Number(u.cache_write_tokens) || 0;
  if (u.cost !== undefined) out.cost = u.cost;
  return out;
}

function streamUsage(event) {
  return event && event.usage ? usageFrom(event.usage) : null;
}

/* Кусок текста лежит в choices[0].delta.content. */
function streamDelta(event) {
  if (!event || !event.choices || !event.choices[0]) return '';
  var delta = event.choices[0].delta;
  return (delta && delta.content) || '';
}

function streamStop(event) {
  if (event && event.choices && event.choices[0]) return event.choices[0].finish_reason || null;
  return null;
}

module.exports = { id: 'openai', defaultModel: '', toWire: toWire, fromWire: fromWire,
  streamDelta: streamDelta, streamStop: streamStop, streamUsage: streamUsage, usageFrom: usageFrom };
