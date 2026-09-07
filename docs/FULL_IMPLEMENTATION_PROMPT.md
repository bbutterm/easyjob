# FULL IMPLEMENTATION PROMPT — Easyjob до полноценного приложения

**Целевой GitHub-репозиторий:** `https://github.com/bbutterm/easyjob.git`

**Рабочий каталог:** `/root/private/pet-interview/easyjob-audit-8P9hMe`

**Текущая ветка:** `main` (рабочее дерево намеренно dirty; существующие изменения нельзя удалять или откатывать без отдельного разрешения).

**Production URL:** `https://85.137.93.201:8446/`

**Production service:** `easyjob.service`

**Production code:** `/opt/easyjob/current`

**Production env:** `/etc/easyjob/easyjob.env` — секреты не читать в отчёт, не копировать в Git, prompt или frontend.

---

## 0. Роль исполнителя и главная цель

Ты — основной implementation agent. Твоя задача — довести Easyjob от текущего прототипа/частично интегрированного продукта до реально работающего приложения с backend, сохранением данных, реальными AI-провайдерами, обработкой файлов, импортом вакансий по ссылке, понятными состояниями и проверенным end-to-end UX.

**Главная цель:** пользователь должен войти в аккаунт, пройти Quick Start, загрузить настоящее резюме или вставить его текст, получить настоящий анализ, добавить вакансию вручную или по ссылке, получить настоящий match/вопросы/feedback, продолжить подготовку и понимать, что происходит на каждом шаге.

Не принимай следующие подмены за реализацию:

- статическая HTML-карточка вместо API и persistence;
- `DEMO_DATA` после действия пользователя;
- mock-ответ, помеченный как real;
- выбранное имя файла без чтения содержимого;
- spinner без timeout/cancel/retry;
- наличие функции в коде без вызова из реального пользовательского пути;
- unit-тест mock-провайдера вместо реального provider smoke-test;
- наличие STT UI без реального backend;
- кнопка «Импортировать по ссылке», которая только показывает «не реализовано».

---

## 1. Обязательный порядок работы

### Фаза A — reconnaissance до изменений

1. Проверь, что работаешь именно в:

   ```text
   /root/private/pet-interview/easyjob-audit-8P9hMe
   ```

2. Сними состояние:

   ```bash
   git status --short --branch
   git remote -v
   git rev-parse HEAD
   git diff --stat
   ```

3. Не удаляй и не перезаписывай существующие незакоммиченные изменения. Среди них уже есть routing, usage/admin, STT, Quick Start, ingestion и reliability work.

4. Изучи полностью call graph:

   ```text
   browser UI
     → src/app.js / src/screens-*.js / src/api.js
     → server/index.js / server/lib/router.js
     → server/routes/auth.js / api.js / admin.js
     → server/lib/db.js / ai.js / pricing.js
     → shared/ai/routing.js / request.js / providers/*
   ```

5. Проверь существующие тесты, build scripts, документы и production configuration. Отдельно раздели:

   - implemented + wired + tested;
   - implemented but not wired;
   - wired but not live-verified;
   - mock/demo only;
   - documented but absent.

6. Перед реализацией создай или обнови план с файлами, рисками, acceptance criteria и командами проверки.

### Фаза B — реализация по вертикальным срезам

Работай по вертикальным срезам, каждый из которых заканчивается тестами:

1. auth + persistence + Quick Start;
2. resume ingestion + real analysis;
3. vacancy text + URL import;
4. preparation/match/questions/feedback;
5. admin usage/cost;
6. live interview + real STT;
7. UX/error/loading/cancel/retry;
8. deployment and real smoke verification.

Не переписывай весь проект одновременно. Не запускай нескольких writer-агентов против одних и тех же файлов.

### Фаза C — verification

После каждого среза:

- targeted regression tests;
- relevant full suite;
- JavaScript syntax/build;
- browser smoke, если изменён UI;
- проверка console/network errors;
- `git diff --check`;
- inspection diff;
- отсутствие секретов в diff/logs/frontend.

До отдельного разрешения пользователя запрещены:

- commit;
- push;
- deploy;
- restart production service;
- изменение `/etc/easyjob/easyjob.env`;
- удаление базы или данных;
- миграции production.

---

## 2. Зафиксированные текущие проблемы

### 2.1 Файлы не читались

Старая реализация `src/app.js` сохраняла только имя файла и показывала сообщение, что файл локальный и не читается. В server mode в `liveReview()` отправлялся только `Store.upload.text`; bytes выбранного PDF/DOCX/TXT не попадали на сервер.

Реализовать настоящий путь:

```text
File input / drag & drop
  → validation
  → in-memory read
  → authenticated POST /api/resumes/extract
  → server extraction
  → user preview/edit extracted text
  → POST /api/resumes
  → POST /api/resumes/:id/review
  → real OpenRouter result
  → save result
```

Поддерживаемые форматы должны быть фактически проверены:

- `.txt` — UTF-8, UTF-16, fallback Windows-1251 с понятным предупреждением;
- `.docx` — извлечение paragraph text;
- `.pdf` — текстовый PDF через `pypdf` или эквивалентный проверенный parser;
- `.doc`, `.rtf` — либо реальная конвертация, либо честная ошибка с инструкцией сохранить как DOCX/PDF/TXT;
- сканированный PDF без text layer — честная ошибка «OCR не подключён», не demo-результат.

Ограничения:

- максимальный размер файла — явно показанный пользователю лимит;
- timeout extraction;
- cancellation;
- corrupted/encrypted/empty file errors;
- no file bytes in logs;
- raw text only after explicit user action and current privacy rules;
- no silent fallback to demonstration analysis.

### 2.2 Долгий разбор

Подтверждённый live repro для `resume.review`:

```text
OpenRouter
qwen/qwen3.7-plus
~69 seconds
output ~3998 tokens
malformed/truncated JSON
```

Проблема не должна маскироваться увеличением spinner.

Требуется:

- bounded provider timeout;
- client timeout;
- AbortController;
- Cancel;
- phase/status/elapsed time;
- duplicate request guard;
- Retry;
- сохранение extracted text при ошибке;
- различение timeout/provider failure/malformed JSON/unsupported file;
- usage ledger для success/failure/latency;
- отсутствие ложного success;
- strict schema validation;
- finish reason/truncation detection;
- компактный structured output.

Если модель вернула неполный JSON, результат не показывать как готовый. Пользователь должен увидеть:

```text
Ответ модели оказался неполным. Резюме сохранено, разбор не сохранён.
[Повторить разбор]
```

### 2.3 Demo подменял real

Кнопка `Показать пример анализа` должна оставаться доступной только как отдельный demo action.

В HTTP/server mode запрещено:

- показывать `DEMO_DATA.analysisReport` после ошибки real request;
- называть demo result результатом OpenRouter;
- автоматически подменять ошибку demo.

Каждый результат должен иметь source metadata:

```json
{
  "source": {
    "mode": "real|demo",
    "provider": "openrouter|cerebras|mock",
    "model": "...",
    "stage": "pre_interview|live_interview",
    "createdAt": "..."
  }
}
```

Секреты, prompt, resume text и raw model response в source metadata не хранить.

### 2.4 Неудобное управление демонстрацией/панелями

Проверить `demoPanelOpen`, `demopanel:toggle`, все overlay/modal/screen-share/STT controls.

Любой открытый элемент должен иметь:

- явную кнопку `Закрыть` или `Свернуть`;
- `Escape`;
- корректный `aria-expanded`/`aria-controls`;
- восстановление focus;
- безопасное click-outside поведение;
- мобильный layout;
- touch target минимум 44×44px;
- `prefers-reduced-motion`;
- отсутствие слоя, который остаётся поверх приложения после закрытия.

---

## 3. Полный функциональный scope приложения

## 3.1 Authentication and accounts

Реализовать и проверить:

- register;
- login;
- logout;
- password verification;
- session rotation;
- HttpOnly/Secure/SameSite cookies;
- CSRF protection, если используется cookie mutation;
- rate limits;
- account isolation;
- account switch without stale in-memory state;
- `/api/me`;
- user-owned resumes/vacancies/preps/interviews;
- admin role separation;
- delete all data;
- no demo credentials in production unless explicitly enabled.

Критерии:

- пользователь A не видит данные B;
- logout invalidates old session;
- reload restores account data;
- no password/token in localStorage;
- no resume content in quickstart localStorage.

## 3.2 Quick Start

После первого входа новый пользователь попадает в guided flow:

1. welcome + privacy/AI data note;
2. create or select resume;
3. upload/parse or paste text;
4. inspect extracted text;
5. run real resume review;
6. create/select vacancy;
7. paste text or import from URL;
8. parse vacancy requirements;
9. create preparation;
10. run match;
11. generate questions;
12. answer one question;
13. run feedback;
14. start text practice interview;
15. explain separate live/STT contour;
16. finish with next action.

Кнопки:

- `Назад`;
- `Продолжить`;
- `Пропустить`; 
- `Продолжить позже`;
- `Повторить`;
- `Начать заново`;
- `Перейти в приложение`.

Progress must be per authenticated user and must not contain resume text, vacancy text, prompts, answers, tokens, keys or raw model responses.

Already-completed steps must be recognized after reload. Error states must not mark a step complete.

## 3.3 Resume management

Required operations:

- create from form;
- upload file;
- paste raw text;
- extract text;
- preview/edit extracted text;
- save version;
- rename;
- delete;
- review with AI;
- retry review;
- show source and timestamp;
- mark stale after edit;
- rebuild analysis for current revision;
- export only if a real export implementation exists; otherwise clearly label unavailable.

Resume review output contract:

```json
{
  "strengths": ["string"],
  "vague": [
    {"title":"string", "before":"verbatim quote", "after":"suggested rewrite", "why":"string"}
  ],
  "missing": [
    {"title":"string", "after":"question or suggested addition", "why":"string"}
  ]
}
```

Rules:

- no invented facts;
- `before` must be a literal quote;
- suggestions are suggestions, not automatic edits;
- max 3–5 items per collection;
- max string lengths;
- strict schema validation;
- concise JSON;
- no Markdown around JSON;
- user can accept/reject suggestions locally;
- acceptance must not silently invent facts.

## 3.4 Vacancy management

Required operations:

- create manually;
- paste vacancy text;
- import by public URL;
- preview imported title/company/text;
- edit before saving;
- parse requirements;
- save requirements;
- reparse after source revision;
- mark stale;
- delete;
- show source URL and retrieval timestamp.

---

## 4. Реализация получения вакансии по ссылке

### Почему сейчас не реализовано

В текущем коде есть только UI stub:

```text
stub:import
«Получение вакансии по ссылке не реализовано. Макет не ходит в сеть.»
```

Backend endpoint для fetch/parse URL отсутствует. Это не provider problem и не OpenRouter problem; это незавершённый функциональный slice.

### Требуемый API

Добавить authenticated endpoint, например:

```http
POST /api/vacancies/import-url
Content-Type: application/json

{
  "url": "https://example.com/job/123"
}
```

Ответ success:

```json
{
  "ok": true,
  "vacancy": {
    "sourceUrl": "https://...",
    "title": "...",
    "company": "...",
    "rawText": "...",
    "source": "html|jsonld|meta",
    "retrievedAt": "...",
    "needsReview": false
  }
}
```

Ответ must be actionable on failure:

```json
{
  "ok": false,
  "code": "unsupported_site|blocked|private_url|timeout|not_job_page|empty_content|too_large",
  "error": "Понятное сообщение пользователю"
}
```

### SSRF/security requirements

URL importer — server-side network feature. Обязательно:

- only `http`/`https`;
- reject username/password in URL;
- reject localhost, loopback, link-local, multicast, RFC1918/private IPv4 and IPv6;
- resolve DNS and re-check every redirect target;
- maximum 3 redirects;
- no arbitrary ports unless explicitly approved;
- response timeout 10–15 seconds;
- connect/read timeout;
- maximum response bytes;
- reject binary downloads unless supported parser is explicitly implemented;
- allow only expected content types;
- no cookies from user browser forwarded to target;
- no Authorization header forwarded;
- no secret in logs;
- redact query tokens in stored/displayed URL where appropriate;
- SSRF regression tests with localhost/private IP/redirect-to-private;
- protect against decompression bombs and huge HTML;
- sanitize HTML before extraction;
- do not execute downloaded scripts.

### Extraction strategy

1. Fetch response.
2. Detect `Content-Type` and charset.
3. Parse HTML without executing JavaScript.
4. Prefer JSON-LD `JobPosting`.
5. Then inspect `<title>`, OpenGraph/meta, visible headings and main/article content.
6. Remove navigation, scripts, styles, cookie banners, duplicated footer.
7. Preserve title/company/location/description/requirements when available.
8. If page is client-rendered or blocked by anti-bot, return clear error and offer manual paste.
9. Never fabricate a vacancy from URL slug.
10. Show extracted content to user before AI parsing.
11. AI `vacancy.parse` only receives the user-approved extracted text.

### Site adapters

Implement generic importer first. Add adapters only where legally and technically appropriate. Do not bypass CAPTCHA, login walls, paywalls, anti-bot systems or access controls.

For known job boards, use documented/public pages and obey Terms/robots/legal constraints. If a site cannot be imported reliably, display:

```text
Сайт не разрешил автоматическое чтение. Вставьте текст вакансии вручную.
```

Never show a demo vacancy as a successful import.

---

## 5. AI providers and exact model behavior

All provider calls must go through the existing shared adapter/routing/usage layers. Do not duplicate HTTP pipelines per feature.

### Profile 1 — OpenRouter structured

```text
provider: openrouter
model: qwen/qwen3.7-plus
stage: pre_interview
```

Use for:

- `resume.draft`;
- `resume.review` when structured/cost-sensitive;
- `vacancy.parse`;
- `prep.card`;
- `questions.generate`;
- `answer.feedback`.

Behavior:

- Russian by default;
- concise;
- strict JSON only for structured tasks;
- no Markdown fences;
- no commentary before/after JSON;
- only facts present in user data;
- explicit unknown/missing fields;
- bounded arrays and strings;
- no invented employer, title, dates, metrics or certificates;
- response must validate against schema;
- finish reason/truncation must be checked;
- malformed result is failure + retry, never success;
- reasoning disabled or minimized for JSON tasks where provider supports it;
- max output budget must leave room for a complete answer, not unlimited reasoning.

### Profile 2 — OpenRouter reasoning

```text
provider: openrouter
model: qwen/qwen3.8-max-0902
stage: pre_interview
```

Use for:

- `match.requirements`;
- complex `resume.review` if validated;
- `interview.summary`;
- complex final feedback/card when quality requires it.

Behavior:

- still return strict JSON for structured tasks;
- reasoning must not leak into user output;
- use evidence from resume/vacancy only;
- each vacancy requirement receives an explicit status;
- no global percentage score unless explicitly designed and explained;
- distinguish confirmed/unclear/missing;
- quote or reference concrete evidence;
- do not convert missing evidence into rejection;
- bounded output and timeout;
- retry only when safe and never silently double expensive calls;
- usage/cost recorded per attempt.

Match output:

```json
{
  "items": [
    {
      "requirementId": "string",
      "status": "confirmed|unclear|missing",
      "evidence": "string",
      "advice": "string"
    }
  ]
}
```

### Profile 3 — Cerebras live

```text
provider: cerebras
model: qwen-3.8-27b
stage: live_interview
```

Use for:

- `interview.turn`;
- `assistant.hint`;
- `screen.extract` only when capability and consent allow.

Behavior:

- latency first;
- short answer;
- no long reasoning visible to user;
- one question/one hint at a time;
- do not invent experience;
- use only finalized transcript and approved resume context;
- stream when supported;
- visible partial/final states;
- cancellation on stop/disconnect;
- provider errors become retryable UI errors;
- no silent fallback to mock.

`interview.turn` output is short text. `assistant.hint` should be a compact direction, not a script the user must read verbatim.

### Profile 4 — STT

STT is not an LLM provider.

```text
microphone
  → explicit consent
  → local whisper.cpp / Whisper backend
  → partial transcript
  → final transcript
  → user-visible correction
  → Cerebras live task
```

Behavior:

- microphone permission only after explicit user action;
- no covert capture;
- no raw audio persistence by default;
- partial transcript can be replaced by final transcript;
- final segment only goes to LLM;
- handle silence, pause, permission denied, device disconnected, reconnect, stop and cancel;
- measure speech-to-final and final-to-hint latency;
- say honestly when backend is unavailable;
- mock STT must never be presented as recognition.

### Profile 5 — mock

Mock may exist only for:

- standalone demo;
- unit tests;
- local development without credentials.

Rules:

- visible `demo/mock` label;
- no mock result after a failed real operation;
- no mock data in real account unless user deliberately requests example;
- no usage record pretending mock is OpenRouter/Cerebras;
- no production real-mode fallback to mock without explicit configuration.

---

## 6. Required AI task contracts

Every task must have:

- task ID;
- stage;
- provider profile;
- input variables;
- output format/schema;
- max context/output;
- timeout;
- retry policy;
- usage/cost metadata;
- error mapping;
- tests with valid/invalid/truncated provider responses.

Required tasks:

```text
resume.draft
resume.review
vacancy.parse
match.requirements
prep.card
questions.generate
answer.feedback
interview.summary
interview.turn
assistant.hint
screen.extract
```

No task may silently accept arbitrary prose when JSON is required.

---

## 7. Preparation workflow

Implement complete state machine:

```text
resume_selected
  → vacancy_selected
  → vacancy_requirements_ready
  → match_ready
  → questions_ready
  → answers_started
  → feedback_ready
  → prep_card_ready
  → text_interview_started
  → text_interview_finished
  → live_interview_available
```

Every state must survive reload through server persistence where it represents a completed user action.

Rules:

- source revisions mark prep stale;
- stale results are visibly labeled;
- rebuild uses current source revisions;
- failed step is retryable;
- duplicate expensive calls blocked;
- partial success does not erase previous valid result;
- user can navigate away and return;
- no infinite `pending`.

---

## 8. Usage, cost and privacy

Server-side usage ledger must store only metadata:

```text
userId
sessionId/requestId
stage
task
provider
model
inputTokens
outputTokens
reportedOrEstimated
estimatedCostUsd
pricingVersion
status
latencyMs
createdAt
errorCode
```

Never store:

- API key;
- password;
- prompt;
- resume text;
- vacancy text;
- model response;
- transcript;
- audio;
- frontend-reported cost.

Admin UI/API:

- admin role only;
- totals 7/30/90/365 days;
- by user/stage/task/provider/model/day;
- success/failure/latency;
- estimated versus reported usage;
- unknown pricing shown as unknown, not zero/free;
- no sensitive content in table or logs.

---

## 9. UX reliability requirements

Every expensive operation must show:

```text
idle
→ preparing
→ reading/extracting
→ sending
→ waiting for model
→ success
```

or:

```text
error
→ reason
→ Retry / Cancel / Manual fallback
```

Required:

- no infinite spinner;
- elapsed time for operations longer than 2 seconds;
- Cancel;
- Retry;
- disabled duplicate action;
- preserve user input;
- clear status after completion/failure;
- mobile layout 360/390 px;
- desktop layout;
- keyboard navigation;
- Escape for modal/panel;
- reduced motion;
- visible provider/stage status without exposing secrets;
- console clean on main flows;
- network errors mapped to user language.

---

## 10. Tests required before completion

### Unit/socketless

- file size/type/magic bytes;
- UTF-8/UTF-16/CP1251 TXT;
- DOCX extraction;
- PDF extraction;
- encrypted/scan/empty/corrupted files;
- unsupported DOC/RTF behavior;
- SSRF URL validation;
- redirect-to-private rejection;
- HTML/JSON-LD extraction;
- malformed JSON;
- finish_reason length;
- timeout/cancel;
- duplicate review;
- retry;
- source mode real/demo separation;
- usage ledger success/failure/estimated cost;
- provider route/model selection;
- secret/prompt/content redaction;
- Quick Start progress/account isolation.

### HTTP integration

- register/login/logout/me;
- create resume;
- extract uploaded file;
- review real resume;
- retry failed review;
- import URL;
- import URL blocked/private/timeout/unsupported;
- create vacancy;
- parse requirements;
- create prep/match;
- questions;
- answers/feedback;
- interview;
- admin usage;
- account isolation.

### Browser

At minimum:

1. login;
2. first-time Quick Start;
3. upload TXT;
4. upload DOCX/PDF fixture;
5. preview extracted text;
6. real review success;
7. malformed response error + retry;
8. timeout/cancel;
9. manual text fallback;
10. URL import success/error;
11. demo example explicitly labeled;
12. panel open/close/Escape;
13. mobile 360/390;
14. reduced motion;
15. logout/account switch;
16. admin usage.

If sandbox blocks sockets/Chromium, record exact blocker and do not claim browser verification passed. Run all socketless tests and provide an external-machine checklist.

### Real provider smoke

Use only synthetic non-PII fixtures and server-side env:

- OpenRouter `vacancy.parse`;
- OpenRouter `resume.review`;
- OpenRouter `match.requirements`;
- OpenRouter `questions.generate`;
- one full pre-interview flow;
- confirm usage ledger;
- confirm no secrets/content in logs.

Real provider smoke must report:

```text
provider
model
task
HTTP/result status
latency
input/output usage if returned
schema validation
estimated cost
```

Do not print raw prompt or raw response.

---

## 11. Deployment gate

Do not deploy until:

- targeted tests pass;
- relevant full suite passes;
- build passes;
- diff-check passes;
- no secrets in diff;
- parser runtime dependencies verified on service user;
- production Python runtime configured for PDF if required;
- rollback snapshot prepared;
- env names validated without printing values;
- real provider smoke passes;
- URL importer SSRF tests pass;
- browser smoke passes in a non-blocked environment or limitations are explicitly accepted;
- service directory permissions verified for non-root user;
- local health and external HTTPS health are checked after deployment;
- first real pre-interview operation is checked after restart;
- live/STT remains clearly separate if not enabled.

When mirroring code to a systemd service directory:

- preserve `/etc/easyjob/easyjob.env` outside code;
- preserve DB/runtime data;
- do not use unsafe bare `rsync -a --delete` from a root-private directory;
- verify `namei -l`, service user, release permissions;
- create rollback before update;
- restart only after local gates;
- verify `systemctl is-active`, local health, public health and one real task.

---

## 12. Required final report

The implementation agent must return a report with:

1. exact repository and branch;
2. architecture inspected;
3. root causes found;
4. files changed;
5. API contracts added/changed;
6. models and task routes;
7. URL importer security behavior;
8. parser dependency/runtime requirements;
9. tests actually run with exact commands/results;
10. browser limitations;
11. real provider smoke result without sensitive content;
12. remaining blockers;
13. deployment status: explicitly `not deployed` unless separately authorized and verified;
14. rollback instructions;
15. no secrets, prompts, resumes, vacancy text, transcripts or raw model responses.

Do not mark a feature complete because its button exists. Mark it complete only when the complete user path is wired, persisted, tested and verified.

---

## First execution instruction

Start with read-only reconnaissance and a short implementation plan. Then implement in vertical slices. Do not ask the user to repeat context contained in this prompt. Do not commit, push, deploy or restart production. Preserve unrelated dirty changes. Use real APIs and real extraction paths; keep demo/mock strictly labeled and isolated.
