/* ============================================================
   Счётчик токенов.

   Точный подсчёт возможен только токенизатором конкретной модели.
   Он подключается опционально: пакет @huggingface/tokenizers и файл
   tokenizer.json модели (путь в TOKENIZER_JSON). Без них работает
   консервативная оценка — и результат честно помечен exact: false.

   Оценка намеренно с запасом: для кириллицы токенизаторы семейства
   Qwen/Llama дают в среднем 2,5–3,5 символа на токен, поэтому делитель
   2,6 и надбавка на служебные токены шаблона чата. Символы/3 за точные
   токены не выдаются нигде.
   ============================================================ */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TokenCounter = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CHARS_PER_TOKEN = 2.6;
  /* Служебные токены шаблона чата на одно сообщение (роль, разделители). */
  var PER_MESSAGE_OVERHEAD = 6;
  /* Запас на расхождение оценки с реальным токенизатором. */
  var SAFETY = 1.1;

  var exactTokenizer = null;
  var exactTried = false;

  /* Попытка загрузить точный токенизатор. Только в Node и только если
     заданы путь к tokenizer.json и установлен пакет. */
  function tryLoadExact() {
    if (exactTried) return exactTokenizer;
    exactTried = true;
    if (typeof process === 'undefined' || !process.env || !process.env.TOKENIZER_JSON) return null;
    try {
      var fs = require('fs');
      var lib = require('@huggingface/tokenizers');
      var json = fs.readFileSync(process.env.TOKENIZER_JSON, 'utf8');
      var Tokenizer = lib.Tokenizer || lib.default || lib;
      exactTokenizer = typeof Tokenizer.fromString === 'function' ? Tokenizer.fromString(json)
        : (typeof Tokenizer === 'function' ? new Tokenizer(JSON.parse(json)) : null);
    } catch (e) {
      exactTokenizer = null;
    }
    return exactTokenizer;
  }

  function estimateText(text) {
    var s = String(text === undefined || text === null ? '' : text);
    if (!s.length) return 0;
    return Math.ceil((s.length / CHARS_PER_TOKEN) * SAFETY);
  }

  /* Подсчёт одного текста: { tokens, exact }. */
  function count(text) {
    var tok = tryLoadExact();
    if (tok) {
      try {
        var enc = tok.encode(String(text || ''));
        var n = enc && (enc.ids ? enc.ids.length : (enc.length !== undefined ? enc.length : null));
        if (typeof n === 'number') return { tokens: n, exact: true };
      } catch (e) { /* падаем в оценку */ }
    }
    return { tokens: estimateText(text), exact: false };
  }

  /* Подсчёт сериализованного запроса: системная инструкция, сообщения,
     изображения и служебные токены. Изображение — по разрешению. */
  function countRequest(parts) {
    var total = 0;
    var exact = true;
    var breakdown = {};
    function add(name, text) {
      var c = count(text);
      breakdown[name] = c.tokens;
      total += c.tokens;
      if (!c.exact) exact = false;
    }
    if (parts.system) add('system', parts.system);
    (parts.messages || []).forEach(function (m, i) {
      add('message' + i, m.text || '');
      total += PER_MESSAGE_OVERHEAD;
    });
    if (parts.image) {
      var w = Number(parts.image.width) || 1280;
      var h = Number(parts.image.height) || 720;
      breakdown.image = Math.ceil((w * h) / 750);
      total += breakdown.image;
    }
    if (parts.schema) add('schema', typeof parts.schema === 'string' ? parts.schema : JSON.stringify(parts.schema));
    total += PER_MESSAGE_OVERHEAD;
    return { tokens: total, exact: exact, breakdown: breakdown };
  }

  function isExactAvailable() {
    return !!tryLoadExact();
  }

  return { count: count, countRequest: countRequest, estimateText: estimateText,
    isExactAvailable: isExactAvailable, CHARS_PER_TOKEN: CHARS_PER_TOKEN,
    PER_MESSAGE_OVERHEAD: PER_MESSAGE_OVERHEAD, SAFETY: SAFETY };
});
