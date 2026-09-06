/* Срок хранения данных.

   Резюме и подготовки — персональные данные, хранить их дольше нужного
   нельзя. Всё, что принадлежит сессии, к которой не обращались дольше
   DATA_RETENTION_DAYS, удаляется целиком. Запись об использовании
   остаётся без содержимого — только счётчики токенов для учёта. */

'use strict';

const db = require('./db.js');
const log = require('./log.js');

function cleanup(retentionDays) {
  const days = Number(retentionDays);
  if (!days || days <= 0) return { skipped: true };
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const removed = db.sessions.removeInactiveSince(cutoff);
  if (removed.sessions) log.info('retention.cleanup', Object.assign({ days }, removed));
  return removed;
}

function schedule(retentionDays, intervalMs) {
  cleanup(retentionDays);
  const timer = setInterval(function () { cleanup(retentionDays); }, intervalMs || 6 * 3600 * 1000);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { cleanup, schedule };
