/* ============================================================
   Клиент API и режим сервера.

   Макет умеет работать двумя способами:
     — демо: файл открыт напрямую, данные в памяти, ответы модели
       имитируются (как было);
     — сервер: страница отдана сервером, кнопки ходят в /api/*,
       данные хранятся в базе, ответы приходят от настоящего провайдера
       или от серверной заглушки.

   Режим определяется один раз при загрузке по ответу /api/health.
   ============================================================ */

var Api = (function () {
  'use strict';

  var live = { enabled: false, ai: null, limits: null, professions: null, user: null, auth: null };

  function isHttp() {
    return /^https?:$/.test(window.location.protocol);
  }

  function ApiError(status, message, extra) {
    this.status = status;
    this.message = message;
    this.extra = extra || null;
  }

  async function request(method, path, body, runtime) {
    var rt = runtime || {};
    var controller = new AbortController();
    var timedOut = false;
    var cancel = function () { controller.abort(); };
    if (rt.signal) { rt.signal.addEventListener('abort', cancel, { once: true }); if (rt.signal.aborted) cancel(); }
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, rt.timeoutMs || 100000);
    var options = {
      method: method, signal: controller.signal,
      credentials: 'same-origin',
      headers: { accept: 'application/json' }
    };
    if (body !== undefined || method === 'POST' || method === 'PUT') {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(body === undefined ? {} : body);
    }
    try {
      var res = await fetch(path, options);
      var data = await res.json();
      if (!res.ok) throw new ApiError(res.status, (data && data.error) || ('Ошибка сервера, код ' + res.status), data);
      return data;
    } catch (e) {
      if (controller.signal.aborted) throw new ApiError(timedOut ? 504 : 499,
        timedOut ? 'Превышено время ожидания сервера. Повторите запрос.' : 'Запрос отменён.', { code: timedOut ? 'timeout' : 'cancelled' });
      if (e instanceof ApiError) throw e;
      throw new ApiError(0, 'Сервер недоступен. Проверьте соединение и повторите запрос.', { code: 'network' });
    } finally {
      clearTimeout(timer);
      if (rt.signal) rt.signal.removeEventListener('abort', cancel);
    }
  }

  /* Потоковый ответ (Server-Sent Events) через fetch. */
  async function stream(path, body, onDelta, onStatus, signal) {
    var res;
    try {
      res = await fetch(path, {
        method: 'POST', credentials: 'same-origin', signal: signal,
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new ApiError(0, 'Сервер недоступен: ' + e.message);
    }
    if (!res.ok) {
      var err = null;
      try { err = await res.json(); } catch (e) { err = null; }
      throw new ApiError(res.status, (err && err.error) || ('Ошибка сервера, код ' + res.status), err);
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var done = null;
    var eventName = '';
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf('event:') === 0) { eventName = line.slice(6).trim(); continue; }
        if (line.indexOf('data:') !== 0) continue;
        var payload;
        try { payload = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        if (eventName === 'delta' && onDelta) onDelta(payload.text || '');
        if (eventName === 'status' && onStatus) onStatus(payload.text || '');
        if (eventName === 'done') done = payload;
        if (eventName === 'error') throw new ApiError(502, payload.error || 'Ошибка в потоке ответа');
      }
    }
    if (!done) throw new ApiError(502, 'Поток ответа оборвался');
    return done;
  }

  async function detect() {
    if (!isHttp()) return false;
    try {
      var health = await request('GET', '/api/health');
      live.enabled = true;
      live.ai = health.ai;
      return true;
    } catch (e) {
      live.enabled = false;
      return false;
    }
  }

  /* ---- Преобразование форматов сервера в формат экранов ---- */

  function label(ts) {
    var d = new Date(ts || Date.now());
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function resumeFromServer(r) {
    var data = r.data || {};
    return {
      id: r.id, serverId: r.id, title: r.title, rev: r.rev, updatedAt: label(r.updatedAt),
      source: data.rawText ? 'uploaded' : 'created', demo: false,
      profession: data.profession || '', wishes: data.wishes || '', summary: data.summary || '',
      experience: data.experience || [], skills: data.skills || [],
      achievements: data.achievements || [], education: data.education || [],
      rawText: data.rawText || '', review: r.review || null
    };
  }

  function resumeToServer(resume) {
    return {
      title: resume.title,
      data: {
        profession: resume.profession || '', wishes: resume.wishes || '', summary: resume.summary || '',
        experience: resume.experience || [], skills: resume.skills || [],
        achievements: resume.achievements || [], education: resume.education || [],
        rawText: resume.rawText || undefined
      }
    };
  }

  function vacancyFromServer(v) {
    return {
      id: v.id, serverId: v.id, demo: false, rev: v.rev, title: v.title, company: v.company || '',
      location: '', text: v.rawText || '', requirements: v.requirements || [],
      sourceUrl: v.sourceUrl || '', source: v.source || 'manual', retrievedAt: v.retrievedAt || null
    };
  }

  /* Подготовка с сервера: сопоставление хранится в prep.match и
     подставляется на место требований вакансии для экрана. */
  function prepFromServer(p) {
    return {
      id: p.id, serverId: p.id, resumeId: p.resumeId, vacancyId: p.vacancyId,
      resumeRev: p.resumeRev, vacancyRev: p.vacancyRev, createdAt: label(p.createdAt),
      stale: !!p.stale, staleReason: p.staleReason || '',
      answers: p.answers || {}, ready: p.ready || {},
      match: p.match || null, questions: p.questions || null, card: p.card || null,
      feedback: p.feedback || {}, state: p.state || '', states: p.states || {},
      feedbackBusy: {}, feedbackError: {},
      interviewId: p.interview ? p.interview.id : null,
      interviewStarted: !!(p.interview && p.interview.turns > 0),
      chat: null, voice: null, live: true
    };
  }

  return {
    live: live,
    isHttp: isHttp,
    detect: detect,
    request: request,
    stream: stream,
    ApiError: ApiError,
    resumeFromServer: resumeFromServer,
    resumeToServer: resumeToServer,
    vacancyFromServer: vacancyFromServer,
    prepFromServer: prepFromServer,
    label: label
  };
})();
