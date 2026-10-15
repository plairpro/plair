/* Лента игр plair.pro/games — тестовая сборка.
 *
 * Проверки настоящие: страница сама спрашивает у GitHub, существует ли
 * репозиторий, кто им владеет и по какому адресу лежит игра. Вход пока
 * не сделан, поэтому имя пользователя страница принимает на веру — на
 * это честно указано и в шапке, и в форме.
 *
 * Каталог — файл games.json рядом с этой страницей. Форма публикации
 * не пишет в него сама (для записи нужен ключ, а ему в браузере не
 * место): она собирает готовый файл целиком, даёт его скопировать и
 * ведёт на страницу правки этого файла на GitHub.
 */
(function () {
  'use strict';

  var CATALOG = '/games/games.json';
  /* Адрес счётчиков — Worker на Cloudflare, см. worker/README.md.
     Пока строка пуста, лента живёт как раньше: «Популярное» совпадает
     с «Новым», и подсказка «i» говорит об этом прямо. */
  var COUNTS = 'https://plair-counts.timurshorts.workers.dev';
  var EDIT_URL = 'https://github.com/plairpro/plair/edit/main/games/games.json';
  var API = 'https://api.github.com';

  var TAGS = ['Arcade', 'Puzzle', 'Runner', 'Racing', 'Shooter', 'Platformer', 'Adventure',
              'Strategy', 'Roguelike', 'Simulation', 'Rhythm', 'Card', 'Word', 'Physics',
              'Multiplayer', 'Education', 'Casual', 'Horror', 'Atmospheric', 'Experimental'];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  var games = [];
  var filter = 'All';

  /* Поиск: по названию, жанрам, описанию и нику автора, плюс латинский
     id игры. Регистр, ё/е и
     диакритика не важны. Несколько слов ищутся все сразу, каждое — где
     угодно в карточке: «arcade drone» найдёт аркаду про дрон. */
  var query = '';
  try { query = new URLSearchParams(location.search).get('q') || ''; } catch (e) {}

  function fold(v) {
    return String(v == null ? '' : v).toLowerCase().replace(/ё/g, 'е')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function words(q) { return fold(q).split(/[\s,]+/).filter(Boolean); }
  function haystack(g) {
    if (g._hay == null) {
      /* id — латинское имя игры из адреса репозитория. С ним «Офис»
         находится и по «office», «Сдвиг» — по «shift». */
      g._hay = fold([g.title, g.id, (g.tags || []).join(' '), g.blurb, g.by, '@' + g.by].join(' '));
    }
    return g._hay;
  }
  function matches(g) {
    var w = words(query);
    if (!w.length) return true;
    var h = haystack(g);
    return w.every(function (x) { return h.indexOf(x) !== -1; });
  }

  /* Порядок в ленте. По умолчанию — свежие сверху.
     Популярность: запуск весит единицу, лайк — пять, комментарий —
     пятнадцать. Лестница отражает цену действия: запуск это одно
     касание, лайк требует входа, комментарий — ещё и написать.
     Времени в формуле нет намеренно: каталог маленький, и затухание
     по возрасту тут только путало бы. Равный счёт разводим по дате,
     чтобы порядок был устойчивым, а не случайным. */
  var SORTS = { fresh: 'New', hot: 'Popular' };
  var order = 'fresh';
  try { if (SORTS[localStorage.getItem('plair-order')]) order = localStorage.getItem('plair-order'); } catch (e) {}

  /* Случайный номер этого браузера. Нужен ровно для двух вещей: не дать
     накрутить запуски перезагрузкой и не дать лайкнуть дважды. Человека
     по нему не узнать, за пределы счётчиков он не уходит. */
  function visitor() {
    var v = '';
    try { v = localStorage.getItem('plair-visitor') || ''; } catch (e) {}
    if (!/^[a-f0-9]{16,64}$/.test(v)) {
      var a = new Uint8Array(12);
      (crypto.getRandomValues ? crypto : { getRandomValues: function (x) {
        for (var i = 0; i < x.length; i++) x[i] = Math.floor(Math.random() * 256);
      } }).getRandomValues(a);
      v = [].map.call(a, function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
      try { localStorage.setItem('plair-visitor', v); } catch (e) {}
    }
    return v;
  }

  /* Запуск засчитывается не чаще десяти раз в сутки с браузера на игру.
     Тот же предел стоит и на сервере — здесь он лишь бережёт лишний
     запрос, полагаться на него одного нельзя. */
  function mayCount(id) {
    var key = 'plair-plays', day = new Date().toISOString().slice(0, 10), box = {};
    try { box = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) {}
    if (box.day !== day) box = { day: day, n: {} };
    if ((box.n[id] || 0) >= 10) return false;
    box.n[id] = (box.n[id] || 0) + 1;
    try { localStorage.setItem(key, JSON.stringify(box)); } catch (e) {}
    return true;
  }

  function countPlay(g) {
    if (!COUNTS || !g || !g.id || !mayCount(g.id)) return;
    fetch(COUNTS + '/play', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: g.id, visitor: visitor() }), keepalive: true
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok && d.counted) g.plays = d.plays;
    }).catch(function () {});
  }

  function loadCounts() {
    if (!COUNTS) return Promise.resolve(false);
    return fetch(COUNTS + '/counts')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok) return false;
        games.forEach(function (g) {
          var c = d.counts[g.id];
          if (!c) return;
          g.plays = c.plays; g.likes = c.likes; g.comments = c.comments;
          drawTalk(g); drawLike(g);
        });
        return true;
      })
      .catch(function () { return false; });
  }

  function score(g) {
    return (Number(g.plays) || 0) + 5 * (Number(g.likes) || 0) + 15 * (Number(g.comments) || 0);
  }

  function byDate(a, b) { return String(b.added).localeCompare(String(a.added)); }
  function byScore(a, b) { return score(b) - score(a) || byDate(a, b); }
  var me = null;          // {login, name, avatar} — со слов пользователя, проверено у GitHub
  var picked = [];

  /* ── кто я ───────────────────────────────────────────── */

  try { me = JSON.parse(localStorage.getItem('plair-games-me') || 'null'); } catch (e) { me = null; }

  function saveMe() {
    try {
      if (me) localStorage.setItem('plair-games-me', JSON.stringify(me));
      else localStorage.removeItem('plair-games-me');
    } catch (e) { /* приватное окно — переживём */ }
    drawWho();
  }

  var ICON_USER = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="8.5" r="3.7"/><path d="M4.8 20c.6-3.8 3.6-6 7.2-6s6.6 2.2 7.2 6" ' +
    'stroke-linecap="round"/></svg>';

  function drawWho() {
    var b = $('who');
    b.innerHTML = me
      ? '<img src="' + esc(avatar(me.login)) + '" alt=""><b>@' + esc(me.login) + '</b>'
      : ICON_USER + '<b>Who are you?</b>';
    b.setAttribute('aria-label', me ? 'Signed in as @' + me.login : 'Set your GitHub name');
  }

  function avatar(login) { return 'https://github.com/' + encodeURIComponent(login) + '.png?size=64'; }

  /* ── запросы к GitHub ────────────────────────────────── */

  function gh(path) {
    return fetch(API + path, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) {
        if (r.status === 404) return { missing: true };
        if (r.status === 403 || r.status === 429) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            throw new Error(/rate limit/i.test(j.message || '')
              ? 'GitHub is rate-limiting this address. Unsigned requests are capped at 60 an hour; wait a bit and try again.'
              : 'GitHub refused the request.');
          });
        }
        if (!r.ok) throw new Error('GitHub answered ' + r.status + '.');
        return r.json();
      });
  }

  // Свой домен у игры записан в файле CNAME её репозитория. Он лежит
  // открыто, ключа не нужно.
  function customDomain(owner, repo) {
    return fetch('https://raw.githubusercontent.com/' + owner + '/' + repo + '/HEAD/CNAME')
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) { return t.trim().split(/\s+/)[0] || ''; })
      .catch(function () { return ''; });
  }

  /* ── лента ───────────────────────────────────────────── */

  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';

  function renderFilters() {
    var used = {};
    games.forEach(function (g) { (g.tags || []).forEach(function (t) { used[t] = 1; }); });
    var list = ['All'].concat(Object.keys(used).sort());
    if (!games.length) { $('filters').innerHTML = ''; return; }
    /* Переключатель порядка идёт первым и потому всегда виден: ряд
       жанров прокручивается, а начинается он именно отсюда. */
    var sorts = '<div class="g-sort" role="group" aria-label="Order">' +
      Object.keys(SORTS).map(function (k) {
        return '<button class="g-sortbtn" type="button" data-order="' + k + '" aria-pressed="' +
          (k === order) + '">' + SORTS[k] + '</button>';
      }).join('') + '</div>';
    var chips = list.length > 1 ? '<span class="g-div" aria-hidden="true"></span>' +
      list.map(function (t) {
        return '<button class="g-chip" type="button" data-tag="' + esc(t) + '" aria-pressed="' +
          (t === filter) + '">' + esc(t) + '</button>';
      }).join('') : '';
    $('filters').innerHTML = sorts + chips;
  }

  function slideHTML(g, i, pos) {
    /* Первый экран грузим сразу: в ленте со свайпом браузер считает
       слайды «за кадром» и ленивую картинку не запрашивает вовсе,
       поэтому стартовая обложка иначе остаётся пустой. */
    var lazy = pos === 0 ? 'eager" fetchpriority="high' : 'lazy';
    var mark = String(g.title || '?').trim().slice(0, 1).toUpperCase();
    var shot = g.cover
      /* Два слоя одной картинки: размытая заливает кадр целиком, чёткая
         вписывается без обрезки — у телефонов экран уже, чем 9:16. */
      ? '<img class="g-fill" src="' + esc(g.cover) + '" alt="" aria-hidden="true" loading="' + lazy + '">' +
        '<img class="g-shot" src="' + esc(g.cover) + '" alt="" loading="' + lazy + '" decoding="async">'
      : '<div class="g-shot is-blank"><span class="g-mark" aria-hidden="true">' + esc(mark) + '</span></div>';
    return '<section class="g-slide" data-id="' + esc(g.id) + '" aria-label="' + esc(g.title) + '">' +
      (g.cover ? '<img class="g-back" src="' + esc(g.cover) + '" alt="" aria-hidden="true" loading="' + lazy + '">' : '') +
      '<div class="g-pane">' + shot + '<div class="g-veil"></div>' +
        '<button class="g-go" type="button" data-play="' + i + '" ' +
          'aria-label="Play ' + esc(g.title) + '">' + ICON_PLAY + '</button>' +
        /* Подпись свёрнута: на телефоне описание и жанры съедали треть
           экрана, а смотреть пришли на игру. Разворачивается тапом. */
        '<div class="g-info"><h2>' + esc(g.title) + '</h2>' +
          (g.blurb ? '<button class="g-blurb" type="button" data-more ' +
            'aria-expanded="false">' + esc(g.blurb) + '</button>' : '') +
          '<div class="g-tags">' + (g.tags || []).map(function (t, n) {
            return '<span class="g-tag' + (n > 2 ? ' is-extra' : '') + '">' + esc(t) + '</span>';
          }).join('') + '</div>' +
          '<div class="g-meta">' +
            '<a class="g-author" href="https://github.com/' + esc(g.by) + '" target="_blank" rel="noopener">@' +
              esc(g.by) + '</a>' +
            /* Лайк, комментарии и «поделиться» — строкой справа от автора. */
            '<span class="g-acts-row">' + likeHTML(i) + talkHTML(i) + shareHTML(i, 'rail') + '</span>' +
          '</div></div>' +
      '</div></section>';
  }

  var SWIPE = '<div class="g-swipe"><svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>Swipe</div>';

  function renderFeed() {
    var deck = $('feed');
    deck.classList.remove('is-moved');
    var list = games.filter(function (g) {
      return (filter === 'All' || (g.tags || []).indexOf(filter) !== -1) && matches(g);
    }).sort(order === 'hot' ? byScore : byDate);
    if (!games.length) {
      deck.innerHTML = '<div class="g-empty"><h2>No games yet</h2>' +
        '<p>The catalogue is empty. Add the first one and it shows up here.</p>' +
        '<button class="button" type="button" id="empty-go">' +
        '<span class="blob" aria-hidden="true"></span><span class="f1">Submit a game</span>' +
        '<span class="f2" aria-hidden="true">Submit a game<svg viewBox="0 0 24 24">' +
        '<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
        '</button>' +
        '<p class="g-hint" style="margin-top:14px"><button type="button" id="empty-how" ' +
        'style="border:0;background:none;color:var(--muted);font:inherit;cursor:pointer;' +
        'text-decoration:underline;text-underline-offset:3px">How to add a game</button></p>' +
        '</div>';
      return;
    }
    if (!list.length) {
      var q = query.trim();
      deck.innerHTML = q
        ? '<div class="g-empty"><h2>Nothing found</h2>' +
          '<p>No game matches &laquo;' + esc(q) + '&raquo;' +
          (filter !== 'All' ? ' among &laquo;' + esc(filter) + '&raquo;' : '') + '.</p>' +
          '<button class="g-link" type="button" data-qclear>Clear the search</button></div>'
        : '<div class="g-empty"><h2>Nothing here yet</h2>' +
          '<p>No game is tagged &laquo;' + esc(filter) + '&raquo;.</p></div>';
      return;
    }
    deck.innerHTML = list.map(function (g, pos) { return slideHTML(g, games.indexOf(g), pos); }).join('') +
      (list.length > 1 ? SWIPE : '');
    deck.scrollTop = 0;
    warm();
  }

  /* Колода листается свайпом, колесом и стрелками. Шаг всегда ровно один
     экран: scroll-snap сам довезёт до края, нам довольно перевести взгляд
     на соседний слайд. */
  function slides() { return [].slice.call($('feed').querySelectorAll('.g-slide')); }

  function current() {
    var deck = $('feed'), all = slides(), best = 0, min = Infinity;
    all.forEach(function (s, i) {
      var d = Math.abs(s.offsetTop - deck.scrollTop);
      if (d < min) { min = d; best = i; }
    });
    return best;
  }

  function step(dir) {
    var all = slides();
    if (!all.length) return;
    var i = Math.max(0, Math.min(all.length - 1, current() + dir));
    $('feed').scrollTo({ top: all[i].offsetTop, behavior: 'smooth' });
  }

  /* ── панели ──────────────────────────────────────────── */

  var open = null;

  function sheet(html) {
    shut();
    var s = document.createElement('div');
    s.className = 'g-scrim';
    s.innerHTML = '<div class="g-sheet" role="dialog" aria-modal="true">' + html + '</div>';
    s.addEventListener('click', function (e) { if (e.target === s) shut(); });
    document.body.appendChild(s);
    document.body.style.overflow = 'hidden';
    open = s;
    var f = s.querySelector('input, button');
    if (f) f.focus();
    return s;
  }

  function shut() {
    if (open) { open.remove(); open = null; }
    if (!player) document.body.style.overflow = '';
  }

  var X = '<button class="g-x" type="button" data-close aria-label="Close">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 16M20 4 4 20"/></svg></button>';

  function btn(id, label) {
    return '<button class="button" type="button" id="' + id + '">' +
      '<span class="blob" aria-hidden="true"></span><span class="f1">' + esc(label) + '</span>' +
      '<span class="f2" aria-hidden="true">' + esc(label) + '<svg viewBox="0 0 24 24">' +
      '<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>';
  }

  /* ── инструкция ──────────────────────────────────────── */

  function howSheet() {
    sheet('<div class="g-sheet-top"><div><h3>How to add a game</h3>' +
      '<p class="g-lede">Four steps, and about ten minutes the first time. ' +
        'This is a test build: the GitHub checks are real, signing in is not wired up yet.</p></div>' +
      '<span class="g-sp"></span>' + X + '</div>' +
      '<div class="g-doc">' +

      '<h4>What your game needs first</h4>' +
      '<ul>' +
        '<li>It <b>runs in a browser</b>. No downloads, no installers, no store links.</li>' +
        '<li>It lives in a <b>public repository you own</b> on GitHub, with Pages turned on ' +
          '(Settings &rarr; Pages &rarr; pick a branch).</li>' +
        '<li>There is a <b>cover image</b> in that repository: upright, at least 720px across, ' +
          '9:16 fits the screen exactly. Shoot it <b>inside</b> the game, not on the title ' +
          'screen &mdash; a start button under our Play button reads as a mess.</li>' +
      '</ul>' +

      '<h4>Then</h4>' +
      '<ol>' +
        '<li>Tell the page your GitHub username.</li>' +
        '<li>Press the green <b>+</b> at the top right and paste the address of your repository.</li>' +
        '<li>Fill in the title, one line about it, and up to five genres.</li>' +
        '<li>Copy what the form builds and paste it into the catalogue file on GitHub. ' +
          'Your card shows up about a minute later.</li>' +
      '</ol>' +

      '<h4>Who runs this</h4>' +
      '<p>PLAIR Games is made by PLAIR, a studio that builds games for brands, events and ' +
        'training. <a href="/studio/">See the studio</a>.</p>' +

      '<h4>How the feed is ordered</h4>' +
      '<p><b>New</b> is the default: whatever was added last comes first. ' +
      '<b>Popular</b> scores each game as <code>plays + 5 &times; likes + 15 &times; comments</code> ' +
      '&mdash; the ladder follows what each one costs a player: a launch is one tap, a like needs ' +
      'signing in, a comment needs writing something. Age is deliberately not in the formula. ' +
      'Equal scores fall back to the newer game, so the order never shuffles on its own.</p>' +
      '<p class="g-hint">' + (COUNTS
        ? 'Launches are counted at most ten times a day from one browser, so a game cannot be ' +
          'pushed up by reloading. All that is stored is three numbers per game and a random ' +
          'number your own browser gave itself &mdash; no name, no mail, no cookies.'
        : 'The counters are not wired up yet, so Popular currently matches New.') + '</p>' +

      '<h4>What gets checked</h4>' +
      '<p>The repository exists and is public. You own it. Pages is on. The cover really loads and ' +
        'is upright. The play address is read from GitHub, not typed by you &mdash; ' +
        'a custom domain is picked up from the repository&rsquo;s own <code>CNAME</code> file.</p>' +

      '<h4>Worth knowing</h4>' +
      '<ul>' +
        '<li><b>Only your own repositories.</b> Someone else&rsquo;s is rejected, even if the game ' +
          'is yours &mdash; put it under your own account first.</li>' +
        '<li><b>Keep it light.</b> Somebody will open it on a phone, on mobile data.</li>' +
        '<li><b>Landscape-only game?</b> Say so in the one-line description.</li>' +
        '<li>Some games refuse to be embedded. Those open in a separate tab instead, and that is ' +
          'fine &mdash; nothing to fix on your side.</li>' +
        '<li>Submitting the same repository again <b>replaces</b> the old card rather than ' +
          'adding a second one.</li>' +
      '</ul>' +

      '<p class="g-aside"><b>Why the last step is manual.</b> Writing to the catalogue needs a key, ' +
        'and a key in a web page is a key everyone has. Until the real sign-in is built, the form ' +
        'hands you the text and you commit it yourself &mdash; which is also why the page currently ' +
        'takes your word for who you are.</p>' +

      '<p class="g-contact"><button type="button" class="g-link" data-contact>Contact us</button>' +
        '<a class="g-privacy" href="/privacy/">Privacy</a></p>' +

      '</div>');
  }

  /* ── связаться ───────────────────────────────────────── */
  /* Та же форма, что «Связь» у студии, только по-английски и с полями
     «тема» и «сообщение». Куда слать, берётся из настроек студии
     (window.PLAIR_CONFIG в /content.js) — здесь ключей нет. */
  var cfg = window.PLAIR_CONFIG || {};
  var cTg = cfg.formService === 'telegram' && cfg.telegramToken && cfg.telegramChat
    ? { token: String(cfg.telegramToken).trim(), chat: String(cfg.telegramChat).trim() } : null;
  var cMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.contactEmail || '') ? cfg.contactEmail : '';
  var cDialog = $('contact-dialog'), cForm = $('contact-form'), cStatus = $('form-status'),
      cSubmit = $('contact-submit'), cSending = false, cBot = false;

  function cLabel(text) {
    var face = cSubmit.querySelector('.f1'), hover = cSubmit.querySelector('.f2');
    if (face) face.textContent = text;
    if (hover && hover.firstChild) hover.firstChild.nodeValue = text;
  }
  function cBusy(on) {
    var scr = $('form-sending'), fields = cForm.querySelector('.form-fields');
    if (scr) scr.classList.toggle('is-on', on);
    if (fields) fields.inert = on;
    cForm.setAttribute('aria-busy', String(on));
  }
  function cMailBody(d) {
    return 'Name: ' + d.name + '\nContact: ' + d.contact + '\nSubject: ' + (d.subject || '—') +
      '\n\nMessage:\n' + d.message;
  }
  function cMailHref(d) {
    return 'mailto:' + cMail + '?subject=' + encodeURIComponent(d.subject || 'Message from PLAIR Games') +
      '&body=' + encodeURIComponent(cMailBody(d));
  }
  function cSend(d) {
    var e = function (v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var text = ['<b>Message from PLAIR Games</b>', '',
      '<b>Name:</b> ' + e(d.name), '<b>Contact:</b> ' + e(d.contact),
      '<b>Subject:</b> ' + e(d.subject || '—'), '', '<b>Message:</b>', e(d.message)].join('\n');
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
    return fetch('https://api.telegram.org/bot' + encodeURIComponent(cTg.token) + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cTg.chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) { return !!(r.ok && j && j.ok === true); });
    }).finally(function () { clearTimeout(t); });
  }

  function openContact() {
    if (!cDialog) return;
    shut();
    if (!cBot) {
      cBot = true;
      var host = cDialog.querySelector('.walker');
      if (host) import('/robot.js?v=27').then(function (m) { m.mount(host); }).catch(function () {});
    }
    document.documentElement.style.overflow = 'hidden';
    cDialog.showModal();
    $('contact-close').focus({ preventScroll: true });
  }

  if (cDialog) {
    if (!cTg && !cMail) { cStatus.textContent = 'The form is not taking messages yet.'; cSubmit.disabled = true; }
    else if (!cTg) cStatus.textContent = 'Your mail app will open with the message filled in.';
    $('contact-close').addEventListener('click', function () { cDialog.close(); });
    cDialog.addEventListener('click', function (ev) { if (!ev.target.closest('.contact-inner')) cDialog.close(); });
    cDialog.addEventListener('close', function () { document.documentElement.style.overflow = ''; });
    var cContact = cForm.elements.contact;
    cContact.addEventListener('input', function () {
      cContact.setCustomValidity(''); cContact.removeAttribute('aria-invalid'); $('contact-error').hidden = true;
    });
    cForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (cSending || (!cTg && !cMail)) return;
      var d = {};
      ['name', 'contact', 'subject', 'message', '_gotcha'].forEach(function (k) {
        d[k] = String((cForm.elements[k] && cForm.elements[k].value) || '').trim();
      });
      if (d._gotcha) return;
      if (!d.name || !d.message) {
        cStatus.textContent = 'Please add your name and a message.';
        cStatus.className = 'form-status error';
        return;
      }
      var ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contact) || /^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(d.contact) ||
        /^https:\/\/t\.me\/[a-zA-Z][a-zA-Z0-9_]{4,31}\/?$/.test(d.contact);
      if (!ok) {
        cContact.setCustomValidity('Enter an email or a Telegram @username.');
        cContact.setAttribute('aria-invalid', 'true');
        $('contact-error').hidden = false;
        cContact.reportValidity();
        return;
      }
      if (!cTg) {
        location.href = cMailHref(d);
        cStatus.textContent = 'Your message is ready — send it from your mail app.';
        return;
      }
      cSending = true; cSubmit.disabled = true; cLabel('Sending…');
      cStatus.textContent = ''; cStatus.className = 'form-status';
      cBusy(true);
      var started = Date.now();
      cSend(d).then(function (delivered) {
        if (!delivered) throw new Error('not accepted');
        cStatus.textContent = 'Thank you! Your message is on its way. We will get back to you soon.';
        cStatus.className = 'form-status success';
        cForm.reset();
      }).catch(function () {
        // Сообщение не теряется: текст остаётся в форме, рядом — письмо с ним же.
        cStatus.textContent = 'Could not send it. Your text is still here — try again or ';
        cStatus.className = 'form-status error';
        if (cMail) {
          var a = document.createElement('a');
          a.href = cMailHref(d); a.textContent = 'email us';
          cStatus.appendChild(a);
        }
      }).then(function () {
        return new Promise(function (r) { setTimeout(r, Math.max(0, 900 - (Date.now() - started))); });
      }).then(function () {
        cBusy(false); cSending = false; cSubmit.disabled = false; cLabel('Send');
      });
    });
  }

  document.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('[data-contact]')) openContact();
  });

  /* ── имя пользователя ────────────────────────────────── */

  var thenSubmit = false;

  function whoSheet(forSubmit) {
    thenSubmit = !!forSubmit;
    var s = sheet('<div class="g-sheet-top"><div>' +
      (forSubmit
        ? '<p class="g-step">Add a game &middot; step 1 of 2</p><h3>Who are you on GitHub?</h3>' +
          '<p class="g-lede">Games are added from your own repositories, so first the page needs ' +
          'your GitHub name. Next step is the game itself.</p>'
        : '<h3>Who are you on GitHub?</h3>' +
          '<p class="g-lede">So the page can check that a repository you submit is actually yours.</p>') +
      '</div>' +
      '<span class="g-sp"></span>' + X + '</div>' +
      '<label class="g-field"><span>GitHub username</span>' +
        '<input id="w-login" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" ' +
        'placeholder="plairpro" value="' + esc(me ? me.login : '') + '"></label>' +
      '<p class="g-hint" id="w-msg">Sign-in is not built yet, so this is on your honour. It still ' +
        'catches the honest mistake of pasting someone else&rsquo;s repository.</p>' +
      btn('w-go', forSubmit ? 'Continue' : 'Save') +
      (me ? '<p class="g-hint"><button class="g-src" type="button" id="w-clear" ' +
        'style="border:0;background:none;cursor:pointer;font:inherit">Forget me on this device</button></p>' : ''));

    s.querySelector('#w-login').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') saveWho();
    });
  }

  function saveWho() {
    var login = $('w-login').value.trim().replace(/^@/, '');
    var msg = $('w-msg');
    if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) {
      msg.className = 'g-hint bad';
      msg.textContent = 'A GitHub username is letters, digits and dashes.';
      return;
    }
    msg.className = 'g-hint busy';
    msg.textContent = 'Asking GitHub…';
    gh('/users/' + login).then(function (u) {
      if (u.missing) {
        msg.className = 'g-hint bad';
        msg.textContent = 'GitHub has no user @' + login + '.';
        return;
      }
      me = { login: u.login, name: u.name || u.login };
      saveMe();
      if (thenSubmit) { thenSubmit = false; submitSheet(true); } else shut();
    }).catch(function (err) {
      msg.className = 'g-hint bad';
      msg.textContent = err.message;
    });
  }

  /* ── публикация ──────────────────────────────────────── */

  var found = null;   // {owner, repo, url}

  function submitSheet(stepTwo) {
    /* Без ника форму не открыть: по нему проверяется, что репозиторий
       твой. Тогда «+» открывает окно ника как первый шаг добавления —
       со своим заголовком — и после сохранения сразу ведёт в форму.
       Раньше окно просто закрывалось, и «+» выглядел копией кнопки
       кабинета: два значка, одно и то же окно. */
    if (!me) { whoSheet(true); return; }
    picked = [];
    found = null;
    var s = sheet('<div class="g-sheet-top"><div>' +
      (stepTwo === true ? '<p class="g-step">Add a game &middot; step 2 of 2</p>' : '') +
      '<h3>Add a game</h3>' +
      '<p class="g-lede">Paste a repository you own. The play address comes from GitHub, not from you.</p></div>' +
      '<span class="g-sp"></span>' + X + '</div>' +
      '<label class="g-field"><span>Repository</span>' +
        '<input id="f-repo" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" ' +
        'placeholder="github.com/' + esc(me.login) + '/your-game"></label>' +
      '<p class="g-hint" id="f-repo-msg">Signed in as @' + esc(me.login) +
        '. A repository owned by anyone else is rejected.</p>' +
      '<label class="g-field"><span>Title</span>' +
        '<input id="f-title" type="text" maxlength="40" placeholder="Up to 40 characters"></label>' +
      '<label class="g-field"><span>One line about it</span>' +
        '<input id="f-blurb" type="text" maxlength="100" placeholder="What the player does"></label>' +
      '<label class="g-field"><span>Cover image URL</span>' +
        '<input id="f-cover" type="url" autocapitalize="none" spellcheck="false" ' +
        'placeholder="https://…/cover.webp"></label>' +
      '<p class="g-hint" id="f-cover-msg">Upright, 9:16, at least 720px across. Keep it in your ' +
        'own repository so nothing of yours lives on our side.</p>' +
      '<div class="g-field"><span>Genres &mdash; up to 5</span><div class="g-pick" id="f-tags">' +
        TAGS.map(function (t) {
          return '<button class="g-chip" type="button" data-pick="' + esc(t) + '" aria-pressed="false">' +
            esc(t) + '</button>';
        }).join('') + '</div></div>' +
      btn('f-go', 'Check and build the entry') +
      '<p class="g-hint" id="f-msg"></p><div id="f-out"></div>');

    var repo = s.querySelector('#f-repo');
    var t;
    repo.addEventListener('input', function () {
      found = null;
      clearTimeout(t);
      t = setTimeout(checkRepo, 420);
    });
    s.querySelector('#f-cover').addEventListener('change', checkCover);
  }

  function parseRepo(raw) {
    var m = String(raw || '').trim()
      .replace(/^https?:\/\//, '').replace(/^www\./, '')
      .match(/^github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
    return m ? { owner: m[1], repo: m[2] } : null;
  }

  function checkRepo() {
    var msg = $('f-repo-msg');
    if (!msg) return Promise.resolve(null);
    var raw = $('f-repo').value.trim();
    if (!raw) {
      msg.className = 'g-hint';
      msg.textContent = 'Signed in as @' + me.login + '. A repository owned by anyone else is rejected.';
      return Promise.resolve(null);
    }
    var p = parseRepo(raw);
    if (!p) {
      msg.className = 'g-hint bad';
      msg.textContent = 'That is not a repository address. It looks like github.com/name/project.';
      return Promise.resolve(null);
    }
    msg.className = 'g-hint busy';
    msg.textContent = 'Asking GitHub about ' + p.owner + '/' + p.repo + '…';

    return gh('/repos/' + p.owner + '/' + p.repo).then(function (r) {
      if (r.missing) {
        msg.className = 'g-hint bad';
        msg.textContent = 'No such repository, or it is private. A game has to be public to be played.';
        return null;
      }
      if (String(r.owner.login).toLowerCase() !== me.login.toLowerCase()) {
        msg.className = 'g-hint bad';
        msg.textContent = '@' + r.owner.login + ' owns that repository, not you. Only your own games go here.';
        return null;
      }
      if (!r.has_pages) {
        msg.className = 'g-hint bad';
        msg.textContent = 'GitHub Pages is off for this repository, so there is nothing to play. ' +
          'Turn it on in Settings → Pages, then try again.';
        return null;
      }
      return customDomain(r.owner.login, r.name).then(function (domain) {
        var url = domain
          ? 'https://' + domain + '/'
          : 'https://' + r.owner.login.toLowerCase() + '.github.io/' + r.name + '/';
        found = { owner: r.owner.login, repo: r.name, url: url,
                  html: r.html_url, blurb: r.description || '' };
        msg.className = 'g-hint good';
        msg.innerHTML = 'Yours, and it plays at <code>' + esc(url) + '</code>' +
          (domain ? ' (its own domain).' : '.') +
          ' <button type="button" id="f-try" class="g-link">Try it in the player</button>';
        var blurb = $('f-blurb');
        if (blurb && !blurb.value && found.blurb) blurb.value = found.blurb.slice(0, 100);
        return found;
      });
    }).catch(function (err) {
      msg.className = 'g-hint bad';
      msg.textContent = err.message;
      return null;
    });
  }

  function checkCover() {
    var msg = $('f-cover-msg'), v = $('f-cover').value.trim();
    if (!v) {
      msg.className = 'g-hint';
      msg.textContent = 'Portrait, at least 720px across. A screenshot from inside the game, ' +
        'not the title screen. Keep it in your own repository.';
      return;
    }
    msg.className = 'g-hint busy';
    msg.textContent = 'Loading the image…';
    var img = new Image();
    img.onload = function () {
      if (img.naturalWidth > img.naturalHeight) {
        msg.className = 'g-hint bad';
        msg.textContent = 'That image is wider than it is tall. The feed is full-screen and ' +
          'upright, so covers are portrait — 9:16 fits exactly.';
      } else if (img.naturalWidth < 720) {
        msg.className = 'g-hint bad';
        msg.textContent = 'Only ' + img.naturalWidth + 'px across. It will look soft — use 720 or more.';
      } else {
        msg.className = 'g-hint good';
        msg.textContent = 'Loads fine, ' + img.naturalWidth + '×' + img.naturalHeight + '.';
      }
    };
    img.onerror = function () {
      msg.className = 'g-hint bad';
      msg.textContent = 'That address does not give back an image.';
    };
    img.src = v;
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
      || 'game-' + Date.now();
  }

  function build() {
    var out = $('f-msg');
    Promise.resolve(found || checkRepo()).then(function (f) {
      if (!f) { out.className = 'g-hint bad'; out.textContent = 'Sort the repository out first.'; return; }
      var title = $('f-title').value.trim();
      if (!title) { out.className = 'g-hint bad'; out.textContent = 'Give the game a title.'; return; }
      if (!picked.length) { out.className = 'g-hint bad'; out.textContent = 'Pick at least one genre.'; return; }

      var entry = {
        id: slug(title),
        title: title,
        by: f.owner,
        blurb: $('f-blurb').value.trim(),
        tags: picked.slice(),
        cover: $('f-cover').value.trim(),
        url: f.url,
        repo: f.html,
        added: new Date().toISOString().slice(0, 10)
      };
      var next = games.filter(function (g) { return g.id !== entry.id; }).concat([entry]);
      next.sort(function (a, b) { return String(b.added).localeCompare(String(a.added)); });

      out.textContent = '';
      $('f-out').innerHTML = '<div class="g-out"><h4>Paste this over games.json</h4>' +
        '<p class="g-hint">This is the whole catalogue with your game in it. Copy it, open the file on ' +
        'GitHub, select everything, paste, and commit. The card shows up about a minute later.</p>' +
        '<pre class="g-code" id="f-json">' + esc(JSON.stringify(next, null, 2)) + '</pre>' +
        '<div class="g-row">' + btn('f-copy', 'Copy') +
        '<a class="button" href="' + EDIT_URL + '" target="_blank" rel="noopener">' +
        '<span class="blob" aria-hidden="true"></span><span class="f1">Open the file</span>' +
        '<span class="f2" aria-hidden="true">Open the file<svg viewBox="0 0 24 24">' +
        '<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg></span></a>' +
        '</div><p class="g-hint" id="f-copy-msg"></p></div>';
      $('f-out').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function copyJSON() {
    var text = $('f-json').textContent, msg = $('f-copy-msg');
    var ok = function () { msg.className = 'g-hint good'; msg.textContent = 'Copied.'; };
    var no = function () {
      msg.className = 'g-hint';
      msg.textContent = 'Could not reach the clipboard — select the text above and copy it by hand.';
      var r = document.createRange();
      r.selectNodeContents($('f-json'));
      var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, no);
      } else no();
    } catch (e) { no(); }
  }

  /* ── поделиться ──────────────────────────────────────── */
  /* Значки соцсетей — из Simple Icons (CC0), как есть, без перерисовки. */
  var BRAND = {"x": "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z", "threads": "M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z", "instagram": "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077", "facebook": "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z", "telegram": "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z", "whatsapp": "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z", "vk": "m9.489.004.729-.003h3.564l.73.003.914.01.433.007.418.011.403.014.388.016.374.021.36.025.345.03.333.033c1.74.196 2.933.616 3.833 1.516.9.9 1.32 2.092 1.516 3.833l.034.333.029.346.025.36.02.373.025.588.012.41.013.644.009.915.004.98-.001 3.313-.003.73-.01.914-.007.433-.011.418-.014.403-.016.388-.021.374-.025.36-.03.345-.033.333c-.196 1.74-.616 2.933-1.516 3.833-.9.9-2.092 1.32-3.833 1.516l-.333.034-.346.029-.36.025-.373.02-.588.025-.41.012-.644.013-.915.009-.98.004-3.313-.001-.73-.003-.914-.01-.433-.007-.418-.011-.403-.014-.388-.016-.374-.021-.36-.025-.345-.03-.333-.033c-1.74-.196-2.933-.616-3.833-1.516-.9-.9-1.32-2.092-1.516-3.833l-.034-.333-.029-.346-.025-.36-.02-.373-.025-.588-.012-.41-.013-.644-.009-.915-.004-.98.001-3.313.003-.73.01-.914.007-.433.011-.418.014-.403.016-.388.021-.374.025-.36.03-.345.033-.333c.196-1.74.616-2.933 1.516-3.833.9-.9 2.092-1.32 3.833-1.516l.333-.034.346-.029.36-.025.373-.02.588-.025.41-.012.644-.013.915-.009ZM6.79 7.3H4.05c.13 6.24 3.25 9.99 8.72 9.99h.31v-3.57c2.01.2 3.53 1.67 4.14 3.57h2.84c-.78-2.84-2.83-4.41-4.11-5.01 1.28-.74 3.08-2.54 3.51-4.98h-2.58c-.56 1.98-2.22 3.78-3.8 3.95V7.3H10.5v6.92c-1.6-.4-3.62-2.34-3.71-6.92Z"};
  var ICON_SHARE = '<svg class="g-line" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>';
  var ICON_LINK = '<svg class="g-line" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.3 1.3"/>' +
    '<path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3"/></svg>';
  var ICON_DONE = '<svg class="g-line" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  var NETS = [
    ['x', 'X'], ['threads', 'Threads'], ['instagram', 'Instagram'], ['facebook', 'Facebook'],
    ['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['vk', 'VK']
  ];

  /* Ссылка ведёт в ленту и ставит её на эту игру, но не запускает:
     звук без касания браузер всё равно не даст, а человек сперва
     хочет посмотреть, куда его позвали. */
  function shareURL(g) { return 'https://plair.pro/?g=' + encodeURIComponent(g.id); }
  function shareText(g) { return g.title + ' — play it on PLAIR Games'; }

  function shareHref(net, g) {
    var u = encodeURIComponent(shareURL(g)), t = encodeURIComponent(shareText(g)),
        both = encodeURIComponent(shareText(g) + ' ' + shareURL(g));
    switch (net) {
      case 'x': return 'https://x.com/intent/tweet?text=' + t + '&url=' + u;
      case 'threads': return 'https://www.threads.net/intent/post?text=' + both;
      case 'facebook': return 'https://www.facebook.com/sharer/sharer.php?u=' + u;
      case 'telegram': return 'https://t.me/share/url?url=' + u + '&text=' + t;
      case 'whatsapp': return 'https://wa.me/?text=' + both;
      case 'vk': return 'https://vk.com/share.php?url=' + u + '&title=' + encodeURIComponent(g.title);
    }
    return '';
  }

  /* where: "rail" — столбик над кнопкой сбоку карточки,
            "bar"  — строка в плашке проигрывателя. */
  function shareHTML(i, where) {
    var g = games[i];
    var items = NETS.map(function (n, k) {
      var icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + BRAND[n[0]] + '"/></svg>';
      var label = 'Share on ' + n[1];
      // У Инстаграма нет ссылки «поделиться»: там системное меню или буфер.
      return n[0] === 'instagram'
        ? '<button class="g-sh is-' + n[0] + '" type="button" data-insta="' + i + '" style="--n:' + k + '" ' +
            'aria-label="' + label + '" title="Instagram">' + icon + '</button>'
        : '<a class="g-sh is-' + n[0] + '" href="' + esc(shareHref(n[0], g)) + '" target="_blank" rel="noopener" ' +
            'style="--n:' + k + '" aria-label="' + label + '" title="' + n[1] + '">' + icon + '</a>';
    }).join('') +
      '<button class="g-sh is-copy" type="button" data-copy="' + i + '" style="--n:' + NETS.length + '" ' +
        'aria-label="Copy the link" title="Copy the link">' + ICON_LINK + '</button>';
    return '<div class="g-share is-' + where + '">' +
      '<div class="g-share-list" role="group" aria-label="Share ' + esc(g.title) + '">' + items + '</div>' +
      '<button class="' + (where === 'bar' ? 'g-x ' : '') + 'g-share-btn" type="button" data-share ' +
        'aria-expanded="false" aria-label="Share ' + esc(g.title) + '">' + ICON_SHARE + '</button></div>';
  }

  function closeShares(except) {
    [].forEach.call(document.querySelectorAll('.g-share.is-open'), function (s) {
      if (s === except) return;
      s.classList.remove('is-open');
      s.querySelector('[data-share]').setAttribute('aria-expanded', 'false');
    });
  }

  var toastTimer = 0;
  function toast(text) {
    var t = $('g-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'g-toast';
      t.className = 'g-toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2600);
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    } catch (e) {}
    return new Promise(function (ok, no) {
      var a = document.createElement('textarea');
      a.value = text; a.setAttribute('readonly', ''); a.style.cssText = 'position:fixed;opacity:0;top:0';
      document.body.appendChild(a); a.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) {}
      a.remove();
      if (done) ok(); else no();
    });
  }

  function copyLink(btn, g, after) {
    copyText(shareURL(g)).then(function () {
      if (btn) {
        btn.innerHTML = ICON_DONE;
        btn.classList.add('is-done');
        setTimeout(function () { btn.innerHTML = ICON_LINK; btn.classList.remove('is-done'); }, 1600);
      }
      toast(after || 'Link copied');
    }, function () { toast(shareURL(g)); });
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var toggle = t.closest && t.closest('[data-share]');
    if (toggle) {
      var box = toggle.closest('.g-share');
      var on = !box.classList.contains('is-open');
      closeShares(box);
      box.classList.toggle('is-open', on);
      toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
      return;
    }
    var copy = t.closest && t.closest('[data-copy]');
    if (copy) { copyLink(copy.classList.contains('is-copy') ? copy : null, games[Number(copy.dataset.copy)]); return; }
    var insta = t.closest && t.closest('[data-insta]');
    if (insta) {
      var g = games[Number(insta.dataset.insta)];
      /* На телефоне системное меню «Поделиться» и есть путь в Инстаграм.
         На компьютере его нет: кладём ссылку в буфер и открываем сайт. */
      if (navigator.share && matchMedia('(pointer:coarse)').matches) {
        navigator.share({ title: g.title, text: shareText(g), url: shareURL(g) }).catch(function () {});
      } else {
        copyLink(null, g, 'Link copied — paste it into Instagram');
        window.open('https://www.instagram.com/', '_blank', 'noopener');
      }
      closeShares();
      return;
    }
    if (t.closest && t.closest('.g-sh')) { setTimeout(closeShares, 0); return; }
    if (!(t.closest && t.closest('.g-share'))) closeShares();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.querySelector('.g-share.is-open')) {
      e.stopImmediatePropagation();
      closeShares();
    }
  }, true);

  /* ── комментарии ─────────────────────────────────────── */
  /* Живут в том же Worker’е, что и счётчики (worker/README.md). Вход —
     через Google или GitHub: Worker возвращает человека обратно в ленту
     с подписанным пропуском во фрагменте адреса, пропуск лежит в
     localStorage этого браузера и уходит с каждым запросом. Пароли и
     ключи провайдеров страница не видит вовсе. Пока адреса Worker’а
     нет, кнопки комментариев в ленте просто не появляются. */

  var SESSION_KEY = 'plair-session';
  var session = null, meUser = null, talkCfg = null, authNote = '';
  try { session = localStorage.getItem(SESSION_KEY) || null; } catch (e) { session = null; }

  (function pickUpSession() {
    var h = location.hash, ok = h.match(/^#session=([A-Za-z0-9_.-]{20,2000})$/),
        bad = h.match(/^#auth-error=(\w+)/);
    if (!ok && !bad) return;
    if (ok) {
      session = ok[1];
      try { localStorage.setItem(SESSION_KEY, session); } catch (e) { /* приватное окно */ }
    }
    authNote = ok ? 'ok' : bad[1];
    // Пропуск из строки адреса — сразу вон: его не должно быть ни в
    // истории, ни в ссылке, которую человек скопирует.
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) {}
  })();

  function dropSession() {
    session = null; meUser = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function api(path, opts) {
    opts = opts || {};
    var h = {};
    if (opts.body) h['Content-Type'] = 'application/json';
    if (session) h.Authorization = 'Bearer ' + session;
    return fetch(COUNTS + path, {
      method: opts.method || 'GET', headers: h,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, why: 'server' }; }).then(function (j) {
        if (r.status === 401 && session) dropSession();
        j.status = r.status;
        return j;
      });
    });
  }

  function loadMe() {
    if (!session) return Promise.resolve(null);
    if (meUser) return Promise.resolve(meUser);
    return api('/me').then(function (d) {
      if (d.ok && d.user) meUser = d.user; else if (d.ok) dropSession();
      return meUser;
    }).catch(function () { return null; });
  }

  function loadCfg() {
    if (talkCfg) return Promise.resolve(talkCfg);
    return api('/config').then(function (d) {
      talkCfg = d.ok ? d : { providers: [], max: 500 };
      return talkCfg;
    }).catch(function () { return { providers: [], max: 500 }; });
  }

  function authToast() {
    if (authNote === 'ok') {
      loadMe().then(function (u) { if (u) toast('Signed in as ' + u.name); });
    } else if (authNote === 'cancelled') toast('Sign-in cancelled');
    else toast('Sign-in did not go through. Try again.');
    authNote = '';
  }

  var ICON_TALK = '<svg class="g-line" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M20.5 11.6c0 4.3-3.8 7.7-8.5 7.7-1.2 0-2.3-.2-3.3-.6L4 20l1.3-3.7c-1.1-1.3-1.8-2.9-1.8-4.7C3.5 7.3 7.3 3.9 12 3.9s8.5 3.4 8.5 7.7z"/></svg>';
  var ICON_GOOGLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>';
  var ICON_GITHUB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>';

  function compact(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'K';
  }

  /* Кнопка сбоку карточки, над «поделиться». Число под ней — как в
     привычных лентах; ноль не пишем. */
  function talkHTML(i) {
    if (!COUNTS) return '';
    var g = games[i], n = Number(g.comments) || 0;
    return '<button class="g-act g-talk" type="button" data-talk="' + i + '" ' +
      'aria-label="Comments on ' + esc(g.title) + '">' + ICON_TALK +
      '<span class="g-act-n" data-talk-n="' + esc(g.id) + '">' + (n ? compact(n) : '') + '</span></button>';
  }

  /* ── лайки ───────────────────────────────────────────── */
  /* Без входа: один лайк с браузера на игру, по тому же случайному
     номеру браузера, что и запуски. Какие игры этот браузер лайкнул,
     помним у себя и сверяем с сервером при открытии ленты. */
  var liked = {};
  try { liked = JSON.parse(localStorage.getItem('plair-liked') || '{}') || {}; } catch (e) { liked = {}; }
  function saveLiked() { try { localStorage.setItem('plair-liked', JSON.stringify(liked)); } catch (e) {} }

  var ICON_HEART = '<svg class="g-line" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 20.3s-7.8-4.6-7.8-10.4A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 7.8 2.6c0 5.8-7.8 10.4-7.8 10.4z"/></svg>';

  function likeHTML(i) {
    if (!COUNTS) return '';
    var g = games[i], n = Number(g.likes) || 0, on = !!liked[g.id];
    return '<button class="g-act g-like' + (on ? ' is-on' : '') + '" type="button" data-like="' + i + '" ' +
      'aria-pressed="' + on + '" aria-label="Like ' + esc(g.title) + '">' + ICON_HEART +
      '<span class="g-act-n" data-like-n="' + esc(g.id) + '">' + (n ? compact(n) : '') + '</span></button>';
  }

  function drawLike(g) {
    var on = !!liked[g.id];
    [].forEach.call(document.querySelectorAll('[data-like-n]'), function (el) {
      if (el.getAttribute('data-like-n') !== g.id) return;
      el.textContent = g.likes ? compact(g.likes) : '';
      var b = el.closest('.g-like');
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function loadLiked() {
    if (!COUNTS) return;
    fetch(COUNTS + '/mine?visitor=' + visitor()).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) return;
      liked = {};
      d.liked.forEach(function (id) { liked[id] = 1; });
      saveLiked();
      games.forEach(drawLike);
    }).catch(function () {});
  }

  function toggleLike(g, btn) {
    var on = !liked[g.id];
    if (on) liked[g.id] = 1; else delete liked[g.id];
    g.likes = Math.max(0, (Number(g.likes) || 0) + (on ? 1 : -1));
    saveLiked();
    drawLike(g);
    if (on && btn) { btn.classList.remove('is-pop'); void btn.offsetWidth; btn.classList.add('is-pop'); }
    fetch(COUNTS + '/like', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: g.id, visitor: visitor(), on: on })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) throw new Error('like');
      g.likes = d.likes;
      drawLike(g);
    }).catch(function () {
      // Не дошло — возвращаем как было.
      if (on) delete liked[g.id]; else liked[g.id] = 1;
      g.likes = Math.max(0, (Number(g.likes) || 0) + (on ? -1 : 1));
      saveLiked();
      drawLike(g);
      toast('No connection — the like did not count');
    });
  }

  function drawTalk(g) {
    [].forEach.call(document.querySelectorAll('[data-talk-n]'), function (el) {
      if (el.getAttribute('data-talk-n') === g.id) el.textContent = g.comments ? compact(g.comments) : '';
    });
  }

  function ago(t) {
    var s = Date.now() / 1000 - t;
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 7 * 86400) return Math.floor(s / 86400) + 'd';
    var d = new Date(t * 1000), o = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString('en-GB', o);
  }

  function face(u, cls) {
    return u && u.avatar
      ? '<img class="' + cls + '" src="' + esc(u.avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="' + cls + ' is-blank" aria-hidden="true">' +
        esc(String((u && u.name) || '?').trim().slice(0, 1).toUpperCase()) + '</span>';
  }

  function commentHTML(c) {
    var who = '<b>' + esc(c.user.name) + '</b>' +
      (c.user.login ? '<a href="https://github.com/' + encodeURIComponent(c.user.login) + '" target="_blank" ' +
        'rel="noopener nofollow">@' + esc(c.user.login) + '</a>' : '');
    var when = new Date(c.created * 1000);
    return '<article class="g-c" data-cid="' + c.id + '">' + face(c.user, 'g-c-ava') +
      '<div class="g-c-body"><div class="g-c-head">' + who +
        '<time datetime="' + when.toISOString() + '" title="' + esc(when.toLocaleString('en-GB')) + '">' +
          esc(ago(c.created)) + '</time>' +
        (c.canDelete ? '<button class="g-c-del" type="button" data-cdel="' + c.id + '">Delete</button>' : '') +
      '</div><p class="g-c-text">' + esc(c.text) + '</p></div></article>';
  }

  var talk = null;   // {g, s, before, more}

  function talkSheet(g) {
    var s = sheet('<div class="g-sheet-top"><div><h3>Comments</h3>' +
        '<p class="g-lede">' + esc(g.title) + ' &middot; <span id="c-total">' +
          (g.comments ? compact(g.comments) : 'none yet') + '</span></p></div>' +
        '<span class="g-sp"></span>' + X + '</div>' +
      '<div class="g-cbox" id="c-box"><p class="g-hint busy">&nbsp;</p></div>' +
      '<div class="g-clist" id="c-list" aria-live="polite"><p class="g-hint busy">Loading&hellip;</p></div>' +
      '<div id="c-foot"></div>');
    s.querySelector('.g-sheet').classList.add('is-talk');
    talk = { g: g, s: s, before: 0, more: false };
    // Убираем ?c=1, чтобы перезагрузка не открывала панель снова.
    try {
      var u = new URL(location.href);
      if (u.searchParams.get('c')) { u.searchParams.delete('c'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
    } catch (e) {}
    Promise.all([loadCfg(), loadMe()]).then(function () { if (talk && talk.s === s) drawBox(); });
    loadPage(true);
  }

  function setTotal(n) {
    if (!talk) return;
    talk.g.comments = n;
    drawTalk(talk.g);
    var t = talk.s.querySelector('#c-total');
    if (t) t.textContent = n ? compact(n) + (n === 1 ? ' comment' : ' comments') : 'none yet';
  }

  function loadPage(first) {
    var t = talk;
    if (!t) return;
    var list = t.s.querySelector('#c-list');
    var moreBtn = list.querySelector('[data-cmore]');
    if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = 'Loading…'; }
    api('/comments?game=' + encodeURIComponent(t.g.id) + (t.before ? '&before=' + t.before : ''))
      .then(function (d) {
        if (talk !== t) return;
        if (!d.ok) throw new Error('load');
        if (first) list.innerHTML = '';
        if (moreBtn) moreBtn.remove();
        setTotal(d.total);
        if (first && !d.comments.length) {
          list.innerHTML = '<p class="g-c-none">No comments yet. Be the first.</p>';
          return;
        }
        list.insertAdjacentHTML('beforeend', d.comments.map(commentHTML).join(''));
        if (d.comments.length) t.before = d.comments[d.comments.length - 1].id;
        if (d.more) list.insertAdjacentHTML('beforeend',
          '<button class="g-link g-cmore" type="button" data-cmore>Show older</button>');
      })
      .catch(function () {
        if (talk !== t) return;
        if (moreBtn) { moreBtn.disabled = false; moreBtn.textContent = 'Show older'; return; }
        list.innerHTML = '<p class="g-hint bad">Comments would not load. ' +
          '<button class="g-link" type="button" data-cretry>Try again</button></p>';
      });
  }

  function draftKey(g) { return 'plair-draft-' + g.id; }

  function drawBox() {
    var t = talk, box = t.s.querySelector('#c-box'), foot = t.s.querySelector('#c-foot');
    var max = (talkCfg && talkCfg.max) || 500;
    if (!meUser) {
      var ps = (talkCfg && talkCfg.providers) || [];
      foot.innerHTML = '';
      box.innerHTML = ps.length
        ? '<p class="g-c-ask">Sign in to join the conversation.</p><div class="g-auth">' +
          (ps.indexOf('google') !== -1 ? '<div class="g-gbtn" id="c-google"></div>' : '') +
          (ps.indexOf('github') !== -1 ? '<button class="g-auth-btn" type="button" data-signin="github">' +
            ICON_GITHUB + 'Continue with GitHub</button>' : '') +
          '</div><p class="g-hint">We only keep your name and picture to show next to what you write. ' +
          'No email, no password. <a href="/privacy/" target="_blank" rel="noopener">Privacy</a></p>'
        : '<p class="g-hint">Commenting opens soon.</p>';
      var gb = box.querySelector('#c-google');
      if (gb) googleButton(gb);
      return;
    }
    var draft = '';
    try { draft = sessionStorage.getItem(draftKey(t.g)) || ''; } catch (e) {}
    box.innerHTML = '<form class="g-cform" id="c-form">' + face(meUser, 'g-c-ava') +
      '<div class="g-cform-main"><textarea id="c-text" rows="1" maxlength="' + max + '" ' +
        'placeholder="Add a comment&hellip;" aria-label="Your comment">' + esc(draft) + '</textarea>' +
      '<div class="g-cform-row"><span class="g-hint" id="c-msg"></span><span class="g-sp"></span>' +
        '<span class="g-c-count" id="c-count"></span>' +
        '<button class="g-c-post" type="submit" id="c-post" disabled>Post</button></div></div></form>';
    foot.innerHTML = '<p class="g-c-me">Signed in as <b>' + esc(meUser.name) + '</b> &middot; ' +
      '<button class="g-link" type="button" data-signout>Sign out</button> &middot; ' +
      '<button class="g-link is-quiet" type="button" data-forget>Delete my comments and account</button></p>';
    var ta = box.querySelector('#c-text');
    ta.addEventListener('input', function () { fitBox(ta, max); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendComment(); }
    });
    box.querySelector('#c-form').addEventListener('submit', function (e) { e.preventDefault(); sendComment(); });
    fitBox(ta, max);
  }

  function fitBox(ta, max) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    var len = Array.from(ta.value).length, left = max - len;
    var c = $('c-count');
    if (c) { c.textContent = left <= 80 ? String(left) : ''; c.classList.toggle('bad', left < 0); }
    var b = $('c-post');
    if (b) b.disabled = !ta.value.trim() || left < 0;
    try {
      if (ta.value) sessionStorage.setItem(draftKey(talk.g), ta.value);
      else sessionStorage.removeItem(draftKey(talk.g));
    } catch (e) {}
  }

  /* Вход через Google — их собственной кнопкой: она открывает окно
     Google, а нам отдаёт подписанный паспорт, который Worker проверяет.
     Скрипт Google грузим только тогда, когда кнопка правда нужна. */
  var gisLoading = null, gisReady = false;
  function loadGIS() {
    if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
    if (!gisLoading) {
      gisLoading = new Promise(function (ok, no) {
        var sc = document.createElement('script');
        sc.src = 'https://accounts.google.com/gsi/client';
        sc.async = true;
        sc.onload = ok;
        sc.onerror = function () { gisLoading = null; no(new Error('gis')); };
        document.head.appendChild(sc);
      });
    }
    return gisLoading;
  }

  function googleButton(el) {
    el.innerHTML = '<button class="g-auth-btn" type="button" disabled>' + ICON_GOOGLE + 'Continue with Google</button>';
    loadGIS().then(function () {
      if (!gisReady) {
        google.accounts.id.initialize({
          client_id: talkCfg.google, callback: onGoogle, ux_mode: 'popup',
          auto_select: false, cancel_on_tap_outside: true, context: 'signin'
        });
        gisReady = true;
      }
      if (!el.isConnected) return;
      el.innerHTML = '';
      google.accounts.id.renderButton(el, {
        type: 'standard', theme: 'filled_black', shape: 'pill', size: 'large',
        text: 'continue_with', logo_alignment: 'center',
        width: Math.max(200, Math.min(400, Math.floor(el.getBoundingClientRect().width) || 320))
      });
    }).catch(function () {
      if (el.isConnected) el.innerHTML = '<p class="g-hint bad">Google sign-in would not load. Check the connection and reopen this panel.</p>';
    });
  }

  function onGoogle(resp) {
    api('/auth/google/token', { method: 'POST', body: { credential: resp && resp.credential } }).then(function (d) {
      if (!d.ok || !d.session) throw new Error('google');
      session = d.session;
      try { localStorage.setItem(SESSION_KEY, session); } catch (e) { /* приватное окно */ }
      meUser = d.user;
      if (talk && open === talk.s) { drawBox(); reloadList(); }
      toast('Signed in as ' + d.user.name);
    }).catch(function () { toast('Sign-in did not go through. Try again.'); });
  }

  var WHY = {
    slow: function (d) { return 'One moment — you can post again in ' + (d.wait || 15) + ' s.'; },
    day: function () { return 'That is the daily limit. See you tomorrow.'; },
    banned: function () { return 'This account can no longer comment.'; },
    long: function (d) { return 'Keep it under ' + (d.max || 500) + ' characters.'; },
    empty: function () { return 'Write something first.'; }
  };

  function sendComment() {
    var t = talk, ta = $('c-text'), msg = $('c-msg'), b = $('c-post');
    if (!t || !ta || b.disabled) return;
    var text = ta.value.trim();
    if (!text) return;
    b.disabled = true; msg.className = 'g-hint busy'; msg.textContent = 'Posting…';
    api('/comments', { method: 'POST', body: { game: t.g.id, text: text } }).then(function (d) {
      if (talk !== t) return;
      if (d.ok) {
        ta.value = ''; fitBox(ta, (talkCfg && talkCfg.max) || 500);
        msg.className = 'g-hint'; msg.textContent = '';
        var list = t.s.querySelector('#c-list'), none = list.querySelector('.g-c-none');
        if (none) none.remove();
        list.insertAdjacentHTML('afterbegin', commentHTML(d.comment));
        setTotal(d.total);
        return;
      }
      if (d.status === 401) { meUser = null; drawBox(); toast('Please sign in again'); return; }
      msg.className = 'g-hint bad';
      msg.textContent = WHY[d.why] ? WHY[d.why](d) : 'That did not post. Try again.';
      b.disabled = false;
    }).catch(function () {
      if (talk !== t) return;
      msg.className = 'g-hint bad'; msg.textContent = 'No connection. Try again.'; b.disabled = false;
    });
  }

  /* Удаление и «забыть меня» — в два касания: первое спрашивает,
     второе делает. Системных окон не открываем. */
  function twoStep(btn, label, act) {
    if (btn.dataset.armed) { act(); return; }
    var was = btn.textContent;
    btn.dataset.armed = '1'; btn.textContent = label; btn.classList.add('is-armed');
    setTimeout(function () {
      if (!btn.isConnected) return;
      delete btn.dataset.armed; btn.textContent = was; btn.classList.remove('is-armed');
    }, 3500);
  }

  document.addEventListener('click', function (e) {
    var t = e.target, el;
    if (!t.closest) return;
    if ((el = t.closest('[data-talk]'))) { closeShares(); talkSheet(games[Number(el.dataset.talk)]); return; }
    if ((el = t.closest('[data-like]'))) { closeShares(); toggleLike(games[Number(el.dataset.like)], el); return; }
    if (!talk || !open || open !== talk.s) return;
    if ((el = t.closest('[data-signin]'))) {
      var back = location.origin + location.pathname + '?g=' + encodeURIComponent(talk.g.id) + '&c=1';
      location.assign(COUNTS + '/auth/' + el.dataset.signin + '?back=' + encodeURIComponent(back));
      return;
    }
    if ((el = t.closest('[data-cmore]'))) { loadPage(false); return; }
    if ((el = t.closest('[data-cretry]'))) { talk.before = 0; loadPage(true); return; }
    if ((el = t.closest('[data-signout]'))) { dropSession(); drawBox(); reloadList(); toast('Signed out'); return; }
    if ((el = t.closest('[data-forget]'))) {
      twoStep(el, 'Delete everything? Tap again', function () {
        el.disabled = true;
        api('/me', { method: 'DELETE' }).then(function (d) {
          if (!d.ok) throw new Error('forget');
          dropSession(); drawBox(); reloadList(); toast('Your comments and account are gone');
          loadCounts();
        }).catch(function () { el.disabled = false; toast('That did not work. Try again.'); });
      });
      return;
    }
    if ((el = t.closest('[data-cdel]'))) {
      twoStep(el, 'Sure?', function () {
        el.disabled = true;
        var row = el.closest('.g-c');
        api('/comments/' + el.dataset.cdel, { method: 'DELETE' }).then(function (d) {
          if (!d.ok) throw new Error('del');
          row.remove();
          if (typeof d.total === 'number') setTotal(d.total);
          var list = talk && talk.s.querySelector('#c-list');
          if (list && !list.querySelector('.g-c')) list.innerHTML = '<p class="g-c-none">No comments yet. Be the first.</p>';
        }).catch(function () { el.disabled = false; toast('Could not delete. Try again.'); });
      });
    }
  });

  /* Аватар не загрузился (сменился, закрыт) — ставим первую букву имени. */
  document.addEventListener('error', function (e) {
    var im = e.target;
    if (!im || im.tagName !== 'IMG' || !im.classList.contains('g-c-ava')) return;
    var name = im.closest('.g-c') ? im.closest('.g-c').querySelector('.g-c-head b') : null;
    var span = document.createElement('span');
    span.className = 'g-c-ava is-blank';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = String(name ? name.textContent : (meUser && meUser.name) || '?').trim().slice(0, 1).toUpperCase();
    im.replaceWith(span);
  }, true);

  function reloadList() { if (talk) { talk.before = 0; loadPage(true); } }

  /* ── запуск игры ─────────────────────────────────────── */

  var player = null, wake = null;

  // Можно ли эту ссылку открыть прямо в странице. Свой же домен не
  // встраиваем: страница в странице — верный способ запутаться.
  function embeddable(url) {
    return /^https:\/\//i.test(url) && !/^https:\/\/(www\.)?plair\.pro/i.test(url);
  }

  // Экран телефона гаснет посреди игры, если по нему не возят пальцем.
  function keepAwake() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').then(function (l) {
          if (player) wake = l; else l.release();
        }).catch(function () {});
      }
    } catch (e) { /* не дали — не беда */ }
  }

  function play(g, opts) {
    opts = opts || {};
    // При проверке из формы панель не закрываем: игрок посмотрит и
    // вернётся к незаполненным полям.
    if (!opts.preview) shut();
    var p = document.createElement('div');
    p.className = 'g-player';
    p.innerHTML = '<div class="g-bar">' +
      '<button class="g-x" type="button" data-quit aria-label="Close the game">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 16M20 4 4 20"/></svg></button>' +
      '<strong>' + esc(g.title) + '</strong><span class="g-sp"></span>' +
      '<button class="g-x" type="button" data-full aria-label="Fill the screen">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      (games.indexOf(g) !== -1 && !opts.preview ? shareHTML(games.indexOf(g), 'bar') : '') +
      '</div><div class="g-stage" id="stage"></div>';
    document.body.appendChild(p);
    document.body.style.overflow = 'hidden';
    player = p;
    if (!opts.noHash) history.pushState({ play: g.id }, '', '#play-' + g.id);
    if (!opts.preview) countPlay(g);
    keepAwake();

    var stage = p.querySelector('#stage');

    if (!embeddable(g.url)) {
      stage.innerHTML = '<div class="g-fallback"><h4>This one opens separately</h4>' +
        '<p>The address is not one the page can hold.</p>' +
        '<a class="button" href="' + esc(g.url) + '" target="_blank" rel="noopener">' +
        '<span class="blob" aria-hidden="true"></span><span class="f1">Open the game</span>' +
        '<span class="f2" aria-hidden="true">Open the game<svg viewBox="0 0 24 24">' +
        '<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</span></a></div>';
      return;
    }

    stage.innerHTML = '<p class="g-loading" id="loading">Loading ' + esc(g.title) + '&hellip;</p>';

    var f = document.createElement('iframe');
    f.src = g.url;
    f.title = g.title;
    f.allow = 'fullscreen; autoplay; gamepad; accelerometer; gyroscope; magnetometer; xr-spatial-tracking';
    f.setAttribute('sandbox',
      'allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-forms allow-modals allow-orientation-lock');
    stage.appendChild(f);

    var landed = false;
    f.addEventListener('load', function () {
      landed = true;
      var l = $('loading');
      if (l) l.remove();
    });

    // Игра, запретившая себя встраивать, об этом не сообщает — узнать
    // можно только по тому, что окно не ожило. Поэтому кадр мы НЕ
    // убираем: он может просто грузиться долго. Вместо этого внизу
    // появляется полоска с запасным выходом, а игра продолжает грузиться.
    setTimeout(function () {
      if (landed || !player || !player.isConnected) return;
      var l = $('loading');
      if (l) l.textContent = 'Still loading…';
      var bar = document.createElement('div');
      bar.className = 'g-rescue';
      bar.innerHTML = '<span>Taking a while. Some games will not run inside a page.</span>' +
        '<a href="' + esc(g.url) + '" target="_blank" rel="noopener">Open separately</a>';
      stage.appendChild(bar);
    }, 7000);
  }

  function goFull() {
    var stage = player && player.querySelector('.g-stage');
    if (!stage) return;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (stage.requestFullscreen) stage.requestFullscreen().catch(function () {});
      else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
    } catch (e) { /* не дали — играем как есть */ }
  }

  /* Кадр игры гасим раньше, чем убираем: пустой src обрывает звук сразу,
     а удаление узла на части движков оставляет его доигрывать. */
  function killFrames(root) {
    [].forEach.call((root || document).querySelectorAll('iframe'), function (f) {
      try { f.src = 'about:blank'; } catch (e) {}
      f.remove();
    });
  }

  function quit() {
    if (!player) return;
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    if (wake) { try { wake.release(); } catch (e) {} wake = null; }
    killFrames(player);
    player.remove();
    player = null;
    if (!open) document.body.style.overflow = '';
    if (location.hash.indexOf('#play-') === 0) history.back();
  }

  /* ── события ─────────────────────────────────────────── */

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest(
      '[data-qclear],[data-tag],[data-order],[data-play],[data-pick],[data-close],[data-quit],[data-full],[data-more],' +
      '#how,#who,#submit-open,#empty-go,#empty-how,#w-go,#w-clear,#f-go,#f-copy,#f-try');
    if (!el) return;

    if (el.dataset.tag) { filter = el.dataset.tag; renderFilters(); renderFeed(); return; }
    if (el.dataset.qclear !== undefined) { setQuery(''); $('q').focus(); return; }
    if (el.dataset.order) {
      order = el.dataset.order;
      try { localStorage.setItem('plair-order', order); } catch (e) {}
      renderFilters(); renderFeed(); return;
    }
    if (el.dataset.more !== undefined) {
      var box = el.closest('.g-info');
      var on = box.classList.toggle('is-open');
      el.setAttribute('aria-expanded', on ? 'true' : 'false');
      return;
    }
    if (el.dataset.play !== undefined) { play(games[Number(el.dataset.play)]); return; }
    if (el.dataset.quit !== undefined) { quit(); return; }
    if (el.dataset.full !== undefined) { goFull(); return; }
    if (el.dataset.close !== undefined) { shut(); return; }

    if (el.dataset.pick) {
      var t = el.dataset.pick, at = picked.indexOf(t);
      if (at !== -1) picked.splice(at, 1);
      else if (picked.length >= 5) {
        var m = $('f-msg');
        m.className = 'g-hint bad';
        m.textContent = 'Five genres is the limit.';
        return;
      } else picked.push(t);
      el.setAttribute('aria-pressed', String(at === -1));
      $('f-msg').textContent = '';
      return;
    }

    if (el.id === 'how' || el.id === 'empty-how') { howSheet(); return; }
    if (el.id === 'who') { whoSheet(); return; }
    if (el.id === 'submit-open' || el.id === 'empty-go') { submitSheet(); return; }
    if (el.id === 'w-go') { saveWho(); return; }
    if (el.id === 'w-clear') { me = null; saveMe(); shut(); return; }
    if (el.id === 'f-go') { build(); return; }
    if (el.id === 'f-try') {
      // Проверка перед подачей: откроется ли игра прямо в странице.
      if (found) play({ id: 'try', title: $('f-title').value.trim() || found.repo, url: found.url },
                      { noHash: true, preview: true });
      return;
    }
    if (el.id === 'f-copy') { copyJSON(); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (player) quit(); else shut(); return; }
    if (player || open) return;
    var t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); step(1); return; }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); step(-1); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      var all = slides();
      if (!all.length) return;
      var go = all[current()].querySelector('[data-play]');
      if (go) { e.preventDefault(); go.click(); }
    }
  });

  /* Соседние обложки подтягиваем сами: браузер в этой ленте ленивые
     картинки запрашивает с опозданием, и следующая игра встречала
     пустым экраном. Два слайда вперёд — запас на быстрый свайп. */
  function warm() {
    var all = slides(), at = current();
    for (var i = at; i <= at + 2 && i < all.length; i++) {
      [].forEach.call(all[i].querySelectorAll('img[loading="lazy"]'), function (im) {
        im.loading = 'eager';
      });
    }
  }

  /* Подсказка «свайпни» уходит, как только лентой воспользовались. */
  $('feed').addEventListener('scroll', function () {
    if (this.scrollTop > 24) this.classList.add('is-moved');
    /* В ленте звучать нечему. Если проигрыватель закрыт, а кадр игры
       почему-то жив, — сносим: листать ленту под чужую музыку нельзя. */
    if (!player) killFrames(document);
    closeShares();
    warm();
  }, { passive: true });

  addEventListener('popstate', function () { if (player) quit(); });

  /* Уходим со страницы — звук игры уходит с нами. На переключение
     вкладки не трогаем: человек вернётся к своей партии. */
  addEventListener('pagehide', function () { if (player) killFrames(player); });

  /* ── поиск ───────────────────────────────────────────── */

  var qTimer = 0;
  function setQuery(v, typed) {
    query = v;
    var box = $('q');
    if (!typed && box.value !== v) box.value = v;
    $('q-x').hidden = !v;
    // На телефоне поле свёрнуто — кнопка горит зелёным, пока поиск действует.
    $('q-open').classList.toggle('is-on', !!v.trim());
    /* Запрос живёт в адресе: ссылку с ним можно переслать, и «назад»
       после игры возвращает к той же выдаче. Историю не засоряем. */
    try {
      var u = new URL(location.href);
      if (v.trim()) u.searchParams.set('q', v.trim()); else u.searchParams.delete('q');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) {}
    if (games.length) renderFeed();
  }

  function openSearch(on) {
    var top = document.querySelector('.g-top');
    top.classList.toggle('is-searching', on);
    $('q-open').setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) setTimeout(function () { $('q').focus(); }, 0);
  }

  $('q').value = query;
  $('q-x').hidden = !query;
  $('q-open').classList.toggle('is-on', !!query.trim());
  $('q').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { setQuery(v, true); }, 120);
  });
  $('q').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (this.value) setQuery(''); else { this.blur(); openSearch(false); }
    }
    if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
  });
  $('q').addEventListener('blur', function () {
    // На телефоне поле прячется обратно, если в нём пусто.
    if (!this.value) openSearch(false);
  });
  $('search').addEventListener('submit', function (e) { e.preventDefault(); });
  $('q-x').addEventListener('click', function () { setQuery(''); $('q').focus(); });
  $('q-open').addEventListener('click', function () { openSearch(true); });

  /* «/» с клавиатуры прыгает в поиск, как на большинстве сайтов. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || player || open) return;
    var t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    e.preventDefault();
    if (getComputedStyle($('search')).display === 'none') openSearch(true); else $('q').focus();
  });

  /* ── старт ───────────────────────────────────────────── */

  drawWho();
  fetch(CATALOG + '?t=' + Date.now())
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (list) {
      games = Array.isArray(list) ? list : [];
      games.sort(byDate);
      renderFilters();
      renderFeed();
      /* Пришли по ссылке «поделиться»: ставим ленту на эту игру. */
      var want = new URLSearchParams(location.search).get('g');
      var hit = want && [].filter.call(document.querySelectorAll('#feed .g-slide'), function (s) {
        return s.dataset.id === want;
      })[0];
      if (hit) { $('feed').scrollTop = hit.offsetTop; $('feed').classList.add('is-moved'); warm(); }
      /* Вернулись со входа (или пришли по ссылке из уведомления):
         сразу открываем комментарии этой игры. */
      var back = want && new URLSearchParams(location.search).get('c') === '1' &&
        games.filter(function (g) { return g.id === want; })[0];
      if (back && COUNTS) talkSheet(back);
      if (authNote) authToast();
      /* Счётчики приезжают следом и ничего не ломают, если не приехали:
         лента к этому моменту уже стоит на экране. */
      loadLiked();
      loadCounts().then(function (got) {
        if (!got) return;
        if (order === 'hot') renderFeed();
      });
    })
    .catch(function () {
      $('feed').innerHTML = '<p class="g-hint bad">The catalogue would not load. Reload the page.</p>';
    });
})();
