/* Сквозная проверка макета в реальном браузере.
   Запуск (нужен установленный playwright и Chromium):
     node tests/check.js
   Скрипт открывает index.html по file://, проходит основные сценарии,
   сохраняет скриншоты в docs/screenshots и печатает отчёт.
   Сеть не используется: любой внешний запрос считается ошибкой. */

'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
/* Скриншоты пишутся в репозиторий, поэтому по умолчанию выключены.
   Включаются переменной SCREENSHOTS=1 (см. npm run screenshots). */
const WRITE_SHOTS = process.env.SCREENSHOTS === '1';
async function shot(page, name, options) {
  if (!WRITE_SHOTS) return;
  await page.screenshot(Object.assign({ path: path.join(SHOTS, name) }, options || {}));
}

const results = [];
const consoleErrors = [];
const requests = [];

function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
}


async function openDemoPanel(page) {
  const expanded = await page.locator('.demo-panel__head').getAttribute('aria-expanded');
  if (expanded !== 'true') await page.click('.demo-panel__head');
}
async function closeDemoPanel(page) {
  const expanded = await page.locator('.demo-panel__head').getAttribute('aria-expanded');
  if (expanded === 'true') await page.click('.demo-panel__head');
}
async function setScenario(page, value) {
  await openDemoPanel(page);
  await page.selectOption('#demo-scenario', value);
  await page.waitForTimeout(120);
  await closeDemoPanel(page);
}

async function noOverflow(page) {
  return page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('request', r => requests.push(r.url()));
  page.on('download', () => results.push({ name: 'НЕОЖИДАННОЕ СКАЧИВАНИЕ', pass: false }));

  // Запретить микрофон на уровне API: если макет попытается — зафиксируем.
  await page.addInitScript(() => {
    window.__micCalls = 0;
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = function () {
        window.__micCalls++;
        return Promise.reject(new Error('blocked by test'));
      };
    }
  });

  await page.goto(FILE);
  await page.waitForSelector('#app .public');

  /* ---- 1. Путь: резюме → вакансия → вопросы → интервью → итог ---- */
  ok('Начальная страница открылась', await page.locator('text=Карьерный помощник').first().isVisible());
  await shot(page, '01-start-desktop.png', { fullPage: true });

  await page.click('text=Открыть демо');
  await page.waitForSelector('text=С чего начнём?');
  await page.click('text=Начать с нуля');
  await page.waitForSelector('text=Создание резюме');

  // проверка обязательного поля
  await page.click('button:has-text("Далее")');
  ok('Ошибка обязательного поля показана', await page.locator('.field__error').first().isVisible());

  await page.fill('#b-profession', 'Продуктовый аналитик');
  await page.fill('#b-wishes', 'Гибрид, продуктовая команда');
  await page.fill('#b-summary', 'Аналитик с опытом работы с требованиями.');
  await page.click('button:has-text("Далее")');
  await page.waitForSelector('text=Место работы', { state: 'attached' }).catch(() => {});
  await page.click('button:has-text("Добавить место работы")');
  await page.fill('#exp-role-0', 'Аналитик');
  await page.fill('#exp-company-0', 'Демо-Компания');
  await page.fill('#exp-period-0', '2021 — сейчас');
  await page.fill('#exp-details-0', 'Требования и отчётность.');
  await page.click('button:has-text("Далее")');
  await page.fill('#b-skills', 'SQL\nBPMN');
  await page.click('button:has-text("Далее")');
  await page.click('button:has-text("Добавить образование")');
  await page.fill('#edu-place-0', 'Демо-Университет');
  await page.click('button:has-text("Далее")');
  ok('Предпросмотр содержит введённую профессию',
    (await page.locator('.resume-preview').innerText()).includes('Продуктовый аналитик'));
  ok('Введённый навык попал в предпросмотр',
    (await page.locator('.resume-preview').innerText()).includes('BPMN'));
  await shot(page, '02-wizard-preview-desktop.png', { fullPage: true });

  await page.click('button:has-text("Собрать резюме")');
  await page.waitForSelector('text=Резюме собрано', { timeout: 5000 });
  ok('Показана метка про фиксированный образец',
    await page.locator('text=Фиксированный пример, не ИИ').isVisible());

  await page.click('button:has-text("Сохранить и использовать для подготовки")');
  await page.waitForSelector('text=Добавление вакансии');
  await page.click('button:has-text("Импортировать по ссылке")');
  ok('Импорт по ссылке объяснён заглушкой',
    await page.locator('.modal:has-text("Импорт по ссылке не реализован")').isVisible());
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal', { state: 'detached' });
  ok('Диалог закрывается по Escape', true);

  await page.click('button:has-text("Открыть пример вакансии")');
  await page.waitForTimeout(150);
  const createBtn = page.locator('button:has-text("Создать подготовку")');
  ok('Кнопка создания подготовки активна после заполнения', await createBtn.isEnabled());
  await createBtn.click();
  await page.waitForSelector('text=Сопоставление резюме с вакансией');
  ok('Нет общего процента соответствия',
    !(await page.locator('#main').innerText()).match(/\d+\s?%/));
  await page.click('.req-item__head >> nth=0');
  ok('Требование раскрывается', await page.locator('.req-item__body').first().isVisible());
  await shot(page, '03-match-desktop.png', { fullPage: true });

  await page.click('button:has-text("Перейти к вопросам")');
  await page.waitForSelector('text=Вероятные вопросы для подготовки');
  const qCount = await page.locator('.q-item').count();
  ok('Вопросов 10–15', qCount >= 10 && qCount <= 15, 'найдено ' + qCount);
  await page.fill('#ans-q1', 'Мой ответ на первый вопрос.');
  await page.click('.q-item >> nth=0 >> button:has-text("Отметить")');
  ok('Отметка «Подготовлено» проставлена',
    await page.locator('.q-item >> nth=0 >> .tag--ok').isVisible());
  ok('Ответ сохранён при перерисовке',
    (await page.inputValue('#ans-q1')) === 'Мой ответ на первый вопрос.');
  await page.selectOption('#q-topic', 'Кейс');
  ok('Фильтр по теме работает', (await page.locator('.q-item').count()) === 2);
  await page.selectOption('#q-topic', 'all');
  await shot(page, '04-questions-desktop.png', { fullPage: true });

  await page.click('button:has-text("Начать пробное интервью")');
  await page.waitForSelector('text=Текстовое пробное интервью');
  await page.click('button:has-text("Начать интервью")');
  await page.waitForSelector('#chat-input');
  await page.click('button:has-text("Отправить ответ")');
  ok('Пустой ответ не отправляется', (await page.locator('.msg--user').count()) === 0);
  for (let i = 0; i < 5; i++) {
    await page.fill('#chat-input', 'Демонстрационный ответ номер ' + (i + 1));
    await page.click('button:has-text("Отправить ответ")');
    await page.waitForTimeout(950);
  }
  ok('Ответы пользователя видны в переписке', (await page.locator('.msg--user').count()) === 5);
  await page.click('button:has-text("Показать ошибку отправки (демо)")');
  ok('Показано состояние ошибки', await page.locator('.note--alert:has-text("ошибка отправки")').isVisible());
  await page.click('button:has-text("Повторить")');
  await shot(page, '05-interview-desktop.png', { fullPage: true });
  await page.click('button:has-text("Завершить и выйти")');
  await page.click('.modal button:has-text("Завершить")');
  await page.waitForSelector('text=Итог пробного интервью');
  ok('Итог помечен как заранее подготовленный',
    await page.locator('text=Отчёт заранее подготовлен').isVisible());

  /* ---- 4. Голосовое демо ---- */
  await page.click('button:has-text("Попробовать голосом")');
  await page.waitForSelector('text=Голосовое пробное интервью');
  await page.click('button:has-text("Начать разговор")');
  await page.click('button:has-text("Следующая реплика")');
  await page.selectOption('#voice-scenario', 'lost');
  ok('Состояние «Связь потеряна» показано', await page.locator('.voice-orb--err').isVisible());
  await page.selectOption('#voice-scenario', 'listening');
  await page.click('button:has-text("Пауза")');
  ok('Пауза работает', (await page.locator('.voice-orb').innerText()).includes('Пауза'));
  await page.click('button:has-text("Микрофон (заглушка)")');
  ok('Микрофон объяснён заглушкой', await page.locator('.modal:has-text("Микрофон не используется")').isVisible());
  await page.click('.modal button:has-text("Понятно")');
  await shot(page, '06-voice-desktop.png', { fullPage: true });
  await page.click('button:has-text("Завершить")');
  await page.click('.modal button:has-text("Завершить")');
  await page.waitForSelector('text=Итог голосовой тренировки');
  ok('Микрофон не запрашивался', (await page.evaluate(() => window.__micCalls)) === 0);

  /* ---- 5. Помощник ---- */
  await page.goto(FILE + '#/assistant');
  await page.waitForSelector('text=Помощник на собеседовании');
  ok('На уровне «Тренировки» помощник закрыт',
    await page.locator('text=Раздел недоступен на текущем демо-уровне').isVisible());
  await page.click('button:has-text("Переключить демо-уровень")');
  await page.waitForTimeout(200);
  ok('После переключения раздел открылся',
    await page.locator('text=Зачем нужен отдельный компонент').isVisible());
  await page.click('button:has-text("Скачать помощник")');
  ok('Скачивание — заглушка', await page.locator('.modal:has-text("Компонент ещё не доступен")').isVisible());
  await page.click('.modal button:has-text("Понятно")');
  await page.click('button:has-text("Подключить (демо-статусы)")');
  await page.waitForTimeout(1100);
  ok('Статус «Подключён» показан', await page.locator('.tag--ok:has-text("Подключён")').isVisible());
  await page.click('button:has-text("Ошибка подключения")');
  ok('Статус ошибки показан', await page.locator('.tag--alert:has-text("Ошибка подключения")').isVisible());
  await page.click('button:has-text("Посмотреть пример подсказок")');
  ok('Панель подсказок открыта', await page.locator('text=Направление ответа').isVisible());
  await page.click('button:has-text("Следующий пример")');
  ok('Пример переключается', (await page.locator('text=/Пример 2 из \\d+/').isVisible()));
  await shot(page, '07-assistant-desktop.png', { fullPage: true });
  await page.click('button:has-text("Свернуть")');
  ok('Панель подсказок сворачивается', !(await page.locator('text=Направление ответа').isVisible()));

  /* ---- 6. Тарифы ---- */
  await page.goto(FILE + '#/plans');
  await page.waitForSelector('text=Тарифы и лимиты');
  ok('Цена не выдумана', (await page.locator('#main').innerText()).includes('Цена уточняется'));
  await page.click('button:has-text("Оплатить") >> nth=0');
  ok('Оплата — заглушка', await page.locator('.modal:has-text("Оплата недоступна")').isVisible());
  await page.click('.modal button:has-text("Понятно")');
  await page.click('.plan:has-text("Резюме и подготовка") button:has-text("Выбрать в демо")');
  await page.waitForTimeout(150);
  await shot(page, '08-plans-desktop.png', { fullPage: true });
  await page.goto(FILE + '#/interviews');
  ok('Тренировки заблокированы на младшем тарифе',
    await page.locator('text=Раздел недоступен на текущем демо-уровне').isVisible());
  ok('Заблокированное действие объяснено',
    await page.locator('text=Покупка недоступна').isVisible());
  await page.click('button:has-text("Переключить демо-уровень")');
  await page.waitForTimeout(200);
  ok('После переключения раздел открылся',
    await page.locator('text=Выберите подготовку и формат тренировки').isVisible());
  await setScenario(page, 'limit');
  await page.goto(FILE + '#/vacancies');
  ok('Состояние лимита показано', await page.locator('text=Достигнут демонстрационный лимит').isVisible());
  await setScenario(page, 'filled');

  /* ---- 3. Изменение исходников → отметка устаревшего ---- */
  await page.goto(FILE + '#/resumes');
  await page.click('.row-item >> nth=0 >> button:has-text("Открыть")');
  await page.waitForSelector('text=Действия');
  await page.click('button:has-text("Внести демонстрационную правку")');
  await page.goto(FILE + '#/overview');
  ok('Прежний результат помечен как устаревший',
    await page.locator('text=Отчёты относятся к предыдущей версии исходников').isVisible());
  await shot(page, '09-stale-desktop.png', { fullPage: true });
  await page.click('button:has-text("Пересобрать демо")');
  ok('Пересборка снимает отметку',
    !(await page.locator('text=Отчёты относятся к предыдущей версии исходников').isVisible()));

  /* ---- 2. Загрузка файла ---- */
  const tmpFile = path.join(os.tmpdir(), 'rezume-test.txt');
  fs.writeFileSync(tmpFile, 'демонстрационный файл');
  await page.goto(FILE + '#/resume/upload');
  await page.setInputFiles('#file-input', tmpFile);
  await page.waitForTimeout(200);
  ok('Имя файла показано', (await page.locator('#main').innerText()).includes('rezume-test.txt'));
  ok('Есть предупреждение о нечитаемых форматах',
    await page.locator('text=Чтение PDF и DOCX ещё не реализовано').isVisible());
  await page.click('button:has-text("Показать пример анализа")');
  await page.waitForSelector('text=Демонстрационный разбор резюме');
  await page.click('.q-item >> nth=0 >> button:has-text("Принять")');
  ok('Принятое предложение попало в демо-версию',
    (await page.locator('text=Демонстрационная версия резюме').isVisible())
    && (await page.locator('.tag--ok:has-text("Принято")').count()) > 0);
  await page.click('.q-item >> nth=1 >> button:has-text("Отклонить")');
  await shot(page, '10-upload-analysis-desktop.png', { fullPage: true });
  await page.click('.row-item button:has-text("Заменить")');
  await page.click('.row-item button:has-text("Удалить")');
  ok('Выбор файла удаляется', !(await page.locator('#main').innerText()).includes('rezume-test.txt'));

  /* ---- 7. Пустое состояние, подтверждение удаления, сброс демо ---- */
  await setScenario(page, 'empty');
  await page.goto(FILE + '#/overview');
  ok('Пустое состояние показано', await page.locator('text=Пока ничего нет').isVisible());
  await shot(page, '11-empty-desktop.png', { fullPage: true });
  await setScenario(page, 'filled');
  await page.goto(FILE + '#/resumes');
  await page.click('.row-item >> nth=0 >> button:has-text("Удалить")');
  ok('Удаление требует подтверждения', await page.locator('.modal:has-text("Удалить резюме?")').isVisible());
  await page.click('.modal button:has-text("Отмена")');
  ok('Отмена сохраняет запись', (await page.locator('.row-item').count()) === 2);
  await page.click('.row-item >> nth=0 >> button:has-text("Удалить")');
  await page.click('.modal button:has-text("Удалить")');
  ok('Подтверждённое удаление сработало', (await page.locator('.row-item').count()) === 1);
  await openDemoPanel(page);
  await page.click('.demo-panel button:has-text("Сбросить демо")');
  await page.waitForTimeout(200);
  await closeDemoPanel(page);
  ok('Сброс демо вернул исходные данные', (await page.locator('.row-item').count()) === 2);

  /* ---- Профессии: библиотека и произвольный ввод ---- */
  await setScenario(page, 'filled');
  await openDemoPanel(page);
  const professionOptions = await page.locator('#demo-profession option').count();
  ok('В библиотеке несколько профессий', professionOptions >= 6, professionOptions + ' шт.');
  await page.selectOption('#demo-profession', 'chef');
  await page.waitForTimeout(200);
  await closeDemoPanel(page);
  await page.goto(FILE + '#/vacancies');
  await page.waitForSelector('.row-item');
  ok('Вакансия пересобрана под профессию «Повар»',
    (await page.locator('#main').innerText()).includes('Повар'));
  const prepLink = await page.locator('.row-item button:has-text("Вопросы")').first();
  await prepLink.click();
  await page.waitForSelector('.q-item');
  const chefText = await page.locator('#main').innerText();
  ok('Вопросы стали профильными для повара',
    /цех|карт|смен/i.test(chefText), chefText.slice(0, 80).replace(/\n/g, ' '));

  await page.goto(FILE + '#/resume/new');
  await page.fill('#b-profession', 'Флорист');
  ok('Поле профессии — свободный ввод со списком-подсказкой',
    (await page.getAttribute('#b-profession', 'list')) === 'profession-list');
  await page.click('button:has-text("Далее")');
  await page.click('button:has-text("Добавить место работы")');
  await page.fill('#exp-role-0', 'Флорист');
  await page.click('button:has-text("Далее")');
  await page.fill('#b-skills', 'Составление букетов');
  await page.click('button:has-text("Далее")');
  await page.click('button:has-text("Далее")');
  await page.click('button:has-text("Собрать резюме")');
  await page.waitForSelector('text=Резюме собрано', { timeout: 5000 });
  await page.click('button:has-text("Сохранить и использовать для подготовки")');
  await page.waitForSelector('text=Добавление вакансии');
  await page.click('button:has-text("Открыть пример вакансии")');
  await page.waitForTimeout(150);
  ok('Для профессии вне библиотеки собран комплект с её названием',
    (await page.locator('#main').innerText()).includes('Флорист'));
  await page.click('button:has-text("Создать подготовку")');
  await page.waitForSelector('text=Сопоставление резюме с вакансией');
  ok('Требования собраны и для произвольной профессии',
    (await page.locator('.req-item').count()) >= 3);
  await page.goto(FILE + '#/overview');
  ok('Общий шаблон помечен честно',
    (await page.locator('#main').innerText()).includes('общий шаблон'));
  await openDemoPanel(page);
  await page.selectOption('#demo-profession', 'analyst');
  await page.waitForTimeout(200);
  await closeDemoPanel(page);

  /* ---- Неизвестный маршрут ---- */
  await page.goto(FILE + '#/unknown-route-xyz');
  await page.waitForTimeout(300);
  ok('Неизвестный маршрут ведёт к обзору', page.url().includes('#/overview'));

  /* ---- 8. Клавиатура и переполнение ---- */
  ok('Нет горизонтального переполнения (desktop)', await noOverflow(page));
  await page.reload();
  await page.waitForSelector('.topbar');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.className);
  ok('Первый Tab попадает на ссылку пропуска', String(focused).includes('skip-link'), String(focused));
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  const focus2 = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? el.tagName + ':' + (el.textContent || '').slice(0, 24) : 'none';
  });
  ok('Клавиатурная навигация доходит до меню', focus2 !== 'none', focus2);

  /* ---- localStorage: только настройки ---- */
  const ls = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
  const lsKeys = Object.keys(ls);
  ok('В localStorage только один ключ настроек', lsKeys.length === 1, lsKeys.join(','));
  ok('В localStorage нет резюме и файлов',
    !/резюме|experience|fileName|token|password/i.test(JSON.stringify(ls)), JSON.stringify(ls));

  /* ---- Мобильные экраны ---- */
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mobile.newPage();
  mp.on('console', m => { if (m.type() === 'error') consoleErrors.push('mobile: ' + m.text()); });
  mp.on('pageerror', e => consoleErrors.push('mobile pageerror: ' + e.message));
  mp.on('request', r => requests.push(r.url()));
  await mp.goto(FILE + '#/overview');
  await mp.waitForSelector('.topbar');
  ok('Мобильный: нет горизонтального переполнения', await mp.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await shot(mp, '12-overview-mobile.png', { fullPage: true });
  await mp.click('.menu-btn');
  await mp.waitForTimeout(250);
  ok('Мобильное меню открывается', await mp.locator('.sidebar').isVisible());
  await shot(mp, '13-menu-mobile.png', { fullPage: true });
  await mp.click('.nav-scrim', { position: { x: 350, y: 500 } });
  await mp.waitForTimeout(250);
  ok('Меню закрывается по клику вне', !(await mp.locator('.nav-scrim').count()));
  await mp.goto(FILE + '#/prep/prep-1/questions');
  await mp.waitForSelector('.q-item');
  ok('Мобильный: вопросы без переполнения', await mp.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await shot(mp, '14-questions-mobile.png', { fullPage: true });
  await mp.goto(FILE + '#/assistant');
  await mp.waitForSelector('text=Помощник на собеседовании');
  await shot(mp, '15-assistant-mobile.png', { fullPage: true });

  /* ---- Тёмная тема ---- */
  await page.goto(FILE + '#/overview');
  await page.click('[data-act="theme:toggle"]');
  await page.waitForTimeout(200);
  ok('Тёмная тема применяется',
    (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');
  await shot(page, '16-overview-dark.png', { fullPage: true });
  await page.click('[data-act="theme:toggle"]');

  /* ---- 9. Сеть ---- */
  const external = requests.filter(u => !u.startsWith('file://'));
  ok('Нет сторонних сетевых запросов', external.length === 0, external.join(', '));
  ok('Нет ошибок в консоли', consoleErrors.length === 0, consoleErrors.join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.pass);
  console.log('\nИтого: ' + (results.length - failed.length) + ' из ' + results.length + ' проверок пройдено.');
  fs.writeFileSync(path.join(os.tmpdir(), 'prototype-check-results.json'),
    JSON.stringify({ results, consoleErrors, external }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ОШИБКА ТЕСТА:', e.message); process.exit(2); });
