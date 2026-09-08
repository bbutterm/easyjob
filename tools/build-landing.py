# Сборка лендинга docs/presentation.html из CSS приложения и снимков docs/screenshots/landing.
# Запуск: python3 tools/build-landing.py (снимки обновляются скриптом из docs/screenshots/landing/README).
import base64, re, os
ROOT = '/home/user/easyjob'
css = open(ROOT + '/src/styles.css', encoding='utf-8').read()
SHOTS = ROOT + '/docs/screenshots/landing/'

EXTRA = """
/* ---- Лендинг: поверх стилей приложения ---- */
body { overflow-x: hidden; }
.story-page { padding: 0 32px; }
.story-header nav { display: flex; gap: 4px; }
.story-header nav a { text-decoration: none; color: var(--text-muted); font-size: 14px; padding: 10px 14px; border-radius: 10px; }
.story-header nav a:hover { background: var(--surface-2); color: var(--text); }
.hero-layout { min-height: auto; padding: 24px 0 56px; gap: 40px; }
.hero-copy h1 { margin: 16px 0 20px; }
.hero-copy .hero-lead { margin: 0 0 28px; max-width: 520px; }
.hero-shot { position: relative; }
.shot { display: block; width: 100%; height: auto; border-radius: 16px; border: 1px solid var(--border); box-shadow: var(--shadow-2); background: var(--surface); }
.shot--tilt { transform: rotate(-1.5deg); }
.hero-shot .ai-helper { position: absolute; right: -14px; top: -22px; }
.strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; padding: 32px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.strip b { display: block; font-size: 16px; letter-spacing: -.02em; margin-bottom: 4px; }
.strip span { color: var(--text-muted); font-size: 13.5px; line-height: 1.55; }
.section { padding: 72px 0 8px; }
.section-head { max-width: 640px; margin-bottom: 40px; }
.section-head h2 { font-size: clamp(30px, 3.4vw, 44px); font-weight: 550; letter-spacing: -.05em; line-height: 1.1; margin: 12px 0 14px; }
.section-head p { color: var(--text-muted); font-size: 16px; line-height: 1.65; }
.feature { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 48px; align-items: center; padding: 28px 0 56px; }
.feature:nth-child(even) .feature__copy { order: 2; }
.feature__copy h3 { font-size: 26px; font-weight: 550; letter-spacing: -.04em; line-height: 1.15; margin: 10px 0 14px; }
.feature__copy p { color: var(--text-muted); line-height: 1.65; }
.feature__copy ul { margin: 16px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.feature__copy li { display: grid; grid-template-columns: 18px 1fr; gap: 10px; color: var(--text-muted); font-size: 14.5px; line-height: 1.55; }
.feature__copy li::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 8px; justify-self: center; }
.feature__copy li b { color: var(--text); font-weight: 600; }
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.steps .card { padding: 28px; }
.steps .num { display: inline-flex; width: 36px; height: 36px; align-items: center; justify-content: center; border-radius: 12px; background: var(--accent-soft); color: var(--accent); font-weight: 700; margin-bottom: 14px; }
.steps h3 { font-size: 18px; letter-spacing: -.03em; margin-bottom: 8px; }
.steps p { color: var(--text-muted); font-size: 14.5px; }
.plans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
.plan { display: grid; gap: 14px; align-content: start; padding: 28px; }
.plan--hi { border-color: var(--accent-border); box-shadow: var(--shadow-2); }
.plan h3 { font-size: 20px; letter-spacing: -.03em; }
.plan .price { color: var(--text-muted); font-size: 14px; }
.plan ul { margin: 0; padding-left: 18px; color: var(--text-muted); font-size: 14px; display: grid; gap: 6px; }
.plan li::marker { color: var(--accent); }
.plan .btn { justify-self: start; }
.trust { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.trust .card { padding: 24px; }
.trust h3 { font-size: 17px; letter-spacing: -.02em; margin-bottom: 8px; }
.trust p { color: var(--text-muted); font-size: 14.5px; }
.final { margin: 72px 0 0; padding: 48px; border-radius: 24px; background: linear-gradient(145deg, #86b8ff, #3269ef 75%); color: #fff; display: grid; gap: 16px; justify-items: start; }
.final h2 { color: #fff; font-size: clamp(28px, 3.2vw, 40px); font-weight: 550; letter-spacing: -.05em; line-height: 1.1; max-width: 22ch; }
.final p { color: rgba(255,255,255,.88); max-width: 56ch; font-size: 16px; }
.final .btn { background: #fff; border-color: #fff; color: var(--accent); }
@media (max-width: 900px) {
  .story-page { padding: 0 20px; }
  .story-header nav { display: none; }
  .hero-layout, .feature { grid-template-columns: 1fr; gap: 24px; }
  .feature:nth-child(even) .feature__copy { order: 0; }
  .strip, .steps, .plans, .trust { grid-template-columns: 1fr; }
  .hero-shot .ai-helper { right: 8px; top: -18px; }
  .final { padding: 28px; }
}
"""

def body(img):
    return f"""
<div class="story-page">
<div class="story-container">

<header class="story-header">
  <a class="wordmark" href="#top">easyjob<span>Карьерный помощник</span></a>
  <nav><a href="#features">Возможности</a><a href="#how">Как это работает</a><a href="#plans">Тарифы</a><a href="#trust">Безопасность</a></nav>
  <a class="btn btn--primary" href="#start">Начать бесплатно</a>
</header>

<section class="hero-layout" id="top">
  <div class="hero-copy">
    <span class="eyebrow">Для любой профессии</span>
    <h1>Получайте офферы, а не отказы</h1>
    <p class="hero-lead">Easyjob готовит вас к <em>конкретной вакансии</em>: показывает, где вы сильны и где провалитесь, собирает вопросы, репетирует голосом и подсказывает прямо во время собеседования.</p>
    <div class="btn-row"><a class="btn btn--primary" href="#start">Начать бесплатно</a><a class="btn" href="#features">Смотреть возможности</a></div>
    <p class="mode-label">Первая подготовка занимает один вечер. Резюме и вакансия подтягиваются по ссылке с hh.ru.</p>
  </div>
  <div class="hero-shot">
    <span class="ai-helper" aria-hidden="true"><i></i><i></i><b>‿</b></span>
    <img class="shot" src="{img('hero')}" alt="Экран «Обзор» в приложении easyjob: ближайший шаг подготовки и разделы резюме, вакансии, интервью">
  </div>
</section>

<div class="strip">
  <div><b>Под конкретную вакансию</b><span>Не общие советы, а разбор именно этой вакансии против именно вашего резюме.</span></div>
  <div><b>По ссылке с hh.ru</b><span>Вакансия и резюме подтягиваются за секунды, без копирования текста.</span></div>
  <div><b>Голосовая репетиция</b><span>Интервьюер задаёт вопросы вслух, слушает ответы и помнит сказанное.</span></div>
  <div><b>Подсказки на собеседовании</b><span>Опора для ответа в реальном времени, по вашему же опыту.</span></div>
</div>

<section class="section" id="features">
  <div class="section-head"><span class="eyebrow">Возможности</span><h2>Всё между «нашёл вакансию» и «получил оффер»</h2><p>Каждый экран ниже — настоящий экран приложения.</p></div>

  <div class="feature">
    <div class="feature__copy"><span class="eyebrow">Сопоставление</span><h3>Честно, по каждому требованию. Без «вы подходите на 78%»</h3>
      <p>Требования вакансии проверяются по вашему резюме: подтверждено, нужно уточнить, не указано. Под каждым пунктом что нашли в резюме и как подготовиться.</p>
      <ul><li><span><b>Три-четыре пункта</b>, которые решат исход, вместо расплывчатого процента</span></li><li><span>Ничего не додумывается по названию должности</span></li><li><span>После правки резюме сопоставление пересобирается одной кнопкой</span></li></ul></div>
    <img class="shot" src="{img('match')}" alt="Требования вакансии со статусами «Подтверждено», «Нужно уточнить», «Не указано в резюме»">
  </div>

  <div class="feature">
    <div class="feature__copy"><span class="eyebrow">hh.ru</span><h3>Вакансия и резюме по ссылке. Подходящие вакансии по резюме</h3>
      <p>Вставьте ссылку: сервер сам откроет страницу и достанет название, компанию, зарплату, описание и навыки. Поиск подберёт вакансии, похожие на ваше резюме, и объяснит, что совпало.</p>
      <ul><li><span>Ноль копирования текста по кускам</span></li><li><span>Из результата поиска <b>одна кнопка</b> ведёт в подготовку</span></li><li><span>Всё показывается для проверки перед разбором</span></li></ul></div>
    <div style="display:grid;gap:16px"><img class="shot" src="{img('import')}" alt="Импорт вакансии по ссылке hh.ru"><img class="shot" src="{img('jobs')}" alt="Поиск вакансий, отсортированный по похожести на резюме"></div>
  </div>

  <div class="feature">
    <div class="feature__copy"><span class="eyebrow">Вопросы</span><h3>Вопросы, которые действительно зададут. Ответы готовы заранее</h3>
      <p>Вопросы строятся из требований и слабых мест сопоставления, к каждому пояснение, почему его зададут. Вы пишете ответ, получаете разбор: что сильно, чего не хватает, как сказать лучше. Без баллов.</p>
      <ul><li><span>Ответы сохраняются сами, можно вернуться завтра</span></li><li><span>В конце <b>карточка-шпаргалка</b>: с чего начать, чем гордиться, где осторожно</span></li></ul></div>
    <img class="shot" src="{img('questions')}" alt="Вопрос для подготовки с полем ответа и ориентирами">
  </div>

  <div class="feature">
    <div class="feature__copy"><span class="eyebrow">Тренировка</span><h3>Репетиция с интервьюером, который помнит, что вы сказали</h3>
      <p>Текстом или голосом. Интервьюер задаёт по одному вопросу, цепляется за ваши слова и спрашивает дальше, не повторяет темы. Его можно перебить.</p>
      <ul><li><span>Тренировок сколько угодно, итог каждой сохраняется</span></li><li><span><b>Первое волнение</b> достаётся тренажёру, а не работодателю</span></li></ul></div>
    <div style="display:grid;gap:16px"><img class="shot" src="{img('interview')}" alt="Текстовое пробное интервью: реплики интервьюера и ответ кандидата"><img class="shot" src="{img('voice')}" alt="Голосовая тренировка с расшифровкой"></div>
  </div>

  <div class="feature">
    <div class="feature__copy"><span class="eyebrow">Собеседование</span><h3>Помощник на самом собеседовании</h3>
      <p>Видит вопрос на экране видеозвонка и за секунду показывает опору для ответа: направление и о чём напомнить. По вашему резюме, не чужой текст для зачитывания.</p>
      <ul><li><span>Только с вашего согласия, текст экрана не сохраняется</span></li><li><span>Прозрачное окно поверх звонка на компьютере</span></li><li><span><b>Никогда не подсказывает опыт</b>, которого у вас нет</span></li></ul></div>
    <img class="shot" src="{img('assistant')}" alt="Пример подсказки помощника: направление ответа и напоминание">
  </div>
</section>

<section class="section" id="how">
  <div class="section-head"><span class="eyebrow">Как это работает</span><h2>Один вечер до готовности</h2></div>
  <div class="steps">
    <div class="card"><span class="num">1</span><h3>Добавьте резюме и вакансию</h3><p>Файлом, текстом или ссылкой с hh.ru. Сервис разберёт оба и покажет сопоставление.</p></div>
    <div class="card"><span class="num">2</span><h3>Ответьте и порепетируйте</h3><p>Письменные ответы с обратной связью, затем интервью текстом или голосом с итогом.</p></div>
    <div class="card"><span class="num">3</span><h3>Идите с опорой</h3><p>Карточка-шпаргалка и помощник с подсказками в реальном времени.</p></div>
  </div>
</section>

<section class="section" id="plans">
  <div class="section-head"><span class="eyebrow">Тарифы</span><h2>Начните бесплатно, подключайте больше по мере необходимости</h2><p>Цены и лимиты объявим при запуске. Все уровни работают для любой профессии.</p></div>
  <div class="plans">
    <div class="card plan"><h3>Резюме и подготовка</h3><div class="price">Бесплатный старт</div><ul><li>Резюме из файла, текста или мастера, разбор резюме</li><li>Вакансия по ссылке, поиск подходящих</li><li>Сопоставление по требованиям</li><li>Вопросы для подготовки</li></ul><a class="btn" href="#start">Начать</a></div>
    <div class="card plan plan--hi"><h3>Тренировки</h3><div class="price">Всё из «Резюме и подготовка», плюс</div><ul><li>Обратная связь на каждый ответ</li><li>Текстовое пробное интервью</li><li>Голосовое пробное интервью с памятью</li><li>Итоги тренировок и карточка-шпаргалка</li></ul><a class="btn btn--primary" href="#start">Выбрать</a></div>
    <div class="card plan"><h3>С помощником</h3><div class="price">Всё из «Тренировки», плюс</div><ul><li>Помощник на собеседовании</li><li>Подсказки в реальном времени по вопросам с экрана</li><li>Программа для компьютера поверх видеозвонка</li></ul><a class="btn" href="#start">Выбрать</a></div>
  </div>
</section>

<section class="section" id="trust">
  <div class="section-head"><span class="eyebrow">Безопасность и честность</span><h2>Почему этому можно доверять</h2></div>
  <div class="trust">
    <div class="card"><h3>Ничего не выдумывает</h3><p>Модель работает только с вашими данными и прямо говорит, чего ей не хватает. Каждый ответ подписан: какая модель и на каком этапе его дала.</p></div>
    <div class="card"><h3>Данные под контролем</h3><p>Ключи моделей только на сервере. Голос и текст экрана не хранятся. Всё своё можно удалить одной кнопкой.</p></div>
    <div class="card"><h3>Любая профессия</h3><p>Повар, водитель, бухгалтер, разработчик. Сервис не сводит всех к офисным ролям и не подменяет профессию похожей.</p></div>
  </div>
</section>

<section class="final" id="start">
  <h2>Следующая вакансия может стать вашей уже подготовленной</h2>
  <p>Добавьте резюме и вакансию сегодня вечером. Quick Start проведёт по всем шагам: сопоставление, вопросы, обратная связь, репетиция.</p>
  <a class="btn" href="#top">Начать бесплатно</a>
</section>

<footer class="story-footer"><span>easyjob <b>·</b> Карьерный помощник</span><span>Экраны сняты с приложения на демонстрационных данных</span></footer>

</div>
</div>
"""

def page(img, standalone):
    head = ('<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' if standalone else '')
    head += '<title>Easyjob</title>\n<style>\n' + css + '\n' + EXTRA + '\n</style>\n'
    if standalone: head += '</head>\n<body>\n'
    tail = '\n</body>\n</html>\n' if standalone else '\n'
    return head + body(img) + tail

open(ROOT + '/docs/presentation.html', 'w', encoding='utf-8').write(page(lambda n: 'screenshots/landing/' + n + '.png', True))
def data_uri(n):
    return 'data:image/png;base64,' + base64.b64encode(open(SHOTS + n + '.png', 'rb').read()).decode()
out = page(data_uri, False)
open(ROOT + '/docs/presentation.inline.html', 'w', encoding='utf-8').write(out)
print('repo file', os.path.getsize(ROOT + '/docs/presentation.html'), 'artifact', len(out.encode()))
