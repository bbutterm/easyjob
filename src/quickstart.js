/* Account-only guided preparation. Only bounded status metadata is persisted. */
var QuickStart = (function () {
  'use strict';
  var prefix = 'easyjob:quickstart:v1:';
  var owner = null, status = null, seen = false, epoch = 0, busy = false, error = '';
  var resumeId = '', vacancyId = '', draft = {};
  var titles = ['Добро пожаловать', 'Резюме', 'Проверка резюме', 'Вакансия',
    'Требования и сопоставление', 'Вопросы и первый ответ', 'Текстовое интервью', 'Что дальше'];
  function fresh() { return { step: 0, completed: [], skipped: [], finished: false, timestamp: Date.now() }; }
  function clean(value) {
    var s = fresh();
    if (!value || typeof value !== 'object') return s;
    s.step = Number.isInteger(value.step) && value.step >= 0 && value.step < 8 ? value.step : 0;
    ['completed', 'skipped'].forEach(function (key) {
      s[key] = Array.isArray(value[key]) ? value[key].filter(function (v, i, a) {
        return Number.isInteger(v) && v >= 0 && v < 8 && a.indexOf(v) === i;
      }).slice(0, 8) : [];
    });
    s.finished = value.finished === true;
    return s;
  }
  function announceAccountChange() {
    try { window.localStorage.setItem('easyjob:auth:change', Date.now() + ':' + Math.random()); } catch (_) {}
  }
  window.addEventListener('storage', function (event) {
    if (!eligible() || (event.key !== 'easyjob:auth:change' && event.key !== null)) return;
    resetMemory(); Api.live.user = null; Store.replaceData({});
    navigate('#/auth/login'); refresh();
  });
  function eligible() { return Api.isHttp() && !!Api.live.user; }
  function resetMemory() {
    epoch++; owner = null; status = null; seen = false; busy = false; error = '';
    resumeId = ''; vacancyId = ''; draft = {};
  }
  function bind() {
    var id = eligible() ? String(Api.live.user.id) : null;
    if (owner === id) return;
    resetMemory();
    if (!id) return;
    owner = id;
    try {
      var raw = window.localStorage.getItem(prefix + encodeURIComponent(id));
      seen = !!raw;
      status = clean(raw ? JSON.parse(raw) : null);
    } catch (_) { status = fresh(); }
  }
  function save() {
    if (!eligible() || owner !== String(Api.live.user.id) || !status) return;
    status.timestamp = Date.now(); seen = true;
    try { window.localStorage.setItem(prefix + encodeURIComponent(owner), JSON.stringify(status)); } catch (_) {}
  }
  function afterLogin(isRegister) {
    bind();
    var first = !seen && (isRegister || (!Store.get().resumes.length && !Store.get().preps.length && !Store.get().vacancies.length));
    save();
    return first ? '#/quickstart' : '#/overview';
  }
  function context() {
    var s = Store.get();
    var resumes = s.resumes.filter(function (r) { return !!r.serverId; });
    var active = s.preps.find(function (p) { return p.id === s.activePrepId; });
    var r = resumes.find(function (r) { return r.id === (resumeId || (active && active.resumeId)); }) || resumes[0];
    var v = s.vacancies.find(function (v) { return v.id === (vacancyId || (active && active.vacancyId)); }) || s.vacancies[0];
    var p = r && v && s.preps.find(function (p) { return p.resumeId === r.id && p.vacancyId === v.id; });
    return { r: r, v: v, p: p, resumes: resumes };
  }
  function facts(c) {
    var matched = !!(c.p && !c.p.stale && c.p.match && c.p.match.length);
    return [status.completed.indexOf(0) >= 0, !!c.r, !!(c.r && c.r.review), !!c.v,
      matched, !!(matched && c.p.questions && c.p.questions.length),
      !!(matched && (c.p.interviewStarted || (c.p.chat && c.p.chat.started))), status.completed.indexOf(7) >= 0];
  }
  function sync() {
    bind();
    if (!status) return;
    var done = facts(context()).reduce(function (a, yes, i) { if (yes) a.push(i); return a; }, []);
    if (JSON.stringify(done) !== JSON.stringify(status.completed)) { status.completed = done; save(); }
  }
  function button(act, label, primary, disabled) {
    return '<button type="button" class="btn' + (primary ? ' btn--primary' : '') + '" data-act="qs:' + act + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
  }
  function field(id, label, area) {
    return '<label class="field" for="qs-' + id + '"><span class="field__label">' + label + '</span>'
      + (area ? '<textarea rows="7" maxlength="40000"' : '<input maxlength="200"') + ' id="qs-' + id + '" data-qs-draft="' + id + '"'
      + (area ? '>' + UI.esc(draft[id] || '') + '</textarea>' : ' value="' + UI.esc(draft[id] || '') + '">') + '</label>';
  }
  function select(kind, items, current) {
    return '<label class="field" for="qs-select-' + kind + '"><span class="field__label">Выбрать ' + (kind === 'resume' ? 'резюме' : 'вакансию') + '</span>'
      + '<select id="qs-select-' + kind + '" data-qs-select="' + kind + '">' + items.map(function (x) {
        return '<option value="' + UI.esc(x.id) + '"' + (current && current.id === x.id ? ' selected' : '') + '>' + UI.esc(x.title) + '</option>';
      }).join('') + '</select></label>';
  }
  function reviewText(review) {
    function lines(value) {
      if (Array.isArray(value)) return value.map(lines).join('\n\n');
      if (value && typeof value === 'object') return Object.keys(value).map(function (key) { return lines(value[key]); }).join('\n');
      return UI.esc(String(value == null ? '' : value));
    }
    return lines(review);
  }
  function screen() {
    sync();
    if (!status) return '';
    save();
    var c = context(), i = status.step, done = facts(c)[i], body = '', action = 'continue', label = 'Продолжить';
    if (i === 0) body = '<p>Пройдём путь от резюме до первой подготовки и текстовой тренировки. Любой шаг можно пропустить или продолжить позже.</p>'
      + '<p>Резюме, вакансия и ответы сохраняются на сервере. При запуске AI соответствующие данные передаются настроенному провайдеру. Удалите лишние персональные данные и контакты. Продолжая, вы подтверждаете, что ознакомились с этим порядком.</p><a href="#/privacy">Обработка данных</a>';
    if (i === 1) {
      body = '<p>Создайте резюме из текста или выберите сохранённое. На этом шаге AI ещё не вызывается.</p>';
      if (c.resumes.length) body += select('resume', c.resumes, c.r) + '<a href="#/resume/' + UI.esc(c.r.id) + '">Открыть резюме</a>';
      body += '<details' + (!c.r ? ' open' : '') + '><summary>Создать другое резюме</summary>' + field('resumeTitle', 'Название резюме') + field('resumeText', 'Текст резюме', true)
        + (c.r ? button('resume', 'Сохранить другое резюме') : '') + '</details>';
      if (!c.r) { action = 'resume'; label = 'Сохранить резюме'; }
    }
    if (i === 2) {
      body = '<p>AI проверит ясность формулировок, опыт и навыки и предложит улучшения. Проверьте рекомендации: модель может ошибаться, изменения не применяются автоматически.</p>';
      if (c.r) body += '<p>Резюме: <b>' + UI.esc(c.r.title) + '</b></p>';
      if (done) body += '<details open><summary>Результат проверки</summary><pre class="qs-result">' + reviewText(c.r.review) + '</pre></details>';
      else { action = 'review'; label = 'Проверить резюме с AI'; }
    }
    if (i === 3) {
      body = '<p>Выберите вакансию или вставьте её текст. При сохранении сервер выделяет требования с AI; следующий шаг сопоставит их с резюме.</p>';
      if (c.v) body += select('vacancy', Store.get().vacancies, c.v);
      body += '<details' + (!c.v ? ' open' : '') + '><summary>Создать другую вакансию</summary>' + field('vacancyTitle', 'Должность') + field('company', 'Компания (необязательно)') + field('vacancyText', 'Текст вакансии', true)
        + (c.v ? button('vacancy', 'Сохранить другую вакансию') : '') + '</details>';
      if (!c.v) { action = 'vacancy'; label = 'Сохранить и выделить требования'; }
    }
    if (i === 4) {
      body = '<p>AI сопоставит требования вакансии с опытом и отметит сильные стороны и пробелы. Это помощь в подготовке, а не решение о найме.</p>';
      if (c.r && c.v) body += '<p>' + UI.esc(c.r.title) + ' → ' + UI.esc(c.v.title) + '</p>';
      if (done) body += '<p>Сопоставление готово: ' + c.p.match.length + ' пунктов.</p><a href="#/prep/' + UI.esc(c.p.id) + '/match">Посмотреть сопоставление</a>';
      else { action = 'match'; label = c.p ? 'Пересобрать подготовку' : 'Создать подготовку'; }
    }
    if (i === 5) {
      body = '<p>Получите вопросы по выбранной подготовке. Можно записать первый ответ сейчас или вернуться к нему позже.</p>';
      if (done) {
        var q = c.p.questions[0];
        body += '<p><b>' + UI.esc(q.text) + '</b></p>' + field('answer', 'Ваш ответ (необязательно)', true)
          + button('answer', 'Сохранить ответ') + (c.p.answers[q.id] ? '<p role="status">Ответ сохранён на сервере.</p>' : '')
          + '<a href="#/prep/' + UI.esc(c.p.id) + '/questions">Все вопросы и ответы</a>';
      } else { action = 'questions'; label = 'Сгенерировать вопросы'; }
    }
    if (i === 6) {
      body = '<p>Откройте текстовую тренировку и нажмите «Начать интервью», чтобы получить первый вопрос. Ответ можно набрать с клавиатуры; микрофон не нужен. Вернуться сюда можно через Quick Start в меню.</p>';
      if (!done) { action = 'interview'; label = 'Открыть текстовую тренировку'; }
      else body += '<p>Текстовое интервью уже начато.</p><a href="#/prep/' + UI.esc(c.p.id) + '/interview">Вернуться к интервью</a>';
    }
    if (i === 7) {
      body = '<p>Live-интервью и распознавание речи (STT) — отдельный следующий этап. Открытие тренировки не включает запись звука.</p>'
        + '<p>Перед live-сессией отдельно проверьте настройки провайдера, разрешения на запись и согласие участников. Mock или ненастроенный STT не означает работающее распознавание.</p>'
        + '<a href="#/assistant">Следующее действие: изучить live-помощник и его настройки</a>';
      label = 'Завершить Quick Start';
    }
    var needs = (i === 2 && !c.r) || (i === 4 && (!c.r || !c.v)) || ((i === 5 || i === 6) && !facts(c)[4]);
    if (needs) body += '<p role="status">Сначала выберите резюме и вакансию и создайте подготовку на предыдущих шагах. Можно вернуться назад или пропустить этот шаг.</p>';
    return '<section class="quickstart" aria-labelledby="qs-title" aria-busy="' + busy + '">'
      + '<p class="muted">Quick Start · Шаг ' + (i + 1) + ' из 8 · Выполнено ' + status.completed.length + ' из 8</p>'
      + '<progress max="8" value="' + status.completed.length + '" aria-label="Выполнено шагов"></progress>'
      + '<ol class="qs-steps">' + titles.map(function (t, n) { return '<li' + (n === i ? ' aria-current="step"' : '') + '>' + t + ' — '
        + (status.completed.indexOf(n) >= 0 ? 'Готово' : status.skipped.indexOf(n) >= 0 ? 'Пропущено' : n === i ? 'Сейчас' : 'Впереди') + '</li>'; }).join('') + '</ol>'
      + '<h1 id="qs-title" tabindex="-1">' + titles[i] + '</h1>'
      + '<p class="note">Pre-interview в текущей production-конфигурации использует OpenRouter. Текущий сервер: '
      + UI.esc(Api.live.ai && Api.live.ai.live ? (Api.live.ai.title || Api.live.ai.provider) : 'заглушка AI; результаты демонстрационные') + '. Live/STT проверяется отдельно.</p>'
      + (done ? '<p class="tag tag--ok">Этот шаг уже выполнен — можно продолжить.</p>' : '') + body
      + '<p id="qs-error" role="alert">' + UI.esc(error) + '</p>'
      + (busy ? '<p role="status">Ожидаем ответ сервера… Можно открыть другой раздел.</p>' : '')
      + '<div class="qs-actions">' + button(action, error && action !== 'continue' ? 'Повторить: ' + label : label, true, busy || needs)
      + button('back', 'Назад', false, i === 0) + button('skip', 'Пропустить этот шаг')
      + button('later', 'Продолжить позже') + button('restart', 'Начать Quick Start заново') + '</div></section>';
  }
  function navigate(hash) { window.location.hash = hash; }
  function refresh(focus) {
    Store.notify();
    if (focus && window.location.hash === '#/quickstart') {
      var h = document.getElementById('qs-title'); if (h) h.focus();
    }
  }
  async function act(action) {
    bind(); if (!status) return;
    if (action === 'restart') {
      epoch++; busy = false; status = fresh(); draft = {}; error = ''; save(); navigate('#/quickstart'); refresh(true); return;
    }
    if (action === 'later') { save(); navigate('#/overview'); return; }
    if (action === 'back' || action === 'skip' || action === 'continue') {
      var i = status.step;
      if (action === 'continue' && !facts(context())[i] && i !== 0 && i !== 7) return;
      if (action === 'continue' && (i === 0 || i === 7)) status.completed.push(i);
      if (action === 'skip' && status.skipped.indexOf(i) < 0) status.skipped.push(i);
      status.step = Math.max(0, Math.min(7, i + (action === 'back' ? -1 : 1)));
      error = ''; save();
      if (i === 7 && action !== 'back') { status.finished = true; save(); navigate('#/overview'); }
      refresh(true); return;
    }
    if (busy) return;
    var c = context();
    if (action === 'interview') {
      if (!facts(c)[4]) return;
      Store.get().activePrepId = c.p.id; navigate('#/prep/' + c.p.id + '/interview'); return;
    }
    var token = epoch, user = owner;
    function current() { return token === epoch && eligible() && String(Api.live.user.id) === user; }
    busy = true; error = ''; refresh();
    try {
      // Cookies may have changed in another tab. Recheck the owner before writing.
      var me = await Api.request('GET', '/api/me');
      if (!current()) return;
      if (!me.user || String(me.user.id) !== user) throw new Api.ApiError(401, 'Аккаунт изменился или сессия истекла. Войдите снова.');
      var result;
      if (action === 'resume') {
        if (!String(draft.resumeTitle || '').trim() || String(draft.resumeText || '').trim().length < 40) throw new Error('Введите название и текст резюме (не менее 40 символов).');
        result = Api.resumeFromServer(await Api.request('POST', '/api/resumes', { title: draft.resumeTitle, data: { rawText: draft.resumeText } }));
        if (!current()) return;
        Store.get().resumes.unshift(result); resumeId = result.id; delete draft.resumeText; delete draft.resumeTitle;
      } else if (action === 'review' && c.r) {
        result = await Api.request('POST', '/api/resumes/' + c.r.serverId + '/review');
        if (!current()) return; c.r.review = result.review;
      } else if (action === 'vacancy') {
        if (!String(draft.vacancyTitle || '').trim() || String(draft.vacancyText || '').trim().length < 40) throw new Error('Введите должность и текст вакансии (не менее 40 символов).');
        result = Api.vacancyFromServer(await Api.request('POST', '/api/vacancies', { title: draft.vacancyTitle, company: draft.company || '', rawText: draft.vacancyText }));
        if (!current()) return;
        Store.get().vacancies.unshift(result); vacancyId = result.id; delete draft.vacancyText; delete draft.vacancyTitle; delete draft.company;
      } else if (action === 'match' && c.r && c.v) {
        result = Api.prepFromServer(await Api.request('POST', c.p ? '/api/preps/' + c.p.serverId + '/rebuild' : '/api/preps',
          c.p ? {} : { resumeId: c.r.serverId, vacancyId: c.v.serverId, profession: c.r.profession || c.v.title }));
        if (!current()) return;
        if (c.p) Object.assign(c.p, result); else Store.get().preps.unshift(result);
        Store.get().activePrepId = result.id;
      } else if (action === 'questions' && facts(c)[4]) {
        result = await Api.request('POST', '/api/preps/' + c.p.serverId + '/questions');
        if (!current()) return; c.p.questions = result.questions;
      } else if (action === 'answer' && facts(c)[5]) {
        if (!String(draft.answer || '').trim()) throw new Error('Введите ответ или продолжите без него.');
        var answers = Object.assign({}, c.p.answers); answers[c.p.questions[0].id] = draft.answer;
        await Api.request('PUT', '/api/preps/' + c.p.serverId + '/answers', { answers: answers, ready: c.p.ready });
        if (!current()) return; c.p.answers = answers; delete draft.answer;
      }
      if (current()) sync();
    } catch (e) {
      if (current()) {
        error = (e.message || 'Ошибка сервера') + ' Шаг не отмечен выполненным. Повторите действие.';
        if (e.status === 401) { resetMemory(); Api.live.user = null; Store.replaceData({}); navigate('#/auth/login'); }
      }
    } finally { if (current()) { busy = false; refresh(); } }
  }
  document.addEventListener('input', function (e) {
    var key = e.target.getAttribute('data-qs-draft');
    if (eligible() && ['resumeTitle', 'resumeText', 'vacancyTitle', 'vacancyText', 'company', 'answer'].indexOf(key) >= 0) draft[key] = e.target.value;
  });
  document.addEventListener('change', function (e) {
    var kind = e.target.getAttribute('data-qs-select');
    if (!kind || !eligible()) return;
    if (kind === 'resume') resumeId = e.target.value; else vacancyId = e.target.value;
    draft.answer = ''; error = ''; sync(); refresh();
  });
  return { screen: screen, act: act, bind: bind, sync: sync, afterLogin: afterLogin, resetMemory: resetMemory, eligible: eligible, announceAccountChange: announceAccountChange };
})();
