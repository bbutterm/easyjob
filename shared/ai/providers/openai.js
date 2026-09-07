/* Адаптер сервисов с интерфейсом чата в стиле OpenAI.
   ВНИМАНИЕ: форма запроса описана по общеизвестной схеме и не сверялась
   с живой документацией. Перед боевым запуском проверьте имя поля для
   ограничения длины ответа и способ запроса структурированного вывода —
   они менялись между версиями интерфейса. */

'use strict';

var Caps = require('../capabilities.js');

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
  var field = (runtime && runtime.maxTokensField) || Caps.profile(request.provider || 'openai').maxTokensField;
  body[field] = request.maxOutputTokens;

  if (request.outputFormat === 'json') body.response_format = { type: 'json_object' };
  if (request.provider === 'openrouter' && runtime && runtime.disableReasoning === true) body.reasoning = { enabled: false };
  if (request.streaming) {
    body.stream = true;
    if (['openai', 'openrouter', 'cerebras'].includes(request.provider)) body.stream_options = { include_usage: true };
  }

  return {
    url: (runtime && runtime.endpoint) || Caps.profile(request.provider || 'openai').endpoint,
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
    truncated: ['length', 'max_tokens'].includes(choice.finish_reason),
    usage: json.usage
      ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens, cacheRead: 0 }
      : null
  };
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
  streamDelta: streamDelta, streamStop: streamStop };
