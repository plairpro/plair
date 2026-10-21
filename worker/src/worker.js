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
  if ((await catalog(env)).some((g) => g && g.id === id)) return true;
  // …или игра, которую прислали через форму и одобрил модератор.
  const row = await env.DB.prepare("SELECT 1 AS yes FROM submissions WHERE game = ? AND status = 'approved'").bind(id).first();
  return !!row;
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

/* Ключ подписи. Можно задать секретом SESSION_SECRET; если его нет,
   Worker при первом запуске сам придумывает случайный ключ и хранит его
   в своей же базе — настраивать руками ничего не нужно. */
let keyCache = null, keyFor = '';
async function secret(env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  let row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'session_secret'").first();
  if (!row) {
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    // INSERT OR IGNORE: если два запроса пришли разом, побеждает первый.
    await env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('session_secret', ?)").bind(fresh).run();
    row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'session_secret'").first();
  }
  return row.value;
}
async function key(env) {
  const s = await secret(env);
  if (keyCache && keyFor === s) return keyCache;
  keyFor = s;
  keyCache = await crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
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

/* Google: кнопка «Sign in with Google» на странице сама отдаёт нам
   подписанный Google’ом паспорт (ID-токен). Проверяем подпись по открытым
   ключам Google и что паспорт выписан именно нашему сайту. Секретный
   ключ Google для этого не нужен — только публичный Client ID. */
/* Client ID — публичный, лежит в wrangler.toml (GOOGLE_WEB_CLIENT_ID).
   Берём только то, что похоже на настоящий ID Google: случайно
   вставленная в поле строка не должна сломать вход. */
function googleId(env) {
  const re = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
  for (const v of [env.GOOGLE_WEB_CLIENT_ID, env.GOOGLE_CLIENT_ID]) {
    if (v && re.test(String(v).trim())) return String(v).trim();
  }
  return null;
}

let gKeys = null, gKeysAt = 0;
async function googleKeys(fresh) {
  // Свежие ключи — не чаще раза в пять минут, иначе чужие запросы с
  // выдуманным kid заставят нас дёргать Google на каждый вызов.
  if (gKeys && Date.now() - gKeysAt < (fresh ? 300e3 : 3600e3)) return gKeys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('google keys');
  gKeys = (await r.json()).keys || [];
  gKeysAt = Date.now();
  return gKeys;
}

async function verifyGoogle(env, jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3 || jwt.length > 4000) throw new Error('shape');
  const head = JSON.parse(dec.decode(unb64u(parts[0])));
  if (head.alg !== 'RS256' || !head.kid) throw new Error('alg');
  let k = (await googleKeys(false)).find((x) => x.kid === head.kid);
  if (!k) k = (await googleKeys(true)).find((x) => x.kid === head.kid);   // Google сменил ключи
  if (!k) throw new Error('kid');
  const pub = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, unb64u(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('signature');
  const c = JSON.parse(dec.decode(unb64u(parts[1])));
  if (c.aud !== googleId(env)) throw new Error('aud');
  if (c.iss !== 'accounts.google.com' && c.iss !== 'https://accounts.google.com') throw new Error('iss');
  if (typeof c.exp !== 'number' || c.exp < now() - 60 || !c.sub) throw new Error('exp');
  // Почту не храним: она нужна только здесь, чтобы узнать модератора.
  return { id: 'google:' + c.sub, name: cleanName(c.name || c.given_name) || 'Player',
           avatar: c.picture || null, login: null,
           email: c.email_verified === false ? null : (c.email || null) };
}

async function sha256hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* Модератор — тот, чей адрес Google совпадает с отпечатком в
   ADMIN_EMAIL_SHA256 (wrangler.toml). В репозитории лежит только
   отпечаток, сам адрес нигде не записан. */
async function isAdminEmail(env, email) {
  if (!email) return false;
  const want = String(env.ADMIN_EMAIL_SHA256 || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!want.length) return false;
  return want.indexOf(await sha256hex(String(email).trim().toLowerCase())) !== -1;
}

async function saveUser(env, p) {
  await env.DB.prepare(
    'INSERT INTO users (id, name, avatar, login, created) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, login = excluded.login'
  ).bind(p.id, p.name, p.avatar, p.login, now()).run();
  return seal(env, { k: 's', u: p.id, e: now() + SESSION_DAYS * 86400 });
}

async function googleSignIn(env, origin, body) {
  if (!googleId(env)) return reply(env, origin, { ok: false, why: 'off' }, { status: 404 });
  let p;
  try { p = await verifyGoogle(env, body && body.credential); }
  catch (e) { return reply(env, origin, { ok: false, why: 'google' }, { status: 401 }); }
  const session = await saveUser(env, p);
  if (await isAdminEmail(env, p.email)) {
    await env.DB.prepare('UPDATE users SET admin = 1 WHERE id = ?').bind(p.id).run();
  }
  const u = await env.DB.prepare('SELECT id, name, avatar, login, admin FROM users WHERE id = ?').bind(p.id).first();
  return reply(env, origin, { ok: true, session: session,
    user: Object.assign(publicUser(u), { id: u.id, admin: u.admin === 1 }) });
}

/* GitHub: обычный вход с переходом на github.com и обратно. Ему нужен
   секретный ключ приложения (GITHUB_CLIENT_SECRET); пока его нет,
   кнопка GitHub просто не показывается. */
/* Client ID приложения GitHub — публичный, лежит в wrangler.toml
   (GITHUB_WEB_CLIENT_ID). Старый секрет GITHUB_CLIENT_ID берём, только
   если он похож на настоящий ID. */
function githubId(env) {
  const ok = (v) => /^[A-Za-z0-9._-]{16,40}$/.test(String(v || '').trim());
  if (ok(env.GITHUB_WEB_CLIENT_ID)) return String(env.GITHUB_WEB_CLIENT_ID).trim();
  if (ok(env.GITHUB_CLIENT_ID)) return String(env.GITHUB_CLIENT_ID).trim();
  return '';
}

const PROVIDERS = {
  github: {
    ready: (env) => !!(githubId(env) && env.GITHUB_CLIENT_SECRET),
    start(env, redirect, state) {
      // Пустой scope — только открытые данные профиля.
      return 'https://github.com/login/oauth/authorize?' + new URLSearchParams({
        client_id: githubId(env), redirect_uri: redirect, state: state, scope: '', allow_signup: 'true'
      });
    },
    async profile(env, code, redirect) {
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: githubId(env), client_secret: env.GITHUB_CLIENT_SECRET,
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

/* Вход через GitHub по коду (device flow): без секретного ключа, хватает
   публичного Client ID. Страница просит у нас код, человек вводит его на
   github.com/login/device, страница раз в несколько секунд спрашивает,
   готово ли, — и получает наш пропуск. Код устройства уходит странице
   запечатанным, подменить его нельзя. */
async function githubProfile(token) {
  const u = await fetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'plair-verify' }
  }).then((x) => x.json());
  if (!u || !u.id || !u.login) throw new Error('github: no user');
  return { id: 'github:' + u.id, name: cleanName(u.name || u.login), avatar: u.avatar_url || null,
           login: String(u.login).slice(0, 39) };
}

async function githubDeviceStart(env, origin) {
  if (!githubId(env)) return reply(env, origin, { ok: false, why: 'off' }, { status: 404 });
  const r = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'plair-verify' },
    body: new URLSearchParams({ client_id: githubId(env), scope: '' })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.device_code) return reply(env, origin, { ok: false, why: j.error || 'github' }, { status: 502 });
  const handle = await seal(env, { k: 'dv', d: j.device_code, e: now() + (j.expires_in || 900) });
  return reply(env, origin, { ok: true, handle, code: j.user_code, url: j.verification_uri || 'https://github.com/login/device',
    interval: j.interval || 5, expires: j.expires_in || 900 });
}

async function githubDevicePoll(env, origin, body) {
  const st = await unseal(env, body && body.handle, 'dv');
  if (!st) return reply(env, origin, { ok: false, why: 'expired' }, { status: 400 });
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'plair-verify' },
    body: new URLSearchParams({ client_id: githubId(env), device_code: st.d,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    const wait = j.error === 'authorization_pending' || j.error === 'slow_down';
    return reply(env, origin, { ok: true, done: false, wait, why: j.error || 'github', interval: j.interval || null });
  }
  let p;
  try { p = await githubProfile(j.access_token); }   // ключ GitHub нужен один раз, дальше не храним
  catch (e) { return reply(env, origin, { ok: false, why: 'github' }, { status: 502 }); }
  const session = await saveUser(env, p);
  const u = await env.DB.prepare('SELECT id, name, avatar, login, admin FROM users WHERE id = ?').bind(p.id).first();
  return reply(env, origin, { ok: true, done: true, session,
    user: Object.assign(publicUser(u), { id: u.id, admin: u.admin === 1 }) });
}

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

  const token = await saveUser(env, p);
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
  const u = await env.DB.prepare('SELECT id, name, avatar, login, banned, admin FROM users WHERE id = ?').bind(s.u).first();
  if (!u) return null;
  u.admin = u.admin === 1 || String(env.ADMINS || '').split(',').map((x) => x.trim()).indexOf(u.id) !== -1;
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
    env.DB.prepare('DELETE FROM saves WHERE user = ?').bind(me.id),
    env.DB.prepare('DELETE FROM lists WHERE user = ?').bind(me.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(me.id)
  ]);
  return reply(env, origin, { ok: true });
}

/* ── избранное ─────────────────────────────────────────── */
/* «Сохранить игру» — только для вошедших: список живёт на сервере и
   виден на любом устройстве, где человек вошёл тем же Google. */
async function mySaves(env, origin, me) {
  if (!me) return reply(env, origin, { ok: false, why: 'signin' }, { status: 401 });
  const { results } = await env.DB.prepare('SELECT game FROM saves WHERE user = ? ORDER BY created DESC').bind(me.id).all();
  return reply(env, origin, { ok: true, saved: (results || []).map((r) => r.game) });
}

async function setSave(env, origin, me, body) {
  if (!me) return reply(env, origin, { ok: false, why: 'signin' }, { status: 401 });
  const game = String((body && body.game) || '');
  if (!ID.test(game)) return reply(env, origin, { ok: false, why: 'bad' }, { status: 400 });
  if (body.on) {
    if (!(await known(env, game))) return reply(env, origin, { ok: false, why: 'unknown game' }, { status: 404 });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM saves WHERE user = ?').bind(me.id).first();
    if (n && n.n >= 500) return reply(env, origin, { ok: false, why: 'full' }, { status: 429 });
    await env.DB.prepare('INSERT OR IGNORE INTO saves (user, game, created) VALUES (?, ?, ?)').bind(me.id, game, now()).run();
  } else {
    await env.DB.prepare('DELETE FROM saves WHERE user = ? AND game = ?').bind(me.id, game).run();
  }
  return reply(env, origin, { ok: true, on: !!body.on });
}

/* PLAIR-лист: делимся своим избранным по ссылке plair.pro/?list=<код>.
   Список живой — что человек сохранит потом, увидят и по старой ссылке. */
const CODE = /^[A-Za-z0-9]{8,12}$/;
function newCode() {
  const abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => abc[b % abc.length]).join('');
}

async function shareList(env, origin, me) {
  if (!me) return reply(env, origin, { ok: false, why: 'signin' }, { status: 401 });
  let row = await env.DB.prepare('SELECT code FROM lists WHERE user = ?').bind(me.id).first();
  if (!row) {
    await env.DB.prepare('INSERT OR IGNORE INTO lists (code, user, created) VALUES (?, ?, ?)').bind(newCode(), me.id, now()).run();
    row = await env.DB.prepare('SELECT code FROM lists WHERE user = ?').bind(me.id).first();
  }
  return reply(env, origin, { ok: true, code: row.code });
}

async function readList(env, origin, code) {
  if (!CODE.test(code)) return reply(env, origin, { ok: false, why: 'bad' }, { status: 400 });
  const row = await env.DB.prepare(
    'SELECT l.user, u.name, u.avatar FROM lists l JOIN users u ON u.id = l.user WHERE l.code = ?'
  ).bind(code).first();
  if (!row) return reply(env, origin, { ok: false, why: 'gone' }, { status: 404 });
  const { results } = await env.DB.prepare('SELECT game FROM saves WHERE user = ? ORDER BY created DESC LIMIT 500')
    .bind(row.user).all();
  return reply(env, origin, {
    ok: true, owner: { name: row.name, avatar: row.avatar || null },
    games: (results || []).map((r) => r.game)
  }, { headers: { 'Cache-Control': 'public, max-age=30' } });
}

/* ── счётчики ──────────────────────────────────────────── */

const SECONDS_A_CALL = 60;    // секунд в игре за один запрос
const SECONDS_A_DAY = 1800;   // секунд одной игры с браузера в сутки

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

  if (url.pathname === '/share' || url.pathname === '/time' || url.pathname === '/skip') {
    const kind = url.pathname.slice(1);
    const once = kind !== 'time';
    // Репост и скип (закрыл игру быстрее 10 секунд) засчитываем один раз
    // в сутки с браузера на игру — так чужую игру не утопить, закрывая её
    // раз за разом. Время — кусками до минуты, не больше получаса в сутки.
    const want = once ? 1 : Math.floor(Number(body.seconds) || 0);
    const cap = once ? 1 : SECONDS_A_DAY;
    if (!(want > 0)) return reply(env, origin, { ok: false, why: 'bad' }, { status: 400 });
    const day = today();
    const row = await env.DB
      .prepare('SELECT n FROM acts_today WHERE visitor = ? AND game = ? AND day = ? AND kind = ?')
      .bind(visitor, id, day, kind).first();
    const add = Math.min(want, SECONDS_A_CALL, cap - ((row && row.n) || 0));
    if (add > 0) {
      const col = { share: 'shares', time: 'seconds', skip: 'skips' }[kind];
      await env.DB.batch([
        env.DB.prepare('INSERT INTO games (id, ' + col + ') VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET ' +
          col + ' = ' + col + ' + excluded.' + col).bind(id, add),
        env.DB.prepare(
          'INSERT INTO acts_today (visitor, game, day, kind, n) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(visitor, game, day, kind) DO UPDATE SET n = n + excluded.n'
        ).bind(visitor, id, day, kind, add)
      ]);
      ctx.waitUntil(env.DB.prepare('DELETE FROM acts_today WHERE day < ?').bind(day).run());
    }
    return reply(env, origin, { ok: true, counted: Math.max(0, add) });
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

/* ── таблицы ────────────────────────────────────────────── */
/* Worker сам создаёт свои таблицы при первом запросе — отдельно
   запускать schema.sql не нужно (он лежит рядом для справки). */
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, plays INTEGER NOT NULL DEFAULT 0, ' +
    'likes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS plays_today (visitor TEXT NOT NULL, game TEXT NOT NULL, day TEXT NOT NULL, ' +
    'n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (visitor, game, day))',
  'CREATE INDEX IF NOT EXISTS plays_today_day ON plays_today (day)',
  'CREATE TABLE IF NOT EXISTS likes (visitor TEXT NOT NULL, game TEXT NOT NULL, PRIMARY KEY (visitor, game))',
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT, login TEXT, ' +
    'created INTEGER NOT NULL, banned INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, ' +
    'user TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS comments_game ON comments (game, id DESC)',
  'CREATE INDEX IF NOT EXISTS comments_user ON comments (user, created)',
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  // Игры, присланные через форму. Ждут модератора (pending), потом
  // approved или rejected. game — id в ленте, выдаётся при одобрении.
  'CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT, ' +
    'url TEXT NOT NULL, title TEXT NOT NULL, blurb TEXT, tags TEXT, cover TEXT, cover_data TEXT, ' +
    'by TEXT, by_url TEXT, contact TEXT, user TEXT, ip TEXT, ' +
    "status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL, decided INTEGER)",
  'CREATE INDEX IF NOT EXISTS submissions_status ON submissions (status, created)',
  'CREATE UNIQUE INDEX IF NOT EXISTS submissions_game ON submissions (game)',
  'CREATE TABLE IF NOT EXISTS saves (user TEXT NOT NULL, game TEXT NOT NULL, created INTEGER NOT NULL, ' +
    'PRIMARY KEY (user, game))',
  // PLAIR-лист: публичная ссылка на чьё-то избранное. Код случайный —
  // по нему нельзя узнать аккаунт, и подобрать чужой список тоже нельзя.
  'CREATE TABLE IF NOT EXISTS lists (code TEXT PRIMARY KEY, user TEXT NOT NULL UNIQUE, created INTEGER NOT NULL)',
  // Суточный учёт репостов и секунд в игре с одного браузера — чтобы их
  // нельзя было накрутить. Вчерашние строки стираются попутно.
  'CREATE TABLE IF NOT EXISTS acts_today (visitor TEXT NOT NULL, game TEXT NOT NULL, day TEXT NOT NULL, ' +
    'kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (visitor, game, day, kind))',
  'CREATE INDEX IF NOT EXISTS acts_today_day ON acts_today (day)'
];
let installed = null;
function install(env) {
  if (!installed) {
    installed = env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)))
      // Столбец «модератор» появился позже таблицы — добавляем, если его нет.
      .then(() => env.DB.prepare('ALTER TABLE users ADD COLUMN admin INTEGER NOT NULL DEFAULT 0').run().catch(() => {}))
      // Репосты и время в игре появились позже — тоже добавляем при надобности.
      .then(() => env.DB.prepare('ALTER TABLE games ADD COLUMN shares INTEGER NOT NULL DEFAULT 0').run().catch(() => {}))
      .then(() => env.DB.prepare('ALTER TABLE games ADD COLUMN seconds INTEGER NOT NULL DEFAULT 0').run().catch(() => {}))
      .then(() => env.DB.prepare('ALTER TABLE games ADD COLUMN skips INTEGER NOT NULL DEFAULT 0').run().catch(() => {}))
      // Вес присланной игры в байтах — тоже появился позже.
      .then(() => env.DB.prepare('ALTER TABLE submissions ADD COLUMN weight INTEGER').run().catch(() => {}))
      // Чем автор доказал, что игра его: github / code / moderator.
      .then(() => env.DB.prepare('ALTER TABLE submissions ADD COLUMN proof TEXT').run().catch(() => {}))
      .catch((e) => { installed = null; throw e; });
  }
  return installed;
}

/* ── игры от авторов ───────────────────────────────────── */

const SUBMITS_A_DAY = 5;        // заявок с одного адреса в сутки
const MAX_PENDING = 300;        // больше в очереди не держим
const MAX_COVER = 460000;       // символов в обложке data:… (~340 КБ картинки)
const MAX_WEIGHT = 10 * 1024 * 1024;  // байт: тяжелее игру не принимаем (вес меряет страница)

function cleanUrl(v) {
  try {
    const u = new URL(String(v || '').trim());
    if (u.protocol !== 'https:' || String(v).length > 400) return null;
    u.hash = '';
    return u.toString();
  } catch (e) { return null; }
}

function slugify(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

/* ── «это моя игра» ───────────────────────────────────── */
/* Прислать можно только свою игру. Два способа доказать:
   1) вход через GitHub тем аккаунтом, на чьём name.github.io лежит игра;
   2) код в самой игре — строка <meta name="plair-verify" content="…">
      в index.html или файл plair.txt с кодом рядом с ним. Код выводится
      из адреса папки игры и нашего секрета: для каждой игры свой, а
      положить его туда может только тот, кто правит сайт. */
function gameDir(url) {
  const u = new URL(url);
  u.search = ''; u.hash = '';
  u.pathname = u.pathname.replace(/[^/]*$/, '');
  return u.toString();
}
async function ownerCode(env, url) {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), enc.encode('verify|' + gameDir(url))));
  return 'plair-' + Array.from(sig.slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function pageHas(target, code) {
  try {
    const u = new URL(target);
    u.searchParams.set('plair-check', String(Date.now()));   // мимо кэша GitHub Pages
    const r = await fetch(u.toString(), { redirect: 'follow', cf: { cacheTtl: 0 },
      headers: { 'User-Agent': 'PLAIR-verify (+https://plair.pro)' } });
    if (!r.ok) return false;
    if (Number(r.headers.get('content-length')) > 3000000) return false;
    return (await r.text()).slice(0, 3000000).indexOf(code) !== -1;
  } catch (e) { return false; }
}
/* Игра на странице организации (team.github.io): пускаем участника,
   если он открыто состоит в ней (GitHub отвечает 204). */
async function publicMember(org, login) {
  try {
    const r = await fetch('https://api.github.com/orgs/' + org + '/public_members/' + login, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'plair-verify' } });
    return r.status === 204;
  } catch (e) { return false; }
}
async function proveOwner(env, url, me) {
  const code = await ownerCode(env, url);
  if (me && me.admin) return { ok: true, how: 'moderator', code };
  const host = new URL(url).hostname.toLowerCase();
  if (me && /^github:/.test(me.id) && me.login) {
    const owner = (host.match(/^([a-z0-9-]+)\.github\.io$/) || [])[1];
    const login = String(me.login).toLowerCase();
    if (owner && (owner === login || await publicMember(owner, login))) return { ok: true, how: 'github', code, login: me.login };
  }
  if (await pageHas(url, code) || await pageHas(gameDir(url) + 'plair.txt', code)) return { ok: true, how: 'code', code };
  return { ok: false, code };
}

async function verifyGame(env, origin, me, body) {
  const url = cleanUrl(body && body.url);
  if (!url) return reply(env, origin, { ok: false, why: 'url' }, { status: 400 });
  const p = await proveOwner(env, url, me);
  return reply(env, origin, { ok: true, verified: p.ok, how: p.how || null, code: p.code, login: p.login || null });
}

function author(url) {
  const u = new URL(url);
  const m = u.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  return m ? { by: m[1], byUrl: 'https://github.com/' + m[1] } : { by: u.hostname, byUrl: u.origin };
}

async function notifyText(env, text) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return;
  try {
    await fetch('https://api.telegram.org/bot' + env.TG_BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text: text, disable_web_page_preview: true })
    });
  } catch (e) { /* не страшно */ }
}

async function submitGame(env, origin, request, ctx, me, body) {
  body = body || {};
  const url = cleanUrl(body.url);
  const title = cleanName(body.title).slice(0, 40);
  if (!url) return reply(env, origin, { ok: false, why: 'url' }, { status: 400 });
  if (!title) return reply(env, origin, { ok: false, why: 'title' }, { status: 400 });
  const blurb = cleanText(body.blurb).replace(/\s+/g, ' ').slice(0, 120);
  const tags = (Array.isArray(body.tags) ? body.tags : [])
    .map(String).filter((t) => /^[A-Za-z]{2,20}$/.test(t)).slice(0, 5);
  const cover = typeof body.cover === 'string' && /^https:\/\/\S{4,500}$/.test(body.cover) ? body.cover : null;
  const coverData = typeof body.coverData === 'string' && body.coverData.length <= MAX_COVER &&
    /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+\/=]+$/.test(body.coverData) ? body.coverData : null;
  const contact = cleanName(body.contact).slice(0, 100) || null;
  // Вес игры меряет страница при вставке ссылки. Тяжелее предела — сразу
  // отказ; если измерить не вышло (сайт закрыт), решает модератор.
  const weight = Number.isFinite(Number(body.weight)) && Number(body.weight) > 0 ? Math.round(Number(body.weight)) : null;
  if (weight && weight > MAX_WEIGHT) return reply(env, origin, { ok: false, why: 'heavy', weight, max: MAX_WEIGHT }, { status: 413 });
  const a = author(url);
  const proof = await proveOwner(env, url, me);
  if (!proof.ok) return reply(env, origin, { ok: false, why: 'verify', code: proof.code }, { status: 403 });

  // Адрес отправителя храним только отпечатком — для лимита заявок.
  const ip = (await sha256hex((request.headers.get('CF-Connecting-IP') || '') + '|' + await secret(env))).slice(0, 24);
  const t = now();
  const day = await env.DB.prepare('SELECT COUNT(*) AS n FROM submissions WHERE ip = ? AND created > ?').bind(ip, t - 86400).first();
  if (day && day.n >= SUBMITS_A_DAY) return reply(env, origin, { ok: false, why: 'day' }, { status: 429 });
  const dup = await env.DB.prepare("SELECT status FROM submissions WHERE url = ? AND status IN ('pending','approved')").bind(url).first();
  if (dup) return reply(env, origin, { ok: true, duplicate: true, status: dup.status });
  const queue = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending'").first();
  if (queue && queue.n >= MAX_PENDING) return reply(env, origin, { ok: false, why: 'busy' }, { status: 429 });

  await env.DB.prepare(
    'INSERT INTO submissions (url, title, blurb, tags, cover, cover_data, by, by_url, contact, user, ip, created, weight, proof) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(url, title, blurb || null, JSON.stringify(tags), cover, coverData, a.by, a.byUrl, contact,
         me ? me.id : null, ip, t, weight, proof.how).run();

  ctx.waitUntil(notifyText(env, 'New game for review: ' + title + '\n' + url +
    '\nSize: ' + (weight ? (weight / 1048576).toFixed(1) + ' MB' : 'unknown') +
    '\nOwner proof: ' + (proof.how === 'github' ? 'GitHub @' + proof.login : proof.how) +
    (contact ? '\nContact: ' + contact : '') + '\n\nReview: https://plair.pro/?review=1'));
  return reply(env, origin, { ok: true });
}

function gameOut(origin, r) {
  return {
    id: r.game, title: r.title, blurb: r.blurb || '', tags: JSON.parse(r.tags || '[]'),
    cover: r.has_data ? origin + '/cover/' + r.game : (r.cover || ''),
    url: r.url, repo: r.by_url, by: r.by, byUrl: r.by_url,
    added: new Date((r.decided || r.created) * 1000).toISOString().slice(0, 10),
    // Автор доказал, что игра его (GitHub или код на странице) — в ленте галочка.
    verified: r.proof === 'github' || r.proof === 'code'
  };
}

async function approvedGames(env, origin, url) {
  const { results } = await env.DB.prepare(
    'SELECT game, title, blurb, tags, cover, (cover_data IS NOT NULL) AS has_data, url, by, by_url, created, decided, proof ' +
    "FROM submissions WHERE status = 'approved' ORDER BY decided DESC LIMIT 500"
  ).all();
  return reply(env, origin, { ok: true, games: (results || []).map((r) => gameOut(url.origin, r)) },
    { headers: { 'Cache-Control': 'public, max-age=60' } });
}

async function coverImage(env, game) {
  const r = await env.DB.prepare("SELECT cover_data FROM submissions WHERE game = ? AND status = 'approved'").bind(game).first();
  const m = r && r.cover_data && r.cover_data.match(/^data:(image\/(?:webp|jpeg|png));base64,(.+)$/);
  if (!m) return new Response('Not found', { status: 404 });
  return new Response(unb64u(m[2].replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')), {
    headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' }
  });
}

async function listSubmissions(env, origin, me) {
  if (!me || !me.admin) return reply(env, origin, { ok: false, why: 'admin' }, { status: 403 });
  const { results } = await env.DB.prepare(
    "SELECT id, url, title, blurb, tags, cover, cover_data, by, by_url, contact, created, weight, proof FROM submissions " +
    "WHERE status = 'pending' ORDER BY created ASC LIMIT 20"
  ).all();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending'").first();
  return reply(env, origin, {
    ok: true, total: (total && total.n) || 0,
    items: (results || []).map((r) => ({
      id: r.id, url: r.url, title: r.title, blurb: r.blurb || '', tags: JSON.parse(r.tags || '[]'),
      cover: r.cover_data || r.cover || '', by: r.by, byUrl: r.by_url, contact: r.contact || '', created: r.created,
      weight: r.weight || null, proof: r.proof || null
    }))
  });
}

async function decide(env, origin, me, id, body) {
  if (!me || !me.admin) return reply(env, origin, { ok: false, why: 'admin' }, { status: 403 });
  const row = await env.DB.prepare('SELECT id, title, url, status FROM submissions WHERE id = ?').bind(id).first();
  if (!row) return reply(env, origin, { ok: false, why: 'gone' }, { status: 404 });
  const action = body && body.action;
  if (action === 'reject' || action === 'unpublish') {
    await env.DB.prepare("UPDATE submissions SET status = 'rejected', decided = ? WHERE id = ?").bind(now(), id).run();
    return reply(env, origin, { ok: true, status: 'rejected' });
  }
  if (action !== 'approve') return reply(env, origin, { ok: false, why: 'action' }, { status: 400 });
  if (row.status === 'approved') return reply(env, origin, { ok: true, status: 'approved' });
  // id в ленте: из названия, а если оно не латиницей — из адреса игры.
  const path = new URL(row.url).pathname.split('/').filter(Boolean).pop() || new URL(row.url).hostname.split('.')[0];
  const base = slugify(row.title) || slugify(path) || 'game';
  const taken = new Set((await catalog(env)).map((g) => g && g.id));
  let game = base, n = 2;
  while (taken.has(game) ||
         await env.DB.prepare('SELECT 1 AS yes FROM submissions WHERE game = ?').bind(game).first()) {
    game = (base.slice(0, 36) + '-' + n++);
  }
  await env.DB.prepare("UPDATE submissions SET status = 'approved', game = ?, decided = ? WHERE id = ?")
    .bind(game, now(), id).run();
  return reply(env, origin, { ok: true, status: 'approved', game: game });
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
      await install(env);

      /* вход */
      if (path === '/auth/google/token' && m === 'POST') {
        let body = null;
        try { body = await request.json(); } catch (e) { body = null; }
        return googleSignIn(env, origin, body);
      }

      if (path === '/auth/github/device' && m === 'POST') return githubDeviceStart(env, origin);
      if (path === '/auth/github/poll' && m === 'POST') {
        let body = null;
        try { body = await request.json(); } catch (e) { body = null; }
        return githubDevicePoll(env, origin, body);
      }

      const auth = path.match(/^\/auth\/(github)(\/callback)?$/);
      if (auth && m === 'GET') {
        if (!PROVIDERS[auth[1]].ready(env)) return new Response('This sign-in is not set up yet.', { status: 404 });
        return auth[2] ? authDone(env, request, url, auth[1]) : authStart(env, url, auth[1]);
      }

      if (m === 'GET' && path === '/config') {
        return reply(env, origin, {
          ok: true,
          providers: (googleId(env) ? ['google'] : [])
            .concat(Object.keys(PROVIDERS).filter((p) => PROVIDERS[p].ready(env))),
          google: googleId(env),
          // Вход GitHub для авторов: по коду, если секретного ключа нет.
          github: githubId(env) ? (env.GITHUB_CLIENT_SECRET ? 'web' : 'device') : null,
          max: MAX_LEN
        }, { headers: { 'Cache-Control': 'public, max-age=300' } });
      }

      if (path === '/saves') {
        const me = await who(env, request);
        if (m === 'GET') return mySaves(env, origin, me);
        if (m === 'POST') {
          let body = null;
          try { body = await request.json(); } catch (e) { body = null; }
          return setSave(env, origin, me, body || {});
        }
      }

      if (path === '/lists' && m === 'POST') return shareList(env, origin, await who(env, request));
      const lst = path.match(/^\/lists\/([A-Za-z0-9]{1,20})$/);
      if (lst && m === 'GET') return readList(env, origin, lst[1]);

      if (path === '/submit' && m === 'POST') {
        let body = null;
        try { body = await request.json(); } catch (e) { body = null; }
        return submitGame(env, origin, request, ctx, await who(env, request), body);
      }
      if (path === '/verify' && m === 'POST') {
        let body = null;
        try { body = await request.json(); } catch (e) { body = null; }
        return verifyGame(env, origin, await who(env, request), body);
      }
      if (path === '/games' && m === 'GET') return approvedGames(env, origin, url);
      const cov = path.match(/^\/cover\/([a-z0-9-]{1,40})$/);
      if (cov && m === 'GET') return coverImage(env, cov[1]);
      if (path === '/submissions' && m === 'GET') return listSubmissions(env, origin, await who(env, request));
      const dec = path.match(/^\/submissions\/(\d{1,10})$/);
      if (dec && m === 'POST') {
        let body = null;
        try { body = await request.json(); } catch (e) { body = null; }
        return decide(env, origin, await who(env, request), Number(dec[1]), body);
      }

      if (m === 'GET' && path === '/counts') {
        const [g, sv] = await env.DB.batch([
          env.DB.prepare('SELECT id, plays, likes, comments, shares, seconds, skips FROM games'),
          env.DB.prepare('SELECT game, COUNT(*) AS n FROM saves GROUP BY game')
        ]);
        const counts = {};
        const one = (id) => counts[id] || (counts[id] = { plays: 0, likes: 0, comments: 0, shares: 0, seconds: 0, saves: 0, skips: 0 });
        for (const r of g.results || []) {
          Object.assign(one(r.id), { plays: r.plays, likes: r.likes, comments: r.comments, shares: r.shares || 0, seconds: r.seconds || 0, skips: r.skips || 0 });
        }
        for (const r of sv.results || []) one(r.game).saves = r.n;
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

      if (m === 'POST' && /^\/(play|like|share|time|skip)$/.test(path)) {
        // Время в игре при закрытии вкладки приходит через sendBeacon —
        // текстом, без заголовка JSON. Читаем тело в любом виде.
        let body = null;
        try { body = JSON.parse(await request.text()); } catch (e) { body = null; }
        return counters(env, origin, ctx, url, body);
      }

      return reply(env, origin, { ok: false, why: 'no such path' }, { status: 404 });
    } catch (e) {
      return reply(env, origin, { ok: false, why: 'server' }, { status: 500 });
    }
  }
};
