/* ============================================================
   Политики контекста по задачам.

   inputCap       — жёсткий предел на весь сериализованный вход
   outputReserve  — сколько оставить на ответ (включая рассуждение,
                    если оно у модели не выключено)
   windowTurns    — сколько последних реплик держать в окне
   required       — поля, которые нельзя выбросить при усечении;
                    если они не помещаются — запрос не отправляется
   dropFirst      — что выбрасывать в первую очередь

   Числа — начальные гипотезы из документа владельца, не приказ резать
   качество. Меняются через overrides без правки кода.
   ============================================================ */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ContextPolicy = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT = {
    inputCap: 12000,
    outputReserve: 2000,
    outputReserveThinkingOff: 1200,
    windowTurns: 8,
    required: ['identity.profession', 'moment.detectedQuestion', 'session.currentTurn'],
    dropFirst: ['preparation.rawResumeText', 'preparation.vacancyRawText', 'moment.image',
      'preparation.education', 'preparation.achievements', 'session.turnsSummary']
  };

  var TASKS = {
    'interview.turn': {
      inputCap: 6000, outputReserve: 1200, outputReserveThinkingOff: 500, windowTurns: 6,
      required: ['identity.profession', 'session.currentTurn', 'preparation.weakSpots'],
      dropFirst: ['preparation.rawResumeText', 'preparation.vacancyRawText', 'preparation.education',
        'preparation.achievements', 'preparation.questions', 'preparation.skills', 'session.turnsSummary']
    },
    'assistant.hint': {
      inputCap: 4000, outputReserve: 900, outputReserveThinkingOff: 200, windowTurns: 4,
      required: ['moment.detectedQuestion', 'preparation.weakSpots'],
      dropFirst: ['moment.image', 'moment.text', 'preparation.education', 'preparation.achievements',
        'session.turnsSummary', 'preparation.experience']
    },
    'screen.extract': {
      inputCap: 4000, outputReserve: 900, outputReserveThinkingOff: 300, windowTurns: 2,
      required: [], dropFirst: ['moment.image']
    },
    'resume.review': {
      inputCap: 12000, outputReserve: 2500, outputReserveThinkingOff: 2500, windowTurns: 0,
      required: ['preparation.experience'], dropFirst: ['preparation.vacancyRawText', 'preparation.rawResumeText']
    },
    'match.requirements': {
      inputCap: 12000, outputReserve: 2500, outputReserveThinkingOff: 2500, windowTurns: 0,
      required: ['preparation.requirements', 'preparation.experience'],
      dropFirst: ['preparation.vacancyRawText', 'preparation.rawResumeText', 'preparation.education']
    },
    'vacancy.parse': {
      inputCap: 12000, outputReserve: 2000, outputReserveThinkingOff: 2000, windowTurns: 0,
      required: ['preparation.vacancyRawText'], dropFirst: ['preparation.rawResumeText', 'preparation.experience']
    },
    'questions.generate': {
      inputCap: 12000, outputReserve: 3000, outputReserveThinkingOff: 3000, windowTurns: 0,
      required: ['preparation.requirements'], dropFirst: ['preparation.vacancyRawText', 'preparation.rawResumeText']
    },
    'prep.card': {
      inputCap: 12000, outputReserve: 2500, outputReserveThinkingOff: 2500, windowTurns: 0,
      required: ['preparation.answers'], dropFirst: ['preparation.vacancyRawText', 'preparation.rawResumeText']
    },
    'interview.summary': {
      inputCap: 16000, outputReserve: 3000, outputReserveThinkingOff: 3000, windowTurns: 40,
      required: ['preparation.weakSpots', 'session.turns'],
      dropFirst: ['preparation.vacancyRawText', 'preparation.rawResumeText', 'preparation.education', 'preparation.questions']
    },
    'answer.feedback': {
      inputCap: 8000, outputReserve: 1500, outputReserveThinkingOff: 1500, windowTurns: 0,
      required: ['preparation.answers', 'preparation.questions'], dropFirst: ['preparation.vacancyRawText']
    },
    'context.compact': {
      inputCap: 10000, outputReserve: 2500, outputReserveThinkingOff: 2500, windowTurns: 40,
      required: ['session.turns'], dropFirst: ['preparation.vacancyRawText', 'preparation.rawResumeText',
        'preparation.education', 'preparation.questions', 'preparation.experience']
    }
  };

  function policyFor(taskId, overrides) {
    var base = Object.assign({}, DEFAULT, TASKS[taskId] || {});
    var o = overrides || {};
    var taskOverride = (o.tasks && o.tasks[taskId]) || {};
    return Object.assign(base, o.all || {}, taskOverride);
  }

  /* Сколько остаётся на вход: предел минус резерв на ответ. Резерв
     зависит от того, подтверждено ли выключение рассуждения. */
  function inputAllowance(policy, thinkingKnownOff) {
    var reserve = thinkingKnownOff ? policy.outputReserveThinkingOff : policy.outputReserve;
    return Math.max(0, policy.inputCap - reserve);
  }

  return { policyFor: policyFor, inputAllowance: inputAllowance, DEFAULT: DEFAULT, TASKS: TASKS };
});
