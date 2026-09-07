/* Сквозная проверка программы для компьютера.

   Запуск (нужны electron в desktop/node_modules и playwright):
     xvfb-run -a node tests/desktop.test.js

   Проверяется реальный запуск приложения: экран согласия, панель
   управления, список источников, цикл сессии на провайдере-заглушке,
   прозрачное окно подсказки и отсутствие записи данных на диск.
   Сеть не используется. */

'use strict';

const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const DESKTOP = path.join(ROOT, 'desktop');

/* Скриншоты пишутся в репозиторий, поэтому по умолчанию выключены. */
const WRITE_SHOTS = process.env.SCREENSHOTS === '1';
async function shot(page, name) {
  if (!WRITE_SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name) });
}

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
}

function listFiles(dir) {
  const out = [];
  (function walk(current) {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (e) { return; }
    entries.forEach(function (entry) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    });
  })(dir);
  return out;
}

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-test-'));

  /* Playwright ищет electron в своих зависимостях, поэтому путь
     указывается явно из desktop/node_modules. */
  const executablePath = require(path.join(DESKTOP, 'node_modules', 'electron'));

  const app = await electron.launch({
    executablePath: executablePath,
    args: [DESKTOP, '--no-sandbox', '--use-fake-device-for-media-stream', '--user-data-dir=' + userData],
    cwd: DESKTOP,
    /* Настоящий захват экрана в сборочной среде без графической оболочки
       недоступен, поэтому цикл сессии проверяется на тестовом источнике.
       В обычном запуске этот режим выключен. */
    env: Object.assign({}, process.env, { ASSISTANT_TEST_MODE: '', ASSISTANT_FAKE_CAPTURE: '1', STT_PROVIDER: 'mock' })
  });

  /* ---- Экран согласия ---- */
  const consent = await app.firstWindow();
  await consent.waitForSelector('#accept');
  ok('При первом запуске показан экран согласия',
    (await consent.title()).indexOf('Условия') >= 0, await consent.title());
  ok('Кнопка согласия заблокирована до отметок',
    await consent.locator('#accept').isDisabled());
  ok('Предупреждение о согласовании с работодателем показано',
    (await consent.locator('body').innerText()).includes('согласовать с работодателем'));
  ok('Сказано, что окно видно при демонстрации экрана',
    (await consent.locator('body').innerText()).includes('Не скрывает своё окно от демонстрации'));

  await shot(consent, '20-desktop-consent.png');
  await consent.check('#c1');
  await consent.check('#c2');
  ok('Двух отметок из трёх недостаточно', await consent.locator('#accept').isDisabled());
  await consent.check('#c3');
  ok('После всех отметок согласие можно дать',
    await consent.locator('#accept').isEnabled());
  await consent.click('#accept');

  /* ---- Панель управления ---- */
  await new Promise(function (r) { setTimeout(r, 1500); });
  let control = null;
  for (const win of app.windows()) {
    const title = await win.title();
    if (title.indexOf('Помощник на собеседовании') === 0) control = win;
  }
  ok('Открылась панель управления', !!control);
  if (!control) { await app.close(); process.exit(1); }

  await control.waitForSelector('#provider');
  ok('Провайдер по умолчанию — заглушка без сети',
    (await control.inputValue('#provider')) === 'mock');
  ok('Режим чтения по умолчанию — заглушка',
    (await control.inputValue('#readMode')) === 'mock');
  ok('Сказано, что ключ не пишется на диск',
    (await control.locator('body').innerText()).includes('не записывается на диск'));

  await control.waitForSelector('[data-stt="start"]');
  ok('Микрофон требует отдельное согласие', await control.locator('[data-stt="start"]').isDisabled());
  await control.check('[data-stt="consent"]');
  await control.click('[data-stt="start"]');
  ok('Состояние демо-записи видно, микрофон выключен',
    (await control.locator('[data-stt="state"]').innerText()).includes('Демо: микрофон выключен'));
  await control.click('[data-stt="stop"]');
  await control.waitForFunction(() => document.querySelector('[data-stt="state"]').textContent.startsWith('ready'));
  await control.fill('[data-stt="text"]', 'STT-PRIVATE-MARKER: расскажите об опыте');
  await control.click('[data-stt="send"]');
  await control.waitForFunction(() => document.querySelector('#audio-hint').textContent.length > 0);
  ok('Транскрипт дал assistant.hint без экранной сессии',
    (await control.locator('#audio-hint').innerText()).includes('Заглушка'));
  ok('Транскрипт не попадает в журнал', !(await control.locator('#log').innerText()).includes('STT-PRIVATE-MARKER'));
  await control.click('[data-stt="cancel"]');
  ok('Отмена очистила транскрипт и подсказку', (await control.inputValue('[data-stt="text"]')) === ''
    && (await control.locator('#audio-hint').innerText()) === '');
  ok('Транскрипт не записан в файлы профиля', !listFiles(userData).some(file => {
    try { return fs.readFileSync(file).includes(Buffer.from('STT-PRIVATE-MARKER')); } catch (_) { return false; }
  }));

  ok('Electron отклоняет микрофон без отдельного разрешения', await control.evaluate(async () => {
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(t => t.stop()); return false; }
    catch (_) { return true; }
  }));
  await control.evaluate(() => {
    window.__sttTracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints); window.__sttTracks.push(...stream.getTracks()); return stream;
    };
  });
  await control.route('http://127.0.0.1:8080/inference', async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-allow-private-network': 'true' } }); return;
    }
    if (!route.request().postDataBuffer().includes(Buffer.from('RIFF'))) throw new Error('Expected WAV');
    await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"text":"Синтетическое устройство, фикстура STT"}' });
  });
  await control.selectOption('[data-stt="provider"]', 'whisper_cpp');
  await control.check('[data-stt="consent"]'); await control.click('[data-stt="start"]');
  await control.waitForFunction(() => document.querySelector('[data-stt="state"]').textContent.startsWith('recording'));
  await control.waitForTimeout(400); await control.click('[data-stt="stop"]');
  await control.waitForFunction(() => document.querySelector('[data-stt="state"]').textContent.startsWith('ready'));
  ok('Electron: синтетический микрофон → WAV → STT-фикстура, дорожки остановлены',
    (await control.inputValue('[data-stt="text"]')).includes('Синтетическое')
    && await control.evaluate(() => window.__sttTracks.length > 0 && window.__sttTracks.every(t => t.readyState === 'ended')));
  await control.click('[data-stt="cancel"]');

  /* ---- Ключ доступа не попадает на диск ---- */
  await control.fill('#apikey', 'секретный-ключ-для-проверки');
  await control.click('#save');
  await new Promise(function (r) { setTimeout(r, 800); });
  const settingsFile = path.join(userData, 'settings.json');
  const settingsRaw = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : '';
  ok('Файл настроек создан', settingsRaw.length > 0);
  ok('Ключ доступа не записан в настройки',
    settingsRaw.indexOf('секретный-ключ-для-проверки') < 0);
  ok('Признак согласия сохранён', /"consentAccepted":\s*true/.test(settingsRaw));

  /* ---- Источники захвата ---- */
  await control.click('#samplePrep');
  ok('Пример подготовки подставлен',
    (await control.inputValue('#prep')).includes('Повар'));

  await shot(control, '21-desktop-control.png');
  await control.click('#refresh');
  await control.waitForSelector('.source', { timeout: 15000 });
  const sourceCount = await control.locator('.source').count();
  ok('Список источников получен', sourceCount > 0, sourceCount + ' шт. (в этой среде — только тестовый)');
  /* В списке может оказаться и настоящий экран Xvfb — ищем помеченный тестовый. */
  const testSource = control.locator('.source', { hasText: 'тестовый' });
  ok('Тестовый источник помечен в интерфейсе', (await testSource.count()) === 1);
  ok('Кнопка запуска заблокирована до выбора источника',
    await control.locator('#start').isDisabled());

  await testSource.first().click();
  ok('После выбора источника запуск разрешён',
    await control.locator('#start').isEnabled());

  /* ---- Сессия ---- */
  /* Окно подсказки создаётся при старте сессии — ждём его появления. */
  const overlayPromise = app.waitForEvent('window', { timeout: 25000 }).catch(function () { return null; });
  await control.click('#start');
  await control.waitForFunction(
    "document.getElementById('log').innerText.includes('Подсказка')",
    null, { timeout: 20000 });
  const logText = await control.locator('#log').innerText();
  ok('Подсказка получена в цикле сессии', logText.includes('Подсказка'));
  ok('Подсказка помечена как заглушка', logText.includes('заглушка'),
    logText.split('\n')[0].slice(0, 90));
  ok('Кадр экрана снят', /кадров: [1-9]/.test(logText));

  /* ---- Прозрачное окно ---- */
  await overlayPromise;
  /* Окно могло появиться раньше, чем загрузилась его страница:
     ждём, пока адрес станет известен. */
  let overlay = null;
  const windowUrls = [];
  for (let attempt = 0; attempt < 20 && !overlay; attempt++) {
    windowUrls.length = 0;
    for (const win of app.windows()) {
      let url = win.url();
      if (!url) {
        try { await win.waitForLoadState('domcontentloaded', { timeout: 1000 }); } catch (e) {}
        url = win.url();
      }
      windowUrls.push(url || '(адрес пуст)');
      if (url.indexOf('overlay.html') >= 0) overlay = win;
    }
    if (!overlay) await new Promise(function (r) { setTimeout(r, 500); });
  }
  ok('Окно подсказки открыто', !!overlay, windowUrls.join(' | '));
  if (overlay) {
    const overlayText = await overlay.locator('body').innerText();
    ok('В окне показано направление ответа', overlayText.length > 20);
    ok('В окне есть напоминание о видимости при демонстрации',
      overlayText.includes('видно при демонстрации экрана'));
    await shot(overlay, '22-desktop-overlay.png');
    const bg = await overlay.evaluate(function () {
      return getComputedStyle(document.body).backgroundColor;
    });
    ok('Фон окна прозрачный', bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent', bg);
  }

  /* ---- Остановка и отсутствие следов на диске ---- */
  await control.click('#stop');
  await new Promise(function (r) { setTimeout(r, 800); });
  ok('Сессия остановлена',
    (await control.locator('#log').innerText()).includes('остановлена'));

  const files = listFiles(userData);
  const images = files.filter(function (f) { return /\.(png|jpe?g|webp|bmp)$/i.test(f); });
  ok('Кадры экрана на диск не сохранены', images.length === 0, images.join(', '));
  const withKey = files.filter(function (f) {
    try { return fs.readFileSync(f, 'utf8').indexOf('секретный-ключ-для-проверки') >= 0; }
    catch (e) { return false; }
  });
  ok('Ключа нет ни в одном файле профиля', withKey.length === 0, withKey.join(', '));

  await app.close();
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) {}

  const failed = results.filter(function (r) { return !r.pass; });
  console.log('\nИтого: ' + (results.length - failed.length) + ' из ' + results.length + ' проверок пройдено.');
  process.exit(failed.length ? 1 : 0);
})().catch(function (e) {
  console.error('ОШИБКА ТЕСТА:', e.message);
  process.exit(2);
});
