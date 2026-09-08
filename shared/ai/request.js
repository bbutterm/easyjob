/* ============================================================
   Нормализованный запрос к модели и маршрутизация к адаптеру.

   Прикладной код собирает запрос один раз и не знает, какой сервис
   его выполнит. Всё, что различается между провайдерами, живёт в
   capabilities.js и в адаптерах providers/*.js.
   ============================================================ */

(function (root, factory) {
  var deps;
  if (typeof module === 'object' && module.exports) {
    deps = {
      vars: require('./variables.js'),
      caps: require('./capabilities.js'),
      prompts: require('./prompts.js'),
      tokens: require('../context/tokens.js'),
      policy: require('../context/policy.js')
    };
  } else {
    deps = { vars: root.AiVariables, caps: root.AiCapabilities, prompts: root.AiPrompts,
      tokens: root.TokenCounter, policy: root.ContextPolicy };
  }
  var api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AiRequest = api;
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  var AiVariables = deps.vars;
  var AiCapabilities = deps.caps;
  var AiPrompts = deps.prompts;
  var TokenCounter = deps.tokens;
  var ContextPolicy = deps.policy;

  /* Значения по умолчанию для каждой задачи: длина ответа, бюджет
     контекста и формат. Подсказка на живом интервью намеренно
     короткая — длинную невозможно прочитать в разговоре. */
  var TASK_DEFAULTS = {
    'resume.draft': { maxOutputTokens: 4000, contextBudget: 24000, outputFormat: 'json', streaming: false },
    'resume.review': { maxOutputTokens: 4000, contextBudget: 32000, outputFormat: 'json', streaming: false },
    'vacancy.parse': { maxOutputTokens: 2000, contextBudget: 24000, outputFormat: 'json', streaming: false },
    'match.requirements': { maxOutputTokens: 4000, contextBudget: 32000, outputFormat: 'json', streaming: false },
    'questions.generate': { maxOutputTokens: 4000, contextBudget: 32000, outputFormat: 'json', streaming: false },
    'answer.feedback': { maxOutputTokens: 1500, contextBudget: 16000, outputFormat: 'json', streaming: false },
    /* Ограничение длины считается вместе с рассуждением модели, которое
       у части моделей включено по умолчанию. Слишком низкий предел даёт
       обрыв ответа на середине JSON. Длину самого ответа ограничивает
       policy.maxWords, а не этот предел. */
    'interview.turn': { maxOutputTokens: 1200, contextBudget: 24000, outputFormat: 'text', streaming: true },
    'interview.summary': { maxOutputTokens: 2000, contextBudget: 32000, outputFormat: 'json', streaming: false },
    'context.compact': { maxOutputTokens: 2500, contextBudget: 16000, outputFormat: 'json', streaming: false },
    'prep.card': { maxOutputTokens: 2500, contextBudget: 24000, outputFormat: 'json', streaming: false },
    'screen.extract': { maxOutputTokens: 900, contextBudget: 8000, outputFormat: 'json', streaming: false },
    'page.extract': { maxOutputTokens: 6000, contextBudget: 24000, outputFormat: 'json', streaming: false },
    'assistant.hint': { maxOutputTokens: 1200, contextBudget: 12000, outputFormat: 'json', streaming: true,
      maxWords: 40 }
  };

  function defaultsFor(taskId) {
    return TASK_DEFAULTS[taskId] || { maxOutputTokens: 1500, contextBudget: 16000,
      outputFormat: 'text', streaming: false };
  }

  /* Сборка нормализованного запроса.
       taskId  — идентификатор задачи из variables.js
       ctx     — результат ContextStore.build().context
       runtime — { provider, model, locale, apiKey, maxOutputTokens, ... }
     Возвращает объект, который понимает любой адаптер. */
  function build(taskId, ctx, runtime) {
    var task = AiVariables.task(taskId);
    if (!task) throw new Error('Неизвестная задача: ' + taskId);

    var rt = runtime || {};
    var defs = defaultsFor(taskId);
    var profileId = rt.provider || 'mock';
    /* Неизвестный провайдер не подменяется заглушкой: запрос собирается,
       а ошибку вернёт execute — с понятным сообщением и без сети. */
    var profile = AiCapabilities.profile(profileId) || { defaultModel: '' };

    var policy = {
      language: rt.locale || 'ru-RU',
      tone: rt.tone || 'neutral',
      outputFormat: defs.outputFormat,
      maxWords: rt.maxWords || defs.maxWords || null
    };

    var context = ctx || {};
    var moment = context.moment || {};

    /* Изображение уходит в запрос, только если провайдер умеет
       принимать изображения и пользователь дал согласие на захват.
       Формат кадра: { data, mediaType, width, height }. */
    var image = null;
    if (moment.image && AiCapabilities.supportsVision(profileId) && moment.captureConsent === true) {
      var frame = typeof moment.image === 'string'
        ? { data: moment.image, mediaType: moment.imageMediaType || 'image/png' }
        : moment.image;
      if (frame && frame.data) {
        image = {
          mediaType: frame.mediaType || 'image/png',
          data: frame.data,
          width: frame.width || null,
          height: frame.height || null
        };
      }
    }

    var system = AiPrompts.buildSystem(taskId, { policy: policy });
    var userText = AiPrompts.buildUser(taskId, context);

    return {
      task: taskId,
      provider: profileId,
      model: rt.model || profile.defaultModel,
      system: system,
      userText: userText,
      image: image,
      maxOutputTokens: rt.maxOutputTokens || defs.maxOutputTokens,
      streaming: rt.streaming !== undefined ? rt.streaming : defs.streaming,
      outputFormat: policy.outputFormat,
      schema: AiPrompts.schemaFor(taskId),
      effort: rt.effort || null,
      /* Разбиение для кэша префикса: system и стабильная часть
         пользовательского текста меняются реже, чем хвост. */
      cacheable: rt.cacheable !== false
    };
  }

  /* Размер сериализованного запроса: система, сообщение, изображение,
     служебные токены. Точность зависит от наличия токенизатора. */
  function measure(request) {
    return TokenCounter.countRequest({
      system: request.system,
      messages: [{ text: request.userText }],
      image: request.image ? { width: request.image.width, height: request.image.height } : null,
      schema: request.schema ? request.schema.shape : null
    });
  }

  /* Подгонка под жёсткий предел. Собирает запрос, меряет его целиком,
     при переполнении выбрасывает поля по порядку политики (кроме
     обязательных) и меряет снова. Если после всего не помещается —
     запрос не отправляется: возвращается ok:false с отчётом.

     store   — ContextStore с заполненными слоями
     runtime — как в build, плюс thinkingKnownOff и policyOverrides */
  function fit(taskId, store, runtime) {
    var rt = runtime || {};
    var policy = ContextPolicy.policyFor(taskId, rt.policyOverrides);
    var allowance = ContextPolicy.inputAllowance(policy, rt.thinkingKnownOff === true);
    var protect = policy.required || [];
    var dropped = [];
    var candidates = store.droppable(policy.dropFirst, protect);
    var last = null;

    for (var step = 0; step <= candidates.length; step++) {
      var built = store.build(undefined, { protect: protect, drop: dropped });
      var request = build(taskId, built.context, rt);
      request.maxOutputTokens = Math.min(request.maxOutputTokens,
        rt.thinkingKnownOff === true ? policy.outputReserveThinkingOff : policy.outputReserve);
      var size = measure(request);
      last = { request: request, built: built, size: size };
      if (size.tokens <= allowance) {
        request.sizing = { inputTokens: size.tokens, allowance: allowance, cap: policy.inputCap,
          exact: size.exact, dropped: built.report.dropped.concat([]), fits: true };
        return { ok: true, request: request, report: built.report, sizing: request.sizing };
      }
      if (step === candidates.length) break;
      dropped.push(candidates[step]);
    }

    return {
      ok: false,
      overflow: true,
      error: 'Контекст не помещается в предел задачи: ' + last.size.tokens + ' токенов при допустимых '
        + allowance + (last.size.exact ? '' : ' (оценка)') + '. Обязательные поля сохранены, остальное уже выброшено.',
      sizing: { inputTokens: last.size.tokens, allowance: allowance, cap: policy.inputCap, exact: last.size.exact,
        dropped: last.built.report.dropped, fits: false },
      report: last.built.report
    };
  }

  /* Убирает персональные данные из объекта перед записью в лог.

     Имя переменной в каталоге и имя поля в объекте контекста могут
     различаться (resume.rawText → rawResumeText), поэтому список
     собирается из обоих: последнего сегмента ключа и явного
     contextField, если он задан в каталоге. */
  function redactForLog(payload) {
    var sensitive = AiVariables.piiFields().concat(['apiKey', 'authKey', 'authorization', 'system', 'userText', 'prompt', 'messages', 'rawText', 'transcript', 'chunks', 'audio', 'wav', 'text', 'detectedQuestion']);
    function walk(value) {
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object') {
        var out = {};
        Object.keys(value).forEach(function (key) {
          out[key] = sensitive.indexOf(key) >= 0 ? '[скрыто]' : walk(value[key]);
        });
        return out;
      }
      if (typeof value === 'string' && value.length > 200) return value.slice(0, 200) + '…[обрезано]';
      return value;
    }
    return walk(payload);
  }

  /* Защищённый разбор ответа: провайдеры без строгого JSON-режима
     часто возвращают объект внутри пояснительного текста. */
  function parseJson(text) {
    if (typeof text !== 'string') return { ok: false, error: 'Ответ не является текстом' };
    var trimmed = text.trim();
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch (e) { /* пробуем вырезать объект из текста */ }
    var start = trimmed.indexOf('{');
    var end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(trimmed.slice(start, end + 1)) };
      } catch (e2) {
        return { ok: false, error: 'Не удалось разобрать JSON' };
      }
    }
    return { ok: false, error: 'В ответе нет объекта JSON' };
  }

  return {
    build: build,
    fit: fit,
    measure: measure,
    defaultsFor: defaultsFor,
    redactForLog: redactForLog,
    parseJson: parseJson,
    taskDefaults: TASK_DEFAULTS
  };
});
