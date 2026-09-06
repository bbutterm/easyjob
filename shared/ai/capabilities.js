/* ============================================================
   Матрица различий провайдеров.

   Смысл файла: набор переменных и задач один для всех (variables.js),
   а способ их передачи различается. Всё, что зависит от провайдера,
   собрано здесь, чтобы адаптеры оставались тонкими, а прикладной код
   не знал, с каким сервисом он работает.

   Поля профиля:
     systemChannel   — куда уходит системная инструкция
     messageShape    — форма истории сообщений
     jsonMode        — как запрашивается структурированный ответ
     maxTokensField  — как называется ограничение длины ответа
     vision          — принимает ли изображения
     streaming       — поддержка потокового вывода
     promptCache     — есть ли кэширование префикса запроса
     reasoning       — как управляется глубина рассуждения
     notes           — что важно помнить при интеграции

   Данные по Anthropic сверены со справочником Claude API.
   Профили остальных провайдеров описывают общеизвестную форму их
   HTTP-интерфейса и перед боевым запуском должны быть сверены с
   документацией конкретного сервиса и версии.
   ============================================================ */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AiCapabilities = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PROFILES = {
    anthropic: {
      id: 'anthropic',
      title: 'Anthropic Claude',
      endpoint: 'https://api.anthropic.com/v1/messages',
      auth: { header: 'x-api-key', scheme: 'raw', extraHeaders: { 'anthropic-version': '2023-06-01' } },
      systemChannel: 'top_level_field',
      messageShape: 'roles_user_assistant',
      jsonMode: 'output_config_format',
      maxTokensField: 'max_tokens',
      vision: true,
      streaming: true,
      promptCache: 'explicit_breakpoints',
      reasoning: 'adaptive_thinking_plus_effort',
      defaultModel: 'claude-opus-5',
      dataRegion: 'global',
      verified: true,
      notes: [
        'Системная инструкция — отдельное поле system, а не роль в messages.',
        'Глубина рассуждения: thinking {type:"adaptive"} и output_config.effort (low…max).',
        'Предзаполнение ответа ассистента на текущих моделях не поддерживается — '
          + 'формат ответа задаётся структурированным выводом или инструкцией.',
        'Кэширование префикса задаётся точками cache_control; порядок рендера tools → system → messages.',
        'Для длинных ответов используется потоковый режим.'
      ]
    },

    openai: {
      id: 'openai',
      title: 'OpenAI и совместимые',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      auth: { header: 'Authorization', scheme: 'Bearer' },
      systemChannel: 'message_role',
      messageShape: 'roles_system_user_assistant',
      jsonMode: 'response_format_json_schema',
      maxTokensField: 'max_completion_tokens',
      vision: true,
      streaming: true,
      promptCache: 'automatic_prefix',
      reasoning: 'effort_parameter',
      defaultModel: '',
      dataRegion: 'global',
      verified: false,
      notes: [
        'Системная инструкция передаётся первым сообщением с ролью system.',
        'Название поля для ограничения длины отличается между версиями интерфейса — сверить перед запуском.',
        'Изображения передаются частями content с типом изображения.'
      ]
    },

    gemini: {
      id: 'gemini',
      title: 'Google Gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
      auth: { header: 'x-goog-api-key', scheme: 'raw' },
      systemChannel: 'system_instruction_field',
      messageShape: 'contents_parts',
      jsonMode: 'response_schema',
      maxTokensField: 'maxOutputTokens',
      vision: true,
      streaming: true,
      promptCache: 'explicit_cached_content',
      reasoning: 'thinking_config',
      defaultModel: '',
      dataRegion: 'global',
      verified: false,
      notes: [
        'История называется contents, каждое сообщение состоит из parts.',
        'Роль ассистента называется model, а не assistant.',
        'Системная инструкция — отдельное поле, а не сообщение.'
      ]
    },

    openai_compatible: {
      id: 'openai_compatible',
      title: 'Локальная или своя модель с совместимым интерфейсом',
      endpoint: 'http://localhost:11434/v1/chat/completions',
      auth: { header: 'Authorization', scheme: 'Bearer', optional: true },
      systemChannel: 'message_role',
      messageShape: 'roles_system_user_assistant',
      jsonMode: 'best_effort_instruction',
      maxTokensField: 'max_tokens',
      vision: false,
      streaming: true,
      promptCache: 'none',
      reasoning: 'none',
      defaultModel: '',
      dataRegion: 'self',
      verified: false,
      notes: [
        'Строгий JSON-режим чаще всего отсутствует: ответ приходится разбирать защищённо.',
        'Изображения обычно не поддерживаются — режим чтения экрана переключается на текстовый.',
        'Контекст меньше облачных моделей: бюджет усечения задаётся жёстче.'
      ]
    },

    yandex: {
      id: 'yandex',
      title: 'YandexGPT',
      endpoint: 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
      auth: { header: 'Authorization', scheme: 'Api-Key' },
      systemChannel: 'message_role',
      messageShape: 'roles_with_text_field',
      jsonMode: 'best_effort_instruction',
      maxTokensField: 'completionOptions.maxTokens',
      vision: false,
      streaming: true,
      promptCache: 'none',
      reasoning: 'none',
      defaultModel: 'yandexgpt-lite',
      dataRegion: 'ru',
      verified: false,
      notes: [
        'Модель задаётся строкой modelUri вида gpt://<каталог>/<модель>.',
        'В сообщении поле text, а не content — общий адаптер не подходит.',
        'Обработка идёт внутри РФ: подходит для данных с персональными данными.',
        'Изображения не поддерживаются — режим чтения экрана переключается на текстовый.'
      ]
    },

    gigachat: {
      id: 'gigachat',
      title: 'GigaChat',
      endpoint: 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
      auth: { header: 'Authorization', scheme: 'Bearer' },
      systemChannel: 'message_role',
      messageShape: 'roles_system_user_assistant',
      jsonMode: 'best_effort_instruction',
      maxTokensField: 'max_tokens',
      vision: false,
      streaming: true,
      promptCache: 'none',
      reasoning: 'none',
      defaultModel: '',
      dataRegion: 'ru',
      verified: false,
      notes: [
        'Интерфейс совместим с форматом OpenAI, поэтому используется тот же адаптер.',
        'Токен доступа обменивается на ключ авторизации отдельным запросом и живёт ограниченное время: '
          + 'обновление токена в прототипе не реализовано.',
        'Обработка идёт внутри РФ: подходит для данных с персональными данными.'
      ]
    },

    mock: {
      id: 'mock',
      title: 'Заглушка без сети',
      endpoint: '',
      auth: null,
      systemChannel: 'top_level_field',
      messageShape: 'roles_user_assistant',
      jsonMode: 'native',
      maxTokensField: 'max_tokens',
      vision: true,
      streaming: false,
      promptCache: 'none',
      reasoning: 'none',
      defaultModel: 'mock-1',
      dataRegion: 'none',
      verified: true,
      notes: [
        'Возвращает фиксированные ответы. Используется в прототипе и в тестах.',
        'Ни одного сетевого запроса не выполняет.'
      ]
    }
  };

  function profile(id) {
    return PROFILES[id] || PROFILES.mock;
  }

  function supportsVision(id) {
    return profile(id).vision === true;
  }

  function supportsStrictJson(id) {
    var mode = profile(id).jsonMode;
    return mode === 'output_config_format' || mode === 'response_format_json_schema'
      || mode === 'response_schema' || mode === 'native';
  }

  function ids() {
    return Object.keys(PROFILES);
  }

  /* Обрабатываются ли данные внутри РФ. Важно для персональных данных:
     отправка их в зарубежный сервис — трансграничная передача. */
  function isRussianRegion(id) {
    return profile(id).dataRegion === 'ru';
  }

  /* Сервис, которому нельзя доверять персональные данные без
     дополнительных оснований. Локальная модель считается безопасной:
     данные не покидают машину пользователя. */
  function needsCrossBorderNotice(id) {
    return profile(id).dataRegion === 'global';
  }

  return { profiles: PROFILES, profile: profile, ids: ids,
    supportsVision: supportsVision, supportsStrictJson: supportsStrictJson,
    isRussianRegion: isRussianRegion, needsCrossBorderNotice: needsCrossBorderNotice };
});
