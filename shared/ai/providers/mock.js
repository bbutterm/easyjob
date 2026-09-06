/* Адаптер-заглушка. Ни одного сетевого запроса не делает.
   Используется в прототипе и в тестах: позволяет пройти весь путь
   сборки контекста и запроса, не подключая платный сервис. */

'use strict';

/* Выделить строки-требования из текста вакансии в запросе: заглушка
   становится убедительнее, но остаётся заглушкой и помечается как таковая. */
function requirementLines(request) {
  var text = String(request.userText || '');
  var m = /\[ВАКАНСИЯ: ИСХОДНЫЙ ТЕКСТ\]\n([\s\S]*?)(?:\n\[|$)/.exec(text);
  if (!m) return [];
  return m[1].split('\n')
    .map(function (line) { return line.replace(/^[\s—\-•*]+/, '').trim(); })
    .filter(function (line) { return line.length > 6 && line.length < 140 && !/^(задачи|требования|мы ищем|ищем|условия|обязанности)/i.test(line); })
    .slice(0, 8);
}

function requirementsFromContext(request) {
  var text = String(request.userText || '');
  var m = /\[ТРЕБОВАНИЯ\]\n([\s\S]*?)(?:\n\[|$)/.exec(text);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

var STATUSES = ['confirmed', 'unclear', 'missing'];

var CANNED = {
  'vacancy.parse': function (request) {
    var lines = requirementLines(request);
    if (!lines.length) lines = ['Опыт работы по профилю от 2 лет', 'Владение основными инструментами профессии',
      'Готовность к указанному формату работы'];
    return JSON.stringify({ requirements: lines.map(function (text, i) {
      return { id: 'req-' + (i + 1), text: text, kind: i === lines.length - 1 ? 'formal' : 'hard', weight: 2 };
    }) });
  },
  'match.requirements': function (request) {
    var reqs = requirementsFromContext(request) || [];
    return JSON.stringify({ items: reqs.map(function (r, i) {
      var status = STATUSES[i % 3];
      return { requirementId: r.id, status: status,
        evidence: status === 'confirmed' ? 'Заглушка: в резюме есть похожая формулировка.'
          : status === 'unclear' ? 'Заглушка: упомянуто без деталей.' : 'Заглушка: в резюме не найдено.',
        advice: 'Заглушка: подготовьте один конкретный пример по этому требованию.' };
    }) });
  },
  'questions.generate': function () {
    var topics = ['Опыт', 'Опыт', 'Профессия', 'Кейс', 'Кейс', 'О вакансии', 'О вакансии', 'Работа в команде'];
    return JSON.stringify({ questions: topics.map(function (topic, i) {
      return { id: 'q' + (i + 1), topic: topic,
        text: 'Заглушка, вопрос ' + (i + 1) + ' по теме «' + topic + '».',
        why: 'Заглушка: тема встречается в требованиях вакансии.',
        guidance: 'Заглушка: контекст, действие, результат.' };
    }) });
  },
  'resume.review': function () {
    return JSON.stringify({
      strengths: ['Заглушка: понятная хронология.', 'Заглушка: есть базовый набор навыков.'],
      vague: [{ title: 'Заглушка: расплывчатая обязанность', before: 'Выполнение рабочих задач.',
        after: 'Заглушка: опишите задачу, роль и результат.', why: 'Заглушка: без конкретики.' }],
      missing: [{ title: 'Заглушка: нет масштаба задач', after: 'Заглушка: впишите настоящие цифры.',
        why: 'Заглушка: без масштаба не оценить уровень.' }]
    });
  },
  'answer.feedback': function () {
    return JSON.stringify({ strong: ['Заглушка: есть структура.'], gaps: ['Заглушка: нет результата.'],
      rewrite: 'Заглушка: тот же ответ, но с результатом в конце.' });
  },
  'interview.summary': function () {
    return JSON.stringify({
      strong: ['Заглушка: ответы структурные.'],
      repeat: ['Заглушка: тема из слабых мест сопоставления.'],
      advice: ['Заглушка: держите ответ в пределах двух минут.']
    });
  },
  'prep.card': function () {
    return JSON.stringify({
      opening: 'Заглушка: две фразы о себе из резюме.',
      strongPoints: ['Заглушка: подтверждённое требование.'],
      risky: [{ topic: 'Заглушка: слабое место', howToAnswer: 'Заглушка: честно назвать пробел и план.' }],
      askThem: ['Какие задачи стоят перед ролью в первые три месяца?'],
      reminders: ['Ответ до двух минут, заканчивать результатом.']
    });
  },
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
  /* Память: по одному факту на каждую реплику кандидата из раздела
     «ПОСЛЕДНИЕ РЕПЛИКИ», с дословной цитатой — чтобы проверка ссылок
     проходила так же, как с настоящей моделью. Статус — только user_said:
     заглушка ничего не подтверждает. */
  'context.compact': function (request) {
    var text = String(request.userText || '');
    var m = /\[ПОСЛЕДНИЕ РЕПЛИКИ\]\n([\s\S]*?)(?:\n\[|$)/.exec(text);
    var turns = [];
    if (m) { try { turns = JSON.parse(m[1]); } catch (e) { turns = []; } }
    var facts = [];
    var topics = [];
    /* Первое предложение — факт; предложения с отрицанием, числами или
       исправлением — отдельные факты. Так заглушка не теряет «но не…»
       в конце длинного ответа, как теряла бы свёртка по 157 символам. */
    turns.forEach(function (t) {
      if (!t || typeof t.seq !== 'number') return;
      var body = String(t.text || '').trim();
      if (t.role === 'candidate' && body.length >= 8) {
        /* Предложения, а внутри них — части после «, но», «, а», «; »:
           отрицание в хвосте длинной фразы становится отдельным фактом. */
        var sentences = body.split(/(?<=[.!?])\s+/).map(function (x) { return x.trim(); }).filter(Boolean);
        var clauses = [];
        sentences.forEach(function (sn) {
          sn.split(/,\s*(?=(?:но|а|однако|при этом|зато)\s)|;\s*/).map(function (x) { return x.trim(); })
            .filter(Boolean).forEach(function (c) { clauses.push(c); });
        });
        var picked = [clauses[0]];
        clauses.slice(1).forEach(function (sn) {
          if (/(^|\s)(не|нет|ни)\s|\d|^(а|но|зато|однако)\s|точнее|на самом деле|исправлю|поправлю|ошиб|(^|\s)(одн|дв[аеу]|тр[иёе]|четыр|пят|шест|сем|восьм|девят|десят)[а-яё]*\s(лет|год|мес|нед|дн|раз|сезон)/i.test(sn)
            && picked.indexOf(sn) < 0) picked.push(sn);
        });
        picked.slice(0, 4).forEach(function (sn, i) {
          var quote = sn.slice(0, Math.min(80, sn.length));
          facts.push({ factId: 'm' + t.seq + (i ? '_' + i : ''), value: sn.slice(0, 200), status: 'user_said',
            sourceRef: { kind: 'turn', seq: t.seq }, quote: quote });
        });
      }
      if (t.role === 'interviewer' && body.length >= 8) topics.push(body.slice(0, 50));
    });
    return JSON.stringify({ facts: facts, askedTopics: topics.slice(0, 10), contradictions: [],
      unresolvedQuestions: [], evidenceRefs: facts.map(function (f) { return f.sourceRef.seq; }) });
  },
  'interview.turn': function (request) {
    var text = String(request.userText || '');
    var asked = (text.match(/"role":\s*"interviewer"/g) || []).length;
    var pool = [
      'Расскажите, за что именно вы отвечали на последнем месте работы.',
      'Какая задача была самой сложной и как вы её решили?',
      'Что вы делаете, когда данных для решения не хватает?',
      'Как вы понимаете, что работа сделана хорошо?',
      'Какие у вас вопросы к нам?'
    ];
    return pool[Math.min(asked, pool.length - 1)];
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
