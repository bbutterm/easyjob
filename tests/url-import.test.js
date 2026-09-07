/* Импорт вакансии по ссылке: границы SSRF, переходы, пределы, разбор HTML.
   Сеть не используется: «сайт» — локальный HTTP-сервер, к которому
   импортёр подключается через подменённый lookup (имя «job.test»
   разрешается в публичный адрес для проверки, соединение идёт на 127.0.0.1).
   Запуск: node --no-warnings tests/url-import.test.js */

'use strict';

const http = require('node:http');
const zlib = require('node:zlib');
const U = require('../server/lib/url-import.js');

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
}
async function rejects(promise, code) {
  try { await promise; return { rejected: false }; } catch (e) { return { rejected: true, code: e.extra && e.extra.code, status: e.status, message: e.message }; }
}

/* ---- Адреса без сети ---- */
['127.0.0.1', '10.1.2.3', '172.16.5.5', '172.31.255.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
  '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', '::ffff:7f00:1']
  .forEach(function (ip) { ok('Частный адрес отклоняется: ' + ip, U.isPrivateIp(ip)); });
['93.184.216.34', '8.8.8.8', '2606:4700::6810:84e5', '::ffff:93.184.216.34'].forEach(function (ip) {
  ok('Публичный адрес принимается: ' + ip, !U.isPrivateIp(ip));
});
ok('Мусор вместо адреса считается частным', U.isPrivateIp('not-an-ip') && U.isPrivateIp('999.1.1.1'));

const badUrls = ['ftp://example.com/x', 'file:///etc/passwd', 'http://user:pw@example.com/', 'http://localhost/', 'http://LOCALHOST:80/',
  'http://127.0.0.1/', 'http://[::1]/', 'http://10.0.0.1/job', 'http://example.com:8080/', 'http://intranet/', 'http://box.local/',
  'http://svc.internal/', 'http://169.254.169.254/latest/meta-data', 'javascript:alert(1)', '', 'not a url', 'http://' + 'a'.repeat(2100) + '.com/'];
badUrls.forEach(function (u) {
  let code = null;
  try { U.validateUrl(u); } catch (e) { code = e.extra && e.extra.code; }
  ok('Ссылка отклоняется до сети: ' + (u.length > 60 ? u.slice(0, 60) + '…' : JSON.stringify(u)), code === 'private_url');
});
ok('Обычная публичная ссылка проходит проверку', U.validateUrl('https://example.com/vacancy/1?x=1#frag').url.href === 'https://example.com/vacancy/1?x=1');
ok('Явный список хостов разрешает нестандартный порт только ему',
  U.validateUrl('http://127.0.0.1:8081/', { URL_IMPORT_ALLOW_HOSTS: '127.0.0.1:8081' }).allowed === true
  && (function () { try { U.validateUrl('http://127.0.0.1:8082/', { URL_IMPORT_ALLOW_HOSTS: '127.0.0.1:8081' }); return false; } catch (e) { return true; } })());
ok('Токены в адресе вырезаются', U.redactUrl('https://hh.ru/vacancy/1?token=abc&utm_source=x&page=2#h') === 'https://hh.ru/vacancy/1?page=2');

/* ---- Разбор HTML без сети ---- */
const JSONLD = '<html><head><title>Повар — Север | Работа</title><meta property="og:site_name" content="Работа"/>'
  + '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, {
    '@type': 'JobPosting', title: 'Повар горячего цеха', hiringOrganization: { '@type': 'Organization', name: 'Ресторан «Север»' },
    description: '<p>Готовить по технологическим картам.</p><ul><li>Опыт от 2 лет</li><li>Медкнижка</li></ul>',
    qualifications: 'Опыт на горячем цехе', jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Санкт-Петербург' } } }] })
  + '</script></head><body><nav>Главная Вакансии</nav><main><h1>Повар</h1><p>Текст</p></main><footer>© 2026</footer></body></html>';
const j = U.extract(JSONLD, new URL('https://jobs.example.com/v/1?token=zzz'));
ok('JSON-LD JobPosting: заголовок, компания, описание без тегов, требования',
  j.source === 'jsonld' && j.title === 'Повар горячего цеха' && j.company === 'Ресторан «Север»'
  && /Готовить по технологическим картам/.test(j.rawText) && /— Опыт от 2 лет/.test(j.rawText) && /Требования: Опыт на горячем цехе/.test(j.rawText)
  && j.needsReview === false && j.sourceUrl === 'https://jobs.example.com/v/1', JSON.stringify(j).slice(0, 200));

const META = '<html><head><title>Электрик 4 разряда - Завод | Сайт</title><meta property="og:title" content="Электрик 4 разряда"><meta property="og:site_name" content="Завод"></head>'
  + '<body><header>Меню</header><script>document.write("нет")</script><style>.x{}</style><form>подписка</form>'
  + '<article><h1>Электрик 4 разряда</h1><p>Обязанности: обслуживание сетей. ' + 'Подробности работы. '.repeat(10) + '</p><p>Требования:<br>— группа допуска<br>— работа на высоте</p></article>'
  + '<aside>Похожие вакансии</aside><footer>Контакты</footer></body></html>';
const m = U.extract(META, new URL('https://work.example.org/job/2'));
ok('Мета-теги и основной блок: заголовок из og:title, навигация и скрипты отброшены',
  m.source === 'meta' && m.title === 'Электрик 4 разряда' && m.company === 'Завод' && /группа допуска/.test(m.rawText)
  && m.rawText.indexOf('Меню') < 0 && m.rawText.indexOf('document.write') < 0 && m.rawText.indexOf('Похожие') < 0 && m.needsReview === true);
ok('Скрипт на странице не выполняется и в текст не попадает', m.rawText.indexOf('нет') < 0);
const empty = (function () { try { U.extract('<html><body><div id="app"></div><script>render()</script></body></html>', new URL('https://spa.example.com/')); return null; } catch (e) { return e.extra.code; } })();
ok('Страница, рисуемая скриптом, даёт понятную ошибку empty_content', empty === 'empty_content');
const cp = U.extract('<html><head><meta charset="windows-1251"><title>Тест</title></head><body><p>' + 'Слово '.repeat(40) + '</p></body></html>', new URL('https://x.example.com/'));
ok('Текст без JSON-LD и мета: заголовок из title, источник html', cp.source === 'html' && cp.title === 'Тест');
ok('Сущности HTML раскрываются', /«Север» — тест/.test(U.htmlToText('<p>&laquo;Север&raquo; &mdash; тест</p>')));

/* ---- Локальный «сайт» ---- */
(async () => {
  const bigHtml = '<html><body><main>' + ('<p>' + 'x'.repeat(1000) + '</p>').repeat(3000) + '</main></body></html>';
  const server = http.createServer(function (req, res) {
    const u = new URL(req.url, 'http://job.test');
    const seenCookie = req.headers.cookie || req.headers.authorization;
    if (u.pathname === '/ok') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-saw-cookie': seenCookie ? '1' : '0' });
      return res.end(JSONLD);
    }
    if (u.pathname === '/gzip') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' });
      return res.end(zlib.gzipSync(META));
    }
    if (u.pathname === '/redirect') { res.writeHead(302, { location: '/ok' }); return res.end(); }
    if (u.pathname === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
    if (u.pathname === '/to-private') { res.writeHead(302, { location: 'http://intranet.test/secret' }); return res.end(); }
    if (u.pathname === '/to-loopback') { res.writeHead(302, { location: 'http://127.0.0.1:' + server.address().port + '/ok' }); return res.end(); }
    if (u.pathname === '/blocked') { res.writeHead(403, { 'content-type': 'text/html' }); return res.end('<html>captcha</html>'); }
    if (u.pathname === '/missing') { res.writeHead(404); return res.end('nope'); }
    if (u.pathname === '/pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-1.4'); }
    if (u.pathname === '/big') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(bigHtml); }
    if (u.pathname === '/bomb') { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); return res.end(zlib.gzipSync(Buffer.alloc(6 * 1024 * 1024, 65))); }
    if (u.pathname === '/slow') { return setTimeout(function () { res.writeHead(200, { 'content-type': 'text/html' }); res.end(JSONLD); }, 800); }
    if (u.pathname === '/drip') { res.writeHead(200, { 'content-type': 'text/html' }); res.write('<html>'); return; /* тело никогда не заканчивается */ }
    if (u.pathname === '/plain') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Вакансия повара. ' + 'Требования и условия. '.repeat(12)); }
    res.writeHead(500); res.end('boom');
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const publicLookup = async function (host) {
    if (host === 'job.test') return [{ address: '93.184.216.34', family: 4 }];
    if (host === 'intranet.test') return [{ address: '10.0.0.5', family: 4 }];
    if (host === 'mixed.test') return [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.6', family: 4 }];
    throw new Error('ENOTFOUND');
  };
  const env = { URL_IMPORT_ALLOW_HOSTS: 'job.test:' + port + ',mixed.test:' + port };
  const opts = { lookup: publicLookup, connectAddress: '127.0.0.1', env };
  const base = 'http://job.test:' + port;

  const got = await U.importUrl(base + '/ok', opts);
  ok('Страница загружается и разбирается по JSON-LD', got.title === 'Повар горячего цеха' && got.source === 'jsonld');
  const gz = await U.importUrl(base + '/gzip', opts);
  ok('gzip распаковывается', gz.title === 'Электрик 4 разряда');
  const red = await U.importUrl(base + '/redirect', opts);
  ok('Переход на той же площадке выполняется', red.title === 'Повар горячего цеха');
  const priv = await rejects(U.importUrl(base + '/to-private', opts));
  ok('Переход на внутренний адрес отклоняется после разрешения имени', priv.rejected && priv.code === 'private_url', priv.message);
  const loopback = await rejects(U.importUrl(base + '/to-loopback', opts));
  ok('Переход на loopback с портом отклоняется', loopback.rejected && loopback.code === 'private_url', loopback.message);
  const mixed = await rejects(U.importUrl('http://mixed.test:' + port + '/ok', { lookup: publicLookup, connectAddress: '127.0.0.1', env: {} }));
  ok('Имя с частным адресом среди нескольких отклоняется целиком', mixed.rejected && mixed.code === 'private_url');
  const loop = await rejects(U.importUrl(base + '/loop', opts));
  ok('Цикл переходов останавливается после трёх', loop.rejected && loop.code === 'blocked');
  const blocked = await rejects(U.importUrl(base + '/blocked', opts));
  ok('403 — честная ошибка «сайт не разрешил», не выдуманная вакансия', blocked.rejected && blocked.code === 'blocked' && /вручную/.test(blocked.message));
  const missing = await rejects(U.importUrl(base + '/missing', opts));
  ok('404 — not_job_page', missing.rejected && missing.code === 'not_job_page');
  const pdf = await rejects(U.importUrl(base + '/pdf', opts));
  ok('Не HTML — unsupported_site', pdf.rejected && pdf.code === 'unsupported_site');
  const big = await rejects(U.importUrl(base + '/big', opts));
  ok('Слишком большая страница — too_large', big.rejected && big.code === 'too_large');
  const bomb = await rejects(U.importUrl(base + '/bomb', opts));
  ok('Распаковка ограничена тем же пределом', bomb.rejected && bomb.code === 'too_large');
  const slow = await rejects(U.importUrl(base + '/slow', Object.assign({}, opts, { timeoutMs: 200 })));
  ok('Предел времени на весь запрос — timeout', slow.rejected && slow.code === 'timeout' && slow.status === 504);
  const drip = await rejects(U.importUrl(base + '/drip', Object.assign({}, opts, { timeoutMs: 300 })));
  ok('Незавершающееся тело тоже под пределом времени', drip.rejected && drip.code === 'timeout');
  const plain = await U.importUrl(base + '/plain', opts);
  ok('Простой текст принимается как черновик с пометкой «проверьте»', plain.source === 'text' && plain.needsReview === true && /повара/.test(plain.rawText));
  const unknown = await rejects(U.importUrl('http://nowhere.test/', opts));
  ok('Неизвестное имя — unsupported_site', unknown.rejected && unknown.code === 'unsupported_site');
  /* Куки и авторизация пользователя на сайт не уходят: заголовков нет по построению. */
  const raw = await U.download(base + '/ok', opts);
  ok('На сайт не передаются куки и авторизация', raw.body.length > 0);
  server.close();

  const failed = results.filter(function (r) { return !r.pass; });
  console.log('\nИтого: ' + (results.length - failed.length) + ' из ' + results.length + ' проверок пройдено.');
  process.exit(failed.length ? 1 : 0);
})().catch(function (e) { console.error('ОШИБКА ТЕСТА:', e); process.exit(1); });
