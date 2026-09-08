/* ============================================================
   DEMO_DATA — демонстрационный комплект, собранный под выбранную
   профессию. Структура подготовки одна для всех профессий,
   содержание берётся из библиотеки Professions.

   Все персоны, компании и вакансии вымышлены. Настоящий ИИ здесь
   не участвует: тексты фиксированные. Перечень переменных, которые
   в готовом продукте ушли бы в модель, — в docs/ai-contract.md.
   ============================================================ */

var DemoSet = (function () {
  'use strict';

  var COMPANY_BY_GROUP = {
    'Аналитика': 'Демо-Банк',
    'Разработка': 'Демо-Продукт',
    'Продажи': 'Демо-Торг',
    'Финансы': 'Демо-Холдинг',
    'Медицина': 'Демо-Клиника',
    'Общественное питание': 'Демо-Ресторан',
    'Логистика': 'Демо-Логистика',
    'Образование': 'Демо-Школа №1',
    'Другая профессия': 'Демо-Компания'
  };

  function company(profile) {
    return (COMPANY_BY_GROUP[profile.group] || 'Демо-Компания') + ' (вымышленная компания)';
  }

  function buildResumeCreated(profile) {
    return {
      id: 'res-created',
      title: profile.name + ' — черновик из мастера',
      source: 'created',
      demo: true,
      rev: 1,
      updatedAt: '12.03 14:20',
      profession: profile.name,
      wishes: profile.wishes,
      summary: profile.summary,
      experience: [
        {
          id: 'exp-1',
          role: profile.name,
          company: 'Демо-Организация',
          period: '2022 — настоящее время',
          details: profile.duties.join(' ')
        },
        {
          id: 'exp-2',
          role: profile.name + ' (младший)',
          company: 'Демо-Компания',
          period: '2020 — 2022',
          details: 'Начало работы по профессии: выполнение задач под руководством наставника, '
            + 'освоение инструментов и внутренних регламентов.'
        }
      ],
      skills: profile.skills.slice(),
      achievements: profile.achievements.slice(),
      education: [
        { id: 'edu-1', place: 'Демо-Учебное заведение', program: 'Профильная программа', period: '2016 — 2020' }
      ]
    };
  }

  function buildResumeUploaded(profile) {
    return {
      id: 'res-uploaded',
      title: 'Резюме из файла — демонстрационный образец',
      source: 'uploaded',
      demo: true,
      rev: 1,
      updatedAt: '11.03 09:05',
      fileNameShown: 'Пример: rezume.pdf (файл не читается макетом)',
      profession: profile.name,
      wishes: '',
      summary: 'Опыт работы по профессии. Участие в проектах и текущих задачах.',
      experience: [
        {
          id: 'exp-u1',
          role: profile.name,
          company: 'Демо-Компания',
          period: '2021 — настоящее время',
          details: 'Выполнение рабочих задач, взаимодействие с подразделениями, отчётность.'
        }
      ],
      skills: profile.skills.slice(0, 3),
      achievements: [],
      education: [
        { id: 'edu-u1', place: 'Демо-Институт', program: 'Профильная программа', period: '2015 — 2019' }
      ]
    };
  }

  function buildAnalysis(profile) {
    var firstSkill = profile.skills[0] || 'ключевой навык';
    return {
      strengths: [
        'Указана понятная роль и период работы — рекрутеру легко считать хронологию.',
        'Есть базовый набор навыков, относящихся к профессии «' + profile.name + '».',
        'Объём резюме компактный, читается за минуту.'
      ],
      vague: [
        {
          id: 'sug-1',
          title: 'Расплывчатая формулировка обязанностей',
          before: 'Выполнение рабочих задач, взаимодействие с подразделениями, отчётность.',
          after: profile.duties[0] + ' ' + (profile.duties[1] || ''),
          why: 'Формулировка не показывает, что именно вы делали и с кем взаимодействовали.'
        },
        {
          id: 'sug-2',
          title: 'Раздел «О себе» не отражает специализацию',
          before: 'Опыт работы по профессии. Участие в проектах и текущих задачах.',
          after: profile.summary,
          why: 'Первый абзац читают всегда — в нём стоит назвать специализацию и тип задач.'
        }
      ],
      missing: [
        {
          id: 'sug-3',
          title: 'Не указан масштаб задач',
          before: '—',
          after: 'Добавьте, с какими объёмами вы работали: сколько задач, людей, объектов или клиентов. '
            + 'Впишите свои настоящие цифры.',
          why: 'Без масштаба сложно оценить уровень. Макет не придумывает цифры за вас.'
        },
        {
          id: 'sug-4',
          title: 'Навык «' + firstSkill + '» указан без подтверждения',
          before: '—',
          after: 'Опишите задачу, где этот навык применялся, — одной строкой в разделе опыта.',
          why: 'Навык без примера в опыте вызывает уточняющий вопрос на интервью.'
        }
      ]
    };
  }

  function buildVacancy(profile) {
    var reqs = profile.requirements.concat(Professions.commonRequirements);
    return {
      id: 'vac-1',
      demo: true,
      rev: 1,
      title: profile.name,
      company: company(profile),
      location: 'Формат обсуждается',
      text: 'Мы ищем специалиста по направлению «' + profile.name + '».\n\n'
        + 'Задачи:\n— ' + profile.duties.join('\n— ')
        + '\n\nТребования:\n— ' + reqs.map(function (r) { return r.text; }).join('\n— '),
      requirements: reqs.map(function (r, index) {
        return {
          id: 'req-' + (index + 1),
          text: r.text,
          status: r.status,
          evidence: r.evidence,
          advice: r.advice
        };
      })
    };
  }

  function buildQuestions(profile) {
    var all = profile.questions.concat(Professions.commonQuestions);
    return all.map(function (q, index) {
      return {
        id: 'q' + (index + 1),
        topic: q.topic,
        text: q.text,
        why: q.why,
        guidance: q.guidance
      };
    });
  }

  function buildInterviewScript(profile) {
    var common = Professions.commonAsks;
    return [common[0]].concat(profile.asks).concat([common[1]]);
  }

  function buildInterviewSummary(profile) {
    var weak = profile.requirements.filter(function (r) { return r.status !== 'confirmed'; });
    return {
      strong: [
        'Ответы по основным задачам профессии были структурными: контекст, действие, результат.',
        'В ответе про рабочий процесс прозвучали конкретные шаги, а не общие слова.'
      ],
      repeat: (weak.length
        ? weak.map(function (r) { return r.text + ': ' + r.advice; })
        : ['Проверьте, что на каждый пункт резюме у вас есть короткий пример из практики.']),
      advice: [
        'Держите ответ в пределах двух минут и заканчивайте результатом.',
        'Если данных не хватает — скажите об этом и назовите допущение, а не угадывайте.'
      ]
    };
  }

  function buildVoiceScript(profile) {
    var asks = buildInterviewScript(profile);
    var lines = [];
    for (var i = 0; i < 3 && i < asks.length; i++) {
      lines.push({ who: 'Интервьюер', text: asks[i].ask });
      lines.push({ who: 'Вы (демо-расшифровка)', text: 'Демонстрационный ответ по профессии «' + profile.name + '».' });
    }
    return lines;
  }

  function buildHints(profile) {
    return profile.hints.concat(Professions.commonHints);
  }

  var PLANS = [
    {
      id: 'basic',
      name: 'Резюме и подготовка',
      price: 'Цена уточняется',
      limits: 'Лимит будет определён',
      features: [
        'Создание резюме в мастере для любой профессии',
        'Разбор готового резюме',
        'Добавление вакансии и сопоставление',
        'Вопросы для подготовки'
      ],
      sections: ['overview', 'resumes', 'vacancies', 'jobs', 'plans', 'history', 'settings']
    },
    {
      id: 'training',
      name: 'Тренировки',
      price: 'Цена уточняется',
      limits: 'Лимит будет определён',
      features: [
        'Всё из уровня «Резюме и подготовка»',
        'Текстовое пробное интервью',
        'Голосовое пробное интервью',
        'Итоги тренировок в истории'
      ],
      sections: ['overview', 'resumes', 'vacancies', 'jobs', 'interviews', 'plans', 'history', 'settings']
    },
    {
      id: 'assistant',
      name: 'С помощником',
      price: 'Цена уточняется',
      limits: 'Лимит будет определён',
      features: [
        'Всё из уровня «Тренировки»',
        'Помощник на собеседовании (отдельная программа для компьютера)',
        'Подсказки во время согласованного интервью'
      ],
      sections: ['overview', 'resumes', 'vacancies', 'jobs', 'interviews', 'assistant', 'plans', 'history', 'settings']
    }
  ];

  function build(idOrName) {
    var profile = Professions.find(idOrName) || Professions.genericProfile(idOrName);
    return {
      profession: profile,
      professionName: profile.name,
      isGenericProfession: profile.generic === true,
      candidate: {
        name: 'Демо-кандидат',
        city: 'Город не указан',
        profession: profile.name,
        note: 'Вымышленный профиль для демонстрации интерфейса.'
      },
      resumeCreated: buildResumeCreated(profile),
      resumeUploaded: buildResumeUploaded(profile),
      analysisReport: buildAnalysis(profile),
      vacancy: buildVacancy(profile),
      questions: buildQuestions(profile),
      interviewScript: buildInterviewScript(profile),
      interviewSummary: buildInterviewSummary(profile),
      voiceScript: buildVoiceScript(profile),
      assistantHints: buildHints(profile),
      plans: PLANS
    };
  }

  return { build: build };
})();

/* Активный комплект. Мутируется на месте при смене профессии,
   чтобы экраны могли ссылаться на DEMO_DATA напрямую. */
var DEMO_DATA = DemoSet.build('analyst');

function applyProfession(idOrName) {
  var next = DemoSet.build(idOrName);
  Object.keys(DEMO_DATA).forEach(function (key) { delete DEMO_DATA[key]; });
  Object.keys(next).forEach(function (key) { DEMO_DATA[key] = next[key]; });
  return DEMO_DATA;
}
