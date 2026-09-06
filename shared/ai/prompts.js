/* ============================================================
   Сборка текста запроса по задачам.

   Ничего провайдер-специфичного здесь нет: на выходе — системная
   инструкция, текст пользовательского сообщения и схема ответа.
   Как это положить в HTTP-запрос, решает адаптер провайдера.

   Разделы контекста размечены заголовками в квадратных скобках.
   Это делает запрос читаемым в логах и позволяет модели ссылаться
   на конкретный раздел, а не на «резюме вообще».
   ============================================================ */

(function (root, factory) {
  var api = factory(
    typeof module === 'object' && module.exports ? require('./variables.js') : root.AiVariables
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AiPrompts = api;
})(typeof self !== 'undefined' ? self : this, function (AiVariables) {
  'use strict';

  var BASE_RULES = [
    'Ты помогаешь человеку готовиться к поиску работы и собеседованиям.',
    'Отвечай на языке {language}.',
    'Опирайся только на переданные данные. Не придумывай работодателей, должности, '
      + 'достижения, цифры, сертификаты и отраслевой опыт, которых нет в резюме.',
    'Если данных не хватает — прямо скажи, чего не хватает, вместо догадки.',
    'Не обещай трудоустройство и не оценивай вероятность приглашения.',
    'Профессия может быть любой. Не подменяй её похожей и не своди ответ к офисным ролям.'
  ];

  var ROLE_BY_TASK = {
    'resume.draft':
      'Ты редактор резюме. Переписываешь формулировки пользователя понятнее, '
      + 'сохраняя все факты без изменений. Новые факты добавлять запрещено: '
      + 'то, что стоит добавить, помещай в suggestions как вопрос к пользователю.',
    'resume.review':
      'Ты рецензент резюме. Находишь сильные стороны, неясные формулировки и '
      + 'недостающую информацию. В поле before всегда дословная цитата из резюме.',
    'vacancy.parse':
      'Ты разбираешь текст вакансии на отдельные требования. Берёшь только то, '
      + 'что написано в тексте, и не додумываешь требования по названию должности.',
    'match.requirements':
      'Ты сопоставляешь резюме с требованиями вакансии. Для каждого требования '
      + 'указываешь статус и конкретное подтверждение из резюме. Общий процент '
      + 'соответствия не считаешь: он вводит человека в заблуждение.',
    'questions.generate':
      'Ты составляешь вероятные вопросы для подготовки. Опираешься на требования '
      + 'вакансии и слабые места сопоставления. Не утверждаешь, что спросят именно это.',
    'answer.feedback':
      'Ты даёшь обратную связь на ответ кандидата. Оцениваешь ответ, а не человека. '
      + 'Без баллов и рейтингов.',
    'interview.turn':
      'Ты ведёшь тренировочное собеседование в роли интервьюера. Задаёшь по одному '
      + 'вопросу за раз, не оцениваешь ответы вслух и не повторяешь пройденные темы.',
    'interview.summary':
      'Ты подводишь итог тренировочного интервью по реальным репликам сессии.',
    'screen.extract':
      'Ты выделяешь вопрос собеседующего из текста, распознанного на экране. '
      + 'Если вопроса нет — возвращаешь question: null. Ничего не додумываешь.',
    'assistant.hint':
      'Ты подсказываешь направление ответа во время идущего собеседования. '
      + 'Даёшь опору для собственного ответа человека, а не текст для зачитывания. '
      + 'Только то, что подтверждается резюме: подсказывать выдуманный опыт запрещено.'
  };

  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (match, key) {
      return values[key] !== undefined ? values[key] : match;
    });
  }

  function buildSystem(taskId, vars) {
    var policy = vars.policy || {};
    var rules = BASE_RULES.map(function (r) {
      return fill(r, { language: policy.language || 'ru-RU' });
    });
    if (policy.tone === 'direct') rules.push('Пиши коротко и по делу, без смягчений.');
    if (policy.tone === 'supportive') rules.push('Тон поддерживающий, но без похвалы без основания.');
    if (policy.maxWords) rules.push('Ответ не длиннее ' + policy.maxWords + ' слов.');
    if (policy.outputFormat === 'json') {
      rules.push('Отвечай строго одним объектом JSON без пояснений вокруг него.');
    }
    var role = ROLE_BY_TASK[taskId] || 'Ты помогаешь пользователю по его задаче.';
    return role + '\n\nПравила:\n— ' + rules.join('\n— ');
  }

  function section(title, value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value) && !value.length) return '';
    if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return '';
    var body = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
    return '[' + title + ']\n' + body + '\n\n';
  }

  /* Порядок разделов важен: стабильное впереди, изменчивое в конце.
     Так кэш префикса переживает смену реплики или кадра экрана. */
  function buildUser(taskId, ctx) {
    var identity = ctx.identity || {};
    var prep = ctx.preparation || {};
    var session = ctx.session || {};
    var moment = ctx.moment || {};

    var text = '';
    text += section('ПРОФЕССИЯ', identity.profession
      ? identity.profession + (identity.professionKnown === false
        ? ' (в справочнике сервиса такой профессии нет — опирайся на резюме и вакансию)' : '')
      : null);
    text += section('О КАНДИДАТЕ', identity.user);
    text += section('РЕЗЮМЕ: ОПЫТ', prep.experience);
    text += section('РЕЗЮМЕ: НАВЫКИ', prep.skills);
    text += section('РЕЗЮМЕ: ДОСТИЖЕНИЯ', prep.achievements);
    text += section('РЕЗЮМЕ: ОБРАЗОВАНИЕ', prep.education);
    text += section('РЕЗЮМЕ: ИСХОДНЫЙ ТЕКСТ', prep.rawResumeText);
    text += section('ВАКАНСИЯ', prep.vacancy);
    text += section('ВАКАНСИЯ: ИСХОДНЫЙ ТЕКСТ', prep.vacancyRawText);
    text += section('ТРЕБОВАНИЯ', prep.requirements);
    text += section('СЛАБЫЕ МЕСТА СОПОСТАВЛЕНИЯ', prep.weakSpots);
    text += section('ВОПРОСЫ ПОДГОТОВКИ', prep.questions);
    text += section('ОТВЕТЫ ПОЛЬЗОВАТЕЛЯ', prep.answers);
    text += section('РАНЕЕ В РАЗГОВОРЕ (СВЁРТКА)', session.turnsSummary);
    text += section('ПОСЛЕДНИЕ РЕПЛИКИ', session.turns);
    text += section('УЖЕ ЗАТРОНУТЫЕ ТЕМЫ', session.askedTopics);
    text += section('РАСПОЗНАНО НА ЭКРАНЕ (ИЗМЕНЕНИЕ)', moment.textDelta);
    text += section('РАСПОЗНАНО НА ЭКРАНЕ', moment.text);
    text += section('ВОПРОС СОБЕСЕДУЮЩЕГО', moment.detectedQuestion);

    var task = AiVariables.task(taskId);
    text += '[ЗАДАЧА]\n' + (task ? task.title : taskId) + '\n';
    if (task && task.output === 'json') {
      text += '\n[ФОРМАТ ОТВЕТА]\n' + task.outputShape + '\n';
    }
    return text.trim();
  }

  function schemaFor(taskId) {
    var task = AiVariables.task(taskId);
    if (!task || task.output !== 'json') return null;
    return { name: taskId.replace(/\./g, '_'), shape: task.outputShape };
  }

  return {
    buildSystem: buildSystem,
    buildUser: buildUser,
    schemaFor: schemaFor,
    baseRules: BASE_RULES,
    roles: ROLE_BY_TASK
  };
});
