/* Адаптер YandexGPT.

   Отличия от остальных сервисов:
     — модель задаётся строкой modelUri вида gpt://<каталог>/<модель>;
     — сообщение содержит поле text, а не content;
     — параметры генерации лежат в completionOptions.

   ВНИМАНИЕ: форма запроса собрана по публичным примерам и не сверялась
   с живой документацией из этой среды. Перед боевым запуском проверьте
   modelUri, имя поля maxTokens и структуру ответа. */

'use strict';

var ENDPOINT = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

function toWire(request, runtime) {
  var rt = runtime || {};
  /* modelUri можно передать целиком либо собрать из каталога и имени модели. */
  var modelUri = rt.modelUri
    || (rt.folderId ? 'gpt://' + rt.folderId + '/' + (request.model || 'yandexgpt-lite') : request.model);

  var body = {
    modelUri: modelUri,
    completionOptions: {
      stream: request.streaming === true,
      temperature: rt.temperature === undefined ? 0.3 : rt.temperature,
      maxTokens: String(request.maxOutputTokens)
    },
    messages: [
      { role: 'system', text: request.system },
      { role: 'user', text: request.userText }
    ]
  };

  var headers = {
    'content-type': 'application/json',
    authorization: (rt.authScheme === 'iam' ? 'Bearer ' : 'Api-Key ') + (rt.apiKey || '')
  };
  if (rt.folderId) headers['x-folder-id'] = rt.folderId;

  return { url: rt.endpoint || ENDPOINT, method: 'POST', headers: headers, body: body };
}

function fromWire(json) {
  if (!json) return { ok: false, error: 'Пустой ответ' };
  if (json.error || json.code) {
    return { ok: false, error: (json.error && json.error.message) || json.message || 'Ошибка запроса' };
  }
  var result = json.result || json;
  var alternative = (result.alternatives || [])[0];
  if (!alternative) return { ok: false, error: 'В ответе нет вариантов' };

  var text = String((alternative.message && alternative.message.text) || '').trim();
  var usage = result.usage || {};

  return {
    ok: true,
    text: text,
    stopReason: alternative.status || null,
    usage: {
      input: Number(usage.inputTextTokens) || 0,
      output: Number(usage.completionTokens) || 0,
      cacheRead: 0
    }
  };
}

/* Поток приходит теми же объектами ответа, но частями. */
function streamDelta(event) {
  var result = event && (event.result || event);
  var alternative = result && (result.alternatives || [])[0];
  return (alternative && alternative.message && alternative.message.text) || '';
}

function streamStop(event) {
  var result = event && (event.result || event);
  var alternative = result && (result.alternatives || [])[0];
  return (alternative && alternative.status) || null;
}

module.exports = { id: 'yandex', defaultModel: 'yandexgpt-lite', toWire: toWire, fromWire: fromWire,
  streamDelta: streamDelta, streamStop: streamStop };
