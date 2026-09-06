/* Сквозная проверка режима сервера: настоящий браузер против настоящего
   сервера на провайдере-заглушке. Запуск: node tests/live.test.js */

'use strict';

const { chromium } = require('playwright');
const { createApp } = require('../server/index.js');

process.env.AI_PROVIDER = 'mock';
process.env.SESSION_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
}
const VACANCY_TEXT = 'Ищем повара в ресторан полного цикла.\n\nТребования:\n— Опыт на горячем цехе от 2 лет\n'
  + '— Работа по технологическим картам\n— Действующая медицинская книжка\n\nУсловия: сменный график, оформление по ТК.';

(async () => {
  const { server } = createApp({ dbFile: ':memory:', freePrepsPerDay: 10, secure: false });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
  const external = [];
  page.on('request', function (r) { if (r.url().indexOf(base) !== 0) external.push(r.url()); });

  await page.goto(base + '/#/overview');
  await page.waitForSelector('.topbar');
  ok('Страница отдана сервером и определила режим',
    (await page.locator('.topbar').innerText()).indexOf('Сервер') >= 0);
  ok('Режим помечен как заглушка модели', (await page.locator('.topbar').innerText()).indexOf('заглушка') >= 0);
  ok('Демо-данных нет: пустое состояние', await page.locator('text=Пока ничего нет').isVisible());

  /* ---- Резюме через мастер уходит на сервер ---- */
  await page.goto(base + '/#/resume/new');
  await page.fill('#b-profession', 'Повар');
  await page.fill('#b-summary', 'Повар горячего цеха, пять лет в ресторанах.');
  await page.click('button:has-text("Далее")');
  await page.click('button:has-text("Добавить место работы")');
  await page.fill('#exp-role-0', 'Повар');
  await page.fill('#exp-company-0', 'Демо-Ресторан');
  await page.fill('#exp-details-0', 'Горячий цех, технологические карты.');
  await page.click('button:has-text("Далее")');
  await page.fill('#b-skills', 'Горячий цех\nТехнологические карты');
  await page.click('button:has-text("Далее")');
  await page.click('button:has-text("Далее")');
  await page.click('button:has-text("Собрать резюме")');
  await page.waitForSelector('text=Резюме собрано');
  await page.click('button:has-text("Сохранить и использовать для подготовки")');
  await page.waitForSelector('text=Добавление вакансии');
  const resumesOnServer = await (await fetch(base + '/api/resumes', { headers: { cookie: await cookieHeader(ctx) } })).json();
  ok('Резюме из мастера сохранено на сервере', resumesOnServer.length === 1 && resumesOnServer[0].data.profession === 'Повар');

  /* ---- Вакансия → подготовка с сопоставлением от сервера ---- */
  await page.fill('#vac-title', 'Повар');
  await page.fill('#vac-company', 'Демо-Ресторан');
  await page.fill('#vac-text', VACANCY_TEXT);
  await page.click('button:has-text("Создать подготовку")');
  await page.waitForSelector('text=Сопоставление резюме с вакансией', { timeout: 15000 });
  const matchText = await page.locator('#main').innerText();
  ok('Требования взяты из вставленного текста', matchText.indexOf('медицинская книжка') >= 0);
  ok('Экран честно сообщает о заглушке на сервере', matchText.indexOf('заглушке') >= 0);
  ok('Нет общего процента соответствия', !/\d+\s?%/.test(matchText));

  /* ---- Вопросы: генерация и автосохранение ---- */
  await page.click('button:has-text("Перейти к вопросам")');
  await page.waitForSelector('button:has-text("Собрать вопросы")');
  await page.click('button:has-text("Собрать вопросы")');
  await page.waitForSelector('.q-item', { timeout: 15000 });
  const qCount = await page.locator('.q-item').count();
  ok('Вопросы пришли с сервера', qCount >= 5, qCount + ' шт.');
  await page.fill('.q-item >> nth=0 >> textarea', 'Отвечал за горячий цех в смену на сорок столов.');
  await page.click('.q-item >> nth=0 >> button:has-text("Отметить")');
  await page.waitForTimeout(1300);

  /* ---- Перезагрузка: всё на месте ---- */
  await page.reload();
  await page.waitForSelector('.q-item', { timeout: 15000 });
  ok('После перезагрузки вопросы на месте', (await page.locator('.q-item').count()) === qCount);
  ok('После перезагрузки ответ сохранён',
    (await page.inputValue('.q-item >> nth=0 >> textarea')).indexOf('сорок столов') >= 0);
  ok('Отметка «Подготовлено» сохранена', await page.locator('.q-item >> nth=0 >> .tag--ok').isVisible());

  /* ---- Интервью потоком ---- */
  await page.click('button:has-text("Начать пробное интервью")');
  await page.waitForSelector('button:has-text("Начать интервью")');
  await page.click('button:has-text("Начать интервью")');
  await page.waitForSelector('#chat-input', { timeout: 15000 });
  const firstBot = await page.locator('.msg:not(.msg--user):not(.msg--sys) .msg__body').first().innerText();
  ok('Первый вопрос интервьюера пришёл с сервера', firstBot.length > 10, firstBot.slice(0, 50));
  await page.fill('#chat-input', 'Отвечал за горячий цех.');
  await page.click('button:has-text("Отправить ответ")');
  await page.waitForFunction(function () {
    return document.querySelectorAll('.msg:not(.msg--sys)').length >= 3;
  }, null, { timeout: 15000 });
  ok('Ответ ушёл и интервьюер продолжил', (await page.locator('.msg--user').count()) === 1);
  await page.click('button:has-text("Завершить и выйти")');
  await page.click('.modal button:has-text("Завершить")');
  await page.waitForSelector('text=Итог пробного интервью', { timeout: 15000 });
  ok('Итог интервью получен с сервера', (await page.locator('#main').innerText()).indexOf('Темы для повторения') >= 0);

  /* ---- Карточка подготовки из сохранённых ответов ---- */
  await page.click('button:has-text("Вернуться к вопросам")');
  await page.waitForSelector('.q-item');
  await page.click('button:has-text("Собрать карточку подготовки")');
  await page.waitForSelector('text=Карточка подготовки');
  ok('Карточка содержит сохранённый ответ', (await page.locator('#main').innerText()).indexOf('сорок столов') >= 0);

  /* ---- Разбор вставленного резюме ---- */
  await page.goto(base + '/#/resume/upload');
  await page.waitForSelector('#upload-text');
  await page.fill('#upload-text', 'Иванова Мария. Повар. Опыт: горячий цех, 2019 — сейчас, ресторан «Демо». Навыки: карты, санитарные нормы.');
  await page.click('button:has-text("Разобрать резюме")');
  await page.waitForSelector('text=Разбор вашего резюме', { timeout: 15000 });
  ok('Разбор вставленного резюме выполнен сервером', await page.locator('text=Разбор вашего резюме').isVisible());
  await page.click('button:has-text("Сохранить как версию резюме")');
  await page.waitForSelector('text=Добавление вакансии');
  ok('Разобранное резюме доступно для подготовки',
    (await page.locator('#vac-resume option').count()) >= 3);

  /* ---- Устаревание через сервер ---- */
  await page.goto(base + '/#/resumes');
  await page.click('.row-item >> nth=1 >> button:has-text("Открыть")');
  await page.waitForSelector('text=Действия');
  await page.click('button:has-text("Внести демонстрационную правку")');
  await page.waitForTimeout(600);
  await page.reload();
  await page.goto(base + '/#/overview');
  await page.waitForSelector('.topbar');
  ok('Сервер пометил подготовку устаревшей после правки резюме',
    (await page.locator('#main').innerText()).indexOf('предыдущей версии') >= 0);
  await page.click('button:has-text("Пересобрать демо")');
  await page.waitForFunction(function () {
    return !document.body.innerText.includes('предыдущей версии');
  }, null, { timeout: 15000 });
  ok('Пересборка через сервер снимает отметку', true);

  /* ---- Черновик политики данных ---- */
  await page.goto(base + '/#/privacy');
  await page.waitForSelector('text=Обработка данных');
  const privacyText = await page.locator('#main').innerText();
  ok('Страница политики называет сервис модели и регион', privacyText.indexOf('Заглушка без сети') >= 0);
  ok('Политика помечена как черновик', privacyText.indexOf('черновик') >= 0);
  await page.goto(base + '/#/vacancy/new');
  await page.waitForSelector('#vac-title');
  ok('На форме отправки есть уведомление со ссылкой на политику',
    await page.locator('a[href="#/privacy"]').first().isVisible());

  await page.goto(base + '/#/settings');
  await page.waitForSelector('text=Мои данные');
  ok('В настройках есть удаление своих данных с сервера',
    await page.locator('button:has-text("Удалить все мои данные с сервера")').isVisible());

  ok('Нет сторонних запросов', external.length === 0, external.join(', '));
  ok('Нет ошибок в консоли', errors.length === 0, errors.join(' | '));
  ok('Страница отдана с политикой безопасности содержимого',
    /frame-ancestors 'none'/.test((await (await fetch(base + '/')).headers.get('content-security-policy')) || ''));

  await browser.close();
  server.close();
  const failed = results.filter(function (r) { return !r.pass; });
  console.log('\nИтого: ' + (results.length - failed.length) + ' из ' + results.length + ' проверок пройдено.');
  process.exit(failed.length ? 1 : 0);

  async function cookieHeader(context) {
    return (await context.cookies()).map(function (c) { return c.name + '=' + c.value; }).join('; ');
  }
})().catch(function (e) { console.error('ОШИБКА ТЕСТА:', e.stack || e.message); process.exit(2); });
