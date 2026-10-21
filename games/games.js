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
  /* Параметры входящей ссылки (?g, ?list, ?q, ?c, ?review, старый #play-)
     читаем один раз при открытии и сразу убираем из адреса: обновление
     страницы всегда ведёт на обычную ленту — все игры, «New». */
  var START = new URLSearchParams(location.search);
  var START_HASH = location.hash;
  var query = START.get('q') || '';

  function fold(v) {
    return String(v == null ? '' : v).toLowerCase().replace(/ё/g, 'е')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function words(q) { return fold(q).split(/[\s,]+/).filter(Boolean); }
  function haystack(g) {
    if (g._hay == null) {
      /* aka — прежнее, русское название: «Office» находится и по «офис»,
         «Shift» — по «сдвиг». */
      g._hay = fold([g.title, g.aka, g.id, (g.tags || []).join(' '), g.blurb, g.by, '@' + g.by].join(' '));
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
     Популярность — см. WEIGHT ниже: запуск и минута в игре по единице,
     лайк 5, комментарий 8, репост и сохранение по 10.
     Возраста игры в формуле нет намеренно: каталог маленький, и затухание
     по возрасту тут только путало бы. Равный счёт разводим по дате,
     чтобы порядок был устойчивым, а не случайным. */
  var SORTS = { fresh: 'New', hot: 'Popular' };
  var order = 'fresh';
  try { localStorage.removeItem('plair-order'); } catch (e) {}

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
      if (d && d.ok && d.counted) { g.plays = d.plays; drawNums(g); }
    }).catch(function () {});
  }

  /* Репост засчитывается один раз в сутки с браузера на игру — как и
     на сервере. Считаем намерение: нажал соцсеть, скопировал ссылку. */
  function countShare(g) {
    if (!COUNTS || !g || !g.id) return;
    var key = 'plair-shared', day = new Date().toISOString().slice(0, 10), box = {};
    try { box = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) {}
    if (box.day !== day) box = { day: day, ids: {} };
    if (box.ids[g.id]) return;
    box.ids[g.id] = 1;
    try { localStorage.setItem(key, JSON.stringify(box)); } catch (e) {}
    g.shares = (Number(g.shares) || 0) + 1;
    ping('/share', { id: g.id, visitor: visitor() });
  }

  /* Отправка «на прощание»: sendBeacon доходит, даже если вкладку уже
     закрывают. Тело — простой текст, без заголовка JSON: так браузер не
     устраивает лишний предварительный запрос. */
  function ping(path, data) {
    var body = JSON.stringify(data);
    try { if (navigator.sendBeacon && navigator.sendBeacon(COUNTS + path, body)) return; } catch (e) {}
    try { fetch(COUNTS + path, { method: 'POST', body: body, keepalive: true }).catch(function () {}); } catch (e) {}
  }

  /* Время в игре. Идут только секунды, когда игра открыта и вкладка на
     экране; уходят на сервер кусками по полминуты и при закрытии игры.
     Сервер принимает не больше получаса в сутки с браузера на игру. */
  var clock = null;
  function clockRun() {
    if (!clock) return;
    var t = Date.now();
    if (clock.last) clock.acc += (t - clock.last) / 1000;
    clock.last = document.visibilityState === 'hidden' ? 0 : t;
  }
  function clockSend(all) {
    if (!clock) return;
    while (clock.acc >= 30 || (all && clock.acc >= 3)) {
      var n = Math.min(60, Math.floor(clock.acc));
      clock.acc -= n;
      clock.g.seconds = (Number(clock.g.seconds) || 0) + n;
      ping('/time', { id: clock.g.id, visitor: visitor(), seconds: n });
      if (all && clock.acc < 3) break;
    }
  }
  function clockStart(g) {
    clockStop();
    if (!COUNTS || !g || !g.id) return;
    clock = { g: g, acc: 0, began: Date.now(), last: document.visibilityState === 'hidden' ? 0 : Date.now() };
    clock.timer = setInterval(function () { clockRun(); clockSend(false); }, 15000);
  }
  /* Скип: игру закрыли быстрее 10 секунд после запуска. Считаем один раз
     в сутки с браузера на игру, как и на сервере. */
  function countSkip(g) {
    if (!COUNTS || !g || !g.id) return;
    var key = 'plair-skipped', day = new Date().toISOString().slice(0, 10), box = {};
    try { box = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) {}
    if (box.day !== day) box = { day: day, ids: {} };
    if (box.ids[g.id]) return;
    box.ids[g.id] = 1;
    try { localStorage.setItem(key, JSON.stringify(box)); } catch (e) {}
    g.skips = (Number(g.skips) || 0) + 1;
    ping('/skip', { id: g.id, visitor: visitor() });
  }

  function clockStop(closed) {
    if (!clock) return;
    if (closed && Date.now() - clock.began < 10000) countSkip(clock.g);
    clockRun(); clockSend(true);
    clearInterval(clock.timer);
    clock = null;
  }
  document.addEventListener('visibilitychange', function () {
    if (!clock) return;
    clockRun();
    if (document.visibilityState === 'hidden') clockSend(true);
  });

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
          g.shares = c.shares || 0; g.saves = c.saves || 0; g.seconds = c.seconds || 0; g.skips = c.skips || 0;
          drawNums(g); drawLike(g);
        });
        return true;
      })
      .catch(function () { return false; });
  }

  /* Популярность: чем дороже игроку действие, тем больше оно весит.
     запуск 1 · минута в игре 1 · лайк 5 · комментарий 8 ·
     репост 10 · сохранение 10. Скип — закрыли быстрее 10 секунд — минус 2. */
  var WEIGHT = { plays: 1, minutes: 1, likes: 5, comments: 8, shares: 10, saves: 10, skips: -2 };
  function score(g) {
    var n = function (k) { return Number(g[k]) || 0; };
    return WEIGHT.plays * n('plays') + WEIGHT.minutes * n('seconds') / 60 +
      WEIGHT.likes * n('likes') + WEIGHT.comments * n('comments') +
      WEIGHT.shares * n('shares') + WEIGHT.saves * n('saves') + WEIGHT.skips * n('skips');
  }

  function byDate(a, b) { return String(b.added).localeCompare(String(a.added)); }
  function byScore(a, b) { return score(b) - score(a) || byDate(a, b); }
  // Избранное — в том порядке, в каком сохраняли: последнее сверху.
  function bySaved(a, b) { return savedList.indexOf(a.id) - savedList.indexOf(b.id); }
  function byList(a, b) { return listView.ids.indexOf(a.id) - listView.ids.indexOf(b.id); }
  function viewOrder() { return order === 'saved' && !meUser ? 'fresh' : order; }
  var picked = [];

  var ICON_USER = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="8.5" r="3.7"/><path d="M4.8 20c.6-3.8 3.6-6 7.2-6s6.6 2.2 7.2 6" ' +
    'stroke-linecap="round"/></svg>';

  /* ── запросы к GitHub ────────────────────────────────── */

  /* GitHub без входа отвечает одному адресу 60 раз в час — на всех, кто
     сидит за тем же роутером или VPN. Поэтому ответы запоминаем, а если
     лимит всё же кончился, проверяем другим путём (см. ниже), а не
     заставляем человека ждать час. */
  var ghCache = {};
  try { ghCache = JSON.parse(sessionStorage.getItem('plair-gh') || '{}') || {}; } catch (e) { ghCache = {}; }
  function gh(path) {
    var key = path.toLowerCase();
    if (ghCache[key]) return Promise.resolve(ghCache[key]);
    return fetch(API + path, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) {
        if (r.status === 404) return { missing: true };
        if (r.status === 403 || r.status === 429) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            var e = new Error(/rate limit/i.test(j.message || '')
              ? 'GitHub is busy right now. Try again in a little while.'
              : 'GitHub refused the request.');
            e.limited = /rate limit/i.test(j.message || '') || r.status === 429;
            throw e;
          });
        }
        if (!r.ok) throw new Error('GitHub answered ' + r.status + '.');
        return r.json();
      })
      .then(function (j) {
        ghCache[key] = j;
        try { sessionStorage.setItem('plair-gh', JSON.stringify(ghCache)); } catch (e) {}
        return j;
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
    var kinds = Object.keys(SORTS);
    // «Saved» — третья вкладка, только для вошедших: их избранное.
    if (meUser) kinds.push('saved');
    var sorts = (listView
        ? '<button class="g-listchip" type="button" data-list-close aria-label="Close this list">' +
            esc(listView.owner.name) + '&rsquo;s list &middot; ' + listView.ids.length +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>'
        : '') +
      '<div class="g-sort" role="group" aria-label="Order">' +
      kinds.map(function (k) {
        return '<button class="g-sortbtn" type="button" data-order="' + k + '" aria-pressed="' +
          (!listView && k === viewOrder()) + '">' + (SORTS[k] || 'Saved') + '</button>';
      }).join('') + '</div>' +
      (!listView && viewOrder() === 'saved' && savedList.length
        ? '<button class="g-listchip is-share" type="button" data-list-share>Share list' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg></button>'
        : '');
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
          /* Жанры — все, сколько влезает в строку. Не влезшие прячутся
             под «+N» и показываются вместе с полным описанием. */
          '<div class="g-tags">' + (g.tags || []).map(function (t) {
            return '<span class="g-tag">' + esc(t) + '</span>';
          }).join('') +
            '<button class="g-tag g-tag-more" type="button" data-more aria-expanded="false" ' +
              'aria-label="Show all genres" hidden></button></div>' +
          '<div class="g-meta">' +
            '<a class="g-author" href="' + esc(g.byUrl || ('https://github.com/' + g.by)) + '" target="_blank" rel="noopener">@' +
              esc(g.by) + (g.verified ? ICON_VERIFIED : '') + '</a>' +
            /* Запуски, лайк, комментарии, сохранить и «поделиться» — строкой справа от автора. */
            '<span class="g-acts-row">' + playsHTML(i) + likeHTML(i) + talkHTML(i) + saveHTML(i) + shareHTML(i, 'rail') + '</span>' +
          '</div></div>' +
      '</div></section>';
  }

  /* Задники карточек размываем один раз, а не на каждом кадре листания:
     уменьшаем обложку до горстки точек и растягиваем обратно — при
     растяжении браузер сам сглаживает её в мягкое пятно. Готовую
     картинку помним, вторая карточка с той же обложкой берёт её. */
  var softCache = {};
  /* Насыщенность и яркость тоже запекаем в саму картинку (формулы те же,
     что у CSS saturate()/brightness()) — тогда фильтров нет вовсе. */
  function tone(ctx, w, h, sat, br) {
    var d = ctx.getImageData(0, 0, w, h), p = d.data;
    for (var i = 0; i < p.length; i += 4) {
      var r = p[i], g = p[i + 1], b = p[i + 2];
      p[i] = br * ((0.213 + 0.787 * sat) * r + (0.715 - 0.715 * sat) * g + (0.072 - 0.072 * sat) * b);
      p[i + 1] = br * ((0.213 - 0.213 * sat) * r + (0.715 + 0.285 * sat) * g + (0.072 - 0.072 * sat) * b);
      p[i + 2] = br * ((0.213 - 0.213 * sat) * r + (0.715 - 0.715 * sat) * g + (0.072 + 0.928 * sat) * b);
    }
    ctx.putImageData(d, 0, 0);
  }
  function softImage(src, w, sat, br) {
    if (!softCache[src]) softCache[src] = new Promise(function (ok, no) {
      var im = new Image();
      if (!/^\//.test(src)) im.crossOrigin = 'anonymous';
      im.onload = function () {
        try {
          var h = Math.round(w * im.naturalHeight / Math.max(1, im.naturalWidth));
          var a = document.createElement('canvas'); a.width = w; a.height = h;
          var x = a.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, w, h);
          tone(x, w, h, sat, br);
          var b = document.createElement('canvas'); b.width = w * 8; b.height = h * 8;
          var y = b.getContext('2d'); y.imageSmoothingQuality = 'high'; y.drawImage(a, 0, 0, b.width, b.height);
          ok(b.toDataURL('image/jpeg', 0.8));
        } catch (e) { no(e); }   // чужая обложка без разрешения — оставляем живое размытие
      };
      im.onerror = no;
      im.src = src;
    });
    return softCache[src];
  }
  function softBacks(slide) {
    [].forEach.call(slide.querySelectorAll('img.g-back:not(.is-soft),img.g-fill:not(.is-soft)'), function (el) {
      var src = el.getAttribute('src');
      if (!src || el.dataset.soft) return;
      el.dataset.soft = '1';
      var back = el.classList.contains('g-back');
      softImage(src + '#' + (back ? 'b' : 'f'), back ? 10 : 14, back ? 0.45 : 0.6, back ? 0.3 : 0.45)
        .then(function (url) { el.src = url; el.classList.add('is-soft'); },
              function () { el.classList.add('is-live'); });
    });
  }

  /* Сколько жанров влезает в одну строку под описанием. Меряем в
     свёрнутом виде; если всё влезло и описание короткое, разворачивать
     нечего — стрелка у описания пропадает. */
  function fitTags() {
    [].forEach.call(document.querySelectorAll('.g-slide .g-info'), function (info) {
      var box = info.querySelector('.g-tags');
      if (!box) return;
      var open = info.classList.contains('is-open');
      if (open) info.classList.remove('is-open');
      var tags = [].slice.call(box.querySelectorAll('.g-tag:not(.g-tag-more)'));
      var more = box.querySelector('.g-tag-more');
      tags.forEach(function (t) { t.classList.remove('is-cut'); });
      more.hidden = true;
      var top = tags.length ? tags[0].offsetTop : 0;
      var cut = 0;
      if (tags.length && tags[tags.length - 1].offsetTop > top) {
        more.hidden = false;
        for (var k = tags.length - 1; k > 0; k--) {
          tags[k].classList.add('is-cut'); cut++;
          more.textContent = '+' + cut;
          if (more.offsetTop === top && tags[k - 1].offsetTop === top) break;
        }
      }
      var blurb = info.querySelector('.g-blurb');
      var long = blurb && blurb.scrollHeight > blurb.clientHeight + 1;
      info.classList.toggle('has-more', !!(cut || long));
      if (open) info.classList.add('is-open');
    });
  }
  addEventListener('resize', function () { requestAnimationFrame(fitTags); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTags);

  /* Галочка «автор подтверждён»: игру прислал тот, кто ею владеет. */
  var ICON_VERIFIED = '<svg class="g-verified" viewBox="0 0 24 24" role="img" aria-label="Verified author">' +
    '<title>Verified author</title><circle cx="12" cy="12" r="10"/><path d="m7.5 12.3 3 3 6-6.3"/></svg>';

  var SWIPE = '<div class="g-swipe"><svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>Swipe</div>';

  function renderFeed() {
    var deck = $('feed');
    deck.classList.remove('is-moved');
    var how = listView ? 'list' : viewOrder();
    var list = games.filter(function (g) {
      return (filter === 'All' || (g.tags || []).indexOf(filter) !== -1) && matches(g) &&
        (how !== 'saved' || savedList.indexOf(g.id) !== -1) &&
        (how !== 'list' || listView.ids.indexOf(g.id) !== -1);
    }).sort(how === 'hot' ? byScore : how === 'saved' ? bySaved : how === 'list' ? byList : byDate);
    if (how === 'list' && !list.length && games.length) {
      deck.innerHTML = '<div class="g-empty"><h2>This list is empty for now</h2>' +
        '<p>' + esc(listView.owner.name) + ' has not saved any games yet.</p>' +
        '<button class="g-link" type="button" data-list-close>See all games</button></div>';
      return;
    }
    if (how === 'saved' && !list.length && games.length) {
      deck.innerHTML = '<div class="g-empty"><h2>Nothing saved yet</h2>' +
        '<p>Tap the bookmark under any game and it lands here &mdash; on every device you sign in on.</p>' +
        '<button class="g-link" type="button" data-order="fresh">Back to all games</button></div>';
      return;
    }
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
    requestAnimationFrame(fitTags);
    setTimeout(drawDuel, 0);
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
    // Слайды одной высоты — номер считается делением, без обхода всех.
    if (all.length && all[0].offsetHeight) {
      return Math.max(0, Math.min(all.length - 1, Math.round((deck.scrollTop - all[0].offsetTop) / all[0].offsetHeight)));
    }
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

  function sheet(html, focusSel) {
    shut();
    var s = document.createElement('div');
    s.className = 'g-scrim';
    s.innerHTML = '<div class="g-sheet" role="dialog" aria-modal="true">' + html + '</div>';
    s.addEventListener('click', function (e) { if (e.target === s) shut(); });
    document.body.appendChild(s);
    document.body.style.overflow = 'hidden';
    open = s;
    var f = s.querySelector(focusSel || 'input, button');
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

  /* «i» — как всё устроено: сначала для авторов (как добавить игру,
     пределы веса и загрузки, обложка), потом — как упорядочена лента.
     Окно «+» ссылается сюда и умеет вернуться к начатой заявке. */
  var LIMIT_MB = 10, LIMIT_GOOD_MB = 5, LIMIT_SEC = 10;
  var SDK_LINE = '&lt;script src=&quot;https://plair.pro/sdk.js&quot;&gt;&lt;/script&gt;';
  var LIMIT_BYTES = LIMIT_MB * 1024 * 1024;
  var draftUrl = '';   // ссылка из «+», пока человек читает правила

  function howSheet(opts) {
    opts = opts || {};
    sheet('<div class="g-sheet-top"><div><h3>How it works</h3>' +
      '<p class="g-lede">Small web games by their makers. Tap a cover and play &mdash; nothing to install.</p></div>' +
      '<span class="g-sp"></span>' + X + '</div>' +
      (opts.back ? '<p class="g-back-to"><button type="button" class="g-link" data-add-back>&larr; Back to your game</button></p>' : '') +
      '<div class="g-doc">' +

      '<h4>Add your game</h4>' +
      '<ol>' +
        '<li>Press the green <b>+</b> at the top and paste the link to your game ' +
          '(for example <code>name.github.io/my-game</code>).</li>' +
        '<li>Check the title, the line about it and the cover the page found. Change anything you like.</li>' +
        '<li>Press <b>Send for review</b>. We look at every game by hand, usually within a day, ' +
          'and then it appears at the top of the feed.</li>' +
      '</ol>' +

      '<h4>Show it&rsquo;s yours</h4>' +
      '<p>Only the author can add a game. The form asks for one of two proofs:</p>' +
      '<ul>' +
        '<li><b>Sign in with GitHub</b> &mdash; if the game is on GitHub Pages (<code>your-name.github.io/&hellip;</code>), ' +
          'sign in as <code>your-name</code>. For a team page, you need to be a public member of that team.</li>' +
        '<li><b>Add a code to the game</b> &mdash; works on any hosting. The form gives you a line like ' +
          '<code>&lt;meta name="plair-verify" content="plair-&hellip;"&gt;</code>; put it inside <code>&lt;head&gt;</code> ' +
          'of your <code>index.html</code> (or save the code as <code>plair.txt</code> next to it), publish, press <b>check again</b>.</li>' +
      '</ul>' +
      '<p class="g-hint">Games added this way show a check mark next to the author&rsquo;s name in the feed.</p>' +

      '<h4>Limits</h4>' +
      '<ul>' +
        '<li><b>Size: up to ' + LIMIT_MB + ' MB.</b> We weigh the game as soon as you paste the link; ' +
          'a heavier one cannot be sent. Aim for under ' + LIMIT_GOOD_MB + ' MB &mdash; people open the feed ' +
          'on a phone, on mobile data.</li>' +
        '<li><b>Loading: playable within ' + LIMIT_SEC + ' seconds</b> on a phone on 4G. ' +
          'A long loading screen is a reason to send a game back.</li>' +
        '<li><b>Runs in a browser</b> over https &mdash; no downloads, installers, store links ' +
          'or sign-up before the first round.</li>' +
        '<li><b>Works on a phone</b> with touch. Landscape-only or keyboard-only? Say so in the one-line description.</li>' +
        '<li><b>Yours to publish</b> &mdash; your own game, or one you have the rights to.</li>' +
      '</ul>' +
      '<p class="g-hint">The size counts every file the game refers to: code, pictures, sounds, models. ' +
        'To shrink it, save pictures as WebP, sounds as short OGG or MP3, and drop files the game does not use.</p>' +

      '<h4>Cover</h4>' +
      '<p>Put <code>cover.png</code> (or .jpg/.webp) next to your game&rsquo;s <code>index.html</code> and it is ' +
        'picked up by itself, or upload a picture in the form. Best: upright 9:16, shot <b>inside</b> the game ' +
        'rather than on the title screen.</p>' +
      '<p class="g-hint">Some games refuse to be embedded. Those open in a separate tab instead &mdash; that is fine.</p>' +

      '<h4 id="how-scores">Scores and challenges</h4>' +
      '<p><b>For players.</b> In games that support it, finish a round and your score appears at the top: your best, ' +
        'your place on the leaderboard and <b>Challenge a friend</b> &mdash; a link that opens the same game with your ' +
        'score to beat. Scores are saved for players signed in with Google: only your best counts, under your name. ' +
        'Without signing in you still see the round&rsquo;s score and can challenge a friend. ' +
        'Obviously faked scores are removed.</p>' +
      '<p><b>For developers</b> &mdash; optional, two lines. Add the script to <code>&lt;head&gt;</code>, next to the ' +
        '<code>plair-verify</code> line:</p>' +
      '<div class="g-own-code"><code>' + SDK_LINE + '</code><button type="button" class="g-link" data-sdk-copy>Copy</button></div>' +
      '<p>When a round ends, send the score: <code>PLAIR.score(points)</code>. Timed game where less is better? ' +
        '<code>PLAIR.score(seconds, { lowerIsBetter: true })</code>. Want to show the friend&rsquo;s score in your game? ' +
        '<code>PLAIR.onChallenge(c =&gt; &hellip; c.score, c.name)</code>.</p>' +
      '<p class="g-hint">Outside the feed the script does nothing and breaks nothing. It sends only the score you pass, ' +
        'nothing about the player. Check it with <b>Try it in the player</b> in the form: you will see ' +
        '&ldquo;PLAIR SDK connected&rdquo;.</p>' +
      (opts.back ? '' : '<p><button type="button" class="g-link" data-add-open>Add a game</button></p>') +

      '<h4>How the feed is ordered</h4>' +
      '<p><b>New</b> is the default: whatever was added last comes first. ' +
      '<b>Popular</b> puts first the games people stay in, like, talk about, share and save. ' +
      'Age does not matter, and reloading the page does not push a game up.</p>' +

      '<h4>Who runs this</h4>' +
      '<p>PLAIR Games is made by PLAIR, a studio that builds games for brands, events and ' +
        'training. <a href="/studio/">See the studio</a>.</p>' +

      '<p class="g-contact"><button type="button" class="g-link" data-contact>Contact us</button>' +
        '<a class="g-privacy" href="/privacy/">Privacy</a></p>' +

      '</div>');
  }

  /* Вес игры: сколько она тянет из сети. Читаем страницу, её скрипты и
     стили, находим в них пути к файлам (модели, звуки, картинки, сборки
     Unity) и спрашиваем у сервера размер каждого. Размер — из
     Content-Length, то есть уже сжатый, как он реально идёт по сети.
     Считаем всё, на что игра ссылается, даже если часть она грузит по
     ходу: так тяжёлую игру не спрятать за лёгкой первой страницей. */
  var ASSET_RE = /["'`(]((?:https?:\/\/[^"'`()\s]+?|\.{0,2}\/?[\w\-.%@~+]+(?:\/[\w\-.%@~+]+)*)\.(?:m?js|css|wasm|data|unityweb|glb|gltf|bin|fbx|obj|png|jpe?g|webp|avif|gif|svg|mp3|ogg|oga|wav|m4a|aac|mp4|webm|json|ttf|otf|woff2?|atlas|fnt|ktx2|basis|hdr|exr|pck|zip)(?:\.(?:br|gz|unityweb))?)(?:[?#][^"'`()\s]*)?["'`)]/gi;
  var TEXT_EXT = /\.(?:m?js|css|html?|json)(?:$|[?#])/i;
  function weighGame(pageUrl, limitBytes) {
    var host = new URL(pageUrl).host, seen = {}, queue = [], total = 0, files = 0, started = Date.now();
    var MAX_FILES = 150, MAX_MS = 25000;
    function add(u, base, fromTag) {
      var abs;
      try { abs = new URL(u, base); } catch (e) { return; }
      if (abs.protocol !== 'https:') return;
      if (!fromTag && abs.host !== host) return;   // чужие адреса внутри кода — не вес игры
      abs.hash = '';
      if (seen[abs.href]) return;
      seen[abs.href] = 1;
      queue.push(abs.href);
    }
    function scan(text, base) {
      // Шрифт в стиле обычно дан в нескольких форматах, браузер берёт один — woff2.
      var woff2 = /\.woff2/i.test(text), m;
      ASSET_RE.lastIndex = 0;
      while ((m = ASSET_RE.exec(text))) {
        if (woff2 && /\.(?:woff|ttf|otf)$/i.test(m[1])) continue;
        add(m[1], base, false);
      }
    }
    function one(u) {
      var text = u === pageUrl || TEXT_EXT.test(u);
      return fetch(u, { method: text ? 'GET' : 'HEAD', cache: 'no-cache', credentials: 'omit' }).then(function (r) {
        if (!r.ok) return;
        var n = Number(r.headers.get('content-length'));
        if (!text) {
          if (n > 0) { total += n; files++; return; }
          return fetch(u, { cache: 'no-cache', credentials: 'omit' })
            .then(function (g) { return g.arrayBuffer(); })
            .then(function (b) { total += b.byteLength; files++; });
        }
        return r.text().then(function (t) {
          total += n > 0 ? n : new Blob([t]).size; files++;
          if (u === pageUrl || /html/i.test(r.headers.get('content-type') || '')) {
            var d = new DOMParser().parseFromString(t, 'text/html');
            var b = d.querySelector('base[href]');
            var base = b ? new URL(b.getAttribute('href'), u).href : u;
            [].forEach.call(d.querySelectorAll('script[src]'), function (e) { add(e.getAttribute('src'), base, true); });
            [].forEach.call(d.querySelectorAll('link[href]'), function (e) {
              if (/stylesheet|modulepreload|preload/i.test(e.getAttribute('rel') || '')) add(e.getAttribute('href'), base, true);
            });
            [].forEach.call(d.querySelectorAll('img[src],audio[src],video[src],source[src]'), function (e) {
              add(e.getAttribute('src'), base, true);
            });
            [].forEach.call(d.querySelectorAll('script:not([src]),style'), function (e) { scan(e.textContent, base); });
          } else {
            // Путь из стиля браузер считает от самого стиля, из скрипта — от страницы.
            scan(t, /\.css(?:$|[?#])/i.test(u) ? u : pageUrl);
          }
        });
      }).catch(function () {});
    }
    seen[pageUrl] = 1; queue.push(pageUrl);
    return new Promise(function (done) {
      var running = 0, i = 1, finished = false;
      function end(r) { if (!finished) { finished = true; done(r); } }
      function pump() {
        var over = limitBytes && total > limitBytes;
        if (over || Date.now() - started > MAX_MS || i >= MAX_FILES) {
          if (!running) end({ bytes: total, files: files, over: !!over, partial: !over });
          return;
        }
        while (running < 6 && i < queue.length && i < MAX_FILES) {
          running++;
          one(queue[i++]).then(function () { running--; pump(); });
        }
        if (!running && i >= queue.length) end({ bytes: total, files: files, over: false, partial: false });
      }
      // Страница не читается (сайт закрыт для других сайтов) — веса не знаем.
      one(pageUrl).then(function () { if (!files) end({ bytes: 0, files: 0, unknown: true }); else pump(); });
    });
  }

  function mb(bytes) {
    var v = bytes / 1048576;
    return (v < 0.1 ? '0.1' : v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' MB';
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
    var howAdd = ev.target.closest && ev.target.closest('[data-how-add]');
    if (howAdd) {
      draftUrl = ($('s-url') && $('s-url').value) || draftUrl;
      howSheet({ back: true });
      var at = howAdd.getAttribute('data-how-at') && $(howAdd.getAttribute('data-how-at'));
      if (at) at.scrollIntoView({ block: 'start' });
    }
    if (ev.target.closest && ev.target.closest('[data-sdk-copy]')) {
      copyText('<script src="https://plair.pro/sdk.js"></' + 'script>').then(function () { toast('Copied'); }, function () {});
    }
    if (ev.target.closest && ev.target.closest('[data-add-back]')) submitSheet({ url: draftUrl });
    if (ev.target.closest && ev.target.closest('[data-add-open]')) submitSheet();
  });

  /* ── добавить игру ───────────────────────────────────── */
  /* Автору нужно одно: вставить ссылку на игру. Название, описание и
     обложку страница подбирает сама, автор может поправить. Заявка уходит
     на наш сервер, модератор одобряет её одним нажатием — и игра в ленте.
     Ни GitHub-аккаунта, ни JSON, ни коммитов. */

  var sub = null;   // {url, cover, coverData}

  function normGameUrl(raw) {
    var v = String(raw || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    // github.com/name/project → name.github.io/project
    var m = v.match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i);
    if (m) v = 'https://' + m[1].toLowerCase() + '.github.io/' + m[2] + '/';
    try {
      var u = new URL(v.replace(/^http:/i, 'https:'));
      u.hash = '';
      if (!/\.[a-z]{2,}$/i.test(u.hostname)) return '';
      if (!/\/$/.test(u.pathname) && !/\.[a-z0-9]{2,5}$/i.test(u.pathname)) u.pathname += '/';
      return u.toString();
    } catch (e) { return ''; }
  }

  function readPage(url) {
    // GitHub Pages и многие хостинги отдают страницу любому сайту.
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) return { status: r.status };
      return r.text().then(function (html) {
        var d = new DOMParser().parseFromString(html, 'text/html');
        var meta = function (sel) { var el = d.querySelector(sel); return el ? (el.getAttribute('content') || '').trim() : ''; };
        var img = meta('meta[property="og:image"],meta[name="og:image"],meta[name="twitter:image"],meta[property="twitter:image"]');
        return {
          status: 200,
          title: meta('meta[property="og:title"]') || (d.title || '').trim(),
          blurb: meta('meta[property="og:description"]') || meta('meta[name="description"]'),
          image: img ? new URL(img, url).href : ''
        };
      });
    }).catch(function () { return { status: 0 }; });
  }

  function loadsImage(src) {
    return new Promise(function (ok) {
      var im = new Image();
      im.onload = function () { ok({ w: im.naturalWidth, h: im.naturalHeight }); };
      im.onerror = function () { ok(null); };
      im.src = src;
    });
  }

  function niceTitle(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (t === t.toLowerCase()) t = t.replace(/(^|[\s-])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
    return t.slice(0, 40);
  }

  function submitSheet(opts) {
    opts = opts || {};
    picked = [];
    sub = { url: '', cover: '', coverData: '', weight: null, weighing: null, verified: false, code: '' };
    var s = sheet('<div class="g-sheet-top"><div><h3>Add a game</h3>' +
        '<p class="g-lede">Paste a link to your game. We fill in the rest &mdash; check it and send. ' +
        'It goes live after a quick look from us.</p></div>' +
        '<span class="g-sp"></span>' + X + '</div>' +
      '<label class="g-field"><span>Link to the game</span>' +
        '<input id="s-url" type="url" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" ' +
        'placeholder="https://name.github.io/your-game/"></label>' +
      '<p class="g-hint" id="s-url-msg">Any web game that opens in a browser. A GitHub repository link works too.</p>' +
      '<p class="g-hint" id="s-weight" hidden></p>' +
      '<p class="g-hint g-limits">Up to <b>' + LIMIT_MB + ' MB</b> and playable within <b>' + LIMIT_SEC +
        ' seconds</b> on a phone. <button type="button" class="g-link" data-how-add>How to add a game &mdash; ' +
        'rules and tips</button></p>' +
      '<div class="g-sub-more" id="s-more" hidden>' +
        '<div class="g-cov">' +
          '<div class="g-cov-img" id="s-cov" aria-hidden="true"></div>' +
          '<div class="g-cov-side">' +
            '<label class="g-field"><span>Title</span>' +
              '<input id="s-title" type="text" maxlength="40" placeholder="Up to 40 characters"></label>' +
            '<label class="g-field"><span>One line about it</span>' +
              '<input id="s-blurb" type="text" maxlength="120" placeholder="What the player does"></label>' +
          '</div>' +
        '</div>' +
        '<p class="g-hint" id="s-cov-msg"></p>' +
        '<p class="g-hint"><label class="g-link g-file">Use my own picture' +
          '<input type="file" id="s-file" accept="image/*" hidden></label></p>' +
        '<div class="g-field"><span>Genres &mdash; up to 5, optional</span><div class="g-pick" id="f-tags">' +
          TAGS.map(function (t) {
            return '<button class="g-chip" type="button" data-pick="' + esc(t) + '" aria-pressed="false">' +
              esc(t) + '</button>';
          }).join('') + '</div></div>' +
        '<label class="g-field"><span>How to reach you &mdash; optional</span>' +
          '<input id="s-contact" type="text" maxlength="100" autocapitalize="none" ' +
          'placeholder="Email or Telegram, if we have a question"></label>' +
        '<div class="g-own" id="s-own"><span class="g-own-h">Show it&rsquo;s yours</span>' +
          '<div id="s-own-body"><p class="g-hint busy">Checking&hellip;</p></div></div>' +
        '<div class="g-own"><span class="g-own-h">Scores and challenges &mdash; optional</span>' +
          '<p class="g-hint">Give players a leaderboard and &ldquo;beat my score&rdquo; links. Add this line to ' +
            '<code>&lt;head&gt;</code>, next to the line above:</p>' +
          '<div class="g-own-code"><code>' + SDK_LINE + '</code><button type="button" class="g-link" data-sdk-copy>Copy</button></div>' +
          '<p class="g-hint">and call <code>PLAIR.score(points)</code> when a round ends. ' +
            '<button type="button" class="g-link" data-how-add data-how-at="how-scores">How it works</button></p></div>' +
        btn('s-go', 'Send for review') +
        '<p class="g-hint" id="f-msg"></p>' +
      '</div>');

    var input = s.querySelector('#s-url'), t;
    if (opts.url) { input.value = opts.url; inspecting = ''; setTimeout(inspectGame, 0); }
    input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(inspectGame, 450); });
    input.addEventListener('paste', function () { clearTimeout(t); t = setTimeout(inspectGame, 60); });
    s.querySelector('#s-file').addEventListener('change', function () {
      if (this.files && this.files[0]) ownCover(this.files[0]);
    });
  }

  function setCover(src, note, cls) {
    var box = $('s-cov'), msg = $('s-cov-msg');
    if (!box) return;
    box.style.backgroundImage = src ? 'url("' + src.replace(/"/g, '%22') + '")' : '';
    box.classList.toggle('is-empty', !src);
    if (!src) box.textContent = ($('s-title') && $('s-title').value.trim().slice(0, 1).toUpperCase()) || '?';
    else box.textContent = '';
    msg.className = 'g-hint' + (cls ? ' ' + cls : '');
    msg.innerHTML = note || '';
  }

  var inspecting = '';
  function inspectGame() {
    var raw = $('s-url') && $('s-url').value, msg = $('s-url-msg');
    if (!msg) return;
    var url = normGameUrl(raw);
    if (!raw || !raw.trim()) { $('s-more').hidden = true; msg.className = 'g-hint'; return; }
    if (!url) {
      msg.className = 'g-hint bad';
      msg.textContent = 'That does not look like a web address yet.';
      return;
    }
    if (url === inspecting) return;
    inspecting = url;
    sub.url = url;
    sub.weight = null; sub.weighing = null; sub.verified = false; sub.code = '';
    drawWeight(null);
    msg.className = 'g-hint busy';
    msg.textContent = 'Looking at the game…';
    readPage(url).then(function (pg) {
      if (inspecting !== url || !$('s-more')) return;
      $('s-more').hidden = false;
      var title = $('s-title'), blurb = $('s-blurb');
      if (pg.status !== 404) {
        checkOwner(url);
        drawWeight('busy');
        sub.weighing = weighGame(url, LIMIT_BYTES).then(function (w) {
          if (inspecting !== url) return w;
          sub.weight = w;
          drawWeight(w);
          return w;
        });
      }
      if (pg.status === 404) {
        msg.className = 'g-hint bad';
        msg.textContent = 'Nothing opens at ' + url + '. Check the link — for GitHub, Pages has to be on.';
      } else if (pg.status === 200) {
        msg.className = 'g-hint good';
        msg.innerHTML = 'Found it. <button type="button" class="g-link" id="s-try">Try it in the player</button>';
      } else {
        msg.className = 'g-hint';
        msg.innerHTML = 'This site does not let us peek inside, so fill in the title yourself. ' +
          '<button type="button" class="g-link" id="s-try">Try it in the player</button>';
      }
      if (!title.value.trim()) {
        var fallback = (new URL(url).pathname.split('/').filter(Boolean).pop() || '').replace(/[-_]+/g, ' ');
        title.value = niceTitle(pg.title || fallback);
      }
      if (!blurb.value.trim() && pg.blurb) blurb.value = pg.blurb.replace(/\s+/g, ' ').slice(0, 120);
      if (sub.coverData) return;
      setCover('', 'Looking for a cover…', 'busy');
      // Обложка: cover.* рядом с игрой → картинка для соцсетей → нет.
      var tries = ['cover.webp', 'cover.png', 'cover.jpg', 'cover.jpeg'].map(function (n) { return new URL(n, url).href; });
      if (pg.image) tries.push(pg.image);
      (function next(i) {
        if (inspecting !== url || sub.coverData) return;
        if (i >= tries.length) {
          sub.cover = '';
          setCover('', 'No cover found. Add a screenshot from inside the game &mdash; ' +
            'or skip it, the card will show the first letter of the title.');
          return;
        }
        loadsImage(tries[i]).then(function (sz) {
          if (!sz) return next(i + 1);
          sub.cover = tries[i];
          setCover(tries[i], 'Cover found by itself.' + (sz.w > sz.h
            ? ' It is wide, so the feed shows it with soft edges &mdash; an upright 9:16 shot looks best.' : ''), 'good');
        });
      })(0);
    });
  }

  /* Кнопка отправки живёт, только если игра не тяжелее предела и
     автор показал, что она его. */
  function syncGo() {
    var go = $('s-go');
    if (go) go.disabled = !!(sub && ((sub.weight && sub.weight.over) || !sub.verified));
  }

  /* «Это моя игра»: вход через GitHub (для name.github.io) или код в
     самой игре. Сервер проверяет то же самое ещё раз при отправке. */
  function checkOwner(url) {
    var body = $('s-own-body');
    if (!body || !COUNTS) return;
    body.innerHTML = '<p class="g-hint busy">Checking&hellip;</p>';
    Promise.all([api('/verify', { method: 'POST', body: { url: url } }), loadCfg()]).then(function (r) {
      if (inspecting !== url) return;
      var d = r[0];
      // Сервер ещё старый, проверки не знает — не мешаем отправке, проверит модератор.
      if (d.status === 404 && d.why === 'no such path') { sub.verified = true; $('s-own').hidden = true; syncGo(); return; }
      if (!d.ok) throw new Error('verify');
      sub.verified = !!d.verified; sub.code = d.code || '';
      drawOwn(d, url);
    }).catch(function () {
      if (inspecting !== url || !$('s-own-body')) return;
      $('s-own-body').innerHTML = '<p class="g-hint bad">Could not check right now. ' +
        '<button type="button" class="g-link" data-own-check>Try again</button></p>';
    });
  }

  function drawOwn(d, url) {
    var body = $('s-own-body');
    if (!body) return;
    syncGo();
    if (d.verified) {
      body.innerHTML = '<p class="g-hint good">' + (d.how === 'github'
        ? 'Confirmed: you are signed in with GitHub as @' + esc(d.login) + '.'
        : d.how === 'moderator' ? 'You are a moderator — no proof needed.'
        : 'Confirmed: the code is on the game page.') + '</p>';
      return;
    }
    var gh = /\.github\.io$/i.test(new URL(url).hostname) && talkCfg &&
      (!!talkCfg.github || (talkCfg.providers || []).indexOf('github') !== -1);
    var line = '<meta name="plair-verify" content="' + d.code + '">';
    body.innerHTML =
      (gh ? '<p class="g-hint">Game on your own GitHub Pages? Sign in with that GitHub account &mdash; that is all.</p>' +
        '<button class="g-auth-btn g-own-gh" type="button" data-own-github>' + ICON_GITHUB + 'Sign in with GitHub</button>' +
        '<p class="g-hint">Or add a code to the game instead:</p>'
        : '<p class="g-hint">Add this line inside <code>&lt;head&gt;</code> of your game&rsquo;s <code>index.html</code>:</p>') +
      '<div class="g-own-code"><code>' + esc(line) + '</code>' +
        '<button type="button" class="g-link" data-own-copy>Copy</button></div>' +
      '<p class="g-hint">' + (gh ? 'Put it inside <code>&lt;head&gt;</code> of <code>index.html</code>, or save' : 'Or save') +
        ' a file <code>plair.txt</code> with <code>' + esc(d.code) + '</code> next to it. Publish, wait a minute, then ' +
        '<button type="button" class="g-link" data-own-check>check again</button>.</p>';
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-own-check],[data-own-copy],[data-own-github]');
    if (!el || !sub) return;
    if (el.hasAttribute('data-own-check')) { if (sub.url) checkOwner(sub.url); return; }
    if (el.hasAttribute('data-own-copy')) {
      copyText('<meta name="plair-verify" content="' + sub.code + '">')
        .then(function () { toast('Copied'); }, function () {});
      return;
    }
    if (talkCfg && talkCfg.github === 'device') { githubByCode(); return; }
    // Вход через GitHub — и сразу обратно в форму с той же ссылкой.
    var back = location.origin + '/?add=' + encodeURIComponent(sub.url);
    location.assign(COUNTS + '/auth/github?back=' + encodeURIComponent(back));
  });

  /* Вход через GitHub по коду: показываем код, человек вводит его на
     github.com/login/device, а мы раз в несколько секунд спрашиваем
     сервер, готово ли. Без перехода со страницы — форма остаётся как есть. */
  var ghDev = null;
  function githubByCode() {
    var body = $('s-own-body'), url = sub.url;
    if (!body) return;
    body.innerHTML = '<p class="g-hint busy">Asking GitHub for a code&hellip;</p>';
    api('/auth/github/device', { method: 'POST' }).then(function (d) {
      if (!d.ok) throw new Error('device');
      ghDev = { handle: d.handle, code: d.code, url: d.url, gap: (d.interval || 5) * 1000, until: Date.now() + d.expires * 1000, for: url };
      if (!$('s-own-body')) return;
      $('s-own-body').innerHTML =
        '<p class="g-hint">Your GitHub code:</p>' +
        '<div class="g-own-code g-dev-code"><code>' + esc(d.code) + '</code></div>' +
        '<a class="g-auth-btn g-own-gh" href="' + esc(d.url) + '" target="_blank" rel="noopener" data-dev-open>' +
          ICON_GITHUB + 'Copy the code and open GitHub</a>' +
        '<p class="g-hint busy" id="s-dev-msg">Paste the code on GitHub and press Authorize &mdash; this page notices by itself.</p>';
      setTimeout(devPoll, ghDev.gap);
    }).catch(function () {
      if (!$('s-own-body')) return;
      drawOwn({ verified: false, code: sub.code }, url);
      $('s-own-body').insertAdjacentHTML('afterbegin', '<p class="g-hint bad">GitHub did not answer right now ' +
        '&mdash; try again in a minute, or use the code.</p>');
    });
  }
  function devPoll() {
    var dv = ghDev;
    if (!dv || !$('s-own-body') || !sub || sub.url !== dv.for) return;
    if (Date.now() > dv.until) { ghDev = null; devFail('The code expired.'); return; }
    api('/auth/github/poll', { method: 'POST', body: { handle: dv.handle } }).then(function (d) {
      if (ghDev !== dv) return;
      if (d.ok && d.done) {
        ghDev = null;
        session = d.session;
        try { localStorage.setItem(SESSION_KEY, session); } catch (e) {}
        meUser = d.user;
        drawWho();
        toast('Signed in with GitHub as @' + (d.user.login || d.user.name));
        flushScores();
        checkOwner(dv.for);
        return;
      }
      if (d.ok && d.wait) { if (d.interval) dv.gap = d.interval * 1000; setTimeout(devPoll, dv.gap); return; }
      ghDev = null;
      devFail(d.why === 'access_denied' ? 'GitHub sign-in was cancelled.' : 'GitHub sign-in did not work.');
    }).catch(function () { setTimeout(devPoll, dv.gap * 2); });
  }
  function devFail(text) {
    var m = $('s-dev-msg');
    if (m) { m.className = 'g-hint bad'; m.innerHTML = esc(text) + ' <button type="button" class="g-link" data-own-github>Try again</button>'; }
  }
  document.addEventListener('click', function (e) {
    if (!(e.target.closest && e.target.closest('[data-dev-open]')) || !ghDev) return;
    // Сама ссылка открывает GitHub в новой вкладке; мы только кладём код в буфер.
    copyText(ghDev.code).then(function () { toast('Code copied — paste it on GitHub'); }, function () {});
  });

  /* Строка про вес под ссылкой. Тяжелее предела — кнопка отправки гаснет. */
  function drawWeight(w) {
    var el = $('s-weight');
    if (!el) return;
    syncGo();
    if (!w) { el.hidden = true; return; }
    el.hidden = false;
    if (w === 'busy') { el.className = 'g-hint busy'; el.textContent = 'Weighing the game…'; return; }
    if (w.unknown) {
      el.className = 'g-hint';
      el.textContent = 'This site does not let us weigh the game from here — we will check its size by hand.';
    } else if (w.over) {
      el.className = 'g-hint bad';
      el.innerHTML = '<b>Over ' + LIMIT_MB + ' MB</b> (counted at least ' + mb(w.bytes) + '), so it cannot be sent. ' +
        'Make it lighter &mdash; pictures in WebP, shorter sounds, no unused files &mdash; and paste the link again.';
    } else if (w.bytes > LIMIT_GOOD_MB * 1048576) {
      el.className = 'g-hint';
      el.textContent = 'Size: about ' + mb(w.bytes) + (w.partial ? ' or more' : '') +
        '. Within the ' + LIMIT_MB + ' MB limit, but a lighter game opens faster on a phone.';
    } else {
      el.className = 'g-hint good';
      el.textContent = 'Size: about ' + mb(w.bytes) + (w.partial ? ' or more' : '') + ' — fine.';
    }
  }

  /* Своя картинка: ужимаем прямо в браузере до 720×1280 (9:16, по
     центру), чтобы на сервер уходило ~100 КБ, а не фото на 8 МБ. */
  function ownCover(file) {
    var url = URL.createObjectURL(file);
    var im = new Image();
    im.onload = function () {
      var W = 720, H = 1280, c = document.createElement('canvas');
      c.width = W; c.height = H;
      var k = Math.max(W / im.naturalWidth, H / im.naturalHeight);
      var w = im.naturalWidth * k, h = im.naturalHeight * k;
      var g = c.getContext('2d');
      g.fillStyle = '#111410'; g.fillRect(0, 0, W, H);
      g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
      URL.revokeObjectURL(url);
      var data = '', q = 0.82;
      for (; q >= 0.4; q -= 0.12) {
        data = c.toDataURL('image/webp', q);
        if (data.indexOf('data:image/webp') !== 0) data = c.toDataURL('image/jpeg', q);
        if (data.length < 440000) break;
      }
      sub.coverData = data;
      sub.cover = '';
      setCover(data, 'Your picture, trimmed to the screen.', 'good');
    };
    im.onerror = function () { URL.revokeObjectURL(url); setCover('', 'That file is not a picture we can read.', 'bad'); };
    im.src = url;
  }

  function sendGame() {
    var msg = $('f-msg'), go = $('s-go');
    var url = normGameUrl($('s-url').value), title = $('s-title').value.trim();
    if (!url) { msg.className = 'g-hint bad'; msg.textContent = 'Paste the link to the game first.'; return; }
    if (!title) { msg.className = 'g-hint bad'; msg.textContent = 'Give the game a title.'; $('s-title').focus(); return; }
    if (!COUNTS) { msg.className = 'g-hint bad'; msg.textContent = 'Sending is not set up yet.'; return; }
    go.disabled = true;
    // Вес ещё считается — дожидаемся: без него заявку не шлём.
    if (sub.weighing && !sub.weight) {
      msg.className = 'g-hint busy'; msg.textContent = 'Weighing the game…';
      sub.weighing.then(function () { go.disabled = false; msg.textContent = ''; sendGame(); });
      return;
    }
    if (sub.weight && sub.weight.over) {
      msg.className = 'g-hint bad'; msg.textContent = 'The game is over ' + LIMIT_MB + ' MB — make it lighter first.';
      return;
    }
    if (!sub.verified) {
      msg.className = 'g-hint bad'; msg.textContent = 'Show that the game is yours first — see just above.';
      return;
    }
    msg.className = 'g-hint busy'; msg.textContent = 'Sending…';
    api('/submit', { method: 'POST', body: {
      weight: sub.weight && !sub.weight.unknown ? sub.weight.bytes : null,
      url: url, title: title, blurb: $('s-blurb').value.trim(), tags: picked.slice(),
      cover: sub.coverData ? '' : sub.cover, coverData: sub.coverData || '',
      contact: $('s-contact').value.trim()
    } }).then(function (d) {
      if (!d.ok) {
        go.disabled = false;
        if (d.why === 'verify') { sub.verified = false; drawOwn({ verified: false, code: d.code || sub.code }, url); }
        msg.className = 'g-hint bad';
        msg.textContent = d.why === 'heavy' ? 'The game is over ' + LIMIT_MB + ' MB — make it lighter first.'
          : d.why === 'verify' ? 'We could not find the code on the game page yet. Publish it and check again.'
          : d.why === 'day' ? 'That is a lot of games for one day — try again tomorrow.'
          : d.why === 'busy' ? 'The review queue is full right now. Try again later.'
          : 'That did not go through. Check the link and the title.';
        return;
      }
      var top = open && open.querySelector('.g-sheet');
      if (!top) return;
      top.innerHTML = '<div class="g-sheet-top"><div><h3>' + (d.duplicate ? 'Already with us' : 'Sent!') + '</h3>' +
        '<p class="g-lede">' + (d.duplicate
          ? (d.status === 'approved' ? 'This game is already in the feed.' : 'This game is already waiting for review.')
          : 'Thanks. We look at every game by hand, usually within a day. Once it is approved it appears at the top of the feed.') +
        '</p></div><span class="g-sp"></span>' + X + '</div>' +
        btn('s-again', 'Add another game');
    }).catch(function () {
      go.disabled = false;
      msg.className = 'g-hint bad'; msg.textContent = 'No connection. Try again.';
    });
  }

  /* ── аккаунт ─────────────────────────────────────────── */
  /* Кнопка с человечком в шапке: войти через Google (для комментариев),
     выйти, а модератору — очередь присланных игр. */

  var pending = 0;

  function accountSheet(note) {
    var s = sheet('<div class="g-sheet-top"><div><h3>' + (meUser ? esc(meUser.name) : 'Your account') + '</h3>' +
        '<p class="g-lede">' + (meUser ? 'Signed in with Google.' : (note ? esc(note) :
          'Sign in to comment and keep a list of saved games. Playing, liking and adding games need no account.')) +
        '</p></div>' +
        '<span class="g-sp"></span>' + X + '</div>' +
      '<div id="a-body"><p class="g-hint busy">&nbsp;</p></div>');
    s.querySelector('.g-sheet').classList.add('is-account');
    drawAccount();
  }

  function drawAccount() {
    var body = $('a-body');
    if (!body) return;
    if (!meUser) {
      loadCfg().then(function (cfg) {
        if (!$('a-body')) return;
        $('a-body').innerHTML = cfg.providers && cfg.providers.indexOf('google') !== -1
          ? '<div class="g-auth"><div class="g-gbtn" id="a-google"></div></div>' +
            '<p class="g-hint">We keep only your name and picture. <a href="/privacy/" target="_blank" rel="noopener">Privacy</a></p>'
          : '<p class="g-hint">Signing in opens soon.</p>';
        var gb = $('a-google');
        if (gb) googleButton(gb);
      });
      return;
    }
    body.innerHTML =
      btn('a-saved', 'My saved games' + (savedList.length ? ' (' + savedList.length + ')' : '')) +
      (savedList.length ? '<p class="g-hint" style="text-align:center"><button class="g-link" type="button" data-list-share>' +
        'Share my list as a link</button></p>' : '') +
      (meUser.admin ? btn('a-review', 'Review new games' + (pending ? ' (' + pending + ')' : '')) : '') +
      '<p class="g-c-me">' +
        '<button class="g-link" type="button" data-signout>Sign out</button> &middot; ' +
        '<button class="g-link is-quiet" type="button" data-forget>Delete my comments and account</button></p>';
  }

  function drawWho() {
    var b = $('who');
    if (!b) return;
    b.innerHTML = meUser ? face(meUser, 'g-who-img') : ICON_USER;
    b.classList.toggle('has-dot', !!(meUser && meUser.admin && pending));
    b.setAttribute('aria-label', meUser ? 'Signed in as ' + meUser.name : 'Sign in');
  }

  function loadPending() {
    if (!meUser || !meUser.admin) { pending = 0; drawWho(); return Promise.resolve(); }
    return api('/submissions').then(function (d) {
      pending = d.ok ? d.total : 0;
      drawWho();
      return d;
    }).catch(function () {});
  }

  /* ── модерация ───────────────────────────────────────── */

  var review = [];

  function reviewSheet() {
    var s = sheet('<div class="g-sheet-top"><div><h3>New games</h3>' +
        '<p class="g-lede" id="r-lede">Loading…</p></div><span class="g-sp"></span>' + X + '</div>' +
      '<div id="r-list"></div>');
    s.querySelector('.g-sheet').classList.add('is-review');
    loadPending().then(function (d) {
      if (!$('r-list')) return;
      if (!d || !d.ok) { $('r-lede').textContent = 'Only a moderator can see this.'; return; }
      review = d.items;
      drawReview(d.total);
    });
  }

  function drawReview(total) {
    $('r-lede').textContent = total ? total + ' waiting. Try each one, then publish or skip.' : 'Nothing waiting. All clear.';
    $('r-list').innerHTML = review.map(function (it, i) {
      return '<article class="g-rv" data-rv="' + it.id + '">' +
        '<div class="g-rv-img' + (it.cover ? '' : ' is-empty') + '"' +
          (it.cover ? ' style="background-image:url(&quot;' + esc(it.cover) + '&quot;)"' : '') + '>' +
          (it.cover ? '' : esc(it.title.slice(0, 1).toUpperCase())) + '</div>' +
        '<div class="g-rv-body"><h4>' + esc(it.title) + '</h4>' +
          (it.blurb ? '<p>' + esc(it.blurb) + '</p>' : '') +
          '<p class="g-rv-meta"><a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.url.replace(/^https:\/\//, '')) + '</a>' +
            ' &middot; ' + (it.weight ? mb(it.weight) : 'size unknown') +
            ' &middot; ' + (it.proof === 'github' ? 'owner: GitHub' : it.proof === 'code' ? 'owner: code on page'
              : it.proof === 'moderator' ? 'added by a moderator' : 'owner not checked') +
            (it.contact ? ' &middot; ' + esc(it.contact) : '') +
            (it.tags.length ? ' &middot; ' + esc(it.tags.join(', ')) : '') + '</p>' +
          '<div class="g-rv-acts">' +
            '<button class="g-link" type="button" data-rv-try="' + i + '">Try</button>' +
            '<button class="g-c-post" type="button" data-rv-ok="' + it.id + '">Publish</button>' +
            '<button class="g-link is-quiet" type="button" data-rv-no="' + it.id + '">Skip</button>' +
          '</div></div></article>';
    }).join('');
  }

  function decideGame(id, action, el) {
    el.disabled = true;
    api('/submissions/' + id, { method: 'POST', body: { action: action } }).then(function (d) {
      if (!d.ok) throw new Error('decide');
      review = review.filter(function (it) { return String(it.id) !== String(id); });
      pending = Math.max(0, pending - 1);
      drawWho();
      if ($('r-list')) drawReview(pending);
      if (action === 'approve') { toast('Published'); reloadGames(); } else toast('Skipped');
    }).catch(function () { el.disabled = false; toast('That did not work. Try again.'); });
  }

  document.addEventListener('click', function (e) {
    var t = e.target, el;
    if (!t.closest) return;
    if ((el = t.closest('#s-go'))) { sendGame(); return; }
    if ((el = t.closest('#s-again'))) { submitSheet(); return; }
    if ((el = t.closest('#s-try'))) {
      var u = normGameUrl($('s-url') && $('s-url').value);
      if (u) play({ id: 'try', title: ($('s-title') && $('s-title').value.trim()) || 'Preview', url: u },
                  { noHash: true, preview: true });
      return;
    }
    if ((el = t.closest('#a-review'))) { reviewSheet(); return; }
    if ((el = t.closest('#a-saved'))) {
      order = 'saved';
      shut(); renderFilters(); renderFeed(); return;
    }
    if ((el = t.closest('[data-rv-try]'))) {
      var it = review[Number(el.dataset.rvTry)];
      if (it) play({ id: 'try', title: it.title, url: it.url }, { noHash: true, preview: true });
      return;
    }
    if ((el = t.closest('[data-rv-ok]'))) { decideGame(el.dataset.rvOk, 'approve', el); return; }
    if ((el = t.closest('[data-rv-no]'))) { decideGame(el.dataset.rvNo, 'reject', el); return; }
    if (open && open.querySelector('.is-account')) {
      if (t.closest('[data-signout]')) {
        dropSession(); drawWho(); drawAccount(); loadSaves(); renderFilters(); renderFeed();
        toast('Signed out'); return;
      }
      if ((el = t.closest('[data-forget]'))) {
        twoStep(el, 'Delete everything? Tap again', function () {
          el.disabled = true;
          api('/me', { method: 'DELETE' }).then(function (d) {
            if (!d.ok) throw new Error('forget');
            dropSession(); drawWho(); drawAccount(); loadSaves(); renderFilters(); renderFeed();
            toast('Your comments and account are gone'); loadCounts();
          }).catch(function () { el.disabled = false; toast('That did not work. Try again.'); });
        });
      }
    }
  });

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
  /* Одна ссылка на игру везде: и в «поделиться», и в строке адреса во
     время игры — /?g=<id> на том же домене, где открыта лента. */
  function shareURL(g) {
    var host = /(^|\.)plair\.pro$/.test(location.hostname) ? location.origin : 'https://plair.pro';
    return host + '/?g=' + encodeURIComponent(g.id);
  }
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
        : '<a class="g-sh is-' + n[0] + '" data-g="' + i + '" href=""' + esc(shareHref(n[0], g)) + '" target="_blank" rel="noopener" ' +
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
    if (copy) { countShare(games[Number(copy.dataset.copy)]); copyLink(copy.classList.contains('is-copy') ? copy : null, games[Number(copy.dataset.copy)]); return; }
    var insta = t.closest && t.closest('[data-insta]');
    if (insta) {
      var g = games[Number(insta.dataset.insta)];
      countShare(g);
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
    var net = t.closest && t.closest('a.g-sh[data-g]');
    if (net) countShare(games[Number(net.dataset.g)]);
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
    session = null; meUser = null; pending = 0;
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

  /* Число рядом со значком: запуски, лайки, комментарии, сохранения.
     Пишем всегда, и ноль тоже, — чтобы было видно, что тут считают. */
  function numHTML(g, k) {
    return '<span class="g-act-n" data-n="' + k + '" data-id="' + esc(g.id) + '">' + compact(g[k]) + '</span>';
  }
  function drawNums(g) {
    if (!g) return;
    [].forEach.call(document.querySelectorAll('[data-n]'), function (el) {
      if (el.getAttribute('data-id') === g.id) el.textContent = compact(g[el.getAttribute('data-n')]);
    });
  }

  /* Сколько раз игру запускали. Тап по значку тоже запускает игру. */
  var ICON_PLAYS = '<svg class="g-line" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4A.8.8 0 0 0 8 5.6z"/></svg>';
  function playsHTML(i) {
    if (!COUNTS) return '';
    var g = games[i];
    return '<button class="g-act g-plays" type="button" data-play="' + i + '" ' +
      'aria-label="Play ' + esc(g.title) + ', ' + compact(g.plays) + ' plays">' + ICON_PLAYS + numHTML(g, 'plays') + '</button>';
  }

  function talkHTML(i) {
    if (!COUNTS) return '';
    var g = games[i];
    return '<button class="g-act g-talk" type="button" data-talk="' + i + '" ' +
      'aria-label="Comments on ' + esc(g.title) + '">' + ICON_TALK + numHTML(g, 'comments') + '</button>';
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
    var g = games[i], on = !!liked[g.id];
    return '<button class="g-act g-like' + (on ? ' is-on' : '') + '" type="button" data-like="' + i + '" ' +
      'aria-pressed="' + on + '" aria-label="Like ' + esc(g.title) + '">' + ICON_HEART + numHTML(g, 'likes') + '</button>';
  }

  function drawLike(g) {
    var on = !!liked[g.id];
    drawNums(g);
    [].forEach.call(document.querySelectorAll('[data-like]'), function (b) {
      if (games[Number(b.dataset.like)] !== g) return;
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

  /* ── избранное ───────────────────────────────────────── */
  /* Закладка под игрой. Без входа предлагает войти: список хранится на
     сервере, чтобы был виден на любом устройстве. */
  var savedList = [];
  var listView = null;   // чужой (или свой) PLAIR-лист по ссылке ?list=<код>

  function openList(code) {
    if (!COUNTS || !/^[A-Za-z0-9]{8,12}$/.test(code)) return Promise.resolve();
    return fetch(COUNTS + '/lists/' + code).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) { toast('That list is no longer available'); closeList(); return; }
      listView = { code: code, owner: d.owner, ids: d.games };
      renderFilters(); renderFeed();
    }).catch(function () {});
  }

  function closeList() {
    listView = null;
    try {
      var u = new URL(location.href);
      if (u.searchParams.get('list')) {
        u.searchParams.delete('list');
        history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      }
    } catch (e) {}
    renderFilters(); renderFeed();
  }

  function shareMyList(btn) {
    if (!meUser) { accountSheet('Sign in to save games and share them as a list.'); return; }
    if (btn) btn.disabled = true;
    api('/lists', { method: 'POST' }).then(function (d) {
      if (!d.ok) throw new Error('list');
      var url = (/(^|\.)plair\.pro$/.test(location.hostname) ? location.origin : 'https://plair.pro') + '/?list=' + d.code;
      var title = meUser.name + '’s PLAIR list';
      if (navigator.share && matchMedia('(pointer:coarse)').matches) {
        navigator.share({ title: title, text: title + ' — games worth a try', url: url }).catch(function () {});
      } else {
        copyText(url).then(function () { toast('Link to your list copied'); }, function () { toast(url); });
      }
    }).catch(function () { toast('That did not work. Try again.'); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  var ICON_SAVE = '<svg class="g-line" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M7 3.8h10a1.2 1.2 0 0 1 1.2 1.2v15.2L12 16.3l-6.2 3.9V5A1.2 1.2 0 0 1 7 3.8z"/></svg>';

  function saveHTML(i) {
    if (!COUNTS) return '';
    var g = games[i], on = savedList.indexOf(g.id) !== -1;
    return '<button class="g-act g-save' + (on ? ' is-on' : '') + '" type="button" data-save="' + i + '" ' +
      'aria-pressed="' + on + '" aria-label="' + (on ? 'Remove from saved' : 'Save') + ' ' + esc(g.title) + '">' +
      ICON_SAVE + numHTML(g, 'saves') + '</button>';
  }

  function drawSaves() {
    [].forEach.call(document.querySelectorAll('[data-save]'), function (b) {
      var g = games[Number(b.dataset.save)], on = !!g && savedList.indexOf(g.id) !== -1;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    games.forEach(drawNums);
  }

  function loadSaves() {
    if (!meUser || !COUNTS) { savedList = []; drawSaves(); return Promise.resolve(); }
    return api('/saves').then(function (d) {
      savedList = d.ok ? d.saved : [];
      drawSaves();
      renderFilters();
      if (order === 'saved') renderFeed();
    }).catch(function () {});
  }

  function toggleSave(g, btn) {
    if (!meUser) { accountSheet('Sign in to save games. Your list follows you to any device.'); return; }
    var on = savedList.indexOf(g.id) === -1;
    if (on) savedList.unshift(g.id); else savedList = savedList.filter(function (x) { return x !== g.id; });
    g.saves = Math.max(0, (Number(g.saves) || 0) + (on ? 1 : -1));
    drawSaves();
    if (on && btn) { btn.classList.remove('is-pop'); void btn.offsetWidth; btn.classList.add('is-pop'); }
    toast(on ? 'Saved' : 'Removed from saved');
    if (order === 'saved') renderFilters();
    api('/saves', { method: 'POST', body: { game: g.id, on: on } }).then(function (d) {
      if (!d.ok) throw new Error('save');
      if (!on && order === 'saved') renderFeed();
    }).catch(function () {
      if (on) savedList = savedList.filter(function (x) { return x !== g.id; }); else savedList.unshift(g.id);
      g.saves = Math.max(0, (Number(g.saves) || 0) + (on ? -1 : 1));
      drawSaves();
      toast('No connection — not saved');
    });
  }

  function drawTalk(g) {
    drawNums(g);
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
      box.innerHTML = ps.indexOf('google') !== -1
        ? '<p class="g-c-ask">Sign in to join the conversation.</p><div class="g-auth">' +
          // GitHub — только для авторов, в форме «+»; в комментариях — Google.
          (ps.indexOf('google') !== -1 ? '<div class="g-gbtn" id="c-google"></div>' : '') +

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
      drawWho();
      if (talk && open === talk.s) { drawBox(); reloadList(); }
      if (open && open.querySelector('.is-account')) accountSheet();
      loadPending();
      loadSaves();
      toast('Signed in as ' + d.user.name);
      setTimeout(flushScores, 1200);
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
    if ((el = t.closest('[data-save]'))) { closeShares(); toggleSave(games[Number(el.dataset.save)], el); return; }
    if ((el = t.closest('[data-list-close]'))) { closeList(); return; }
    if ((el = t.closest('[data-list-share]'))) { shareMyList(el); return; }
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
    if (!im || im.tagName !== 'IMG') return;
    if (im.classList.contains('g-who-img')) {
      var sp = document.createElement('span');
      sp.className = 'g-who-img';
      sp.textContent = String((meUser && meUser.name) || '?').trim().slice(0, 1).toUpperCase();
      im.replaceWith(sp);
      return;
    }
    if (!im.classList.contains('g-c-ava')) return;
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
      '<button class="g-x g-trophy" type="button" data-board aria-label="Leaderboard" hidden>' + ICON_TROPHY + '</button>' +
      '<button class="g-x" type="button" data-full aria-label="Fill the screen">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      (games.indexOf(g) !== -1 && !opts.preview ? shareHTML(games.indexOf(g), 'bar') : '') +
      '</div><div class="g-stage" id="stage"></div>' +
      '<div class="g-score" id="g-score" role="status" aria-live="polite" hidden></div>';
    p.__g = g; p.__preview = !!opts.preview;
    document.body.appendChild(p);
    document.body.style.overflow = 'hidden';
    player = p;
    if (!opts.noHash) {
      var pu = new URL(location.href);
      pu.searchParams.set('g', g.id);
      pu.searchParams.delete('c');
      pu.hash = '';
      history.pushState({ play: g.id }, '', pu.pathname + pu.search);
    }
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
    if (!opts.preview) clockStart(g);

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
    clockStop(true);
    killFrames(player);
    player.remove();
    player = null;
    if (!open) document.body.style.overflow = '';
    if (history.state && history.state.play) history.back();
  }

  /* ── рекорды и вызовы (PLAIR SDK) ────────────────────── */
  /* Игра с sdk.js шлёт ленте «hello» и счёт каждой партии. Лента хранит
     лучший результат, показывает место в таблице и делает ссылку
     «побей мой рекорд». Вызов друга игра получает обратно, если хочет
     его показать (PLAIR.onChallenge). Принимаем сообщения только от окна
     той игры, что сейчас открыта. */
  var ICON_TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M9 20h6" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var duel = null;          // {code, game, score, name, lower} — пришли по ссылке друга
  var scoreTimer = 0;

  function num(v) {
    var n = Number(v);
    return Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : String(Math.round(n * 100) / 100);
  }
  function frameWin() { var f = player && player.querySelector('iframe'); return f ? f.contentWindow : null; }

  addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.plair !== 1 || !player || !e.source || e.source !== frameWin()) return;
    var g = player.__g;
    if (d.type === 'hello') return sdkHello(g);
    if (d.type === 'score') return sdkScore(g, Number(d.value), !!d.lower);
  });

  function sdkHello(g) {
    var t = player && player.querySelector('[data-board]');
    if (t && !player.__preview) t.hidden = false;
    if (player.__preview) { scorePanel('<p class="g-score-h good">PLAIR SDK connected</p>' +
      '<p class="g-score-note">Finish a round — the score shows up here.</p>', 6000); return; }
    if (duel && duel.game === g.id) {
      try {
        frameWin().postMessage({ plair: 1, type: 'challenge',
          challenge: { score: duel.score, name: duel.name, lowerIsBetter: duel.lower } }, '*');
      } catch (err) {}
    }
  }

  function scorePanel(html, hideAfter) {
    var box = player && player.querySelector('#g-score');
    if (!box) return;
    box.innerHTML = '<button class="g-score-x" type="button" data-score-close aria-label="Hide">&times;</button>' + html;
    box.hidden = false;
    clearTimeout(scoreTimer);
    if (hideAfter) scoreTimer = setTimeout(function () { if (!box.matches(':hover, :focus-within')) box.hidden = true; }, hideAfter);
  }

  function sdkScore(g, v, lower) {
    if (!isFinite(v)) return;
    if (player.__preview) {
      scorePanel('<p class="g-score-h good">Score received: ' + num(v) + '</p>' +
        '<p class="g-score-note">In the feed it goes to the leaderboard. Your game is ready for challenges.</p>', 8000);
      return;
    }
    if (!COUNTS || !g || !g.id) return;
    if (!meUser) { guestScore(g, v, lower); return; }
    api('/score', { method: 'POST', body: { id: g.id, visitor: visitor(), value: v, lower: lower } }).then(function (d) {
      if (!d.ok || !player || player.__g !== g) return;
      var head = '';
      if (duel && duel.game === g.id) {
        var won = d.lower ? v < duel.score : v > duel.score;
        head = won ? 'You beat ' + esc(duel.name || 'your friend') + '&rsquo;s ' + num(duel.score) + '!'
          : num(duel.score) + ' to beat ' + esc(duel.name || 'your friend') + ' &mdash; try again';
      } else if (d.improved && !d.first) head = 'New best!';
      var hint = '';
      try {
        if (!localStorage.getItem('plair-score-hint')) {
          localStorage.setItem('plair-score-hint', '1');
          hint = '<p class="g-score-note">Only your best score counts.</p>';
        }
      } catch (e) {}
      scorePanel((head ? '<p class="g-score-h' + (/beat|best/i.test(head) && head.indexOf('try') === -1 ? ' good' : '') + '">' + head + '</p>' : '') +
        '<p class="g-score-big">' + num(v) + '</p>' +
        '<p class="g-score-meta">Best ' + num(d.best) + ' &middot; #' + d.rank + ' of ' + d.total + '</p>' +
        '<div class="g-score-acts"><button class="g-c-post" type="button" data-duel-make="' + esc(String(d.best)) + '">Challenge a friend</button>' +
        '<button class="g-link" type="button" data-board>Leaderboard</button></div>' + hint, 9000);
    }).catch(function () {});
  }

  /* Гость: счёт партии видно, вызов другу работает, но записываем рекорд
     только после входа. Лучший счёт до входа помним в этой вкладке и
     отправляем, как только человек войдёт. */
  var PENDING_KEY = 'plair-pending-scores';
  function pendingScores() { try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function guestScore(g, v, lower) {
    var all = pendingScores(), was = all[g.id];
    if (!was || (lower ? v < was.v : v > was.v)) all[g.id] = { v: v, lower: lower };
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(all)); } catch (e) {}
    var best = all[g.id].v, head = '';
    if (duel && duel.game === g.id) {
      var won = lower ? v < duel.score : v > duel.score;
      head = won ? 'You beat ' + esc(duel.name || 'your friend') + '&rsquo;s ' + num(duel.score) + '!'
        : num(duel.score) + ' to beat ' + esc(duel.name || 'your friend') + ' &mdash; try again';
    }
    scorePanel((head ? '<p class="g-score-h' + (head.indexOf('try') === -1 ? ' good' : '') + '">' + head + '</p>' : '') +
      '<p class="g-score-big">' + num(v) + '</p>' +
      '<p class="g-score-note">Sign in with Google to save your best and get on the leaderboard.</p>' +
      '<div class="g-score-acts"><button class="g-c-post" type="button" data-score-signin>Sign in to save</button>' +
      '<button class="g-link" type="button" data-duel-make="' + esc(String(best)) + '">Challenge a friend</button></div>', 12000);
  }
  function flushScores() {
    if (!meUser || !COUNTS) return;
    var all = pendingScores(), ids = Object.keys(all);
    if (!ids.length) return;
    try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {}
    ids.forEach(function (id) {
      api('/score', { method: 'POST', body: { id: id, visitor: visitor(), value: all[id].v, lower: all[id].lower } })
        .catch(function () {});
    });
    toast('Your score is saved');
  }

  function showBoard(g) {
    scorePanel('<p class="g-score-h">Leaderboard</p><p class="g-score-note busy">Loading&hellip;</p>');
    api('/board?game=' + encodeURIComponent(g.id) + '&visitor=' + visitor()).then(function (d) {
      if (!player || player.__g !== g) return;
      if (!d.ok) throw new Error('board');
      var rows = d.top.map(function (r, i) {
        return '<li class="' + (r.me ? 'is-me' : '') + '"><span>' + (i + 1) + '</span><b>' + esc(r.name) + '</b><i>' + num(r.best) + '</i></li>';
      }).join('');
      var me = d.mine && !d.top.some(function (r) { return r.me; })
        ? '<li class="is-me"><span>' + d.mine.rank + '</span><b>You</b><i>' + num(d.mine.best) + '</i></li>' : '';
      scorePanel('<p class="g-score-h">Leaderboard &middot; ' + d.total + (d.total === 1 ? ' player' : ' players') + '</p>' +
        (rows ? '<ol class="g-board">' + rows + me + '</ol>' : '<p class="g-score-note">No scores yet &mdash; finish a round to be first.</p>') +
        '<p class="g-score-note">' + (d.lower ? 'Lower is better. ' : '') + 'Best score per signed-in player.' +
          (meUser ? '' : ' Sign in with Google to get on the board.') + '</p>' +
        (meUser ? '' : '<div class="g-score-acts"><button class="g-c-post" type="button" data-score-signin>Sign in</button></div>'));
    }).catch(function () { scorePanel('<p class="g-score-note bad">The leaderboard did not load.</p>', 4000); });
  }

  function makeDuel(g, best) {
    api('/duel', { method: 'POST', body: { id: g.id, visitor: visitor(), value: Number(best) } }).then(function (d) {
      if (!d.ok) throw new Error('duel');
      var link = shareURL(g) + '&duel=' + d.code;
      var text = 'I scored ' + num(best) + ' in ' + g.title + ' on PLAIR — can you beat it?';
      countShare(g);
      if (navigator.share && matchMedia('(pointer:coarse)').matches) {
        navigator.share({ title: g.title, text: text, url: link }).catch(function () {});
      } else {
        copyText(text + ' ' + link).then(function () { toast('Challenge link copied — send it to a friend'); },
          function () { toast(link); });
      }
    }).catch(function () { toast('That did not work. Try again.'); });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-board],[data-duel-make],[data-score-close],[data-score-signin]');
    if (!el || !player) return;
    var g = player.__g;
    if (el.hasAttribute('data-score-signin')) {
      quit();
      accountSheet('Sign in to save your best scores and get on leaderboards.');
      return;
    }
    if (el.hasAttribute('data-score-close')) { player.querySelector('#g-score').hidden = true; return; }
    if (el.hasAttribute('data-duel-make')) { makeDuel(g, el.getAttribute('data-duel-make')); return; }
    var box = player.querySelector('#g-score');
    if (el.classList.contains('g-trophy') && box && !box.hidden && box.querySelector('.g-board')) { box.hidden = true; return; }
    showBoard(g);
  });

  /* Пришли по ссылке «побей мой рекорд»: показываем вызов на карточке игры. */
  function openDuel(code) {
    if (!COUNTS || !/^[A-Za-z0-9]{8,12}$/.test(code)) return;
    fetch(COUNTS + '/duel/' + code).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) return;
      duel = { code: code, game: d.game, score: d.score, name: d.name, lower: d.lower };
      drawDuel();
      toast((d.name || 'A friend') + ' challenged you: beat ' + num(d.score));
    }).catch(function () {});
  }
  function drawDuel() {
    if (!duel) return;
    [].forEach.call(document.querySelectorAll('.g-slide[data-id="' + duel.game + '"] .g-info'), function (info) {
      if (info.querySelector('.g-duel')) return;
      info.insertAdjacentHTML('afterbegin', '<p class="g-duel">' + esc(duel.name || 'A friend') + ' scored <b>' +
        num(duel.score) + '</b> &mdash; ' + (duel.lower ? 'go faster' : 'beat it') + '</p>');
    });
  }

  /* ── события ─────────────────────────────────────────── */

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest(
      '[data-qclear],[data-tag],[data-order],[data-play],[data-pick],[data-close],[data-quit],[data-full],[data-more],' +
      '#how,#who,#submit-open,#empty-go,#empty-how');
    if (!el) return;

    if (el.dataset.tag) { filter = el.dataset.tag; renderFilters(); renderFeed(); return; }
    if (el.dataset.qclear !== undefined) { setQuery(''); $('q').focus(); return; }
    if (el.dataset.order) {
      if (listView) { listView = null; try { var lu = new URL(location.href); lu.searchParams.delete('list'); history.replaceState(history.state, '', lu.pathname + lu.search + lu.hash); } catch (e2) {} }
      order = el.dataset.order;
      renderFilters(); renderFeed(); return;
    }
    if (el.dataset.more !== undefined) {
      var box = el.closest('.g-info');
      if (!box.classList.contains('has-more')) return;
      var on = box.classList.toggle('is-open');
      [].forEach.call(box.querySelectorAll('[data-more]'), function (b) { b.setAttribute('aria-expanded', on ? 'true' : 'false'); });
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

    if (el.id === 'how') { howSheet(); return; }
    if (el.id === 'empty-how') { howSheet(); return; }
    if (el.id === 'who') { accountSheet(); return; }
    if (el.id === 'submit-open' || el.id === 'empty-go') { submitSheet(); return; }
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
      softBacks(all[i]);
    }
  }

  /* Подсказка «свайпни» уходит, как только лентой воспользовались. */
  /* Работа на прокрутке — не чаще раза за кадр: iPad шлёт событие
     scroll до 120 раз в секунду. */
  var scrollQueued = false;
  $('feed').addEventListener('scroll', function () {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(onFeedScroll);
  }, { passive: true });
  function onFeedScroll() {
    scrollQueued = false;
    var deck = $('feed');
    if (deck.scrollTop > 24) deck.classList.add('is-moved');
    /* В ленте звучать нечему. Если проигрыватель закрыт, а кадр игры
       почему-то жив, — сносим: листать ленту под чужую музыку нельзя. */
    if (!player) killFrames(document);
    closeShares();
    warm();
  }

  addEventListener('popstate', function () { if (player) quit(); });

  /* Уходим со страницы — звук игры уходит с нами. На переключение
     вкладки не трогаем: человек вернётся к своей партии. */
  addEventListener('pagehide', function () { clockStop(); if (player) killFrames(player); });

  /* ── поиск ───────────────────────────────────────────── */

  var qTimer = 0;
  function setQuery(v, typed) {
    query = v;
    var box = $('q');
    if (!typed && box.value !== v) box.value = v;
    $('q-x').hidden = !v;
    // На телефоне поле свёрнуто — кнопка горит зелёным, пока поиск действует.
    $('q-open').classList.toggle('is-on', !!v.trim());
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

  /* Лента = наш каталог games.json + игры, присланные авторами и
     одобренные модератором (их отдаёт Worker). Если Worker молчит,
     лента всё равно показывает каталог. */
  function fetchGames() {
    var base = fetch(CATALOG + '?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : []; });
    var extra = COUNTS
      ? fetch(COUNTS + '/games').then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { return d && d.ok ? d.games : []; }).catch(function () { return []; })
      : Promise.resolve([]);
    return Promise.all([base, extra]).then(function (both) {
      var list = Array.isArray(both[0]) ? both[0] : [];
      var ids = {};
      list.forEach(function (g) { ids[g.id] = 1; });
      both[1].forEach(function (g) { if (g && g.id && !ids[g.id]) { ids[g.id] = 1; list.push(g); } });
      list.sort(byDate);
      return list;
    });
  }

  function reloadGames() {
    fetchGames().then(function (list) {
      list.forEach(function (g) {
        var old = games.filter(function (o) { return o.id === g.id; })[0];
        if (old) ['plays', 'likes', 'comments', 'saves', 'shares', 'seconds', 'skips'].forEach(function (k) { g[k] = old[k]; });
      });
      games = list;
      renderFilters();
      renderFeed();
    }).catch(function () {});
  }

  try { if (location.search || /^#play-/.test(location.hash)) history.replaceState(null, '', location.pathname); } catch (e) {}

  /* Логотип — «домой» без перезагрузки: все игры, «New», без поиска,
     без чужого списка, лента в начале. */
  function goHome() {
    if (player) quit();
    shut();
    closeShares();
    listView = null;
    order = 'fresh';
    filter = 'All';
    query = '';
    $('q').value = '';
    $('q-x').hidden = true;
    $('q-open').classList.remove('is-on');
    openSearch(false);
    try { history.replaceState(null, '', '/'); } catch (e) {}
    renderFilters();
    renderFeed();
    $('feed').scrollTop = 0;
  }
  document.querySelector('.g-brand').addEventListener('click', function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    goHome();
  });

  drawWho();
  loadMe().then(function () {
    drawWho();
    loadSaves();
    flushScores();
    loadPending().then(function () {
      // Ссылка из уведомления о новой игре: сразу открыть очередь.
      if (START.get('review') === '1') {
        if (meUser && meUser.admin) reviewSheet(); else if (!meUser) accountSheet();
      }
      // Вернулись из входа через GitHub посреди заявки — открываем её снова.
      var addUrl = START.get('add');
      if (addUrl && /^https:\/\//.test(addUrl)) submitSheet({ url: addUrl });
    });
  });
  fetchGames()
    .then(function (list) {
      games = list;
      renderFilters();
      renderFeed();
      /* Пришли по ссылке «поделиться»: ставим ленту на эту игру. */
      var want = START.get('g');
      var oldHash = START_HASH.match(/^#play-([a-z0-9-]+)$/);
      if (!want && oldHash) want = oldHash[1];
      var hit = want && [].filter.call(document.querySelectorAll('#feed .g-slide'), function (s) {
        return s.dataset.id === want;
      })[0];
      if (hit) { $('feed').scrollTop = hit.offsetTop; $('feed').classList.add('is-moved'); warm(); }
      /* Вернулись со входа (или пришли по ссылке из уведомления):
         сразу открываем комментарии этой игры. */
      var back = want && START.get('c') === '1' &&
        games.filter(function (g) { return g.id === want; })[0];
      if (back && COUNTS) talkSheet(back);
      if (authNote) authToast();
      var listCode = START.get('list');
      if (listCode) openList(listCode);
      var duelCode = START.get('duel');
      if (duelCode) openDuel(duelCode);
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
