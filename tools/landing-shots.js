const http = require('http'); const fs = require('fs');
process.chdir('/home/user/easyjob');
process.env.AI_PROVIDER = 'mock'; process.env.SESSION_SECRET = 'shots'; process.env.LOG_LEVEL = 'error'; process.env.HH_MODE = 'api';
const { chromium } = require('playwright');
const { createApp } = require('/home/user/easyjob/server/index.js');
const OUT = '/home/user/easyjob/docs/screenshots/landing/';
const HIDE = '.toasts, .demo-panel, .note--demo, .note--alert, .note--info, .demo-badge { display: none !important; }';
async function clipMain(page, name, h) {
  const box = await page.locator('#main').boundingBox();
  await page.screenshot({ path: OUT + name + '.png', clip: { x: box.x, y: Math.max(0, box.y), width: box.width, height: Math.min(h || 720, 800 - Math.max(0, box.y)) } });
  console.log('shot', name);
}
(async () => {
  const browser = await chromium.launch();
  /* ---- Демо-режим: наполненные экраны ---- */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
  await ctx.addInitScript(() => { try { localStorage.setItem('career-helper-prototype-prefs', JSON.stringify({ theme: 'light', scenario: 'filled', plan: 'assistant', demoPanelOpen: false, professionId: 'chef' })); } catch (e) {} });
  const page = await ctx.newPage();
  async function open(hash) { await page.goto('file:///home/user/easyjob/index.html' + hash); await page.waitForSelector('.topbar'); await page.addStyleTag({ content: HIDE }); await page.waitForTimeout(300); }
  await open('#/overview'); await page.screenshot({ path: OUT + 'hero.png' }); console.log('shot hero');
  await open('#/prep/prep-1/match');
  await page.locator('#main').evaluate(el => { const h = el.querySelector('h2'); });
  await page.evaluate(() => { const c = [...document.querySelectorAll('#main .card')].find(c => /Требования вакансии/.test(c.textContent)); if (c) c.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(200);
  const reqCard = page.locator('#main .card').filter({ hasText: 'Требования вакансии' }).first();
  await reqCard.screenshot({ path: OUT + 'match.png' }); console.log('shot match');
  await open('#/prep/prep-1/questions');
  const ta = page.locator('#main textarea').first();
  await ta.fill('Горячий цех в ресторане на 120 посадочных мест, поток до 140 столов за вечернюю смену. Отвечал за заготовки, соусы и выдачу по технологическим картам.');
  const guide = page.locator('button:has-text("Показать ориентиры")').first(); if (await guide.count()) await guide.click();
  await page.waitForTimeout(200);
  const qCard = page.locator('#main .q-item').first();
  await qCard.screenshot({ path: OUT + 'questions.png' }); console.log('shot questions');
  await open('#/prep/prep-1/interview');
  await page.click('button:has-text("Начать интервью")'); await page.waitForTimeout(900);
  const chatIn = page.locator('#main textarea, #main input[type="text"]').last();
  if (await chatIn.count()) { await chatIn.fill('Работал на горячем цехе четыре года, вёл заготовки и соусы, обучал двух стажёров.'); const send = page.locator('button:has-text("Отправить ответ")').first(); if (await send.count()) await send.click(); await page.waitForTimeout(1800); }
  await page.addStyleTag({ content: HIDE });
  await page.locator('#chat-log').screenshot({ path: OUT + 'interview.png' });
  console.log('shot interview');
  await open('#/prep/prep-1/voice');
  await page.click('button:has-text("Начать разговор")'); await page.waitForTimeout(3500);
  await page.addStyleTag({ content: HIDE });
  const voiceCard = page.locator('#main .card').first();
  await voiceCard.screenshot({ path: OUT + 'voice.png' }); console.log('shot voice');
  await open('#/assistant');
  const ex = page.locator('button:has-text("Посмотреть пример подсказок")'); if (await ex.count()) await ex.click();
  await page.waitForTimeout(300);
  const hintCard = page.locator('#main .card').filter({ hasText: /Заранее подготовленные реплики/ }).first();
  if (await hintCard.count()) { await hintCard.scrollIntoViewIfNeeded(); await hintCard.screenshot({ path: OUT + 'assistant.png' }); console.log('shot assistant'); }
  await ctx.close();

  /* ---- Режим сервера: импорт и поиск на поддельном hh ---- */
  const fx = JSON.parse(fs.readFileSync('/home/user/easyjob/tests/fixtures/hh-api.json', 'utf8'));
  const hh = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); res.setHeader('content-type', 'application/json');
    if (u.pathname === '/vacancies/123456') return res.end(JSON.stringify(fx.vacancy));
    if (u.pathname === '/vacancies') return res.end(JSON.stringify(fx.search));
    if (u.pathname === '/suggests/areas') return res.end(JSON.stringify(fx.areas));
    res.statusCode = 404; res.end('{}'); });
  await new Promise(r => hh.listen(0, '127.0.0.1', r)); process.env.HH_API_BASE = 'http://127.0.0.1:' + hh.address().port;
  const { server } = createApp({ dbFile: ':memory:', freePrepsPerDay: 10, secure: false, rateLimit: { perMinute: 1000, expensivePerMinute: 100 } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
  const p2 = await ctx2.newPage();
  await p2.goto(base + '/#/resume/new'); await p2.waitForSelector('#b-profession');
  await p2.fill('#b-profession', 'Повар'); await p2.fill('#b-summary', 'Повар горячего цеха, пять лет в ресторанах полного цикла.');
  await p2.click('button:has-text("Далее")'); await p2.click('button:has-text("Добавить место работы")');
  await p2.fill('#exp-role-0', 'Повар горячего цеха'); await p2.fill('#exp-company-0', 'Ресторан «Север»'); await p2.fill('#exp-details-0', 'Вёл горячий цех, заготовки, соусы. Работа по технологическим картам.');
  await p2.click('button:has-text("Далее")'); await p2.fill('#b-skills', 'Горячий цех\nТехнологические карты\nХАССП');
  await p2.click('button:has-text("Далее")'); await p2.click('button:has-text("Далее")'); await p2.click('button:has-text("Собрать резюме")');
  await p2.waitForSelector('text=Резюме собрано'); await p2.click('button:has-text("Сохранить и использовать для подготовки")'); await p2.waitForSelector('#vac-url');
  await p2.fill('#vac-url', 'https://spb.hh.ru/vacancy/123456'); await p2.click('button:has-text("Импортировать по ссылке")'); await p2.waitForSelector('#vac-import-ok', { timeout: 20000 });
  await p2.addStyleTag({ content: '.toasts, .demo-panel { display:none !important }' }); await p2.waitForTimeout(200);
  await p2.locator('#main .card').first().screenshot({ path: OUT + 'import.png' }); console.log('shot import');
  await p2.goto(base + '/#/jobs'); await p2.waitForSelector('#jobs-resume'); await p2.selectOption('#jobs-resume', { index: 1 }); await p2.waitForSelector('#jobs-results', { timeout: 20000 });
  await p2.addStyleTag({ content: '.toasts, .demo-panel { display:none !important }' }); await p2.waitForTimeout(200);
  await p2.locator('#jobs-results').screenshot({ path: OUT + 'jobs.png' }); console.log('shot jobs');
  await browser.close(); server.close(); hh.close();
})().catch(e => { console.error(e); process.exit(1); });
