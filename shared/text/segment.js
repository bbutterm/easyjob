/* ============================================================
   Деление текста на предложения и фрагменты для живого интервью.

   Зачем отдельный модуль: один и тот же алгоритм нужен в трёх местах —
     • браузер: поток ответа интервьюера → фразы для синтеза речи;
     • браузер и сервер: распознанный текст → реплики для модели;
     • программа для компьютера: текст экрана → вопрос собеседующего.

   Правила границы предложения (русский и английский):
     терминатор [.!?…] (+ закрывающие кавычки и скобки), затем пробел и
     заглавная буква, цифра, открывающая кавычка/скобка или тире; либо
     конец текста. Не граница: точка внутри числа (3.5), после инициала
     (А. Пушкин), после сокращения (т.д., руб., г.), многоточие перед
     строчной буквой, точка перед строчной буквой.

   Потоковый режим: фраза отдаётся, когда её граница подтверждена
   следующим символом; первая фраза может отдаваться раньше — по границе
   клаузы (запятая, тире, точка с запятой), чтобы речь начиналась не
   дожидаясь конца первого предложения. Короткие фразы склеиваются,
   длинные режутся по клаузам.
   ============================================================ */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TextSegment = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Сокращения, после которых точка не заканчивает предложение. */
  var ABBR = ['т', 'е', 'д', 'п', 'к', 'г', 'гг', 'ул', 'кв', 'руб', 'коп', 'тыс', 'млн', 'млрд', 'см', 'мм', 'км', 'кг', 'гр',
    'стр', 'напр', 'им', 'проф', 'акад', 'доц', 'ст', 'ч', 'мин', 'сек', 'англ', 'рус', 'др', 'пр', 'св', 'чл', 'корр',
    'мл', 'ср', 'ок', 'тел', 'обл', 'р', 'о', 'оз', 'пос', 'дер', 'сокр', 'рис', 'табл', 'прим', 'ред', 'изд', 'экз',
    'шт', 'уч', 'зав', 'зам', 'ген', 'дир', 'нач', 'отд', 'ооо', 'зао', 'оао', 'ип',
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'etc', 'vs', 'inc', 'ltd', 'co', 'no', 'e', 'i', 'eg', 'ie', 'approx', 'fig', 'vol', 'p', 'pp'];
  var ABBR_SET = {};
  ABBR.forEach(function (a) { ABBR_SET[a] = true; });

  var UPPER = /[A-ZА-ЯЁ]/;
  var LOWER = /[a-zа-яё]/;
  var LETTER = /[A-Za-zА-Яа-яЁё]/;
  var DIGIT = /[0-9]/;
  var CLOSERS = '»"”’)\\]';
  var OPENERS = '«"“‘([';

  function isUpper(ch) { return !!ch && UPPER.test(ch); }
  function isLower(ch) { return !!ch && LOWER.test(ch); }
  function isDigit(ch) { return !!ch && DIGIT.test(ch); }
  function isLetter(ch) { return !!ch && LETTER.test(ch); }

  /* Слово перед позицией i (без точки), в нижнем регистре. */
  function wordBefore(text, i) {
    var j = i;
    while (j > 0 && (isLetter(text[j - 1]) || isDigit(text[j - 1]))) j--;
    return { word: text.slice(j, i), start: j };
  }

  /* Является ли позиция после терминатора концом предложения.
     i — индекс терминатора; возвращает индекс, на котором предложение
     заканчивается (после закрывающих кавычек), либо -1. */
  function boundaryAt(text, i, options) {
    var ch = text[i];
    var end = i + 1;
    /* Многоточие и повторы: "?!", "!!!", "..." */
    while (end < text.length && /[.!?…]/.test(text[end])) end++;
    var run = text.slice(i, end);
    while (end < text.length && CLOSERS.indexOf(text[end]) >= 0) end++;
    var next = text[end];
    var afterSpace = end;
    while (afterSpace < text.length && /[ \t\r\n]/.test(text[afterSpace])) afterSpace++;
    var following = text[afterSpace];
    var hasSpace = afterSpace > end;

    if (ch === '.' && run === '.') {
      /* Точка внутри числа или даты: 3.5, 12.09.2026 */
      if (isDigit(text[i - 1]) && isDigit(next)) return -1;
      var wb = wordBefore(text, i);
      var word = wb.word.toLowerCase();
      /* Инициал: одна заглавная буква перед точкой. */
      if (wb.word.length === 1 && isUpper(wb.word)) return -1;
      /* Сокращение из списка, а также цепочки вида т.д., т.е. */
      if (ABBR_SET[word] && !(options && options.abbreviations === false)) {
        /* "г." перед заглавной может быть и концом предложения ("...в 2020 г. Потом"),
           но чаще нет; при сомнении не режем — потеря границы дешевле обрыва фразы. */
        return -1;
      }
      /* Нумерованный пункт "1." в начале строки */
      if (/^\d{1,2}$/.test(word) && (wb.start === 0 || text[wb.start - 1] === '\n')) return -1;
    }
    if (afterSpace >= text.length) return end; /* конец текста */
    if (!hasSpace) {
      /* "слово.Слово" без пробела: граница только если дальше явная заглавная и перед точкой нет цифры */
      if (ch === '.' && isUpper(following) && isLetter(text[i - 1]) && !(options && options.strictSpace)) return end;
      return -1;
    }
    if (isLower(following)) return -1;
    if (isUpper(following) || isDigit(following) || OPENERS.indexOf(following) >= 0 || following === '—' || following === '–' || following === '-') return end;
    return -1;
  }

  /* Полное деление готового текста на предложения. */
  function sentences(text, options) {
    var s = String(text || '').replace(/\r\n?/g, '\n');
    var out = [];
    var start = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '\n' && s[i + 1] === '\n') {
        /* Пустая строка — всегда граница (абзац). */
        push(out, s.slice(start, i)); start = i + 2; i++; continue;
      }
      if (ch === '\n' && listMarkerAt(s, i + 1)) { push(out, s.slice(start, i)); start = i + 1; continue; }
      if (/[.!?…]/.test(ch)) {
        var end = boundaryAt(s, i, options);
        if (end > 0) {
          push(out, s.slice(start, end));
          start = end;
          i = end - 1;
        } else {
          while (i + 1 < s.length && /[.!?…]/.test(s[i + 1])) i++;
        }
      }
    }
    push(out, s.slice(start));
    return out;
  }

  /* Новая строка с маркером списка («1.», «2)», «—», «•») — граница. */
  function listMarkerAt(text, i) {
    return /^\s*(\d{1,2}[.)]|[—•\-*])\s/.test(text.slice(i, i + 6));
  }

  function push(out, piece) {
    var t = String(piece).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }

  /* Граница клаузы для ранней первой фразы: запятая, точка с запятой,
     двоеточие, тире с пробелами. Возвращает индекс конца клаузы (после
     знака) не раньше minChars, либо -1. */
  function clauseEnd(text, minChars) {
    var best = -1;
    for (var i = minChars; i < text.length; i++) {
      var ch = text[i];
      if ((ch === ',' || ch === ';' || ch === ':') && /[ \n]/.test(text[i + 1] || '') && !isDigit(text[i - 1] || '')) { best = i + 1; break; }
      if ((ch === '—' || ch === '–') && text[i - 1] === ' ' && /[ \n]/.test(text[i + 1] || '')) { best = i - 1; break; }
    }
    return best;
  }

  /* Резать длинную фразу по клаузам, затем по пробелам. */
  function splitLong(piece, maxChars) {
    var out = [];
    var rest = piece;
    while (rest.length > maxChars) {
      var cut = -1;
      for (var i = Math.min(maxChars, rest.length - 1); i > Math.floor(maxChars * 0.4); i--) {
        if ((rest[i] === ',' || rest[i] === ';' || rest[i] === ':') && rest[i + 1] === ' ') { cut = i + 1; break; }
        if ((rest[i] === '—' || rest[i] === '–') && rest[i - 1] === ' ' && rest[i + 1] === ' ') { cut = i - 1; break; }
      }
      if (cut < 0) cut = rest.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out;
  }

  var DEFAULTS = { minChars: 24, maxChars: 220, firstChunkMin: 36, firstChunkMax: 140 };

  /* Потоковый сегментатор: feed(delta) возвращает готовые фразы, flush()
     отдаёт остаток. Первая фраза может быть клаузой, чтобы речь началась
     раньше; остальные — предложения, склеенные до minChars и порезанные
     до maxChars. */
  function createStream(options) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    var buffer = '';
    var emitted = 0;
    var pending = '';

    function takeSentences(final) {
      var ready = [];
      var s = buffer;
      var start = 0;
      for (var i = 0; i < s.length; i++) {
        var ch = s[i];
        if (ch === '\n' && s[i + 1] === '\n') { ready.push(s.slice(start, i)); start = i + 2; i++; continue; }
        if (ch === '\n' && listMarkerAt(s, i + 1)) { ready.push(s.slice(start, i)); start = i + 1; continue; }
        if (!/[.!?…]/.test(ch)) continue;
        /* Граница подтверждается только следующим не-пробельным символом. */
        var lookahead = i + 1;
        while (lookahead < s.length && /[.!?…»"”’)\]]/.test(s[lookahead])) lookahead++;
        var spaceEnd = lookahead;
        while (spaceEnd < s.length && /[ \t\r\n]/.test(s[spaceEnd])) spaceEnd++;
        if (spaceEnd >= s.length && !final) { i = lookahead - 1; continue; }
        var end = boundaryAt(s, i, opts);
        if (end > 0) { ready.push(s.slice(start, end)); start = end; i = end - 1; }
        else { i = lookahead - 1; }
      }
      buffer = s.slice(start);
      return ready.map(function (p) { return p.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    }

    function pack(pieces, final) {
      var out = [];
      pieces.forEach(function (p) {
        pending = pending ? pending + ' ' + p : p;
        /* Первая фраза уходит сразу: задержка до первого звука важнее,
           чем красивая длина; дальше короткие склеиваются. */
        if (pending.length >= opts.minChars || (!emitted && !out.length && pending.length >= 8)) {
          splitLong(pending, opts.maxChars).forEach(function (x) { out.push(x); });
          pending = '';
        }
      });
      if (final && pending) { splitLong(pending, opts.maxChars).forEach(function (x) { out.push(x); }); pending = ''; }
      emitted += out.length;
      return out;
    }

    function feed(delta) {
      buffer += String(delta || '');
      var out = [];
      var ready = takeSentences(false);
      if (ready.length) out = pack(ready, false);
      /* Ранняя первая фраза: ещё нет ни одной, буфер длинный — режем по клаузе. */
      if (!emitted && !out.length && !pending && buffer.length >= opts.firstChunkMin) {
        var cut = clauseEnd(buffer, Math.floor(opts.firstChunkMin * 0.6));
        if (cut > 0 && cut <= opts.firstChunkMax) {
          var first = buffer.slice(0, cut).replace(/\s+/g, ' ').trim();
          buffer = buffer.slice(cut);
          out.push(first); emitted++;
        } else if (buffer.length >= opts.firstChunkMax * 1.6) {
          var sp = buffer.lastIndexOf(' ', opts.firstChunkMax);
          if (sp > opts.firstChunkMin) {
            out.push(buffer.slice(0, sp).trim()); buffer = buffer.slice(sp); emitted++;
          }
        }
      }
      return out;
    }

    function flush() {
      var ready = takeSentences(true);
      var tail = buffer.replace(/\s+/g, ' ').trim();
      buffer = '';
      if (tail) ready.push(tail);
      return pack(ready, true);
    }

    return { feed: feed, flush: flush, pendingText: function () { return (pending ? pending + ' ' : '') + buffer; } };
  }

  /* Реплики для модели из распознанного текста: целые предложения,
     сгруппированные до maxChars; одиночное длинное предложение режется. */
  function utterances(text, maxChars) {
    var max = maxChars || 4000;
    var out = [];
    var current = '';
    sentences(text).forEach(function (sn) {
      var parts = sn.length > max ? splitLong(sn, max) : [sn];
      parts.forEach(function (p) {
        if (!current) current = p;
        else if (current.length + 1 + p.length <= max) current += ' ' + p;
        else { out.push(current); current = p; }
      });
    });
    if (current) out.push(current);
    return out;
  }

  /* Подготовка текста к озвучиванию: разметка и ссылки убираются,
     частые сокращения раскрываются, чтобы синтез не читал «тэ дэ». */
  /* \b в JS не знает кириллицу: границы слов задаются явно. */
  var B = '(?<![A-Za-zА-Яа-яЁё])';
  var E = '(?![A-Za-zА-Яа-яЁё])';
  function rx(body) { return new RegExp(B + body, 'gi'); }
  var SPEAK_MAP = [
    [rx('т\\.\\s?д\\.'), 'так далее'], [rx('т\\.\\s?п\\.'), 'тому подобное'], [rx('т\\.\\s?е\\.'), 'то есть'], [rx('т\\.\\s?к\\.'), 'так как'],
    [rx('и\\s+др\\.'), 'и другие'], [rx('напр\\.'), 'например'], [rx('руб\\.'), 'рублей'], [rx('тыс\\.'), 'тысяч'], [rx('млн' + E + '\\.?'), 'миллионов'],
    [rx('млрд' + E + '\\.?'), 'миллиардов'], [rx('г\\.\\s?(?=\\d)'), 'год '], [/(\d)\s?%/g, '$1 процентов'], [/№\s?/g, 'номер '], [rx('e\\.\\s?g\\.'), 'например'],
    [rx('i\\.\\s?e\\.'), 'то есть'], [rx('etc\\.'), 'и так далее'], [rx('vs\\.?' + E), 'против']
  ];
  function forSpeech(text) {
    var s = String(text || '');
    s = s.replace(/https?:\/\/[^\s,;)»"]+/g, ' ссылка ');
    s = s.replace(/[*_`#>]+/g, ' ');
    s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ');
    SPEAK_MAP.forEach(function (pair) { s = s.replace(pair[0], pair[1]); });
    s = s.replace(/\s+—\s+/g, ', ').replace(/\s+-\s+/g, ', ');
    s = s.replace(/\s+([,.:;!?])/g, '$1').replace(/\s+/g, ' ').trim();
    return s;
  }

  return { sentences: sentences, createStream: createStream, utterances: utterances, forSpeech: forSpeech,
    splitLong: splitLong, boundaryAt: boundaryAt, DEFAULTS: DEFAULTS, ABBREVIATIONS: ABBR };
});
