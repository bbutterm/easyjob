/* ============================================================
   Хранение и сборка контекста.

   Контекст разложен на слои по скорости изменения. Это нужно для
   двух вещей сразу:
     1. Кэширование префикса запроса. Стабильные слои идут первыми,
        изменчивые — последними. Любая правка в начале запроса
        обесценивает кэш всего, что идёт после.
     2. Предсказуемое усечение. Когда контекст не помещается в бюджет,
        усекается изменчивое, а не то, без чего задача теряет смысл.

   Слои, от стабильного к изменчивому:
     identity     — язык, правила ответа, профессия. Меняется редко.
     preparation  — резюме, вакансия, требования, слабые места.
                    Меняется при смене версии резюме или вакансии.
     session      — реплики текущего интервью. Меняется каждую минуту.
     moment       — текущий кадр экрана или текущий вопрос. Живёт секунды.

   Где что хранится:
     identity, preparation — база сервиса, переживают перезапуск.
     session               — быстрое хранилище с истечением срока
                             (в прототипе — память процесса).
     moment                — только память, на диск не пишется никогда.
   ============================================================ */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ContextStore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LAYERS = ['identity', 'preparation', 'session', 'moment'];

  /* Доли бюджета по слоям. В сумме меньше единицы: остаток —
     запас на системную инструкцию и разметку запроса. */
  var DEFAULT_SHARES = {
    identity: 0.05,
    preparation: 0.35,
    session: 0.40,
    moment: 0.15
  };

  /* Грубая оценка размера в токенах. Для кириллицы отношение хуже,
     чем для латиницы, поэтому делитель занижен намеренно.
     Точный подсчёт — только через счётчик токенов провайдера.

     Изображение считается отдельно: его вес для модели зависит от
     разрешения кадра, а не от длины строки base64. Если оценивать
     картинку как текст, любой настоящий кадр «весит» сотни тысяч
     токенов и отбрасывается ещё до отправки. */
  function estimateTokens(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'string') return Math.ceil(value.length / 3);

    var imageTokens = 0;
    var payload = value;
    if (value && typeof value === 'object' && value.image) {
      payload = {};
      Object.keys(value).forEach(function (key) {
        if (key !== 'image') payload[key] = value[key];
      });
      imageTokens = estimateImageTokens(value.image);
    }
    return Math.ceil(JSON.stringify(payload).length / 3) + imageTokens;
  }

  /* Вес изображения у моделей с поддержкой картинок примерно
     пропорционален числу пикселей. Делитель 750 — распространённая
     оценка для кадра; при неизвестном разрешении берём консервативную
     оценку кадра 1280x720. */
  function estimateImageTokens(image) {
    if (!image) return 0;
    var width = Number(image.width) || 1280;
    var height = Number(image.height) || 720;
    return Math.ceil((width * height) / 750);
  }

  function create(options) {
    var opts = options || {};
    var budget = opts.contextBudget || 32000;
    var shares = Object.assign({}, DEFAULT_SHARES, opts.shares || {});
    var windowTurns = opts.windowTurns || 12;

    var data = {
      identity: {},
      preparation: {},
      session: { turns: [], turnsSummary: '', askedTopics: [] },
      moment: {}
    };

    function set(layer, value) {
      if (LAYERS.indexOf(layer) < 0) throw new Error('Неизвестный слой контекста: ' + layer);
      data[layer] = value || {};
    }

    function patch(layer, partial) {
      if (LAYERS.indexOf(layer) < 0) throw new Error('Неизвестный слой контекста: ' + layer);
      Object.keys(partial || {}).forEach(function (key) { data[layer][key] = partial[key]; });
    }

    function get(layer) {
      return data[layer];
    }

    /* Добавление реплики: окно держит последние windowTurns реплик,
       всё вытесненное уходит в свёртку. Свёртка заменяет реплики,
       а не дополняет их — иначе контекст растёт бесконечно. */
    function addTurn(turn, summarize) {
      var stored = {
        role: turn.role,
        text: String(turn.text || ''),
        ts: turn.ts || Date.now()
      };
      /* Устойчивый номер реплики нужен памяти и подтверждениям, чтобы
         ссылаться на оригинал; без него ссылки невозможно проверить. */
      if (typeof turn.seq === 'number') stored.seq = turn.seq;
      data.session.turns.push(stored);
      if (turn.topic && data.session.askedTopics.indexOf(turn.topic) < 0) {
        data.session.askedTopics.push(turn.topic);
      }
      if (data.session.turns.length > windowTurns) {
        var evicted = data.session.turns.splice(0, data.session.turns.length - windowTurns);
        var fold = typeof summarize === 'function'
          ? summarize(evicted, data.session.turnsSummary)
          : foldTurns(evicted, data.session.turnsSummary);
        data.session.turnsSummary = fold;
      }
      return data.session.turns.length;
    }

    /* Свёртка без обращения к модели: сжатая выжимка по ролям.
       В боевом сервисе сюда подставляется задача суммаризации,
       но запасной вариант обязан работать и без сети. */
    function foldTurns(evicted, previous) {
      var lines = evicted.map(function (t) {
        var who = t.role === 'interviewer' ? 'Интервьюер' : 'Кандидат';
        var text = t.text.length > 160 ? t.text.slice(0, 157) + '…' : t.text;
        return who + ': ' + text;
      });
      var merged = (previous ? previous + '\n' : '') + lines.join('\n');
      /* Свёртка тоже ограничена: иначе она сама съест бюджет. */
      var limit = Math.floor(budget * shares.session * 0.4) * 3;
      if (merged.length > limit) merged = '…\n' + merged.slice(merged.length - limit);
      return merged;
    }

    function clearSession() {
      data.session = { turns: [], turnsSummary: '', askedTopics: [] };
      data.moment = {};
    }

    function clearMoment() {
      data.moment = {};
    }

    /* Сборка контекста под бюджет. Возвращает слои и отчёт об усечении,
       чтобы приложение могло честно показать, что было отброшено.

       options.protect  — поля вида 'preparation.weakSpots', которые
                          усечение не трогает; 'session.currentTurn' —
                          последняя реплика всегда остаётся.
       options.drop     — поля, которые нужно выбросить до начала
                          (используется подгонкой под жёсткий предел). */
    function build(overrideBudget, options) {
      var opts = options || {};
      var total = overrideBudget || budget;
      var report = { budget: total, layers: {}, dropped: [] };
      var out = {};
      var protect = opts.protect || [];
      var forced = opts.drop || [];

      LAYERS.forEach(function (layer) {
        var allowed = Math.floor(total * shares[layer]);
        var value = JSON.parse(JSON.stringify(data[layer] || {}));

        forced.forEach(function (path) {
          var parts = path.split('.');
          if (parts[0] !== layer) return;
          if (parts[1] === 'currentTurn') return;
          if (value[parts[1]] !== undefined) {
            delete value[parts[1]];
            report.dropped.push(path + ': выброшено при подгонке под предел');
          }
        });

        var size = estimateTokens(value);
        if (size <= allowed) {
          out[layer] = value;
          report.layers[layer] = { tokens: size, allowed: allowed, truncated: false };
          return;
        }
        var trimmed = truncateLayer(layer, value, allowed, report, protect);
        out[layer] = trimmed;
        report.layers[layer] = { tokens: estimateTokens(trimmed), allowed: allowed, truncated: true };
      });

      report.totalTokens = LAYERS.reduce(function (sum, layer) {
        return sum + report.layers[layer].tokens;
      }, 0);
      return { context: out, report: report };
    }

    /* Поля, которые ещё можно выбросить, в порядке предпочтения. Нужно
       подгонке под предел: она выбрасывает по одному и пересчитывает. */
    function droppable(order, protect) {
      var prot = protect || [];
      var out = [];
      (order || []).forEach(function (path) {
        var parts = path.split('.');
        if (prot.indexOf(path) >= 0) return;
        if (data[parts[0]] && data[parts[0]][parts[1]] !== undefined) out.push(path);
      });
      return out;
    }

    /* Правила усечения зависят от слоя: что выбросить в первую очередь,
       определяется смыслом задачи, а не длиной поля. */
    function truncateLayer(layer, value, allowed, report, protect) {
      var copy = JSON.parse(JSON.stringify(value || {}));
      var prot = protect || [];
      function protectedKey(key) { return prot.indexOf(layer + '.' + key) >= 0; }

      if (layer === 'identity') {
        /* Слой мал по построению. Если он не влез — бюджет задан неверно. */
        report.dropped.push('identity: бюджет слишком мал, слой оставлен целиком');
        return copy;
      }

      if (layer === 'preparation') {
        var order = ['rawResumeText', 'vacancyRawText', 'education', 'achievements',
          'skills', 'evidence', 'experience', 'requirements', 'weakSpots'];
        for (var i = 0; i < order.length && estimateTokens(copy) > allowed; i++) {
          var key = order[i];
          if (copy[key] === undefined || protectedKey(key)) continue;
          if (key === 'experience' && Array.isArray(copy.experience) && copy.experience.length > 1) {
            copy.experience = copy.experience.slice(0, 1);
            report.dropped.push('preparation.experience: оставлено последнее место работы');
            continue;
          }
          delete copy[key];
          report.dropped.push('preparation.' + key + ': удалено целиком');
        }
        return copy;
      }

      if (layer === 'session') {
        /* Последняя реплика — текущий вопрос или ответ — не вытесняется никогда. */
        var keepTurns = protectedKey('turns') ? (copy.turns || []).length : 1;
        while (Array.isArray(copy.turns) && copy.turns.length > keepTurns && estimateTokens(copy) > allowed) {
          copy.turns.shift();
          report.dropped.push('session.turns: вытеснена ранняя реплика');
        }
        /* Память укорачивается с ранних фактов; сама память не выбрасывается.
           Сначала уходят ранние факты без пометки important (отрицания,
           числа, исправления, конфликты помечены при проверке), потом —
           ранние важные. */
        if (copy.memory && Array.isArray(copy.memory.facts) && !protectedKey('memory')) {
          var droppedFacts = 0;
          var facts = copy.memory.facts;
          while (facts.length > 5 && estimateTokens(copy) > allowed) {
            var idx = -1;
            for (var k = 0; k < facts.length; k++) { if (facts[k].important !== true) { idx = k; break; } }
            if (idx < 0) idx = 0;
            facts.splice(idx, 1);
            droppedFacts++;
          }
          if (droppedFacts) report.dropped.push('session.memory: убраны ранние факты (' + droppedFacts + ')');
        }
        if (estimateTokens(copy) > allowed && copy.turnsSummary) {
          var keep = Math.max(200, allowed * 2);
          copy.turnsSummary = '…' + String(copy.turnsSummary).slice(-keep);
          report.dropped.push('session.turnsSummary: свёртка укорочена');
        }
        return copy;
      }

      /* moment: изображение отбрасывается первым — оно дороже всего.
         Найденный вопрос собеседующего не трогается. */
      if (copy.image && !protectedKey('image')) {
        delete copy.image;
        report.dropped.push('moment.image: кадр отброшен, остался текст');
      }
      if (estimateTokens(copy) > allowed && copy.text && copy.textDelta) {
        delete copy.text;
        report.dropped.push('moment.text: оставлено только изменение с прошлого кадра');
      }
      if (estimateTokens(copy) > allowed && copy.text) {
        copy.text = String(copy.text).slice(-allowed * 3);
        report.dropped.push('moment.text: оставлен хвост распознанного текста');
      }
      /* Текст страницы: начало важнее хвоста (заголовок, описание), хвост — похожие вакансии. */
      if (estimateTokens(copy) > allowed && copy.pageText && !protectedKey('pageText')) {
        copy.pageText = String(copy.pageText).slice(0, allowed * 3) + '…';
        report.dropped.push('moment.pageText: оставлено начало текста страницы');
      }
      return copy;
    }

    return {
      layers: LAYERS,
      set: set,
      patch: patch,
      get: get,
      addTurn: addTurn,
      clearSession: clearSession,
      clearMoment: clearMoment,
      build: build,
      droppable: droppable,
      estimateTokens: estimateTokens,
      estimateImageTokens: estimateImageTokens
    };
  }

  return { create: create, estimateTokens: estimateTokens, estimateImageTokens: estimateImageTokens,
    LAYERS: LAYERS, DEFAULT_SHARES: DEFAULT_SHARES };
});
