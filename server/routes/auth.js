'use strict';

const db = require('../lib/db.js');
const auth = require('../lib/auth.js');
const session = require('../lib/session.js');
const { HttpError, sendJson } = require('../lib/router.js');

function register(router) {
  router.post('/api/auth/register', async function ({ body, res, ctx }) {
    if (ctx.session.user_id) throw new HttpError(409, 'Сначала выйдите из аккаунта.');
    const input = auth.credentials(body, true);
    const hash = await auth.hash(input.password);
    if (db.users.byUsername(input.username)) throw new HttpError(409, 'Это имя уже занято.');
    if (!db.sessions.get(ctx.session.id)) throw new HttpError(409, 'Сессия изменилась. Повторите вход.');
    const user = db.users.create(input.username, hash);
    const current = db.sessions.rotate(ctx.session.id, user.id, ctx.ipHash);
    res.setHeader('set-cookie', session.cookieHeader(current.id, ctx.secure));
    sendJson(res, 201, { user: auth.publicUser(user) });
  });

  router.post('/api/auth/login', async function ({ body, res, ctx }) {
    const input = auth.credentials(body, false);
    const user = db.users.byUsername(input.username);
    const verified = await auth.verify(input.password, user && user.password_hash);
    if (!verified || (user.is_demo && !ctx.demoAuth)) {
      throw new HttpError(401, 'Неверное имя пользователя или пароль.');
    }
    const previous = db.sessions.get(ctx.session.id);
    if (previous && previous.user_id && previous.user_id !== user.id) {
      db.sessions.rotate(previous.id, previous.user_id, ctx.ipHash);
    }
    const saved = db.sessions.forUser(user.id) || db.sessions.create(ctx.ipHash);
    const current = db.sessions.rotate(saved.id, user.id, ctx.ipHash);
    res.setHeader('set-cookie', session.cookieHeader(current.id, ctx.secure));
    sendJson(res, 200, { user: auth.publicUser(user) });
  });

  router.post('/api/auth/logout', function ({ res, ctx }) {
    if (ctx.session.user_id) db.sessions.rotate(ctx.session.id, ctx.session.user_id, ctx.ipHash);
    else db.sessions.removeOne(ctx.session.id);
    res.setHeader('set-cookie', session.clearCookieHeader(ctx.secure));
    sendJson(res, 200, { user: null });
  });
}

module.exports = { register };
