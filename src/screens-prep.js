/* ============================================================
   Экраны: сопоставление, вопросы, тренировочные интервью,
   помощник на собеседовании, тарифы, история, настройки, данные.
   ============================================================ */

var ScreensPrep = (function () {
  'use strict';

  var esc = UI.esc;
  var escLines = UI.escLines;
  var note = UI.note;
  var pageHead = ScreensCore.pageHead;
  var staleBanner = ScreensCore.staleBanner;

  var STATUS_LABEL = {
    confirmed: { text: 'Подтверждено', cls: 'tag--ok' },
    unclear: { text: 'Нужно уточнить', cls: 'tag--info' },
    missing: { text: 'Не указано в резюме', cls: 'tag--alert' }
  };

  /* Вопросы подготовки: с сервера, если есть, иначе демонстрационные. */
  function questionsFor(prep) {
    return (prep && Array.isArray(prep.questions) && prep.questions.length) ? prep.questions : DEMO_DATA.questions;
  }

  function isLivePrep(prep) {
    return !!(prep && prep.live && Api.live.enabled);
  }

  function needPrep(prep, action) {
    return pageHead(action)
      + UI.emptyState('Подготовка не выбрана',
          'Сначала добавьте вакансию и выберите резюме — макет свяжет их в одну подготовку.',
          'Добавить вакансию', 'go:#/vacancy/new');
  }

  function sourcesBar(prep, kind) {
    var resume = Store.resumeById(prep.resumeId);
    var vacancy = Store.vacancyById(prep.vacancyId);
    return ''
      + '<div class="toolbar">'
      + '  <span><b>Вакансия:</b> ' + esc(vacancy ? vacancy.title + ' · ' + vacancy.company : 'не выбрана') + '</span>'
      + '  <span><b>Резюме:</b> ' + esc(resume ? resume.title : 'не выбрано') + '</span>'
      + (kind ? modelSourceLine(prep, kind) : '')
      + '</div>';
  }

  /* Кто сделал результат: заглушка или модель, провайдер, этап, когда.
     Демонстрационный результат никогда не подписывается как настоящий. */
  function modelSourceLine(prep, kind) {
    if (!isLivePrep(prep)) return '<span class="muted model-source">Источник: демонстрационные данные макета</span>';
    var src = (prep.sources || {})[kind];
    if (!src) return '';
    var when = src.createdAt ? new Date(src.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    return '<span class="muted model-source">Источник: ' + (src.mode === 'mock' ? 'заглушка модели' : 'модель')
      + (src.provider ? ' · ' + esc(src.provider) : '') + (src.model && src.mode !== 'mock' ? ' · ' + esc(src.model) : '')
      + (src.stage ? ' · ' + esc(src.stage) : '') + (when ? ' · ' + esc(when) : '') + '</span>';
  }

  /* ---------------- Сопоставление ---------------- */

  function match(prepId) {
    var state = Store.get();
    var prep = Store.prepById(prepId) || Store.activePrep();
    if (!prep) return needPrep(prep, 'Сопоставление резюме с вакансией');
    if (state.scenario === 'loading') return pageHead('Сопоставление') + UI.skeletonBlock();
    if (state.scenario === 'error') return pageHead('Сопоставление') + UI.errorBlock();

    var vacancy = Store.vacancyById(prep.vacancyId);
    var requirements = (prep.match && prep.match.length) ? prep.match
      : ((vacancy && vacancy.requirements) || DEMO_DATA.vacancy.requirements);
    var liveMatch = isLivePrep(prep) && prep.match && prep.match.length > 0;

    var counts = { confirmed: 0, unclear: 0, missing: 0 };
    requirements.forEach(function (r) { counts[r.status] += 1; });

    var open = state.openRequirement || '';
    var items = requirements.map(function (r) {
      var label = STATUS_LABEL[r.status];
      var expanded = open === r.id;
      return ''
        + '<div class="req-item">'
        + '  <button type="button" class="req-item__head" data-act="req:toggle" data-id="' + esc(r.id) + '"'
        + '    aria-expanded="' + (expanded ? 'true' : 'false') + '">'
        + '    <span class="tag ' + label.cls + '">' + esc(label.text) + '</span>'
        + '    <span class="req-item__text">' + esc(r.text) + '</span>'
        + '    <span class="req-item__chev" aria-hidden="true">' + (expanded ? '▲' : '▼') + '</span>'
        + '  </button>'
        + (expanded
            ? '<div class="req-item__body stack-sm">'
              + '<p><b>Что нашли в резюме:</b> ' + esc(r.evidence) + '</p>'
              + '<p><b>Как подготовиться:</b> ' + esc(r.advice) + '</p>'
              + '</div>'
            : '')
        + '</div>';
    }).join('');

    return ''
      + pageHead('Сопоставление резюме с вакансией',
          'Требования вакансии и то, что подтверждается демонстрационным резюме.')
      + sourcesBar(prep, 'match')
      + staleBanner(prep)
      + (liveMatch
          ? (Api.live.ai && Api.live.ai.live
              ? note('info', '<div><strong>Сопоставление выполнено моделью</strong> по вашему резюме и тексту вакансии. '
                + 'Проверяйте выводы: модель может ошибаться.</div>')
              : note('demo', '<div><strong>Сервер работает на заглушке модели.</strong> Требования взяты из вашего '
                + 'текста вакансии, но статусы и объяснения — фиксированные, пока не подключён провайдер.</div>'))
          : note('demo', '<div><strong>Это образец отчёта.</strong> Разбор построен на подготовленном комплекте данных '
            + 'и не является анализом введённого вами текста.</div>'))
      + '<div class="card stack">'
      + '  <div class="summary-counts">'
      + '    <div class="count-box"><b>' + counts.confirmed + '</b><span>подтверждено резюме</span></div>'
      + '    <div class="count-box"><b>' + counts.unclear + '</b><span>нужно уточнить</span></div>'
      + '    <div class="count-box"><b>' + counts.missing + '</b><span>не указано в резюме</span></div>'
      + '  </div>'
      + '  <p class="faint" style="font-size:13px">Общий процент соответствия не показывается: он не отражает '
      + '  вероятность приглашения и мешает разобрать конкретные пункты.</p>'
      + '</div>'
      + '<div class="card"><div class="card__head"><div class="card__title"><h2>Требования вакансии</h2>'
      + '<small>Нажмите на требование, чтобы раскрыть объяснение</small></div></div>' + items + '</div>'
      + '<div class="card"><div class="btn-row">'
      + '  <a class="btn" href="#/resumes">Улучшить резюме</a>'
      + '  <button type="button" class="btn btn--primary" data-act="go:#/prep/' + esc(prep.id) + '/questions">Перейти к вопросам</button>'
      + '  <button type="button" class="btn" data-act="go:#/prep/' + esc(prep.id) + '/card">Карточка подготовки</button>'
      + '  <button type="button" class="btn" data-act="prep:change-sources" data-id="' + esc(prep.id) + '">Изменить исходники</button>'
      + '</div></div>';
  }

  /* ---------------- Вопросы ---------------- */

  function questions(prepId) {
    var state = Store.get();
    var prep = Store.prepById(prepId) || Store.activePrep();
    if (!prep) return needPrep(prep, 'Вопросы для подготовки');
    if (state.scenario === 'loading') return pageHead('Вопросы для подготовки') + UI.skeletonBlock();
    if (state.scenario === 'error') return pageHead('Вопросы для подготовки') + UI.errorBlock();

    var filterTopic = state.qFilterTopic || 'all';
    var filterReady = state.qFilterReady || 'all';
    var openHints = state.qOpenHints || {};

    /* В режиме сервера вопросы генерируются по запросу: без них показываем кнопку. */
    if (isLivePrep(prep) && !(prep.questions && prep.questions.length)) {
      return ''
        + pageHead('Вероятные вопросы для подготовки', 'Вопросы подбираются по требованиям вакансии и вашему резюме.')
        + sourcesBar(prep, 'questions')
        + staleBanner(prep)
        + '<div class="card stack">'
        + '  <p class="muted">Вопросы ещё не собраны для этой подготовки.</p>'
        + '  <div class="btn-row">'
        + '    <button type="button" class="btn btn--primary" data-act="questions:generate" data-id="' + esc(prep.id) + '"'
        + (state.pending ? ' disabled' : '') + '>'
        + (state.pending ? 'Собираю…' : 'Собрать вопросы') + '</button>'
        + '  </div>'
        + '</div>';
    }

    var allQuestions = questionsFor(prep);
    var topics = ['all'];
    allQuestions.forEach(function (q) {
      if (topics.indexOf(q.topic) < 0) topics.push(q.topic);
    });

    var visible = allQuestions.filter(function (q) {
      if (filterTopic !== 'all' && q.topic !== filterTopic) return false;
      if (filterReady === 'ready' && !prep.ready[q.id]) return false;
      if (filterReady === 'todo' && prep.ready[q.id]) return false;
      return true;
    });

    var readyCount = allQuestions.filter(function (q) { return prep.ready[q.id]; }).length;

    var items = visible.map(function (q) {
      var isReady = !!prep.ready[q.id];
      var hintOpen = !!openHints[q.id];
      return ''
        + '<div class="q-item">'
        + '  <div class="q-item__top">'
        + '    <span class="tag">' + esc(q.topic) + '</span>'
        + (isReady ? '<span class="tag tag--ok">Подготовлено</span>' : '')
        + '  </div>'
        + '  <div class="q-item__text">' + esc(q.text) + '</div>'
        + '  <p class="muted" style="font-size:13.5px"><b>Почему релевантно:</b> ' + esc(q.why) + '</p>'
        + UI.field({ id: 'ans-' + q.id, label: 'Ваш ответ', type: 'textarea',
            model: 'preps.' + prepIndex(prep) + '.answers.' + q.id,
            value: prep.answers[q.id] || '',
            hint: isLivePrep(prep) ? 'Сохраняется на сервере автоматически.'
              : 'Сохраняется только в памяти страницы на время сеанса макета.' })
        + '  <div class="btn-row">'
        + '    <button type="button" class="btn btn--sm" data-act="q:hint" data-id="' + esc(q.id) + '" '
        + '      aria-expanded="' + (hintOpen ? 'true' : 'false') + '">'
        + (hintOpen ? 'Скрыть ориентиры' : 'Показать ориентиры') + '</button>'
        + '    <button type="button" class="btn btn--sm' + (isReady ? '' : ' btn--primary') + '" '
        + '      data-act="q:ready" data-id="' + esc(q.id) + '">'
        + (isReady ? 'Снять отметку' : 'Отметить «Подготовлено»') + '</button>'
        + '  </div>'
        + (hintOpen
            ? '<div class="note note--info" style="margin-top:12px"><div><b>Ориентиры:</b> ' + esc(q.guidance) + '</div></div>'
            : '')
        + feedbackBlock(prep, q)
        + '</div>';
    }).join('');

    return ''
      + pageHead('Вероятные вопросы для подготовки',
          isLivePrep(prep)
            ? 'Подобраны по требованиям вакансии и вашему резюме. Никаких обещаний, что спросят именно это.'
            : 'Список подготовлен для демонстрации. Никаких обещаний, что спросят именно это.')
      + sourcesBar(prep, 'questions')
      + staleBanner(prep)
      + '<div class="toolbar">'
      + '  <label for="q-topic">Тема</label>'
      + '  <select id="q-topic" data-change-act="q:filter-topic">'
      + topics.map(function (t) {
          return '<option value="' + esc(t) + '"' + (t === filterTopic ? ' selected' : '') + '>'
            + (t === 'all' ? 'Все темы' : esc(t)) + '</option>';
        }).join('')
      + '  </select>'
      + '  <label for="q-ready">Готовность</label>'
      + '  <select id="q-ready" data-change-act="q:filter-ready">'
      + '    <option value="all"' + (filterReady === 'all' ? ' selected' : '') + '>Все</option>'
      + '    <option value="ready"' + (filterReady === 'ready' ? ' selected' : '') + '>Подготовленные</option>'
      + '    <option value="todo"' + (filterReady === 'todo' ? ' selected' : '') + '>Осталось разобрать</option>'
      + '  </select>'
      + '  <span class="muted">Подготовлено ' + readyCount + ' из ' + allQuestions.length + '</span>'
      + '</div>'
      + (items || UI.emptyState('Под фильтр ничего не попало', 'Измените тему или готовность.', 'Сбросить фильтры', 'q:filter-reset'))
      + '<div class="card"><div class="btn-row">'
      + '  <button type="button" class="btn btn--primary" data-act="go:#/prep/' + esc(prep.id) + '/interview">'
      + '    Начать пробное интервью</button>'
      + '  <button type="button" class="btn" data-act="go:#/prep/' + esc(prep.id) + '/card">'
      + '    Собрать карточку подготовки</button>'
      + '  <button type="button" class="btn" data-act="go:#/prep/' + esc(prep.id) + '/match">Вернуться к сопоставлению</button>'
      + '</div></div>';
  }

  /* Обратная связь на ответ: только в режиме сервера. Показывает сильные
     стороны, пробелы и вариант переформулировки с источником; если ответ
     изменился после оценки — пометка «устарело». */
  function feedbackBlock(prep, q) {
    if (!isLivePrep(prep)) return '';
    var fb = (prep.feedback || {})[q.id];
    var busy = !!(prep.feedbackBusy || {})[q.id];
    var error = (prep.feedbackError || {})[q.id] || '';
    var answer = String(prep.answers[q.id] || '').trim();
    var outdated = fb && fb.answerText !== undefined && fb.answerText !== answer;
    var html = '<div class="q-feedback" data-q="' + esc(q.id) + '">'
      + '<div class="btn-row" style="margin-top:8px">'
      + '  <button type="button" class="btn btn--sm" data-act="q:feedback" data-id="' + esc(q.id) + '"'
      + (busy || !answer ? ' disabled' : '') + '>'
      + (busy ? 'Оцениваю ответ…' : (fb ? 'Оценить ответ заново' : 'Получить обратную связь')) + '</button>'
      + (!answer && !busy ? '<span class="muted small">Напишите ответ, чтобы получить обратную связь.</span>' : '')
      + '</div>';
    if (error) {
      html += note('alert', '<div class="q-feedback__error"><strong>Обратная связь не получена.</strong> ' + esc(error)
        + ' <button type="button" class="btn btn--sm" data-act="q:feedback" data-id="' + esc(q.id) + '">Повторить</button></div>');
    }
    if (fb && !busy) {
      var src = fb.source || {};
      html += '<div class="note note--' + (outdated ? 'demo' : 'info') + ' q-feedback__result" style="margin-top:8px"><div>'
        + (outdated ? '<p><strong>Ответ изменился после оценки.</strong> Оцените заново, чтобы обратная связь соответствовала тексту.</p>' : '')
        + (fb.strong && fb.strong.length ? '<p><b>Сильно:</b></p><ul>' + fb.strong.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '')
        + (fb.gaps && fb.gaps.length ? '<p><b>Чего не хватает:</b></p><ul>' + fb.gaps.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '')
        + (fb.rewrite ? '<p><b>Вариант формулировки:</b></p><div>' + escLines(fb.rewrite) + '</div>' : '')
        + '<p class="muted small">' + (src.mode === 'mock' ? 'Заглушка модели, не настоящая оценка' : 'Оценка модели')
        + (src.provider ? ': ' + esc(src.provider) + (src.model ? ' · ' + esc(src.model) : '') : '')
        + (src.stage ? ' · ' + esc(src.stage) : '') + '. Оценивается ответ, а не человек: без баллов.</p>'
        + '</div></div>';
    }
    return html + '</div>';
  }

  function prepIndex(prep) {
    var list = Store.get().preps;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === prep.id) return i;
    }
    return 0;
  }

  /* ---------------- Список тренировок ---------------- */

  function interviews() {
    var state = Store.get();
    if (!Store.sectionAllowed('interviews')) return locked('Тренировочные интервью', 'training');
    if (!state.preps.length) return needPrep(null, 'Тренировочные интервью');

    var prep = Store.activePrep() || state.preps[0];
    var options = state.preps.map(function (p) {
      return { value: p.id, label: ScreensCore.prepTitle(p) };
    });

    return ''
      + pageHead('Тренировочные интервью', 'Выберите подготовку и формат тренировки.')
      + '<div class="card stack">'
      + UI.select({ id: 'training-prep', label: 'Подготовка', value: prep.id, options: options, act: 'prep:select' })
      + note('demo', '<div>Реплики интервьюера берутся из фиксированного сценария. Ответы не оцениваются ИИ.</div>')
      + '</div>'
      + '<div class="grid-2">'
      + '  <div class="card stack">'
      + '    <h2>Текстовое интервью</h2>'
      + '    <p class="muted">Чат: вопрос, ваш ответ, следующий вопрос и демонстрационный итог.</p>'
      + '    <div class="btn-row"><button type="button" class="btn btn--primary" data-act="go:#/prep/'
      + esc(prep.id) + '/interview">Открыть чат</button></div>'
      + '  </div>'
      + '  <div class="card stack">'
      + '    <h2>Голосовое интервью</h2>'
      + '    <p class="muted">Симуляция разговора: статусы, расшифровка и завершение. Микрофон не запрашивается.</p>'
      + '    <div class="btn-row"><button type="button" class="btn" data-act="go:#/prep/'
      + esc(prep.id) + '/voice">Открыть голосовой экран</button></div>'
      + '  </div>'
      + '</div>'
      + '<div class="card stack"><h2>Прошлые тренировки</h2>'
      + (state.history.filter(function (h) { return /интервью/i.test(h.what); }).length
          ? '<ul class="list">' + state.history.filter(function (h) { return /интервью/i.test(h.what); })
              .map(function (h) {
                return '<li><div class="row-item"><div class="row-item__main">'
                  + '<div class="row-item__title">' + esc(h.what) + '</div>'
                  + '<div class="row-item__meta">' + esc(h.when) + '</div></div>'
                  + '<button type="button" class="btn btn--sm" data-act="go:' + esc(h.route) + '">Открыть</button>'
                  + '</div></li>';
              }).join('') + '</ul>'
          : '<p class="muted">Тренировок пока не было.</p>')
      + '</div>';
  }

  /* ---------------- Текстовое интервью ---------------- */

  function ensureChat(prep) {
    if (!prep.chat) {
      prep.chat = { started: false, index: 0, messages: [], pending: false, finished: false, failed: false, draft: '' };
    }
    return prep.chat;
  }

  function interview(prepId) {
    var state = Store.get();
    if (!Store.sectionAllowed('interviews')) return locked('Текстовое пробное интервью', 'training');
    var prep = Store.prepById(prepId) || Store.activePrep();
    if (!prep) return needPrep(prep, 'Текстовое пробное интервью');
    var chat = ensureChat(prep);

    if (!chat.started) {
      return ''
        + pageHead('Текстовое пробное интервью', 'Настройка формата перед началом.')
        + ScreensCore.staleBanner(prep)
        + '<div class="card stack">'
        + sourcesBar(prep)
        + '  <h2>Формат</h2>'
        + '  <p class="muted">Пять вопросов из подготовленного сценария: опыт, процессы, SQL, постановки и кейс.</p>'
        + (isLivePrep(prep) && Api.live.ai && Api.live.ai.live
            ? note('info', '<div>Интервьюер — модель. Она задаёт вопросы по вашей подготовке и не оценивает ответы вслух: '
              + 'разбор будет в итоге.</div>')
            : note('demo', '<div><strong>Реплики интервьюера — фиксированный сценарий.</strong> Ваши ответы видны в '
              + 'переписке, но не анализируются: настоящей оценки ответа нет.</div>'))
        + '  <div class="btn-row"><button type="button" class="btn btn--primary" data-act="chat:start">Начать интервью</button>'
        + '  <button type="button" class="btn" data-act="go:#/prep/' + esc(prep.id) + '/questions">Сначала разобрать вопросы</button></div>'
        + '</div>';
    }

    if (chat.finished) return interviewSummary(prep);

    var messages = chat.messages.map(function (m) {
      var cls = m.who === 'user' ? 'msg msg--user' : (m.who === 'system' ? 'msg msg--sys' : 'msg');
      var who = m.who === 'user' ? 'Вы' : (m.who === 'system' ? 'Макет'
        : (isLivePrep(prep) ? 'Интервьюер' : 'Интервьюер (демо-сценарий)'));
      return '<div class="' + cls + '"><span class="msg__who">' + esc(who) + '</span>'
        + '<div class="msg__body">' + escLines(m.text) + '</div></div>';
    }).join('');

    var pending = chat.pending
      ? '<div class="msg"><span class="msg__who">' + (isLivePrep(prep) ? 'Интервьюер' : 'Интервьюер (демо-сценарий)') + '</span>'
        + '<div class="msg__body">' + (chat.partial ? escLines(chat.partial) : '')
        + (chat.status && !chat.partial ? '<span class="muted chat-status">' + esc(chat.status) + ' </span>' : '')
        + '<span class="dots" aria-label="Готовится следующая реплика">'
        + '<span></span><span></span><span></span></span></div></div>'
      : '';

    /* Состояние контекста с сервера: исходники изменились — интервью идёт
       на прежней версии; память интервью — версия и покрытие. */
    var ctx = isLivePrep(prep) ? chat.context : null;
    var contextBlock = '';
    if (ctx && ctx.sourcesChanged) {
      contextBlock += note('info', '<div><strong>Резюме или вакансия изменились после начала интервью.</strong> '
        + 'Интервью продолжается на прежней версии. Чтобы использовать новую, пересоберите подготовку и начните '
        + 'новое интервью.</div>');
    }
    var memoryLine = '';
    if (ctx && ctx.memoryStatus === 'valid') {
      memoryLine = 'Память интервью: версия ' + esc(String(ctx.memoryVersion)) + ', покрыты реплики до № '
        + esc(String((ctx.compaction && ctx.compaction.coveredThroughSeq) || Math.max(0, ctx.windowFrom - 1)));
    } else if (ctx && ctx.memoryStatus === 'stale') {
      memoryLine = 'Память интервью устарела: исходники изменились, реплики идут окном.';
    } else if (ctx && ctx.compaction && ctx.compaction.ran && ctx.compaction.ok === false) {
      memoryLine = 'Память интервью не обновилась: ' + esc(ctx.compaction.error || 'ошибка сжатия') + '. Реплики идут окном.';
    }
    if (memoryLine) contextBlock += '<p class="muted chat-memory">' + memoryLine + '</p>';

    var failedBlock = chat.failed
      ? note('alert', '<div><strong>Демонстрационная ошибка отправки.</strong> Так выглядит состояние, когда реплика '
          + 'не прошла. <button type="button" class="btn btn--sm" style="margin-top:8px" data-act="chat:retry">Повторить</button></div>')
      : '';

    return ''
      + pageHead('Текстовое пробное интервью', isLivePrep(prep)
          ? 'Вопрос ' + (chat.index + 1)
          : 'Вопрос ' + Math.min(chat.index + 1, DEMO_DATA.interviewScript.length)
            + ' из ' + DEMO_DATA.interviewScript.length)
      + sourcesBar(prep)
      + '<div class="card stack">'
      + contextBlock
      + '  <div class="chat" id="chat-log" role="log" aria-live="polite">' + messages + pending + '</div>'
      + failedBlock
      + '<div id="stt-slot"></div>'
      + UI.field({ id: 'chat-input', label: 'Ваш ответ', type: 'textarea', model: 'chatDraft',
          value: chat.draft, placeholder: 'Напишите ответ так, как сказали бы вслух',
          hint: 'Текст остаётся в браузере и сбрасывается после перезагрузки.' })
      + '  <div class="btn-row btn-row--between">'
      + '    <div class="btn-row">'
      + '      <button type="button" class="btn btn--danger" data-act="chat:exit">Завершить и выйти</button>'
      + '      <button type="button" class="btn btn--quiet btn--sm" data-act="chat:fail">Показать ошибку отправки (демо)</button>'
      + '    </div>'
      + '    <button type="button" class="btn btn--primary" data-act="chat:send"' + (chat.pending ? ' disabled' : '') + '>'
      + '      Отправить ответ</button>'
      + '  </div>'
      + '</div>';
  }

  function interviewSummary(prep) {
    var s = (prep.chat && prep.chat.summary) || DEMO_DATA.interviewSummary;
    var real = !!(prep.chat && prep.chat.summary) && Api.live.ai && Api.live.ai.live;
    var answers = prep.chat.messages.filter(function (m) { return m.who === 'user'; });
    return ''
      + pageHead('Итог пробного интервью', real ? 'Разбор по репликам этой тренировки.'
          : 'Демонстрационный отчёт по завершённой тренировке.')
      + (real
          ? note('info', '<div>Итог составлен моделью по вашим ' + answers.length + ' ответам. Это мнение, а не оценка: '
            + 'проверяйте выводы и сверяйте с требованиями вакансии.</div>')
          : note('demo', '<div><strong>Отчёт заранее подготовлен.</strong> Он не составлен по вашим ответам: настоящей '
            + 'оценки в макете нет. Ваши ' + answers.length + ' ответ(ов) остались только в переписке этого сеанса.</div>'))
      + '<div class="card stack">'
      + '  <h2>Примеры сильных ответов</h2>'
      + '  <ul>' + (s.strong || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
      + '  <h2>Темы для повторения</h2>'
      + '  <ul>' + (s.repeat || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
      + '  <h2>Рекомендации</h2>'
      + '  <ul>' + (s.advice || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
      + '</div>'
      + '<div class="card"><div class="btn-row">'
      + '  <button type="button" class="btn btn--primary" data-act="chat:restart">Повторить тренировку</button>'
      + '  <button type="button" class="btn" data-act="go:#/prep/' + esc(prep.id) + '/voice">Попробовать голосом</button>'
      + '  <button type="button" class="btn" data-act="go:#/prep/' + esc(prep.id) + '/questions">Вернуться к вопросам</button>'
      + '</div></div>';
  }

  /* ---------------- Голосовое интервью ---------------- */

  function ensureVoice(prep) {
    if (!prep.voice) {
      prep.voice = { status: 'idle', line: 0, finished: false };
    }
    return prep.voice;
  }

  var VOICE_STATUS = {
    idle: { label: 'Не начато', hint: 'Нажмите «Начать разговор», чтобы запустить демонстрационный сценарий.' },
    listening: { label: 'Слушаю', hint: 'Так выглядел бы экран, пока говорит кандидат. Микрофон не используется.' },
    thinking: { label: 'Готовлю ответ', hint: 'Пауза перед следующей репликой сценария.' },
    speaking: { label: 'Отвечаю', hint: 'Реплика интервьюера из фиксированного сценария. Синтез речи не включён.' },
    paused: { label: 'Пауза', hint: 'Разговор приостановлен.' },
    lost: { label: 'Связь потеряна', hint: 'Демонстрация состояния обрыва связи.' }
  };

  function voice(prepId) {
    var state = Store.get();
    if (!Store.sectionAllowed('interviews')) return locked('Голосовое пробное интервью', 'training');
    var prep = Store.prepById(prepId) || Store.activePrep();
    if (!prep) return needPrep(prep, 'Голосовое пробное интервью');
    var v = ensureVoice(prep);

    if (v.finished) {
      return ''
        + pageHead('Итог голосовой тренировки', 'Демонстрационный итог.')
        + note('demo', '<div>Звук не записывался, расшифровка взята из сценария макета.</div>')
        + '<div class="card stack">'
        + '  <h2>Что было в сценарии</h2>'
        + '  <ul>' + DEMO_DATA.voiceScript.map(function (l) {
              return '<li><b>' + esc(l.who) + ':</b> ' + esc(l.text) + '</li>';
            }).join('') + '</ul>'
        + '  <h2>На что обратить внимание</h2>'
        + '  <ul>' + DEMO_DATA.interviewSummary.advice.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
        + '</div>'
        + '<div class="card"><div class="btn-row">'
        + '  <button type="button" class="btn btn--primary" data-act="voice:restart">Пройти заново</button>'
        + '  <button type="button" class="btn" data-act="prep:open" data-id="' + esc(prep.id) + '">Вернуться в подготовку</button>'
        + '</div></div>';
    }

    var status = VOICE_STATUS[v.status];
    var lines = DEMO_DATA.voiceScript.slice(0, v.line).map(function (l) {
      return '<div class="transcript__line"><b>' + esc(l.who) + '</b>' + esc(l.text) + '</div>';
    }).join('');

    var orbCls = 'voice-orb'
      + (v.status === 'listening' || v.status === 'speaking' ? ' voice-orb--live' : '')
      + (v.status === 'lost' ? ' voice-orb--err' : '');

    return ''
      + pageHead('Голосовое пробное интервью', 'Симуляция разговора без обращения к микрофону.')
      + sourcesBar(prep)
      + note('alert', '<div><strong>Только симуляция.</strong> Разрешение на микрофон не запрашивается, звук не '
        + 'записывается, синтез речи не используется. Индикаторы и расшифровка — из фиксированного сценария.</div>')
      + '<div class="card stack">'
      + '  <div class="voice-stage">'
      + '    <div class="' + orbCls + '">' + esc(status.label) + '</div>'
      + '    <p class="muted" role="status" aria-live="polite">' + esc(status.hint) + '</p>'
      + '  </div>'
      + '  <div class="btn-row">'
      + (v.status === 'idle'
          ? '<button type="button" class="btn btn--primary" data-act="voice:start">Начать разговор</button>'
          : '<button type="button" class="btn btn--primary" data-act="voice:next">Следующая реплика</button>')
      + '    <button type="button" class="btn" data-act="voice:pause"' + (v.status === 'idle' ? ' disabled' : '') + '>'
      + (v.status === 'paused' ? 'Продолжить' : 'Пауза') + '</button>'
      + '    <button type="button" class="btn" data-act="voice:mic">Микрофон (заглушка)</button>'
      + '    <button type="button" class="btn btn--danger" data-act="voice:finish"' + (v.status === 'idle' ? ' disabled' : '') + '>'
      + '      Завершить</button>'
      + '  </div>'
      + '  <div class="toolbar">'
      + '    <label for="voice-scenario">Демо-сценарий состояния</label>'
      + '    <select id="voice-scenario" data-change-act="voice:set-status">'
      + Object.keys(VOICE_STATUS).map(function (key) {
          return '<option value="' + key + '"' + (key === v.status ? ' selected' : '') + '>'
            + esc(VOICE_STATUS[key].label) + '</option>';
        }).join('')
      + '    </select>'
      + '  </div>'
      + '  <h2>Расшифровка</h2>'
      + '  <div class="transcript">' + (lines || '<p class="muted">Расшифровка появится после начала разговора.</p>') + '</div>'
      + '</div>';
  }

  /* ---------------- Помощник на собеседовании ---------------- */

  function assistant() {
    var state = Store.get();
    if (!Store.sectionAllowed('assistant')) return locked('Помощник на собеседовании', 'assistant');

    var a = state.assistant;
    var prepOptions = state.preps.length
      ? state.preps.map(function (p) { return { value: p.id, label: ScreensCore.prepTitle(p) }; })
      : [{ value: '', label: 'Подготовок пока нет' }];

    var statusText = {
      disconnected: 'Не подключён',
      connecting: 'Подключение',
      connected: 'Подключён',
      failed: 'Ошибка подключения',
      ended: 'Сессия завершена'
    }[a.status];

    var statusTag = {
      disconnected: 'tag',
      connecting: 'tag tag--info',
      connected: 'tag tag--ok',
      failed: 'tag tag--alert',
      ended: 'tag'
    }[a.status];

    var hint = DEMO_DATA.assistantHints[a.hintIndex];

    return ''
      + pageHead('Помощник на собеседовании',
          'Отдельный компонент, который по замыслу работает во время реального интервью.')
      + note('alert', '<div><strong>Функции пока нет.</strong> Формат файла, операционные системы, способ установки и '
        + 'протокол соединения не определены. В макете показан только предполагаемый порядок работы: '
        + 'ничего не скачивается, звук и экран не захватываются, подсказки не генерируются.</div>')
      + '<div class="card stack">'
      + '  <h2>Зачем нужен отдельный компонент</h2>'
      + '  <p class="muted">Собеседование обычно идёт в стороннем приложении для видеозвонков. Веб-страница не имеет '
      + '  доступа к чужому окну, поэтому по замыслу владельца потребуется отдельный компонент на компьютере '
      + '  пользователя. Как именно он будет устроен — открытый вопрос.</p>'
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Подготовка для сессии</h2>'
      + UI.select({ id: 'assistant-prep', label: 'Резюме и вакансия', value: a.prepId || '',
          options: prepOptions, act: 'assistant:prep' })
      + (state.preps.length ? '' : note('info', '<div>Сначала добавьте вакансию и резюме в разделе «Вакансии и подготовка».</div>'))
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Порядок работы</h2>'
      + '  <ol>'
      + '    <li>Скачать компонент на компьютер.</li>'
      + '    <li>Подключить его к аккаунту.</li>'
      + '    <li>Выбрать подготовку — резюме и вакансию.</li>'
      + '    <li>Начать сессию, согласованную со всеми участниками разговора.</li>'
      + '  </ol>'
      + '  <p class="faint" style="font-size:13px">Это схема будущего опыта, а не инструкция по установке.</p>'
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn btn--primary" data-act="assistant:download">Скачать помощник</button>'
      + '    <button type="button" class="btn" data-act="assistant:connect">Подключить (демо-статусы)</button>'
      + '    <button type="button" class="btn" data-act="assistant:hints">Посмотреть пример подсказок</button>'
      + '  </div>'
      + '</div>'
      + '<div class="card stack">'
      + '  <div class="card__head" style="margin-bottom:0"><div class="card__title"><h2>Состояние подключения</h2>'
      + '  <small>Демонстрационные статусы, реального соединения нет</small></div>'
      + '  <span class="' + statusTag + '">' + esc(statusText) + '</span></div>'
      + '  <div class="btn-row">'
      + ['disconnected', 'connecting', 'connected', 'failed', 'ended'].map(function (key) {
          return '<button type="button" class="btn btn--sm" data-act="assistant:status" data-status="' + key + '">'
            + esc({ disconnected: 'Не подключён', connecting: 'Подключение', connected: 'Подключён',
                    failed: 'Ошибка подключения', ended: 'Сессия завершена' }[key]) + '</button>';
        }).join('')
      + '  </div>'
      + '</div>'
      + (a.hintsOpen
          ? '<div class="card stack">'
            + '  <div class="card__head" style="margin-bottom:0"><div class="card__title">'
            + '    <h2>Пример подсказок</h2><small>Заранее подготовленные реплики, не результат распознавания</small></div>'
            + '    <div class="btn-row">'
            + '      <button type="button" class="btn btn--sm" data-act="assistant:hints-toggle">Свернуть</button>'
            + '      <button type="button" class="btn btn--sm" data-act="assistant:hints-close" aria-label="Закрыть панель подсказок">Закрыть</button>'
            + '    </div>'
            + '  </div>'
            + note('demo', '<div>Ни звук, ни экран не считываются. Ниже — фиксированный пример того, как могла бы '
              + 'выглядеть подсказка.</div>')
            + '  <div class="msg msg--sys" style="max-width:100%"><div class="msg__body">' + esc(hint.heard) + '</div></div>'
            + '  <div class="card" style="background:var(--surface-2)">'
            + '    <p><b>Направление ответа:</b> ' + esc(hint.hint) + '</p>'
            + '    <p class="muted" style="font-size:13.5px"><b>Напоминание:</b> ' + esc(hint.remind) + '</p>'
            + '  </div>'
            + '  <div class="btn-row">'
            + '    <button type="button" class="btn btn--sm" data-act="assistant:hint-prev">Предыдущий пример</button>'
            + '    <button type="button" class="btn btn--sm" data-act="assistant:hint-next">Следующий пример</button>'
            + '    <span class="muted" style="align-self:center">Пример ' + (a.hintIndex + 1) + ' из '
            + DEMO_DATA.assistantHints.length + '</span>'
            + '  </div>'
            + '</div>'
          : '')
      + '<div class="card stack">'
      + '  <h2>Правила и согласие участников</h2>'
      + note('alert', '<div>Многие работодатели запрещают посторонние подсказки на собеседовании, а запись разговора '
        + 'без согласия участников может нарушать закон и правила площадки. Использование такого помощника — '
        + 'ответственность пользователя. Макет не обещает, что окно помощника невидимо при демонстрации экрана '
        + 'или незаметно для собеседника: это нерешённый технический и правовой вопрос.</div>')
      + '</div>';
  }

  /* ---------------- Тарифы ---------------- */

  function locked(title, requiredPlan) {
    var plan = Store.planById(requiredPlan);
    return ''
      + pageHead(title)
      + '<div class="card stack">'
      + note('demo', '<div><strong>Раздел недоступен на текущем демо-уровне.</strong> По задумке он входит в уровень '
        + '«' + esc(plan.name) + '». Здесь показано, как выглядит объяснение заблокированного действия.</div>')
      + '  <p class="muted">Функцию можно изучить в макете, переключив демо-уровень. Покупка недоступна: '
      + '  тарифы, цены и лимиты ещё не утверждены, а платежи не подключены.</p>'
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn btn--primary" data-act="plan:set" data-plan="' + esc(requiredPlan) + '">'
      + '      Переключить демо-уровень на «' + esc(plan.name) + '»</button>'
      + '    <a class="btn" href="#/plans">Открыть тарифы</a>'
      + '  </div>'
      + '</div>';
  }

  function plans() {
    var state = Store.get();
    var cards = DEMO_DATA.plans.map(function (p) {
      var active = state.plan === p.id;
      return ''
        + '<div class="plan' + (active ? ' plan--active' : '') + '">'
        + '  <h3>' + esc(p.name) + '</h3>'
        + '  <div class="plan__price">' + esc(p.price) + '</div>'
        + '  <p class="muted" style="font-size:13px">' + esc(p.limits) + '</p>'
        + '  <ul>' + p.features.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>'
        + '  <div class="btn-row" style="margin-top:16px">'
        + (active
            ? '<span class="tag tag--ok">Текущий демо-уровень</span>'
            : '<button type="button" class="btn" data-act="plan:set" data-plan="' + esc(p.id) + '">Выбрать в демо</button>')
        + '    <button type="button" class="btn btn--sm" data-act="stub:pay">Оплатить</button>'
        + '  </div>'
        + '</div>';
    }).join('');

    var current = Store.planById(state.plan);

    return ''
      + pageHead('Тарифы и лимиты', 'Временные названия и группировка. Тарифная сетка не утверждена.')
      + note('demo', '<div><strong>Цены и лимиты не определены.</strong> Названия уровней рабочие. Оплата — заглушка: '
        + 'банковских полей и платёжных сервисов в макете нет.</div>')
      + '<div class="plans">' + cards + '</div>'
      + '<div class="card stack">'
      + '  <h2>Что доступно на уровне «' + esc(current.name) + '»</h2>'
      + '  <ul>'
      + '    <li>Мои резюме — доступно</li>'
      + '    <li>Вакансии и подготовка — доступно</li>'
      + '    <li>Тренировочные интервью — ' + (Store.sectionAllowed('interviews') ? 'доступно' : 'недоступно на этом уровне') + '</li>'
      + '    <li>Помощник на собеседовании — ' + (Store.sectionAllowed('assistant') ? 'доступно' : 'недоступно на этом уровне') + '</li>'
      + '  </ul>'
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn" data-act="demo:scenario-limit">Показать состояние «лимит исчерпан»</button>'
      + '  </div>'
      + '</div>';
  }

  /* ---------------- История ---------------- */

  function history() {
    var state = Store.get();
    if (!state.history.length) {
      return pageHead('История')
        + UI.emptyState('История пуста', 'Здесь появятся подготовки и тренировки этого сеанса макета.',
            'К обзору', 'go:#/overview');
    }
    var rows = state.history.map(function (h) {
      return ''
        + '<li><div class="row-item">'
        + '  <div class="row-item__main">'
        + '    <div class="row-item__title">' + esc(h.what) + '</div>'
        + '    <div class="row-item__meta">' + esc(h.when) + '</div>'
        + '  </div>'
        + '  <button type="button" class="btn btn--sm" data-act="go:' + esc(h.route) + '">Открыть результат</button>'
        + '</div></li>';
    }).join('');
    return ''
      + pageHead('История', 'Подготовки и тренировки этого сеанса.')
      + note('info', '<div>История хранится в памяти страницы и очищается после перезагрузки.</div>')
      + '<ul class="list">' + rows + '</ul>';
  }

  /* ---------------- Настройки и данные ---------------- */

  function settings() {
    var state = Store.get();
    var s = state.settings;
    function toggle(key, title, text) {
      return ''
        + '<label class="switch">'
        + '  <input type="checkbox" data-toggle="' + key + '"' + (s[key] ? ' checked' : '') + '>'
        + '  <span class="switch__text">' + esc(title) + '<small>' + esc(text) + '</small></span>'
        + '</label>';
    }
    return ''
      + pageHead('Настройки и данные', 'Переключатели работают локально: настоящих уведомлений макет не отправляет.')
      + '<div class="card stack">'
      + '  <h2>Профиль</h2>'
      + UI.field({ id: 'set-name', label: 'Имя', model: '', value: DEMO_DATA.candidate.name,
          hint: 'Демонстрационное значение. Вымышленный профиль из комплекта макета.' })
      + UI.field({ id: 'set-city', label: 'Город', model: '', value: DEMO_DATA.candidate.city })
      + '  <div class="btn-row"><button type="button" class="btn" data-act="stub:profile-save">Сохранить профиль</button></div>'
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Уведомления</h2>'
      + note('info', '<div>Ни письма, ни push-уведомления не отправляются: почтовый сервис не подключён.</div>')
      + toggle('emailUpdates', 'Письма о новых возможностях', 'Заглушка переключателя')
      + toggle('weeklyDigest', 'Еженедельная сводка по подготовке', 'Заглушка переключателя')
      + toggle('practiceReminders', 'Напоминания о тренировках', 'Заглушка переключателя')
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Оформление</h2>'
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn" data-act="theme:toggle">'
      + (state.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема') + '</button>'
      + '  </div>'
      + '  <p class="faint" style="font-size:13px">Тема и выбранный демо-сценарий — единственное, что макет '
      + '  сохраняет в localStorage.</p>'
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Мои данные</h2>'
      + '  <p class="muted">Что предполагалось бы хранить в готовом продукте:</p>'
      + '  <ul>'
      + '    <li>Версии резюме и их содержимое.</li>'
      + '    <li>Добавленные вакансии и связанные подготовки.</li>'
      + '    <li>Ответы на вопросы и переписку тренировочных интервью.</li>'
      + '    <li>Настройки аккаунта и историю действий.</li>'
      + '  </ul>'
      + note('alert', '<div>Сейчас ничего из этого не хранится: данные живут в памяти вкладки и исчезают '
        + 'после перезагрузки. Текст ниже — черновик формулировок, а не готовая политика конфиденциальности.</div>')
      + '  <div class="btn-row">'
      + '    <button type="button" class="btn" data-act="data:clear-answers">Удалить ответы на вопросы</button>'
      + '    <button type="button" class="btn" data-act="data:clear-history">Очистить историю</button>'
      + (Api.live.enabled
          ? '<button type="button" class="btn btn--danger" data-act="data:delete-server">Удалить все мои данные с сервера</button>'
          : '<button type="button" class="btn btn--danger" data-act="data:reset">Сбросить демо полностью</button>')
      + '  </div>'
      + '</div>'
      + '<div class="card stack">'
      + '  <h2>Черновик о приватности</h2>'
      + '  <p class="muted">Что сервис получает, куда отправляет и сколько хранит — на отдельной странице. '
      + '  Формулировки будут переписаны юристом до запуска: это рабочий черновик.</p>'
      + '  <div class="btn-row"><a class="btn" href="#/privacy">Открыть черновик политики</a></div>'
      + '</div>';
  }

  /* ---------------- Карточка подготовки ---------------- */

  /* Шпаргалка перед разговором. Собирается из того, что пользователь
     написал сам: его ответов на вопросы и слабых мест сопоставления.
     Ничего не читает и ничего не записывает — открывается на телефоне
     или на втором экране и печатается. */
  function card(prepId) {
    var state = Store.get();
    var prep = Store.prepById(prepId) || Store.activePrep();
    if (!prep) return needPrep(prep, 'Карточка подготовки');

    var vacancy = Store.vacancyById(prep.vacancyId);
    var resume = Store.resumeById(prep.resumeId);
    var requirements = (prep.match && prep.match.length) ? prep.match : ((vacancy && vacancy.requirements) || []);

    var cardQuestions = questionsFor(prep);
    var answered = cardQuestions.filter(function (q) {
      return String(prep.answers[q.id] || '').trim().length > 0;
    });
    var ready = cardQuestions.filter(function (q) { return prep.ready[q.id]; });
    var gaps = cardQuestions.filter(function (q) {
      return !String(prep.answers[q.id] || '').trim() && !prep.ready[q.id];
    });
    var risky = requirements.filter(function (r) { return r.status !== 'confirmed'; });

    var body = ''
      + '<div class="card card--print">'
      + '  <div class="card__head">'
      + '    <div class="card__title"><h2>' + esc(vacancy ? vacancy.title : 'Вакансия') + '</h2>'
      + '    <small>' + esc(vacancy ? vacancy.company : '') + ' · резюме: '
      + esc(resume ? resume.title : 'не выбрано') + '</small></div>'
      + '  </div>'

      + '  <h3>Что сказать о себе в начале</h3>'
      + (resume && resume.summary
          ? '<p>' + escLines(resume.summary) + '</p>'
          : '<p class="faint">В резюме не заполнен раздел «О себе». Впишите две-три строки — '
            + 'с них начинается почти каждое собеседование.</p>')

      + '  <h3>Мои ответы, которые стоит вспомнить</h3>'
      + (answered.length
          ? '<ul class="list">' + answered.map(function (q) {
              return '<li><b>' + esc(q.text) + '</b><div>' + escLines(prep.answers[q.id]) + '</div></li>';
            }).join('') + '</ul>'
          : '<p class="faint">Вы пока не записали ни одного ответа. Откройте раздел вопросов '
            + 'и напишите ответы своими словами — карточка соберётся из них.</p>')

      + '  <h3>Слабые места: к чему готовиться</h3>'
      + (risky.length
          ? '<ul class="list">' + risky.map(function (r) {
              return '<li><b>' + esc(r.text) + '</b> <span class="tag '
                + (r.status === 'missing' ? 'tag--alert' : 'tag--info') + '">'
                + esc(STATUS_LABEL[r.status].text) + '</span>'
                + '<div>' + esc(r.advice) + '</div></li>';
            }).join('') + '</ul>'
          : '<p class="faint">Все требования подтверждены резюме.</p>')

      + '  <h3>Вопросы, которые задать работодателю</h3>'
      + '  <ul>'
      + '    <li>Какие задачи стоят перед этой ролью в первые три месяца?</li>'
      + '    <li>Кто принимает решения по спорным вопросам и как это устроено?</li>'
      + '    <li>По каким признакам вы поймёте через полгода, что человек справился?</li>'
      + '  </ul>'

      + (gaps.length
          ? '<h3>Ещё не разобрано</h3><ul>' + gaps.slice(0, 5).map(function (q) {
              return '<li>' + esc(q.text) + '</li>';
            }).join('') + '</ul>'
          : '')

      + '  <h3>Напоминания</h3>'
      + '  <ul>'
      + '    <li>Ответ — до двух минут, заканчивать результатом.</li>'
      + '    <li>Не хватает данных — сказать об этом и назвать допущение.</li>'
      + '    <li>Не приписывать себе опыт, которого нет: это проверяется следующим вопросом.</li>'
      + '  </ul>'
      + '</div>';

    return ''
      + pageHead('Карточка подготовки',
          'Шпаргалка на время разговора: откройте её на телефоне или втором экране.')
      + sourcesBar(prep, 'card')
      + staleBanner(prep)
      + note('info', '<div>Карточка собрана из ваших собственных ответов и результата '
        + 'сопоставления. Она ничего не читает с экрана, не слушает звук и не требует '
        + 'установки программ. Подготовлено ответов: ' + answered.length + ' из '
        + cardQuestions.length + ', отмечено готовыми: ' + ready.length + '.</div>')
      + body
      + '<div class="card no-print"><div class="btn-row">'
      + '  <button type="button" class="btn btn--primary" data-act="card:print">Распечатать или сохранить в PDF</button>'
      + '  <button type="button" class="btn" data-act="go:#/prep/' + esc(prep.id) + '/questions">Дописать ответы</button>'
      + '</div>'
      + '<p class="faint" style="font-size:13px;margin-top:12px">Печать выполняется браузером — '
      + 'это настоящая функция, а не заглушка. В диалоге печати можно выбрать «Сохранить как PDF».</p>'
      + '</div>';
  }

  return {
    match: match,
    card: card,
    questions: questions,
    interviews: interviews,
    interview: interview,
    voice: voice,
    assistant: assistant,
    plans: plans,
    history: history,
    settings: settings,
    locked: locked,
    ensureChat: ensureChat,
    ensureVoice: ensureVoice
  };
})();
