/* Real HTTP auth + guided UI, including mobile, keyboard and reduced motion. */
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
Object.assign(process.env, { NODE_ENV: 'test', HOST: '127.0.0.1', DEMO_AUTH: '0', AI_PROVIDER: 'mock',
  SESSION_SECRET: 'quickstart-browser', ADMIN_TOKEN: '', LOG_LEVEL: 'error' });
const { createApp } = require('../server/index.js');
(async () => {
  const { server } = createApp({ dbFile: ':memory:', secure: false, retention: false, freePrepsPerDay: 100,
    rateLimit: { authPerMinute: 100, perMinute: 1000, expensivePerMinute: 1000 } });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch();
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const width of [1440, 390, 360]) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce', hasTouch: width < 900 });
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      async function step(n) {
        await page.waitForFunction(n => document.querySelector('.quickstart')?.textContent.includes('Шаг ' + n + ' из 8'), n);
        assert.equal(await page.locator('.quickstart .btn--primary').count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'overflow ' + width);
        assert.equal(await page.locator('.quickstart button, .quickstart a, .quickstart input, .quickstart textarea, .quickstart select, .quickstart summary').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).every(n => {
          const r = n.getBoundingClientRect(); return r.width >= 44 && r.height >= 44;
        })), true, 'touch targets ' + width);
        assert.equal(await page.locator('.quickstart *').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).animationName === 'none')), true);
      }
      async function next() {
        await page.locator('.quickstart [data-act="qs:continue"]').click();
      }
      async function done(n) {
        await page.waitForFunction(n => {
          const s = JSON.parse(localStorage.getItem('easyjob:quickstart:v1:' + Api.live.user.id));
          return s.completed.includes(n);
        }, n);
      }
      async function logout() {
        if (width < 900) await page.getByRole('button', { name: 'Открыть меню' }).click();
        await page.getByRole('button', { name: 'Выйти из аккаунта' }).click();
        await page.waitForSelector('#auth-form');
      }
      await page.goto(base + '/#/quickstart'); await page.waitForSelector('#auth-form');
      await page.goto(base + '/#/auth/register');
      await page.getByLabel('Имя пользователя').fill('guided-' + width);
      await page.getByLabel('Пароль', { exact: true }).fill('PRIVATE-password');
      await page.getByRole('button', { name: 'Зарегистрироваться' }).click(); await step(1);
      await page.locator('.quickstart [data-act="qs:continue"]').focus();
      await page.keyboard.press('Enter'); await step(2);
      assert.equal(await page.locator('#qs-title').evaluate(n => document.activeElement === n), true);
      await page.getByLabel('Название резюме', { exact: true }).fill('PRIVATE resume');
      await page.getByLabel('Текст резюме', { exact: true }).fill('PRIVATE-RESUME Повар, пять лет опыта в горячем цехе, технологические карты, санитарные нормы.');
      await page.getByRole('button', { name: 'Сохранить резюме', exact: true }).click(); await done(1); await next(); await step(3);
      await page.route('**/api/resumes/*/review', route => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"Тестовая ошибка AI"}' }));
      await page.getByRole('button', { name: 'Проверить резюме с AI' }).click();
      await page.waitForFunction(() => document.querySelector('#qs-error').textContent.includes('Тестовая ошибка'));
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('easyjob:quickstart:v1:' + Api.live.user.id)).completed.includes(2)), false);
      await page.unroute('**/api/resumes/*/review');
      await page.getByRole('button', { name: 'Повторить: Проверить резюме с AI' }).click(); await done(2); await next(); await step(4);
      await page.getByLabel('Должность', { exact: true }).fill('Повар');
      await page.getByLabel('Текст вакансии', { exact: true }).fill('PRIVATE-VACANCY Требуется повар, горячий цех, технологические карты, опыт от двух лет, санитарные нормы.');
      await page.getByRole('button', { name: 'Сохранить и выделить требования' }).click(); await done(3); await next(); await step(5);
      await page.getByRole('button', { name: 'Создать подготовку', exact: true }).click(); await done(4); await next(); await step(6);
      await page.getByRole('button', { name: 'Сгенерировать вопросы' }).click(); await done(5);
      await page.getByLabel('Ваш ответ (необязательно)').fill('PRIVATE-ANSWER Я работал пять лет в горячем цехе.');
      await page.getByRole('button', { name: 'Сохранить ответ', exact: true }).click();
      await page.getByText('Ответ сохранён на сервере.', { exact: true }).waitFor(); await next(); await step(7);
      await page.getByRole('button', { name: 'Открыть текстовую тренировку' }).click();
      await page.locator('[data-act="chat:start"]').click();
      await page.waitForSelector('#chat-log'); await done(6);
      await page.goto(base + '/#/quickstart'); await step(7); await next(); await step(8); await next();
      await page.waitForSelector('.dashboard-intro');
      await page.goto(base + '/#/quickstart');
      await page.locator('.quickstart [data-act="qs:restart"]').click(); await step(1);
      await page.locator('.quickstart [data-act="qs:skip"]').click(); await step(2);
      await page.locator('.quickstart [data-act="qs:back"]').click(); await step(1);
      await page.locator('.quickstart [data-act="qs:later"]').click(); await page.waitForSelector('.dashboard-intro');
      await page.goto(base + '/#/quickstart'); await step(1);
      if (width < 900) await page.getByRole('button', { name: 'Открыть меню' }).click();
      await page.locator('.sidebar a[href="#/settings"]').click();
      assert.equal(new URL(page.url()).hash, '#/settings');
      await logout();
      await page.getByLabel('Имя пользователя').fill('guided-' + width);
      await page.getByLabel('Пароль', { exact: true }).fill('PRIVATE-password');
      await page.getByRole('button', { name: 'Войти', exact: true }).click(); await page.waitForSelector('.dashboard-intro');
      await page.goto(base + '/#/quickstart'); await step(1);
      assert.equal(await page.locator('.qs-steps').innerText().then(t => (t.match(/Готово/g) || []).length), 6);
      await logout(); await page.goto(base + '/#/auth/register');
      await page.getByLabel('Имя пользователя').fill('other-' + width);
      await page.getByLabel('Пароль', { exact: true }).fill('OTHER-password');
      await page.getByRole('button', { name: 'Зарегистрироваться' }).click(); await step(1);
      assert.equal(await page.locator('.qs-steps').innerText().then(t => t.includes('Готово')), false);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('PRIVATE')), false);
      assert.deepEqual(errors, []); await ctx.close();
      console.log('PASS guided real HTTP actions, reload/existing data, account isolation, keyboard, reduced motion and ' + width + 'px layout');
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
