/* ============================================================
   Каталог переменных, которые подставляются в запрос к модели.

   Это источник истины: документация docs/ai-variables.md
   генерируется отсюда скриптом tools/gen-ai-docs.js.

   Каталог намеренно не зависит от провайдера. Один и тот же набор
   переменных собирается для Anthropic, OpenAI, Gemini или локальной
   модели; различия провайдеров описаны в capabilities.js и
   учитываются адаптерами.

   Поля описания переменной:
     key         — путь в объекте переменных, например resume.summary
     type        — string | string[] | object | object[] | number | enum | image
     required    — обязательна ли для задач, где используется
     pii         — содержит персональные данные (влияет на минимизацию и логи)
     source      — откуда берётся значение
     budget      — ориентировочный вклад в размер запроса
     note        — пояснение
   ============================================================ */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AiVariables = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GROUPS = [
    {
      id: 'runtime',
      title: 'Среда выполнения',
      note: 'Не отправляется в модель как текст — управляет тем, как собран запрос.',
      vars: [
        { key: 'runtime.provider', type: 'enum', required: true, pii: false,
          source: 'настройки сервиса', budget: '—',
          note: 'anthropic | openai | gemini | openai_compatible | mock. Определяет адаптер.' },
        { key: 'runtime.model', type: 'string', required: true, pii: false,
          source: 'настройки сервиса', budget: '—',
          note: 'Идентификатор модели у выбранного провайдера.' },
        { key: 'runtime.locale', type: 'string', required: true, pii: false,
          source: 'настройки пользователя', budget: '—',
          note: 'Язык ответа. По умолчанию ru-RU.' },
        { key: 'runtime.maxOutputTokens', type: 'number', required: true, pii: false,
          source: 'настройки задачи', budget: '—',
          note: 'Ограничение длины ответа. У задач разное: подсказка короткая, разбор резюме длинный.' },
        { key: 'runtime.contextBudget', type: 'number', required: true, pii: false,
          source: 'настройки задачи', budget: '—',
          note: 'Бюджет входного контекста в токенах. По нему усекаются слои контекста.' },
        { key: 'runtime.streaming', type: 'enum', required: false, pii: false,
          source: 'настройки задачи', budget: '—',
          note: 'on | off. Для подсказок на живом интервью нужен потоковый вывод.' }
      ]
    },
    {
      id: 'policy',
      title: 'Ограничения и правила ответа',
      note: 'Собирается в системную инструкцию. Одинаково для всех провайдеров по смыслу, '
        + 'по способу передачи — различается (см. capabilities.js).',
      vars: [
        { key: 'policy.language', type: 'string', required: true, pii: false,
          source: 'runtime.locale', budget: 'мал',
          note: 'Язык, на котором модель обязана отвечать.' },
        { key: 'policy.noInvention', type: 'string', required: true, pii: false,
          source: 'константа продукта', budget: 'мал',
          note: 'Запрет придумывать работодателей, достижения, цифры и сертификаты за пользователя.' },
        { key: 'policy.tone', type: 'enum', required: false, pii: false,
          source: 'настройки пользователя', budget: 'мал',
          note: 'neutral | supportive | direct. Влияет на формулировки, не на содержание.' },
        { key: 'policy.outputFormat', type: 'enum', required: true, pii: false,
          source: 'настройки задачи', budget: 'мал',
          note: 'json | text. Для json адаптер включает режим структурированного вывода, если провайдер его умеет.' },
        { key: 'policy.maxWords', type: 'number', required: false, pii: false,
          source: 'настройки задачи', budget: 'мал',
          note: 'Жёсткий предел длины. Для подсказки на живом интервью — около 40 слов.' },
        { key: 'policy.disclaimer', type: 'string', required: false, pii: false,
          source: 'константа продукта', budget: 'мал',
          note: 'Требование не обещать трудоустройство и не выдавать оценку за гарантию.' }
      ]
    },
    {
      id: 'user',
      title: 'Пользователь',
      note: 'Персональные данные. Минимизируются: в модель уходит только то, что нужно задаче.',
      vars: [
        { key: 'user.displayName', type: 'string', required: false, pii: true,
          contextField: 'userSummary',
          source: 'профиль', budget: 'мал',
          note: 'Имя. Нужно только при генерации текста резюме. В остальных задачах не передаётся.' },
        { key: 'user.city', type: 'string', required: false, pii: true,
          source: 'профиль', budget: 'мал',
          note: 'Город. Влияет на формат работы и переезд.' },
        { key: 'user.experienceYears', type: 'number', required: false, pii: false,
          source: 'вычисляется из резюме', budget: 'мал',
          note: 'Общий стаж. Используется для калибровки сложности вопросов.' },
        { key: 'user.preferences', type: 'string', required: false, pii: true,
          source: 'мастер резюме', budget: 'мал',
          note: 'Пожелания: формат, график, отрасль.' }
      ]
    },
    {
      id: 'profession',
      title: 'Профессия',
      note: 'Продукт не ограничен списком профессий: если профессии нет в справочнике, '
        + 'в модель уходит название, введённое пользователем, и признак isKnown=false.',
      vars: [
        { key: 'profession.name', type: 'string', required: true, pii: false,
          source: 'мастер резюме или резюме', budget: 'мал',
          note: 'Название как его написал пользователь. Основной ориентир для модели.' },
        { key: 'profession.id', type: 'string', required: false, pii: false,
          source: 'справочник', budget: '—',
          note: 'Идентификатор, если профессия найдена в справочнике. Пусто для произвольной.' },
        { key: 'profession.group', type: 'string', required: false, pii: false,
          source: 'справочник', budget: 'мал',
          note: 'Отрасль. Помогает подобрать типовые темы, но не ограничивает ответ.' },
        { key: 'profession.isKnown', type: 'enum', required: true, pii: false,
          source: 'справочник', budget: '—',
          note: 'true | false. При false модель опирается только на название и резюме, '
            + 'без справочных подсказок.' },
        { key: 'profession.seniority', type: 'enum', required: false, pii: false,
          source: 'резюме или вакансия', budget: 'мал',
          note: 'junior | middle | senior | lead. Влияет на глубину вопросов.' }
      ]
    },
    {
      id: 'resume',
      title: 'Резюме',
      note: 'Передаётся структурой, а не сплошным текстом: так модель точнее ссылается на разделы '
        + 'и не смешивает опыт с навыками.',
      vars: [
        { key: 'resume.id', type: 'string', required: true, pii: false,
          source: 'база', budget: '—', note: 'Идентификатор версии резюме.' },
        { key: 'resume.rev', type: 'number', required: true, pii: false,
          source: 'база', budget: '—',
          note: 'Номер версии. По нему определяется, устарел ли прежний разбор.' },
        { key: 'resume.summary', type: 'string', required: false, pii: true,
          source: 'резюме', budget: 'мал', note: 'Раздел «О себе».' },
        { key: 'resume.experience', type: 'object[]', required: true, pii: true,
          source: 'резюме', budget: 'средний',
          note: 'Записи опыта: role, company, period, details. Основной источник подтверждений.' },
        { key: 'resume.skills', type: 'string[]', required: true, pii: false,
          source: 'резюме', budget: 'мал', note: 'Навыки списком.' },
        { key: 'resume.achievements', type: 'string[]', required: false, pii: true,
          source: 'резюме', budget: 'мал', note: 'Достижения. Модель не имеет права их дополнять.' },
        { key: 'resume.education', type: 'object[]', required: false, pii: true,
          source: 'резюме', budget: 'мал', note: 'Образование: place, program, period.' },
        { key: 'resume.rawText', type: 'string', required: false, pii: true,
          contextField: 'rawResumeText',
          source: 'загруженный файл после разбора', budget: 'большой',
          note: 'Текст загруженного резюме. Используется только в задаче resume.review, '
            + 'если структурный разбор не удался.' }
      ]
    },
    {
      id: 'vacancy',
      title: 'Вакансия',
      vars: [
        { key: 'vacancy.title', type: 'string', required: true, pii: false,
          source: 'ввод пользователя', budget: 'мал', note: 'Должность из объявления.' },
        { key: 'vacancy.company', type: 'string', required: false, pii: false,
          source: 'ввод пользователя', budget: 'мал', note: 'Компания.' },
        { key: 'vacancy.rawText', type: 'string', required: true, pii: false,
          contextField: 'vacancyRawText',
          source: 'вставленный текст', budget: 'большой',
          note: 'Полный текст объявления. Усекается по бюджету с сохранением блока требований.' },
        { key: 'vacancy.requirements', type: 'object[]', required: false, pii: false,
          source: 'задача vacancy.parse', budget: 'средний',
          note: 'Извлечённые требования: id, text, kind (hard|soft|formal), weight.' },
        { key: 'vacancy.rev', type: 'number', required: true, pii: false,
          source: 'база', budget: '—', note: 'Версия вакансии для отметки устаревших отчётов.' }
      ]
    },
    {
      id: 'prep',
      title: 'Подготовка',
      note: 'Связка резюме и вакансии. Позволяет не пересобирать контекст на каждом шаге.',
      vars: [
        { key: 'prep.id', type: 'string', required: true, pii: false,
          source: 'база', budget: '—', note: 'Идентификатор подготовки.' },
        { key: 'prep.match', type: 'object[]', required: false, pii: false,
          source: 'задача match.requirements', budget: 'средний',
          note: 'Результат сопоставления: requirementId, status, evidence, advice.' },
        { key: 'prep.questions', type: 'object[]', required: false, pii: false,
          source: 'задача questions.generate', budget: 'средний',
          note: 'Вопросы: id, topic, text, why, guidance.' },
        { key: 'prep.answers', type: 'object', required: false, pii: true,
          source: 'ввод пользователя', budget: 'средний',
          note: 'Ответы пользователя по questionId. Передаются только в задачи обратной связи.' },
        { key: 'prep.weakSpots', type: 'string[]', required: false, pii: false,
          source: 'вычисляется из prep.match', budget: 'мал',
          note: 'Требования со статусом «нужно уточнить» и «не указано». Главный ориентир для вопросов и подсказок.' },
        { key: 'prep.evidence', type: 'object[]', required: false, pii: true,
          source: 'подбор по текущему вопросу: прямые ссылки по requirementId, затем полнотекстовый поиск',
          budget: 'средний',
          note: 'Подтверждения из резюме и прежних реплик, относящиеся к текущему вопросу: source, text. '
            + 'Заменяет передачу всего резюме в задачах интервью.' }
      ]
    },
    {
      id: 'session',
      title: 'Сессия интервью',
      note: 'Короткоживущий слой. Тренировочная сессия и сессия помощника используют одни поля.',
      vars: [
        { key: 'session.id', type: 'string', required: true, pii: false,
          source: 'runtime', budget: '—', note: 'Идентификатор сессии.' },
        { key: 'session.mode', type: 'enum', required: true, pii: false,
          source: 'runtime', budget: 'мал',
          note: 'practice_text | practice_voice | live_assistant. Меняет роль модели и длину ответа.' },
        { key: 'session.stage', type: 'enum', required: false, pii: false,
          source: 'runtime', budget: 'мал',
          note: 'intro | main | cases | candidate_questions | closing. Помогает держать структуру.' },
        { key: 'session.turns', type: 'object[]', required: false, pii: true,
          source: 'история сессии', budget: 'большой',
          note: 'Реплики: role (interviewer|candidate), text, ts. Усекается скользящим окном.' },
        { key: 'session.turnsSummary', type: 'string', required: false, pii: true,
          source: 'свёртка старых реплик', budget: 'средний',
          note: 'Краткое изложение вытесненных из окна реплик. Заменяет их, а не дополняет.' },
        { key: 'session.elapsedSec', type: 'number', required: false, pii: false,
          source: 'runtime', budget: '—', note: 'Длительность сессии. Влияет на подсказку «пора закругляться».' },
        { key: 'session.askedTopics', type: 'string[]', required: false, pii: false,
          source: 'история сессии', budget: 'мал',
          note: 'Уже затронутые темы, чтобы не повторяться.' },
        { key: 'session.memory', type: 'object', required: false, pii: true,
          source: 'таблица context_memory (задача context.compact)', budget: 'средний',
          note: 'Реестр фактов интервью с источником и статусом, противоречия, открытые вопросы, '
            + 'покрытый диапазон реплик. Заменяет реплики, которые уже покрыты памятью.' }
      ]
    },
    {
      id: 'screen',
      title: 'Чтение экрана (только программа для компьютера)',
      note: 'Заполняется, только когда пользователь явно запустил сессию помощника и выбрал источник '
        + 'захвата. Хранится в памяти и не пишется на диск.',
      vars: [
        { key: 'screen.captureConsent', type: 'enum', required: true, pii: false,
          source: 'подтверждение пользователя', budget: '—',
          note: 'true | false. При false ни один из screen.* не собирается и запрос не отправляется.' },
        { key: 'screen.sourceLabel', type: 'string', required: false, pii: true,
          source: 'системный выбор источника', budget: 'мал',
          note: 'Название выбранного окна или экрана. Показывается пользователю в индикаторе.' },
        { key: 'screen.text', type: 'string', required: false, pii: true,
          source: 'локальное распознавание текста', budget: 'большой',
          note: 'Текст, распознанный на кадре. Основной вход при режиме чтения text.' },
        { key: 'screen.textDelta', type: 'string', required: false, pii: true,
          source: 'сравнение с прошлым кадром', budget: 'средний',
          note: 'Только новое по сравнению с предыдущим кадром. Экономит контекст и деньги.' },
        { key: 'screen.image', type: 'image', required: false, pii: true,
          source: 'кадр захвата', budget: 'очень большой',
          note: 'Кадр для мультимодальной модели. Используется только в режиме чтения vision '
            + 'и только если провайдер поддерживает изображения.' },
        { key: 'screen.capturedAt', type: 'number', required: false, pii: false,
          source: 'runtime', budget: '—', note: 'Время кадра. Нужно, чтобы не отвечать на устаревший вопрос.' },
        { key: 'screen.detectedQuestion', type: 'string', required: false, pii: true,
          source: 'задача screen.extract', budget: 'мал',
          note: 'Вопрос, выделенный из текста экрана. Вход для задачи assistant.hint.' }
      ]
    }
  ];

  /* ---- Задачи и их обязательные переменные ---- */

  var TASKS = [
    {
      id: 'resume.draft',
      title: 'Собрать резюме из ответов мастера',
      uses: ['policy.*', 'profession.name', 'profession.isKnown', 'user.displayName',
        'user.preferences', 'resume.experience', 'resume.skills', 'resume.achievements', 'resume.education'],
      output: 'json',
      outputShape: '{ summary: string, experience: [{role, company, period, details}], '
        + 'skills: string[], suggestions: string[] }',
      note: 'Модель переписывает формулировки пользователя, но не добавляет новых мест работы, '
        + 'достижений и цифр. Всё добавленное должно попадать в suggestions как предложение, а не в текст.'
    },
    {
      id: 'resume.review',
      title: 'Разбор готового резюме',
      uses: ['policy.*', 'profession.name', 'resume.*', 'vacancy.title'],
      output: 'json',
      outputShape: '{ strengths: string[], vague: [{title, before, after, why}], '
        + 'missing: [{title, after, why}] }',
      note: 'Поле before обязано быть дословной цитатой из резюме. Если цитаты нет — предложение '
        + 'относится к missing, а не к vague.'
    },
    {
      id: 'vacancy.parse',
      title: 'Извлечь требования из текста вакансии',
      uses: ['policy.*', 'vacancy.title', 'vacancy.rawText'],
      output: 'json',
      outputShape: '{ requirements: [{id, text, kind: hard|soft|formal, weight: 1..3}] }',
      note: 'Только то, что есть в тексте. Требования не додумываются по названию должности.'
    },
    {
      id: 'match.requirements',
      title: 'Сопоставить резюме с требованиями',
      uses: ['resume.rawText', 'policy.*', 'profession.name', 'resume.experience', 'resume.skills',
        'resume.achievements', 'vacancy.requirements'],
      output: 'json',
      outputShape: '{ items: [{requirementId, status: confirmed|unclear|missing, evidence, advice}] }',
      note: 'evidence — ссылка на конкретный фрагмент резюме. Общий процент соответствия не запрашивается '
        + 'и не показывается: он не отражает вероятность приглашения.'
    },
    {
      id: 'questions.generate',
      title: 'Вероятные вопросы для подготовки',
      uses: ['resume.rawText', 'policy.*', 'profession.*', 'prep.weakSpots', 'vacancy.requirements',
        'resume.experience', 'user.experienceYears'],
      output: 'json',
      outputShape: '{ questions: [{id, topic, text, why, guidance}] }',
      note: 'Формулировка результата — «вероятные вопросы», без обещания, что спросят именно их.'
    },
    {
      id: 'answer.feedback',
      title: 'Обратная связь на ответ пользователя',
      uses: ['policy.*', 'prep.questions', 'prep.answers', 'profession.name'],
      output: 'json',
      outputShape: '{ strong: string[], gaps: string[], rewrite: string }',
      note: 'Оценка ответа, а не человека. Без баллов и рейтингов.'
    },
    {
      id: 'interview.turn',
      title: 'Реплика интервьюера в тренировке',
      uses: ['resume.rawText', 'policy.*', 'session.mode', 'session.stage', 'session.turns', 'session.turnsSummary',
        'session.askedTopics', 'session.memory', 'prep.questions', 'prep.weakSpots', 'prep.evidence',
        'profession.name'],
      output: 'text',
      outputShape: 'одна реплика интервьюера',
      note: 'Модель ведёт интервью, а не оценивает вслух. Оценка выдаётся только в interview.summary.'
    },
    {
      id: 'interview.summary',
      title: 'Итог тренировочного интервью',
      uses: ['resume.rawText', 'policy.*', 'session.turns', 'session.turnsSummary', 'session.memory', 'prep.weakSpots',
        'prep.evidence', 'profession.name'],
      output: 'json',
      outputShape: '{ strong: string[], repeat: string[], advice: string[] }',
      note: 'Опирается на реальные реплики сессии, а не на общие рекомендации.'
    },
    {
      id: 'prep.card',
      title: 'Карточка подготовки к интервью',
      uses: ['resume.rawText', 'policy.*', 'profession.name', 'prep.weakSpots', 'prep.questions', 'prep.answers',
        'vacancy.requirements', 'resume.experience'],
      output: 'json',
      outputShape: '{ opening: string, strongPoints: string[], risky: [{topic, howToAnswer}], '
        + 'askThem: string[], reminders: string[] }. Все поля обязательны, без дополнительных полей. '
        + 'opening: 1–2000 символов; массивы: до 10 элементов (пустые допустимы при отсутствии фактов); '
        + 'строки массивов: 1–600 символов; topic: 1–300; howToAnswer: 1–1000. Строки не могут быть пустыми.',
      note: 'Краткая шпаргалка, которую человек читает перед разговором. Опирается на его '
        + 'собственные ответы: формулировки не выдумываются за него. Открывается на телефоне '
        + 'или втором экране и не требует чтения экрана и записи звука.'
    },
    {
      id: 'context.compact',
      title: 'Сжать новые реплики интервью в память',
      uses: ['policy.*', 'session.turns', 'session.memory', 'prep.weakSpots', 'profession.name'],
      output: 'json',
      outputShape: '{ facts: [{factId, value, status: user_said|in_document|confirmed|conflict|unknown, '
        + 'sourceRef: {kind: turn, seq} | {kind: document, field}, quote?, supersedes?}], '
        + 'askedTopics: string[], contradictions: [{text, seqs: number[]}], unresolvedQuestions: string[], '
        + 'evidenceRefs: number[] }',
      note: 'Вход — прежняя память и только новые реплики. Каждый факт ссылается на реплику с дословной '
        + 'цитатой или на поле документа; исправления идут новым фактом с supersedes, а не правкой. '
        + 'Уверенный тон не повышает статус. Ответ проверяется по ссылкам и публикуется атомарно.'
    },
    {
      id: 'screen.extract',
      title: 'Выделить вопрос из текста экрана',
      uses: ['policy.*', 'screen.captureConsent', 'screen.text', 'screen.textDelta', 'screen.image'],
      output: 'json',
      outputShape: '{ question: string|null, confidence: 0..1, speakerGuess: interviewer|candidate|unknown }',
      note: 'При captureConsent=false задача не выполняется. Если вопрос не найден — question=null, '
        + 'и подсказка не запрашивается.'
    },
    {
      id: 'assistant.hint',
      title: 'Подсказка во время согласованного интервью',
      uses: ['resume.rawText', 'policy.maxWords', 'policy.language', 'screen.detectedQuestion', 'prep.weakSpots',
        'prep.evidence', 'resume.experience', 'resume.skills', 'vacancy.requirements', 'profession.name',
        'session.askedTopics', 'session.memory'],
      output: 'json',
      outputShape: '{ direction: string, remind: string|null, avoid: string|null }',
      note: 'Направление ответа, а не готовый текст для зачитывания. Ограничение по длине жёсткое: '
        + 'длинную подсказку невозможно прочитать в разговоре.'
    }
  ];

  function allVariables() {
    var out = [];
    GROUPS.forEach(function (g) {
      g.vars.forEach(function (v) {
        out.push({ group: g.id, groupTitle: g.title, key: v.key, type: v.type,
          required: v.required, pii: v.pii, source: v.source, budget: v.budget,
          contextField: v.contextField || '', note: v.note });
      });
    });
    return out;
  }

  function piiKeys() {
    return allVariables().filter(function (v) { return v.pii; }).map(function (v) { return v.key; });
  }

  /* Имена полей, под которыми чувствительные переменные реально лежат
     в объекте контекста. Используется при скрытии данных в журналах. */
  function piiFields() {
    var out = [];
    GROUPS.forEach(function (g) {
      g.vars.forEach(function (v) {
        if (!v.pii) return;
        var last = v.key.split('.').pop();
        if (out.indexOf(last) < 0) out.push(last);
        if (v.contextField && out.indexOf(v.contextField) < 0) out.push(v.contextField);
      });
    });
    /* Поля, которые собираются приложением и не имеют отдельной
       переменной в каталоге, но содержат те же данные. */
    ['answers', 'user', 'vacancyRawText'].forEach(function (extra) {
      if (out.indexOf(extra) < 0) out.push(extra);
    });
    return out;
  }

  function task(id) {
    for (var i = 0; i < TASKS.length; i++) {
      if (TASKS[i].id === id) return TASKS[i];
    }
    return null;
  }

  return {
    groups: GROUPS,
    tasks: TASKS,
    allVariables: allVariables,
    piiKeys: piiKeys,
    piiFields: piiFields,
    task: task
  };
});
