#!/usr/bin/env bash
# Развёртывание или обновление на сервере. Запускать на сервере из каталога приложения:
#   bash deploy/deploy.sh
# Скрипт не трогает .env и базу.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Обновляю код"
git pull --ff-only

echo "→ Ставлю зависимости (только для проверок; серверу внешние пакеты не нужны)"
npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true

echo "→ Собираю index.html"
node build.js

if [ ! -f .env ]; then
  echo "!! Нет файла .env. Скопируйте .env.example в .env и заполните SESSION_SECRET и настройки провайдера."
  exit 1
fi

echo "→ Проверяю общий слой и сервер без сети"
node tests/shared.test.js >/dev/null && node --no-warnings tests/server.test.js >/dev/null && echo "   проверки прошли"

echo "→ Перезапускаю службу"
sudo systemctl restart career-assistant
sleep 1
sudo systemctl --no-pager --lines=5 status career-assistant || true

echo "→ Проверяю здоровье"
curl -fsS http://127.0.0.1:${PORT:-3000}/api/health && echo
