/* ============================================================
   Экраны: вход, обзор, резюме (мастер, загрузка, список),
   вакансии.
   Каждая функция возвращает HTML-строку рабочей области.
   ============================================================ */

var ScreensCore = (function () {
  'use strict';

  var esc = UI.esc;
  var escLines = UI.escLines;
  var note = UI.note;

  /* ---------------- Вспомогательное ---------------- */

  function pageHead(title, text) {
    return '<div class="page-head"><h1>' + esc(title) + '</h1>'
      + (text ? '<p>' + esc(text) + '</p>' : '') + '</div>';
  }

  function prepTitle(prep) {
    var vacancy = Store.vacancyById(prep.vacancyId);
    var resume = Store.resumeById(prep.resumeId);
    return (vacancy ? vacancy.title + ' · ' + vacancy.company : 'Вакансия не выбрана')
      + ' — ' + (resume ? resume.title : 'резюме не выбрано');
  }

  function staleBanner(prep) {
    if (!prep || !prep.stale) return '';
    return note('demo',
      '<div><strong>Отчёты относятся к предыдущей версии исходников.</strong> '
      + esc(prep.staleReason || 'Резюме или вакансия изменились после демонстрационного анализа.')
      + ' Пока показан прежний результат. '
      + '<button type="button" class="btn btn--sm btn--primary" style="margin-top:8px" '
      + 'data-act="prep:rebuild" data-id="' + esc(prep.id) + '">Пересобрать демо</button></div>');
  }

  function nextStep(prep) {
    if (!prep) return { label: 'Добавить вакансию', route: '#/vacancy/new' };
    var answered = Object.keys(prep.answers || {}).length;
    if (prep.stale) return { label: 'Пересобрать демонстрационный анализ', route: '#/prep/' + prep.id + '/match' };
    if (answered === 0) return { label: 'Разобрать вопросы для подготовки', route: '#/prep/' + prep.id + '/questions' };
    if (!prep.chat || !prep.chat.finished) return { label: 'Пройти текстовое пробное интервью', route: '#/prep/' + prep.id + '/interview' };
    if (!prep.voice || !prep.voice.finished) return { label: 'Попробовать голосовой формат', route: '#/prep/' + prep.id + '/voice' };
    return { label: 'Повторить тренировку', route: '#/prep/' + prep.id + '/interview' };
  }

  /* ---------------- Публичные страницы ---------------- */

  function helper() {
    return '<span class="ai-helper" aria-hidden="true"><i></i><i></i><b>⌣</b></span>';
  }

  function brand() {
    return '<a class="wordmark" href="#/start">easyjob<span>Карьерный помощник</span></a>';
  }

  function modeLabel() {
    return Api.isHttp() ? (Api.live.user ? 'Аккаунт · ' + esc(Api.live.user.username) : 'Сервер · гостевой доступ')
      : 'Демо-режим · только в этой вкладке';
  }

  function sourceStory() {
    return '<div class="source-story" aria-label="Как устроена подготовка">'
      + '<div class="story-orbit" aria-hidden="true"></div>'
      + '<article class="source-card source-card--resume" data-reveal="slide"><span class="eyebrow">01 / Ваш опыт</span>'
      + '<h3>Резюме, в котором<br>видно главное.</h3><div class="paper-lines" aria-hidden="true"><i></i><i></i><i></i></div>'
      + '<span class="source-chip">Навыки · Опыт · Достижения</span></article>'
      + '<article class="source-card source-card--vacancy" data-reveal="slide"><span class="eyebrow">02 / Ваша цель</span>'
      + '<h3>Та самая вакансия</h3><p>Что уже совпадает.<br>Что стоит подготовить.</p><span class="source-chip">Из требований — в план</span></article>'
      + '<article class="source-card source-card--answer" data-reveal><span class="eyebrow">03 / Следующий шаг</span>'
      + '<h3>Расскажите о себе.</h3><p>Соберите мысли. Попробуйте ответ.<br>Почувствуйте себя увереннее.</p></article>'
      + '<div class="story-helper" data-reveal>' + helper() + '<span>Разберём по шагам</span></div></div>';
  }

  function start() {
    return '<main id="main" tabindex="-1" class="public story-page"><div class="story-container">'
      + '<header class="story-header">' + brand() + '<a class="btn" href="#/auth/login">Войти <span aria-hidden="true">↗</span></a></header>'
      + '<div class="hero-layout"><section class="hero-copy" data-reveal>'
      + '<span class="eyebrow">Меньше сомнений. Больше ясности.</span>'
      + '<h1>Ваш опыт.<br>Ваша история.<br><em>Новая работа.</em></h1>'
      + '<p class="hero-lead">От первого резюме до уверенного ответа на собеседовании. Соберите всё для следующего шага в одном месте.</p>'
      + '<div class="btn-row"><a class="btn btn--primary" href="' + (Api.isHttp() ? '#/auth/register' : '#/onboarding') + '">'
      + (Api.isHttp() ? 'Начать подготовку' : 'Открыть демо') + ' <span aria-hidden="true">↗</span></a>'
      + '<a class="btn btn--quiet" href="#/overview">' + (Api.isHttp() ? 'Продолжить как гость' : 'Посмотреть пример') + '</a></div>'
      + '<p class="mode-label">' + modeLabel() + '</p></section>' + sourceStory() + '</div>'
      + '<footer class="story-footer" data-reveal><span>Всё начинается с вашего опыта</span><span>Резюме <b>→</b> Вакансия <b>→</b> Практика</span></footer>'
      + '</div></main>';
  }

  function auth(mode) {
    var isRegister = mode === 'register';
    var online = Api.isHttp();
    return '<main id="main" tabindex="-1" class="public story-page"><div class="story-container">'
      + '<header class="story-header">' + brand() + '<a class="btn btn--quiet" href="#/start">На главную</a></header>'
      + '<div class="auth-layout"><section class="auth-story" data-reveal><span class="eyebrow">Ваш следующий шаг начинается здесь</span>'
      + '<h1>Большие планы.<br><em>Спокойный старт.</em></h1>'
      + '<p class="hero-lead">Сохраните свой опыт, найдите точки роста и подготовьтесь к разговору о будущем.</p>'
      + '<div class="auth-helper">' + helper() + '<p>По одному шагу.<br><strong>В вашем темпе.</strong></p></div></section>'
      + '<section class="card auth-card" data-reveal="slide"><span class="eyebrow">' + modeLabel() + '</span>'
      + '<h2>' + (isRegister ? 'Создать аккаунт' : 'С возвращением') + '</h2>'
      + (online ? '<p class="muted">' + (isRegister ? 'Ваши подготовки будут храниться на этом сервере.' : 'Войдите, чтобы продолжить свою подготовку.') + '</p>'
        + (Api.live.auth && Api.live.auth.demo ? '<p class="demo-credentials">Пробный аккаунт: <strong>admin / admin</strong></p>' : '')
        + '<form id="auth-form" data-auth-mode="' + (isRegister ? 'register' : 'login') + '">'
        + '<div class="field"><label class="field__label" for="auth-username">Имя пользователя</label>'
        + '<input id="auth-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]{3,32}" aria-describedby="username-hint">'
        + '<small id="username-hint">3–32 латинские буквы, цифры, дефис или _</small></div>'
        + '<div class="field"><label class="field__label" for="auth-password">Пароль</label>'
        + '<input id="auth-password" name="password" type="password" autocomplete="' + (isRegister ? 'new-password' : 'current-password') + '" required minlength="' + (isRegister ? '8' : '1') + '" maxlength="128" aria-describedby="password-hint">'
        + '<small id="password-hint">' + (isRegister ? 'От 8 до 128 символов' : 'Пароль вашего аккаунта') + '</small></div>'
        + '<p id="auth-error" class="auth-error" role="alert"></p>'
        + '<button id="auth-submit" class="btn btn--primary btn--block" type="submit">' + (isRegister ? 'Зарегистрироваться' : 'Войти') + '</button></form>'
        : '<p class="muted">Демо без сервера: аккаунт не создаётся. Данные остаются в этой вкладке и сбрасываются при перезагрузке.</p>')
      + '<div class="auth-links"><a href="#/auth/' + (isRegister ? 'login' : 'register') + '">' + (isRegister ? 'У меня есть аккаунт' : 'Создать аккаунт') + '</a>'
      + '<a href="' + (online ? '#/overview' : '#/onboarding') + '">' + (online ? 'Продолжить как гость' : 'Продолжить в демо без входа') + '</a></div>'
      + '</section></div></div></main>';
  }

  function dashboardIntro() {
    return '<section class="dashboard-intro" data-reveal><div><span class="eyebrow">' + modeLabel() + '</span>'
      + '<h1>Следующий шаг —<br><em>в ваших руках.</em></h1><p class="muted">Ваш опыт, планы и подготовка. Всё здесь.</p></div>' + helper() + '</section>'
      + '<div class="dashboard-sources" data-reveal="slide">'
      + '<a class="source-tile" href="#/resumes"><span class="eyebrow">01 / Исходники</span><h2>Мои резюме <span>↗</span></h2><p>Опыт, который стоит показать</p></a>'
      + '<a class="source-tile" href="#/vacancies"><span class="eyebrow">02 / Направление</span><h2>Вакансии <span>↗</span></h2><p>От требований к плану действий</p></a>'
      + '<a class="source-tile" href="#/interviews"><span class="eyebrow">03 / Практика</span><h2>Интервью <span>↗</span></h2><p>Уверенность приходит с подготовкой</p></a></div>';
  }

  function onboarding() {
    return ''
      + '<div class="public"><div class="public__inner stack">'
      + '  <div class="public__brand"><h1>С чего начнём?</h1></div>'
      + note('demo', '<div>Любой вариант ведёт в макет. Демонстрационные результаты одинаковы для всех и '
        + 'не подстраиваются под ваш ввод.</div>')
      + '  <div class="card stack">'
      + '    <h2>Создать резюме</h2>'
      + '    <p class="muted">Пошаговая форма: профессия, опыт, навыки, образование и предпросмотр. '
      + '    Профессия вписывается свободно — от повара и водителя до разработчика.</p>'
      + '    <div class="btn-row"><a class="btn btn--primary" href="#/resume/new">Начать с нуля</a></div>'
      + '  </div>'
      + '  <div class="card stack">'
      + '    <h2>У меня уже есть резюме</h2>'
      + '    <p class="muted">Выбрать файл на устройстве и посмотреть, как выглядит разбор и предложения по улучшению.</p>'
      + '    <div class="btn-row"><a class="btn" href="#/resume/upload">Загрузить резюме</a></div>'
      + '  </div>'
      + '  <div class="card stack">'
      + '    <h2>Посмотреть пример</h2>'
      + '    <p class="muted">Открыть заполненное демо: резюме, вакансия, сопоставление, вопросы и интервью уже готовы.</p>'
      + '    <div class="btn-row"><button type="button" class="btn" data-act="demo:example">Открыть пример</button></div>'
      + '  </div>'
      + '  <p><a href="#/start">← На начальную страницу</a></p>'
      + '</div></div>';
  }

  /* ---------------- Обзор ---------------- */

  function overview() {
    var state = Store.get();
    if (state.scenario === 'loading') return pageHead('Обзор') + UI.skeletonBlock();
    if (state.scenario === 'error') return pageHead('Обзор') + UI.errorBlock();

    if (!state.preps.length && !state.resumes.length) {
      return dashboardIntro() + pageHead('Обзор', 'Здесь появятся ваши подготовки к собеседованиям.')
        + UI.emptyState(
          'Пока ничего нет',
          'Начните с резюме: соберите новое в мастере или загрузите готовое, чтобы посмотреть демонстрационный разбор.',
          'Создать резюме', 'go:#/resume/new')
        + '<div class="btn-row" style="margin-top:16px;justify-content:center">'
        + '<button type="button" class="btn" data-act="go:#/resume/upload">Загрузить готовое резюме</button>'
        + '<button type="button" class="btn" data-act="demo:example">Показать пример заполненного демо</button>'
        + '</div>';
    }

    var prep = Store.activePrep() || state.preps[0];
    var step = nextStep(prep);
    var cards = state.preps.map(function (p) {
      var s = nextStep(p);
      return ''
        + '<li><div class="row-item">'
        + '  <div class="row-item__main">'
        + '    <div class="row-item__title">' + esc(prepTitle(p)) + '</div>'
        + '    <div class="row-item__meta">Собрано: ' + esc(p.createdAt)
        + (p.stale ? ' · <span class="tag tag--alert">Исходники изменились</span>' : '') + '</div>'
        + '  </div>'
        + '  <div class="btn-row">'
        + '    <button type="button" class="btn btn--sm" data-act="prep:open" data-id="' + esc(p.id) + '">Открыть</button>'
        + '    <button type="button" class="btn btn--sm btn--primary" data-act="go:' + esc(s.route) + '" '
        + 'data-prep="' + esc(p.id) + '">Продолжить</button>'
        + '  </div>'
        + '</div></li>';
    }).join('');

    return ''
      + dashboardIntro() + pageHead('Обзор', 'Последние подготовки и ближайший шаг.')
      + (Api.live.enabled ? '' : note('demo', '<div>Демонстрационный комплект собран для профессии <strong>'
          + esc(DEMO_DATA.professionName) + '</strong>'
          + (DEMO_DATA.isGenericProfession ? ' (общий шаблон: этой профессии нет в библиотеке примеров)' : '')
          + '. Профессию можно сменить в панели «Состояния демо» или создав резюме на другую профессию.</div>'))
      + (prep && prep.stale ? staleBanner(prep) : '')
      + '<div class="card stack">'
      + '  <div class="card__head" style="margin-bottom:0">'
      + '    <div class="card__title"><h2>Ближайший шаг</h2><small>' + esc(prepTitle(prep)) + '</small></div>'
      + '  </div>'
      + '  <p>' + esc(step.label) + '</p>'
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn btn--primary" data-act="go:' + esc(step.route) + '" data-prep="'
      + esc(prep.id) + '">Продолжить</button>'
      + '    <a class="btn" href="#/vacancy/new">Добавить другую вакансию</a>'
      + '  </div>'
      + '</div>'
      + '<div class="card"><div class="card__head"><div class="card__title"><h2>Мои подготовки</h2>'
      + '<small>Одна подготовка связывает резюме, вакансию, вопросы и интервью.</small></div></div>'
      + '<ul class="list">' + cards + '</ul></div>'
      + (Api.live.enabled ? '' : '<div class="card stack">'
      + '  <h2>Режим демо</h2>'
      + '  <p class="muted">Можно переключиться между пустым и заполненным состоянием, чтобы посмотреть оба варианта.</p>'
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn" data-act="demo:scenario-empty">Показать пустое состояние</button>'
      + '    <button type="button" class="btn" data-act="demo:scenario-filled">Показать заполненное состояние</button>'
      + '    <a class="btn" href="#/history">История</a>'
      + '  </div>'
      + '</div>');
  }

  /* ---------------- Мастер создания резюме ---------------- */

  var STEP_NAMES = ['Профессия', 'Опыт', 'Навыки', 'Образование', 'Предпросмотр'];

  function stepsBar(current) {
    return '<ul class="steps">' + STEP_NAMES.map(function (name, index) {
      var cls = 'step' + (index < current ? ' step--done' : '');
      return '<li><button type="button" class="' + cls + '"'
        + (index === current ? ' aria-current="step"' : '')
        + ' data-act="builder:goto" data-step="' + index + '">'
        + '<span class="step__num">' + (index + 1) + '</span>' + esc(name) + '</button></li>';
    }).join('') + '</ul>';
  }

  function resumeWizard() {
    var state = Store.get();
    var b = state.builder;
    var body;

    if (b.built) return builtPreview(b);

    if (b.step === 0) {
      var known = Professions.list().map(function (p) { return p.name; });
      body = ''
        + UI.field({ id: 'b-profession', label: 'Желаемая профессия', model: 'builder.data.profession',
            value: b.data.profession, required: true, error: b.errors.profession,
            placeholder: 'Например: флорист, электрик, бизнес-аналитик',
            list: 'profession-list', listOptions: known,
            hint: 'Впишите любую профессию. Список — только подсказки, ограничения по нему нет.' })
        + note('info', '<div>Для ' + known.length + ' профессий из подсказок в макете есть готовый '
            + 'демонстрационный комплект: вакансия, требования, вопросы и сценарий интервью. '
            + 'Для любой другой профессии собирается общий комплект с вашим названием — так видно, '
            + 'что структура подготовки не привязана к одному направлению.</div>')
        + UI.field({ id: 'b-wishes', label: 'Пожелания к работе', model: 'builder.data.wishes', type: 'textarea',
            value: b.data.wishes, placeholder: 'Формат работы, отрасль, город, что важно в команде',
            hint: 'Свободный текст. Он подставляется в предпросмотр как есть.' })
        + UI.field({ id: 'b-summary', label: 'Коротко о себе', model: 'builder.data.summary', type: 'textarea',
            value: b.data.summary, placeholder: 'Две-три строки о вашей специализации',
            hint: 'Пишите своими словами: макет не придумывает за вас достижения.' });
    } else if (b.step === 1) {
      var items = b.data.experience.map(function (item, index) {
        return ''
          + '<div class="card" style="background:var(--surface-2)">'
          + '  <div class="card__head"><div class="card__title"><h3>Место работы ' + (index + 1) + '</h3></div>'
          + '    <button type="button" class="btn btn--sm btn--danger" data-act="builder:exp-remove" data-index="'
          + index + '">Удалить</button></div>'
          + '  <div class="grid-2">'
          + UI.field({ id: 'exp-role-' + index, label: 'Должность', model: 'builder.data.experience.' + index + '.role',
              value: item.role, required: true, error: b.errors['exp' + index] })
          + UI.field({ id: 'exp-company-' + index, label: 'Компания', model: 'builder.data.experience.' + index + '.company',
              value: item.company })
          + '  </div>'
          + UI.field({ id: 'exp-period-' + index, label: 'Период', model: 'builder.data.experience.' + index + '.period',
              value: item.period, placeholder: '2022 — настоящее время' })
          + UI.field({ id: 'exp-details-' + index, label: 'Что вы делали', type: 'textarea',
              model: 'builder.data.experience.' + index + '.details', value: item.details,
              placeholder: 'Задачи, за которые вы отвечали' })
          + '</div>';
      }).join('');
      body = (items || note('info', '<div>Пока не добавлено ни одного места работы.</div>'))
        + (b.errors.experience ? '<p class="field__error">' + esc(b.errors.experience) + '</p>' : '')
        + '<div class="btn-row" style="margin-top:16px">'
        + '<button type="button" class="btn" data-act="builder:exp-add">Добавить место работы</button></div>';
    } else if (b.step === 2) {
      body = ''
        + UI.field({ id: 'b-skills', label: 'Навыки', model: 'builder.data.skills', type: 'textarea',
            value: b.data.skills, required: true, error: b.errors.skills,
            placeholder: 'По одному навыку в строке',
            hint: 'Каждая строка станет отдельным пунктом в предпросмотре.' })
        + UI.field({ id: 'b-ach', label: 'Достижения', model: 'builder.data.achievements', type: 'textarea',
            value: b.data.achievements, placeholder: 'По одному достижению в строке',
            hint: 'Указывайте только то, что было на самом деле. Макет ничего не дописывает за вас.' });
    } else if (b.step === 3) {
      var edu = b.data.education.map(function (item, index) {
        return ''
          + '<div class="card" style="background:var(--surface-2)">'
          + '  <div class="card__head"><div class="card__title"><h3>Образование ' + (index + 1) + '</h3></div>'
          + '    <button type="button" class="btn btn--sm btn--danger" data-act="builder:edu-remove" data-index="'
          + index + '">Удалить</button></div>'
          + '  <div class="grid-2">'
          + UI.field({ id: 'edu-place-' + index, label: 'Учебное заведение',
              model: 'builder.data.education.' + index + '.place', value: item.place })
          + UI.field({ id: 'edu-program-' + index, label: 'Программа',
              model: 'builder.data.education.' + index + '.program', value: item.program })
          + '  </div>'
          + UI.field({ id: 'edu-period-' + index, label: 'Период',
              model: 'builder.data.education.' + index + '.period', value: item.period })
          + '</div>';
      }).join('');
      body = (edu || note('info', '<div>Раздел можно оставить пустым.</div>'))
        + '<div class="btn-row" style="margin-top:16px">'
        + '<button type="button" class="btn" data-act="builder:edu-add">Добавить образование</button></div>';
    } else {
      body = ''
        + note('demo', '<div><strong>Дальше — демонстрационная сборка.</strong> Ваши поля подставятся в предпросмотр '
          + 'без изменений. Текст, помеченный как образец ИИ, — фиксированный пример, а не результат анализа ваших данных.</div>')
        + previewCard(builderToResume(b), false)
        + '<div class="btn-row" style="margin-top:16px">'
        + '<button type="button" class="btn btn--primary" data-act="builder:build">Собрать резюме</button></div>';
    }

    var nav = ''
      + '<div class="btn-row btn-row--between" style="margin-top:24px">'
      + '  <button type="button" class="btn" data-act="builder:prev"' + (b.step === 0 ? ' disabled' : '') + '>Назад</button>'
      + (b.step < 4
          ? '<button type="button" class="btn btn--primary" data-act="builder:next">Далее</button>'
          : '<span></span>')
      + '</div>';

    return ''
      + pageHead('Создание резюме', 'Пошаговая форма. Введённое сохраняется при переходах между шагами внутри макета.')
      + stepsBar(b.step)
      + '<div class="card">' + body + nav + '</div>'
      + note('demo', '<div>После перезагрузки страницы введённый текст сбрасывается: макет не сохраняет '
        + 'персональные данные ни на сервере, ни в браузере.</div>');
  }

  function splitLines(text) {
    return String(text || '').split('\n').map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  function builderToResume(b) {
    return {
      id: 'builder-preview',
      title: (b.data.profession || 'Резюме') + ' — черновик',
      source: 'created',
      demo: false,
      profession: b.data.profession,
      wishes: b.data.wishes,
      summary: b.data.summary,
      experience: b.data.experience,
      skills: splitLines(b.data.skills),
      achievements: splitLines(b.data.achievements),
      education: b.data.education
    };
  }

  function previewCard(resume, showSample) {
    var exp = (resume.experience || []).filter(function (e) { return e.role || e.company; });
    return ''
      + '<div class="resume-preview">'
      + '  <h3>' + esc(resume.profession || 'Профессия не указана') + '</h3>'
      + '  <p class="muted">' + escLines(resume.wishes || 'Пожелания не указаны') + '</p>'
      + '  <div class="resume-preview__section"><h4>О себе</h4><p>'
      + (resume.summary ? escLines(resume.summary) : '<span class="faint">Не заполнено</span>') + '</p></div>'
      + '  <div class="resume-preview__section"><h4>Опыт</h4>'
      + (exp.length
          ? '<ul class="list">' + exp.map(function (e) {
              return '<li><b>' + esc(e.role || 'Должность не указана') + '</b>'
                + (e.company ? ' — ' + esc(e.company) : '')
                + (e.period ? '<div class="row-item__meta">' + esc(e.period) + '</div>' : '')
                + (e.details ? '<div>' + escLines(e.details) + '</div>' : '') + '</li>';
            }).join('') + '</ul>'
          : '<p class="faint">Не заполнено</p>')
      + '  </div>'
      + '  <div class="resume-preview__section"><h4>Навыки</h4>'
      + ((resume.skills || []).length
          ? '<ul>' + resume.skills.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>'
          : '<p class="faint">Не заполнено</p>')
      + '  </div>'
      + ((resume.achievements || []).length
          ? '<div class="resume-preview__section"><h4>Достижения</h4><ul>'
            + resume.achievements.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>'
          : '')
      + '  <div class="resume-preview__section"><h4>Образование</h4>'
      + ((resume.education || []).filter(function (e) { return e.place || e.program; }).length
          ? '<ul class="list">' + resume.education.filter(function (e) { return e.place || e.program; })
              .map(function (e) {
                return '<li><b>' + esc(e.place || '') + '</b>'
                  + (e.program ? ' — ' + esc(e.program) : '')
                  + (e.period ? '<div class="row-item__meta">' + esc(e.period) + '</div>' : '') + '</li>';
              }).join('') + '</ul>'
          : '<p class="faint">Не заполнено</p>')
      + '  </div>'
      + (showSample
          ? '<div class="resume-preview__section">'
            + '<h4>Образец формулировки <span class="tag tag--demo">Фиксированный пример, не ИИ</span></h4>'
            + '<p class="muted">«Бизнес-аналитик: собираю требования, описываю процессы и готовлю постановки '
            + 'для разработки. Довожу задачу до приёмки.» — это заранее написанный образец стиля. '
            + 'Он не составлен по вашим данным и не подставляется в резюме автоматически.</p></div>'
          : '')
      + '</div>';
  }

  function builtPreview(b) {
    if (b.built === 'loading') {
      return pageHead('Сборка резюме') + UI.skeletonBlock();
    }
    var resume = builderToResume(b);
    return ''
      + pageHead('Резюме собрано', 'Поля подставлены в предпросмотр локально, в браузере.')
      + note('demo', '<div><strong>Демонстрационная сборка.</strong> Настоящий ИИ не подключён: текст не '
        + 'переписывался и не оценивался.</div>')
      + '<div class="card">' + previewCard(resume, true) + '</div>'
      + '<div class="card stack">'
      + '  <h2>Что дальше</h2>'
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn" data-act="builder:edit">Редактировать</button>'
      + '    <button type="button" class="btn btn--primary" data-act="builder:save">Сохранить и использовать для подготовки</button>'
      + '    <button type="button" class="btn" data-act="stub:export">Экспорт в PDF</button>'
      + '  </div>'
      + '  <p class="faint" style="font-size:13px">Экспорт — заглушка: макет не создаёт файлы.</p>'
      + '</div>';
  }

  /* ---------------- Загрузка готового резюме ---------------- */

  function upload() {
    var state = Store.get();
    var up = state.upload;
    var fileRow = up.fileName
      ? '<div class="row-item" style="margin-top:16px"><div class="row-item__main">'
        + '<div class="row-item__title">' + esc(up.fileName) + '</div>'
        + '<div class="row-item__meta">' + esc(up.phase || 'Файл выбран') + '</div>'
        + '</div><div class="btn-row">'
        + '<button type="button" class="btn btn--sm" data-act="upload:pick"' + (up.busy ? ' disabled' : '') + '>Заменить</button>'
        + '<button type="button" class="btn btn--sm btn--danger" data-act="upload:clear"' + (up.busy ? ' disabled' : '') + '>Удалить</button>'
        + '</div></div>'
      : '';

    return ''
      + pageHead('Загрузка готового резюме', 'Загрузите документ или вставьте текст для разбора.')
      + note('info', '<div>PDF с текстом, DOCX и TXT — до 2 МБ и 40 000 символов. Для DOC и RTF нужна конвертация. '
        + 'Сканы не распознаются: OCR недоступен. Исходный файл не сохраняется; извлечённый текст сохраняется при запуске разбора.</div>')
      + hhResumeBlock(state.hhResume || {})
      + '<div class="card">'
      + '  <button type="button" class="dropzone" id="dropzone" data-act="upload:pick"' + (up.busy ? ' disabled' : '') + '>'
      + '    <b>Перетащите файл сюда или нажмите, чтобы выбрать</b>'
      + '    <span class="muted">PDF, DOCX, TXT · до 2 МБ</span>'
      + '  </button>'
      + '  <input type="file" id="file-input" class="visually-hidden" accept=".pdf,.docx,.doc,.rtf,.txt" '
      + '    aria-label="Выбрать файл резюме">'
      + fileRow
      + '  <hr class="divide">'
      + UI.field({ id: 'upload-text', label: 'Или вставьте текст резюме', type: 'textarea', rows: 8,
          model: 'upload.text', value: up.text || '', disabled: !!up.busy,
          placeholder: 'Скопируйте текст из своего резюме',
          hint: Api.live.enabled
            ? 'Проверьте извлечённый текст. При запуске разбора он сохраняется на сервере и передаётся модели.'
            : 'В демо-режиме текст остаётся в браузере и не анализируется.' })
      + '  <div class="btn-row" style="margin-top:16px">'
      + (Api.live.enabled
          ? '<button type="button" class="btn' + (up.fileError ? '' : ' btn--primary') + '" data-act="upload:review"'
            + (state.pending || up.busy || up.fileError ? ' disabled' : '') + '>'
            + (up.busy ? 'Обработка…' : up.error && !up.fileError ? 'Повторить разбор' : 'Разобрать резюме') + '</button>'
          : '')
      + (!Api.isHttp() && !up.fileName && !up.text
        ? '<button type="button" class="btn" data-act="upload:show-analysis">Демо: показать пример анализа</button>' : '')
      + (up.busy ? '<button type="button" class="btn" data-act="upload:cancel">Отменить</button>' : '')
      + (up.fileError && !up.busy ? '<button type="button" class="btn btn--primary" data-act="upload:retry-file">Повторить чтение файла</button>' : '')
      + '    <a class="btn" href="#/resumes">К списку резюме</a>'
      + '  </div>'
      + '</div>'
      + (up.phase ? '<p role="status">' + esc(up.phase) + (up.busy && up.elapsed !== undefined ? ' · ' + up.elapsed + ' с' : '') + '</p>' : '')
      + (up.error ? '<div class="note note--alert" role="alert" id="upload-error">' + esc(up.error) + '</div>' : '')
      + (up.analysisShown ? analysisReport() : '');
  }

  function suggestionBlock(item, decision) {
    var status = decision === 'accepted'
      ? '<span class="tag tag--ok">Принято</span>'
      : (decision === 'rejected' ? '<span class="tag">Отклонено</span>' : '');
    return ''
      + '<div class="q-item">'
      + '  <div class="q-item__top"><span class="tag tag--info">Предложение</span>' + status + '</div>'
      + '  <div class="q-item__text">' + esc(item.title || 'Предложение') + '</div>'
      + '  <p class="muted" style="font-size:13.5px">' + esc(item.why) + '</p>'
      + (item.before && item.before !== '—'
          ? '<div class="diff-old"><b style="font-size:12px">Было</b><div>' + esc(item.before) + '</div></div>' : '')
      + '  <div class="diff-new"><b style="font-size:12px">Стало</b><div>' + esc(item.after) + '</div></div>'
      + '  <div class="btn-row" style="margin-top:12px">'
      + '    <button type="button" class="btn btn--sm btn--primary" data-act="sug:accept" data-id="' + esc(item.id) + '">Принять</button>'
      + '    <button type="button" class="btn btn--sm" data-act="sug:reject" data-id="' + esc(item.id) + '">Отклонить</button>'
      + '  </div>'
      + '</div>';
  }

  function analysisReport() {
    var state = Store.get();
    if (Api.isHttp() && !state.upload.report) return '';
    var report = state.upload.report || DEMO_DATA.analysisReport;
    var real = !!state.upload.report;
    var decisions = state.upload.decisions;
    var accepted = report.vague.concat(report.missing).filter(function (s) {
      return decisions[s.id] === 'accepted';
    });

    return ''
      + '<div class="card stack">'
      + (real
          ? '<div class="card__head"><div class="card__title"><h2>Разбор вашего резюме</h2>'
            + '<small>' + (state.upload.mock ? 'Демо-ответ сервера: содержание фиксированное' : 'Реальный анализ · ' + esc((state.upload.source || {}).provider || '') + ' · ' + esc((state.upload.source || {}).model || '') + ' · pre_interview') + '</small></div>'
            + (state.upload.mock ? UI.demoBadge('Заглушка') : '') + '</div>'
            + note('info', '<div>Модель предлагает формулировки, но не имеет права добавлять факты. '
              + 'Принимайте только то, что соответствует действительности.</div>')
          : '<div class="card__head"><div class="card__title"><h2>Демонстрационный разбор резюме</h2>'
            + '<small>Образец отчёта на подготовленном примере</small></div>' + UI.demoBadge('Образец') + '</div>'
            + note('demo', '<div>Это разбор демонстрационного резюме из комплекта макета. Ваш файл не читался. '
              + 'Ложные работодатели, навыки и достижения не добавляются.</div>'))
      + '  <h3>Сильные стороны</h3>'
      + '  <ul>' + (report.strengths || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>'
      + '  <h3>Неясные формулировки</h3>'
      + (report.vague || []).map(function (s, i) { s.id = s.id || ('sug-v' + i); return suggestionBlock(s, decisions[s.id]); }).join('')
      + '  <h3>Недостающая информация</h3>'
      + (report.missing || []).map(function (s, i) { s.id = s.id || ('sug-m' + i); return suggestionBlock(s, decisions[s.id]); }).join('')
      + '</div>'
      + '<div class="card stack">'
      + '  <div class="card__head"><div class="card__title"><h2>' + (real ? 'Выбранные рекомендации' : 'Демонстрационная версия резюме') + '</h2>'
      + '  <small>' + (real ? 'Резюме и разбор сохранены. Рекомендации пока отмечены только в браузере; внесите правки в текст вручную.' : 'Принятые предложения применяются к образцу') + '</small></div></div>'
      + (accepted.length
          ? '<ul class="list">' + accepted.map(function (s) {
              return '<li><b>' + esc(s.title) + '</b><div class="diff-new">' + esc(s.after) + '</div></li>';
            }).join('') + '</ul>'
          : '<p class="muted">Ни одно предложение пока не принято. Нажмите «Принять», чтобы отметить рекомендацию.</p>')
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn btn--primary" data-act="upload:save">' + (real ? 'Использовать резюме для подготовки' : 'Сохранить как версию резюме') + '</button>'
      + '    <a class="btn" href="#/vacancy/new">Перейти к вакансии</a>'
      + '  </div>'
      + '</div>';
  }

  /* ---------------- Импорт резюме с hh.ru ---------------- */

  function hhResumeBlock(hh) {
    var p = hh.preview;
    var d = p ? (p.data || {}) : {};
    return ''
      + '<div class="card stack" id="hh-resume">'
      + '  <h2>Импорт с hh.ru по ссылке</h2>'
      + UI.field({ id: 'hh-resume-url', label: 'Ссылка на резюме', model: 'hhResume.url', value: hh.url || '',
          placeholder: 'https://hh.ru/resume/…', disabled: !!hh.busy,
          hint: Api.live.enabled
            ? 'Резюме должно быть открыто «всем» в настройках видимости на hh.ru. Сервер читает страницу без ваших куки; проверка «не робот» не обходится.'
            : 'В автономном макете импорт недоступен.' })
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn" data-act="resume:import-hh"' + (hh.busy ? ' disabled' : '') + '>' + (hh.busy ? 'Читаю страницу…' : 'Получить резюме') + '</button>'
      + (hh.busy ? '<button type="button" class="btn" data-act="resume:import-hh-cancel">Отменить</button>' : '')
      + '  </div>'
      + (hh.error ? note('alert', '<div id="hh-resume-error"><strong>Не удалось получить резюме.</strong> ' + esc(hh.error)
          + ' Можно выгрузить резюме с hh.ru в PDF или DOCX и загрузить файлом ниже.</div>') : '')
      + (p
          ? note('info', '<div id="hh-resume-ok"><strong>Получено с hh.ru</strong> · ' + esc(new Date(p.retrievedAt || Date.now()).toLocaleString('ru-RU'))
              + ' · ' + esc(sourceLabel(p.source)) + extractLabel(p.extract)
              + (p.structured ? '. Проверьте поля: страница разобрана по разметке.' : '. Разметка не распознана: сохранится текст страницы, поля заполните на карточке резюме.') + '</div>')
            + '<ul class="list" id="hh-resume-preview">'
            + '<li><b>Должность:</b> ' + esc(d.profession || '—') + '</li>'
            + (d.summary ? '<li><b>О себе:</b> ' + esc(d.summary.slice(0, 300)) + '</li>' : '')
            + '<li><b>Опыт:</b> ' + (d.experience && d.experience.length
                ? '<ul>' + d.experience.map(function (e) { return '<li>' + esc(e.role) + (e.company ? ' — ' + esc(e.company) : '') + (e.period ? ' (' + esc(e.period) + ')' : '') + '</li>'; }).join('') + '</ul>'
                : 'не найден') + '</li>'
            + '<li><b>Навыки:</b> ' + esc((d.skills || []).join(', ') || '—') + '</li>'
            + (d.education && d.education.length ? '<li><b>Образование:</b> ' + esc(d.education.map(function (e) { return e.place + (e.program ? ' — ' + e.program : ''); }).join('; ')) + '</li>' : '')
            + '</ul>'
            + '<div class="btn-row">'
            + '<button type="button" class="btn btn--primary" data-act="resume:import-hh-save">Сохранить резюме</button>'
            + '<button type="button" class="btn" data-act="resume:import-hh-clear">Отменить</button>'
            + '</div>'
          : '')
      + '</div>';
  }

  /* ---------------- Поиск вакансий на hh.ru ---------------- */

  function jobs() {
    var state = Store.get();
    var j = state.jobs || {};
    var resumeOptions = [{ value: '', label: 'Без резюме (только по запросу)' }].concat(
      state.resumes.map(function (r) { return { value: r.id, label: r.title }; }));
    var res = j.result;
    var head = pageHead('Поиск вакансий', 'Публичный поиск hh.ru. Запрос собирается из профессии и навыков резюме; наружу уходит только текст запроса и город, не само резюме.');
    if (!Api.live.enabled) {
      return head + note('alert', '<div><strong>В автономном макете поиск недоступен.</strong> Макет не ходит в сеть. Запустите сервер и откройте приложение через HTTP.</div>');
    }
    var items = res ? (res.items || []) : [];
    var list = items.map(function (it) {
      var score = typeof it.score === 'number'
        ? '<span class="tag ' + (it.score >= 40 ? 'tag--ok' : it.score >= 15 ? 'tag--info' : '') + '" title="Совпадение слов резюме и вакансии, не оценка модели">похожесть ' + it.score + '</span> '
        : '';
      return ''
        + '<li><div class="row-item job-item">'
        + '  <div class="row-item__main">'
        + '    <div class="row-item__title">' + score + esc(it.title) + '</div>'
        + '    <div class="row-item__meta">' + esc(it.company || '—') + (it.area ? ' · ' + esc(it.area) : '') + (it.salary ? ' · ' + esc(it.salary) : '')
        + (it.experience ? ' · ' + esc(it.experience) : '') + '</div>'
        + (it.requirement ? '<p class="muted" style="font-size:13.5px;margin:6px 0 0">' + esc(it.requirement) + '</p>' : '')
        + (it.why && it.why.length ? '<p class="faint" style="font-size:12.5px;margin:4px 0 0">совпало: ' + esc(it.why.join(', ')) + '</p>' : '')
        + '  </div>'
        + '  <div class="btn-row">'
        + '    <button type="button" class="btn btn--sm btn--primary" data-act="jobs:prepare" data-url="' + esc(it.url) + '">Создать подготовку</button>'
        + '    <a class="btn btn--sm" href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">Открыть на hh.ru</a>'
        + '  </div>'
        + '</div></li>';
    }).join('');
    var pager = res && res.pages > 1
      ? '<div class="btn-row" style="margin-top:12px">'
        + (res.page > 0 ? '<button type="button" class="btn btn--sm" data-act="jobs:page" data-page="' + (res.page - 1) + '">Назад</button>' : '')
        + '<span class="muted">страница ' + (res.page + 1) + ' из ' + res.pages + '</span>'
        + (res.page + 1 < res.pages ? '<button type="button" class="btn btn--sm" data-act="jobs:page" data-page="' + (res.page + 1) + '">Дальше</button>' : '')
        + '</div>'
      : '';
    return head
      + '<div class="card stack">'
      + UI.select({ id: 'jobs-resume', label: 'Резюме для подбора', model: 'jobs.resumeId', value: j.resumeId || '', options: resumeOptions, act: 'jobs:resume',
          hint: 'С резюме результаты ранжируются по совпадению слов; это подсказка, а не оценка модели.' })
      + '  <div class="grid-2">'
      + UI.field({ id: 'jobs-query', label: 'Запрос', model: 'jobs.query', value: j.query || '', placeholder: 'например, повар горячего цеха', disabled: !!j.busy,
          hint: j.resumeId && !j.query ? 'Пусто — запрос соберётся из профессии и навыков резюме.' : '' })
      + UI.field({ id: 'jobs-area', label: 'Город или регион', model: 'jobs.area', value: j.area || '', placeholder: 'Санкт-Петербург', disabled: !!j.busy })
      + '  </div>'
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn btn--primary" data-act="jobs:search"' + (j.busy ? ' disabled' : '') + '>' + (j.busy ? 'Ищу…' : 'Найти вакансии') + '</button>'
      + '  </div>'
      + (j.busy ? '<p role="status" class="muted">Запрашиваю hh.ru' + (j.elapsed >= 2 ? ' · ' + esc(String(j.elapsed)) + ' с' : '') + '</p>' : '')
      + (j.error ? note('alert', '<div id="jobs-error"><strong>Поиск не удался.</strong> ' + esc(j.error) + '</div>') : '')
      + '</div>'
      + (res
          ? '<div class="card stack" id="jobs-results">'
            + '<div class="card__head"><div class="card__title"><h2>Найдено: ' + esc(String(res.found)) + '</h2>'
            + '<small>запрос «' + esc(res.query || '') + '»' + (res.areaName ? ' · ' + esc(res.areaName) : '') + (res.ranked ? ' · отсортировано по похожести на резюме' : ' · порядок hh.ru') + '</small></div></div>'
            + (items.length ? '<ul class="list">' + list + '</ul>' + pager
              : '<p class="muted">Ничего не найдено. Упростите запрос или уберите регион.</p>')
            + '</div>'
          : '');
  }

  /* ---------------- Список резюме и карточка ---------------- */

  function resumes() {
    var state = Store.get();
    if (state.scenario === 'loading') return pageHead('Мои резюме') + UI.skeletonBlock();
    if (state.scenario === 'error') return pageHead('Мои резюме') + UI.errorBlock();

    if (!state.resumes.length) {
      return pageHead('Мои резюме')
        + UI.emptyState('Резюме пока нет',
            'Соберите резюме в мастере или загрузите готовый файл, чтобы посмотреть демонстрационный разбор.',
            'Создать резюме', 'go:#/resume/new')
        + '<div class="btn-row" style="margin-top:16px;justify-content:center">'
        + '<button type="button" class="btn" data-act="go:#/resume/upload">Загрузить файл</button></div>';
    }

    var rows = state.resumes.map(function (r) {
      return ''
        + '<li><div class="row-item">'
        + '  <div class="row-item__main">'
        + '    <div class="row-item__title">' + esc(r.title) + ' '
        + (r.demo ? UI.demoBadge('Демо-данные') : '') + '</div>'
        + '    <div class="row-item__meta">Версия ' + r.rev + ' · изменено ' + esc(r.updatedAt)
        + ' · ' + (r.source === 'uploaded' ? 'из файла' : r.source === 'hh' ? 'с hh.ru' : 'создано в мастере') + '</div>'
        + '  </div>'
        + '  <div class="btn-row">'
        + '    <button type="button" class="btn btn--sm" data-act="go:#/resume/' + esc(r.id) + '">Открыть</button>'
        + '    <button type="button" class="btn btn--sm" data-act="resume:rename" data-id="' + esc(r.id) + '">Переименовать</button>'
        + '    <button type="button" class="btn btn--sm btn--danger" data-act="resume:delete" data-id="' + esc(r.id) + '">Удалить</button>'
        + '  </div>'
        + '</div></li>';
    }).join('');

    return ''
      + pageHead('Мои резюме', 'Версии резюме, которые можно использовать в подготовке к вакансии.')
      + '<div class="btn-row" style="margin-bottom:16px">'
      + '  <a class="btn btn--primary" href="#/resume/new">Создать резюме</a>'
      + '  <a class="btn" href="#/resume/upload">Загрузить готовое</a>'
      + '</div>'
      + '<ul class="list">' + rows + '</ul>';
  }

  function resumeCard(id) {
    var resume = Store.resumeById(id);
    if (!resume) {
      return pageHead('Резюме не найдено')
        + UI.emptyState('Такой версии резюме нет', 'Возможно, она была удалена в этом сеансе макета.',
            'К списку резюме', 'go:#/resumes');
    }
    return ''
      + pageHead(resume.title, 'Версия ' + resume.rev + ' · изменено ' + resume.updatedAt)
      + (resume.fileNameShown ? note('info', '<div>' + esc(resume.fileNameShown) + '</div>') : '')
      + '<div class="card">' + previewCard(resume, false) + '</div>'
      + '<div class="card stack">'
      + '  <h2>Действия</h2>'
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn" data-act="resume:tweak" data-id="' + esc(resume.id) + '">'
      + '      Внести демонстрационную правку</button>'
      + '    <button type="button" class="btn" data-act="resume:rename" data-id="' + esc(resume.id) + '">Переименовать</button>'
      + '    <button type="button" class="btn btn--primary" data-act="resume:use" data-id="' + esc(resume.id) + '">'
      + '      Использовать для подготовки</button>'
      + '    <button type="button" class="btn" data-act="stub:export">Экспорт в PDF</button>'
      + '  </div>'
      + '  <p class="faint" style="font-size:13px">«Внести правку» повышает версию резюме — так можно проверить, '
      + '  как подготовка помечается как устаревшая.</p>'
      + '</div>';
  }

  /* ---------------- Вакансии ---------------- */

  function vacancies() {
    var state = Store.get();
    if (state.scenario === 'loading') return pageHead('Вакансии и подготовка') + UI.skeletonBlock();
    if (state.scenario === 'error') return pageHead('Вакансии и подготовка') + UI.errorBlock();
    if (state.scenario === 'limit') return pageHead('Вакансии и подготовка') + UI.limitBlock();

    if (!state.preps.length) {
      return pageHead('Вакансии и подготовка')
        + UI.emptyState('Подготовок пока нет',
            'Добавьте вакансию и выберите резюме — макет свяжет их в одну подготовку.',
            'Добавить вакансию', 'go:#/vacancy/new');
    }

    var rows = state.preps.map(function (p) {
      var vacancy = Store.vacancyById(p.vacancyId);
      var resume = Store.resumeById(p.resumeId);
      return ''
        + '<li><div class="row-item">'
        + '  <div class="row-item__main">'
        + '    <div class="row-item__title">' + esc(vacancy ? vacancy.title : 'Вакансия удалена') + ' '
        + (p.stale ? '<span class="tag tag--alert">Исходники изменились</span>' : '') + '</div>'
        + '    <div class="row-item__meta">' + esc(vacancy ? vacancy.company : '—')
        + ' · резюме: ' + esc(resume ? resume.title : 'не выбрано')
        + (vacancy && vacancy.sourceUrl ? ' · <span class="vacancy-source">источник: ' + esc(hostOf(vacancy.sourceUrl))
          + (vacancy.retrievedAt ? ', ' + esc(new Date(vacancy.retrievedAt).toLocaleDateString('ru-RU')) : '') + '</span>' : '')
        + (isLiveList() && p.state ? ' · <span class="prep-state">' + esc(stateLabel(p.state)) + '</span>' : '')
        + '</div>'
        + '  </div>'
        + '  <div class="btn-row">'
        + '    <button type="button" class="btn btn--sm" data-act="go:#/prep/' + esc(p.id) + '/match">Сопоставление</button>'
        + '    <button type="button" class="btn btn--sm" data-act="go:#/prep/' + esc(p.id) + '/questions">Вопросы</button>'
        + '    <button type="button" class="btn btn--sm btn--danger" data-act="prep:delete" data-id="' + esc(p.id) + '">Удалить</button>'
        + '  </div>'
        + '</div></li>';
    }).join('');

    return ''
      + pageHead('Вакансии и подготовка', 'Каждая подготовка связывает вакансию, версию резюме, сопоставление и вопросы.')
      + '<div class="btn-row" style="margin-bottom:16px"><a class="btn btn--primary" href="#/vacancy/new">Добавить вакансию</a>'
      + (Api.live.enabled ? '<a class="btn" href="#/jobs">Найти вакансии на hh.ru</a>' : '') + '</div>'
      + '<ul class="list">' + rows + '</ul>';
  }

  function isLiveList() { return Api.live.enabled; }
  var STATE_LABELS = { resume_selected: 'выбрано резюме', vacancy_selected: 'выбрана вакансия', vacancy_requirements_ready: 'требования выделены',
    match_ready: 'сопоставление готово', questions_ready: 'вопросы собраны', answers_started: 'ответы начаты', feedback_ready: 'есть обратная связь',
    prep_card_ready: 'карточка собрана', text_interview_started: 'интервью начато', text_interview_finished: 'интервью завершено',
    live_interview_available: 'готово к живому интервью' };
  function stateLabel(state) { return STATE_LABELS[state] || state; }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return String(url || ''); }
  }
  /* Кто выделил поля со страницы: разметка, сырой текст или модель (с подписью). */
  function extractLabel(x) {
    if (!x) return '';
    if (x.by === 'model') return ' · поля выделила ' + (x.mock ? 'заглушка модели' : 'модель ' + esc((x.source || {}).provider || '') + ' · ' + esc((x.source || {}).model || ''));
    if (x.modelFailed) return ' · по ' + (x.by === 'markup' ? 'разметке' : 'тексту страницы') + ', модель не ответила';
    return x.by === 'markup' ? ' · по разметке страницы' : ' · сырой текст страницы';
  }
  function sourceLabel(source) {
    return { jsonld: 'структурированные данные вакансии', meta: 'заголовок страницы и основной текст', html: 'основной текст страницы', text: 'текстовая страница', hh_api: 'API hh.ru', hh_page: 'страница hh.ru', hh_browser: 'страница hh.ru в браузере сервера' }[source] || 'вручную';
  }

  function vacancyNew() {
    var state = Store.get();
    var draft = state.vacancyDraft;
    var resumeOptions = [{ value: '', label: 'Выберите резюме' }].concat(
      state.resumes.map(function (r) { return { value: r.id, label: r.title }; }));

    var ready = draft.title && draft.text && draft.resumeId;

    return ''
      + pageHead('Добавление вакансии', 'Вставьте текст вакансии и выберите резюме для сопоставления.')
      + '<div class="card stack">'
      + '  <h2>Импорт по ссылке</h2>'
      + UI.field({ id: 'vac-url', label: 'Ссылка на вакансию', model: 'vacancyDraft.url',
          value: draft.url || '', placeholder: 'https://hh.ru/vacancy/...',
          hint: Api.live.enabled ? 'Сервер прочитает публичную страницу сам, без ваших куки. Текст покажется здесь для проверки до разбора.' : '' })
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn" data-act="vacancy:import"' + (draft.importBusy ? ' disabled' : '') + '>'
      + (draft.importBusy ? 'Получаю страницу…' : 'Импортировать по ссылке') + '</button>'
      + (draft.importBusy ? '<button type="button" class="btn" data-act="vacancy:import-cancel">Отменить</button>' : '')
      + '  </div>'
      + (draft.importBusy ? '<p role="status" class="muted">Читаю страницу' + (draft.importElapsed >= 2 ? ' · ' + esc(String(draft.importElapsed)) + ' с' : '') + '</p>' : '')
      + (Api.live.enabled ? '' : note('alert', '<div><strong>В автономном макете импорт по ссылке недоступен.</strong> Макет не ходит в сеть. '
        + 'Вставьте текст вручную или откройте подготовленный пример.</div>'))
      + (draft.importError ? note('alert', '<div id="vac-import-error"><strong>Не удалось получить вакансию.</strong> ' + esc(draft.importError) + '</div>') : '')
      + (draft.imported && !draft.importError
          ? note(draft.imported.needsReview ? 'info' : 'ok', '<div id="vac-import-ok"><strong>Получено с ' + esc(hostOf(draft.imported.sourceUrl)) + '</strong>'
            + ' · ' + esc(UI.formatDate ? UI.formatDate(draft.imported.retrievedAt) : new Date(draft.imported.retrievedAt).toLocaleString('ru-RU'))
            + ' · источник: ' + esc(sourceLabel(draft.imported.source))
            + extractLabel(draft.imported.extract)
            + (draft.imported.needsReview ? '. Проверьте заголовок и текст ниже: страница разобрана по разметке, лишние блоки возможны.' : '.')
            + (draft.imported.truncated ? ' Текст обрезан до 40 000 знаков.' : '') + '</div>')
          : '')
      + '  <div class="btn-row"><button type="button" class="btn" data-act="vacancy:example">Открыть пример вакансии</button>'
      + (Api.live.enabled ? '<a class="btn" href="#/jobs">Найти вакансии на hh.ru</a>' : '') + '</div>'
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Текст вакансии</h2>'
      + '  <div class="grid-2">'
      + UI.field({ id: 'vac-title', label: 'Должность', model: 'vacancyDraft.title', value: draft.title, required: true })
      + UI.field({ id: 'vac-company', label: 'Компания', model: 'vacancyDraft.company', value: draft.company })
      + '  </div>'
      + UI.field({ id: 'vac-text', label: 'Описание и требования', model: 'vacancyDraft.text', type: 'textarea',
          value: draft.text, required: true, rows: 8,
          hint: 'Текст остаётся в браузере. Демонстрационное сопоставление построено на подготовленном примере.' })
      + UI.select({ id: 'vac-resume', label: 'Резюме для сопоставления', model: 'vacancyDraft.resumeId',
          value: draft.resumeId, options: resumeOptions, act: 'rerender' })
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Предпросмотр подготовки</h2>'
      + (ready
          ? '<ul class="list">'
            + '<li><b>Вакансия:</b> ' + esc(draft.title) + (draft.company ? ' — ' + esc(draft.company) : '') + '</li>'
            + '<li><b>Резюме:</b> ' + esc((Store.resumeById(draft.resumeId) || {}).title || '') + '</li>'
            + '<li><b>Источник требований:</b> вставленный текст (в демо используется подготовленный разбор)</li>'
            + '</ul>'
          : note('info', '<div>Чтобы собрать подготовку, укажите должность, вставьте текст вакансии и выберите резюме.</div>'))
      + (Api.live.enabled
          ? '<p class="small muted">Нажимая «Создать подготовку», вы отправляете резюме и текст вакансии на сервер '
            + 'и сервису модели. Как они обрабатываются — <a href="#/privacy">черновик политики данных</a>.</p>'
          : '')
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn btn--primary" data-act="vacancy:create"'
      + (ready ? '' : ' aria-disabled="true" disabled') + (Store.get().pending ? ' disabled' : '') + '>'
      + (Store.get().pending ? 'Подождите…' : 'Создать подготовку') + '</button>'
      + '    <a class="btn" href="#/vacancies">Отмена</a>'
      + '  </div>'
      + '</div>';
  }

  /* ---------------- Черновик политики обработки данных ---------------- */

  function privacy() {
    var live = Api.live.enabled;
    var ai = Api.live.ai || {};
    return ''
      + pageHead('Обработка данных', 'Черновик. До запуска формулировки должен просмотреть юрист.')
      + note('demo', '<div><strong>Это черновик, а не юридический документ.</strong> Он описывает, как сервис '
        + 'устроен сейчас, чтобы вы понимали, куда уходят данные. Формулировки будут переписаны юристом.</div>')
      + '<div class="card stack">'
      + '  <h2>Что сервис получает</h2>'
      + '  <ul>'
      + '    <li>Текст резюме и то, что вы вводите в мастере: опыт, навыки, образование, пожелания.</li>'
      + '    <li>Текст вакансии, который вы вставляете.</li>'
      + '    <li>Ваши ответы на вопросы и реплики в тренировочном интервью.</li>'
      + '  </ul>'
      + '  <p class="muted">Файлы резюме не читаются: работает только вставленный текст. Звук не записывается, '
      + '  экран не считывается.</p>'
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Куда данные уходят</h2>'
      + (live
          ? '<ul>'
            + '<li>Хранятся в базе этого сервера' + (ai.dataRegion === 'ru' ? '.' : '.') + '</li>'
            + '<li>Для разбора отправляются сервису модели: <b>' + esc(ai.title || 'не задан') + '</b>'
            + (ai.dataRegion === 'ru' ? ' — обработка в РФ.' : ai.dataRegion === 'global'
                ? ' — <span class="tag tag--alert">обработка за пределами РФ</span>. Это трансграничная передача персональных данных.'
                : ai.live ? '.' : ' — сейчас это заглушка, данные никуда не отправляются.') + '</li>'
            + '</ul>'
          : '<p class="muted">В демо-режиме данные не покидают вкладку браузера и удаляются при перезагрузке.</p>')
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Сколько хранятся</h2>'
      + '  <p class="muted">Данные сессии, к которой не обращались 90 дней, удаляются автоматически вместе с резюме, '
      + '  вакансиями и подготовками. Срок задаётся владельцем сервера. Удалить раньше можно кнопками '
      + '  в разделе «Настройки и данные».</p>'
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Что не собирается</h2>'
      + '  <ul>'
      + '    <li>Нет аккаунтов, паролей и почты: сессия анонимная, по cookie.</li>'
      + '    <li>Нет сторонних счётчиков и трекеров: страница не делает запросов никуда, кроме этого сервера.</li>'
      + '    <li>Ключ доступа к сервису модели вам не виден и в браузер не передаётся.</li>'
      + '    <li>В журналах сервера текст резюме и ответы скрыты.</li>'
      + '  </ul>'
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Что ещё не решено</h2>'
      + '  <ul class="muted">'
      + '    <li>Юридическое лицо-оператор и уведомление регулятора об обработке.</li>'
      + '    <li>Точная формулировка согласия и порядок его отзыва.</li>'
      + '    <li>Порядок ответа на запрос об удалении данных.</li>'
      + '  </ul>'
      + '</div>';
  }

  return {
    privacy: privacy,
    pageHead: pageHead,
    prepTitle: prepTitle,
    staleBanner: staleBanner,
    nextStep: nextStep,
    previewCard: previewCard,
    splitLines: splitLines,
    start: start,
    auth: auth,
    onboarding: onboarding,
    overview: overview,
    resumeWizard: resumeWizard,
    upload: upload,
    jobs: jobs,
    resumes: resumes,
    resumeCard: resumeCard,
    vacancies: vacancies,
    vacancyNew: vacancyNew
  };
})();
