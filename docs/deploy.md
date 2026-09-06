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
AI_API_KEY=<токен доступа>
```

Перезапустить: `sudo systemctl restart career-assistant`. В шапке появится название сервиса.

**Первый живой вызов покажет, верны ли формы запросов**: они собраны по публичным примерам
и помечены как несверенные. Если ответ приходит с ошибкой — смотрите
`journalctl -u career-assistant -f`: там код ответа и сообщение сервиса, без ключа и без
текста резюме.

Токен GigaChat живёт ограниченное время; его обновление в прототипе не реализовано —
при истечении обновите `AI_API_KEY` и перезапустите службу.

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

## Лимиты и оплата

`FREE_PREPS_PER_DAY` — сколько подготовок в день без оплаты. Оплата не подключена;
поле `paid_until` в таблице сессий уже есть и снимает лимит, но заполнять его пока
нечем — это следующий шаг после подключения ЮKassa.

## Что проверить после запуска

1. `/api/health` отвечает `ok: true`.
2. Создать резюме через мастер, вставить вакансию, получить сопоставление.
3. Перезагрузить страницу — данные на месте.
4. Посмотреть журнал: в нём не должно быть текста резюме и ключа.
5. Сделать резервную копию базы и проверить, что она открывается.
