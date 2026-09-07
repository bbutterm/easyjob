'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createApp } = require('../server/index.js');

Object.assign(process.env, { NODE_ENV: 'test', HOST: '127.0.0.1', DEMO_AUTH: '1', AI_PROVIDER: 'mock',
  SESSION_SECRET: 'auth-browser-tests', ADMIN_TOKEN: '', LOG_LEVEL: 'error' });

(async function () {
  const { server } = createApp({ dbFile: ':memory:', secure: false, retention: false, rateLimit: { authPerMinute: 100 } });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch();
    const errors = [];
    for (const width of [1440, 390, 360]) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 900 });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      async function layout() {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, width + 'px overflow');
        assert.equal(await page.locator('input, .btn').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).every(n => {
          const r = n.getBoundingClientRect(); return r.height >= 44 && r.width >= 44;
        })), true, width + 'px touch targets');
      }
      await page.goto(base + '/#/start');
      await page.waitForSelector('.source-story');
      await layout();
      // Inspect animation definitions and stage order; no sleep or transient opacity assertions.
      assert.equal(await page.locator('[data-reveal]').evaluateAll(nodes => nodes.length >= 4 &&
        nodes.every(n => getComputedStyle(n).animationName === 'easyjob-enter')), true);
      if (process.env.SCREENSHOTS === '1') await page.screenshot({ path: '/tmp/easyjob-start-' + width + '.png', fullPage: true, animations: 'disabled' });
      await page.getByRole('link', { name: 'Войти', exact: false }).first().click();
      await page.waitForSelector('#auth-form');
      await layout();
      await page.getByLabel('Имя пользователя').fill('admin');
      await page.getByLabel('Пароль', { exact: true }).fill('wrong');
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('auth-error').textContent.includes('Неверное'));
      assert.equal(await page.locator('#auth-password').evaluate(n => n === document.activeElement), true);
      await page.getByLabel('Пароль', { exact: true }).fill('admin');
      // A full-root notification must preserve the form's DOM-only draft and focus.
      await page.evaluate(() => Store.notify());
      assert.equal(await page.inputValue('#auth-password'), 'admin');
      assert.equal(await page.locator('#auth-password').evaluate(n => n === document.activeElement), true);
      await page.keyboard.press('Enter');
      await page.waitForSelector('.quickstart');
      await page.getByRole('button', { name: 'Продолжить позже', exact: true }).click();
      await page.waitForSelector('.dashboard-intro');
      assert.equal((await (await ctx.request.get(base + '/api/me')).json()).user.username, 'admin');
      await layout();
      await page.reload();
      await page.waitForSelector('.dashboard-intro');
      assert.equal(await page.locator('.account-label').innerText(), 'admin');
      if (process.env.SCREENSHOTS === '1') await page.screenshot({ path: '/tmp/easyjob-dashboard-' + width + '.png', fullPage: true, animations: 'disabled' });
      await page.goto(base + '/#/admin');
      await page.waitForSelector('.usage-table');
      await page.selectOption('#usage-days', '7');
      await page.waitForFunction(() => !document.querySelector('#usage-days').disabled);
      assert.equal(await page.locator('.usage-table').count(), 8);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await layout();
      if (width < 900) {
        await page.getByRole('button', { name: 'Открыть меню' }).click();
        await layout();
        assert.equal(await page.locator('.sidebar').evaluate(n => getComputedStyle(n).position), 'static');
      }
      await page.getByRole('button', { name: 'Выйти из аккаунта' }).click();
      await page.waitForSelector('#auth-form');
      assert.equal((await (await ctx.request.get(base + '/api/me')).json()).user, null);
      await page.getByRole('link', { name: 'Создать аккаунт', exact: true }).click();
      await page.waitForSelector('[data-auth-mode="register"]');
      await layout();
      await page.getByLabel('Имя пользователя').fill('browser-' + width);
      await page.getByLabel('Пароль', { exact: true }).fill('browser-password');
      await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
      await page.waitForSelector('.quickstart');
      assert.equal((await (await ctx.request.get(base + '/api/me')).json()).user.username, 'browser-' + width);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('browser-password')), false);
      assert.equal(await page.locator('a[href="#/admin"]').count(), 0);
      assert.equal((await ctx.request.get(base + '/api/admin/usage')).status(), 403);
      await page.goto(base + '/#/admin');
      await page.getByRole('heading', { name: 'Доступ запрещён' }).waitFor();
      assert.equal(await page.locator('.usage-table').count(), 0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(base + '/#/start');
      await page.waitForSelector('.hero-copy');
      assert.equal(await page.locator('[data-reveal]').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).animationName === 'none')), true);
      await ctx.close();
      console.log('PASS auth, keyboard/drafts, dashboard, motion/reduced motion and usable layout at ' + width + 'px');
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
