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

  if (request.outputFormat === 'json') body.response_format = { type: 'json_object' };
  if (request.streaming) body.stream = true;

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
    usage: json.usage
      ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens, cacheRead: 0 }
      : null
  };
}

module.exports = { id: 'openai', defaultModel: '', toWire: toWire, fromWire: fromWire };
