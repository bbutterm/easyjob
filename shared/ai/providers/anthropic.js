/* Адаптер Anthropic Claude.
   Параметры сверены со справочником Claude API (июнь 2026).
   Заметки:
   — системная инструкция передаётся отдельным полем system;
   — глубина рассуждения задаётся output_config.effort;
   — предзаполнение ответа ассистента на текущих моделях не поддерживается,
     поэтому формат ответа задаётся инструкцией и проверяется разбором;
   — для длинных ответов включается потоковый режим. */

'use strict';

var DEFAULT_MODEL = 'claude-opus-5';
var API_VERSION = '2023-06-01';

/* Короткие задачи не требуют глубокого рассуждения: для подсказки во время
   разговора важна скорость, а не полнота разбора. */
var EFFORT_BY_TASK = {
  'assistant.hint': 'low',
  'screen.extract': 'low',
  'interview.turn': 'low',
  'answer.feedback': 'medium'
};

function toWire(request, runtime) {
  var content = [];
  if (request.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: request.image.mediaType, data: request.image.data }
    });
  }
  content.push({ type: 'text', text: request.userText });

  var body = {
    model: request.model || DEFAULT_MODEL,
    max_tokens: request.maxOutputTokens,
    system: request.system,
    messages: [{ role: 'user', content: content }]
  };

  var effort = request.effort || EFFORT_BY_TASK[request.task];
  if (effort) body.output_config = { effort: effort };
  if (request.streaming) body.stream = true;

  return {
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': API_VERSION,
      'x-api-key': (runtime && runtime.apiKey) || ''
    },
    body: body
  };
}

function fromWire(json) {
  if (!json) return { ok: false, error: 'Пустой ответ' };
  if (json.type === 'error' || json.error) {
    return { ok: false, error: (json.error && json.error.message) || 'Ошибка запроса' };
  }
  /* На текущих моделях ответ может содержать блоки рассуждения:
     берём только текстовые блоки. */
  var text = (json.content || [])
    .filter(function (block) { return block.type === 'text'; })
    .map(function (block) { return block.text; })
    .join('\n')
    .trim();

  /* Классификаторы безопасности могут отклонить запрос: это HTTP 200
     со специальной причиной остановки, а не исключение. */
  if (json.stop_reason === 'refusal') {
    return { ok: false, refused: true, error: 'Запрос отклонён моделью', raw: json.stop_details || null };
  }

  return {
    ok: true,
    text: text,
    stopReason: json.stop_reason || null,
    usage: json.usage
      ? { input: json.usage.input_tokens, output: json.usage.output_tokens,
          cacheRead: json.usage.cache_read_input_tokens || 0 }
      : null
  };
}

/* Извлечение куска текста из события потока.
   Формат: событие content_block_delta с полем delta.text. Блоки
   рассуждения приходят как thinking_delta и в текст не попадают. */
function streamDelta(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.type === 'content_block_delta' && event.delta) {
    return event.delta.type === 'text_delta' ? (event.delta.text || '') : '';
  }
  return '';
}

/* Причина остановки приходит отдельным событием. */
function streamStop(event) {
  if (event && event.type === 'message_delta' && event.delta) return event.delta.stop_reason || null;
  return null;
}

module.exports = { id: 'anthropic', defaultModel: DEFAULT_MODEL, toWire: toWire, fromWire: fromWire,
  streamDelta: streamDelta, streamStop: streamStop };
