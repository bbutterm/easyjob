/* ============================================================
   Помощник на собеседовании — прототип программы для компьютера.

   Что программа делает:
     — показывает прозрачное окно с текстом поверх других окон;
     — по явной команде пользователя периодически снимает кадр
       выбранного экрана или окна;
     — отправляет кадр или распознанный текст в модель через общий
       слой shared/ai и показывает короткое направление ответа.

   Чего программа намеренно НЕ делает:
     — не скрывает своё окно от захвата экрана и демонстрации;
     — записывает микрофон только по отдельному явному согласию;
     — не сохраняет кадры, распознанный текст и подсказки на диск;
     — не прячет свой процесс и не обходит правила площадок;
     — не начинает читать экран без нажатия кнопки в этой сессии.

   Использование помощника на настоящем собеседовании нужно
   согласовать с работодателем. Экран согласия при первом запуске
   требует это подтвердить.
   ============================================================ */

'use strict';

const { app, BrowserWindow, ipcMain, desktopCapturer, screen, shell, nativeImage } = require('electron');
const path = require('path');

const Settings = require('./lib/settings.js');
const Session = require('./lib/session.js');

let controlWindow = null;
let overlayWindow = null;
let consentWindow = null;
let session = null;
let speechSession = null;
let nextSpeechRequestAt = 0;
const { pathToFileURL } = require('node:url');
function isControl(sender) {
  return !!controlWindow && !controlWindow.isDestroyed() && sender === controlWindow.webContents
    && sender.getURL() === pathToFileURL(path.join(__dirname, 'renderer', 'control.html')).href;
}
const audioPermission = require('./lib/audio-permission.js').create(isControl);
function stopSpeech() {
  audioPermission.revoke();
  if (speechSession) { speechSession.stop(); speechSession = null; }
}

const isTest = process.env.ASSISTANT_TEST_MODE === '1';

/* Тестовый режим захвата. Включается только переменной окружения
   ASSISTANT_FAKE_CAPTURE=1 и нужен для проверки цикла сессии там,
   где настоящий захват экрана недоступен (например, в сборочной среде
   без графической оболочки). В обычном запуске выключен, и источник
   всегда настоящий. */
const fakeCapture = process.env.ASSISTANT_FAKE_CAPTURE === '1';
const FAKE_SOURCE_ID = 'assistant:test-source';
const FAKE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/* ---------------- Окна ---------------- */

function createConsentWindow() {
  consentWindow = new BrowserWindow({
    width: 660,
    height: 740,
    title: 'Помощник на собеседовании — условия использования',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  consentWindow.loadFile(path.join(__dirname, 'renderer', 'consent.html'));
  consentWindow.on('closed', function () { consentWindow = null; });
  return consentWindow;
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 900,
    height: 800,
    title: 'Помощник на собеседовании',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  controlWindow.loadFile(path.join(__dirname, 'renderer', 'control.html'));
  controlWindow.on('closed', function () { stopSpeech(); controlWindow = null; });
  controlWindow.webContents.on('render-process-gone', stopSpeech);
  controlWindow.webContents.on('did-start-navigation', stopSpeech);
  return controlWindow;
}

function createOverlayWindow() {
  if (overlayWindow) return overlayWindow;

  const display = screen.getPrimaryDisplay();
  const width = 460;
  const height = 320;

  overlayWindow = new BrowserWindow({
    width: width,
    height: height,
    x: Math.max(0, display.workArea.x + display.workArea.width - width - 24),
    y: display.workArea.y + 24,
    /* Прозрачное окно без рамки: текст «висит» поверх экрана. */
    transparent: true,
    frame: false,
    resizable: true,
    /* Поверх других окон, но обычным уровнем: окно остаётся видимым
       в списке окон и попадает в захват экрана. */
    alwaysOnTop: true,
    skipTaskbar: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  /* Намеренно НЕ вызываем setContentProtection(true).
     Окно должно быть видно при демонстрации экрана: прятать его от
     собеседника — это обход правил собеседования, а не функция. */

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWindow.on('closed', function () { overlayWindow = null; });
  return overlayWindow;
}

function sendToOverlay(channel, payload) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(channel, payload);
  }
}

function sendToControl(channel, payload) {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send(channel, payload);
  }
}

/* ---------------- Запуск ---------------- */

app.whenReady().then(function () {
  Settings.init(app.getPath('userData'));
  const permissions = require('electron').session.defaultSession;
  permissions.setPermissionCheckHandler((sender, permission, origin, details) => audioPermission.check(sender, permission, details));
  permissions.setPermissionRequestHandler((sender, permission, callback, details) => callback(audioPermission.request(sender, permission, details)));

  if (!Settings.get().consentAccepted) createConsentWindow();
  else createControlWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createControlWindow();
  });

  if (isTest) {
    /* Режим самопроверки: окна создаются, состояние выводится в журнал,
       затем приложение закрывается. Захвата экрана при этом не происходит. */
    setTimeout(async function () {
      const providers = require('../shared/ai/providers/index.js').ids;
      const overlay = createOverlayWindow();
      await new Promise(function (resolve) { setTimeout(resolve, 800); });
      const report = {
        ok: true,
        windows: BrowserWindow.getAllWindows().length,
        overlayTransparent: overlay.isAlwaysOnTop(),
        consentRequired: !Settings.get().consentAccepted,
        settingsPath: Settings.filePath(),
        providers: providers
      };
      console.log('ASSISTANT_TEST_REPORT ' + JSON.stringify(report));
      app.quit();
    }, 1500);
  }
});

app.on('window-all-closed', function () {
  if (session) { session.stop(); session = null; }
  if (process.platform !== 'darwin') app.quit();
});

/* ---------------- Обмен с окнами ---------------- */

ipcMain.handle('consent:accept', function () {
  Settings.patch({ consentAccepted: true, consentAcceptedAt: new Date().toISOString() });
  if (consentWindow) consentWindow.close();
  createControlWindow();
  return { ok: true };
});

ipcMain.handle('consent:decline', function () {
  app.quit();
  return { ok: true };
});

ipcMain.handle('settings:get', function () {
  return Settings.publicView();
});

ipcMain.handle('settings:set', function (event, patch) {
  Settings.patch(patch || {});
  return Settings.publicView();
});

/* Ключ доступа живёт только в памяти процесса и не пишется на диск. */
ipcMain.handle('settings:setApiKey', function (event, key) {
  Settings.setApiKey(key);
  return { ok: true, hasKey: Settings.hasApiKey() };
});

ipcMain.handle('sources:list', async function () {
  /* Список экранов и окон показывается пользователю, чтобы он сам
     выбрал источник. До выбора ничего не снимается. */
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 }
  });
  const list = sources.map(function (s) {
    return { id: s.id, name: s.name, preview: s.thumbnail.toDataURL() };
  });
  if (fakeCapture) {
    list.push({
      id: FAKE_SOURCE_ID,
      name: 'Тестовый источник (кадр не с экрана)',
      preview: 'data:image/png;base64,' + FAKE_PNG,
      fake: true
    });
  }
  return list;
});

ipcMain.handle('session:start', async function (event, options) {
  if (!Settings.get().consentAccepted) {
    return { ok: false, error: 'Не подтверждены условия использования.' };
  }
  if (session) session.stop();

  createOverlayWindow();

  session = Session.create({
    settings: Settings,
    sourceId: options.sourceId,
    sourceName: options.sourceName,
    prep: options.prep || null,
    capture: captureFrame,
    onStatus: function (status) {
      sendToOverlay('session:status', status);
      sendToControl('session:status', status);
    },
    onHint: function (hint) {
      sendToOverlay('session:hint', hint);
      sendToControl('session:hint', hint);
    }
  });

  return session.start();
});

ipcMain.handle('session:stop', function () {
  if (session) { session.stop(); session = null; }
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  return { ok: true };
});

ipcMain.handle('session:askNow', function () {
  if (!session) return { ok: false, error: 'Сессия не запущена.' };
  return session.tick(true);
});

ipcMain.handle('overlay:close', function () {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  return { ok: true };
});

ipcMain.handle('overlay:setOpacity', function (event, value) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setOpacity(Math.max(0.3, Math.min(1, Number(value) || 1)));
  }
  return { ok: true };
});

ipcMain.handle('app:openExternal', function (event, url) {
  if (/^https:\/\//.test(String(url))) shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('audio:config', function (event) {
  if (!isControl(event.sender)) return {};
  return { provider: process.env.STT_PROVIDER || 'mock', endpoint: process.env.STT_ENDPOINT || 'http://127.0.0.1:8080/inference' };
});
ipcMain.handle('audio:authorize', function (event, consent) {
  return { ok: Settings.get().consentAccepted && audioPermission.arm(event.sender, consent) };
});
ipcMain.handle('audio:stop', function (event) {
  if (!isControl(event.sender)) return { ok: false };
  stopSpeech(); return { ok: true };
});
ipcMain.handle('audio:hint', async function (event, payload) {
  if (!isControl(event.sender) || !Settings.get().consentAccepted || !payload || payload.consent !== true) return { ok: false };
  if (Date.now() < nextSpeechRequestAt) return { ok: false };
  nextSpeechRequestAt = Date.now() + 5000;
  if (!speechSession) {
    speechSession = Session.create({ settings: Settings, audioOnly: true, prep: payload.prep || null,
      onHint: hint => { sendToControl('audio:hint', hint); } });
    await speechSession.start();
  }
  return speechSession.transcript(payload.text, true);
});

/* ---------------- Снимок экрана ---------------- */

/* Кадр берётся из выбранного пользователем источника. Он существует
   только в памяти и не сохраняется на диск. */
async function captureFrame(sourceId, requestedSize) {
  if (fakeCapture && sourceId === FAKE_SOURCE_ID) {
    const image = nativeImage.createFromDataURL('data:image/png;base64,' + FAKE_PNG);
    const frameSize = image.getSize();
    return {
      base64: image.toPNG().toString('base64'),
      mediaType: 'image/png',
      width: frameSize.width,
      height: frameSize.height,
      capturedAt: Date.now(),
      fake: true
    };
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: requestedSize || { width: 1280, height: 720 }
  });
  const match = sources.filter(function (s) { return s.id === sourceId; })[0];
  if (!match) return null;
  const image = match.thumbnail;
  if (!image || image.isEmpty()) return null;
  const frameSize = image.getSize();
  return {
    base64: image.toPNG().toString('base64'),
    mediaType: 'image/png',
    width: frameSize.width,
    height: frameSize.height,
    capturedAt: Date.now()
  };
}

module.exports = { captureFrame };
