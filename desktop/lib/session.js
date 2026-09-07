/* Сессия помощника.

   Цикл работы:
     кадр экрана → выделение вопроса → подсказка → показ в окне

   Все данные сессии живут в памяти и удаляются при остановке.
   Кадры, распознанный текст и подсказки на диск не пишутся.

   Контекст собирается общим слоем shared/context: стабильные части
   (профессия, резюме, требования) идут в начало запроса, изменчивые
   (реплики, текущий кадр) — в конец. Это и экономит деньги на
   кэшировании префикса, и делает усечение предсказуемым. */

'use strict';

const ContextStore = require('../../shared/context/store.js');
const AiRequest = require('../../shared/ai/request.js');
const Providers = require('../../shared/ai/providers/index.js');
const Routing = require('../../shared/ai/routing.js');
const Ocr = require('./ocr.js');

function create(options) {
  const settings = options.settings;
  const capture = options.capture;
  const onStatus = options.onStatus || function () {};
  const onHint = options.onHint || function () {};

  const cfg = settings.get();
  const store = ContextStore.create({ contextBudget: cfg.contextBudget, windowTurns: 10 });

  let timer = null;
  let running = false;
  let busy = false;
  let lastText = '';
  let lastQuestion = '';
  let startedAt = 0;
  let aborter = null;
  let lastDropped = [];
  let generation = 0;
  let nextTranscriptAt = 0;
  const stats = { frames: 0, requests: 0, hints: 0, errors: 0, retries: 0 };

  /* Подготовка приходит из веб-сервиса: резюме, вакансия, требования,
     слабые места. В прототипе может быть передана вручную. */
  function loadPrep(prep) {
    const p = prep || {};
    store.set('identity', {
      language: cfg.locale,
      profession: p.professionName || 'Профессия не указана',
      professionKnown: p.professionKnown !== false,
      user: p.userSummary || null
    });
    store.set('preparation', {
      experience: p.experience || [],
      skills: p.skills || [],
      achievements: p.achievements || [],
      vacancy: p.vacancy || null,
      requirements: p.requirements || [],
      weakSpots: p.weakSpots || []
    });
  }

  loadPrep(options.prep);

  function status(state, text, extra) {
    const payload = Object.assign({
      state: state,
      text: text,
      sourceName: options.sourceName || '',
      readMode: cfg.readMode,
      provider: cfg.provider,
      elapsedSec: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
      stats: Object.assign({}, stats),
      /* Что не поместилось в бюджет контекста. Пользователь должен это
         видеть: иначе модель молча отвечает по неполным данным. */
      dropped: lastDropped.slice()
    }, extra || {});
    onStatus(payload);
    return payload;
  }

  async function start() {
    if (!options.sourceId && !options.audioOnly) {
      return { ok: false, error: 'Не выбран экран или окно для чтения.' };
    }
    running = true;
    generation++;
    aborter = null;
    startedAt = Date.now();
    if (options.audioOnly) { status('running', 'Готов к отправке проверенного транскрипта. Захват экрана выключен.'); return { ok: true, startedAt }; }
    status('running', 'Сессия запущена. Чтение экрана идёт по вашему запуску и видно в этом окне.');
    timer = setInterval(function () { tick(false); }, Math.max(5, cfg.intervalSec) * 1000);
    /* Первый снимок сразу, чтобы окно не выглядело зависшим. */
    tick(false);
    return { ok: true, startedAt: startedAt };
  }

  function stop() {
    running = false;
    generation++;
    if (timer) { clearInterval(timer); timer = null; }
    /* Незавершённый запрос отменяется: ответ на остановленную сессию
       не нужен, а платить за него не за что. */
    if (aborter) { try { aborter.abort(); } catch (e) { /* уже завершён */ } aborter = null; }
    lastDropped = [];
    store.clearSession();
    store.clearMoment();
    lastText = '';
    lastQuestion = '';
    status('stopped', 'Сессия остановлена. Данные сессии удалены из памяти.');
  }

  /* Один шаг цикла. force=true — по нажатию кнопки «Спросить сейчас». */
  async function tick(force) {
    if (!running && !force) return { ok: false, error: 'Сессия не запущена.' };
    if (busy) return { ok: false, error: 'Предыдущий запрос ещё выполняется.' };
    busy = true;

    try {
      status('capturing', 'Снимаю кадр выбранного источника.');
      const frame = await capture(options.sourceId);
      if (!frame) {
        stats.errors += 1;
        busy = false;
        return status('error', 'Не удалось получить кадр: источник закрыт или недоступен.');
      }
      stats.frames += 1;

      const moment = { captureConsent: true, capturedAt: frame.capturedAt };

      if (cfg.readMode === 'vision') {
        moment.image = {
          data: frame.base64,
          mediaType: frame.mediaType,
          width: frame.width,
          height: frame.height
        };
      } else if (cfg.readMode === 'text') {
        const recognized = await Ocr.recognize(frame);
        if (!recognized.ok) {
          stats.errors += 1;
          busy = false;
          return status('error', recognized.error);
        }
        moment.text = recognized.text;
        moment.textDelta = diff(lastText, recognized.text);
        lastText = recognized.text;
      }

      store.set('moment', moment);

      /* Шаг 1 — выделить вопрос собеседующего. */
      status('thinking', 'Ищу вопрос на экране.');
      const extract = await run('screen.extract');
      if (!extract.ok) {
        stats.errors += 1;
        busy = false;
        return status('error', extract.error);
      }
      const parsedExtract = AiRequest.parseJson(extract.text);
      const question = parsedExtract.ok ? parsedExtract.value.question : null;

      if (!question) {
        busy = false;
        return status('idle', 'Вопрос на экране не найден. Подсказка не запрашивается.');
      }
      if (question === lastQuestion && !force) {
        busy = false;
        return status('idle', 'Вопрос не изменился с прошлого раза.');
      }
      lastQuestion = question;

      /* Шаг 2 — подсказка по найденному вопросу. */
      store.patch('moment', { detectedQuestion: question });
      store.addTurn({ role: 'interviewer', text: question });

      status('thinking', 'Готовлю направление ответа.');
      const hint = await run('assistant.hint');
      if (!hint.ok) {
        stats.errors += 1;
        busy = false;
        return status('error', hint.error);
      }
      const parsedHint = AiRequest.parseJson(hint.text);
      if (!parsedHint.ok) {
        stats.errors += 1;
        busy = false;
        return status('error', 'Ответ модели не удалось разобрать: ' + parsedHint.error);
      }

      stats.hints += 1;
      onHint({
        truncated: lastDropped.length > 0,
        question: question,
        direction: parsedHint.value.direction || '',
        remind: parsedHint.value.remind || '',
        avoid: parsedHint.value.avoid || '',
        at: Date.now(),
        demo: hint.mock === true
      });
      busy = false;
      return status('running', 'Подсказка обновлена.');
    } catch (e) {
      stats.errors += 1;
      busy = false;
      return status('error', 'Сбой шага: ' + e.message);
    }
  }

  // Final, reviewed text only. Reuses context, task routing, provider retries and timeout.
  async function transcript(text, consent) {
    if (consent !== true || !running || !options.audioOnly) return { ok: false, error: 'Нужно согласие и голосовая сессия.' };
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) return { ok: false, error: 'Некорректный транскрипт.' };
    if (busy || Date.now() < nextTranscriptAt) return { ok: false, error: 'Подождите завершения запроса и минимум 5 секунд между отправками.' };
    busy = true; nextTranscriptAt = Date.now() + 5000; const token = generation;
    aborter = new AbortController();
    try {
      store.set('moment', { text: text.trim(), detectedQuestion: text.trim(), captureConsent: true });
      store.addTurn({ role: 'interviewer', text: text.trim() });
      const hint = await run('assistant.hint');
      if (token !== generation || !running) return { ok: false, error: 'Отменено.' };
      if (!hint.ok) return { ok: false, error: 'Не удалось получить подсказку.' };
      const parsed = AiRequest.parseJson(hint.text);
      if (!parsed.ok) return { ok: false, error: 'Некорректный ответ модели.' };
      stats.hints++;
      onHint({ question: text.trim(), direction: parsed.value.direction || '', remind: parsed.value.remind || '',
        avoid: parsed.value.avoid || '', at: Date.now(), demo: hint.mock === true, truncated: lastDropped.length > 0 });
      return { ok: true };
    } catch (_) { return { ok: false, error: 'Ошибка запроса подсказки.' }; }
    finally { busy = false; if (token === generation) aborter = null; }
  }

  /* Выполнение одной задачи через общий слой. */
  async function run(taskId) {
    const built = store.build();
    lastDropped = built.report.dropped.slice();
    const route = Routing.load(process.env, {
      ...cfg, apiKey: settings.getApiKey(), timeoutMs: 30000
    }).resolve(taskId);
    const request = AiRequest.build(taskId, built.context, route);
    stats.requests += 1;
    if (!aborter && typeof AbortController === 'function') aborter = new AbortController();
    const result = await Providers.execute(request, {
      ...route,
      signal: aborter ? aborter.signal : undefined
    });
    if (result && result.attempts > 1) stats.retries += result.attempts - 1;
    return result;
  }

  /* Что нового появилось на экране по сравнению с прошлым кадром. */
  function diff(previous, next) {
    if (!previous) return next;
    if (next.indexOf(previous) === 0) return next.slice(previous.length).trim();
    return next;
  }

  function report() {
    const built = store.build();
    return {
      running: running,
      stats: Object.assign({}, stats),
      context: built.report
    };
  }

  return { start, stop, tick, report, loadPrep, transcript };
}

module.exports = { create };
