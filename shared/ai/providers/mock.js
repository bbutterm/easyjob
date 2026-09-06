/* Адаптер-заглушка. Ни одного сетевого запроса не делает.
   Используется в прототипе и в тестах: позволяет пройти весь путь
   сборки контекста и запроса, не подключая платный сервис. */

'use strict';

var CANNED = {
  'screen.extract': function () {
    return JSON.stringify({
      question: 'Расскажите про самую сложную задачу в вашей работе.',
      confidence: 0.4,
      speakerGuess: 'interviewer'
    });
  },
  'assistant.hint': function (request) {
    return JSON.stringify({
      direction: 'Назовите одну конкретную задачу, свою роль в ней и результат. '
        + 'Опирайтесь на то, что уже написано у вас в резюме.',
      remind: 'Демонстрационная подсказка: настоящая модель не подключена.',
      avoid: 'Не приписывайте себе опыт, которого нет в резюме.'
    });
  },
  'interview.turn': function () {
    return 'Расскажите, за что именно вы отвечали на последнем месте работы.';
  }
};

function toWire(request) {
  return { url: '', method: 'MOCK', headers: {}, body: { task: request.task } };
}

function fromWire(json) {
  return { ok: true, text: json && json.text ? json.text : '', stopReason: 'end_turn', usage: null };
}

function run(request) {
  var maker = CANNED[request.task];
  var text = maker ? maker(request) : JSON.stringify({ note: 'Заглушка: модель не подключена.' });
  return { ok: true, text: text, stopReason: 'end_turn', usage: null, mock: true };
}

module.exports = { id: 'mock', defaultModel: 'mock-1', toWire: toWire, fromWire: fromWire, run: run };
