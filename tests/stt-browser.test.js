'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const FILE = 'file://' + path.resolve(__dirname, '../index.html');
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(FILE);
      await page.evaluate(() => {
        window.__sent = []; window.__storageWrites = 0; window.__tracks = [];
        Storage.prototype.setItem = () => { window.__storageWrites++; throw new Error('No persistence allowed'); };
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async options => {
          window.__constraints = options;
          const stream = await original(options); window.__tracks.push(...stream.getTracks()); return stream;
        };
        // Exercise the same widget without depending on demo setup/navigation.
        document.body.innerHTML = '<main></main>';
        window.__widget = SttWidget({ onSend: async text => { window.__sent.push(text); } });
        document.querySelector('main').appendChild(window.__widget.element);
      });
      assert(await page.locator('[data-stt="start"]').isDisabled());
      assert.equal(await page.evaluate(() => window.__tracks.length), 0);
      await page.check('[data-stt="consent"]'); await page.click('[data-stt="start"]');
      assert.match(await page.locator('[data-stt="state"]').innerText(), /recording.*Демо/);
      await page.click('[data-stt="stop"]');
      await page.waitForFunction(() => document.querySelector('[data-stt="state"]').textContent.startsWith('ready'));
      assert.equal(await page.evaluate(() => window.__tracks.length), 0);
      await page.fill('[data-stt="text"]', 'Проверенный текст'); await page.click('[data-stt="send"]');
      assert.deepEqual(await page.evaluate(() => window.__sent), ['Проверенный текст']);
      await page.click('[data-stt="cancel"]');
      assert.equal(await page.inputValue('[data-stt="text"]'), '');
      await page.selectOption('[data-stt="provider"]', 'whisper_cpp');
      let uploads = 0;
      await page.route('http://127.0.0.1:8080/inference', async route => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-allow-private-network': 'true' } }); return;
        }
        uploads++;
        assert(route.request().postDataBuffer().includes(Buffer.from('RIFF')));
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ text: 'Синтетическая HTTP-фикстура, не распознанная речь.' }) });
      });
      await page.check('[data-stt="consent"]'); await page.click('[data-stt="start"]');
      await page.waitForFunction(() => document.querySelector('[data-stt="state"]').textContent.startsWith('recording'));
      await page.waitForTimeout(400); await page.click('[data-stt="stop"]');
      await page.waitForFunction(() => document.querySelector('[data-stt="state"]').textContent.startsWith('ready'));
      assert.equal(uploads, 1);
      assert(await page.evaluate(() => window.__tracks.every(t => t.readyState === 'ended')));
      assert.deepEqual(await page.evaluate(() => window.__constraints), { audio: true, video: false });
      assert.match(await page.inputValue('[data-stt="text"]'), /Синтетическая/);
      // Disposal during capture releases microphone; no hidden continuation.
      await page.click('[data-stt="start"]');
      await page.waitForFunction(() => document.querySelector('[data-stt="state"]').textContent.startsWith('recording'));
      await page.evaluate(() => window.__widget.dispose());
      assert(await page.evaluate(() => window.__tracks.every(t => t.readyState === 'ended')));
      assert.equal(await page.evaluate(() => window.__storageWrites), 0);
      // Denial remains visible and retryable.
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('private@example.com', 'NotAllowedError'); };
        window.__widget = SttWidget({ config: { provider: 'whisper_cpp' }, onSend: async () => {} });
        document.querySelector('main').appendChild(window.__widget.element);
      });
      await page.check('[data-stt="consent"]'); await page.click('[data-stt="start"]');
      await page.waitForFunction(() => document.querySelector('[data-stt="state"]').textContent.startsWith('error'));
      assert(!(await page.locator('[data-stt="state"]').innerText()).includes('private@example.com'));
      assert(await page.locator('[data-stt="start"]').isEnabled());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      assert.deepEqual(errors, []);
      await page.close(); console.log('PASS STT controls, synthetic capture, denial, cleanup and no storage: ' + viewport.width + 'px');
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
