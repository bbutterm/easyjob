/* ============================================================
   Маршрутизация, отрисовка оболочки и обработка действий.
   Никаких сетевых запросов: макет работает полностью локально.
   ============================================================ */

(function () {
  'use strict';

  var esc = UI.esc;
  var root = document.getElementById('app');

  var NAV = [
    { section: 'overview', href: '#/overview', label: 'Обзор' },
    { section: 'resumes', href: '#/resumes', label: 'Мои резюме' },
    { section: 'vacancies', href: '#/vacancies', label: 'Вакансии и подготовка' },
    { section: 'interviews', href: '#/interviews', label: 'Тренировочные интервью' },
    { section: 'assistant', href: '#/assistant', label: 'Помощник на собеседовании' },
    { section: 'plans', href: '#/plans', label: 'Тарифы и лимиты' },
    { section: 'settings', href: '#/settings', label: 'Настройки и данные' }
  ];

  var PUBLIC_ROUTES = ['start', 'auth', 'onboarding'];

  /* ---------------- Работа с путями состояния ---------------- */

  var FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

  function setPath(path, value) {
    var parts = path.split('.');
    for (var k = 0; k < parts.length; k++) {
      if (FORBIDDEN_KEYS.indexOf(parts[k]) >= 0) return;
    }
    var target = Store.get();
    for (var i = 0; i < parts.length - 1; i++) {
      if (!Object.prototype.hasOwnProperty.call(target, parts[i]) || target[parts[i]] === null) return;
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
  }

  /* ---------------- Разбор маршрута ---------------- */

  function parseRoute() {
    var hash = window.location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/').filter(function (p) { return p.length > 0; });
    if (!parts.length) return { name: 'start', parts: [] };
    return { name: parts[0], parts: parts };
  }

  var KNOWN = ['start', 'auth', 'onboarding', 'overview', 'resumes', 'resume', 'vacancies',
    'vacancy', 'prep', 'interviews', 'assistant', 'plans', 'history', 'settings', 'privacy'];

  /* ---------------- Отрисовка ---------------- */

  function screenFor(route) {
    var parts = route.parts;
    switch (route.name) {
      case 'start': return ScreensCore.start();
      case 'auth': return ScreensCore.auth(parts[1] || 'login');
      case 'onboarding': return ScreensCore.onboarding();
      case 'overview': return ScreensCore.overview();
      case 'resumes': return ScreensCore.resumes();
      case 'resume':
        if (parts[1] === 'new') return ScreensCore.resumeWizard();
        if (parts[1] === 'upload') return ScreensCore.upload();
        return ScreensCore.resumeCard(parts[1]);
      case 'vacancies': return ScreensCore.vacancies();
      case 'vacancy': return ScreensCore.vacancyNew();
      case 'prep': {
        var prepId = parts[1];
        var view = parts[2] || 'match';
        if (view === 'questions') return ScreensPrep.questions(prepId);
        if (view === 'card') return ScreensPrep.card(prepId);
        if (view === 'interview') return ScreensPrep.interview(prepId);
        if (view === 'voice') return ScreensPrep.voice(prepId);
        return ScreensPrep.match(prepId);
      }
      case 'interviews': return ScreensPrep.interviews();
      case 'assistant': return ScreensPrep.assistant();
      case 'plans': return ScreensPrep.plans();
      case 'history': return ScreensPrep.history();
      case 'settings': return ScreensPrep.settings();
      case 'privacy': return ScreensCore.privacy();
      default: return '';
    }
  }

  function sectionForRoute(name) {
    if (name === 'resume') return 'resumes';
    if (name === 'vacancy') return 'vacancies';
    if (name === 'prep') return 'vacancies';
    if (name === 'history') return 'settings';
    if (name === 'privacy') return 'settings';
    return name;
  }

  function sidebar(activeSection) {
    var links = NAV.map(function (item) {
      var allowed = Store.sectionAllowed(item.section);
      return '<a class="navlink" href="' + item.href + '"'
        + (item.section === activeSection ? ' aria-current="page"' : '') + '>'
        + '<span>' + esc(item.label) + '</span>'
        + (allowed ? '' : '<span class="navlink__lock">по тарифу</span>')
        + '</a>';
    }).join('');

    return ''
      + '<nav class="sidebar" aria-label="Основная навигация">'
      + '  <div class="sidebar__brand">'
      + '    <b>Карьерный помощник</b>'
      + '    <span class="tag tag--demo">Демо-макет</span>'
      + '  </div>'
      + '  <div class="sidebar__nav">' + links + '</div>'
      + '  <div class="sidebar__foot">'
      + '    <a class="navlink" href="#/history"><span>История</span></a>'
      + '    <a class="navlink" href="#/privacy"><span>Обработка данных</span></a>'
      + '    <a class="navlink" href="#/start"><span>Выйти из демо</span></a>'
      + '  </div>'
      + '</nav>';
  }

  function topbar() {
    var state = Store.get();
    var prep = Store.activePrep();
    var ctx = prep
      ? '<b>' + esc(ScreensCore.prepTitle(prep)) + '</b>'
        + '<button type="button" class="btn btn--sm" data-act="prep:change-sources" data-id="'
        + esc(prep.id) + '">Заменить исходники</button>'
      : '<span class="muted">Подготовка не выбрана</span>';

    return ''
      + '<div class="topbar">'
      + '  <button type="button" class="btn btn--sm menu-btn" data-act="nav:toggle" aria-label="Открыть меню">☰</button>'
      + '  <div class="topbar__ctx">' + ctx + '</div>'
      + (Api.live.enabled
          ? (Api.live.ai && Api.live.ai.live
              ? '<span class="tag tag--ok"><span class="badge-full">Сервер · ' + esc(Api.live.ai.title) + '</span><span class="badge-short">Сервер</span></span>'
              : '<span class="tag tag--demo"><span class="badge-full">Сервер · заглушка модели</span><span class="badge-short">Заглушка</span></span>')
          : '<span class="tag tag--demo">'
            + '<span class="badge-full">Демо — ИИ и платежи не подключены</span>'
            + '<span class="badge-short">Демо</span>'
            + '</span>')
      + '  <button type="button" class="btn btn--sm" data-act="theme:toggle" aria-label="Переключить тему">'
      + (state.theme === 'dark' ? '☀' : '☾') + '</button>'
      + '</div>';
  }

  function demoPanel() {
    var state = Store.get();
    var open = state.demoPanelOpen;
    if (Api.live.enabled) {
      var ai = Api.live.ai || {};
      return ''
        + '<aside class="demo-panel' + (open ? '' : ' demo-panel--collapsed') + '" aria-label="Режим сервера">'
        + '  <button type="button" class="demo-panel__head" data-act="demopanel:toggle" aria-expanded="'
        + (open ? 'true' : 'false') + '"><span>Режим сервера</span><span aria-hidden="true">' + (open ? '▾' : '▴') + '</span></button>'
        + '  <div class="demo-panel__body">'
        + '    <p><b>' + esc(ai.title || ai.provider || '') + '</b>' + (ai.model ? ' · ' + esc(ai.model) : '')
        + (ai.live ? '' : ' — заглушка, ключ не задан') + '</p>'
        + '    <p>Данные хранятся на сервере' + (ai.dataRegion === 'ru' ? ' и обрабатываются в РФ' : '') + '.</p>'
        + (Api.live.limits ? '<p>Подготовок сегодня: ' + esc(Api.live.limits.usedToday) + ' из '
            + esc(Api.live.limits.freePerDay) + '.</p>' : '')
        + '    <label class="field" for="demo-plan"><span class="field__label">Демо-тариф</span>'
        + '      <select id="demo-plan" data-change-act="demo:plan">'
        + DEMO_DATA.plans.map(function (p) {
            return '<option value="' + esc(p.id) + '"' + (p.id === state.plan ? ' selected' : '') + '>' + esc(p.name) + '</option>';
          }).join('')
        + '      </select></label>'
        + '  </div>'
        + '</aside>';
    }
    var options = [
      { value: 'empty', label: 'Пусто' },
      { value: 'filled', label: 'Заполнено' },
      { value: 'loading', label: 'Загрузка' },
      { value: 'error', label: 'Ошибка' },
      { value: 'limit', label: 'Лимит' }
    ];
    return ''
      + '<aside class="demo-panel' + (open ? '' : ' demo-panel--collapsed') + '" aria-label="Состояния демо">'
      + '  <button type="button" class="demo-panel__head" data-act="demopanel:toggle" aria-expanded="'
      + (open ? 'true' : 'false') + '">'
      + '    <span>Состояния демо</span><span aria-hidden="true">' + (open ? '▾' : '▴') + '</span>'
      + '  </button>'
      + '  <div class="demo-panel__body">'
      + '    <label class="field" for="demo-scenario"><span class="field__label">Сценарий</span>'
      + '      <select id="demo-scenario" data-change-act="demo:scenario">'
      + options.map(function (o) {
          return '<option value="' + o.value + '"' + (o.value === state.scenario ? ' selected' : '') + '>'
            + esc(o.label) + '</option>';
        }).join('')
      + '      </select></label>'
      + '    <label class="field" for="demo-plan"><span class="field__label">Демо-тариф</span>'
      + '      <select id="demo-plan" data-change-act="demo:plan">'
      + DEMO_DATA.plans.map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (p.id === state.plan ? ' selected' : '') + '>'
            + esc(p.name) + '</option>';
        }).join('')
      + '      </select></label>'
      + '    <label class="field" for="demo-profession"><span class="field__label">Профессия демо-набора</span>'
      + '      <select id="demo-profession" data-change-act="demo:profession">'
      + Professions.list().map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (p.id === state.professionId ? ' selected' : '') + '>'
            + esc(p.name) + '</option>';
        }).join('')
      + (state.professionId ? '' : '<option value="" selected>' + esc(state.professionName) + ' (своя)</option>')
      + '      </select></label>'
      + '    <button type="button" class="btn btn--sm btn--block" data-act="data:reset">Сбросить демо</button>'
      + '    <p style="margin-top:8px">Панель влияет только на демонстрацию и не является частью продукта.</p>'
      + '  </div>'
      + '</aside>';
  }

  function render() {
    var state = Store.get();
    var route = parseRoute();

    document.documentElement.setAttribute('data-theme', state.theme);

    if (KNOWN.indexOf(route.name) < 0) {
      window.location.hash = '#/overview';
      return;
    }

    var focusId = document.activeElement ? document.activeElement.id : null;
    var selection = null;
    if (document.activeElement && typeof document.activeElement.selectionStart === 'number') {
      selection = document.activeElement.selectionStart;
    }
    var chatLog = document.getElementById('chat-log');
    var chatAtBottom = chatLog ? true : false;

    var html;
    if (PUBLIC_ROUTES.indexOf(route.name) >= 0) {
      html = screenFor(route);
    } else {
      var section = sectionForRoute(route.name);
      var content = Store.sectionAllowed(section) || section === 'settings' || section === 'plans'
        ? screenFor(route)
        : ScreensPrep.locked(navLabel(section), section === 'assistant' ? 'assistant' : 'training');
      html = ''
        + '<div class="shell">'
        + sidebar(section)
        + '  <div class="main">' + topbar()
        + '    <main class="content" id="main" tabindex="-1">'
        + (state.pending ? '<div class="note note--info" role="status" aria-live="polite" style="margin-bottom:16px"><div>'
            + '<span class="dots" aria-hidden="true"><span></span><span></span><span></span></span> ' + esc(state.pending) + '</div></div>' : '')
        + content + '</main>'
        + '  </div>'
        + '</div>'
        + (document.body.getAttribute('data-nav') === 'open'
            ? '<button type="button" class="nav-scrim" data-act="nav:close" aria-label="Закрыть меню"></button>' : '')
        + demoPanel();
    }

    root.innerHTML = html + UI.renderModal(state.modal) + UI.renderToasts(state.toasts);

    if (state.modal) UI.trapFocus(root);
    if (focusId && !state.modal) {
      var node = document.getElementById(focusId);
      if (node && typeof node.focus === 'function') {
        node.focus();
        if (selection !== null && typeof node.setSelectionRange === 'function') {
          try { node.setSelectionRange(selection, selection); } catch (e) { /* не текстовое поле */ }
        }
      }
    }
    var newLog = document.getElementById('chat-log');
    if (newLog && chatAtBottom) newLog.scrollTop = newLog.scrollHeight;
    bindFileInput();
  }

  function navLabel(section) {
    for (var i = 0; i < NAV.length; i++) {
      if (NAV[i].section === section) return NAV[i].label;
    }
    return 'Раздел';
  }

  /* ---------------- Локальный выбор файла ---------------- */

  function bindFileInput() {
    var input = document.getElementById('file-input');
    var zone = document.getElementById('dropzone');
    if (!input) return;

    input.addEventListener('change', function () {
      if (input.files && input.files[0]) {
        Store.update(function (s) { s.upload.fileName = input.files[0].name; });
        UI.toast('Файл выбран локально. Он не отправляется и не читается макетом.');
      }
    });

    if (!zone) return;
    ['dragenter', 'dragover'].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        zone.classList.add('dropzone--over');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        zone.classList.remove('dropzone--over');
      });
    });
    zone.addEventListener('drop', function (event) {
      var files = event.dataTransfer && event.dataTransfer.files;
      if (files && files[0]) {
        Store.update(function (s) { s.upload.fileName = files[0].name; });
        UI.toast('Файл выбран локально. Он не отправляется и не читается макетом.');
      }
    });
  }

  /* ---------------- Действия ---------------- */

  function go(hash) {
    if (window.location.hash === hash) render();
    else window.location.hash = hash;
  }


  /* ============================================================
     Режим сервера: действия, которые ходят в API.
     В демо-режиме (файл открыт напрямую) не вызываются.
     ============================================================ */

  function setPending(text) {
    Store.get().pending = text || null;
    Store.notify();
  }

  function liveFail(e) {
    setPending(null);
    if (e && e.status === 429) {
      var limits = e.extra && e.extra.limits;
      UI.openModal({
        title: 'Лимит на сегодня исчерпан',
        body: '<p>' + esc(e.message) + '</p>'
          + (limits ? '<p class="muted">Бесплатно: ' + esc(limits.freePerDay) + ' в день. Использовано: '
            + esc(limits.usedToday) + '.</p>' : '')
          + '<p>Оплата пока не подключена. Возвращайтесь завтра или откройте существующую подготовку.</p>'
      });
      return;
    }
    UI.toast(e && e.message ? e.message : 'Ошибка сервера');
  }

  function findPrepBySid(sid) {
    var list = Store.get().preps;
    for (var i = 0; i < list.length; i++) if (list[i].id === sid || list[i].serverId === sid) return list[i];
    return null;
  }

  async function liveHydrate() {
    var me = await Api.request('GET', '/api/me');
    Api.live.limits = me.limits;
    Api.live.professions = me.professions;
    var resumes = [];
    for (var i = 0; i < me.resumes.length; i++) {
      var full = await Api.request('GET', '/api/resumes/' + me.resumes[i].id);
      resumes.push(Api.resumeFromServer(full));
    }
    var vacancies = [];
    var seen = {};
    me.preps.forEach(function (p) {
      if (p.vacancy && !seen[p.vacancy.id]) {
        seen[p.vacancy.id] = true;
        vacancies.push({ id: p.vacancy.id, serverId: p.vacancy.id, demo: false, rev: p.vacancy.rev,
          title: p.vacancy.title, company: p.vacancy.company || '', location: '', text: '',
          requirements: p.vacancy.requirements || [] });
      }
    });
    Store.replaceData({ resumes: resumes, vacancies: vacancies, preps: me.preps.map(Api.prepFromServer) });
  }

  async function liveEnsureResume(resume) {
    if (resume.serverId) return resume.serverId;
    var created = await Api.request('POST', '/api/resumes', Api.resumeToServer(resume));
    resume.serverId = created.id;
    resume.rev = created.rev;
    resume.demo = false;
    return created.id;
  }

  async function liveCreatePrep(draft) {
    var resume = Store.resumeById(draft.resumeId);
    if (!resume) { UI.toast('Выберите резюме.'); return; }
    try {
      setPending('Отправляю резюме и вакансию на сервер…');
      var resumeSid = await liveEnsureResume(resume);
      var vacancy = Api.vacancyFromServer(await Api.request('POST', '/api/vacancies', {
        title: draft.title, company: draft.company || '', rawText: draft.text
      }));
      setPending('Сопоставляю резюме с требованиями…');
      var prep = Api.prepFromServer(await Api.request('POST', '/api/preps', {
        resumeId: resumeSid, vacancyId: vacancy.id, profession: resume.profession || draft.title
      }));
      prep.resumeId = resume.id;
      Store.update(function (s) {
        s.vacancies.unshift(vacancy);
        s.preps.unshift(prep);
        s.activePrepId = prep.id;
        s.vacancyDraft = { title: '', company: '', text: '', resumeId: '', url: '' };
        s.pending = null;
        Store.addHistory('Создана подготовка по вакансии', '#/prep/' + prep.id + '/match', prep.id);
      });
      go('#/prep/' + prep.id + '/match');
    } catch (e) { liveFail(e); }
  }

  async function liveRebuild(prep) {
    try {
      setPending('Пересобираю сопоставление…');
      var fresh = Api.prepFromServer(await Api.request('POST', '/api/preps/' + prep.serverId + '/rebuild'));
      Store.update(function () {
        prep.match = fresh.match; prep.questions = null; prep.card = null;
        prep.stale = false; prep.staleReason = ''; prep.resumeRev = fresh.resumeRev; prep.vacancyRev = fresh.vacancyRev;
        Store.get().pending = null;
      });
      UI.toast('Сопоставление пересобрано для текущих версий.');
    } catch (e) { liveFail(e); }
  }

  async function liveGenerateQuestions(prep) {
    try {
      setPending('Подбираю вопросы…');
      var data = await Api.request('POST', '/api/preps/' + prep.serverId + '/questions');
      Store.update(function () { prep.questions = data.questions; Store.get().pending = null; });
    } catch (e) { liveFail(e); }
  }

  var answersTimer = null;
  function liveScheduleAnswers(prep, immediate) {
    if (!prep || !prep.serverId) return;
    if (answersTimer) clearTimeout(answersTimer);
    var save = function () {
      answersTimer = null;
      Api.request('PUT', '/api/preps/' + prep.serverId + '/answers', { answers: prep.answers, ready: prep.ready })
        .catch(function (e) { UI.toast('Ответы не сохранились: ' + e.message); });
    };
    if (immediate) save(); else answersTimer = setTimeout(save, 900);
  }

  async function liveStartChat(prep) {
    try {
      setPending('Интервьюер готовит первый вопрос…');
      var first = await Api.request('POST', '/api/preps/' + prep.serverId + '/interviews');
      Store.update(function () {
        var chat = ScreensPrep.ensureChat(prep);
        chat.started = true; chat.index = 0; chat.finished = false; chat.failed = false;
        chat.interviewId = first.interviewId; chat.summary = null; chat.partial = ''; chat.status = '';
        chat.context = first.context || null; chat.lastTurn = null;
        chat.messages = [
          { who: 'system', text: Api.live.ai && Api.live.ai.live
            ? 'Интервьюер — модель. Ответы сохраняются на сервере.'
            : 'Сервер работает на заглушке: реплики фиксированные, ответы сохраняются.' },
          { who: 'bot', text: first.turn.text }
        ];
        Store.get().pending = null;
      });
    } catch (e) { liveFail(e); }
  }

  /* Идентификатор реплики от клиента: повтор после обрыва сети уходит с
     тем же id, и сервер не создаёт дубля, а отдаёт прежний ответ. */
  function newTurnId() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function applyTurnResult(chat, done) {
    chat.pending = false; chat.partial = ''; chat.status = ''; chat.index += 1;
    chat.lastTurn = null;
    chat.context = done.context || null;
    chat.messages.push({ who: 'bot', text: done.turn.text });
  }

  async function liveSendChat(prep) {
    var chat = prep.chat;
    var text = String(chat.draft || '').trim();
    if (!text) { UI.toast('Введите ответ, чтобы отправить его.'); return; }
    var turn = { text: text, clientTurnId: newTurnId() };
    Store.update(function () {
      chat.messages.push({ who: 'user', text: text });
      chat.draft = ''; chat.failed = false; chat.pending = true; chat.partial = ''; chat.status = '';
      chat.lastTurn = turn;
    });
    try {
      var done = await Api.stream('/api/interviews/' + chat.interviewId + '/turns', turn, function (delta) {
        chat.partial += delta; chat.status = '';
        Store.notify();
      }, function (status) {
        chat.status = status;
        Store.notify();
      });
      Store.update(function () { applyTurnResult(chat, done); });
    } catch (e) {
      Store.update(function () { chat.pending = false; chat.partial = ''; chat.status = ''; chat.failed = true; chat.failError = e.message; });
    }
  }

  /* Повтор: та же реплика с тем же clientTurnId. Если она уже сохранена,
     сервер отдаст готовый ответ интервьюера или сгенерирует недостающий;
     без сохранённой реплики — просто продолжение. */
  async function liveRetryChat(prep) {
    var chat = prep.chat;
    Store.update(function () { chat.failed = false; chat.pending = true; });
    try {
      var done = chat.lastTurn
        ? await Api.request('POST', '/api/interviews/' + chat.interviewId + '/turns', chat.lastTurn)
        : await Api.request('POST', '/api/interviews/' + chat.interviewId + '/continue');
      Store.update(function () { applyTurnResult(chat, done); });
    } catch (e) {
      Store.update(function () { chat.pending = false; chat.failed = true; chat.failError = e.message; });
    }
  }

  async function liveFinishChat(prep) {
    var chat = prep.chat;
    try {
      setPending('Готовлю итог интервью…');
      var data = await Api.request('POST', '/api/interviews/' + chat.interviewId + '/finish');
      Store.update(function () {
        chat.summary = data.summary; chat.finished = true;
        Store.get().pending = null;
        Store.addHistory('Текстовое пробное интервью', '#/prep/' + prep.id + '/interview', prep.id);
      });
    } catch (e) { liveFail(e); }
  }

  async function liveReview() {
    var up = Store.get().upload;
    var text = String(up.text || '').trim();
    if (text.length < 40) { UI.toast('Вставьте текст резюме — хотя бы несколько строк.'); return; }
    try {
      setPending('Отправляю резюме…');
      var created = await Api.request('POST', '/api/resumes', {
        title: 'Резюме из текста ' + Api.label(), data: { rawText: text }
      });
      setPending('Разбираю резюме…');
      var data = await Api.request('POST', '/api/resumes/' + created.id + '/review');
      Store.update(function (s) {
        s.upload.report = data.review; s.upload.decisions = {}; s.upload.analysisShown = true;
        s.upload.serverResume = Api.resumeFromServer(Object.assign({}, created, { review: data.review }));
        s.pending = null;
      });
    } catch (e) { liveFail(e); }
  }

  async function liveSaveResume(resume) {
    try {
      setPending('Сохраняю резюме…');
      await liveEnsureResume(resume);
      Store.update(function (s) { s.pending = null; });
    } catch (e) { liveFail(e); }
  }

  function dispatch(act, data, element) {
    var state = Store.get();

    if (act.indexOf('go:') === 0) {
      var target = act.slice(3);
      if (data.prep) state.activePrepId = data.prep;
      go(target);
      return;
    }

    switch (act) {
      /* -------- Оболочка -------- */
      case 'nav:toggle':
        document.body.setAttribute('data-nav',
          document.body.getAttribute('data-nav') === 'open' ? 'closed' : 'open');
        render();
        return;
      case 'nav:close':
        document.body.setAttribute('data-nav', 'closed');
        render();
        return;
      case 'theme:toggle':
        Store.setPref('theme', state.theme === 'dark' ? 'light' : 'dark');
        return;
      case 'demopanel:toggle':
        Store.setPref('demoPanelOpen', !state.demoPanelOpen);
        return;
      case 'rerender':
        Store.notify();
        return;

      /* -------- Диалоги -------- */
      case 'modal:backdrop':
        if (element && element.classList.contains('modal-backdrop')) UI.closeModal();
        return;
      case 'modal:close':
        UI.closeModal();
        return;
      case 'modal:confirm': {
        var modal = state.modal;
        UI.closeModal();
        if (modal && modal.confirmAct) dispatch(modal.confirmAct, modal.confirmData || {});
        return;
      }

      /* -------- Демо-режим -------- */
      case 'demo:example':
        if (Api.live.enabled) { go('#/overview'); return; }
        Store.applyScenario('filled');
        go('#/overview');
        UI.toast('Открыт пример заполненного демо.');
        return;
      case 'demo:scenario-empty':
        Store.applyScenario('empty');
        UI.toast('Показано пустое состояние.');
        return;
      case 'demo:scenario-filled':
        Store.applyScenario('filled');
        UI.toast('Показано заполненное состояние.');
        return;
      case 'demo:scenario-limit':
        Store.get().scenario = 'limit';
        Store.setPref('scenario', 'limit');
        go('#/vacancies');
        return;
      case 'data:reset':
        Store.resetDemo();
        UI.toast('Демо сброшено к исходному состоянию.');
        return;
      case 'data:delete-server':
        UI.confirm({
          title: 'Удалить все данные с сервера?',
          body: '<p>Резюме, вакансии, подготовки и переписка интервью будут удалены немедленно и без возможности '
            + 'восстановления. Сессия завершится.</p>',
          act: 'data:delete-server-confirm', confirmLabel: 'Удалить всё', danger: true
        });
        return;
      case 'data:delete-server-confirm':
        Api.request('DELETE', '/api/me').then(function () {
          window.location.hash = '#/start';
          window.location.reload();
        }).catch(function (e) { UI.toast('Не удалось удалить: ' + e.message); });
        return;
      case 'data:clear-answers':
        UI.confirm({
          title: 'Удалить ответы на вопросы?',
          body: '<p>Ответы, введённые в этом сеансе, будут удалены из памяти страницы. Действие нельзя отменить.</p>',
          act: 'data:clear-answers-confirm', confirmLabel: 'Удалить', danger: true
        });
        return;
      case 'data:clear-answers-confirm':
        Store.update(function (s) {
          s.preps.forEach(function (p) { p.answers = {}; p.ready = {}; });
        });
        UI.toast('Ответы удалены.');
        return;
      case 'data:clear-history':
        UI.confirm({
          title: 'Очистить историю?',
          body: '<p>Записи истории этого сеанса будут удалены.</p>',
          act: 'data:clear-history-confirm', confirmLabel: 'Очистить', danger: true
        });
        return;
      case 'data:clear-history-confirm':
        Store.update(function (s) { s.history = []; });
        UI.toast('История очищена.');
        return;

      /* -------- Мастер резюме -------- */
      case 'builder:goto':
        Store.update(function (s) { s.builder.step = Number(data.step); s.builder.errors = {}; });
        return;
      case 'builder:prev':
        Store.update(function (s) { if (s.builder.step > 0) s.builder.step -= 1; });
        return;
      case 'builder:next': {
        var b = state.builder;
        var errors = {};
        if (b.step === 0 && !String(b.data.profession).trim()) {
          errors.profession = 'Укажите желаемую профессию — это обязательное поле.';
        }
        if (b.step === 1) {
          if (!b.data.experience.length) {
            errors.experience = 'Добавьте хотя бы одно место работы или вернитесь и опишите опыт позже.';
          } else {
            b.data.experience.forEach(function (item, index) {
              if (!String(item.role).trim()) errors['exp' + index] = 'Укажите должность.';
            });
          }
        }
        if (b.step === 2 && !String(b.data.skills).trim()) {
          errors.skills = 'Перечислите хотя бы один навык.';
        }
        Store.update(function (s) {
          s.builder.errors = errors;
          if (!Object.keys(errors).length && s.builder.step < 4) s.builder.step += 1;
        });
        if (Object.keys(errors).length) UI.toast('Проверьте обязательные поля.');
        return;
      }
      case 'builder:exp-add':
        Store.update(function (s) {
          s.builder.data.experience.push({ role: '', company: '', period: '', details: '' });
        });
        return;
      case 'builder:exp-remove':
        Store.update(function (s) { s.builder.data.experience.splice(Number(data.index), 1); });
        return;
      case 'builder:edu-add':
        Store.update(function (s) {
          s.builder.data.education.push({ place: '', program: '', period: '' });
        });
        return;
      case 'builder:edu-remove':
        Store.update(function (s) { s.builder.data.education.splice(Number(data.index), 1); });
        return;
      case 'builder:build':
        Store.update(function (s) { s.builder.built = 'loading'; });
        window.setTimeout(function () {
          Store.update(function (s) { s.builder.built = true; });
          UI.toast('Демонстрационная сборка завершена.');
        }, 900);
        return;
      case 'builder:edit':
        Store.update(function (s) { s.builder.built = null; s.builder.step = 0; });
        return;
      case 'builder:save': {
        var data2 = state.builder.data;
        var resume = {
          id: Store.uid('res'),
          title: (data2.profession || 'Резюме') + ' — из мастера',
          source: 'created',
          demo: false,
          rev: 1,
          updatedAt: Store.nowLabel(),
          profession: data2.profession,
          wishes: data2.wishes,
          summary: data2.summary,
          experience: Store.clone(data2.experience),
          skills: ScreensCore.splitLines(data2.skills),
          achievements: ScreensCore.splitLines(data2.achievements),
          education: Store.clone(data2.education)
        };
        var wanted = String(data2.profession || '').trim();
        var matched = Professions.find(wanted);
        /* Демо-комплект пересобирается под введённую профессию: для профессии из
           библиотеки берётся готовый набор, для любой другой — общий шаблон. */
        if (wanted && !Api.live.enabled) Store.setProfession(matched ? matched.id : wanted);
        Store.update(function (s) {
          s.resumes.unshift(resume);
          s.builder = Store.emptyBuilder();
          s.vacancyDraft.resumeId = resume.id;
          Store.addHistory('Резюме собрано в мастере', '#/resume/' + resume.id, null);
        });
        if (Api.live.enabled) {
          liveSaveResume(resume).then(function () { go('#/vacancy/new'); });
          return;
        }
        UI.toast(matched || !wanted
          ? 'Резюме сохранено. Демо-набор подобран для профессии «' + DEMO_DATA.professionName + '».'
          : 'Резюме сохранено. Для профессии «' + wanted + '» собран общий демонстрационный комплект.');
        go('#/vacancy/new');
        return;
      }

      /* -------- Загрузка резюме -------- */
      case 'upload:pick': {
        var input = document.getElementById('file-input');
        if (input) input.click();
        return;
      }
      case 'upload:clear':
        Store.update(function (s) { s.upload.fileName = ''; });
        UI.toast('Выбор файла удалён.');
        return;
      case 'upload:review':
        if (!state.pending) liveReview();
        return;
      case 'upload:show-analysis':
        Store.update(function (s) { s.upload.analysisShown = true; s.upload.report = null; s.upload.decisions = {}; });
        UI.toast('Открыт демонстрационный отчёт на подготовленном примере.');
        return;
      case 'upload:save': {
        if (Api.live.enabled && state.upload.serverResume) {
          var saved = state.upload.serverResume;
          Store.update(function (s) {
            if (!Store.resumeById(saved.id)) s.resumes.unshift(saved);
            s.vacancyDraft.resumeId = saved.id;
            Store.addHistory('Резюме разобрано и сохранено', '#/resume/' + saved.id, null);
          });
          UI.toast('Резюме сохранено на сервере.');
          go('#/vacancy/new');
          return;
        }
        var accepted = Object.keys(state.upload.decisions).filter(function (k) {
          return state.upload.decisions[k] === 'accepted';
        });
        var copy = Store.clone(DEMO_DATA.resumeUploaded);
        copy.id = Store.uid('res');
        copy.title = 'Резюме из файла — версия ' + (accepted.length ? 'с правками' : 'без правок');
        copy.updatedAt = Store.nowLabel();
        Store.update(function (s) {
          s.resumes.unshift(copy);
          Store.addHistory('Сохранена версия резюме после разбора', '#/resume/' + copy.id, null);
        });
        UI.toast('Версия сохранена в списке резюме.');
        go('#/resumes');
        return;
      }
      case 'sug:accept':
        Store.update(function (s) { s.upload.decisions[data.id] = 'accepted'; });
        return;
      case 'sug:reject':
        Store.update(function (s) { s.upload.decisions[data.id] = 'rejected'; });
        return;

      /* -------- Резюме -------- */
      case 'resume:rename': {
        var r = Store.resumeById(data.id);
        if (!r) return;
        state.renameDraft = r.title;
        state.renameId = r.id;
        UI.openModal({
          title: 'Переименовать резюме',
          body: UI.field({ id: 'rename-input', label: 'Название', model: 'renameDraft', value: r.title }),
          confirmAct: 'resume:rename-confirm', confirmLabel: 'Сохранить'
        });
        return;
      }
      case 'resume:rename-confirm':
        Store.update(function (s) {
          var target = Store.resumeById(s.renameId);
          if (target && String(s.renameDraft).trim()) {
            target.title = String(s.renameDraft).trim();
            if (Api.live.enabled && target.serverId) {
              Api.request('PUT', '/api/resumes/' + target.serverId, { title: target.title })
                .catch(function (e) { UI.toast(e.message); });
            }
          }
        });
        UI.toast('Название обновлено.');
        return;
      case 'resume:delete': {
        var res = Store.resumeById(data.id);
        if (!res) return;
        UI.confirm({
          title: 'Удалить резюме?',
          body: '<p>Версия «' + esc(res.title) + '» будет удалена из этого сеанса макета. '
            + 'Связанные подготовки останутся, но будут отмечены как требующие новых исходников.</p>',
          act: 'resume:delete-confirm', data: { id: res.id }, confirmLabel: 'Удалить', danger: true
        });
        return;
      }
      case 'resume:delete-confirm': {
        var gone = Store.resumeById(data.id);
        if (gone && Api.live.enabled && gone.serverId) {
          Api.request('DELETE', '/api/resumes/' + gone.serverId).catch(function (e) { UI.toast(e.message); });
        }
      }
        Store.update(function (s) {
          s.resumes = s.resumes.filter(function (item) { return item.id !== data.id; });
          s.preps.forEach(function (p) {
            if (p.resumeId === data.id) {
              p.stale = true;
              p.staleReason = 'Резюме, на котором был построен отчёт, удалено.';
            }
          });
        });
        UI.toast('Резюме удалено.');
        return;
      case 'resume:tweak': {
        var target2 = Store.resumeById(data.id);
        if (!target2) return;
        Store.update(function () {
          target2.summary = (target2.summary || '') + ' Уточнение внесено ' + Store.nowLabel() + '.';
          Store.bumpResume(target2, 'Резюме изменено после анализа.');
        });
        if (Api.live.enabled && target2.serverId) {
          Api.request('PUT', '/api/resumes/' + target2.serverId, Api.resumeToServer(target2))
            .then(function (r) { Store.update(function () { target2.rev = r.rev; }); })
            .catch(function (e) { UI.toast(e.message); });
        }
        UI.toast('Версия резюме повышена. Связанные подготовки отмечены как устаревшие.');
        return;
      }
      case 'resume:use':
        Store.update(function (s) { s.vacancyDraft.resumeId = data.id; });
        go('#/vacancy/new');
        return;

      /* -------- Вакансии и подготовки -------- */
      case 'vacancy:example':
        Store.update(function (s) {
          s.vacancyDraft.title = DEMO_DATA.vacancy.title;
          s.vacancyDraft.company = DEMO_DATA.vacancy.company;
          s.vacancyDraft.text = DEMO_DATA.vacancy.text;
          if (!s.vacancyDraft.resumeId && s.resumes.length) s.vacancyDraft.resumeId = s.resumes[0].id;
        });
        UI.toast('Подставлен пример вакансии из комплекта макета.');
        return;
      case 'vacancy:create': {
        var draft = state.vacancyDraft;
        if (!draft.title || !draft.text || !draft.resumeId) {
          UI.toast('Заполните должность, текст вакансии и выберите резюме.');
          return;
        }
        if (Api.live.enabled) { if (!state.pending) liveCreatePrep(draft); return; }
        var vacancy = {
          id: Store.uid('vac'),
          demo: true,
          rev: 1,
          title: draft.title,
          company: draft.company || 'Компания не указана',
          location: '',
          text: draft.text,
          requirements: Store.clone(DEMO_DATA.vacancy.requirements)
        };
        var prep;
        Store.update(function (s) {
          s.vacancies.unshift(vacancy);
          prep = Store.createPrep(draft.resumeId, vacancy.id);
          Store.addHistory('Создана подготовка по вакансии', '#/prep/' + prep.id + '/match', prep.id);
          s.vacancyDraft = { title: '', company: '', text: '', resumeId: '', url: '' };
        });
        UI.toast('Подготовка создана. Сопоставление — демонстрационное.');
        go('#/prep/' + prep.id + '/match');
        return;
      }
      case 'prep:open':
        Store.update(function (s) { s.activePrepId = data.id; });
        go('#/prep/' + data.id + '/match');
        return;
      case 'prep:select':
        Store.update(function (s) { s.activePrepId = data.value; });
        return;
      case 'prep:rebuild': {
        var prep2 = Store.prepById(data.id);
        if (!prep2) return;
        if (prep2.live) { if (!state.pending) liveRebuild(prep2); return; }
        Store.update(function () { Store.rebuildPrep(prep2); });
        UI.toast('Демонстрационный отчёт пересобран для текущих исходников.');
        return;
      }
      case 'prep:delete':
        UI.confirm({
          title: 'Удалить подготовку?',
          body: '<p>Связанные вопросы, ответы и переписка тренировки будут удалены из этого сеанса.</p>',
          act: 'prep:delete-confirm', data: { id: data.id }, confirmLabel: 'Удалить', danger: true
        });
        return;
      case 'prep:delete-confirm': {
        var doomed = Store.prepById(data.id);
        if (doomed && doomed.live) {
          Api.request('DELETE', '/api/preps/' + doomed.serverId).catch(function (e) { UI.toast(e.message); });
        }
      }
        Store.update(function (s) {
          s.preps = s.preps.filter(function (p) { return p.id !== data.id; });
          if (s.activePrepId === data.id) s.activePrepId = s.preps.length ? s.preps[0].id : null;
        });
        UI.toast('Подготовка удалена.');
        return;
      case 'prep:change-sources': {
        var prep3 = Store.prepById(data.id) || Store.activePrep();
        if (!prep3) return;
        state.sourcesPrepId = prep3.id;
        UI.openModal({
          title: 'Изменить исходники подготовки',
          body: sourcesModalBody(prep3),
          closeLabel: 'Готово'
        });
        return;
      }
      case 'prep:set-resume': {
        var prep4 = Store.prepById(state.sourcesPrepId);
        if (!prep4 || prep4.resumeId === data.value) return;
        Store.update(function () {
          prep4.resumeId = data.value;
          prep4.stale = true;
          prep4.staleReason = 'Выбрано другое резюме после демонстрационного анализа.';
          Store.get().modal.body = sourcesModalBody(prep4);
        });
        UI.toast('Резюме заменено. Прежний отчёт помечен как устаревший.');
        return;
      }
      case 'prep:set-vacancy': {
        var prep5 = Store.prepById(state.sourcesPrepId);
        if (!prep5 || prep5.vacancyId === data.value) return;
        Store.update(function () {
          prep5.vacancyId = data.value;
          prep5.stale = true;
          prep5.staleReason = 'Выбрана другая вакансия после демонстрационного анализа.';
          Store.get().modal.body = sourcesModalBody(prep5);
        });
        UI.toast('Вакансия заменена. Прежний отчёт помечен как устаревший.');
        return;
      }

      /* -------- Сопоставление и вопросы -------- */
      case 'req:toggle':
        Store.update(function (s) {
          s.openRequirement = s.openRequirement === data.id ? '' : data.id;
        });
        return;
      case 'q:hint':
        Store.update(function (s) {
          s.qOpenHints = s.qOpenHints || {};
          s.qOpenHints[data.id] = !s.qOpenHints[data.id];
        });
        return;
      case 'q:ready': {
        var prep6 = Store.activePrep();
        if (!prep6) return;
        Store.update(function () { prep6.ready[data.id] = !prep6.ready[data.id]; });
        if (prep6.live) liveScheduleAnswers(prep6, true);
        return;
      }
      case 'questions:generate': {
        var prepQ = Store.prepById(data.id) || Store.activePrep();
        if (prepQ && prepQ.live && !state.pending) liveGenerateQuestions(prepQ);
        return;
      }
      case 'q:filter-topic':
        Store.update(function (s) { s.qFilterTopic = data.value; });
        return;
      case 'q:filter-ready':
        Store.update(function (s) { s.qFilterReady = data.value; });
        return;
      case 'q:filter-reset':
        Store.update(function (s) { s.qFilterTopic = 'all'; s.qFilterReady = 'all'; });
        return;

      /* -------- Текстовое интервью -------- */
      case 'chat:start': {
        var prep7 = Store.activePrep();
        if (!prep7) return;
        if (prep7.live) { if (!state.pending) liveStartChat(prep7); return; }
        Store.update(function () {
          var chat = ScreensPrep.ensureChat(prep7);
          chat.started = true;
          chat.index = 0;
          chat.finished = false;
          chat.failed = false;
          chat.messages = [
            { who: 'system', text: 'Демонстрационный сценарий из ' + DEMO_DATA.interviewScript.length
              + ' вопросов. Ответы не оцениваются.' },
            { who: 'bot', text: DEMO_DATA.interviewScript[0].ask }
          ];
        });
        return;
      }
      case 'chat:fail': {
        var prep8 = Store.activePrep();
        if (!prep8 || !prep8.chat) return;
        Store.update(function () { prep8.chat.failed = true; prep8.chat.pending = false; });
        return;
      }
      case 'chat:retry': {
        var prep9 = Store.activePrep();
        if (!prep9 || !prep9.chat) return;
        if (prep9.live) { liveRetryChat(prep9); return; }
        Store.update(function () { prep9.chat.failed = false; });
        UI.toast('Демонстрационная отправка повторена.');
        return;
      }
      case 'chat:send': {
        var prep10 = Store.activePrep();
        if (!prep10 || !prep10.chat) return;
        if (prep10.live) { if (!prep10.chat.pending) liveSendChat(prep10); return; }
        var chat = prep10.chat;
        if (!String(chat.draft || '').trim()) {
          UI.toast('Введите ответ, чтобы отправить его в переписку.');
          return;
        }
        Store.update(function () {
          chat.messages.push({ who: 'user', text: chat.draft });
          chat.draft = '';
          chat.failed = false;
          chat.pending = true;
        });
        window.setTimeout(function () {
          Store.update(function () {
            chat.pending = false;
            var current = DEMO_DATA.interviewScript[chat.index];
            if (current) chat.messages.push({ who: 'bot', text: current.react });
            chat.index += 1;
            var next = DEMO_DATA.interviewScript[chat.index];
            if (next) {
              chat.messages.push({ who: 'bot', text: next.ask });
            } else {
              chat.messages.push({ who: 'system', text: 'Сценарий закончился. Можно завершить интервью и открыть итог.' });
            }
          });
        }, 800);
        return;
      }
      case 'chat:exit':
        UI.confirm({
          title: 'Завершить интервью?',
          body: '<p>Переписка останется в этом сеансе, откроется демонстрационный итог.</p>',
          act: 'chat:finish', confirmLabel: 'Завершить'
        });
        return;
      case 'chat:finish': {
        var prep11 = Store.activePrep();
        if (!prep11 || !prep11.chat) return;
        if (prep11.live) { if (!state.pending) liveFinishChat(prep11); return; }
        Store.update(function () {
          prep11.chat.finished = true;
          Store.addHistory('Текстовое пробное интервью', '#/prep/' + prep11.id + '/interview', prep11.id);
        });
        return;
      }
      case 'chat:restart': {
        var prep12 = Store.activePrep();
        if (!prep12) return;
        Store.update(function () { prep12.chat = null; });
        dispatch('chat:start', {});
        return;
      }

      /* -------- Голосовое интервью -------- */
      case 'voice:start': {
        var prep13 = Store.activePrep();
        if (!prep13) return;
        Store.update(function () {
          var v = ScreensPrep.ensureVoice(prep13);
          v.status = 'speaking';
          v.line = 1;
          v.finished = false;
        });
        return;
      }
      case 'voice:next': {
        var prep14 = Store.activePrep();
        if (!prep14 || !prep14.voice) return;
        Store.update(function () {
          var v = prep14.voice;
          if (v.line < DEMO_DATA.voiceScript.length) {
            v.line += 1;
            v.status = DEMO_DATA.voiceScript[v.line - 1].who === 'Интервьюер' ? 'speaking' : 'listening';
          } else {
            v.status = 'thinking';
            UI.toast('Сценарий разговора закончился. Можно завершить тренировку.');
          }
        });
        return;
      }
      case 'voice:pause': {
        var prep15 = Store.activePrep();
        if (!prep15 || !prep15.voice) return;
        Store.update(function () {
          var v = prep15.voice;
          v.status = v.status === 'paused' ? 'listening' : 'paused';
        });
        return;
      }
      case 'voice:mic':
        UI.openModal({
          title: 'Микрофон не используется',
          body: '<p>Макет не запрашивает разрешение на микрофон, не записывает звук и не распознаёт речь. '
            + 'Кнопка показывает, где в готовом продукте находилось бы управление микрофоном.</p>'
        });
        return;
      case 'voice:set-status': {
        var prep16 = Store.activePrep();
        if (!prep16) return;
        Store.update(function () {
          var v = ScreensPrep.ensureVoice(prep16);
          v.status = data.value;
          if (v.line === 0 && data.value !== 'idle') v.line = 1;
        });
        return;
      }
      case 'voice:finish':
        UI.confirm({
          title: 'Завершить голосовую тренировку?',
          body: '<p>Откроется демонстрационный итог. Звук не записывался.</p>',
          act: 'voice:finish-confirm', confirmLabel: 'Завершить'
        });
        return;
      case 'voice:finish-confirm': {
        var prep17 = Store.activePrep();
        if (!prep17 || !prep17.voice) return;
        Store.update(function () {
          prep17.voice.finished = true;
          Store.addHistory('Голосовое пробное интервью', '#/prep/' + prep17.id + '/voice', prep17.id);
        });
        return;
      }
      case 'voice:restart': {
        var prep18 = Store.activePrep();
        if (!prep18) return;
        Store.update(function () { prep18.voice = null; });
        return;
      }

      /* -------- Помощник на собеседовании -------- */
      case 'assistant:download':
        UI.openModal({
          title: 'Компонент ещё не доступен',
          body: '<p>Демонстрационный интерфейс. Скачиваемый помощник не готов: формат файла, поддерживаемые '
            + 'операционные системы и способ подключения не определены.</p>'
            + '<p>Макет намеренно не отдаёт пустой или фиктивный файл.</p>'
        });
        return;
      case 'assistant:connect':
        Store.update(function (s) { s.assistant.status = 'connecting'; });
        window.setTimeout(function () {
          Store.update(function (s) { s.assistant.status = 'connected'; });
          UI.toast('Демонстрационный статус: «Подключён». Настоящего соединения нет.');
        }, 900);
        return;
      case 'assistant:status':
        Store.update(function (s) { s.assistant.status = data.status; });
        return;
      case 'assistant:hints':
        Store.update(function (s) { s.assistant.hintsOpen = true; });
        return;
      case 'assistant:hints-toggle':
      case 'assistant:hints-close':
        Store.update(function (s) { s.assistant.hintsOpen = false; });
        return;
      case 'assistant:hint-next':
        Store.update(function (s) {
          s.assistant.hintIndex = (s.assistant.hintIndex + 1) % DEMO_DATA.assistantHints.length;
        });
        return;
      case 'assistant:hint-prev':
        Store.update(function (s) {
          s.assistant.hintIndex = (s.assistant.hintIndex - 1 + DEMO_DATA.assistantHints.length)
            % DEMO_DATA.assistantHints.length;
        });
        return;
      case 'assistant:prep':
        Store.update(function (s) { s.assistant.prepId = data.value; s.activePrepId = data.value; });
        return;

      /* -------- Тарифы -------- */
      case 'plan:set':
        Store.setPref('plan', data.plan);
        UI.toast('Демо-уровень переключён на «' + Store.planById(data.plan).name + '».');
        return;
      case 'demo:plan':
        Store.setPref('plan', data.value);
        return;
      case 'demo:profession': {
        var name = Store.setProfession(data.value);
        UI.toast('Демо-набор пересобран для профессии «' + name + '».');
        return;
      }
      case 'demo:scenario':
        if (data.value === 'loading' || data.value === 'error' || data.value === 'limit') {
          Store.get().scenario = data.value;
          Store.setPref('scenario', data.value);
        } else {
          Store.applyScenario(data.value);
        }
        return;

      /* -------- Заглушки -------- */
      case 'card:print':
        /* Настоящая печать браузера: диалог позволяет сохранить в PDF. */
        window.print();
        return;
      case 'stub:export':
        UI.openModal({
          title: 'Экспорт не реализован',
          body: '<p>Макет не создаёт PDF и не скачивает файлы. В готовом продукте здесь была бы выгрузка резюме.</p>'
        });
        return;
      case 'stub:import':
        UI.openModal({
          title: 'Импорт по ссылке не реализован',
          body: '<p>Прототип не обращается в сеть и не может получить вакансию по ссылке. '
            + 'Вставьте текст вакансии вручную или откройте подготовленный пример.</p>'
        });
        return;
      case 'stub:pay':
        UI.openModal({
          title: 'Оплата недоступна',
          body: '<p>Платежи не подключены: банковских полей и платёжных сервисов в макете нет. '
            + 'Цены и лимиты пока не определены, поэтому купить уровень нельзя — его можно только '
            + 'посмотреть в демонстрационном режиме.</p>'
        });
        return;
      case 'stub:profile-save':
        UI.toast('Профиль не сохраняется: макет не хранит персональные данные.');
        return;

      default:
        return;
    }
  }

  function sourcesModalBody(prep) {
    var state = Store.get();
    var resumeOptions = state.resumes.map(function (r) { return { value: r.id, label: r.title }; });
    var vacancyOptions = state.vacancies.map(function (v) { return { value: v.id, label: v.title + ' — ' + v.company }; });
    return ''
      + '<p class="muted">Если заменить резюме или вакансию, прежний демонстрационный отчёт будет помечен '
      + 'как относящийся к предыдущей версии.</p>'
      + UI.select({ id: 'src-resume', label: 'Резюме', value: prep.resumeId,
          options: resumeOptions.length ? resumeOptions : [{ value: '', label: 'Резюме нет' }],
          act: 'prep:set-resume' })
      + UI.select({ id: 'src-vacancy', label: 'Вакансия', value: prep.vacancyId,
          options: vacancyOptions.length ? vacancyOptions : [{ value: '', label: 'Вакансий нет' }],
          act: 'prep:set-vacancy' });
  }

  /* ---------------- Обработчики событий ---------------- */

  document.addEventListener('click', function (event) {
    var element = event.target.closest('[data-act]');
    if (!element) return;
    var act = element.getAttribute('data-act');
    if (act === 'modal:backdrop' && event.target !== element) return;
    if (element.tagName === 'A') return;
    if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    dispatch(act, {
      id: element.getAttribute('data-id'),
      index: element.getAttribute('data-index'),
      step: element.getAttribute('data-step'),
      plan: element.getAttribute('data-plan'),
      prep: element.getAttribute('data-prep'),
      status: element.getAttribute('data-status')
    }, element);
  });

  /* Ввод текста не вызывает перерисовку: фокус и каретка остаются на месте. */
  document.addEventListener('input', function (event) {
    var element = event.target;
    var model = element.getAttribute && element.getAttribute('data-model');
    if (!model) return;
    if (model === 'chatDraft') {
      var prep = Store.activePrep();
      if (prep && prep.chat) prep.chat.draft = element.value;
      return;
    }
    setPath(model, element.value);
    if (/^preps\.\d+\.answers\./.test(model)) {
      var owner = Store.activePrep();
      if (owner && owner.live) liveScheduleAnswers(owner, false);
    }
  });

  document.addEventListener('change', function (event) {
    var element = event.target;
    if (element.getAttribute && element.getAttribute('data-toggle')) {
      var key = element.getAttribute('data-toggle');
      Store.update(function (s) { s.settings[key] = element.checked; });
      UI.toast('Переключатель изменён локально: уведомления не отправляются.');
      return;
    }
    var act = element.getAttribute && element.getAttribute('data-change-act');
    if (!act) return;
    var model = element.getAttribute('data-model');
    if (model) setPath(model, element.value);
    dispatch(act, { value: element.value }, element);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && Store.get().modal) {
      UI.closeModal();
    }
  });

  window.addEventListener('hashchange', function () {
    document.body.setAttribute('data-nav', 'closed');
    render();
    var main = document.getElementById('main');
    if (main) main.scrollIntoView({ block: 'start' });
  });

  Store.subscribe(render);

  /* ---------------- Запуск ---------------- */

  if (!window.location.hash) window.location.hash = '#/start';

  (async function boot() {
    var isLive = await Api.detect();
    if (isLive) {
      try { await liveHydrate(); } catch (e) { UI.toast('Не удалось загрузить данные с сервера: ' + e.message); }
    }
    render();
    window.setTimeout(function () {
      UI.toast(isLive
        ? 'Режим сервера: данные хранятся в базе' + (Api.live.ai && Api.live.ai.live ? ', ответы — от модели.' : ', модель пока на заглушке.')
        : 'Демо-макет: введённые данные хранятся только в этой вкладке и сбрасываются после перезагрузки.');
    }, 600);
  })();
})();
