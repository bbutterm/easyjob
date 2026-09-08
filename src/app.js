/* ============================================================
   Маршрутизация, отрисовка оболочки и обработка действий.
   HTTP uses the local API; file:// keeps the standalone demo.
   ============================================================ */

(function () {
  'use strict';

  var esc = UI.esc;
  var root = document.getElementById('app');
  var lastRenderRoute = null;
  var authBusy = false;
  var bootComplete = false;
  var authError = '';

  var NAV = [
    { section: 'overview', href: '#/overview', label: 'Обзор' },
    { section: 'resumes', href: '#/resumes', label: 'Мои резюме' },
    { section: 'vacancies', href: '#/vacancies', label: 'Вакансии и подготовка' },
    { section: 'jobs', href: '#/jobs', label: 'Поиск вакансий' },
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
    'vacancy', 'jobs', 'prep', 'interviews', 'assistant', 'plans', 'history', 'settings', 'privacy', 'admin', 'quickstart'];

  /* ---------------- Отрисовка ---------------- */

  var adminUsage = { days: 30, data: null, error: '', loading: false, owner: null };
  function isAdmin() { return Api.isHttp() && Api.live.user && Api.live.user.role === 'admin'; }
  function usageScreen() {
    if (!isAdmin()) { adminUsage.data = null; return '<h1>Доступ запрещён</h1>'; }
    if (adminUsage.owner !== Api.live.user.id) { adminUsage.owner = Api.live.user.id; adminUsage.data = null; }
    if (!adminUsage.data && !adminUsage.loading && !adminUsage.error) loadUsage();
    var out = '<h1>Расходы AI</h1><p>Приблизительная стоимость USD. Ненастроенные цены не включены в сумму.</p>'
      + '<label for="usage-days">Период</label> <select id="usage-days"' + (adminUsage.loading ? ' disabled' : '') + '>'
      + [7, 30, 90, 365].map(function (d) { return '<option value="' + d + '"' + (d === adminUsage.days ? ' selected' : '') + '>' + d + ' дней</option>'; }).join('')
      + '</select><p role="status">' + esc(adminUsage.loading ? 'Загрузка…' : adminUsage.error) + '</p>';
    var data = adminUsage.data;
    if (!data) return out;
    var metrics = [['requests', 'Запросы'], ['failures', 'Ошибки'], ['tokensIn', 'Входные токены'],
      ['tokensOut', 'Выходные токены'], ['estimatedCostUsd', '≈ USD'], ['estimatedRequests', 'Оценка токенов'],
      ['reportedRequests', 'Токены провайдера'], ['unpricedRequests', 'Без цены'], ['usageUnknown', 'Расход неизвестен'],
      ['attempts', 'Попытки'], ['avgMs', 'Среднее мс']];
    function table(title, rows, dimensions) {
      var cols = dimensions.concat(metrics);
      return '<h2>' + title + '</h2><div class="usage-table" tabindex="0" role="region" aria-label="' + title + '"><table><caption class="sr-only">' + title + '</caption><thead><tr>'
        + cols.map(function (c) { return '<th scope="col">' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>'
        + rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + esc(c[0] === 'estimatedCostUsd' ? Number(r[c[0]]).toFixed(6) : String(r[c[0]] == null ? '—' : r[c[0]])) + '</td>'; }).join('') + '</tr>'; }).join('')
        + '</tbody></table></div>';
    }
    return out + table('Всего', [data.totals], [])
      + table('По пользователям', data.byUser, [['username', 'Логин'], ['userId', 'ID']])
      + table('По этапам', data.byStage, [['stage', 'Этап']])
      + table('По провайдерам', data.byProvider, [['provider', 'Провайдер']])
      + table('По моделям', data.byModel, [['provider', 'Провайдер'], ['model', 'Модель']])
      + table('По задачам', data.byTask || [], [['task', 'Задача'], ['provider', 'Провайдер']])
      + table('По фазам', data.byPhase || [], [['phase', 'Фаза']])
      + table('По дням (UTC)', data.byDay, [['day', 'День']]);
  }
  function loadUsage() {
    if (!isAdmin()) return;
    adminUsage.loading = true;
    var owner = Api.live.user.id;
    Api.request('GET', '/api/admin/usage?days=' + adminUsage.days).then(function (data) {
      if (isAdmin() && Api.live.user.id === owner) adminUsage.data = data;
    }).catch(function () { adminUsage.error = 'Не удалось загрузить статистику. Выберите период для повтора.'; })
      .finally(function () { adminUsage.loading = false; if (parseRoute().name === 'admin') render(); });
  }
  document.addEventListener('change', function (event) {
    var actChange = event.target.getAttribute && event.target.getAttribute('data-act-change');
    if (actChange) { dispatch(actChange, { checked: !!event.target.checked, value: event.target.value }); return; }
    if (event.target.id !== 'usage-days' || !isAdmin() || adminUsage.loading) return;
    adminUsage.days = Number(event.target.value); adminUsage.data = null; adminUsage.error = ''; render();
  });

  function voiceScreenModel() {
    return { ui: Store.get().voiceUi || { state: 'idle', stats: null, mock: false, error: '' }, active: voice.active,
      providers: voiceProviders(), provider: voiceDefaultProvider(), tts: voice.tts };
  }

  function screenFor(route) {
    var parts = route.parts;
    switch (route.name) {
      case 'quickstart': return QuickStart.screen();
      case 'admin': return usageScreen();
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
      case 'jobs': return ScreensCore.jobs();
      case 'prep': {
        var prepId = parts[1];
        var view = parts[2] || 'match';
        if (view === 'questions') return ScreensPrep.questions(prepId);
        if (view === 'card') return ScreensPrep.card(prepId);
        if (view === 'interview') return ScreensPrep.interview(prepId);
        if (view === 'voice') return ScreensPrep.voice(prepId, voiceScreenModel());
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
      + '<nav class="sidebar" id="site-nav" aria-label="Основная навигация">'
      + '  <div class="sidebar__brand">'
      + '    <b class="wordmark">easyjob</b>'
      + '    <span class="muted">Карьерный помощник</span>'
      + '  </div>'
      + '  <div class="sidebar__nav">' + links + '</div>'
      + '  <div class="sidebar__foot">'
      + (QuickStart.eligible() ? '<a class="navlink" href="#/quickstart">Продолжить Quick Start</a><button class="btn" data-act="qs:restart">Начать Quick Start заново</button>' : '')
      + (isAdmin() ? '<a class="navlink" href="#/admin">Расходы AI</a>' : '')
      + '    <a class="navlink" href="#/history"><span>История</span></a>'
      + '    <a class="navlink" href="#/privacy"><span>Обработка данных</span></a>'
      + (Api.live.user ? '<button id="account-logout" class="btn btn--block" data-act="auth:logout">Выйти из аккаунта</button>'
          : '<a class="navlink" href="' + (Api.isHttp() ? '#/auth/login' : '#/start') + '"><span>' + (Api.isHttp() ? 'Войти в аккаунт' : 'Выйти из демо') + '</span></a>')
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
      + '  <button type="button" class="btn btn--sm menu-btn" id="menu-toggle" data-act="nav:toggle" aria-controls="site-nav" aria-expanded="' + (document.body.getAttribute('data-nav') === 'open') + '" aria-label="Открыть меню">☰ Меню</button>'
      + '  <div class="topbar__ctx">' + ctx + '</div>'
      + '<span class="account-label">' + (Api.live.user ? esc(Api.live.user.username) : (Api.isHttp() ? 'Гость' : 'Демо')) + '</span>'
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
        + '  <button type="button" class="demo-panel__head" data-act="demopanel:toggle" aria-controls="demo-panel-body" aria-expanded="'
        + (open ? 'true' : 'false') + '"><span>Режим сервера</span><span aria-hidden="true">' + (open ? '▾' : '▴') + '</span></button>'
        + '  <div class="demo-panel__body" id="demo-panel-body"><button type="button" class="btn btn--sm" data-act="demopanel:close">Свернуть панель</button>'
        + '    <p><b>' + esc(ai.title || ai.provider || '') + '</b>' + (ai.model ? ' · ' + esc(ai.model) : '')
        + (ai.live ? '' : ' — заглушка, ключ не задан') + '</p>'
        + (ai.stages ? '<p>pre_interview: ' + esc(ai.stages.pre_interview.provider) + ' · ' + esc(ai.stages.pre_interview.model) + '<br>live_interview: ' + esc(ai.stages.live_interview.provider) + ' · ' + esc(ai.stages.live_interview.model) + '</p>' : '')
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
      + '  <button type="button" class="demo-panel__head" data-act="demopanel:toggle" aria-controls="demo-panel-body" aria-expanded="'
      + (open ? 'true' : 'false') + '">'
      + '    <span>Состояния демо</span><span aria-hidden="true">' + (open ? '▾' : '▴') + '</span>'
      + '  </button>'
      + '  <div class="demo-panel__body" id="demo-panel-body"><button type="button" class="btn btn--sm" data-act="demopanel:close">Свернуть панель</button>'
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

  var speechWidget = null;
  var speechTextAborter = null;
  function render() {
    var state = Store.get();
    var route = parseRoute();
    if (route.name === 'quickstart' && !QuickStart.eligible()) {
      window.location.hash = Api.isHttp() ? '#/auth/login' : '#/overview'; return;
    }
    QuickStart.sync();
    var routeKey = window.location.hash;
    var entering = lastRenderRoute !== routeKey;
    var authDraft = !entering && document.getElementById('auth-form') ? {
      username: document.getElementById('auth-username').value,
      password: document.getElementById('auth-password').value
    } : null;
    if (entering) authError = '';

    document.documentElement.setAttribute('data-theme', state.theme);

    if (KNOWN.indexOf(route.name) < 0) {
      window.location.hash = '#/overview';
      return;
    }

    var focusId = document.activeElement ? document.activeElement.id : null;
    var focusAction = document.activeElement && document.activeElement.getAttribute('data-act');
    var focusIndex = focusAction ? Array.from(root.querySelectorAll('[data-act]')).indexOf(document.activeElement) : -1;
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
      var content = Store.sectionAllowed(section) || section === 'settings' || section === 'plans' || section === 'admin' || section === 'quickstart'
        ? screenFor(route)
        : ScreensPrep.locked(navLabel(section), section === 'assistant' ? 'assistant' : 'training');
      html = ''
        + '<div class="shell">'
        + sidebar(section)
        + '  <div class="main">' + topbar()
        + '    <main class="content" id="main" tabindex="-1">'
        + (state.pending ? '<div class="note note--info op-status" role="status" aria-live="polite" style="margin-bottom:16px"><div>'
            + '<span class="dots" aria-hidden="true"><span></span><span></span><span></span></span> ' + esc(state.pending)
            + (state.pendingElapsed >= 2 ? ' <span class="muted">· ' + esc(String(state.pendingElapsed)) + ' с</span>' : '')
            + (currentOp ? ' <button type="button" class="btn btn--sm" data-act="op:cancel" style="margin-left:12px">Отменить</button>' : '')
            + '</div></div>' : '')
        + content + '</main>'
        + '  </div>'
        + '</div>'
        + demoPanel();
    }

    if (speechWidget) speechWidget.element.remove();
    if (voice.active && !(route.name === 'prep' && route.parts[2] === 'voice')) voiceStop();
    if (route.name === 'prep' && route.parts[2] === 'voice' && Api.live.enabled) voiceLoadTts();
    root.innerHTML = html + UI.renderModal(state.modal) + UI.renderToasts(state.toasts);
    var speechSlot = document.getElementById('stt-slot');
    if (speechWidget && (entering || !speechSlot)) { speechWidget.dispose(); speechWidget = null; }
    if (speechSlot) {
      if (!speechWidget) speechWidget = SttWidget({ beforeCapture: function () { voiceInterrupt(); }, onCancel: function () { if (speechTextAborter) speechTextAborter.abort(); }, onSend: async function (text) {
        var prep = Store.activePrep();
        if (!prep || !prep.chat || prep.chat.pending || prep.chat.failed || prep.chat.finished) throw new Error('Интервью недоступно');
        prep.chat.draft = text;
        if (prep.live) {
          speechTextAborter = new AbortController();
          try { await liveSendChat(prep, speechTextAborter.signal); if (prep.chat.failed) throw new Error('Ответ интервьюера не получен'); } finally { speechTextAborter = null; }
        }
        else dispatch('chat:send', {});
      } });
      speechSlot.appendChild(speechWidget.element);
    }
    if (authDraft) {
      document.getElementById('auth-username').value = authDraft.username;
      document.getElementById('auth-password').value = authDraft.password;
    }
    var authForm = document.getElementById('auth-form');
    if (authForm) {
      document.getElementById('auth-submit').disabled = authBusy;
      document.getElementById('auth-error').textContent = authError;
      authForm.setAttribute('aria-busy', String(authBusy));
    }
    UI.reveal(root, entering);
    lastRenderRoute = routeKey;
    /* Экран поиска с выбранным резюме и без результатов: запрос уходит сам. */
    if (entering && route.name === 'jobs' && Api.live.enabled && state.jobs.resumeId && !state.jobs.result && !state.jobs.busy && !state.jobs.error) {
      liveJobsSearch(0);
    }

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
    if (!entering && !focusId && focusIndex >= 0 && !state.modal) {
      var control = root.querySelectorAll('[data-act]')[focusIndex];
      if (control && control.getAttribute('data-act') === focusAction) control.focus({ preventScroll: true });
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

  var uploadOperation = null;
  var selectedFile = null;
  function uploadPhase(phase) {
    Store.update(function (s) { s.upload.phase = phase; });
  }
  function cancelUpload() {
    if (uploadOperation) uploadOperation.abort();
  }
  async function readResumeFile(file) {
    if (uploadOperation || Store.get().pending) return;
    selectedFile = file;
    var op = new AbortController(); uploadOperation = op;
    Store.update(function (s) { s.upload = { fileName: file.name, text: '', decisions: {}, phase: 'Файл выбран', busy: true }; });
    try {
      if (!/\.(pdf|docx|doc|rtf|txt)$/i.test(file.name)) throw new Error('Недопустимый формат. Выберите PDF, DOCX или TXT.');
      if (!file.size || file.size > 2 * 1024 * 1024) throw new Error('Размер файла: от 1 байта до 2 МБ.');
      if (!Api.live.enabled) throw new Error('Для чтения файла нужен доступный сервер. Запустите сервер и откройте приложение через HTTP.');
      uploadPhase('Чтение файла…');
      var base64 = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        var abort = function () { reader.abort(); reject(new Error('Запрос отменён.')); };
        op.signal.addEventListener('abort', abort, { once: true });
        reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
        reader.onerror = function () { reject(new Error('Не удалось прочитать файл. Выберите его снова.')); };
        reader.onloadend = function () { op.signal.removeEventListener('abort', abort); };
        reader.readAsDataURL(file);
      });
      if (op.signal.aborted) throw new Error('Запрос отменён.');
      uploadPhase('Загрузка и извлечение текста на сервере…');
      var data = await Api.request('POST', '/api/resumes/extract', { name: file.name, base64: base64 }, { signal: op.signal, timeoutMs: 25000 });
      if (op.signal.aborted) throw new Error('Запрос отменён.');
      Store.update(function (s) { s.upload.text = data.rawText; s.upload.phase = 'Текст извлечён — проверьте его и нажмите «Разобрать резюме»'; });
    } catch (e) {
      Store.update(function (s) { s.upload.error = e.message; s.upload.phase = 'Ошибка чтения файла'; s.upload.fileError = true; });
    } finally {
      if (uploadOperation === op) uploadOperation = null;
      Store.update(function (s) { s.upload.busy = false; s.pending = null; });
    }
  }
  function bindFileInput() {
    var input = document.getElementById('file-input');
    var zone = document.getElementById('dropzone');
    if (!input) return;
    input.addEventListener('change', function () { if (input.files && input.files[0]) readResumeFile(input.files[0]); });
    if (!zone) return;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        zone.classList.toggle('dropzone--over', type === 'dragenter' || type === 'dragover');
      });
    });
    zone.addEventListener('drop', function (event) {
      var files = event.dataTransfer && event.dataTransfer.files;
      if (files && files[0]) readResumeFile(files[0]);
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

  /* Долгая операция с сервером: одна за раз, с отменой и временем ожидания.
     Сигнал уходит в запросы; сервер по обрыву соединения отменяет вызов
     модели. Введённые данные не теряются: экран остаётся тем же. */
  var currentOp = null;
  function beginOperation(text) {
    if (currentOp) return null;
    var controller = new AbortController();
    var started = Date.now();
    currentOp = { controller: controller, started: started, ticker: setInterval(function () {
      Store.get().pendingElapsed = Math.floor((Date.now() - started) / 1000);
      Store.notify();
    }, 1000) };
    Store.get().pendingElapsed = 0;
    setPending(text);
    return { signal: controller.signal, timeoutMs: 100000 };
  }
  function endOperation() {
    if (currentOp) { clearInterval(currentOp.ticker); currentOp = null; }
    Store.get().pendingElapsed = 0;
    setPending(null);
  }
  function cancelOperation() {
    if (currentOp) currentOp.controller.abort();
  }

  function liveFail(e) {
    setPending(null);
    if (e && e.extra && e.extra.code === 'cancelled') { UI.toast('Операция отменена. Данные на экране сохранены.'); return; }
    if (e && e.extra && e.extra.code === 'timeout') { UI.toast(e.message + ' Нажмите кнопку ещё раз, чтобы повторить.'); return; }
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
    Api.live.enabled = true;
    Api.live.user = me.user;
    Api.live.auth = me.auth;
    Api.live.ai = me.ai;
    Api.live.limits = me.limits;
    Api.live.professions = me.professions;
    var resumes = [];
    for (var i = 0; i < me.resumes.length; i++) {
      var full = await Api.request('GET', '/api/resumes/' + me.resumes[i].id);
      resumes.push(Api.resumeFromServer(full));
    }
    var vacancies = (await Api.request('GET', '/api/vacancies')).map(Api.vacancyFromServer);
    var seen = {};
    vacancies.forEach(function (v) { seen[v.id] = true; });
    me.preps.forEach(function (p) {
      if (p.vacancy && !seen[p.vacancy.id]) {
        seen[p.vacancy.id] = true;
        vacancies.push({ id: p.vacancy.id, serverId: p.vacancy.id, demo: false, rev: p.vacancy.rev,
          title: p.vacancy.title, company: p.vacancy.company || '', location: '', text: '',
          requirements: p.vacancy.requirements || [] });
      }
    });
    Store.replaceData({ resumes: resumes, vacancies: vacancies, preps: me.preps.map(Api.prepFromServer) });
    QuickStart.bind();
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
    var op = beginOperation('Отправляю резюме и вакансию на сервер…');
    if (!op) return;
    try {
      var resumeSid = await liveEnsureResume(resume);
      var origin = draft.imported && draft.imported.sourceUrl
        ? { sourceUrl: draft.imported.sourceUrl, source: draft.imported.source, retrievedAt: draft.imported.retrievedAt } : {};
      var vacancy = Api.vacancyFromServer(await Api.request('POST', '/api/vacancies', Object.assign({
        title: draft.title, company: draft.company || '', rawText: draft.text
      }, origin), op));
      setPending('Сопоставляю резюме с требованиями…');
      var prep = Api.prepFromServer(await Api.request('POST', '/api/preps', {
        resumeId: resumeSid, vacancyId: vacancy.id, profession: resume.profession || draft.title
      }, op));
      prep.resumeId = resume.id;
      Store.update(function (s) {
        s.vacancies.unshift(vacancy);
        s.preps.unshift(prep);
        s.activePrepId = prep.id;
        s.vacancyDraft = { title: '', company: '', text: '', resumeId: '', url: '', imported: null, importError: '', importBusy: false, importElapsed: 0 };
        s.pending = null;
        Store.addHistory('Создана подготовка по вакансии', '#/prep/' + prep.id + '/match', prep.id);
      });
      go('#/prep/' + prep.id + '/match');
    } catch (e) { liveFail(e); } finally { endOperation(); }
  }

  /* Импорт вакансии по ссылке: сервер читает страницу, пользователь видит
     и правит текст до разбора. Есть отмена и время ожидания; ошибка не
     подменяется примером. */
  var importOperation = null;
  function cancelImport() {
    if (importOperation) importOperation.abort();
  }
  async function liveImportVacancy() {
    var draft = Store.get().vacancyDraft;
    var url = String(draft.url || '').trim();
    if (!url) { UI.toast('Вставьте ссылку на страницу вакансии.'); return; }
    if (importOperation) return;
    var op = new AbortController(); importOperation = op;
    var started = Date.now();
    Store.update(function (s) { s.vacancyDraft.importBusy = true; s.vacancyDraft.importError = ''; s.vacancyDraft.importElapsed = 0; });
    var ticker = setInterval(function () {
      Store.update(function (s) { s.vacancyDraft.importElapsed = Math.floor((Date.now() - started) / 1000); });
    }, 1000);
    try {
      var data = await Api.request('POST', '/api/vacancies/import-url', { url: url }, { signal: op.signal, timeoutMs: 20000 });
      if (data.ok === false) throw new Api.ApiError(422, data.error || 'Не удалось получить вакансию.', { code: data.code });
      var v = data.vacancy || {};
      Store.update(function (s) {
        var d = s.vacancyDraft;
        d.title = v.title || d.title;
        d.company = v.company || d.company;
        d.text = v.rawText || '';
        d.imported = { sourceUrl: v.sourceUrl, source: v.source, retrievedAt: v.retrievedAt, needsReview: v.needsReview, truncated: v.truncated };
        d.importError = '';
        if (!d.resumeId && s.resumes.length) d.resumeId = s.resumes[0].id;
      });
      UI.toast(v.needsReview ? 'Текст получен: проверьте и поправьте его перед разбором.' : 'Вакансия получена со страницы.');
    } catch (e) {
      Store.update(function (s) {
        s.vacancyDraft.importError = e.message + (e.extra && e.extra.code === 'cancelled' ? '' : ' Вставьте текст вакансии вручную.');
      });
    } finally {
      clearInterval(ticker);
      if (importOperation === op) importOperation = null;
      Store.update(function (s) { s.vacancyDraft.importBusy = false; });
    }
  }

  /* Резюме по ссылке hh.ru: сервер читает публичную страницу, показывает
     предпросмотр; сохраняется только после подтверждения. Капча и вход не
     обходятся — при отказе совет выгрузить файл. */
  var hhResumeOperation = null;
  async function liveImportHhResume() {
    var url = String(Store.get().hhResume.url || '').trim();
    if (!url) { UI.toast('Вставьте ссылку на резюме hh.ru.'); return; }
    if (hhResumeOperation) return;
    var op = new AbortController(); hhResumeOperation = op;
    Store.update(function (s) { s.hhResume.busy = true; s.hhResume.error = ''; s.hhResume.preview = null; });
    try {
      var data = await Api.request('POST', '/api/resumes/import-url', { url: url }, { signal: op.signal, timeoutMs: 20000 });
      if (data.ok === false) throw new Api.ApiError(422, data.error || 'Не удалось получить резюме.', { code: data.code });
      Store.update(function (s) { s.hhResume.preview = data.resume; });
      UI.toast('Резюме получено: проверьте поля и сохраните.');
    } catch (e) {
      Store.update(function (s) { s.hhResume.error = e.message; });
    } finally {
      if (hhResumeOperation === op) hhResumeOperation = null;
      Store.update(function (s) { s.hhResume.busy = false; });
    }
  }
  async function liveSaveHhResume() {
    var preview = Store.get().hhResume.preview;
    if (!preview) return;
    var op = beginOperation('Сохраняю резюме…');
    if (!op) return;
    try {
      var created = await Api.request('POST', '/api/resumes', { title: preview.title, data: Object.assign({}, preview.data, { sourceUrl: preview.sourceUrl }) }, op);
      var resume = Api.resumeFromServer(created);
      Store.update(function (s) {
        s.resumes.unshift(resume);
        s.vacancyDraft.resumeId = resume.id;
        s.jobs.resumeId = resume.id;
        s.hhResume = { url: '', busy: false, error: '', preview: null };
        s.pending = null;
        Store.addHistory('Резюме импортировано с hh.ru', '#/resume/' + resume.id, null);
      });
      UI.toast('Резюме сохранено. Теперь можно найти подходящие вакансии.');
      go('#/jobs');
    } catch (e) { liveFail(e); } finally { endOperation(); }
  }

  /* Поиск вакансий на hh.ru: запрос по умолчанию собирается на сервере из
     резюме; наружу уходит только текст запроса и регион. */
  var jobsOperation = null;
  async function liveJobsSearch(page) {
    var j = Store.get().jobs;
    if (!Api.live.enabled) { UI.toast('Поиск работает только с сервером.'); return; }
    if (jobsOperation) jobsOperation.abort();
    var op = new AbortController(); jobsOperation = op;
    var started = Date.now();
    Store.update(function (s) { s.jobs.busy = true; s.jobs.error = ''; s.jobs.elapsed = 0; s.jobs.page = page || 0; });
    var ticker = setInterval(function () { Store.update(function (s) { s.jobs.elapsed = Math.floor((Date.now() - started) / 1000); }); }, 1000);
    try {
      var qs = [];
      if (j.query) qs.push('text=' + encodeURIComponent(j.query));
      if (j.area) qs.push('area=' + encodeURIComponent(j.area));
      if (j.resumeId) {
        var r = Store.resumeById(j.resumeId);
        if (r && r.serverId) qs.push('resumeId=' + encodeURIComponent(r.serverId));
      }
      qs.push('page=' + (page || 0));
      var data = await Api.request('GET', '/api/jobs/search?' + qs.join('&'), undefined, { signal: op.signal, timeoutMs: 20000 });
      if (data.ok === false) throw new Api.ApiError(422, data.error || 'Поиск не удался.', { code: data.code });
      Store.update(function (s) { s.jobs.result = data; if (!s.jobs.query) s.jobs.query = data.query || ''; });
    } catch (e) {
      if (op.signal.aborted) return;
      Store.update(function (s) { s.jobs.error = e.message; });
    } finally {
      clearInterval(ticker);
      if (jobsOperation === op) { jobsOperation = null; Store.update(function (s) { s.jobs.busy = false; }); }
    }
  }
  /* Из результата поиска — сразу в форму вакансии: ссылка и резюме
     подставлены, импорт запускается без лишних действий. */
  function jobsPrepare(url) {
    var j = Store.get().jobs;
    Store.update(function (s) {
      s.vacancyDraft = { title: '', company: '', text: '', resumeId: j.resumeId || s.vacancyDraft.resumeId || '', url: url,
        imported: null, importError: '', importBusy: false, importElapsed: 0 };
    });
    go('#/vacancy/new');
    liveImportVacancy();
  }

  async function liveRebuild(prep) {
    var op = beginOperation('Пересобираю сопоставление…');
    if (!op) return;
    try {
      var fresh = Api.prepFromServer(await Api.request('POST', '/api/preps/' + prep.serverId + '/rebuild', undefined, op));
      Store.update(function () {
        prep.match = fresh.match; prep.questions = null; prep.card = null;
        prep.stale = false; prep.staleReason = ''; prep.resumeRev = fresh.resumeRev; prep.vacancyRev = fresh.vacancyRev;
        Store.get().pending = null;
      });
      UI.toast('Сопоставление пересобрано для текущих версий.');
    } catch (e) { liveFail(e); } finally { endOperation(); }
  }

  /* Помощник через сервер: выделение вопроса и подсказка по подготовке.
     Согласие обязательно; текст не хранится ни в браузере, ни на сервере. */
  var assistantOp = null;
  async function liveAssistant(kind) {
    var a = Store.get().assistant;
    if (!a.consent) { UI.toast('Подтвердите согласие участников разговора.'); return; }
    if (assistantOp) return;
    var op = new AbortController(); assistantOp = op;
    Store.update(function (s) { s.assistant.busy = kind; s.assistant.error = ''; });
    try {
      if (kind === 'extract') {
        var ex = await Api.request('POST', '/api/assistant/extract', { text: a.screenText, consent: true }, { signal: op.signal, timeoutMs: 30000 });
        Store.update(function (s) {
          s.assistant.question = ex.question || '';
          if (!ex.question) s.assistant.error = 'В тексте не нашлось вопроса собеседующего. Сформулируйте его сами в поле ниже.';
        });
      } else {
        var prep = Store.prepById(a.prepId) || Store.activePrep() || Store.get().preps[0];
        if (!prep || !prep.serverId) throw new Error('Выберите подготовку.');
        var asked = a.hints.map(function (h) { return h.question; }).slice(-30);
        var hint = await Api.request('POST', '/api/assistant/hint', { prepId: prep.serverId, question: a.question, consent: true, askedTopics: asked },
          { signal: op.signal, timeoutMs: 30000 });
        Store.update(function (s) {
          s.assistant.hint = { question: hint.question, direction: hint.direction, remind: hint.remind, avoid: hint.avoid, source: hint.source, at: Date.now() };
          s.assistant.hints = s.assistant.hints.concat([s.assistant.hint]).slice(-20);
        });
      }
    } catch (e) {
      Store.update(function (s) { s.assistant.error = e.message; });
    } finally {
      if (assistantOp === op) assistantOp = null;
      Store.update(function (s) { s.assistant.busy = ''; });
    }
  }

  async function liveBuildCard(prep) {
    var op = beginOperation('Собираю карточку подготовки…');
    if (!op) return;
    try {
      if (answersTimer) { clearTimeout(answersTimer); answersTimer = null; }
      await Api.request('PUT', '/api/preps/' + prep.serverId + '/answers', { answers: prep.answers, ready: prep.ready }, op);
      var data = await Api.request('POST', '/api/preps/' + prep.serverId + '/card', undefined, op);
      Store.update(function () { prep.card = data.card; if (data.source) prep.sources.card = data.source; });
    } catch (e) { liveFail(e); } finally { endOperation(); }
  }

  async function liveGenerateQuestions(prep) {
    var op = beginOperation('Подбираю вопросы…');
    if (!op) return;
    try {
      var data = await Api.request('POST', '/api/preps/' + prep.serverId + '/questions', undefined, op);
      Store.update(function () { prep.questions = data.questions; if (data.source) prep.sources.questions = data.source; });
    } catch (e) { liveFail(e); } finally { endOperation(); }
  }

  /* Обратная связь на один ответ: запрос по вопросу, состояние и ошибка
     хранятся по questionId, чтобы остальные вопросы не блокировались. */
  async function liveFeedback(prep, questionId) {
    var answer = String(prep.answers[questionId] || '').trim();
    if (!answer) { UI.toast('Сначала напишите ответ на вопрос.'); return; }
    if (prep.feedbackBusy[questionId]) return;
    if (answersTimer) { clearTimeout(answersTimer); answersTimer = null; }
    Store.update(function () { prep.feedbackBusy[questionId] = true; prep.feedbackError[questionId] = ''; });
    try {
      await Api.request('PUT', '/api/preps/' + prep.serverId + '/answers', { answers: prep.answers, ready: prep.ready });
      var data = await Api.request('POST', '/api/preps/' + prep.serverId + '/feedback', { questionId: questionId }, { timeoutMs: 90000 });
      Store.update(function () {
        prep.feedback[questionId] = data.feedback;
        if (data.state) prep.state = data.state;
      });
    } catch (e) {
      Store.update(function () { prep.feedbackError[questionId] = e.message; });
    } finally {
      Store.update(function () { prep.feedbackBusy[questionId] = false; });
    }
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
    var op = beginOperation('Интервьюер готовит первый вопрос…');
    if (!op) return;
    try {
      var first = await Api.request('POST', '/api/preps/' + prep.serverId + '/interviews', { mode: voice.active && voice.prepId === prep.id ? 'voice' : 'text' }, op);
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
    } catch (e) { liveFail(e); } finally { endOperation(); }
  }

  /* ---- Голосовая тренировка ----
     Реплика интервьюера приходит потоком, режется на фразы (TextSegment)
     и озвучивается очередью (TextToSpeech.createSpeaker) с предвыборкой.
     Кандидат отвечает микрофоном (STT-виджет) или текстом. Начало записи
     прерывает речь (barge-in). Всё живёт в памяти вкладки. */
  var voice = { active: false, prepId: null, provider: '', speaker: null, segmenter: null, tts: null };

  function voiceUi(patch) {
    var s = Store.get();
    s.voiceUi = Object.assign(s.voiceUi || { state: 'idle', stats: null, mock: false, error: '' }, patch || {});
    Store.notify();
  }

  function voiceProviders() {
    var caps = TextToSpeech.capabilities();
    var list = [];
    if (caps.browser) list.push({ value: 'browser', label: 'В браузере (Web Speech, без сервера)' });
    var srv = voice.tts;
    list.push({ value: 'server', label: srv && srv.live ? 'Сервер (' + srv.provider + (srv.voice ? ', ' + srv.voice : '') + ')' : 'Сервер (заглушка без звука)' });
    list.push({ value: 'mock', label: 'Без звука (только текст)' });
    return list;
  }

  function voiceDefaultProvider() {
    if (voice.provider) return voice.provider;
    var caps = TextToSpeech.capabilities();
    if (voice.tts && voice.tts.live) return 'server';
    return caps.browser ? 'browser' : 'mock';
  }

  function ensureSpeaker(providerId) {
    if (voice.speaker && voice.provider === providerId) return voice.speaker;
    if (voice.speaker) voice.speaker.cancel();
    voice.provider = providerId;
    var impl = TextToSpeech.provider({ provider: providerId, lang: 'ru-RU' });
    voice.speaker = TextToSpeech.createSpeaker({ provider: impl, prefetch: 2,
      onState: function (s) { voiceUi({ state: s.state, stats: s.stats, mock: s.mock }); },
      onError: function (e, text) {
        /* Сервер синтеза упал посреди разговора: договариваем голосом браузера,
           если он есть; иначе остаёмся с текстом. Фраза не теряется. */
        if (providerId === 'server' && TextToSpeech.capabilities().browser) {
          ensureSpeaker('browser');
          voice.speaker.enqueue(text);
          voiceUi({ error: 'Сервер синтеза недоступен: продолжаю голосом браузера.' });
          return;
        }
        voiceUi({ error: 'Синтез не удался: ' + (e && e.message ? e.message : 'ошибка') + '. Текст реплики виден ниже.' });
      } });
    voiceUi({ state: 'idle', mock: impl.mock, error: '' });
    return voice.speaker;
  }

  async function voiceLoadTts() {
    if (voice.tts || !Api.live.enabled) return;
    try { voice.tts = await Api.request('GET', '/api/tts'); } catch (e) { voice.tts = { provider: 'unknown', live: false }; }
    Store.notify();
  }

  function voiceBeginTurn() {
    if (!voice.active) return;
    voice.segmenter = TextSegment.createStream();
    voice.speaker.beginTurn();
  }
  function voiceFeed(delta) {
    if (!voice.active || !voice.segmenter) return;
    voice.segmenter.feed(delta).forEach(function (c) { voice.speaker.enqueue(c); });
  }
  function voiceFlush() {
    if (!voice.active || !voice.segmenter) return;
    voice.segmenter.flush().forEach(function (c) { voice.speaker.enqueue(c); });
    voice.segmenter = null;
  }
  function voiceSpeakWhole(text) {
    if (!voice.active) return;
    voiceBeginTurn();
    voiceFeed(text);
    voiceFlush();
  }
  function voiceInterrupt() {
    if (voice.speaker) voice.speaker.cancel();
    voice.segmenter = null;
  }
  function voiceStop() {
    voiceInterrupt();
    voice.active = false; voice.prepId = null;
    voiceUi({ state: 'idle' });
  }

  async function liveVoiceStart(prep) {
    var providerId = voiceDefaultProvider();
    ensureSpeaker(providerId);
    voice.active = true; voice.prepId = prep.id;
    voiceUi({ error: '' });
    var chat = ScreensPrep.ensureChat(prep);
    if (!chat.started || chat.finished) {
      await liveStartChat(prep);
      var first = prep.chat && prep.chat.messages.filter(function (m) { return m.who === 'bot'; }).slice(-1)[0];
      if (first && voice.active) voiceSpeakWhole(first.text);
    } else {
      var last = chat.messages.filter(function (m) { return m.who === 'bot'; }).slice(-1)[0];
      if (last) voiceSpeakWhole(last.text);
    }
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

  async function liveSendChat(prep, signal) {
    var chat = prep.chat;
    var text = String(chat.draft || '').trim();
    if (!text) { UI.toast('Введите ответ, чтобы отправить его.'); return; }
    var speaking = voice.active && voice.prepId === prep.id;
    var turn = { text: text, clientTurnId: newTurnId(), mode: speaking ? 'voice' : 'text' };
    Store.update(function () {
      chat.messages.push({ who: 'user', text: text });
      chat.draft = ''; chat.failed = false; chat.pending = true; chat.partial = ''; chat.status = '';
      chat.lastTurn = turn;
    });
    if (speaking) { voiceInterrupt(); voiceBeginTurn(); }
    try {
      var done = await Api.stream('/api/interviews/' + chat.interviewId + '/turns', turn, function (delta) {
        chat.partial += delta; chat.status = '';
        if (speaking) voiceFeed(delta);
        Store.notify();
      }, function (status) {
        chat.status = status;
        Store.notify();
      }, signal);
      if (speaking) {
        /* Ответ мог прийти без потока (дубль реплики): озвучить целиком. */
        if (!chat.partial && done.turn && done.turn.text) voiceFeed(done.turn.text);
        voiceFlush();
      }
      Store.update(function () { applyTurnResult(chat, done); });
    } catch (e) {
      if (speaking) voiceInterrupt();
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
    var op = beginOperation('Готовлю итог интервью…');
    if (!op) return;
    try {
      var data = await Api.request('POST', '/api/interviews/' + chat.interviewId + '/finish', undefined, op);
      Store.update(function () {
        chat.summary = data.summary; chat.finished = true;
        Store.get().pending = null;
        Store.addHistory('Текстовое пробное интервью', '#/prep/' + prep.id + '/interview', prep.id);
      });
    } catch (e) { liveFail(e); } finally { endOperation(); }
  }

  async function liveReview() {
    if (uploadOperation || Store.get().pending || !Api.live.enabled) return;
    var up = Store.get().upload;
    var text = String(up.text || '').trim();
    if (text.length < 40 || text.length > 40000) {
      Store.update(function (s) { s.upload.error = 'Нужно от 40 до 40 000 символов текста резюме.'; }); return;
    }
    var op = new AbortController(); uploadOperation = op;
    var started = Date.now();
    Store.update(function (s) { s.upload.busy = true; s.upload.error = ''; s.upload.fileError = false;
      s.upload.report = null; s.upload.analysisShown = false; s.upload.phase = 'Сохранение текста…'; s.upload.elapsed = 0; });
    var ticker = setInterval(function () { Store.update(function (s) { s.upload.elapsed = Math.floor((Date.now() - started) / 1000); }); }, 1000);
    try {
      setPending('Отправляю резюме…');
      var created = up.created;
      if (!created || created.data.rawText !== text) {
        created = await Api.request('POST', '/api/resumes', {
          title: up.fileName || ('Резюме из текста ' + Api.label()), data: { rawText: text }
        }, { signal: op.signal });
        up.created = created;
      }
      if (op.signal.aborted) throw new Error('Запрос отменён.');
      uploadPhase('Анализ моделью — ожидание ответа');
      setPending('Разбираю резюме…');
      var data = await Api.request('POST', '/api/resumes/' + created.id + '/review', undefined, { signal: op.signal });
      if (op.signal.aborted) throw new Error('Запрос отменён.');
      Store.update(function (s) {
        s.upload.report = data.review; s.upload.decisions = {}; s.upload.analysisShown = true;
        s.upload.source = data.source; s.upload.mock = data.mock === true; s.upload.phase = 'Разбор завершён';
        s.upload.serverResume = Api.resumeFromServer(Object.assign({}, created, { review: data.review }));
      });
    } catch (e) {
      Store.update(function (s) { s.upload.error = e.message; s.upload.phase = 'Разбор не завершён'; s.upload.analysisShown = false; });
    } finally {
      clearInterval(ticker);
      if (uploadOperation === op) uploadOperation = null;
      Store.update(function (s) { s.pending = null; s.upload.busy = false; });
    }
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
    if (act.indexOf('qs:') === 0) { QuickStart.act(act.slice(3)); return; }

    if (act.indexOf('go:') === 0) {
      var target = act.slice(3);
      if (data.prep) state.activePrepId = data.prep;
      go(target);
      return;
    }

    switch (act) {
      /* -------- Оболочка -------- */
      case 'auth:logout':
        cancelUpload(); selectedFile = null;
        if (authBusy) return;
        authBusy = true;
        adminUsage.data = null; adminUsage.owner = null; adminUsage.error = '';
        Api.request('POST', '/api/auth/logout').then(async function () {
          QuickStart.resetMemory();
          QuickStart.announceAccountChange();
          if (answersTimer) { clearTimeout(answersTimer); answersTimer = null; }
          Api.live.user = null;
          Store.replaceData({});
          await liveHydrate();
          go('#/auth/login');
        }).catch(liveFail).finally(function () { authBusy = false; render(); });
        return;
      case 'nav:toggle':
        document.body.setAttribute('data-nav',
          document.body.getAttribute('data-nav') === 'open' ? 'closed' : 'open');
        render();
        return;
      case 'nav:close':
        document.body.setAttribute('data-nav', 'closed');
        render();
        document.getElementById('menu-toggle').focus();
        return;
      case 'theme:toggle':
        Store.setPref('theme', state.theme === 'dark' ? 'light' : 'dark');
        return;
      case 'demopanel:close':
        Store.setPref('demoPanelOpen', false);
        document.querySelector('[data-act="demopanel:toggle"]')?.focus();
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
      case 'upload:cancel':
        cancelUpload(); return;
      case 'upload:retry-file':
        if (selectedFile) readResumeFile(selectedFile); return;
      case 'upload:clear':
        if (uploadOperation) return;
        selectedFile = null;
        Store.update(function (s) { s.upload = { fileName: '', text: '', decisions: {} }; });
        UI.toast('Выбор файла удалён.');
        return;
      case 'upload:review':
        if (!state.pending) liveReview();
        return;
      case 'upload:show-analysis':
        if (Api.isHttp() || state.upload.fileName || state.upload.text || uploadOperation) return;
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
        if (Api.isHttp()) return;
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
      case 'card:build': {
        var prepC = Store.prepById(data.id) || Store.activePrep();
        if (prepC && prepC.live && !state.pending) liveBuildCard(prepC);
        return;
      }
      case 'q:feedback': {
        var prepF = Store.activePrep();
        if (prepF && prepF.live) liveFeedback(prepF, data.id);
        else UI.toast('Обратная связь на ответ доступна в режиме сервера.');
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
      case 'voice:tts': {
        voice.provider = data.value;
        if (voice.active) ensureSpeaker(data.value);
        Store.notify();
        return;
      }
      case 'voice:interrupt':
        voiceInterrupt();
        return;
      case 'voice:send-text': {
        var prepV = Store.activePrep();
        if (prepV && prepV.live && prepV.chat && !prepV.chat.pending) liveSendChat(prepV);
        return;
      }
      case 'voice:start': {
        var prep13 = Store.activePrep();
        if (!prep13) return;
        if (prep13.live) { if (!state.pending) liveVoiceStart(prep13); return; }
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
          body: Store.activePrep() && Store.activePrep().live
            ? '<p>Сервер подготовит итог по репликам этой тренировки. Звук не сохранялся.</p>'
            : '<p>Откроется демонстрационный итог. Звук не записывался.</p>',
          act: 'voice:finish-confirm', confirmLabel: 'Завершить'
        });
        return;
      case 'voice:finish-confirm': {
        var prep17 = Store.activePrep();
        if (prep17 && prep17.live) { voiceStop(); if (prep17.chat && prep17.chat.started && !prep17.chat.finished) liveFinishChat(prep17); return; }
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
        voiceStop();
        Store.update(function () { prep18.voice = null; if (prep18.live) prep18.chat = null; });
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
      case 'assistant:consent':
        Store.update(function (s) { s.assistant.consent = !!data.checked; });
        return;
      case 'assistant:extract':
        liveAssistant('extract');
        return;
      case 'assistant:hint':
        liveAssistant('hint');
        return;
      case 'assistant:cancel':
        if (assistantOp) assistantOp.abort();
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
      case 'resume:import-hh':
        if (!Api.live.enabled) { dispatch('stub:import', {}); return; }
        liveImportHhResume();
        return;
      case 'resume:import-hh-cancel':
        if (hhResumeOperation) hhResumeOperation.abort();
        return;
      case 'resume:import-hh-save':
        liveSaveHhResume();
        return;
      case 'resume:import-hh-clear':
        Store.update(function (s) { s.hhResume = { url: '', busy: false, error: '', preview: null }; });
        return;
      case 'jobs:search':
        liveJobsSearch(0);
        return;
      case 'jobs:page':
        liveJobsSearch(Number(data.page) || 0);
        return;
      case 'jobs:resume':
        Store.update(function (s) { s.jobs.query = ''; s.jobs.result = null; });
        liveJobsSearch(0);
        return;
      case 'jobs:prepare':
        jobsPrepare(String(data.url || ''));
        return;
      case 'vacancy:import':
        if (!Api.live.enabled) { dispatch('stub:import', {}); return; }
        liveImportVacancy();
        return;
      case 'vacancy:import-cancel':
        cancelImport();
        return;
      case 'op:cancel':
        cancelOperation();
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

  document.addEventListener('submit', async function (event) {
    if (event.target.id !== 'auth-form') return;
    event.preventDefault();
    if (authBusy) return;
    var form = event.target;
    var routeAtSubmit = window.location.hash;
    authBusy = true;
    authError = '';
    document.getElementById('auth-error').textContent = '';
    document.getElementById('auth-submit').disabled = true;
    form.setAttribute('aria-busy', 'true');
    try {
      var result = await Api.request('POST', '/api/auth/' + form.getAttribute('data-auth-mode'), {
        username: form.elements.username.value, password: form.elements.password.value
      });
      Api.live.user = result.user;
      QuickStart.announceAccountChange();
      Store.replaceData({});
      await liveHydrate();
      var destination = QuickStart.afterLogin(form.getAttribute('data-auth-mode') === 'register');
      if (window.location.hash === routeAtSubmit) go(destination);
    } catch (e) {
      if (window.location.hash === routeAtSubmit) authError = e.message || 'Не удалось войти. Повторите попытку.';
    } finally {
      authBusy = false;
      if (form.elements.password) form.elements.password.value = '';
      var password = document.getElementById('auth-password');
      if (password) password.value = '';
      render();
      if (authError && password) document.getElementById('auth-password').focus();
    }
  });

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
      status: element.getAttribute('data-status'),
      url: element.getAttribute('data-url'),
      page: element.getAttribute('data-page')
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
    if (model === 'upload.text') {
      if (uploadOperation) return;
      Store.update(function (s) { s.upload.text = element.value; s.upload.analysisShown = false; s.upload.report = null;
        s.upload.serverResume = null; s.upload.error = ''; s.upload.fileError = false; s.upload.phase = 'Текст изменён — готов к разбору'; });
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
    if (event.key === 'Escape' && document.body.getAttribute('data-nav') === 'open') dispatch('nav:close', {});
    if (event.key === 'Escape' && Store.get().demoPanelOpen && !Store.get().modal) dispatch('demopanel:close', {});
    if (event.key === 'Escape' && Store.get().modal) {
      UI.closeModal();
    }
  });

  window.addEventListener('storage', function (event) {
    if (event.key !== 'easyjob:auth:change' && event.key !== null) return;
    cancelUpload(); selectedFile = null;
    if (answersTimer) { clearTimeout(answersTimer); answersTimer = null; }
    adminUsage.data = null; adminUsage.owner = null; adminUsage.error = '';
  });
  window.addEventListener('pagehide', function () { cancelUpload(); if (speechWidget) { speechWidget.dispose(); speechWidget = null; } });
  window.addEventListener('hashchange', function () {
    cancelUpload();
    if (!bootComplete) return;
    document.body.setAttribute('data-nav', 'closed');
    render();
    var main = document.getElementById('main');
    if (main) { main.focus({ preventScroll: true }); main.scrollIntoView({ block: 'start' }); }
  });

  Store.subscribe(render);

  /* ---------------- Запуск ---------------- */

  if (!window.location.hash) window.location.hash = '#/start';

  (async function boot() {
    var isLive = await Api.detect();
    if (isLive) {
      try { await liveHydrate(); } catch (e) { UI.toast('Не удалось загрузить данные с сервера: ' + e.message); }
    }
    bootComplete = true;
    render();
    window.setTimeout(function () {
      if (PUBLIC_ROUTES.indexOf(parseRoute().name) >= 0) return;
      UI.toast(isLive
        ? 'Режим сервера: данные хранятся в базе' + (Api.live.ai && Api.live.ai.live ? ', ответы — от модели.' : ', модель пока на заглушке.')
        : 'Демо-макет: введённые данные хранятся только в этой вкладке и сбрасываются после перезагрузки.');
    }, 600);
  })();
})();
