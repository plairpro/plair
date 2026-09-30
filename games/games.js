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

  function drawWho() {
    var b = $('who');
    b.innerHTML = me
      ? '<img src="' + esc(avatar(me.login)) + '" alt=""><span>@' + esc(me.login) + '</span>'
      : 'Set your GitHub name';
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
    $('filters').innerHTML = list.length > 1 ? list.map(function (t) {
      return '<button class="g-chip" type="button" data-tag="' + esc(t) + '" aria-pressed="' +
        (t === filter) + '">' + esc(t) + '</button>';
    }).join('') : '';
  }

  function cardHTML(g, i) {
    return '<article class="g-card">' +
      '<button class="g-cover" type="button" data-play="' + i + '" aria-label="Play ' + esc(g.title) + '">' +
        (g.cover ? '<img src="' + esc(g.cover) + '" alt="" loading="lazy" decoding="async">' : '') +
        '<span class="g-play">' + ICON_PLAY + 'Play</span></button>' +
      '<div class="g-body"><h2>' + esc(g.title) + '</h2>' +
        (g.blurb ? '<p>' + esc(g.blurb) + '</p>' : '') +
        '<div class="g-tags">' + (g.tags || []).map(function (t) {
          return '<span class="g-tag">' + esc(t) + '</span>';
        }).join('') + '</div>' +
        '<div class="g-meta">' +
          '<a class="g-author" href="https://github.com/' + esc(g.by) + '" target="_blank" rel="noopener">' +
            '<img src="' + esc(avatar(g.by)) + '" alt="" loading="lazy"><b>' + esc(g.by) + '</b></a>' +
          '<span class="g-sp"></span>' +
          (g.repo ? '<a class="g-src" href="' + esc(g.repo) + '" target="_blank" rel="noopener">Source</a>' : '') +
        '</div></div></article>';
  }

  function renderFeed() {
    var list = games.filter(function (g) {
      return filter === 'All' || (g.tags || []).indexOf(filter) !== -1;
    });
    if (!games.length) {
      $('feed').innerHTML = '<div class="g-empty"><h2>No games yet</h2>' +
        '<p>The catalogue is empty. Add the first one and it shows up here.</p>' +
        '<button class="button" type="button" id="empty-go">' +
        '<span class="blob" aria-hidden="true"></span><span class="f1">Submit a game</span>' +
        '<span class="f2" aria-hidden="true">Submit a game<svg viewBox="0 0 24 24">' +
        '<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
        '</button></div>';
      return;
    }
    $('feed').innerHTML = list.length
      ? list.map(function (g) { return cardHTML(g, games.indexOf(g)); }).join('')
      : '<p class="g-hint">Nothing tagged &laquo;' + esc(filter) + '&raquo; yet.</p>';
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

  /* ── имя пользователя ────────────────────────────────── */

  function whoSheet() {
    var s = sheet('<div class="g-sheet-top"><div><h3>Who are you on GitHub?</h3>' +
      '<p class="g-lede">So the page can check that a repository you submit is actually yours.</p></div>' +
      '<span class="g-sp"></span>' + X + '</div>' +
      '<label class="g-field"><span>GitHub username</span>' +
        '<input id="w-login" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" ' +
        'placeholder="plairpro" value="' + esc(me ? me.login : '') + '"></label>' +
      '<p class="g-hint" id="w-msg">Sign-in is not built yet, so this is on your honour. It still ' +
        'catches the honest mistake of pasting someone else&rsquo;s repository.</p>' +
      btn('w-go', 'Save') +
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
      shut();
    }).catch(function (err) {
      msg.className = 'g-hint bad';
      msg.textContent = err.message;
    });
  }

  /* ── публикация ──────────────────────────────────────── */

  var found = null;   // {owner, repo, url}

  function submitSheet() {
    if (!me) { whoSheet(); return; }
    picked = [];
    found = null;
    var s = sheet('<div class="g-sheet-top"><div><h3>Submit a game</h3>' +
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
      '<p class="g-hint" id="f-cover-msg">Wider than it is tall, at least 800px across. Keep it in your ' +
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
          (domain ? ' (its own domain).' : '.');
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
      msg.textContent = 'Wider than it is tall, at least 800px across. Keep it in your own repository.';
      return;
    }
    msg.className = 'g-hint busy';
    msg.textContent = 'Loading the image…';
    var img = new Image();
    img.onload = function () {
      if (img.naturalWidth < img.naturalHeight) {
        msg.className = 'g-hint bad';
        msg.textContent = 'That image is taller than it is wide. Covers are landscape.';
      } else if (img.naturalWidth < 800) {
        msg.className = 'g-hint bad';
        msg.textContent = 'Only ' + img.naturalWidth + 'px across. It will look soft — use 800 or more.';
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

  /* ── запуск игры ─────────────────────────────────────── */

  var player = null;

  function play(g) {
    shut();
    var safe = /^https:\/\//i.test(g.url) && !/^https:\/\/(www\.)?plair\.pro/i.test(g.url);
    var p = document.createElement('div');
    p.className = 'g-player';
    p.innerHTML = '<div class="g-bar">' +
      '<button class="g-x" type="button" data-quit aria-label="Close the game">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 16M20 4 4 20"/></svg></button>' +
      '<strong>' + esc(g.title) + '</strong><span class="g-sp"></span>' +
      '<a class="g-src" href="' + esc(g.url) + '" target="_blank" rel="noopener">Open separately</a></div>' +
      '<div class="g-stage" id="stage"></div>';
    document.body.appendChild(p);
    document.body.style.overflow = 'hidden';
    player = p;
    history.pushState({ play: g.id }, '', '#play-' + g.id);

    var stage = p.querySelector('#stage');
    if (!safe) {
      stage.innerHTML = '<div class="g-fallback"><h4>This one opens separately</h4>' +
        '<p>The address is not one we can embed.</p></div>';
      return;
    }
    var f = document.createElement('iframe');
    f.src = g.url;
    f.title = g.title;
    f.allow = 'fullscreen; autoplay; gamepad; accelerometer; gyroscope';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-forms');
    stage.appendChild(f);

    // Игра, запретившая себя встраивать, не сообщает об этом; о беде мы
    // узнаём только по тому, что окно так и не ожило.
    var landed = false;
    f.addEventListener('load', function () { landed = true; });
    setTimeout(function () {
      if (landed || !player) return;
      stage.innerHTML = '<div class="g-fallback"><h4>It will not load inside the page</h4>' +
        '<p>Some games refuse to be embedded. Open it separately from the link above.</p></div>';
    }, 4000);
  }

  function quit() {
    if (!player) return;
    player.remove();
    player = null;
    document.body.style.overflow = '';
    if (location.hash.indexOf('#play-') === 0) history.back();
  }

  /* ── события ─────────────────────────────────────────── */

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest(
      '[data-tag],[data-play],[data-pick],[data-close],[data-quit],' +
      '#who,#submit-open,#empty-go,#w-go,#w-clear,#f-go,#f-copy');
    if (!el) return;

    if (el.dataset.tag) { filter = el.dataset.tag; renderFilters(); renderFeed(); return; }
    if (el.dataset.play !== undefined) { play(games[Number(el.dataset.play)]); return; }
    if (el.dataset.quit !== undefined) { quit(); return; }
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

    if (el.id === 'who') { whoSheet(); return; }
    if (el.id === 'submit-open' || el.id === 'empty-go') { submitSheet(); return; }
    if (el.id === 'w-go') { saveWho(); return; }
    if (el.id === 'w-clear') { me = null; saveMe(); shut(); return; }
    if (el.id === 'f-go') { build(); return; }
    if (el.id === 'f-copy') { copyJSON(); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (player) quit(); else shut();
  });

  addEventListener('popstate', function () { if (player) quit(); });

  /* ── старт ───────────────────────────────────────────── */

  drawWho();
  fetch(CATALOG + '?t=' + Date.now())
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (list) {
      games = Array.isArray(list) ? list : [];
      games.sort(function (a, b) { return String(b.added).localeCompare(String(a.added)); });
      renderFilters();
      renderFeed();
    })
    .catch(function () {
      $('feed').innerHTML = '<p class="g-hint bad">The catalogue would not load. Reload the page.</p>';
    });
})();
