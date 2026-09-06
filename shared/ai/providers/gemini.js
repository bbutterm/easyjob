/* Адаптер Google Gemini.
   ВНИМАНИЕ: форма запроса описана по общеизвестной схеме и не сверялась
   с живой документацией. Проверьте перед боевым запуском. */

'use strict';

function toWire(request, runtime) {
  var parts = [{ text: request.userText }];
  if (request.image) {
    parts.unshift({ inline_data: { mime_type: request.image.mediaType, data: request.image.data } });
  }

  var body = {
    system_instruction: { parts: [{ text: request.system }] },
    contents: [{ role: 'user', parts: parts }],
    generationConfig: { maxOutputTokens: request.maxOutputTokens }
  };
  if (request.outputFormat === 'json') body.generationConfig.responseMimeType = 'application/json';

  var base = (runtime && runtime.endpoint)
    || 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';

  return {
    url: base.replace('{model}', request.model),
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': (runtime && runtime.apiKey) || ''
    },
    body: body
  };
}

function fromWire(json) {
  if (!json) return { ok: false, error: 'Пустой ответ' };
  if (json.error) return { ok: false, error: json.error.message || 'Ошибка запроса' };
  var candidate = (json.candidates || [])[0];
  if (!candidate) return { ok: false, error: 'В ответе нет вариантов' };
  var text = ((candidate.content && candidate.content.parts) || [])
    .map(function (part) { return part.text || ''; })
    .join('')
    .trim();
  return {
    ok: true,
    text: text,
    stopReason: candidate.finishReason || null,
    usage: json.usageMetadata
      ? { input: json.usageMetadata.promptTokenCount, output: json.usageMetadata.candidatesTokenCount, cacheRead: 0 }
      : null
  };
}

function streamDelta(event) {
  var candidate = event && event.candidates && event.candidates[0];
  if (!candidate || !candidate.content) return '';
  return (candidate.content.parts || []).map(function (p) { return p.text || ''; }).join('');
}

function streamStop(event) {
  var candidate = event && event.candidates && event.candidates[0];
  return (candidate && candidate.finishReason) || null;
}

module.exports = { id: 'gemini', defaultModel: '', toWire: toWire, fromWire: fromWire,
  streamDelta: streamDelta, streamStop: streamStop };
