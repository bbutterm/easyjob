/* ============================================================
   Состояние макета.
   Всё, что вводит пользователь, живёт только в памяти страницы.
   В localStorage сохраняются исключительно тема оформления,
   выбранный демо-сценарий, демо-тариф и состояние демо-панели.
   Резюме, файлы, ответы, токены и пароли не сохраняются никуда.
   ============================================================ */

var Store = (function () {
  'use strict';

  var LS_KEY = 'career-helper-prototype-prefs';
  var listeners = [];

  function loadPrefs() {
    var fallback = { theme: 'light', scenario: 'filled', plan: 'training', demoPanelOpen: false,
      professionId: 'analyst' };
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return {
        theme: parsed.theme === 'dark' ? 'dark' : 'light',
        scenario: ['empty', 'filled', 'loading', 'error', 'limit'].indexOf(parsed.scenario) >= 0
          ? parsed.scenario : 'filled',
        plan: ['basic', 'training', 'assistant'].indexOf(parsed.plan) >= 0 ? parsed.plan : 'training',
        demoPanelOpen: parsed.demoPanelOpen === true,
        /* Сохраняем только идентификатор профессии из библиотеки примеров.
           Профессия, введённая пользователем вручную, не сохраняется:
           это его данные, а не выбор демо-сценария. */
        professionId: Professions.find(parsed.professionId) ? parsed.professionId : 'analyst'
      };
    } catch (e) {
      return fallback;
    }
  }

  function savePrefs() {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify({
        theme: state.theme,
        scenario: state.scenario,
        plan: state.plan,
        demoPanelOpen: state.demoPanelOpen,
        professionId: Professions.find(state.professionId) ? state.professionId : 'analyst'
      }));
    } catch (e) {
      /* приватный режим браузера — просто работаем без сохранения настроек */
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 8);
  }

  function emptyBuilder() {
    return {
      step: 0,
      errors: {},
      data: {
        profession: '',
        wishes: '',
        summary: '',
        experience: [],
        skills: '',
        achievements: '',
        education: []
      },
      built: null
    };
  }

  function filledPreps() {
    var prep = {
      id: 'prep-1',
      resumeId: 'res-created',
      vacancyId: 'vac-1',
      resumeRev: 1,
      vacancyRev: 1,
      createdAt: '12.03 15:04',
      stale: false,
      staleReason: '',
      answers: {},
      ready: {},
      chat: null,
      voice: null
    };
    return [prep];
  }

  function baseState(scenario) {
    var filled = scenario !== 'empty';
    return {
      resumes: filled ? [clone(DEMO_DATA.resumeCreated), clone(DEMO_DATA.resumeUploaded)] : [],
      vacancies: filled ? [clone(DEMO_DATA.vacancy)] : [],
      preps: filled ? filledPreps() : [],
      history: filled
        ? [
            { id: 'h1', when: '12.03 15:40', what: 'Текстовое пробное интервью', prepId: 'prep-1', route: '#/prep/prep-1/interview' },
            { id: 'h2', when: '12.03 15:12', what: 'Сопоставление резюме с вакансией', prepId: 'prep-1', route: '#/prep/prep-1/match' },
            { id: 'h3', when: '12.03 14:20', what: 'Резюме собрано в мастере', prepId: null, route: '#/resumes' }
          ]
        : [],
      activePrepId: filled ? 'prep-1' : null,
      builder: emptyBuilder(),
      upload: { fileName: '', analysisShown: false, decisions: {} },
      vacancyDraft: { title: '', company: '', text: '', resumeId: '' },
      assistant: { status: 'disconnected', prepId: filled ? 'prep-1' : null, hintIndex: 0, hintsOpen: false },
      settings: {
        emailUpdates: true,
        weeklyDigest: false,
        practiceReminders: true,
        showDemoLabels: true
      }
    };
  }

  var prefs = loadPrefs();

  applyProfession(prefs.professionId);

  var state = {
    theme: prefs.theme,
    professionId: prefs.professionId,
    professionName: DEMO_DATA.professionName,
    scenario: prefs.scenario,
    plan: prefs.plan,
    demoPanelOpen: prefs.demoPanelOpen,
    reloadNoticeShown: false,
    modal: null,
    toasts: []
  };

  var mock = baseState(prefs.scenario);
  Object.keys(mock).forEach(function (key) { state[key] = mock[key]; });

  /* ------------------------------------------------------- */

  function subscribe(fn) { listeners.push(fn); }

  function notify() { listeners.forEach(function (fn) { fn(); }); }

  function update(fn) {
    fn(state);
    notify();
  }

  function get() { return state; }

  function setPref(key, value) {
    state[key] = value;
    savePrefs();
    notify();
  }

  function applyScenario(scenario) {
    state.scenario = scenario;
    var fresh = baseState(scenario === 'empty' ? 'empty' : 'filled');
    Object.keys(fresh).forEach(function (key) { state[key] = fresh[key]; });
    savePrefs();
    notify();
  }

  function resetDemo() {
    applyScenario(state.scenario);
  }

  /* Режим сервера: демо-данные заменяются данными базы. Настройки
     в localStorage не трогаются — они относятся к демо-режиму. */
  function replaceData(data) {
    var fresh = baseState('empty');
    Object.keys(fresh).forEach(function (key) { state[key] = fresh[key]; });
    state.resumes = data.resumes || [];
    state.vacancies = data.vacancies || [];
    state.preps = data.preps || [];
    state.activePrepId = state.preps.length ? state.preps[0].id : null;
    state.history = data.history || [];
  }

  /* Смена профессии пересобирает весь демонстрационный комплект:
     резюме, вакансию, требования, вопросы, сценарии интервью и подсказки. */
  function setProfession(idOrName) {
    var profile = Professions.find(idOrName);
    state.professionId = profile ? profile.id : '';
    applyProfession(profile ? profile.id : idOrName);
    state.professionName = DEMO_DATA.professionName;
    var fresh = baseState(state.scenario === 'empty' ? 'empty' : 'filled');
    Object.keys(fresh).forEach(function (key) { state[key] = fresh[key]; });
    savePrefs();
    notify();
    return DEMO_DATA.professionName;
  }

  /* -------- Доступ по демо-тарифу -------- */

  function planById(id) {
    for (var i = 0; i < DEMO_DATA.plans.length; i++) {
      if (DEMO_DATA.plans[i].id === id) return DEMO_DATA.plans[i];
    }
    return DEMO_DATA.plans[0];
  }

  function sectionAllowed(section) {
    return planById(state.plan).sections.indexOf(section) >= 0;
  }

  /* -------- Работа с сущностями -------- */

  function resumeById(id) {
    for (var i = 0; i < state.resumes.length; i++) {
      if (state.resumes[i].id === id) return state.resumes[i];
    }
    return null;
  }

  function vacancyById(id) {
    for (var i = 0; i < state.vacancies.length; i++) {
      if (state.vacancies[i].id === id) return state.vacancies[i];
    }
    return null;
  }

  function prepById(id) {
    for (var i = 0; i < state.preps.length; i++) {
      if (state.preps[i].id === id) return state.preps[i];
    }
    return null;
  }

  function activePrep() {
    return prepById(state.activePrepId);
  }

  /* Отметить подготовки устаревшими, если исходники изменились. */
  function markStale(kind, id, reason) {
    state.preps.forEach(function (prep) {
      if (kind === 'resume' && prep.resumeId !== id) return;
      if (kind === 'vacancy' && prep.vacancyId !== id) return;
      prep.stale = true;
      prep.staleReason = reason;
    });
  }

  function bumpResume(resume, reason) {
    resume.rev += 1;
    resume.updatedAt = nowLabel();
    markStale('resume', resume.id, reason);
  }

  function bumpVacancy(vacancy, reason) {
    vacancy.rev += 1;
    markStale('vacancy', vacancy.id, reason);
  }

  function rebuildPrep(prep) {
    var resume = resumeById(prep.resumeId);
    var vacancy = vacancyById(prep.vacancyId);
    prep.resumeRev = resume ? resume.rev : prep.resumeRev;
    prep.vacancyRev = vacancy ? vacancy.rev : prep.vacancyRev;
    prep.stale = false;
    prep.staleReason = '';
    prep.createdAt = nowLabel();
  }

  function nowLabel() {
    var d = new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function addHistory(what, route, prepId) {
    state.history.unshift({
      id: uid('h'),
      when: nowLabel(),
      what: what,
      prepId: prepId || null,
      route: route
    });
    if (state.history.length > 20) state.history.length = 20;
  }

  function createPrep(resumeId, vacancyId) {
    var prep = {
      id: uid('prep'),
      resumeId: resumeId,
      vacancyId: vacancyId,
      resumeRev: (resumeById(resumeId) || {}).rev || 1,
      vacancyRev: (vacancyById(vacancyId) || {}).rev || 1,
      createdAt: nowLabel(),
      stale: false,
      staleReason: '',
      answers: {},
      ready: {},
      chat: null,
      voice: null
    };
    state.preps.unshift(prep);
    state.activePrepId = prep.id;
    return prep;
  }

  return {
    get: get,
    update: update,
    subscribe: subscribe,
    notify: notify,
    setPref: setPref,
    applyScenario: applyScenario,
    setProfession: setProfession,
    replaceData: replaceData,
    resetDemo: resetDemo,
    emptyBuilder: emptyBuilder,
    planById: planById,
    sectionAllowed: sectionAllowed,
    resumeById: resumeById,
    vacancyById: vacancyById,
    prepById: prepById,
    activePrep: activePrep,
    bumpResume: bumpResume,
    bumpVacancy: bumpVacancy,
    rebuildPrep: rebuildPrep,
    createPrep: createPrep,
    addHistory: addHistory,
    nowLabel: nowLabel,
    uid: uid,
    clone: clone
  };
})();
