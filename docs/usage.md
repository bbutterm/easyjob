# Этапы, модели и учёт AI

Срез A — подготовка через OpenRouter; срез B — диалог и подсказки через Cerebras.
STT — отдельный слой: mock / whisper_cpp, финализированный и подтверждённый текст
передаётся в `interview.turn` или `assistant.hint`. Аудио не передаётся в LLM usage.
Настройки STT и незавершённая интеграция описаны в [stt.md](stt.md).

## Точная карта рекомендуемого шаблона

| Task | Stage | Provider | Model env (значение шаблона) |
| --- | --- | --- | --- |
| resume.draft | pre_interview | openrouter | PREP_MODEL (`qwen/qwen3.7-plus`) |
| resume.review | pre_interview | openrouter | REASON_MODEL (`qwen/qwen3.8-max-0902`) |
| vacancy.parse | pre_interview | openrouter | PREP_MODEL |
| match.requirements | pre_interview | openrouter | REASON_MODEL |
| prep.card | pre_interview | openrouter | PREP_MODEL |
| questions.generate | pre_interview | openrouter | PREP_MODEL |
| answer.feedback | pre_interview | openrouter | PREP_MODEL |
| interview.summary | pre_interview | openrouter | REASON_MODEL |
| interview.turn | live_interview | cerebras | LIVE_MODEL (`qwen-3.8-27b`) |
| assistant.hint | live_interview | cerebras | LIVE_MODEL |
| screen.extract | live_interview | cerebras | LIVE_MODEL |

`interview.summary` — итоговая обратная связь, поэтому относится к контуру A,
хотя вызывается после тренировки. `screen.extract` — существующая вспомогательная
задача, не STT; таблица не включает автоматический захват экрана или поддержку vision.

Контракт `Routing.resolve(task)` возвращает `stage` вместе с provider/model.
Приоритет: `AI_TASK_ROUTES_JSON` → `AI_STAGE_ROUTES_JSON` → `AI_DEFAULT_PROFILE`
→ legacy `AI_*`. Этап определяется серверным каталогом задач, не клиентом.
Неизвестные задачи при resolve сохраняют legacy fallback с stage=null; build их отклоняет.
STT нельзя указать в AI_STAGE_ROUTES_JSON. Без новой конфигурации работает прежний mock.
Полный отключённый шаблон есть в `.env.example`; production env не менялся.

На 2026-09-07 ID подтверждены публичными источниками:
[OpenRouter Plus](https://openrouter.ai/qwen/qwen3.7-plus/providers),
[OpenRouter Max 0902](https://openrouter.ai/qwen/qwen3.8-max-0902),
[публичный каталог Cerebras](https://api.cerebras.ai/public/v1/models).
Это проверка наличия ID, а не доступа конкретного аккаунта и не успешный inference.

Plus выбран как стартовый вариант для структурирования с меньшими расходами;
Max — для сопоставления сложных требований и содержательного разбора. Можно направить
все задачи A в Plus ради стоимости или в Max ради качества сложного рассуждения,
проверяя JSON и задержку на своих примерах. Для B приоритет — короткий ответ и
задержка; альтернативный ID из актуального каталога Cerebras задаётся через LIVE_MODEL.
Более тяжёлая модель может улучшить рассуждение, но ухудшить время до подсказки.
Mock подходит для проверки интерфейса; локальный openai_compatible — альтернатива
при необходимости локальной обработки с зависимостью от своего оборудования.

## Расходы и приватность

`AI_PRICES_JSON` содержит карту provider → model → `{input, output}` в USD за 1M
токенов. `AI_PRICING_VERSION` — явная версия/дата каталога (например catalog-2026-09-07).
Значения конечные, неотрицательные; непустая карта требует явной версии.
Ошибка конфигурации не раскрывает env.
Без настройки используется пустая карта и версия `unconfigured`: стоимость 0 с
`pricing_missing=1`, в API/UI показано число «Без цены». Это неизвестная стоимость.
Нули в закомментированном примере — placeholders, не сведения о биллинге.
Обновляйте цены из каталогов провайдеров перед использованием, включая условия
конкретного аккаунта. Нулевое поле публичного каталога само по себе не доказывает бесплатность.

Формула: `(inputTokens × inputPrice + outputTokens × outputPrice) / 1_000_000`.
Стоимость и версия сохраняются на момент вызова, смена env не пересчитывает историю.
Это приблизительная оценка: скидки за кэш, налоги, специальные тарифы, невидимые
reasoning-токены и стоимость изображений/STT отдельно не моделируются.

Сводка учитывает вызовы серверного `ai.run`. Автономный file:// mock и существующий
прямой адаптер desktop не имеют серверной пользовательской сессии и в эту сводку
не входят; этот срез не переводит desktop на серверную авторизацию.

Сервер сохраняет session_id и снимок user_id из связи сессии с users, stage, task,
provider/model, токены входа/выхода, отдельные флаги input_estimated/output_estimated,
общий estimated, ms, ok, cost_usd, pricing_missing, pricing_version, created_at.
Анонимные legacy/mock-сессии имеют user_id=null, не вымышленного пользователя.
Смена/удаление сессии не теряет уже сохранённую идентичность usage. Старые строки
мигрируются без удаления: этап и доступная связь восстанавливаются; неизвестные
исторические цены и происхождение токенов помечены консервативно.

При наличии корректных provider usage учитываются они, включая SSE usage.
Для отсутствующего направления используется число UTF-8 байт фактического текста
сервера; вход = system + userText + 32 токена запаса на обрамление сообщений.
Это намеренно завышенная текстовая эвристика, не токенизатор и не гарантия для
скрытого рассуждения. Частичные stream-ответы сохраняют только счётчики.
Клиентские tokens/cost/user/stage не используются. Ошибки транспорта, авторизации
провайдера и разбора JSON также считаются неуспешными вызовами.
Повторные сетевые попытки учитываются отдельными неуспешными строками; финальная
строка имеет общую задержку задачи с повторами, промежуточные — задержку попытки.
В usage и AI-журналах нет ключей, промптов, резюме, аудио или транскриптов.

## Админ API и интерфейс

`GET /api/admin/usage?days=30`: доступ по подписанной сессии пользователя с ролью
`admin` **в базе**, либо независимо по `Authorization: Bearer ADMIN_TOKEN`.
Обычный пользователь получает 403, аноним/неверный токен — 401. days — целое
1…365, по умолчанию 30; неверное значение — 400. Ответы без кэширования.
Маршрут retention остаётся под отдельным ADMIN_TOKEN, роль не расширяет его права.

Ответ: since/until, totals, byUser (username/userId), byStage, byProvider,
byModel (provider+model), byTask, byDay. В каждой группе requests, succeeded,
failures, tokensIn/tokensOut, estimatedCostUsd, estimatedRequests,
reportedRequests, unpricedRequests, avgMs. estimatedRequests включает смешанные
ответы (одно направление оценено), reportedRequests — оба направления от провайдера.
Период скользящий, сутки UTC; дни без запросов не перечисляются. Старые агрегаты
sessions/preps/resumes оставлены для совместимости. Контент в API отсутствует.

Ссылка «Расходы AI» и `#/admin` доступны в интерфейсе только роли admin.
Выбор 7/30/90/365 дней, таблицы можно прокручивать клавиатурой и на мобильном.
Панель не добавляет анимаций и использует общий режим reduced-motion.

## Конкретная проверка первой части (без платных вызовов)

1. `npm run test:usage`: цены, estimates/reported, агрегаты, роль/token, ошибки,
   отсутствие секретов/контента, stage/legacy, SSE — без HTTP listen.
2. `npm run test:stt`: финальный mocked transcript → реальный handler → mock AI → SQLite.
3. `npm run test:all`, `npm run build`, `git diff --check`.
4. В локальном тестовом окружении войти обычным пользователем: ссылки нет,
   `#/admin` показывает отказ, API — 403. Войти admin: открыть панель, сменить период,
   проверить 390px и reduced-motion. ADMIN_TOKEN не вводится в браузере.
5. Создать тестовые резюме/вакансию, разбор, match, карточку, вопросы и feedback:
   ожидается pre_interview. Передать подтверждённый mock STT текст в интервью:
   ожидается live_interview. В сводке нет текста этих материалов.
6. До реальных вызовов отдельно проверить доступность моделей/тарифы своего аккаунта
   и заполнить приватный env. Этот срез не выполняет deploy/restart/inference.

Если sandbox запрещает listen, сетевые тесты не считаются пройденными: отдельно
запустить тесты без сокетов и сборку, записать точную ошибку и закрыть процессы.
