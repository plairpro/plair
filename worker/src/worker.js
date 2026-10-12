/* Счётчики ленты plair.pro/games.
 *
 * Что здесь лежит: сколько раз игру запускали и сколько ей поставили
 * лайков. Больше ничего. Браузер присылает случайный номер, который сам
 * себе выдал и держит у себя, — он нужен ровно для двух вещей: не дать
 * накрутить запуски перезагрузкой и не дать лайкнуть дважды. По нему
 * нельзя узнать человека, и он никуда дальше не идёт.
 *
 * D1, а не KV: у KV на бесплатном тарифе не только тысяча записей в
 * сутки, но и одна запись в секунду на ключ. Счётчик запусков одной игры
 * — это ровно один ключ, так что в час пик записи просто терялись бы.
 */

const ORIGINS = ['https://plair.pro', 'https://www.plair.pro'];
const CATALOG = 'https://plair.pro/games/games.json';

// Запусков с одного браузера на одну игру в сутки.
const PLAYS_A_DAY = 10;

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VISITOR = /^[a-f0-9]{16,64}$/;

function cors(origin) {
  const allow = ORIGINS.indexOf(origin) !== -1 ? origin : ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function reply(body, init, origin) {
  return new Response(JSON.stringify(body), {
    status: (init && init.status) || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8' },
      cors(origin),
      (init && init.headers) || {}
    )
  });
}

/* Игру принимаем только ту, что есть в каталоге, — иначе в таблицу
   насыплют выдуманных имён. Каталог тянем через кэш Worker’а, чтобы не
   ходить за ним на каждый запуск. */
async function known(id) {
  const r = await fetch(CATALOG, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) return false;
  const list = await r.json();
  return Array.isArray(list) && list.some((g) => g && g.id === id);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    /* ── все счётчики разом ─────────────────────────────────── */
    if (request.method === 'GET' && url.pathname === '/counts') {
      const { results } = await env.DB
        .prepare('SELECT id, plays, likes, comments FROM games')
        .all();
      const counts = {};
      for (const row of results || []) {
        counts[row.id] = { plays: row.plays, likes: row.likes, comments: row.comments };
      }
      // Минута кэша: лента и так перечитывает их при открытии.
      return reply({ ok: true, counts }, { headers: { 'Cache-Control': 'public, max-age=60' } }, origin);
    }

    /* ── мой лайк на этой игре ──────────────────────────────── */
    if (request.method === 'GET' && url.pathname === '/mine') {
      const visitor = url.searchParams.get('visitor') || '';
      if (!VISITOR.test(visitor)) return reply({ ok: false, why: 'visitor' }, { status: 400 }, origin);
      const { results } = await env.DB
        .prepare('SELECT game FROM likes WHERE visitor = ?')
        .bind(visitor).all();
      return reply({ ok: true, liked: (results || []).map((r) => r.game) }, null, origin);
    }

    if (request.method !== 'POST') {
      return reply({ ok: false, why: 'method' }, { status: 405 }, origin);
    }

    let body;
    try { body = await request.json(); } catch (e) { body = null; }
    const id = body && String(body.id || '');
    const visitor = body && String(body.visitor || '');
    if (!ID.test(id) || !VISITOR.test(visitor)) {
      return reply({ ok: false, why: 'bad' }, { status: 400 }, origin);
    }
    if (!(await known(id))) {
      return reply({ ok: false, why: 'unknown game' }, { status: 404 }, origin);
    }

    /* ── запуск ─────────────────────────────────────────────── */
    if (url.pathname === '/play') {
      const day = today();
      const row = await env.DB
        .prepare('SELECT n FROM plays_today WHERE visitor = ? AND game = ? AND day = ?')
        .bind(visitor, id, day).first();
      const n = (row && row.n) || 0;
      if (n >= PLAYS_A_DAY) {
        const cur = await env.DB.prepare('SELECT plays FROM games WHERE id = ?').bind(id).first();
        return reply({ ok: true, counted: false, plays: (cur && cur.plays) || 0 }, null, origin);
      }
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO games (id, plays) VALUES (?, 1) ' +
          'ON CONFLICT(id) DO UPDATE SET plays = plays + 1'
        ).bind(id),
        env.DB.prepare(
          'INSERT INTO plays_today (visitor, game, day, n) VALUES (?, ?, ?, 1) ' +
          'ON CONFLICT(visitor, game, day) DO UPDATE SET n = n + 1'
        ).bind(visitor, id, day)
      ]);
      // Вчерашние строки учёта больше не нужны: чистим понемногу, попутно.
      ctx.waitUntil(env.DB.prepare('DELETE FROM plays_today WHERE day < ?').bind(day).run());
      const cur = await env.DB.prepare('SELECT plays FROM games WHERE id = ?').bind(id).first();
      return reply({ ok: true, counted: true, plays: (cur && cur.plays) || 0 }, null, origin);
    }

    /* ── лайк ───────────────────────────────────────────────── */
    if (url.pathname === '/like') {
      const on = !!(body && body.on);
      const had = await env.DB
        .prepare('SELECT 1 AS yes FROM likes WHERE visitor = ? AND game = ?')
        .bind(visitor, id).first();
      if (on && !had) {
        await env.DB.batch([
          env.DB.prepare('INSERT INTO likes (visitor, game) VALUES (?, ?)').bind(visitor, id),
          env.DB.prepare(
            'INSERT INTO games (id, likes) VALUES (?, 1) ' +
            'ON CONFLICT(id) DO UPDATE SET likes = likes + 1'
          ).bind(id)
        ]);
      } else if (!on && had) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM likes WHERE visitor = ? AND game = ?').bind(visitor, id),
          env.DB.prepare('UPDATE games SET likes = MAX(0, likes - 1) WHERE id = ?').bind(id)
        ]);
      }
      const cur = await env.DB.prepare('SELECT likes FROM games WHERE id = ?').bind(id).first();
      return reply({ ok: true, on: on, likes: (cur && cur.likes) || 0 }, null, origin);
    }

    return reply({ ok: false, why: 'no such path' }, { status: 404 }, origin);
  }
};
