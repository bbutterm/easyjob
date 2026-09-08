/* Поддельный сайт hh.ru для проверок браузерного адаптера. Страницы
   собираются JavaScript-ом на клиенте: без браузера в HTML только пустая
   оболочка, как на настоящем hh. Наружу не ходит. */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const API = JSON.parse(fs.readFileSync(path.join(__dirname, 'hh-api.json'), 'utf8'));
const RESUME_HTML = fs.readFileSync(path.join(__dirname, 'hh-resume.html'), 'utf8');
const CAPTCHA_HTML = fs.readFileSync(path.join(__dirname, 'hh-captcha.html'), 'utf8');

function shell(title, script) {
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>' + title + '</title></head><body>'
    + '<header><nav>Войти · Создать резюме · Работодателям · Помощь</nav></header>'
    + '<div id="root"><noscript>Включите JavaScript</noscript></div>'
    + '<footer>© hh.ru · Соглашение · Похожие вакансии: Повар-универсал, Пекарь</footer>'
    + '<script>' + script + '</script></body></html>';
}

function vacancyPage(v) {
  const data = JSON.stringify({ name: v.name, employer: v.employer.name, area: v.area.name, salary: 'от ' + v.salary.from + ' до ' + v.salary.to + ' ₽',
    experience: v.experience.name, employment: v.employment.name, description: v.description, skills: v.key_skills.map(function (k) { return k.name; }) });
  return shell('Вакансия ' + v.name, 'var d=' + data + ';var r=document.getElementById("root");'
    + 'r.innerHTML=\'<main><h1 data-qa="vacancy-title">\'+d.name+\'</h1>\'+'
    + '\'<a data-qa="vacancy-company-name">\'+d.employer+\'</a><span data-qa="vacancy-salary">\'+d.salary+\'</span>\'+'
    + '\'<p data-qa="vacancy-view-location">\'+d.area+\'</p><span data-qa="vacancy-experience">\'+d.experience+\'</span>\'+'
    + '\'<p data-qa="vacancy-view-employment-mode">\'+d.employment+\'</p><div data-qa="vacancy-description">\'+d.description+\'</div>\'+'
    + '\'<div class="skills">\'+d.skills.map(function(s){return \'<span data-qa="skills-element">\'+s+\'</span>\';}).join("")+\'</div>\'+'
    + '\'<aside><h2>Похожие вакансии</h2><p>Повар-универсал, Пекарь</p></aside></main>\';');
}

/* Страница без разметки data-qa: только текст, как на партнёрском сайте. */
function plainVacancyPage() {
  return shell('Су-шеф', 'document.getElementById("root").innerHTML=\'<main><h1>Су-шеф в ресторан «Пушкин»</h1>'
    + '<p>Компания: Ресторан «Пушкин»</p><p>Управление сменой из шести поваров, авторское меню, контроль качества блюд и заготовок по технологическим картам.</p>'
    + '<p>Требования: опыт су-шефом от двух лет, знание ХАССП, действующая медицинская книжка.</p>'
    + '<h2>Похожие вакансии</h2><p>Повар горячего цеха</p></main>\';');
}

function resumePage() {
  const body = /<body>([\s\S]*)<\/body>/.exec(RESUME_HTML)[1];
  return shell('Резюме', 'document.getElementById("root").innerHTML=' + JSON.stringify(body) + ';');
}

function searchPage(query) {
  const items = API.search.items.map(function (v) {
    return { id: v.id, name: v.name, employer: v.employer.name, area: v.area.name, salary: v.salary ? ('от ' + v.salary.from + ' ₽') : '',
      req: (v.snippet || {}).requirement || '', resp: (v.snippet || {}).responsibility || '' };
  });
  return shell('Поиск', 'var items=' + JSON.stringify(items) + ';var q=' + JSON.stringify(query) + ';'
    + 'document.getElementById("root").innerHTML=\'<main><h1 data-qa="vacancy-serp__results">Найдено \'+items.length+\' вакансии по запросу «\'+q+\'»</h1>\'+'
    + 'items.map(function(v){return \'<div data-qa="vacancy-serp__vacancy"><a data-qa="serp-item__title" href="/vacancy/\'+v.id+\'?query=x">\'+v.name+\'</a>\'+'
    + '\'<a data-qa="vacancy-serp__vacancy-employer">\'+v.employer+\'</a><div data-qa="vacancy-serp__vacancy-address">\'+v.area+\'</div>\'+'
    + '(v.salary?\'<span data-qa="vacancy-serp__vacancy-compensation">\'+v.salary+\'</span>\':"")+'
    + '\'<div data-qa="vacancy-serp__vacancy_snippet_requirement">\'+v.req.replace(/<[^>]+>/g,"")+\'</div><div data-qa="vacancy-serp__vacancy_snippet_responsibility">\'+v.resp+\'</div></div>\';}).join("")+\'</main>\';');
}

function create() {
  const seen = [];
  const server = http.createServer(function (req, res) {
    seen.push({ url: req.url, cookie: req.headers.cookie || '', ua: req.headers['user-agent'] || '' });
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (u.pathname === '/vacancy/123456') return res.end(vacancyPage(API.vacancy));
    if (u.pathname === '/vacancy/555') return res.end(plainVacancyPage());
    if (u.pathname === '/vacancy/403403') { res.statusCode = 403; return res.end(CAPTCHA_HTML); }
    if (u.pathname === '/vacancy/777777') return res.end(shell('Проверка', 'document.getElementById("root").innerHTML="<p>Подтвердите, что вы не робот</p>";'));
    if (/^\/resume\/0123456789abcdef0123456789abcdef/.test(u.pathname)) return res.end(resumePage());
    if (/^\/resume\/cafe/.test(u.pathname)) return res.end(CAPTCHA_HTML);
    if (u.pathname === '/search/vacancy') return res.end(searchPage(u.searchParams.get('text') || ''));
    res.statusCode = 404; res.end(shell('404', 'document.getElementById("root").innerHTML="<p>Страница не найдена</p>";'));
  });
  return { server, seen, listen() { return new Promise(function (r) { server.listen(0, '127.0.0.1', function () { r('http://127.0.0.1:' + server.address().port); }); }); },
    close() { server.close(); } };
}

module.exports = { create };
