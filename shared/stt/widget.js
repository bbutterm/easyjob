/* Shared visible, opt-in microphone UI. Transcript is never placed in browser storage. */
(function (root) {
  'use strict';
  root.SttWidget = function (options) {
    const host = document.createElement('section'); host.className = 'card stack stt-widget';
    host.innerHTML = '<h2>Голос → текст</h2>'
      + '<p>Только микрофон, до 30 секунд. Системный звук не поддерживается. Для записи чужой речи нужно согласие участников.</p>'
      + '<label>STT-провайдер <select data-stt="provider"><option value="mock">Заглушка — НЕ распознаёт речь</option><option value="whisper_cpp">Локальный whisper.cpp</option></select></label>'
      + '<label>Адрес локального STT <input data-stt="endpoint" value="http://127.0.0.1:8080/inference" spellcheck="false"></label>'
      + '<label><input type="checkbox" data-stt="consent"> Разрешаю запись микрофона и локальную транскрипцию; после проверки отправлю текст выбранной AI-модели. Согласие участников получено.</label>'
      + '<p data-stt="capability"></p><p role="status" aria-live="polite" data-stt="state">idle — Микрофон выключен</p>'
      + '<div class="btn-row"><button type="button" class="btn" data-stt="start">Записать / повторить</button>'
      + '<button type="button" class="btn" data-stt="stop" disabled>Стоп → распознать</button>'
      + '<button type="button" class="btn" data-stt="cancel">Отменить / очистить</button></div>'
      + '<label>Транскрипт — проверьте и удалите личные данные<textarea data-stt="text" maxlength="32000" rows="4" spellcheck="false"></textarea></label>'
      + '<p data-stt="queue"></p><button type="button" class="btn" data-stt="send" disabled>Отправить фрагмент в AI</button>'
      + '<p data-stt="feedback" role="status"></p>'
      + '<p>Аудио не сохраняется. Отправленный текст в веб-интервью хранится как обычная реплика. Заглушка имитирует текст без доступа к микрофону.</p>';
    const el = name => host.querySelector('[data-stt="' + name + '"]');
    const labels = { idle: 'Микрофон выключен', requesting: 'Запрашиваю разрешение', recording: 'Запись микрофона', transcribing: 'Микрофон выключен, распознаю', ready: 'Текст готов к проверке', error: 'Ошибка' };
    let controller, sending = false, disposed = false, state = 'idle', version = 0;
    const config = options.config || {};
    el('provider').value = config.provider || 'mock'; el('endpoint').value = config.endpoint || el('endpoint').value;
    el('capability').textContent = SpeechToText.capabilities().microphone ? 'API микрофона доступен; разрешение ещё не запрошено.' : 'API микрофона недоступен. Доступна заглушка; используйте совместимый браузер или Electron.';
    function refresh() {
      const active = ['requesting', 'recording', 'transcribing'].includes(state);
      el('start').disabled = active || sending || !el('consent').checked;
      el('stop').disabled = !['requesting', 'recording'].includes(state);
      ['provider', 'endpoint', 'consent'].forEach(name => { el(name).disabled = active || sending; });
      el('text').disabled = active || sending;
      const pieces = SpeechToText.chunks(el('text').value);
      el('queue').textContent = pieces.length ? 'Фрагментов до 4000 символов: ' + pieces.length + '. Отправляется только первый, по нажатию.' : '';
      el('send').disabled = state !== 'ready' || !pieces.length || sending || !el('consent').checked;
    }
    function update(snapshot) {
      state = snapshot.state;
      el('state').textContent = state + ' — ' + (snapshot.mock && state === 'recording' ? 'Демо: микрофон выключен' : labels[state]) + (snapshot.mock ? ' (заглушка)' : '') + (snapshot.error ? '. ' + snapshot.error : '');
      el('text').value = snapshot.chunks.join('\n'); refresh();
    }
    el('start').onclick = async () => {
      if (controller) controller.cancel();
      try {
        controller = SpeechToText.create({ config: { provider: el('provider').value, endpoint: el('endpoint').value }, onState: update, capture: async function () { if (options.beforeCapture) await options.beforeCapture(); return SpeechToText.capture(); } });
        await controller.start(el('consent').checked);
      } catch (_) { update({ state: 'error', chunks: [], error: 'Проверьте STT-провайдер и локальный адрес /inference.' }); }
    };
    el('stop').onclick = () => controller && controller.stop();
    el('cancel').onclick = () => {
      version++; if (controller) controller.cancel();
      if (options.onCancel) options.onCancel(); el('feedback').textContent = ''; el('consent').checked = false; refresh();
    };
    el('consent').onchange = refresh; el('text').oninput = refresh;
    el('send').onclick = async () => {
      if (el('send').disabled) return;
      const pieces = SpeechToText.chunks(el('text').value), token = version;
      sending = true; refresh(); el('feedback').textContent = 'Отправляю текст в AI…';
      try {
        await options.onSend(pieces[0]);
        if (disposed || token !== version) return;
        el('text').value = pieces.slice(1).join('\n'); el('feedback').textContent = 'Фрагмент передан в AI.';
      } catch (_) { if (!disposed && token === version) el('feedback').textContent = 'Не удалось передать текст. Проверьте состояние интервью и повторите.'; }
      finally { sending = false; if (!disposed) refresh(); }
    };
    const hidden = () => { if (document.hidden) el('cancel').onclick(); };
    document.addEventListener('visibilitychange', hidden);
    refresh();
    return { element: host, dispose() { document.removeEventListener('visibilitychange', hidden); disposed = true; version++; if (controller) controller.cancel(); if (options.onCancel) options.onCancel(); host.remove(); } };
  };
})(globalThis);
