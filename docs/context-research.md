# Исследование: управление контекстом длинных сессий

Дата: 6 сентября 2026. Исходный коммит: `cffca05`. Часть 0 плана из `PROMPT_CONTEXT_IMPLEMENTATION`.

## 1. Разведка репозитория

### Состояние

- Ветка `claude/new-session-cp5tel`, HEAD = `origin/main` = `cffca05`, рабочее дерево чистое.
- Node 22.22.2, npm 10.9.7, playwright 1.56.1, встроенный SQLite 3.51.2 (`node:sqlite`, экспериментальный).
- Baseline: `test:shared` 70/70, `test:server` 58/58, `test:web` 73/73, `test:live` 26/26. Ошибок нет.

### Карта потока: маршрут → задача → данные → сборка → провайдер → расход → сохранение

| Маршрут (`server/routes/api.js`) | taskId | Источники | Сборщик | Сериализация | Провайдер | Расход | Куда сохраняется |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /api/vacancies` → `ensureRequirements` | `vacancy.parse` | `vacancies.raw_text` | `ai.buildStore` → слои identity/preparation | `AiPrompts.buildUser` (секции `[…]`) + `buildSystem` | `Providers.execute` → адаптер по `AI_PROVIDER` | `db.usage.record` | `vacancies.requirements` |
| `POST /api/preps` → `buildMatch` | `match.requirements` | `resumes.data`, `vacancies.requirements` | то же | то же | то же | то же | `preps.match` |
| `POST /api/preps/:id/questions` | `questions.generate` | резюме, требования, `preps.match` → weakSpots | то же | то же | то же | то же | `preps.questions` |
| `POST /api/resumes/:id/review` | `resume.review` | `resumes.data` | то же | то же | то же | то же | `resumes.review` |
| `POST /api/preps/:id/card` | `prep.card` | + `preps.answers` | то же (`includeAnswers`) | то же | то же | то же | `preps.card` |
| `POST /api/preps/:id/interviews`, `…/turns`, `…/continue` → `interviewerTurn` | `interview.turn` | + `interviews.turns` (все) | `buildStore` добавляет **все** реплики через `store.addTurn` → окно 12 + свёртка | то же, streaming | `readStream` (SSE) | usage **null → 0** | `interviews.turns` (append) |
| `POST /api/interviews/:id/finish` | `interview.summary` | + все реплики | то же | то же | то же | то же | `interviews.summary` |

Символы: `server/lib/ai.js: buildStore, run`; `shared/context/store.js: create, addTurn, foldTurns, build, truncateLayer, estimateTokens`; `shared/ai/request.js: build, defaultsFor, parseJson`; `shared/ai/prompts.js: buildSystem, buildUser, section, allows, neutralize`; `shared/ai/providers/index.js: execute, readStream, adapter`; `server/lib/db.js: interviews.setTurns/finish, usage.record`.

Клиент: `src/api.js` (`request`, `stream`), `src/app.js` (`liveSendChat`, `liveFinishChat`), `src/screens-prep.js` (`interview`, `interviewSummary`).

### Проверка гипотез по текущему коду

| # | Гипотеза | Результат | Где |
| --- | --- | --- | --- |
| 1 | История уже ограничена | **Подтверждено**: окно 12 реплик по умолчанию, вытесненное уходит в свёртку. Стенограмма целиком не отправляется | `store.js:83,118` |
| 2 | Свёртка теряет отрицания, числа, ранние факты | **Подтверждено**: каждая вытесненная реплика режется до 157 символов, затем свёртка режется с начала до лимита | `store.js:134,140` |
| 3 | Свёртка пересобирается из всех реплик на каждом вызове; `resume.summary` не переносится | **Подтверждено** оба пункта: `parts.turns.forEach(addTurn)` на каждом запросе; в `preparation` нет `summary` | `server/lib/ai.js:96, 74-86` |
| 4 | Нет жёсткого предела после сериализации | **Подтверждено**: усечение по слоям и оценке до сериализации; итоговая длина запроса не проверяется | `store.js: build`, `request.js: build` |
| 5 | Таймаут не покрывает чтение тела/SSE | **Подтверждено**: таймер снимается в `finally` после `fetch`, `readStream` идёт без ограничения | `providers/index.js:105,124` |
| 6 | Usage при потоке пишется как ноль | **Подтверждено**: `readStream` возвращает `usage: null`, сервер записывает 0 | `providers/index.js:200-202`, `server/lib/ai.js:129` |
| 7 | Неизвестный провайдер тихо становится mock | **Подтверждено**: `ADAPTERS[id] || mock`, `PROFILES[id] || PROFILES.mock`; `describe().live` при этом `true` | `providers/index.js:29`, `capabilities.js:201` |
| 8 | Предел вывода включает рассуждение; у OpenAI-совместимых нет управления thinking | **Подтверждено**: управление есть только у Anthropic (`output_config.effort`); в общем адаптере параметров рассуждения нет | `providers/openai.js`, `anthropic.js:43` |

Дополнительно найдено: `estimateTokens` — символы/3 без пометки «оценка»; расход по попыткам не разделяется (повторы внутри `execute` не видны в `usage`); в `usage` нет `requestId`, фазы и статуса «неизвестно».

## 2. Провайдеры моделей с открытыми весами

Политика продукта по документу владельца: только открытые веса; OpenAI (включая GPT-OSS), Anthropic и Google исключены. Международные хостеры допустимы как кандидаты.

**Ограничение среды:** сайты `openrouter.ai`, `inference-docs.cerebras.ai`, `console.groq.com` заблокированы прокси рабочей среды. Ниже — факты из поисковых выдержек и документации, которые дошли через поиск; они помечены как *непроверенные напрямую*. Перед боевым запуском формы запросов сверить с документацией конкретного сервиса.

| Хостер | Endpoint (по выдержкам) | Формат | Streaming usage | Кэш префикса | Рассуждение | Источник, дата доступа |
| --- | --- | --- | --- | --- | --- | --- |
| Cerebras | `https://api.cerebras.ai/v1/chat/completions` | OpenAI-совместимый | заявлен захват usage; форма при stream — *не проверено* | *не найдено* | *не найдено* | [promptfoo/cerebras](https://www.promptfoo.dev/docs/providers/cerebras/), [openobserve](https://openobserve.ai/docs/integration/ai/providers/cerebras/), 06.09.2026 |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | OpenAI-совместимый («mostly») | reasoning и cached tokens в usage при stream — *по выдержке для gpt-oss*, для других моделей не проверено | автоматический по общему префиксу | `reasoning_format` (не для всех моделей) | [console.groq.com/docs/openai](https://console.groq.com/docs/openai), [reasoning](https://console.groq.com/docs/reasoning), 06.09.2026 |
| Fireworks | `https://api.fireworks.ai/inference/v1/chat/completions` | OpenAI-совместимый; ID моделей `accounts/fireworks/models/<имя>` | *не проверено* | заявлен | *не проверено* | [docs.fireworks.ai/tools-sdks/openai-compatibility](https://docs.fireworks.ai/tools-sdks/openai-compatibility), 06.09.2026 |
| Together | `https://api.together.xyz/v1/chat/completions` | OpenAI-совместимый; ID с пространством имён | *не проверено* | *не найдено* | *не проверено* | [docs.together.ai/docs/openai-api-compatibility](https://docs.together.ai/docs/openai-api-compatibility), 06.09.2026 |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | OpenAI-совместимый; объект `provider` с `order`, `allow_fallbacks`, `only`, `ignore` | `"usage": {"include": true}` → `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`, `cost`; при stream — в последнем событии | зависит от upstream; `cache_write_tokens` только у моделей с явным кэшем | зависит от модели | [usage-accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [provider-selection](https://openrouter.ai/docs/guides/routing/provider-selection), 06.09.2026 |

Выводы (не факты документации):
- Все пять — один формат запроса, отличается адрес, имена моделей и **расширения** (`provider`, `usage.include`, `reasoning_format`). Значит, существующий адаптер `openai.js` расширяется профилями, а не пятью новыми адаптерами.
- Сортировка по latency/throughput у OpenRouter в выдержках не описана как SLA — считать предпочтением. TPS из маркетинга хостеров — не наше измерение.
- Доступность конкретной модели у конкретного хостера проверяется только живым запросом к каталогу; в код цены не зашивать.
- `usage` при потоке приходит **в последнем событии** (OpenRouter явно; у OpenAI-совместимых обычно нужен `stream_options: {include_usage: true}` — *не проверено для каждого хостера*). Пока usage не пришёл — статус «неизвестно», не ноль.

## 3. Готовые решения для памяти диалога

| Решение | Что даёт | Runtime и лицензия | Стоимость владения | Источник |
| --- | --- | --- | --- | --- |
| LangChain.js `trimMessages` (`@langchain/core`) | Обрезка истории по `tokenCounter`, `strategy: first/last`, `includeSystem`, `allowPartial`, `startOn/endOn`. Суммаризация — отдельными цепочками | Node 20/22/24, MIT | Пакет `@langchain/core` ради одной функции; `tokenCounter` всё равно свой; известные issue: не иммутабельна (#7582), сложные сообщения (#8336) | [reference](https://reference.langchain.com/javascript/langchain-core/messages/trimMessages), [repo](https://github.com/langchain-ai/langchainjs), 06.09.2026 |
| LlamaIndex.TS memory (`createMemory`, `tokenLimit`, `shortTermTokenLimitRatio`, блоки с приоритетом) | Кратко- и долгосрочная память с усечением по приоритетам, суммаризация в блоке | Node, MIT | Тянет `llamaindex` целиком; своя модель сообщений; суммаризация требует их LLM-обёртки | [developers.llamaindex.ai/typescript/…/memory](https://developers.llamaindex.ai/typescript/framework/modules/data/memory/), 06.09.2026 |
| Mem0 | Извлечение фактов в память с семантическим поиском, entity linking | Python-сервер + Docker Compose + векторная БД (Qdrant) + LLM для извлечения; есть npm SDK к серверу/облаку. Apache-2.0 | Отдельный сервис и БД; факты извлекает LLM (свой расход); данные — во внешнем контуре, если облако | [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0), 06.09.2026 |
| Letta | Агентная память с редактируемыми блоками | Проект переехал в `letta-code`; npm-пакет, локальный режим и облако. Apache-2.0 | Это агентный runtime, а не библиотека памяти для встраивания; свой сервер/процесс | [github.com/letta-ai/letta](https://github.com/letta-ai/letta), 06.09.2026 |
| Текущий `shared/context/store.js` | Слои, окно, свёртка, усечение по слоям | Уже в проекте, без зависимостей | Дефекты 2–4 выше | — |

### Точный подсчёт токенов

- `@huggingface/tokenizers` 0.1.3, Apache-2.0: лёгкий токенизатор для Node/браузера, читает `tokenizer.json` модели (Qwen2.5/Qwen3 — на Hugging Face Hub). Нужен файл токенизатора локально (несколько МБ) или загрузка при первом запуске.
- `@huggingface/transformers` 4.2.0, Apache-2.0: тяжелее, тот же `AutoTokenizer`.
- Вывод: точный счётчик — **опциональная** зависимость. Без него — консервативная оценка с явной пометкой `exact: false` и запасом; шаблон чата и служебные токены учитываются константой на сообщение.

### Полнотекстовый поиск

Проверено локально: `node:sqlite` 3.51.2 содержит **FTS5, включая tokenizer `trigram`** и FTS4. Trigram даёт поиск по подстроке для русского без стеммера — достаточно для отбора evidence по requirementId и словам вопроса. Embeddings и векторная БД не нужны на этом этапе.

## 4. Итоговая таблица решений

| Область | Решение | Почему |
| --- | --- | --- |
| Обрезка истории | **Оставить свой код**, расширить | `trimMessages` не покрывает слои и провenance; `tokenCounter` всё равно свой |
| Суммаризация / память | **Заимствовать паттерн** (LlamaIndex: блоки с приоритетами; Mem0: факты с источником), реализовать в `shared/context` и `server/lib` | Внешний сервис + векторная БД + LLM-извлечение — неоправданная инфраструктура для одного процесса на SQLite |
| Точный счётчик токенов | **Опциональная библиотека** `@huggingface/tokenizers` + локальный `tokenizer.json`; иначе помеченная оценка | Точность важна для hard cap, но зависимость не должна быть обязательной |
| Поиск evidence | **SQLite FTS5 trigram** (встроенный) | Уже есть, без зависимостей |
| Провайдеры открытых весов | **Расширить `openai.js`** профилями Cerebras/Groq/Fireworks/Together/OpenRouter + расширения запроса; запретить закрытые провайдеры для продукта | Один формат, разные адреса и расширения |
| Учёт расхода | **Свой**: попытки, фазы, статус «неизвестно», usage из последнего события потока | Ни одна библиотека не решает это за нас |

## 5. Что не удалось проверить

- Живые формы запросов и ответов Cerebras, Groq, Fireworks, Together, OpenRouter: сайты недоступны из среды; всё по вторичным выдержкам.
- Приходит ли `usage` при потоке у каждого хостера и нужен ли `stream_options.include_usage`.
- Актуальные каталоги моделей и их доступность у конкретных хостеров.
- Поведение параметров рассуждения для конкретных моделей (Qwen3 `enable_thinking`, DeepSeek) у каждого хостера.
- Качество генераций и задержка: без ключей и бюджета не измерялись и в этой работе измеряться не будут.
