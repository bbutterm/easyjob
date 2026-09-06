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

  function start() {
    return ''
      + '<div class="public"><div class="public__inner stack">'
      + '  <div class="public__brand">'
      + '    <h1>Карьерный помощник</h1>'
      + '    <span class="tag tag--demo">Рабочее название</span>'
      + '  </div>'
      + note('demo', '<div><strong>Демо — ИИ и платежи не подключены.</strong> Это кликабельный макет интерфейса. '
        + 'Тексты «от ИИ» — заранее подготовленные образцы. Введённые данные и файлы остаются в браузере.</div>')
      + '  <div class="card stack">'
      + '    <h2>Подготовка к поиску работы и собеседованиям</h2>'
      + '    <p class="muted">Собрать или улучшить резюме, разобрать конкретную вакансию, подготовить ответы '
      + '    на вероятные вопросы и потренироваться в пробном интервью — текстом или голосом.</p>'
      + '    <ul class="muted">'
      + '      <li>Резюме с нуля по шагам или разбор уже готового.</li>'
      + '      <li>Сопоставление своего опыта с требованиями вакансии.</li>'
      + '      <li>Вероятные вопросы и тренировочные интервью.</li>'
      + '      <li>Отдельный раздел про помощника на реальном собеседовании.</li>'
      + '    </ul>'
      + '    <div class="btn-row">'
      + '      <a class="btn btn--primary" href="#/onboarding">Открыть демо</a>'
      + '      <a class="btn" href="#/auth/login">Экран входа (заглушка)</a>'
      + '    </div>'
      + '    <p class="faint" style="font-size:13px">Регистрация не требуется: макет открывается сразу.</p>'
      + '  </div>'
      + '</div></div>';
  }

  function auth(mode) {
    var isRegister = mode === 'register';
    var isReset = mode === 'reset';
    var title = isRegister ? 'Регистрация' : (isReset ? 'Восстановление доступа' : 'Вход');
    var body;
    if (isReset) {
      body = UI.field({ id: 'auth-email', label: 'Электронная почта', model: '', value: '', placeholder: 'name@example.com', hint: 'Поле неактивно: письма не отправляются.' });
    } else {
      body = UI.field({ id: 'auth-email', label: 'Электронная почта', model: '', value: '', placeholder: 'name@example.com' })
        + '<div class="field"><span class="field__label">Пароль</span>'
        + '<div class="note note--info" style="margin-top:4px">Поле пароля в макете не показывается: '
        + 'прототип не собирает и не хранит пароли.</div></div>';
    }
    return ''
      + '<div class="public"><div class="public__inner stack">'
      + '  <div class="public__brand"><h1>Карьерный помощник</h1><span class="tag tag--demo">Демо</span></div>'
      + '  <div class="card stack">'
      + '    <h2>' + esc(title) + '</h2>'
      + note('alert', '<div><strong>Настоящей авторизации нет.</strong> Это визуальная заглушка: данные не '
        + 'проверяются, аккаунт не создаётся, письма не отправляются.</div>')
      + body
      + '    <div class="btn-row">'
      + '      <a class="btn btn--primary" href="#/onboarding">Продолжить в демо без входа</a>'
      + (isReset
          ? '<a class="btn" href="#/auth/login">Назад ко входу</a>'
          : (isRegister
              ? '<a class="btn" href="#/auth/login">У меня есть аккаунт</a>'
              : '<a class="btn" href="#/auth/register">Создать аккаунт</a>'))
      + '    </div>'
      + (isReset ? '' : '<p><a href="#/auth/reset">Забыли пароль?</a></p>')
      + '  </div>'
      + '  <p><a href="#/start">← На начальную страницу</a></p>'
      + '</div></div>';
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
      return pageHead('Обзор', 'Здесь появятся ваши подготовки к собеседованиям.')
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
      + pageHead('Обзор', 'Последние подготовки и ближайший шаг.')
      + note('demo', '<div>Демонстрационный комплект собран для профессии <strong>'
          + esc(DEMO_DATA.professionName) + '</strong>'
          + (DEMO_DATA.isGenericProfession ? ' (общий шаблон: этой профессии нет в библиотеке примеров)' : '')
          + '. Профессию можно сменить в панели «Состояния демо» или создав резюме на другую профессию.</div>')
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
      + '<div class="card stack">'
      + '  <h2>Режим демо</h2>'
      + '  <p class="muted">Можно переключиться между пустым и заполненным состоянием, чтобы посмотреть оба варианта.</p>'
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn" data-act="demo:scenario-empty">Показать пустое состояние</button>'
      + '    <button type="button" class="btn" data-act="demo:scenario-filled">Показать заполненное состояние</button>'
      + '    <a class="btn" href="#/history">История</a>'
      + '  </div>'
      + '</div>';
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
        + '<div class="row-item__meta">Файл выбран локально. Он не загружается на сервер и не читается макетом.</div>'
        + '</div><div class="btn-row">'
        + '<button type="button" class="btn btn--sm" data-act="upload:pick">Заменить</button>'
        + '<button type="button" class="btn btn--sm btn--danger" data-act="upload:clear">Удалить</button>'
        + '</div></div>'
      : '';

    return ''
      + pageHead('Загрузка готового резюме', 'Выберите файл, чтобы посмотреть, как устроен разбор.')
      + note('alert', '<div><strong>Чтение PDF и DOCX ещё не реализовано.</strong> Файл остаётся на вашем '
        + 'устройстве: он не отправляется по сети и не анализируется. Отчёт ниже — общий демонстрационный образец, '
        + 'а не разбор вашего документа.</div>')
      + '<div class="card">'
      + '  <button type="button" class="dropzone" id="dropzone" data-act="upload:pick">'
      + '    <b>Перетащите файл сюда или нажмите, чтобы выбрать</b>'
      + '    <span class="muted">Для демонстрации подойдут PDF или DOCX</span>'
      + '  </button>'
      + '  <input type="file" id="file-input" class="visually-hidden" accept=".pdf,.docx,.doc,.rtf,.txt" '
      + '    aria-label="Выбрать файл резюме">'
      + fileRow
      + '  <hr class="divide">'
      + UI.field({ id: 'upload-text', label: 'Или вставьте текст резюме', type: 'textarea', rows: 8,
          model: 'upload.text', value: up.text || '',
          placeholder: 'Скопируйте текст из своего резюме',
          hint: Api.live.enabled
            ? 'Текст уйдёт на сервер и будет разобран моделью. Файлы пока не читаются — только вставленный текст.'
            : 'В демо-режиме текст остаётся в браузере и не анализируется.' })
      + '  <div class="btn-row" style="margin-top:16px">'
      + (Api.live.enabled
          ? '<button type="button" class="btn btn--primary" data-act="upload:review"'
            + (state.pending ? ' disabled' : '') + '>'
            + (state.pending ? 'Разбираю…' : 'Разобрать резюме') + '</button>'
          : '')
      + '    <button type="button" class="btn' + (Api.live.enabled ? '' : ' btn--primary')
      + '" data-act="upload:show-analysis">Показать пример анализа</button>'
      + '    <a class="btn" href="#/resumes">К списку резюме</a>'
      + '  </div>'
      + '</div>'
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
            + '<small>' + (Api.live.ai && Api.live.ai.live ? 'Выполнен моделью по вставленному тексту' : 'Сервер на заглушке: структура настоящая, содержание фиксированное') + '</small></div>'
            + (Api.live.ai && Api.live.ai.live ? '' : UI.demoBadge('Заглушка')) + '</div>'
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
      + '  <div class="card__head"><div class="card__title"><h2>Демонстрационная версия резюме</h2>'
      + '  <small>Принятые предложения применяются к образцу</small></div></div>'
      + (accepted.length
          ? '<ul class="list">' + accepted.map(function (s) {
              return '<li><b>' + esc(s.title) + '</b><div class="diff-new">' + esc(s.after) + '</div></li>';
            }).join('') + '</ul>'
          : '<p class="muted">Ни одно предложение пока не принято. Нажмите «Принять», чтобы увидеть изменение в образце.</p>')
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn btn--primary" data-act="upload:save">Сохранить как версию резюме</button>'
      + '    <a class="btn" href="#/vacancy/new">Перейти к вакансии</a>'
      + '  </div>'
      + '</div>';
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
        + ' · ' + (r.source === 'uploaded' ? 'из файла' : 'создано в мастере') + '</div>'
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
        + ' · резюме: ' + esc(resume ? resume.title : 'не выбрано') + '</div>'
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
      + '<div class="btn-row" style="margin-bottom:16px"><a class="btn btn--primary" href="#/vacancy/new">Добавить вакансию</a></div>'
      + '<ul class="list">' + rows + '</ul>';
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
          value: draft.url || '', placeholder: 'https://hh.ru/vacancy/...' })
      + '  <div class="btn-row"><button type="button" class="btn" data-act="stub:import">Импортировать по ссылке</button></div>'
      + note('alert', '<div><strong>Получение вакансии по ссылке не реализовано.</strong> Макет не ходит в сеть. '
        + 'Вставьте текст вручную или откройте подготовленный пример.</div>')
      + '  <div class="btn-row"><button type="button" class="btn" data-act="vacancy:example">Открыть пример вакансии</button></div>'
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
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn btn--primary" data-act="vacancy:create"'
      + (ready ? '' : ' aria-disabled="true" disabled') + '>Создать подготовку</button>'
      + '    <a class="btn" href="#/vacancies">Отмена</a>'
      + '  </div>'
      + '</div>';
  }

  return {
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
    resumes: resumes,
    resumeCard: resumeCard,
    vacancies: vacancies,
    vacancyNew: vacancyNew
  };
})();
