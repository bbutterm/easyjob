/* Сквозная проверка режима сервера: настоящий браузер против настоящего
   сервера на провайдере-заглушке. Запуск: node tests/live.test.js */

'use strict';

const { chromium } = require('playwright');
const http = require('node:http');
const { createApp } = require('../server/index.js');

process.env.AI_PROVIDER = 'mock';
process.env.CONTEXT_MEMORY = '1';
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
  const { server } = createApp({ dbFile: ':memory:', freePrepsPerDay: 10, secure: false, rateLimit: { perMinute: 1000, expensivePerMinute: 100 } });
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

  /* ---- Импорт вакансии по ссылке: локальная «страница вакансии» ---- */
  const jobSite = http.createServer(function (req, res) {
    if (req.url === '/blocked') { res.writeHead(403, { 'content-type': 'text/html' }); return res.end('<html>captcha</html>'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><head><title>Повар</title><script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org',
      '@type': 'JobPosting', title: 'Повар горячего цеха', hiringOrganization: { '@type': 'Organization', name: 'Ресторан «Север»' },
      description: '<p>Готовить по технологическим картам.</p><ul><li>Опыт на горячем цехе от 2 лет</li><li>Действующая медицинская книжка</li></ul>' })
      + '</script></head><body><main><h1>Повар</h1></main></body></html>');
  });
  await new Promise(function (r) { jobSite.listen(0, '127.0.0.1', r); });
  const jobHost = '127.0.0.1:' + jobSite.address().port;
  process.env.URL_IMPORT_ALLOW_HOSTS = jobHost;
  await page.fill('#vac-url', 'http://' + jobHost + '/blocked');
  await page.click('button:has-text("Импортировать по ссылке")');
  await page.waitForSelector('#vac-import-error', { timeout: 15000 });
  ok('Импорт: отказ сайта показан честно, без подмены примером',
    /не разрешил автоматическое чтение/.test(await page.locator('#vac-import-error').innerText()) && (await page.inputValue('#vac-text')) === '');
  await page.fill('#vac-url', 'http://' + jobHost + '/vacancy/1');
  await page.click('button:has-text("Импортировать по ссылке")');
  await page.waitForSelector('#vac-import-ok', { timeout: 15000 });
  ok('Импорт: заголовок, компания и текст подставлены для проверки перед разбором',
    (await page.inputValue('#vac-title')) === 'Повар горячего цеха' && (await page.inputValue('#vac-company')) === 'Ресторан «Север»'
    && /медицинская книжка/.test(await page.inputValue('#vac-text')) && /структурированные данные/.test(await page.locator('#vac-import-ok').innerText()));
  ok('Импорт: ошибка прошлой попытки убрана', (await page.locator('#vac-import-error').count()) === 0);
  jobSite.close();

  /* ---- Вакансия → подготовка с сопоставлением от сервера ---- */
  await page.fill('#vac-title', 'Повар');
  await page.fill('#vac-company', 'Демо-Ресторан');
  await page.fill('#vac-text', VACANCY_TEXT);
  await page.click('button:has-text("Создать подготовку")');
  await page.waitForSelector('text=Сопоставление резюме с вакансией', { timeout: 15000 });
  const matchText = await page.locator('#main').innerText();
  ok('Требования взяты из вставленного текста', matchText.indexOf('медицинская книжка') >= 0);
  ok('Сопоставление подписано источником: заглушка модели, этап подготовки',
    /Источник: заглушка модели · mock · pre_interview/.test(await page.locator('.model-source').first().innerText()));
  /* Источник импортированной вакансии сохранён вместе с ней (адрес локальной страницы). */
  const vacanciesOnServer = await (await fetch(base + '/api/vacancies', { headers: { cookie: await cookieHeader(ctx) } })).json();
  ok('Вакансия хранит адрес источника и способ получения', vacanciesOnServer.length === 1
    && vacanciesOnServer[0].sourceUrl === 'http://' + jobHost + '/vacancy/1' && vacanciesOnServer[0].source === 'jsonld');
  delete process.env.URL_IMPORT_ALLOW_HOSTS;
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

  /* ---- Обратная связь на ответ ---- */
  await page.click('.q-item >> nth=0 >> button:has-text("Получить обратную связь")');
  await page.waitForSelector('.q-item >> nth=0 >> .q-feedback__result', { timeout: 20000 });
  const fbText = await page.locator('.q-item >> nth=0 >> .q-feedback__result').innerText();
  ok('Обратная связь получена с сервера и подписана источником', /Сильно/.test(fbText) && /Заглушка модели/.test(fbText) && /без баллов/.test(fbText));
  await page.fill('.q-item >> nth=0 >> textarea', 'Отвечал за горячий цех в смену на сорок столов. Добавлю деталь.');
  await page.waitForSelector('.q-item >> nth=0 >> .q-feedback__result:has-text("Ответ изменился")');
  ok('Изменённый ответ помечает обратную связь устаревшей', true);
  await page.reload();
  await page.waitForSelector('.q-item', { timeout: 15000 });
  ok('Обратная связь переживает перезагрузку', (await page.locator('.q-item >> nth=0 >> .q-feedback__result').count()) === 1);

  /* ---- Интервью потоком ---- */
  await page.click('button:has-text("Начать пробное интервью")');
  await page.waitForSelector('button:has-text("Начать интервью")');
  await page.click('button:has-text("Начать интервью")');
  await page.waitForSelector('#chat-input', { timeout: 15000 });
  const firstBot = await page.locator('.msg:not(.msg--user):not(.msg--sys) .msg__body').first().innerText();
  ok('Первый вопрос интервьюера пришёл с сервера', firstBot.length > 10, firstBot.slice(0, 50));
  const turnBodies = [];
  page.on('request', function (req) {
    if (/\/api\/interviews\/[^/]+\/turns$/.test(req.url()) && req.method() === 'POST') {
      try { turnBodies.push(JSON.parse(req.postData() || '{}')); } catch (e) { turnBodies.push({}); }
    }
  });
  await page.fill('#chat-input', 'Отвечал за горячий цех.');
  await page.click('button:has-text("Отправить ответ")');
  await page.waitForFunction(function () {
    return document.querySelectorAll('.msg:not(.msg--sys)').length >= 3;
  }, null, { timeout: 15000 });
  ok('Ответ ушёл и интервьюер продолжил', (await page.locator('.msg--user').count()) === 1);
  await page.check('[data-stt="consent"]');
  await page.click('[data-stt="start"]');
  await page.click('[data-stt="stop"]');
  await page.waitForFunction(() => document.querySelector('[data-stt="state"]').textContent.startsWith('ready'));
  const transcript = await page.inputValue('[data-stt="text"]');
  await page.click('[data-stt="send"]');
  await page.waitForFunction(() => document.querySelectorAll('.msg--user').length === 2);
  await page.waitForFunction(() => document.querySelector('[data-stt="feedback"]').textContent.includes('передан'));
  ok('STT-заглушка → обычный API turns → interview.turn → ответ интервьюера',
    (await page.locator('.msg--user').last().innerText()).includes(transcript));
  ok('Реплика уходит с clientTurnId для идемпотентного повтора',
    turnBodies.length >= 1 && /^t[a-z0-9]{8,}$/.test(turnBodies[0].clientTurnId || ''), JSON.stringify(turnBodies[0]));
  ok('До порога сжатия строки о памяти нет', (await page.locator('.chat-memory').count()) === 0);
  /* Ещё ответы — до порога сжатия: память появляется в интерфейсе. */
  const moreAnswers = ['Работал по технологическим картам.', 'Медкнижки сейчас нет.', 'Меню разрабатывал дважды в год.'];
  const usersBefore = await page.locator('.msg--user').count();
  for (let i = 0; i < moreAnswers.length; i++) {
    await page.fill('#chat-input', moreAnswers[i]);
    await page.click('button:has-text("Отправить ответ")');
    await page.waitForFunction(function (n) {
      return document.querySelectorAll('.msg--user').length === n && !document.querySelector('.dots');
    }, usersBefore + i + 1, { timeout: 15000 });
  }
  const memoryLine = await page.locator('.chat-memory').innerText();
  ok('После сжатия интерфейс показывает версию памяти и покрытие', /Память интервью: версия 1, покрыты реплики до № \d+/.test(memoryLine), memoryLine);
  const ids = turnBodies.map(function (b) { return b.clientTurnId; }).filter(Boolean);
  ok('Все реплики ушли с разными clientTurnId', ids.length >= 4 && new Set(ids).size === ids.length);
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
  await page.click('button:has-text("Собрать карточку с помощью модели")');
  await page.waitForSelector('.card-model h3', { timeout: 20000 });
  const modelCard = await page.locator('.card-model').innerText();
  ok('Карточка от модели собрана сервером и подписана источником', /Вступление/.test(modelCard) && /Источник: заглушка модели/.test(modelCard));
  await page.reload();
  await page.waitForSelector('.card-model h3', { timeout: 15000 });
  ok('Карточка от модели переживает перезагрузку', (await page.locator('.card-model h3').count()) >= 1);

  /* ---- Помощник через сервер ---- */
  await page.goto(base + '/#/assistant');
  await page.waitForSelector('#main');
  if (await page.locator('button[data-act="plan:set"]').count()) await page.click('button[data-act="plan:set"]');
  await page.waitForSelector('#asst-text', { timeout: 15000 });
  ok('Помощник: кнопки выключены без согласия', await page.locator('button[data-act="assistant:extract"]').isDisabled());
  await page.check('#asst-consent');
  await page.fill('#asst-text', 'Итак. Расскажите про самую сложную задачу в вашей работе.');
  await page.click('button[data-act="assistant:extract"]');
  await page.waitForFunction(function () { return document.querySelector('#asst-question').value.length > 5; }, null, { timeout: 15000 });
  ok('Помощник: вопрос выделен сервером', /задач/.test(await page.inputValue('#asst-question')));
  await page.click('button[data-act="assistant:hint"]');
  await page.waitForSelector('.asst-hint', { timeout: 15000 });
  const hintText = await page.locator('.asst-hint').innerText();
  ok('Помощник: подсказка показана с подписью заглушки и этапа', /Направление ответа/.test(hintText) && /Заглушка модели/.test(hintText) && /live_interview/.test(hintText));

  /* ---- Разбор вставленного резюме ---- */
  await page.goto(base + '/#/resume/upload');
  await page.waitForSelector('#upload-text');
  await page.fill('#upload-text', 'Иванова Мария. Повар. Опыт: горячий цех, 2019 — сейчас, ресторан «Демо». Навыки: карты, санитарные нормы.');
  await page.click('button:has-text("Разобрать резюме")');
  await page.waitForSelector('text=Разбор вашего резюме', { timeout: 15000 });
  ok('Разбор вставленного резюме выполнен сервером', await page.locator('text=Разбор вашего резюме').isVisible());
  await page.click('button[data-act="upload:save"]');
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
