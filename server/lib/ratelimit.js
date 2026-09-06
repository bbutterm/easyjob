/* Ограничение частоты запросов в памяти процесса.

   Два независимых окна: по адресу клиента — от перебора и от скриптов,
   по сессии — от случайного зацикливания интерфейса. Дорогие запросы
   (те, что вызывают модель) считаются отдельно и строже.

   Память не растёт бесконечно: записи старше окна убираются раз в минуту. */

'use strict';

function createLimiter(options) {
  const windowMs = options.windowMs || 60000;
  const max = options.max || 60;
  const buckets = new Map();

  function hit(key) {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= max,
      remaining: Math.max(0, max - bucket.count),
      retryAfterSec: Math.ceil((bucket.start + windowMs - now) / 1000)
    };
  }

  function sweep() {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.start >= windowMs) buckets.delete(key);
    }
  }

  const timer = setInterval(sweep, 60000);
  if (timer.unref) timer.unref();

  return { hit, sweep, stop: () => clearInterval(timer), size: () => buckets.size };
}

/* Адрес клиента: за прокси берётся из X-Forwarded-For, иначе из сокета. */
function clientAddress(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { createLimiter, clientAddress };
