/* Счётчики и комментарии ленты plair.pro.
 *
 * Счётчики: сколько раз игру запускали и сколько ей поставили лайков.
 * Браузер присылает случайный номер, который сам себе выдал, — он нужен
 * ровно для того, чтобы не дать накрутить запуски и лайкнуть дважды.
 *
 * Комментарии: вход через Google или GitHub. От них берём только имя и
 * аватар — то, что и так видно под комментарием. Почту не просим. Пароли
 * и ключи провайдеров сюда не попадают: после входа у браузера остаётся
 * наш собственный подписанный пропуск, и больше ничего.
 *
 * D1, а не KV: у KV на бесплатном тарифе одна запись в секунду на ключ,
 * а у D1 — 100 000 записей строк в сутки и 5 ГБ места. Комментарий
 * весит около полукилобайта, так что места хватит на миллионы.
 */

const ORIGINS = ['https://plair.pro', 'https://www.plair.pro'];
const CATALOG = 'https://plair.pro/games/games.json';

const PLAYS_A_DAY = 10;            // запусков с браузера на игру в сутки
const SESSION_DAYS = 180;          // сколько живёт вход
const PAGE = 20;                   // комментариев за один запрос
const MAX_LEN = 500;               // символов в комментарии
const GAP = 15;                    // секунд между комментариями одного человека
const PER_DAY = 60;                // комментариев от одного человека в сутки

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VISITOR = /^[a-f0-9]{16,64}$/;

const now = () => Math.floor(Date.now() / 1000);
const enc = new TextEncoder();
const dec = new TextDecoder();

/* ── адреса и CORS ─────────────────────────────────────── */

// Для проверки на своём компьютере: EXTRA_ORIGINS="http://localhost:8080".
function origins(env) {
  return ORIGINS.concat(String(env.EXTRA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean));
}

function cors(env, origin) {
  const list = origins(env);
  return {
    'Access-Control-Allow-Origin': list.indexOf(origin) !== -1 ? origin : list[0],
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function reply(env, origin, body, init) {
  return new Response(JSON.stringify(body), {
    status: (init && init.status) || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8' },
      cors(env, origin),
      (init && init.headers) || { 'Cache-Control': 'no-store' }
    )
  });
}

function go(location, cookie) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (cookie) h.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers: h });
}

/* Игру принимаем только ту, что есть в каталоге, — иначе в таблицу
   насыплют выдуманных имён. Каталог берём через кэш. */
async function catalog(env) {
  const r = await fetch(env.CATALOG || CATALOG, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) return [];
  const list = await r.json();
  return Array.isArray(list) ? list : [];
}
async function known(env, id) {
  return (await catalog(env)).some((g) => g && g.id === id);
}

function today() { return new Date().toISOString().slice(0, 10); }

/* ── подписи ───────────────────────────────────────────── */
/* Пропуск — это JSON и его HMAC-подпись нашим секретом. Подделать без
   секрета нельзя, хранить на сервере нечего. */

function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let keyCache = null, keyFor = '';
async function key(env) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set');
  if (keyCache && keyFor === env.SESSION_SECRET) return keyCache;
  keyFor = env.SESSION_SECRET;
  keyCache = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return keyCache;
}

async function seal(env, obj) {
  const body = b64u(enc.encode(JSON.stringify(obj)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), enc.encode(body)));
  return body + '.' + b64u(sig);
}

async function unseal(env, token, kind) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  let ok = false;
  // Подпись принимаем только в одном написании: иначе один пропуск
  // можно переписать по-разному, не зная секрета.
  try { if (b64u(unb64u(sig)) !== sig) return null; } catch (e) { return null; }
  try { ok = await crypto.subtle.verify('HMAC', await key(env), unb64u(sig), enc.encode(body)); } catch (e) { ok = false; }
  if (!ok) return null;
  let obj = null;
  try { obj = JSON.parse(dec.decode(unb64u(body))); } catch (e) { return null; }
  if (!obj || obj.k !== kind || typeof obj.e !== 'number' || obj.e < now()) return null;
  return obj;
}

function cookie(request, name) {
  const all = request.headers.get('Cookie') || '';
  for (const part of all.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
}

/* ── вход через Google и GitHub ───────────────────────── */

function cleanName(v) {
  return String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

const PROVIDERS = {
  google: {
    ready: (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    start(env, redirect, state) {
      return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code',
        scope: 'openid profile', state: state, prompt: 'select_account'
      });
    },
    async profile(env, code, redirect) {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirect, grant_type: 'authorization_code'
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id_token) throw new Error('google: no token');
      /* Токен пришёл нам напрямую от Google по TLS — по спецификации
         OpenID его подпись в этом случае можно не проверять. Сверяем,
         кому и кем он выдан. */
      const c = JSON.parse(dec.decode(unb64u(String(j.id_token).split('.')[1] || '')));
      if (c.aud !== env.GOOGLE_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(c.iss) || !c.sub) {
        throw new Error('google: bad claims');
      }
      return { id: 'google:' + c.sub, name: cleanName(c.name || c.given_name) || 'Player',
               avatar: c.picture || null, login: null };
    }
  },
  github: {
    ready: (env) => !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    start(env, redirect, state) {
      // Пустой scope — только открытые данные профиля.
      return 'https://github.com/login/oauth/authorize?' + new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID, redirect_uri: redirect, state: state, scope: '', allow_signup: 'true'
      });
    },
    async profile(env, code, redirect) {
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
          code: code, redirect_uri: redirect
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) throw new Error('github: no token');
      // Ключ GitHub нужен один раз — спросить, кто это. Дальше не храним.
      const u = await fetch('https://api.github.com/user', {
        headers: { Authorization: 'Bearer ' + j.access_token, Accept: 'application/vnd.github+json',
                   'User-Agent': 'plair-comments' }
      }).then((x) => x.json());
      if (!u || !u.id || !u.login) throw new Error('github: no user');
      return { id: 'github:' + u.id, name: cleanName(u.name || u.login), avatar: u.avatar_url || null,
               login: String(u.login).slice(0, 39) };
    }
  }
};

function backURL(env, raw) {
  try {
    const u = new URL(raw);
    if (origins(env).indexOf(u.origin) === -1) return null;
    u.hash = '';
    return u.toString();
  } catch (e) { return null; }
}

async function authStart(env, url, provider) {
  const back = backURL(env, url.searchParams.get('back') || '');
  if (!back) return new Response('Bad return address', { status: 400 });
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const state = await seal(env, { k: 'st', n: nonce, p: provider, b: back, e: now() + 600 });
  const redirect = url.origin + '/auth/' + provider + '/callback';
  /* Кука живёт десять минут и только на /auth: она связывает этот
     браузер с этим входом, чтобы чужая ссылка не залогинила вас
     под чужим именем. */
  return go(PROVIDERS[provider].start(env, redirect, state),
    'plair_auth=' + nonce + '; Max-Age=600; Path=/auth; HttpOnly; Secure; SameSite=Lax');
}

async function authDone(env, request, url, provider) {
  const st = await unseal(env, url.searchParams.get('state') || '', 'st');
  if (!st || st.p !== provider) return new Response('This sign-in link has expired. Try again.', { status: 400 });
  const clear = 'plair_auth=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Lax';
  const fail = (why) => go(st.b + '#auth-error=' + why, clear);
  if (cookie(request, 'plair_auth') !== st.n) return fail('expired');
  const code = url.searchParams.get('code');
  if (!code) return fail('cancelled');

  let p;
  try { p = await PROVIDERS[provider].profile(env, code, url.origin + '/auth/' + provider + '/callback'); }
  catch (e) { return fail('failed'); }

  await env.DB.prepare(
    'INSERT INTO users (id, name, avatar, login, created) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, login = excluded.login'
  ).bind(p.id, p.name, p.avatar, p.login, now()).run();

  const token = await seal(env, { k: 's', u: p.id, e: now() + SESSION_DAYS * 86400 });
  // Пропуск уходит во фрагменте адреса: он не попадает ни в логи, ни
  // в заголовок Referer, а страница сразу убирает его из строки.
  return go(st.b + '#session=' + token, clear);
}

/* Кто прислал запрос. null — гость или пропуск недействителен. */
async function who(env, request) {
  const h = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+/i.test(h)) return null;
  const s = await unseal(env, h.replace(/^Bearer\s+/i, '').trim(), 's');
  if (!s) return null;
  const u = await env.DB.prepare('SELECT id, name, avatar, login, banned FROM users WHERE id = ?').bind(s.u).first();
  if (!u) return null;
  u.admin = String(env.ADMINS || '').split(',').map((x) => x.trim()).indexOf(u.id) !== -1;
  return u;
}

function publicUser(u) {
  return { name: u.name, avatar: u.avatar || null, login: u.login || null };
}

/* ── комментарии ───────────────────────────────────────── */

function cleanText(v) {
  return String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function notify(env, game, user, text) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return;
  try {
    await fetch('https://api.telegram.org/bot' + env.TG_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TG_CHAT_ID,
        text: 'New comment on ' + game + '\n' + user.name + (user.login ? ' (@' + user.login + ')' : '') +
              ':\n\n' + text + '\n\nhttps://plair.pro/?g=' + game + '&c=1',
        disable_web_page_preview: true
      })
    });
  } catch (e) { /* уведомление — не повод ронять комментарий */ }
}

async function listComments(env, origin, url, me) {
  const game = url.searchParams.get('game') || '';
  if (!ID.test(game)) return reply(env, origin, { ok: false, why: 'bad' }, { status: 400 });
  const before = Number(url.searchParams.get('before')) || 0;
  const { results } = await env.DB.prepare(
    'SELECT c.id, c.text, c.created, c.user, u.name, u.avatar, u.login FROM comments c ' +
    'JOIN users u ON u.id = c.user WHERE c.game = ? AND (? = 0 OR c.id < ?) ' +
    'ORDER BY c.id DESC LIMIT ?'
  ).bind(game, before, before, PAGE + 1).all();
  const rows = results || [];
  const more = rows.length > PAGE;
  const total = await env.DB.prepare('SELECT comments FROM games WHERE id = ?').bind(game).first();
  return reply(env, origin, {
    ok: true,
    total: (total && total.comments) || 0,
    more: more,
    comments: rows.slice(0, PAGE).map((r) => ({
      id: r.id, text: r.text, created: r.created,
      user: { name: r.name, avatar: r.avatar || null, login: r.login || null },
      own: !!(me && me.id === r.user),
      canDelete: !!(me && (me.id === r.user || me.admin))
    }))
  });
}

async function postComment(env, origin, ctx, me, body) {
  if (!me) return reply(env, origin, { ok: false, why: 'signin' }, { status: 401 });
  if (me.banned) return reply(env, origin, { ok: false, why: 'banned' }, { status: 403 });
  const game = String((body && body.game) || '');
  const text = cleanText(body && body.text);
  if (!ID.test(game)) return reply(env, origin, { ok: false, why: 'bad' }, { status: 400 });
  if (!text) return reply(env, origin, { ok: false, why: 'empty' }, { status: 400 });
  if (Array.from(text).length > MAX_LEN) return reply(env, origin, { ok: false, why: 'long', max: MAX_LEN }, { status: 400 });
  if (!(await known(env, game))) return reply(env, origin, { ok: false, why: 'unknown game' }, { status: 404 });

  const t = now();
  const last = await env.DB.prepare('SELECT MAX(created) AS t FROM comments WHERE user = ?').bind(me.id).first();
  if (last && last.t && t - last.t < GAP) {
    return reply(env, origin, { ok: false, why: 'slow', wait: GAP - (t - last.t) }, { status: 429 });
  }
  const day = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE user = ? AND created > ?')
    .bind(me.id, t - 86400).first();
  if (day && day.n >= PER_DAY) return reply(env, origin, { ok: false, why: 'day' }, { status: 429 });

  const res = await env.DB.batch([
    env.DB.prepare('INSERT INTO comments (game, user, text, created) VALUES (?, ?, ?, ?) RETURNING id')
      .bind(game, me.id, text, t),
    env.DB.prepare('INSERT INTO games (id, comments) VALUES (?, 1) ' +
      'ON CONFLICT(id) DO UPDATE SET comments = comments + 1').bind(game),
    env.DB.prepare('SELECT comments FROM games WHERE id = ?').bind(game)
  ]);
  const id = res[0].results[0].id;
  const total = (res[2].results[0] || {}).comments || 0;
  ctx.waitUntil(notify(env, game, me, text));
  return reply(env, origin, {
    ok: true, total: total,
    comment: { id: id, text: text, created: t, user: publicUser(me), own: true, canDelete: true }
  });
}

async function deleteComment(env, origin, me, id) {
  if (!me) return reply(env, origin, { ok: false, why: 'signin' }, { status: 401 });
  const row = await env.DB.prepare('SELECT id, game, user FROM comments WHERE id = ?').bind(id).first();
  if (!row) return reply(env, origin, { ok: true, gone: true });
  if (row.user !== me.id && !me.admin) return reply(env, origin, { ok: false, why: 'not yours' }, { status: 403 });
  const res = await env.DB.batch([
    env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id),
    env.DB.prepare('UPDATE games SET comments = MAX(0, comments - 1) WHERE id = ?').bind(row.game),
    env.DB.prepare('SELECT comments FROM games WHERE id = ?').bind(row.game)
  ]);
  return reply(env, origin, { ok: true, total: (res[2].results[0] || {}).comments || 0 });
}

/* «Забыть меня»: все комментарии человека и запись о нём — одним махом. */
async function forgetMe(env, origin, me) {
  if (!me) return reply(env, origin, { ok: false, why: 'signin' }, { status: 401 });
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE games SET comments = MAX(0, comments - ' +
      '(SELECT COUNT(*) FROM comments WHERE comments.game = games.id AND comments.user = ?))'
    ).bind(me.id),
    env.DB.prepare('DELETE FROM comments WHERE user = ?').bind(me.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(me.id)
  ]);
  return reply(env, origin, { ok: true });
}

/* ── счётчики ──────────────────────────────────────────── */

async function counters(env, origin, ctx, url, body) {
  const id = body && String(body.id || '');
  const visitor = body && String(body.visitor || '');
  if (!ID.test(id) || !VISITOR.test(visitor)) return reply(env, origin, { ok: false, why: 'bad' }, { status: 400 });
  if (!(await known(env, id))) return reply(env, origin, { ok: false, why: 'unknown game' }, { status: 404 });

  if (url.pathname === '/play') {
    const day = today();
    const row = await env.DB
      .prepare('SELECT n FROM plays_today WHERE visitor = ? AND game = ? AND day = ?')
      .bind(visitor, id, day).first();
    if (((row && row.n) || 0) >= PLAYS_A_DAY) {
      const cur = await env.DB.prepare('SELECT plays FROM games WHERE id = ?').bind(id).first();
      return reply(env, origin, { ok: true, counted: false, plays: (cur && cur.plays) || 0 });
    }
    await env.DB.batch([
      env.DB.prepare('INSERT INTO games (id, plays) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET plays = plays + 1').bind(id),
      env.DB.prepare(
        'INSERT INTO plays_today (visitor, game, day, n) VALUES (?, ?, ?, 1) ' +
        'ON CONFLICT(visitor, game, day) DO UPDATE SET n = n + 1'
      ).bind(visitor, id, day)
    ]);
    // Вчерашние строки учёта больше не нужны: чистим попутно.
    ctx.waitUntil(env.DB.prepare('DELETE FROM plays_today WHERE day < ?').bind(day).run());
    const cur = await env.DB.prepare('SELECT plays FROM games WHERE id = ?').bind(id).first();
    return reply(env, origin, { ok: true, counted: true, plays: (cur && cur.plays) || 0 });
  }

  // /like
  const on = !!(body && body.on);
  const had = await env.DB.prepare('SELECT 1 AS yes FROM likes WHERE visitor = ? AND game = ?').bind(visitor, id).first();
  if (on && !had) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO likes (visitor, game) VALUES (?, ?)').bind(visitor, id),
      env.DB.prepare('INSERT INTO games (id, likes) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET likes = likes + 1').bind(id)
    ]);
  } else if (!on && had) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM likes WHERE visitor = ? AND game = ?').bind(visitor, id),
      env.DB.prepare('UPDATE games SET likes = MAX(0, likes - 1) WHERE id = ?').bind(id)
    ]);
  }
  const cur = await env.DB.prepare('SELECT likes FROM games WHERE id = ?').bind(id).first();
  return reply(env, origin, { ok: true, on: on, likes: (cur && cur.likes) || 0 });
}

/* ── маршруты ──────────────────────────────────────────── */

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const m = request.method;

    if (m === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, origin) });

    try {
      /* вход */
      const auth = path.match(/^\/auth\/(google|github)(\/callback)?$/);
      if (auth && m === 'GET') {
        if (!PROVIDERS[auth[1]].ready(env)) return new Response('This sign-in is not set up yet.', { status: 404 });
        return auth[2] ? authDone(env, request, url, auth[1]) : authStart(env, url, auth[1]);
      }

      if (m === 'GET' && path === '/config') {
        return reply(env, origin, {
          ok: true,
          providers: Object.keys(PROVIDERS).filter((p) => PROVIDERS[p].ready(env)),
          max: MAX_LEN
        }, { headers: { 'Cache-Control': 'public, max-age=300' } });
      }

      if (m === 'GET' && path === '/counts') {
        const { results } = await env.DB.prepare('SELECT id, plays, likes, comments FROM games').all();
        const counts = {};
        for (const r of results || []) counts[r.id] = { plays: r.plays, likes: r.likes, comments: r.comments };
        return reply(env, origin, { ok: true, counts }, { headers: { 'Cache-Control': 'public, max-age=60' } });
      }

      if (m === 'GET' && path === '/mine') {
        const visitor = url.searchParams.get('visitor') || '';
        if (!VISITOR.test(visitor)) return reply(env, origin, { ok: false, why: 'visitor' }, { status: 400 });
        const { results } = await env.DB.prepare('SELECT game FROM likes WHERE visitor = ?').bind(visitor).all();
        return reply(env, origin, { ok: true, liked: (results || []).map((r) => r.game) });
      }

      if (path === '/me') {
        const me = await who(env, request);
        if (m === 'GET') {
          return reply(env, origin, { ok: true, user: me ? Object.assign(publicUser(me), { id: me.id, admin: me.admin }) : null });
        }
        if (m === 'DELETE') return forgetMe(env, origin, me);
      }

      if (path === '/comments') {
        const me = await who(env, request);
        if (m === 'GET') return listComments(env, origin, url, me);
        if (m === 'POST') {
          let body = null;
          try { body = await request.json(); } catch (e) { body = null; }
          return postComment(env, origin, ctx, me, body);
        }
      }

      const del = path.match(/^\/comments\/(\d{1,12})$/);
      if (del && m === 'DELETE') return deleteComment(env, origin, await who(env, request), Number(del[1]));

      if (m === 'POST' && (path === '/play' || path === '/like')) {
        let body = null;
        try { body = await request.json(); } catch (e) { body = null; }
        return counters(env, origin, ctx, url, body);
      }

      return reply(env, origin, { ok: false, why: 'no such path' }, { status: 404 });
    } catch (e) {
      return reply(env, origin, { ok: false, why: 'server' }, { status: 500 });
    }
  }
};
