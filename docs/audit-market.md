# Рыночное исследование и бизнес-аудит: «Карьерный помощник»

Дата проверки данных: **6 сентября 2026**. Все цены — на эту дату, если не указано иное.

Методологическая оговорка. Прямая загрузка страниц из этой среды заблокирована сетевым прокси (в том числе официальные сайты finalroundai.com, lockedinai.com, vervecopilot.com, cluely.com, interviewcoder.co, yoodli.ai, biginterview.com, tealhq.com, kickresume.com, rezi.ai, jobscan.co, getvizir.com, psykit.ru, sufler.tech, developers.sber.ru, yandex.cloud, stats.hh.ru, yookassa.ru, techcrunch.com, garant.ru, klerk.ru, vc.ru, cnews.ru, ria.ru). Поэтому:

- цены и факты взяты из **поисковых выдержек** и вторичных источников (обзоры, каталоги, пресс-релизы, СМИ);
- значительная часть обзоров ИИ-инструментов для собеседований написана **самими конкурентами** (блоги finalroundai.com, interviewcoder.co, interviewsidekick.com и т.п.) — это заинтересованные источники, помечены как «блог конкурента»;
- где цифры расходятся между источниками, приведены обе;
- где данных нет — написано «данные не найдены». Оценки помечены как оценки.

Перед принятием решений цены нужно перепроверить на официальных страницах вручную.

---

## 0. Сводка выводов

1. **Ниша подготовки к собеседованиям с ИИ переполнена и на мировом, и на русскоязычном рынке.** Бесплатных или почти бесплатных инструментов (ChatGPT/Алиса/GigaChat в чате, hh.ru, Авито) достаточно, чтобы закрыть 80 % задачи «сделать резюме и подготовить ответы». Крупнейший бесплатный игрок — Google Interview Warmup — закрыт в апреле 2026, что говорит скорее о низкой монетизируемости сегмента, чем об освободившемся спросе.
2. **Русскоязычные «суфлёры» для живого собеседования уже существуют** (Qompanion, Vizir, Enigma AI, PsyKit, Sufler) и продают именно то, чего прототип принципиально не делает: слушают звук и прячутся от демонстрации экрана. Цены: от 200 ₽ за собеседование до 1 990 ₽/мес.
3. **Функция помощника на собеседовании — главный риск, а не козырь.** В задуманном «честном» виде (окно не скрывается, звук не пишется, нужно согласие работодателя) она не решает задачу покупателя этой категории и одновременно тянет за собой весь правовой и репутационный багаж категории «читинг». Прямая рекомендация — не выпускать её в текущем виде.
4. **Правовой риск в РФ реален, но лежит в плоскости 152‑ФЗ и ГК, а не УК.** Изображение и голос интервьюера — персональные данные третьего лица без согласия; передача их в зарубежные LLM — трансграничная передача с уведомлением РКН и запретом первичного сбора в иностранные базы (с 01.07.2025). Штрафы по ст. 13.11 КоАП с 30.05.2025 существенно выросли и применяются и к физлицам.
5. **Юнит-экономика самого сервиса подготовки хорошая**: себестоимость LLM+STT на платящего пользователя — ориентировочно 100–700 ₽/мес в зависимости от модели, при цене 590–1 490 ₽/мес валовая маржа 50–85 %. Проблема не в марже, а в привлечении: продукт сезонный, разовый по природе (нашёл работу — ушёл), а готовность россиян платить за помощь в поиске работы низкая и не подтверждена цифрами.
6. **Что делать первым**: выпустить узкий бесплатный/дешёвый веб-инструмент «вакансия → разбор требований → вопросы → текстовая тренировка» для офисных профессий вне IT, продавать разовый доступ на 7 дней, а не подписку; отказаться от помощника на собеседовании; выбрать российских LLM-провайдеров для данных с ПДн.

---

## 1. Мировые конкуренты

Сводная таблица. Цены — в USD, по вторичным источникам, дата проверки 06.09.2026. «Live-подсказки» = подсказки во время настоящего собеседования.

| Продукт | Что делает | Для кого | Монетизация и цены | Live-подсказки | Скрытие от демонстрации экрана |
|---|---|---|---|---|---|
| Final Round AI | Interview Copilot (слушает микрофон, транскрибирует, предлагает ответ), мок-интервью, банк вопросов, резюме | Соискатели, в основном IT/офис, США | Подписка. По блогу конкурента LoopCV: $149/мес (5 сессий копилота), $299/квартал (25 сессий), $500/год (безлимит); другие источники называют $300/год. Бесплатный тариф на слабых моделях | Да | Заявляет stealth-режим; по тестам детектируется в HackerRank (см. §4) |
| Cluely (бывш. Interview Coder) | «Cheat on everything»: невидимый оверлей, слушает звук и читает экран; с 2026 — ИИ-конспектор встреч | Изначально — кандидаты и продавцы; сейчас — корпоративные встречи | Pro $20/мес (по каталогам Software Finder / Efficient App); бесплатный Starter | Да (исторически) | Да — это было ядром продукта |
| Interview Coder | Невидимый оверлей для алгоритмических собеседований (LeetCode-стиль) | Разработчики | Monthly Pro $299/мес (1 000 кредитов), Lifetime $799 (данные обзора PracHub, июль 2026; пресс-релиз Interview Coder 2.0 на Yahoo Finance тоже указывает lifetime $799) | Да | Да, «Zero Visibility» — это позиционирование |
| Verve AI | Live-копилот в Zoom/Meet/Teams/HireVue + мок-интервью + coding copilot | Соискатели, IT и не только | Free; Standard $16.99/мес; Pro $34.99/мес (PracHub); по Capterra — Standard $38.25/мес ($14 при годовой), Pro $59.50/мес ($25 при годовой). Расхождение — проверить | Да | Да, «Stealth Mode» через десктоп-приложение |
| LockedIn AI | Live-подсказки, код, «живой коучинг» | Соискатели, IT | $49.99/мес; ~$29.99/мес при квартале; Lifetime $1 499.25; есть кредитный план (aiapps.com, блог конкурента finalroundai) | Да | Да |
| Sensei AI | Браузерный live-копилот | Соискатели | Free 15 мин/сессия; Pro $89/мес или $288/год ($24/мес); без возвратов (saasworthy, interviewman) | Да | Браузерный оверлей, слабее «невидимость» |
| Yoodli | Тренажёр речи и ролевые сценарии: слова-паразиты, темп, контакт глаз; в 2026 — генерация вопросов из описания вакансии | Соискатели, продавцы, корпоративные L&D | Free (5 ролевых игр всего); Pro $8/мес годовой (10 сессий/нед); Advanced $20/мес годовой (безлимит); Team/Enterprise по запросу (articuler.ai, makerstack) | Нет | — |
| Huru | Мок-интервью по вопросам из вакансии, фидбек по ответам, языку тела, голосу; расширение для LinkedIn/Indeed | Соискатели, мультиязычно | $24.99/мес; $99/год (theofferinbox, toolinsidr). Отзывы на технические сбои (SourceForge) | Нет | — |
| Google Interview Warmup | Бесплатный тренажёр вопросов | Массовый | Бесплатно | Нет | — |
| **Статус: закрыт Google в апреле 2026** («spring cleaning»), URL редиректит на статью (skillora.ai, velyq.com, aceround.app) | | | | | |
| Interviewing.io | Анонимные мок-интервью с живыми инженерами FAANG, голос + фидбек | Разработчики | Платные сессии; официальную цену за сессию получить не удалось (сайт заблокирован); по igotanoffer — «дорого», сотни долларов за сессию | Нет | — |
| Pramp | Бесплатные peer-to-peer мок-интервью | Разработчики | Бесплатно; поглощён Exponent (leetcopilot, lodely) | Нет | — |
| Big Interview | Видеокурс + ИИ-мок-интервью + резюме; сильный B2B в вузах (700+ университетов США, госпрограммы) | Студенты, соискатели, вузы | $39/мес; $99/3 мес; $299 lifetime; 30 дней возврат (igotanoffer, interviewguru) | Нет | — |
| Teal | Трекер вакансий + конструктор резюме + матчинг с вакансией (проценты) | Соискатели | Free; Teal+ $13/нед, $29/мес, $79/квартал; годового нет (applyarc, loopcv) | Нет | — |
| Kickresume | Конструктор резюме с ИИ, шаблоны | Массовый, Европа | $24/мес; $18/мес квартально; $8/мес годовой (~$96/год) (pitchmeai, atsresumeai, «проверено июль 2026») | Нет | — |
| Rezi | ИИ-резюме под ATS | Соискатели, США | Pro $29/мес; Lifetime $149; 30 дней возврат (resumegenius, pitchmeai) | Нет | — |
| Jobscan | Сканер резюме против вакансии с **процентом соответствия** и подсказками по ATS | Соискатели, США | 5 бесплатных сканов/мес; $49.95/мес; $89.95/3 мес (~$29.99/мес) (theinterviewguys, careery) | Нет | — |

Дополнительно найденные игроки (не запрошены, но заметны в выдаче): Interview Sidekick, Shadecoder, Ultracode (позиционируется как «недетектируемый» на HackerRank/CodeSignal), AceRound, Skillora, PrePaired, InterviewMan, OphyAI, LastRound AI, Articuler. Это десятки клонов с одинаковой моделью «копилот + мок-интервью за $20–60/мес». Порог входа в нишу околонулевой, что видно по количеству SEO-блогов «X review 2026» друг о друге.

Источники:
- Final Round AI: https://www.loopcv.pro/directory/finalround/ ; https://www.remotejobassistant.com/blog/final-round-ai-review ; https://www.trustpilot.com/review/finalroundai.com ; https://rainaiservices.com/reviews/final-round-ai/
- Cluely: https://softwarefinder.com/sales-tools/cluely ; https://efficient.app/apps/cluely ; https://techcrunch.com/2026/03/05/cluely-ceo-roy-lee-admits-to-publicly-lying-about-revenue-numbers-last-year/ ; https://www.thedailystar.net/tech-startup/news/ai-cheating-tool-startup-raises-15-million-funding-3922806
- Interview Coder: https://prachub.com/resources/interview-coder-review-2026-pricing-detection-risks-and-ethical-alternatives ; https://finance.yahoo.com/news/interview-coder-2-0-sets-162500128.html
- Verve AI: https://prachub.com/resources/verve-ai-review-2026-practice-tool-or-risky-live-interview-copilot ; https://www.capterra.com/p/10034349/Verve-AI-Interview-Copilot/
- LockedIn AI: https://www.aiapps.com/items/lockedin-ai/ ; https://www.shadecoder.com/blogs/is-lockedin-ai-worth-it-in-2026-pricing-and-use-cases (блог конкурента)
- Sensei AI: https://www.saasworthy.com/product/sensei-ai/pricing ; https://interviewman.com/compare/sensei-ai (блог конкурента)
- Yoodli: https://www.articuler.ai/resources/compare/yoodli-ai-interview-coach/ ; https://makerstack.co/reviews/yoodli-review/
- Huru: https://www.theofferinbox.com/huru-ai-review/ ; https://sourceforge.net/software/product/Huru/
- Google Interview Warmup: https://skillora.ai/blog/interview-warmup-alternatives ; https://velyq.com/en/blog/alternative-interview-warmup ; https://www.aceround.app/blog/google-interview-warmup-review/
- Interviewing.io / Pramp: https://igotanoffer.com/blogs/tech/interviewingio-alternatives ; https://leetcopilot.dev/blog/pramp-vs-interviewing-io-review-2025
- Big Interview: https://igotanoffer.com/en/advice/big-interview-alternatives ; https://www.interviewguru.app/compare/big-interview/ ; https://www.biginterview.com/who-is-it-for/higher-education
- Teal: https://applyarc.com/compare/teal-pricing ; https://blog.loopcv.pro/teal-hq-review/
- Kickresume: https://pitchmeai.com/blog/kickresume-pricing-features-guide ; https://www.atsresumeai.com/compare/kickresume-review
- Rezi: https://resumegenius.com/reviews/rezi-ai-review ; https://pitchmeai.com/blog/rezi-pricing-plans
- Jobscan: https://blog.theinterviewguys.com/is-jobscan-worth-it-in-2026/ ; https://careery.pro/blog/resume-applications/is-jobscan-worth-it-2026

### Что важно вынести из мировой картины

- **Две разные ниши с разной экономикой.** «Подготовка» (Yoodli, Big Interview, Huru) стоит $8–40/мес и монетизируется в основном через B2B (вузы, корпоративные L&D). «Live-копилоты» (Final Round, Verve, LockedIn, Sensei, Interview Coder) стоят $50–300/мес — покупатель платит за конкретный оффер и за «невидимость». Средней цены между ними нет: честный, видимый live-помощник не является товаром ни в одной из ниш.
- **У live-копилотов плохая репутация по оплате.** У Final Round AI 18 % отзывов на Trustpilot содержат слова «scam»/«fraud» (анализ 100 отзывов, rainaiservices.com; сам продукт реален и привлёк $6.88M). Модель «месячный план без возврата + автопродление» типична для категории.
- **Конструкторы резюме** — товар с ценой $8–30/мес и lifetime-опциями ($149 Rezi, $299 Big Interview). Lifetime показывает, что клиенты не хотят подписку на сезонный товар.
- **Процент соответствия** — фирменная механика Jobscan/Teal, а не общепринятая правда: сами обзоры оговаривают, что это «прокси, а не то, что считает Workday или Taleo» (theinterviewguys).

---

## 2. Русскоязычный рынок

### 2.1 Крупные площадки

| Игрок | Что есть для соискателя | Цены |
|---|---|---|
| hh.ru | ИИ-помощник запущен в ноябре 2025 (бета), с начала 2026 масштабируется на всех; для соискателя — диалог, дополняющий резюме, ответы на вопросы работодателя. Платные услуги: продвижение резюме от 199 ₽; статистика по вакансии от 199 ₽; «Готовое резюме» от 4 100 ₽; «Репетиция собеседования» с живым экспертом 4 900 ₽ (видеоконсультация + гайд + видеоурок + запись); карьерная консультация 4 100 ₽; подписка hh PRO 199 ₽/нед, 699 ₽/мес, 1 899 ₽/3 мес | Источники: https://trends.rbc.ru/trends/innovation/cmrm/6925b9c69a79478644110acf ; https://hh.ru/article/pochemu-ne-nuzhno-boyatsya-ii-pri-poiske-raboty ; https://hh.ru/services ; https://hh.ru/article/28682 ; https://feedback.hh.ru/knowledge-base/article/1358 ; https://www.unisender.com/ru/blog/obzor-hh-dlya-tekh-kto-ishchet-rabotu/ |
| Авито Работа | Генерация резюме собственной LLM «в один клик»: время создания резюме для рабочих и линейного персонала сокращено с 3 мин до 14 с; после запуска +42 % резюме в день. Бесплатно | https://www.sostav.ru/publication/avito-rabota-predstavila-funktsiyu-sozdaniya-rezyume-74382.html ; https://www.retail.ru/rbc/pressreleases/avito-rabota-zapuskaet-funktsiyu-sozdaniya-rezyume-v-odin-klik/ |
| Работа.ру (Сбер) | Автоматическое формирование резюме «с учётом пожеланий соискателя»; отдельного тренажёра собеседований в выдаче не найдено | https://ura.news/news/1053066160 |
| Сбер / GigaChat | Публичного продукта «тренировка собеседования» для соискателей не найдено; GigaChat используется в HR на стороне работодателя (СберБизнес: пишет вакансии и отбирает кандидатов; ВЭБ.РФ — анализ резюме). Соискатель может тренироваться в обычном чате GigaChat бесплатно | https://axioma-ai.ru/ai-russia/sber-gigachat-hr-assistant-sberbiznes-20260815 ; https://www.cnews.ru/news/line/2025-11-20_gigachat_uskoryaet_analiz_rezyume ; https://lifehacker.ru/special/sber-career/ |
| Яндекс / Алиса AI | Отдельного продукта нет; Алиса «может провести собеседование» по промпту, пишет резюме и сопроводительные. Яндекс Практикум — бесплатный курс подготовки к алгоритмическому собеседованию | https://skillbox.ru/media/design/neyroset-alisa-kak-rabotaet-ii-pomoschnik-yandeksa/ ; https://start.practicum.yandex/algorithms-interview/ |
| GetMatch | IT-рекрутинг; Career Boost — «ИИ-инструменты для резюме и самостоятельного поиска» или личный рекрутер. Цены в выдаче не найдены | https://careerboost.getmatch.ru/ |
| Careerspace | Карьерное сопровождение с гарантией (5 приглашений или возврат): входной тариф 7 990 ₽; 30 000 ₽ за 3 мес; премиум 160 000 ₽ | https://tutortop.ru/school-reviews/careerspace/ ; https://careerspace.app/subscription |
| Карьерные консультанты (Profi.ru, hrtime.ru) | Короткий созвон 3–4 тыс. ₽; проработка резюме 3–12 тыс. ₽; полное сопровождение 30–100 тыс. ₽; на Profi.ru от 2 500–2 820 ₽ | https://hrtime.ru/material/kakova-realnaia-stoimost-uslug-i-pochemu-konsultantyeksperty-ee-obes-111641/ ; https://profi.ru/buhgaltery_i_yuristy/karernye-konsultanty/price/ |
| Мок-интервью (IT) | От 1 000 ₽; типично 3 000–8 000 ₽ за сессию; подписка IT-ХОЗЯЕВА 2 000 ₽/мес | https://ithozyaeva.ru/mock-interview ; https://hrtime.ru/uslugi/podgotovka-k-sobesedovaniiu/ |
| Конструкторы резюме | MyResume.ru: 149 ₽ за 7 дней полного доступа; скачивание PDF только платно. Обзоры на t-j.ru, kp.ru перечисляют 7–15 конструкторов, большинство с бесплатным уровнем | https://t-j.ru/list/resume-builder/ ; https://www.kp.ru/money/biznes/luchshie-konstruktory-rezyume/ |
| Телеграм-боты | Целевой поиск по ботам через веб-поиск результатов не дал («данные не найдены»); в обзорах vc.ru упоминаются десятки ботов-обёрток над ChatGPT. Ниша существует, но не структурирована | https://vc.ru/niksolovov/1775329-top-15-neirosetei-i-ii-dlya-podgotovki-voprosov-k-sobesedovaniyu-v-2026-godu |
| Xenia AI | ИИ-интервьюер **для работодателя** (звонит кандидату, задаёт вопросы, транскрибирует, ставит оценку); от 99 ₽ за интервью. Показательно: B2B-ИИ-интервью в РФ уже продаётся по 99 ₽ | https://xeniaai.com/ ; https://catalog.partners/products/xenia-ai |

### 2.2 Русскоязычные аналоги помощника во время собеседования

Они есть, их много, и все они продают именно «невидимость» и прослушивание звука:

| Сервис | Механика | Цены | Источник |
|---|---|---|---|
| Qompanion (qompanion.io) | Веб-приложение, перехватывает входящий звук Zoom, распознаёт вопрос, отправляет в ChatGPT с контекстом резюме/вакансии | 499 ₽ за одно собеседование; 2 499 ₽ за 7–9 сессий; демо бесплатно | https://setka.ru/posts/0198b95b-f12c-4938-8aca-45609c17339a ; https://vc.ru/id5433231/2317821-kak-ii-pomogaet-proyti-sobesedovanie |
| Vizir / Визирь (getvizir.com) | Нативные приложения macOS/Windows, слушает речь, подсказки по хоткею в оверлее «вне браузерного шеринга экрана»; серверы в РФ | Trial 3 дня / 60 мин; Start 990 ₽/мес (300 мин речи); Pro 1 990 ₽/мес (900 мин); оплата картой или криптой | https://getvizir.com/ ; https://vc.ru/services/3027018-ii-suflery-dlya-sobesedovaniy-obzor-servisov-dlya-russkoy-rechi |
| Enigma AI (enigmai.ru) | Десктоп, live-подсказки, лайвкодинг, system design, RAG; выбор модели (GPT‑4.1, Claude Sonnet 4.5, Opus); RU/EN | 150 бесплатных кредитов; «от 200 ₽ за собеседование», кредиты не сгорают; есть B2B-предложение | https://enigmai.ru/pricing ; https://enigmai.ru/ai-assistant/ |
| PsyKit (psykit.ru) | «Умные подсказки в реальном времени» | Цены в выдаче не найдены | https://psykit.ru/ |
| Sufler (sufler.tech) | Десктоп, слушает системный звук, «невидимый помощник» для собеседований и экзаменов; 30 мин бесплатно в день | Цены тарифов в выдаче не найдены | https://sufler.tech/ |

Обзор «ИИ-суфлёры для собеседований: сравнил 10 сервисов — какие понимают русскую речь и сколько стоит „невидимость“» на vc.ru (https://vc.ru/services/3027018-ii-suflery-dlya-sobesedovaniy-obzor-servisov-dlya-russkoy-rechi) — сам факт такого обзора показывает, что категория в русскоязычном сегменте сформирована и «невидимость» — её ключевой параметр сравнения.

Вывод по русскому рынку: свободных ниш две — (а) качественная **подготовка** для профессий вне IT (все суфлёры и мок-интервью — про IT), (б) **B2B** (вузы, центры занятости, учебные центры), где в РФ прямых аналогов Big Interview не найдено. Ниша live-суфлёра занята дешевле и «эффективнее» (с точки зрения покупателя), чем задуманный честный помощник.

---

## 3. Размер и особенности рынка

### 3.1 Конъюнктура

- hh‑индекс (резюме на вакансию) в марте 2026 — **11,4, исторический максимум**; ≥8 считается высокой конкуренцией. В январе 2026 активных вакансий на 30 % меньше, чем годом ранее, активных резюме — на 39 % больше. Официальная безработица 2,1–2,2 %. Источники: https://setka.ru/posts/019d90ae-e46c-7e33-8bae-b9cd067aae2c ; https://www.sostav.ru/blogs/286649/78232 ; https://hr-ratings.com/russian-labor-market-2026 ; https://stats.hh.ru/api/v1/monthly-report/f-983c2f9a-0568-4976-8b30-83bce102140b (страница недоступна из среды, цифры по выдержкам).
- Для продукта это двусторонне: соискателей больше и им труднее — мотивация готовиться растёт; но «рынок работодателя» означает, что многие сидят без офферов дольше и экономят.
- Наиболее конкурентные профобласти в марте 2026 — «рабочий персонал» и «продажи и обслуживание клиентов» (по выдержке setka.ru). Это как раз не‑IT аудитория, но с низким доходом.

### 3.2 Готовность платить

- Прямых опросов «готовы ли платить за помощь в поиске работы, %» **не найдено**. Косвенно: опрос июля 2026 (РИА/CNews) — каждый второй россиянин предпочитает искать работу без посторонней помощи; https://www.cnews.ru/news/line/2026-07-20_pri_poiske_novoj_raboty_kazhdyj ; https://ria.ru/20260720/rossijane-2105792808.html (текст недоступен из среды).
- HeadHunter, 2025: выручка 41,2 млрд ₽ (+4 %); «дополнительные услуги» — 6,6 млрд ₽ (+41,3 %). Эта строка включает не только услуги соискателям, точная доля соискательских платежей в выдаче не раскрыта. Источники: https://abn.agency/2026/03/13/headhunter-podvel-itogi-2025-goda-vyruchka-vyrosla-na-4/ ; https://www.vedomosti.ru/investments/news/2026/03/26/1185827-viruchka-headhunter
- Ценовые якоря, которые уже приняты рынком: 199–699 ₽ (hh PRO), 149 ₽/7 дней (MyResume), 499 ₽/сессия (Qompanion), 990–1 990 ₽/мес (Vizir), 4 900 ₽ (репетиция с человеком на hh), 3–12 тыс. ₽ (консультант).
- Использование ИИ при поиске работы: 62 % соискателей используют нейросети для резюме и писем (опрос Работа.ру и WMT Group, 2025); 24 % из 8 000 опрошенных Авито использовали ИИ для резюме; 18 % считают это «нечестным». Источники: https://practicum.yandex.ru/blog/kak-ispolzovat-ii-pri-poiske-raboty/ ; https://www.sostav.ru/publication/kazhdyj-vtoroj-soiskatel-obrashchaetsya-k-ii-dlya-otklika-na-vakansii-84691.html (первоисточник недоступен, цифры по выдержкам).

### 3.3 Рынок HR‑tech (B2B, для справки)

Smart Ranking: рынок HR‑tech РФ в I полугодии 2025 — 40,6 млрд ₽, +12 %; во II квартале рост 9 % — минимум за историю рейтинга; бюджеты на автоматизацию HR сокращаются, фокус смещается с найма на удержание. Источники: https://smartranking.ru/ru/analytics/hrtech/v-i-polugodii-2025-goda-rynok-hrtech-vyros-na-12-do-406-mlrd-rublej-odnako-tempy-rosta-ostayutsya/ ; https://tass.ru/ekonomika/25223745

Объём B2C‑рынка «платной подготовки к собеседованиям» в рублях — **данные не найдены**; оценку в деньгах не даю, чтобы не выдумывать. Порядок величины по якорям: если бы 1 % активных соискателей hh платил 500 ₽ в сезон, это единицы–десятки миллионов рублей в год на всех игроков — ниша для частного лица, а не для компании (это оценка, не факт).

### 3.4 Сезонность

Два пика активности — январь–февраль и сентябрь–октябрь; провал — декабрь и летние месяцы (кроме ретейла). Источники: https://t-j.ru/kogda-i-kak-iskat-rabotu/ ; https://potok.io/blog/hr-howto/sezonnost-v-naime-personala/ ; https://hirehi.ru/blog/smena-raboty-v-nachale-2026-pochemu-ianvar-luchshee-vremia-dlia-poiska-i-kak-podgotovitsya. Следствие: месячная подписка будет иметь высокий отток; разовые пакеты «на одно собеседование / на 7 дней» естественнее.

### 3.5 Каналы привлечения

- Яндекс Директ: средняя цена клика по рынку 2025 — около 24 ₽ (eLama), диапазон 20–300 ₽ по нишам; данных по нише «карьера/подготовка к собеседованию» не найдено. https://elama.ru/blog/stoimost-klika-v-yandeks-direkte/ ; https://www.demis.ru/articles/skolko-stoit-klik-v-yandeks-direkt/
- Органика: русскоязычные суфлёры продвигаются через vc.ru, DTF, Пикабу, Habr, YouTube Shorts и SEO по запросам «вопросы на собеседовании <профессия>» — это дешёвый, но медленный канал, доступный одному человеку.
- CAC по нише — данные не найдены. С учётом среднего чека 500–1 500 ₽ и разовой природы покупки платный трафик почти наверняка убыточен; ставка должна быть на контент/SEO.

### 3.6 Платёжная инфраструктура

- Владелец — физлицо. Самозанятый (НПД) может принимать оплату от физлиц через ЮKassa: без абонплаты, комиссия только с успешных платежей; лимит дохода по НПД — 2,4 млн ₽/год; поддерживаются периодические платежи/подписки (автоплатежи). Комиссия по вторичным источникам «от 0,4 % (вероятно СБП) … до ~3,5 % за карты» — точные ставки проверить в ЛК. Источники: https://yookassa.ru/platezhi-dlya-samozanyatyh/ (недоступно из среды) ; https://vc.ru/services/2652074-ukassa-dlya-samozanyatyh-podklyucheniye-tarify-otzyvy ; https://www.cleverence.ru/articles/elektronnaya-kommertsiya/-yukassa-dlya-ip-i-samozanyatyh-podklyuchenie/
- Альтернативы: CloudPayments (рекурренты, СБП), Robokassa (абонплата), Prodamus (проще подключение). https://vc.ru/gdekurs/1431073-17-vostrebovannyh-servisov-priema-platezhei-dlya-onlain-biznesa-v-2026-godu ; https://hellogc.blog/process/robokassa-ili-prodamus-sravnenie-servisov/
- При росте выше лимита НПД или для B2B понадобится ИП/ООО, онлайн‑касса (54‑ФЗ) и, для работы с ПДн, уведомление РКН об обработке (см. §4).

### 3.7 Доступ к зарубежным LLM и оплата API

- Россия не входит в список поддерживаемых стран Anthropic; карты российских банков (Visa/MC/Мир) отклоняются Stripe у OpenAI, Anthropic, xAI по BIN. Обходные пути — посредники/агрегаторы (OpenRouter и российские «туннели») с оплатой в рублях. Источники: https://botman.one/en/blog/post?post_id=181 ; https://profinvestment.com/how-pay-ai-russia/ ; https://crazyrouter.com/en/blog/anthropic-claude-api-payment-billing-guide-2026 (ненадёжный коммерческий источник).
- Юридически любая отправка ПДн (ФИО, контакты, тем более видео/голос) в зарубежный API — трансграничная передача (см. §4.1). Практический вывод: **данные с ПДн — только в российские модели (YandexGPT, GigaChat) или локальные**; зарубежные модели — только для обезличенного текста и через посредника, с пониманием, что это нарушает ToS провайдеров о регионе.
- Цены российских моделей (по вторичным источникам, июль 2026, ₽ с НДС): YandexGPT Lite 0,20 ₽/1 000 токенов; YandexGPT Pro 5.1 — 0,40–0,80 ₽/1 000 (источники расходятся). GigaChat‑2‑Lite ≈190–200 ₽/1 млн; GigaChat‑2‑Pro ≈1 455–1 500 ₽/1 млн; GigaChat‑2‑Max ≈1 852–1 950 ₽/1 млн; 1 млн бесплатных токенов в год (freemium). Источники: https://vc.ru/provod/3035416-yandexgpt-api-pervyj-zapros-i-raschet-stoimosti ; https://neurounit.ai/blog/yandex-ai-studio-tarify-i-api/ ; https://contextengineer.ru/gigachat-pricing-individuals/ ; https://developers.sber.ru/docs/ru/gigachat/tariffs/individual-tariffs (недоступно из среды).
- Зарубежные (USD за 1 млн токенов, вход/выход): Claude Haiku 4.5 $1/$5; Claude Sonnet 5 $2/$10 по справочнику Anthropic (кэш 24.06.2026), сторонние агрегаторы указывают $3/$15 — расхождение, проверить; Claude Opus 5 $5/$25; GPT‑4.1 mini $0.40/$1.60; GPT‑5.4 mini $0.75/$4.50. Кэширование промпта снижает цену входа до −90 %, батчи −50 %. Источники: https://benchlm.ai/anthropic/api-pricing ; https://www.metacto.com/blogs/unlocking-the-true-cost-of-openai-api-a-deep-dive-into-usage-integration-and-maintenance ; https://developers.openai.com/api/docs/pricing
- Распознавание речи: OpenAI gpt‑4o‑mini‑transcribe $0.003/мин, Whisper / gpt‑4o‑transcribe $0.006/мин (https://costbench.com/software/ai-transcription-apis/openai-whisper/). Yandex SpeechKit: по одному вторичному источнику потоковое распознавание 10–30 ₽/мин (https://plaan.ai/yandex-speechkit/) — цифра выглядит завышенной относительно официальной тарификации «за 15‑секундный блок» (https://aistudio.yandex.ru/docs/en/speechkit/pricing.html), официальную страницу открыть не удалось. **Проверить обязательно** — STT может оказаться самой дорогой статьёй голосовых тренировок.

---

## 4. Правовая и репутационная сторона

### 4.1 Законность подсказок во время собеседования в РФ

Сам факт получения подсказок кандидатом законом не запрещён — это не преступление и не правонарушение. Риски возникают из‑за того, **что именно попадает в сервис**: кадр экрана с лицом интервьюера, его речь, его имя, название компании, содержание вопросов.

**152‑ФЗ «О персональных данных».**
- Изображение лица и голос — персональные данные третьего лица (интервьюера). **Биометрическими** они становятся, только если оператор использует их для установления личности — такова позиция Роскомнадзора (разъяснения о фото/видео работников и о фотографиях для пропусков). Сервис, который читает экран ради текста вопроса, личность не устанавливает — значит, это «обычные» ПДн, а не биометрия. Но это снижает, а не снимает требования. Источники: https://www.garant.ru/news/1564374/ ; https://www.klerk.ru/buh/news/616826/ ; https://denuo.legal/ru/insights/news/I28/ (страницы недоступны из среды, суть — по выдержкам).
- Правовое основание обработки — согласие субъекта (ст. 6 152‑ФЗ) либо иное основание. Подтверждение пользователем «использование согласовано с работодателем» на первом запуске — **не является согласием интервьюера** и не переносит ответственность: если кадры уходят на сервер сервиса, оператором становится владелец сервиса; если обработка локальная и ничего не покидает компьютер — ближе к «личным и семейным нуждам» пользователя (ст. 1 ч. 2 п. 1 152‑ФЗ), но при отправке кадра в облачную LLM это исключение перестаёт работать.
- Трансграничная передача. С 1 июля 2025 запрещён первичный сбор ПДн россиян в иностранные базы (ч. 5 ст. 18 152‑ФЗ); передача за рубеж допустима только из российской базы и после **отдельного уведомления РКН**, который вправе запретить передачу. Отправка кадра/транскрипта с ПДн в OpenAI/Anthropic — трансграничная передача. Источники: https://e-office24.ru/news/transgranichnaya-peredacha-personalnykh-dannykh/ ; https://b-152.ru/transgranichnaya-peredacha-personalnyh-dannyh ; https://vfs.consulting/ai/transgranichnaya-peredacha-dannyh-v-ii-servisah/
- Штрафы по ст. 13.11 КоАП с 30 мая 2025: для **физлиц** за утечку биометрии 400–500 тыс. ₽ (повторно 500–800 тыс.), для ИП/организаций 15–20 млн ₽; за неуведомление РКН об утечке физлицу 50–100 тыс. ₽. Обычные ПДн — ниже, но тоже кратно выросли. Источники: https://www.consultant.ru/legalnews/28492/ ; https://buh.ru/articles/shtrafy-za-personalnye-dannye-s-30-maya-2025-goda-utechka-v-internet-neuvedomlenie-rkn-o-nachale-obr.html ; https://reviizor.ru/blog/shtrafy-personalnye-dannye-2026

**Статья 137 УК РФ (неприкосновенность частной жизни).** Состав требует незаконного собирания или распространения сведений о частной жизни, составляющих **личную или семейную тайну** (Пленум ВС № 46 от 25.12.2018). Деловой разговор о вакансии к личной тайне обычно не относится, а участник разговора вправе фиксировать его (суды принимают записи, сделанные стороной разговора). Уголовный риск для кандидата и для сервиса оцениваю как **низкий**, но он вырастает, если сервис хранит и тем более «делится» записями (как это было в утечке Cluely). Источники: https://www.consultant.ru/document/cons_doc_LAW_10699/4234a27af714cc608ea71b7bae9400f3613c8f60/ ; https://www.klerk.ru/razbory/audiozapis-razgovorov-bez-soglasiya-sobesednika-razbiraem-normy-zakona/ ; https://ppt.ru/art/personal-data/audiozapis-razgovorov-telefonnykh-i-lichnykh-bez-soglasiya-sobesednika

**Статья 152.1 ГК РФ (охрана изображения гражданина).** Обнародование и использование изображения (включая видеозапись) допускаются только с согласия гражданина. Внутренняя обработка кадра моделью без публикации — пограничная зона, прямой практики по «оверлеям» не найдено; гражданско‑правовой иск интервьюера маловероятен, но возможен, если кадры где‑то всплывут. https://journal.sovcombank.ru/zhizn/razreshena-li-zapis-razgovorov-bez-soglasiya

**Договорная сторона.** Если кандидат подписал правила отбора (Amazon, Anthropic и российские компании с «правилами интервью»), использование ИИ — основание для дисквалификации/отзыва оффера, а в трудовых отношениях — потенциально для увольнения по недоверию. Это не «незаконность», но именно так работодатели и реагируют (см. 4.3).

Итог по праву: **для честной, локальной, не хранящей ничего версии** правовой риск умеренный и в основном административный (152‑ФЗ при облачной обработке). **Для любой облачной версии с кадрами лица/голосом** — нужен статус оператора ПДн, уведомление РКН, российские серверы и модели, политика обработки, и всё равно нет основания обрабатывать данные интервьюера без его согласия.

### 4.2 Правила площадок видеосвязи

| Площадка | Что найдено |
|---|---|
| Zoom | ToS требуют соблюдать законы о согласии на аудио/видеозапись; пользователь «единолично отвечает» за уведомления и согласия; сторонние приложения могут получать контент встречи только в рамках разрешений. Прямого запрета на локальные оверлеи нет. https://www.zoom.com/en/trust/terms/ ; https://terms.law/ToS-Watchdog/video-conferencing/zoom/ |
| Google Meet | Acceptable Use Policy; в апреле 2026 введено требование **явного согласия участников** на запись, транскрипцию и заметки Gemini; администраторы могут удалять и блокировать сторонние приложения. Оверлей на стороне кандидата Meet не видит. https://support.google.com/meet/answer/9847091 ; https://workspaceupdates.googleblog.com/2026/04/require-explicit-consent-for-take-notes-with-Gemini-recordings-and-transcripts-in-Google-Meet.html ; https://support.google.com/a/answer/14670779?hl=en |
| Microsoft Teams | С весны 2026 Teams детектирует и помечает сторонние боты‑ассистенты и блокирует им транскрипты/сводки (уведомление MC1251206, март 2026). Локальный оверлей — вне досягаемости, но тренд на блокировку «незваных ИИ» очевиден. https://office365itpros.com/2026/03/16/third-party-recording-bots/ ; https://techcommunity.microsoft.com/discussions/microsoftteams/teams-meetings-to-block-third-party-recording-bots/4502502 |
| Яндекс Телемост | Встроенная запись — только организатору/подписчикам 360; при старте записи участники получают уведомление и **подтверждают согласие**. Про стороннее ПО — данных не найдено. https://meetscribe.ru/articles/kak-zapisat-vstrechu-telemost/ ; https://tobiz.net/support/rukovodstvo-po-ispolzovaniyu-yandeks-telemosta/ |
| Контур.Толк | Есть запись, транскрипция, трансляция; текст пользовательского соглашения по сторонним оверлеям — данных не найдено. https://kontur.ru/talk/features/zapis-vstrech |

Общий вывод: площадки идут в сторону явного согласия на любую ИИ‑обработку встречи. Оверлей на компьютере кандидата площадки технически не видят, но платформы **оценки** (HackerRank, CodeSignal, CoderPad) уже ловят глобальные хоткеи и оверлеи: в тесте апреля 2026 Interview Coder, Cluely и Final Round AI детектировались «на каждом прогоне» (источник — обзор конкурента Ultracode, заинтересованный: https://cybersecuritynews.com/ultracode-review-2026-we-tested-4-ai-interview-assistants-on-coderpad-hackerrank-and-codesignal-only-ultracode-stayed-undetectable/ ; https://www.shadecoder.com/blogs/can-using-interview-coder-get-you-flagged-on-codesignal-in-2026-honest-answer).

### 4.3 Позиция работодателей и рекрутеров

- **Amazon** прямо запрещает неразрешённые ИИ‑инструменты на интервью, кандидаты подтверждают правило; нарушение — дисквалификация. https://www.itpro.com/business/careers-and-training/amazon-bans-ai-tools-during-job-interviews ; https://tryassistly.com/blog/companies-that-allow-or-ban-ai-in-interviews-2026
- **Anthropic** в мае 2025 запретила ИИ в найме, в июле 2025 разрешила его для заявок и резюме, но **сохранила запрет на live‑интервью**. https://fortune.com/2025/07/21/billion-dollar-giant-anthropic-ai-ban-hiring-policy-change-job-seekers-interview-process
- **Google, McKinsey, Deloitte, Cisco** вернули обязательные очные раунды как ответ на ИИ‑мошенничество; по Gartner 72,4 % лидеров рекрутинга проводят очные интервью для борьбы с фродом; запросы на очные интервью выросли с ~5 % ролей в 2024 до ~30 % в 2025. https://www.computerworld.com/article/4044734/to-counter-ai-cheating-companies-bring-back-in-person-job-interviews.html ; https://blog.theinterviewguys.com/the-state-of-hiring-fraud-2026-when-38-5-of-candidates-are-cheating/
- **Gartner**: к 2028 году каждый четвёртый профиль кандидата в мире будет фейковым; 6 % из 3 000 опрошенных кандидатов признались в мошенничестве на интервью. https://www.hrdive.com/news/fake-job-candidates-ai/757126/
- Greenhouse: 91 % из 4 000 нанимающих менеджеров сталкивались или подозревали ИИ‑ответы на интервью (по выдержке, первоисточник не открыт). Данные «38,5 % кандидатов помечены» — от вендора детекции Sherlock (https://www.sherlock.sh/blog/ai-interview-cheating-statistics), заинтересованный источник.
- **Россия**: по SuperJob, 36 % рекрутеров сталкивались с кандидатами, использующими ИИ при отборе, и только 3 % узнали об этом от самих кандидатов; рекрутеры «научились вычислять» по бегающему взгляду и паузам после каждого вопроса. https://www.osnmedia.ru/obshhestvo/rekrutery-nauchilis-vychislyat-kandidatov-polzuyushhihsya-ii-na-sobesedovanii/ ; https://incrussia.ru/robots/ai-hr-ai-employee/ ; https://habr.com/ru/articles/979740/. Публичных случаев отзыва офферов в РФ именно за ИИ‑суфлёр в выдаче не найдено; явных публичных запретов у Яндекса/Сбера тоже не найдено (у Яндекса в 2026 — единая система оценки и обязательные fit‑интервью: https://proglib.io/p/krizis-nayma-v-it-pochemu-yandeks-i-sber-uslozhnyayut-sobesedovaniya-vmesto-togo-chtoby-ih-uproshchat-2026-05-01).

Вывод: индустрия реагирует не запретами продуктов, а изменением формата (очные раунды, прокторинг, детекторы). Любой live‑помощник — товар с сокращающимся окном применимости.

### 4.4 Судьба известных продуктов ниши

- **Interview Coder → Cluely.** Рой Ли построил инструмент, прошёл с ним интервью в Amazon, выложил запись, получил оффер, был отстранён от Columbia (до 20.05.2026); компания привлекла $5.3M, затем $15M от a16z при оценке ~$120M (июнь 2025). Летом 2025 заявляла $7M ARR — в марте 2026 Ли **признал, что это была ложь**. В 2025 — сообщения об утечке данных 83 000 пользователей (транскрипты интервью и скриншоты; отчёт не подтверждён мейнстрим‑СМИ) и уязвимость в Electron‑приложении, позволявшая сайтам непрерывно снимать скриншоты. Cluely **ушла от «cheat on everything» к ИИ‑конспектору встреч** за $20/мес. Источники: https://gizmodo.com/a-student-used-ai-to-beat-amazons-brutal-technical-interview-he-got-an-offer-and-someone-tattled-to-his-university-2000571562 ; https://en.wikipedia.org/wiki/Cluely ; https://techcrunch.com/2026/03/05/cluely-ceo-roy-lee-admits-to-publicly-lying-about-revenue-numbers-last-year/ ; https://www.inc.com/leila-sheridan/an-a16z-backed-startup-that-helps-people-cheat-on-job-interviews-just-got-caught-in-a-7-million-lie-the-ceo-was-sweating/91313070 ; https://zaasmi.com/blog/is-cluely-safe-data-breach-2026 ; https://www.bluedothq.com/blog/cluely-review
- **Interview Coder** как отдельный бренд продолжает продаваться ($299/мес, $799 lifetime), его маркетинг целиком построен на «невидимости», при этом сторонние тесты фиксируют детекцию на HackerRank/CodeSignal/CoderPad. https://prachub.com/resources/interview-coder-review-2026-pricing-detection-risks-and-ethical-alternatives
- **Final Round AI** — жив, VC‑backed, но с репутационным шлейфом по биллингу (см. §1).
- **Google Interview Warmup** — закрыт (апрель 2026).

Паттерн: рынок принимает такие продукты как хайп, деньги приходят от VC на скандале, потом продукт либо пивотится в «легальную» нишу (заметки встреч), либо остаётся в серой зоне с высокими ценами и токсичной репутацией.

### 4.5 Магазины приложений и антивирусы

- Google Play: политика Deceptive Behavior прямо запрещает сервисы, «enabling academic dishonesty» (генераторы эссе и т.п.) и обманное описание функций — helper для «сдачи экзаменов и собеседований» (как позиционируется Sufler) в эту формулировку попадает. https://support.google.com/googleplay/android-developer/answer/9888077 ; https://play.google/developer-content-policy/
- Apple App Store: гайдлайны не содержат явного пункта про «читинг на собеседовании»; в App Store есть приложения «Interview Coder App» и «Coderly», то есть модерация пропускает при нейтральном описании. Но десктоп‑помощник с захватом экрана в Mac App Store не пройдёт из‑за песочницы — распространение только вне стора с нотаризацией. https://developer.apple.com/app-store/review/guidelines/ ; https://apps.apple.com/no/app/interview-coder-app/id6751876614
- Windows: неподписанные Electron‑приложения регулярно ловят SmartScreen «неизвестное приложение» и ложные срабатывания Defender; лечится сертификатом подписи (EV — дорого для физлица) и накоплением репутации. https://learn.microsoft.com/en-us/answers/questions/1274558/false-positive-when-submitting-app-windows-protect ; https://www.advancedinstaller.com/prevent-smartscreen-from-appearing.html
- Программа, которая одновременно «прозрачное окно поверх всего» + «читает экран» + «шлёт в сеть», — классический профиль поведения spyware для эвристик антивирусов; ложные срабатывания следует считать нормой, а не исключением (оценка на основе описанных выше кейсов, прямых тестов не найдено).

---

## 5. Бизнес‑модель

### 5.1 Разумность трёх уровней

Три уровня в задуманном виде — не очень удачны:
- Первый («Резюме и подготовка») конкурирует с бесплатными hh/Авито/GigaChat — за него платить не будут, разве что символически.
- Второй («Тренировки») — единственный, где есть понятная ценность (интервью с разбором) и якорь цены (мок‑интервью с человеком 3–8 тыс. ₽, репетиция на hh 4 900 ₽).
- Третий («С помощником») тянет весь продукт в категорию «читинг» и делает невозможным B2B.

Кроме того, подписка плохо ложится на сезонный, разовый сценарий. У конкурентов это видно по lifetime‑планам и «пакетам сессий».

### 5.2 Предлагаемая сетка (обоснование — якоря из §2, §3)

| Тариф | Цена | Что входит | Обоснование |
|---|---|---|---|
| **Бесплатно** | 0 ₽ | 1 версия резюме, 1 вакансия с сопоставлением, 10 вопросов с разбором, 1 короткое текстовое интервью (5 вопросов). Экспорт резюме в PDF — бесплатно (это крючок, MyResume берёт за это деньги) | Нужен для SEO/сарафана; себестоимость ~5–15 ₽ на пользователя |
| **«Одно собеседование» (разовый, 7 дней)** | 490 ₽ | 1 вакансия, безлимит вопросов, 5 текстовых + 2 голосовых интервью по ~15 мин, итоговые разборы, PDF‑«шпаргалка» ответов | Прямой аналог Qompanion 499 ₽/сессия, дешевле репетиции с человеком в 10 раз; отвечает сезонности |
| **«Подготовка» (месяц)** | 990 ₽/мес или 1 990 ₽/3 мес | До 10 вакансий, безлимит текстовых интервью, 8 голосовых (~15 мин), история версий, сравнение «было/стало» | Между hh PRO 699 ₽ и Vizir 990–1 990 ₽; тем, кто ходит по многим собеседованиям |
| **Доп. голосовое интервью** | 99 ₽ | 1 сессия до 20 мин | Страховка от STT‑расходов на «тяжёлых» пользователях |
| **«С помощником»** | — | **Не запускать** (см. §6). Если владелец всё же настаивает — только как «карточка подготовки на втором экране/телефоне» без чтения экрана и звука, включённая в «Подготовку» бесплатно | Отдельный платный live‑уровень = позиционирование «суфлёр», которое закрывает B2B и создаёт правовые риски |
| **B2B (позже)** | от 15–30 тыс. ₽/мес за 50–100 мест (оценка) | Учебные центры, карьерные центры вузов, центры занятости, HR‑агентства аутплейсмента | Аналог Big Interview (700+ вузов); в РФ прямого аналога не найдено; Xenia AI показывает, что B2B‑ИИ‑интервью по 99 ₽ уже покупают |

Все цены — предложение, а не результат тестов. Их нужно проверить A/B на первых 200–300 пользователях.

### 5.3 Юнит‑экономика (оценка)

Допущения на одного платящего пользователя тарифа «Подготовка» в месяц (оценка, не измерение):
- 3 разбора резюме × (5 тыс. вход / 2 тыс. выход токенов);
- 5 сопоставлений × (5 тыс. / 2 тыс.);
- 5 списков вопросов × (6 тыс. / 3 тыс.);
- 4 текстовых интервью × 10 реплик с растущим контекстом ≈ 80 тыс. вход / 5 тыс. выход каждое;
- 4 голосовых интервью × 15 мин STT + LLM как текстовое;
- итого ≈ **430 тыс. входных и 45 тыс. выходных токенов + 60 мин STT** (без кэширования; с кэшем промпта вход дешевле на 50–90 %).

Себестоимость модели на пользователя в месяц (только LLM, по ценам §3.7):

| Модель | Расчёт | Итого |
|---|---|---|
| Claude Haiku 4.5 | 0,43×$1 + 0,045×$5 | ≈ $0.66 |
| Claude Sonnet 5 | 0,43×$2–3 + 0,045×$10–15 | ≈ $1.3–2.0 |
| GPT‑4.1 mini | 0,43×$0.40 + 0,045×$1.60 | ≈ $0.24 |
| YandexGPT Lite | 475 тыс. × 0,20 ₽/тыс. | ≈ 95 ₽ |
| YandexGPT Pro 5.1 | 475 тыс. × 0,40–0,80 ₽/тыс. | ≈ 190–380 ₽ |
| GigaChat‑2‑Lite | 0,475 × ~200 ₽ | ≈ 95 ₽ |
| GigaChat‑2‑Pro | 0,475 × ~1 500 ₽ | ≈ 710 ₽ |

STT: 60 мин × $0.003–0.006 (OpenAI) ≈ $0.18–0.36; по SpeechKit — при цифре 10–30 ₽/мин это 600–1 800 ₽ (нужно проверить — при таком тарифе голосовые интервью на российском STT убыточны при цене 990 ₽).

Прочее: эквайринг ~3–3,5 % (≈35 ₽ с 990 ₽), НПД 4 % (≈40 ₽), хостинг/домен — при 100–500 пользователях 1–3 тыс. ₽/мес суммарно (оценка).

Валовая маржа при цене 990 ₽/мес:
- зарубежная «мини»‑модель через посредника (+наценка посредника 10–30 %, курс — допущение ~85 ₽/$): себестоимость ≈ 100–250 ₽ → маржа **75–90 %**;
- YandexGPT Lite / GigaChat Lite (законно для ПДн): ≈ 95 ₽ + STT → маржа **80–90 %** при дешёвом STT, **отрицательная** при STT 10–30 ₽/мин;
- YandexGPT Pro / GigaChat Pro: 200–700 ₽ → маржа **20–75 %**.

Вывод: экономика **позволяет** работать на российских моделях, если (а) голосовые интервью лимитированы и (б) STT дешевле ~2 ₽/мин. Реальная угроза марже — не LLM, а привлечение: при CAC даже 300–500 ₽ и среднем LTV ≈ 1–1,5 покупки по 490–990 ₽ (сезонный, разовый продукт — оценка) бизнес на платном трафике не сходится.

Помощник на собеседовании по себестоимости дёшев (20 подсказок × ~7 тыс. токенов с изображением ≈ $0.15–0.45 за интервью на Haiku/Sonnet) — но это не аргумент «за», см. §6.

### 5.4 Альтернативные модели монетизации

1. **Разовые покупки** («одно собеседование» 490 ₽, «разбор резюме» 199 ₽) — лучше подписки для этого рынка; так работают Qompanion и Enigma.
2. **B2B для учебных центров и вузов** — единственный масштабируемый канал в категории (Big Interview, Yoodli Enterprise). В РФ: карьерные центры вузов (у ВШЭ есть страница «конструкторы резюме»: https://career.hse.ru/cvmaker), онлайн‑школы (Skillbox, Нетология, Практикум продают трудоустройство как часть курса), центры занятости («Работа России»). Тариф — за места, с брендингом. Требует ИП/ООО, договоров, поддержки.
3. **B2B для работодателей** — ИИ‑интервьюер уже есть (Xenia AI по 99 ₽, hh ИИ‑ассистент). Входить с нуля бессмысленно, но можно продавать «предподготовку кандидата» работодателям массового найма (ретейл, логистика), чтобы снизить неявку — это гипотеза, подтверждений спроса не найдено.
4. **Партнёрство с job‑бордами** — hh/Авито делают своё; мелкие борды (Superjob, Зарплата.ру, региональные, отраслевые) — возможны white‑label‑виджеты «подготовься к этой вакансии». Конкретных программ партнёрства в выдаче не найдено.
5. **White label для карьерных консультантов** — они берут 3–12 тыс. ₽ за резюме и 3–8 тыс. за мок‑интервью; ИИ‑инструмент под их брендом за 1–3 тыс. ₽/мес удешевляет их работу. Рынок мелкий, но продажа «в руки» одному человеку посильна.
6. **Партнёрка с онлайн‑школами** — они продают «гарантию трудоустройства»; бесплатный доступ их выпускникам в обмен на оплату за место.

---

## 6. Сильные и слабые стороны продукта

### Сильные стороны
- Целостный сценарий «резюме → вакансия → сопоставление → вопросы → тренировка → разбор» в одном месте; у русских конкурентов этого нет (они либо резюме, либо суфлёр).
- Честные статусы «Подтверждено / Нужно уточнить / Не указано» — правильная механика для доверия и для того, чтобы пользователь **улучшал резюме**, а не гнался за цифрой.
- Свободная профессия и библиотека вне IT — реальная дыра у русских конкурентов.
- Аккуратная работа с версиями (устаревание отчёта при изменении резюме/вакансии) — хороший продуктовый признак.
- Готовый слой провайдеров (Anthropic/OpenAI/Gemini/локальная) даёт свободу переключиться на российские модели.

### Слабые стороны
- Нет ни одной функции, которой нельзя добиться промптом в бесплатном GigaChat/Алисе/ChatGPT; ценность — в удобстве и структуре, а за это в РФ платят неохотно.
- Продукт разовый и сезонный; подписка обречена на высокий отток.
- Один человек без юрлица: B2B (главный канал денег в категории) недоступен без ИП/ООО.
- Зависимость от LLM‑провайдеров, для российских пользователей — только российские или «серые» зарубежные.
- Помощник на собеседовании (ниже).

### Ставка на профессии вне IT — преимущество или распыление?
Скорее преимущество как **позиционирование**, но распыление как **объём работы**. Данные: «синие воротнички» — 49 % занятых, в марте 2026 самая высокая конкуренция именно в «рабочем персонале» и «продажах» (https://wciom.ru/analytical-reviews/analiticheskii-obzor/rabochie-professii-monitoring ; выдержки setka.ru). Но для повара, водителя и продавца собеседование — короткий разговор, часто по телефону, и готовность платить 500–1 000 ₽ за подготовку к нему сомнительна (доказательств спроса нет). Рекомендация: **сузить до офисных не‑IT профессий** (бухгалтер, менеджер по продажам, маркетолог, HR, юрист, администратор, учитель/репетитор) — там есть многоэтапные интервью, есть деньги, и нет русскоязычных конкурентов. Восемь готовых комплектов, включая повара и водителя, оставить как демонстрацию широты, но не тратить на них силы.

### Отказ от общего процента соответствия — плюс или минус?
Для пользователя — плюс (нет ложной точности, есть действия). Для маркетинга — минус: «ваше резюме на 63 % подходит» — самый кликабельный экран у Jobscan/Teal и главный шеринг‑крючок. Компромисс: показывать **счётчик «8 из 12 требований подтверждено»** и цветную шкалу без процента — это честно (обзоры Jobscan сами признают, что процент — прокси) и при этом даёт шеримый результат.

### Помощник на собеседовании — козырь или риск? Прямой ответ
**Риск, и в текущей задумке — ещё и нерабочий продукт.** Причины:
1. Он не делает того, за что платят в этой категории: не скрывается и не слушает звук. Покупатель суфлёра платит за невидимость и за то, что сервис **слышит вопрос** (Qompanion, Vizir, Enigma, Sufler — все слушают звук). Прототип читает только экран, а на обычном видеособеседовании вопрос произносится голосом и на экране не появляется. То есть подсказки будут только на письменных заданиях/чате — узкий случай.
2. Если сделать его рабочим (звук + скрытие), он становится тем же суфлёром, что и пять существующих русскоязычных, с их правовыми рисками (§4.1) и с уже сложившимися ценами 200–1 990 ₽. Конкурировать пришлось бы «невидимостью», которая ловится прокторингом и обесценивается очными раундами.
3. Само наличие этого уровня в продукте закрывает дорогу к B2B (вузам и работодателям), а B2B — единственный масштабируемый канал денег в нише.
4. Кейс Cluely показывает верхнюю границу: даже с $20M инвестиций и хайпом продукт пришлось пивотить в заметки встреч, а по пути — ложь об ARR, утечка транскриптов, отстранение из университета.
5. Правовая нагрузка ложится на владельца‑физлицо: кадры чужого лица и голоса без согласия, трансграничная передача, штрафы по 13.11 КоАП для физлиц от сотен тысяч рублей.

Что оставить вместо него: «**карточка подготовки**» — сгенерированная перед интервью краткая шпаргалка (ключевые тезисы, цифры, ответы на вероятные вопросы), открываемая на телефоне или втором экране; она не читает экран, не слушает, никого не нарушает — и решает 70 % задачи «не растеряться». Плюс «**разбор после**»: пользователь надиктовывает, что спрашивали и что отвечал, и получает разбор и план на следующий раунд. Оба варианта — честные и продаваемые B2B.

### Что выпустить первым, малыми силами
Веб‑инструмент без регистрации: **вставь текст вакансии + вставь/загрузи резюме → сопоставление по требованиям + 15 вероятных вопросов с подсказками + одно текстовое интервью на 5 вопросов с разбором**. Бесплатно, с лимитом 1 вакансия/день; платно 490 ₽ — снять лимит на 7 дней и получить голосовое интервью. Модель — YandexGPT Lite/GigaChat Lite (данные не покидают РФ), без хранения резюме на сервере дольше сессии. Это проверяет три гипотезы сразу: есть ли органический спрос вне IT, конвертирует ли разовая покупка, какова реальная себестоимость.

---

## 7. Рекомендации по приоритетам

### Ближайшие 1–3 месяца
1. **Убрать помощника на собеседовании из дорожной карты и с экрана тарифов.** Заменить на «карточку подготовки» и «разбор после интервью». Причины — §6. Это ещё и снимает большую часть работы по 152‑ФЗ.
2. **Подключить настоящую модель к веб‑прототипу** (это уже сделанный слой `shared/ai`), выбрав российского провайдера для всего, что содержит ПДн; зарубежные модели — только для обезличенного текста. Замерить реальный расход токенов на пользователя, а не оценку из §5.3.
3. **Выпустить минимальный публичный инструмент** («вакансия + резюме → вопросы + интервью») без регистрации, с лимитами, и подключить ЮKassa для самозанятого с разовой покупкой 490 ₽. Не делать подписку до появления повторных покупок.
4. **Сузить профессии** до офисных не‑IT + IT‑джуниоры; собрать по 30–50 реальных вопросов с собеседований на каждую (форумы, Пикабу, Habr, отзывы на dreamjob.ru) — качество банка вопросов важнее ИИ‑обёртки.
5. **Замерить STT.** Не запускать голос, пока не подтверждена цена распознавания ≤2 ₽/мин на российском провайдере или не решён вопрос с зарубежным.
6. **Юридический минимум**: политика обработки ПДн, согласие пользователя на обработку его резюме, хранение резюме не дольше нужного, серверы в РФ, уведомление РКН об обработке (при хранении на сервере). Формулировки прототипа — «черновик», как честно сказано в README; до запуска нужен просмотр юристом.
7. **Дистрибуция**: 2–3 статьи на vc.ru/Пикабу/Habr формата «разобрал 50 вопросов для бухгалтера», SEO‑страницы «вопросы на собеседовании <профессия>», а не Директ.

### Через 3–9 месяцев (если есть повторные покупки и >100 платящих)
8. Голосовое интервью с итоговым разбором как главный платный сценарий (это то, за что готовы платить 3–8 тыс. ₽ живому человеку).
9. Сравнение версий «было/стало» и PDF‑экспорт как бесплатный крючок.
10. Оформить ИП, сделать B2B‑предложение 3–5 карьерным центрам вузов и 2–3 онлайн‑школам с «гарантией трудоустройства»; white‑label для карьерных консультантов.
11. Тестировать «счётчик требований» вместо процента как шеримый экран.

### От чего отказаться
- От live‑помощника поверх экрана (в любом виде, честном или нет).
- От месячной подписки как основной модели — до подтверждения повторных покупок.
- От захвата экрана/звука и десктопного приложения вообще: подпись кода, антивирусы, магазины, поддержка Windows/macOS — не по силам одному человеку и не окупятся.
- От «всех профессий сразу»: библиотека — маркетинг, фокус — 6–8 офисных профессий.
- От зарубежных LLM для данных с ПДн.

### Честный итог
Как самостоятельный B2C‑бизнес продукт, скорее всего, **не выйдет на значимую выручку**: ниша переполнена бесплатными и дешёвыми аналогами, покупка разовая и сезонная, платный трафик убыточен, а единственный «дифференциатор» (помощник) — токсичен. Реалистичные исходы: (а) небольшой доход самозанятого от разовых покупок при органическом трафике; (б) B2B‑инструмент для 5–20 учебных/карьерных центров — единственный путь к устойчивым деньгам, но он требует юрлица и продаж «ногами». Оба сценария не нуждаются в помощнике на собеседовании — и оба им обнуляются.
