# Развёртывание на своём сервере

Нужен Linux-сервер с Node.js 22 или новее, nginx и доменом. Внешних пакетов сервер не
требует: база — встроенный SQLite Node.js, HTTP — встроенный модуль.

Для данных с персональными данными сервер должен стоять в РФ. Провайдер модели — тоже с
обработкой в РФ (`yandex`, `gigachat`) либо локальная модель.

## Первый запуск

```
# 1. Код
sudo useradd --system --create-home --shell /usr/sbin/nologin career
sudo git clone <адрес репозитория> /opt/career-assistant
sudo chown -R career:career /opt/career-assistant
cd /opt/career-assistant

# 2. Настройки
sudo -u career cp .env.example .env
sudo -u career sh -c 'echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env'
sudo -u career nano .env      # провайдер, ключ, TRUST_PROXY=1

# 3. Сборка и проверка
sudo -u career node build.js
sudo -u career node --no-warnings tests/server.test.js

# 4. Служба
sudo cp deploy/career-assistant.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now career-assistant
curl http://127.0.0.1:3000/api/health

# 5. Домен и HTTPS
sudo cp deploy/nginx.conf /etc/nginx/sites-available/career-assistant
sudo sed -i 's/example.ru/ваш-домен.ru/' /etc/nginx/sites-available/career-assistant
sudo ln -s /etc/nginx/sites-available/career-assistant /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ваш-домен.ru
```

Откройте домен в браузере. В шапке должно быть «Сервер · заглушка модели», а в панели
справа внизу — «Режим сервера». Заглушка означает, что провайдер не задан: весь путь
работает, но ответы фиксированные.

## Подключение модели

Полная инструкция по каждому провайдеру и переключению между ними — `docs/providers.md`.
Проверка связи до перезапуска: `node tools/check-provider.js`.

Коротко, в `.env`:

```
AI_PROVIDER=yandex
AI_MODEL=yandexgpt-lite
AI_API_KEY=<ключ>
AI_FOLDER_ID=<идентификатор каталога>
```

или

```
AI_PROVIDER=gigachat
AI_MODEL=GigaChat
AI_AUTH_KEY=<ключ авторизации>
```

Для GigaChat достаточно ключа авторизации: временный токен доступа сервер получает и
обновляет сам. Если вместо этого задать `AI_API_KEY` с готовым токеном, он будет
использоваться как есть до истечения.

Перезапустить: `sudo systemctl restart career-assistant`. В шапке появится название сервиса.

**Первый живой вызов покажет, верны ли формы запросов**: они собраны по публичным примерам
и помечены как несверенные. Если ответ приходит с ошибкой — смотрите
`journalctl -u career-assistant -f`: там код ответа и сообщение сервиса, без ключа и без
текста резюме.

Если проверка связи с GigaChat падает с ошибкой TLS, серверу нужен корневой сертификат
российской цепочки: укажите путь в `NODE_EXTRA_CA_CERTS` в `.env`.

## Обновление

```
cd /opt/career-assistant && sudo -u career bash deploy/deploy.sh
```

Скрипт обновляет код, пересобирает `index.html`, прогоняет проверки без сети и
перезапускает службу. `.env` и базу не трогает.

## Где что лежит

| Что | Где |
| --- | --- |
| База | `data/app.sqlite` (путь в `DB_FILE`) |
| Журнал | `journalctl -u career-assistant` — JSON-строки, персональные данные скрыты |
| Настройки и ключ | `.env`, права 600, пользователь `career` |
| Собранная страница | `index.html` в корне, пересобирается `node build.js` |

## Резервная копия

База — один файл. Копировать при работающем сервере безопасно через SQLite:

```
sqlite3 data/app.sqlite ".backup data/backup-$(date +%F).sqlite"
```

## Сводка расходов для владельца

В `.env` задайте `ADMIN_TOKEN` (`openssl rand -hex 32`). Тогда доступно:

```
curl -H "Authorization: Bearer <токен>" https://ваш-домен.ru/api/admin/usage?days=7
```

Ответ — запросы, токены и среднее время по задачам и по дням, число сессий и подготовок.
Содержимого резюме и ответов там нет. По этой сводке считается себестоимость пользователя.

## Срок хранения

`DATA_RETENTION_DAYS` (по умолчанию 90): данные сессии, к которой не обращались дольше,
удаляются автоматически — резюме, вакансии, подготовки, интервью. Оплаченные сессии
сохраняются до конца оплаченного периода. Запустить очистку вручную:

```
curl -X POST -H "Authorization: Bearer <токен>" https://ваш-домен.ru/api/admin/retention/run
```

## Ограничение частоты

`RATE_LIMIT_PER_MINUTE` — запросов к API в минуту с одного адреса (по умолчанию 120).
`RATE_LIMIT_EXPENSIVE_PER_MINUTE` — запросов к модели в минуту с одной сессии (по умолчанию 12).
`RATE_LIMIT_SESSIONS_PER_HOUR` — новых сессий в час с одного адреса (по умолчанию 60).
При превышении — ответ 429 с заголовком `retry-after`. За прокси обязательно `TRUST_PROXY=1`,
иначе все посетители выглядят одним адресом и упрутся в общий лимит.

Дневной лимит бесплатных подготовок считается и по сессии, и по адресу: сброс cookie его
не обнуляет. Обратная сторона — пользователи из одной сети (офис, общежитие, мобильный
оператор с общим адресом) делят один дневной лимит. Если это станет проблемой, поднимайте
`FREE_PREPS_PER_DAY` или вводите вход по почте.

Адрес клиента берётся из `X-Real-IP`, который выставляет nginx из `deploy/nginx.conf`. Если
у вас другой прокси, убедитесь, что он выставляет этот заголовок или дописывает свой адрес
последним в `X-Forwarded-For`.

## Лимиты и оплата

`FREE_PREPS_PER_DAY` — сколько подготовок в день без оплаты. Оплата не подключена;
поле `paid_until` в таблице сессий уже есть и снимает лимит, но заполнять его пока
нечем — это следующий шаг после подключения ЮKassa.

## Безопасность

Перед запуском код прошёл проверку безопасности (`docs/security-review.md`); критичные и
важные находки исправлены. После включения HTTPS раскомментируйте строку с
`Strict-Transport-Security` в `deploy/nginx.conf`. Пользователь может удалить все свои
данные немедленно кнопкой в «Настройках и данных» — это `DELETE /api/me`.

## Что проверить после запуска

1. `/api/health` отвечает `ok: true`.
2. Создать резюме через мастер, вставить вакансию, получить сопоставление.
3. Перезагрузить страницу — данные на месте.
4. Посмотреть журнал: в нём не должно быть текста резюме и ключа.
5. Сделать резервную копию базы и проверить, что она открывается.
