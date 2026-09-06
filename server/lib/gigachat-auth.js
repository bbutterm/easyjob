/* Получение и обновление токена доступа GigaChat.

   Сервис принимает не ключ авторизации, а временный токен доступа,
   который выдаётся в обмен на ключ. Здесь токен запрашивается при
   первом обращении и обновляется за минуту до истечения.

   ВНИМАНИЕ: адрес и форма обмена собраны по публичным примерам и не
   сверялись с живой документацией из этой среды. Первый запуск покажет. */

'use strict';

const crypto = require('node:crypto');

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const SAFETY_MS = 60 * 1000;

let cached = { token: '', expiresAt: 0 };
let inflight = null;

async function exchange(authKey, scope, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const res = await doFetch(process.env.GIGACHAT_OAUTH_URL || OAUTH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      authorization: 'Basic ' + authKey,
      rquid: crypto.randomUUID()
    },
    body: 'scope=' + encodeURIComponent(scope || 'GIGACHAT_API_PERS')
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok || !data || !data.access_token) {
    throw new Error('Не удалось получить токен GigaChat (код ' + res.status + ')'
      + (data && data.message ? ': ' + data.message : ''));
  }
  /* expires_at приходит в миллисекундах; если поля нет — считаем 25 минут. */
  const expiresAt = Number(data.expires_at) || (Date.now() + 25 * 60 * 1000);
  return { token: data.access_token, expiresAt };
}

/* Действующий токен: из кэша или новый. Параллельные запросы ждут один обмен. */
async function getToken(authKey, scope, fetchImpl) {
  if (cached.token && Date.now() < cached.expiresAt - SAFETY_MS) return cached.token;
  if (!inflight) {
    inflight = exchange(authKey, scope, fetchImpl)
      .then(function (next) { cached = next; return next.token; })
      .finally(function () { inflight = null; });
  }
  return inflight;
}

function reset() { cached = { token: '', expiresAt: 0 }; inflight = null; }

module.exports = { getToken, exchange, reset };
