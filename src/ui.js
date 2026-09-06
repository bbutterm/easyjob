/* ============================================================
   Мелкие помощники интерфейса: экранирование, диалоги,
   уведомления, управление фокусом.
   ============================================================ */

var UI = (function () {
  'use strict';

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Многострочный пользовательский текст: экранируем и сохраняем переносы. */
  function escLines(value) {
    return esc(value).replace(/\n/g, '<br>');
  }

  function demoBadge(text) {
    return '<span class="tag tag--demo">' + esc(text || 'Демо-данные') + '</span>';
  }

  function note(kind, html) {
    return '<div class="note note--' + kind + '"><div>' + html + '</div></div>';
  }

  function toast(message) {
    var state = Store.get();
    var item = { id: Store.uid('t'), message: message };
    state.toasts.push(item);
    /* Не даём уведомлениям накапливаться и перекрывать содержимое. */
    while (state.toasts.length > 3) state.toasts.shift();
    Store.notify();
    window.setTimeout(function () {
      var list = Store.get().toasts;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === item.id) { list.splice(i, 1); break; }
      }
      Store.notify();
    }, 4200);
  }

  /* modal: { title, body, actions: [{label, act, variant, data}], size } */
  function openModal(modal) {
    Store.get().modal = modal;
    Store.notify();
  }

  function closeModal() {
    Store.get().modal = null;
    Store.notify();
  }

  function confirm(options) {
    openModal({
      title: options.title,
      body: options.body,
      confirmAct: options.act,
      confirmData: options.data || {},
      confirmLabel: options.confirmLabel || 'Подтвердить',
      danger: options.danger === true
    });
  }

  function renderModal(modal) {
    if (!modal) return '';
    var buttons = '';
    if (modal.confirmAct) {
      buttons =
        '<button type="button" class="btn" data-act="modal:close">Отмена</button>'
        + '<button type="button" class="btn ' + (modal.danger ? 'btn--danger' : 'btn--primary')
        + '" data-act="modal:confirm">' + esc(modal.confirmLabel) + '</button>';
    } else {
      buttons = '<button type="button" class="btn btn--primary" data-act="modal:close">'
        + esc(modal.closeLabel || 'Понятно') + '</button>';
    }
    return ''
      + '<div class="modal-backdrop" data-act="modal:backdrop">'
      + '  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">'
      + '    <div class="modal__head">'
      + '      <h2 id="modal-title">' + esc(modal.title) + '</h2>'
      + '      <button type="button" class="btn btn--sm btn--quiet" data-act="modal:close" aria-label="Закрыть диалог">✕</button>'
      + '    </div>'
      + '    <div class="stack-sm">' + modal.body + '</div>'
      + '    <div class="modal__foot">' + buttons + '</div>'
      + '  </div>'
      + '</div>';
  }

  function renderToasts(toasts) {
    if (!toasts.length) return '<div class="toasts" role="status" aria-live="polite"></div>';
    return '<div class="toasts" role="status" aria-live="polite">'
      + toasts.map(function (t) { return '<div class="toast">' + esc(t.message) + '</div>'; }).join('')
      + '</div>';
  }

  /* Ловушка фокуса для открытого диалога. */
  function trapFocus(root) {
    var dialog = root.querySelector('.modal');
    if (!dialog) return;
    var selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    var nodes = Array.prototype.slice.call(dialog.querySelectorAll(selector));
    if (!nodes.length) return;
    if (!dialog.contains(document.activeElement)) nodes[0].focus();
    dialog.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab') return;
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function field(options) {
    var id = options.id;
    var type = options.type || 'text';
    var error = options.error
      ? '<span class="field__error" id="' + id + '-err">' + esc(options.error) + '</span>' : '';
    var hint = options.hint
      ? '<span class="field__hint" id="' + id + '-hint">' + esc(options.hint) + '</span>' : '';
    var describedBy = [];
    if (options.hint) describedBy.push(id + '-hint');
    if (options.error) describedBy.push(id + '-err');
    var attrs = ''
      + ' id="' + id + '"'
      + ' name="' + id + '"'
      + ' data-model="' + esc(options.model) + '"'
      + (options.required ? ' required' : '')
      + (options.error ? ' aria-invalid="true"' : '')
      + (describedBy.length ? ' aria-describedby="' + describedBy.join(' ') + '"' : '')
      + (options.placeholder ? ' placeholder="' + esc(options.placeholder) + '"' : '');
    var control;
    if (type === 'textarea') {
      control = '<textarea' + attrs + (options.rows ? ' rows="' + options.rows + '"' : '') + '>'
        + esc(options.value) + '</textarea>';
    } else {
      control = '<input type="' + type + '"' + attrs + ' value="' + esc(options.value) + '">';
    }
    return ''
      + '<label class="field" for="' + id + '">'
      + '  <span class="field__label">' + esc(options.label)
      + (options.required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</span>'
      + control + hint + error
      + '</label>';
  }

  function select(options) {
    var id = options.id;
    var opts = options.options.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (o.value === options.value ? ' selected' : '') + '>'
        + esc(o.label) + '</option>';
    }).join('');
    return ''
      + '<label class="field" for="' + id + '">'
      + '  <span class="field__label">' + esc(options.label) + '</span>'
      + '  <select id="' + id + '" data-model="' + esc(options.model || '') + '"'
      + (options.act ? ' data-change-act="' + esc(options.act) + '"' : '') + '>' + opts + '</select>'
      + (options.hint ? '<span class="field__hint">' + esc(options.hint) + '</span>' : '')
      + '</label>';
  }

  function emptyState(title, text, buttonLabel, act) {
    return ''
      + '<div class="empty">'
      + '  <h3>' + esc(title) + '</h3>'
      + '  <p>' + esc(text) + '</p>'
      + (buttonLabel
        ? '<p style="margin-top:16px"><button type="button" class="btn btn--primary" data-act="' + esc(act) + '">'
          + esc(buttonLabel) + '</button></p>'
        : '')
      + '</div>';
  }

  function skeletonBlock() {
    return ''
      + '<div class="card" aria-busy="true">'
      + '  <div class="skeleton" style="height:18px;width:45%"></div>'
      + '  <div class="skeleton" style="height:12px;width:90%;margin-top:16px"></div>'
      + '  <div class="skeleton" style="height:12px;width:80%"></div>'
      + '  <div class="skeleton" style="height:12px;width:60%"></div>'
      + '  <p class="muted" style="margin-top:16px;font-size:13px">Демонстрационная загрузка: ничего не отправляется по сети.</p>'
      + '</div>';
  }

  function errorBlock(act) {
    return ''
      + '<div class="card">'
      + note('alert', '<div><strong>Демонстрационная ошибка.</strong> Так выглядит экран, когда действие не удалось. '
        + 'Это сценарий из панели «Состояния демо», а не настоящий сбой.</div>')
      + '  <div class="btn-row" style="margin-top:16px">'
      + '    <button type="button" class="btn btn--primary" data-act="' + esc(act || 'demo:scenario-filled') + '">Повторить</button>'
      + '  </div>'
      + '</div>';
  }

  function limitBlock() {
    return ''
      + '<div class="card">'
      + note('demo', '<div><strong>Достигнут демонстрационный лимит.</strong> В готовом продукте здесь было бы '
        + 'сообщение об исчерпанном объёме тарифа. Точные лимиты ещё не определены.</div>')
      + '  <div class="btn-row" style="margin-top:16px">'
      + '    <a class="btn" href="#/plans">Открыть тарифы</a>'
      + '    <button type="button" class="btn btn--primary" data-act="demo:scenario-filled">Вернуться к заполненному демо</button>'
      + '  </div>'
      + '</div>';
  }

  return {
    esc: esc,
    escLines: escLines,
    demoBadge: demoBadge,
    note: note,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    confirm: confirm,
    renderModal: renderModal,
    renderToasts: renderToasts,
    trapFocus: trapFocus,
    field: field,
    select: select,
    emptyState: emptyState,
    skeletonBlock: skeletonBlock,
    errorBlock: errorBlock,
    limitBlock: limitBlock
  };
})();
