(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cases = (window.PLAIR_CASES || []).filter(item => Array.isArray(item.media) && item.media.length);
  const config = window.PLAIR_CONFIG || {};
  const dialog = $('contact-dialog');
  const form = $('contact-form');
  const status = $('form-status');
  const submit = $('contact-submit');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Откуда пришёл фокус. Браузеры после касания часто оставляют на
     кнопке :focus-visible, и к её рамке добавляется вторая обводка.
     Помечаем способ ввода — CSS по этой пометке прячет кольцо для
     пальца и мыши и оставляет его для клавиатуры. */
  const root = document.documentElement;
  const markInput = (kind) => { if (root.dataset.input !== kind) root.dataset.input = kind; };
  const KEY_NAV = new Set(['Tab', 'Enter', ' ', 'Escape', 'Home', 'End', 'PageUp', 'PageDown']);
  addEventListener('pointerdown', () => markInput('pointer'), { capture: true, passive: true });
  addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (KEY_NAV.has(event.key) || event.key.startsWith('Arrow')) markInput('key');
  }, { capture: true });

  const intro = $('intro-splash');
  if (intro) {
    try {
      if (reduceMotion.matches || sessionStorage.getItem('plairIntroSeen')) {
        intro.classList.add('skip');
      } else {
        sessionStorage.setItem('plairIntroSeen', '1');
        intro.addEventListener('click', () => intro.classList.add('skip'));
        intro.addEventListener('animationend', (event) => {
          if (event.animationName === 'intro-logo-dive') intro.remove();
        });
        setTimeout(() => intro.remove(), 1500);
        requestAnimationFrame(() => requestAnimationFrame(() => intro.classList.add('intro-play')));
      }
    } catch { intro.classList.add('skip'); }
  }

  const safeMedia = (value) => {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, window.location.href);
      return ['https:', 'http:', 'file:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };
  const esc = (value) => String(value == null ? '' : value)
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  // Узкие копии лежат рядом с оригиналом: имя-800.webp, имя-1400.webp.
  // Кадр подписывается на них, объявив свою натуральную ширину в `w`.
  const VARIANT_WIDTHS = [800, 1400];
  const srcsetFor = (item) => {
    const width = Number(item.w) || 0;
    if (!width || !safeMedia(item.src) || !/\.webp$/i.test(item.src)) return '';
    const base = item.src.replace(/\.webp$/i, '');
    const parts = VARIANT_WIDTHS.filter((w) => w < width).map((w) => `${base}-${w}.webp ${w}w`);
    if (!parts.length) return '';
    parts.push(`${item.src} ${width}w`);
    return parts.join(', ');
  };

  const ratio = (item) => {
    const w = Number(item.w) || 0, h = Number(item.h) || 0;
    return w > 0 && h > 0 ? w / h : 16 / 9;   // без размеров считаем кадр широким
  };

  /* Раскладка кадров идёт от пропорций, а не от их числа. flex-grow, равный
     пропорции, даёт всем кадрам ряда одну высоту, а ширину — свою, поэтому
     обрезать нечего в принципе. `cap` ограничивает высоту ряда: вертикальной
     паре запаса нужно больше, иначе два узких кадра съёживаются до марок,
     а широкому кадру сверху приходится уступить им место. */
  function rowsFor(media, narrow) {
    const isTall = (item) => ratio(item) < 1.2;
    // Кейс верстается по два кадра в ряд: два сверху, два снизу.
    // Исключение — узкий экран. Пара широких кадров рядом даёт там по
    // 170 px на кадр, и внутри уже ничего не разглядеть, поэтому на
    // телефоне широкие идут по одному, а вертикальные по-прежнему парами.
    const perRow = narrow && !media.every(isTall) ? 1 : 2;
    const rows = [];
    for (let i = 0; i < media.length; i += perRow) rows.push(media.slice(i, i + perRow));
    // Нечётный последний кадр занимает ряд целиком — так он выходит той
    // же ширины, что и ряд над ним, и строй не ломается.
    return rows.map((items) => {
      const tall = items.every(isTall);
      if (items.length === 1) return { items, cap: tall ? 460 : narrow ? 320 : 400 };
      return { items, cap: tall ? 430 : 300 };
    });
  }

  function frameHTML(item, entry, lift) {
    const src = safeMedia(item.src);
    if (!src) return '';
    const alt = esc(item.alt || entry.title);
    if (item.type === 'video') {
      return `<figure style="--ar:${ratio(item).toFixed(3)}"><video src="${esc(src)}" poster="${esc(safeMedia(item.poster))}"
        controls playsinline preload="metadata" aria-label="${alt}"></video></figure>`;
    }
    const srcset = srcsetFor(item);
    const dims = Number(item.w) > 0 && Number(item.h) > 0 ? ` width="${item.w}" height="${item.h}"` : '';
    return `<figure style="--ar:${ratio(item).toFixed(3)};--lift:${lift}px"><img src="${esc(src)}" alt="${alt}"${dims}
      ${srcset ? `srcset="${esc(srcset)}" sizes="(max-width: 980px) 92vw, 46vw"` : ''}
      loading="lazy" decoding="async"></figure>`;
  }

  function collageHTML(entry, narrow) {
    const wash = safeMedia(entry.media[0].src);
    const rows = rowsFor(entry.media, narrow).map((row) => {
      const sum = row.items.reduce((acc, item) => acc + ratio(item), 0);
      return `<div class="collage-row" style="--sum:${sum.toFixed(3)};--cap:${row.cap}px">
        ${row.items.map((item, i) => frameHTML(item, entry, 26 + i * 12)).join('')}</div>`;
    }).join('');
    return `<div class="collage">
      ${wash ? `<div class="collage-wash-box"><img class="collage-wash" src="${esc(wash)}" alt="" aria-hidden="true"></div>` : ''}${rows}</div>`;
  }

  const track = $('cases');
  const narrowQuery = window.matchMedia('(max-width: 980px)');
  const dotsBox = $('case-dots');
  const live = $('case-live');
  let at = 0;

  function renderCases() {
    if (!track || !cases.length) return;
    const narrow = narrowQuery.matches;
    track.innerHTML = cases.map((entry, i) => `
      <section class="case" role="group" aria-roledescription="слайд"
               aria-label="${i + 1} из ${cases.length}: ${esc(entry.title)}">
        <article class="case-card">
          <div class="case-text">
            <div class="case-copy">
              <h3>${esc(entry.title)}</h3>
              <p class="case-cat">${esc(entry.category)}</p>
              <p class="case-desc">${esc(entry.description)}</p>
              ${entry.note ? `<p class="case-desc">${esc(entry.note)}</p>` : ''}
            </div>
            <div class="case-nav">
              <span class="case-no">${pad(i + 1)} / ${pad(cases.length)}</span>
              <button class="arrow" type="button" data-step="-1" aria-label="Предыдущий проект"
                      aria-controls="cases">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4m7-7-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
              <button class="arrow" type="button" data-step="1" aria-label="Следующий проект"
                      aria-controls="cases">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            </div>
          </div>
          <div class="tilt">${collageHTML(entry, narrow)}</div>
        </article>
      </section>`).join('');

    if (dotsBox && !dotsBox.children.length) {
      dotsBox.innerHTML = cases.map((entry, i) =>
        `<button class="dot" type="button" role="tab" data-go="${i}" aria-selected="${i === 0}"
                 aria-label="Проект ${i + 1}: ${esc(entry.title)}"></button>`).join('');
      dotsBox.addEventListener('click', (event) => {
        const button = event.target.closest('[data-go]');
        if (button) goTo(Number(button.dataset.go));
      });
    }
    watch();
    bindTilt();
    goTo(at, 'auto');
  }

  /* Наклон коллажа под курсором.
     Курсор задаёт два угла, коллаж поворачивается, кадры внутри
     приподнимаются над подложкой — карточка перестаёт быть плоской.
     Слушаем только там, где курсор настоящий: на тач-экранах наводить
     нечем, а на «уменьшить движение» эффект выключен совсем. */
  const MAX_TILT = 8;
  function bindTilt() {
    if (reduceMotion.matches) return;
    if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    track.querySelectorAll('.tilt').forEach((box) => {
      const collage = box.querySelector('.collage');
      if (!collage || box.dataset.tilt === '1') return;
      box.dataset.tilt = '1';
      let frame = 0;
      const rest = () => {
        cancelAnimationFrame(frame);
        box.classList.remove('is-live');
        collage.style.transform = '';
      };
      box.addEventListener('pointermove', (event) => {
        if (event.pointerType !== 'mouse') return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const r = collage.getBoundingClientRect();
          if (!r.width || !r.height) return;
          const ry = ((event.clientX - r.left) / r.width - .5) * 2 * MAX_TILT;
          const rx = -((event.clientY - r.top) / r.height - .5) * 2 * MAX_TILT;
          box.classList.add('is-live');
          collage.style.transform = `rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg)`;
        });
      });
      box.addEventListener('pointerleave', rest);
      box.addEventListener('pointercancel', rest);
      // Пока лента едет, наклон только мешает целиться.
      track.addEventListener('scroll', rest, { passive: true });
    });
  }

  function goTo(index, behavior) {
    const slides = track.children;
    const total = slides.length;
    if (!total) return;
    // Лента замкнута: после последнего проекта снова первый, и наоборот.
    // Стрелки поэтому никогда не гаснут.
    const next = ((index % total) + total) % total;
    // Перескок через край (и прыжок по точке на другой конец ленты) делаем
    // мгновенно: плавная прокрутка через десяток кейсов длится вечность.
    const far = Math.abs(next - at) > 2;
    at = next;
    const slide = slides[at];
    // Прокручиваем саму ленту, а не страницу: scrollIntoView увёл бы экран вниз.
    // Смещение считаем от самой ленты — offsetLeft отсчитывается от другого
    // предка и промахивается мимо слайда на ширину поля страницы.
    const shift = slide.getBoundingClientRect().left - track.getBoundingClientRect().left;
    track.scrollTo({ left: track.scrollLeft + shift - (track.clientWidth - slide.clientWidth) / 2,
                     behavior: behavior || (reduceMotion.matches || far ? 'auto' : 'smooth') });
    setActive(at);
  }

  function setActive(index) {
    at = index;
    if (dotsBox) Array.from(dotsBox.children).forEach((dot, i) =>
      dot.setAttribute('aria-selected', String(i === index)));
    if (live) live.textContent = `Проект ${index + 1} из ${cases.length}: ${cases[index].title}.`;
  }

  // Активным считаем слайд, который занял больше половины ленты: так индикатор
  // не врёт при перелистывании пальцем, а не кнопкой.
  let observer = null;
  function watch() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.55) {
          setActive(Array.prototype.indexOf.call(track.children, entry.target));
        }
      });
    }, { root: track, threshold: [0.55, 0.9] });
    Array.from(track.children).forEach((slide) => observer.observe(slide));
  }

  if (track) track.addEventListener('click', (event) => {
    const button = event.target.closest('[data-step]');
    if (button) goTo(at + Number(button.dataset.step));
  });
  // Слушаем весь раздел, а не только ленту: после клика стрелка мыши оставляет
  // фокус на кнопке, и нажатие клавиши до ленты бы не дошло.
  const portfolio = document.getElementById('portfolio');
  if (portfolio) portfolio.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { goTo(at - 1); event.preventDefault(); }
    if (event.key === 'ArrowRight') { goTo(at + 1); event.preventDefault(); }
    if (event.key === 'Home') { goTo(0); event.preventDefault(); }
    if (event.key === 'End') { goTo(cases.length - 1); event.preventDefault(); }
  });
  narrowQuery.addEventListener('change', renderCases);
  renderCases();

  const tickerRow = $('ticker-row');
  const ticker = $('ticker');
  const tickerStop = $('ticker-stop');
  if (tickerRow && cases.length) {
    // Дублируем список: анимация сдвигает ленту ровно на половину и замыкается.
    const line = cases.map((entry) => `<span>${esc(entry.title)}</span>`).join('');
    tickerRow.innerHTML = line + line;
  }
  // Кнопка «стоп» одинаково устроена у строки с проектами и у ленты
  // логотипов, поэтому обработчик один на двоих.
  const wireStop = (box, button, what) => {
    if (!box || !button) return;
    button.addEventListener('click', () => {
      const paused = box.toggleAttribute('data-paused');
      button.setAttribute('aria-pressed', String(paused));
      button.setAttribute('aria-label', `${paused ? 'Запустить' : 'Остановить'} ${what}`);
    });
  };
  wireStop(ticker, tickerStop, 'бегущую строку');

  /* ── «Нас выбрали»: лента логотипов ─────────────────────────
     Логотипы лежат в content.js и уже приведены к одному серому:
     страница их не перекрашивает, чтобы разноцветные исходники не
     спорили друг с другом. Ряд печатается дважды — вторая половина
     помечена data-dupe, при «уменьшить движение» она прячется. */
  const clients = Array.isArray(window.PLAIR_CLIENTS) ? window.PLAIR_CLIENTS : [];
  const logoRow = $('logo-row');
  const logoStrip = $('logo-strip');
  const clientsBox = document.getElementById('clients');
  if (clientsBox && !clients.length) {
    clientsBox.remove();
  } else if (logoRow && clients.length) {
    const half = (dupe) => clients.map((c) => (
      `<img src="${esc(c.src)}" alt="" width="${Number(c.w) || 0}" height="${Number(c.h) || 0}"` +
      ` loading="lazy" decoding="async"${dupe ? ' data-dupe' : ''}>`
    )).join('');
    logoRow.innerHTML = half(false) + half(true);

    const list = $('clients-list');
    if (list) list.innerHTML = clients.map((c) => `<li>${esc(c.name)}</li>`).join('');

    wireStop(logoStrip, $('logo-stop'), 'ленту логотипов');
  }

  const fx = $('hero-fx');
  const hero = fx && fx.closest('.hero');
  if (fx && hero) {
    const ctx2d = fx.getContext('2d', { alpha: true });
    const ACCENT = '52,199,89';
    let dots = [], w = 0, h = 0, dpr = 1, pointer = null, alive = false, prev = 0, clock = 0;

    function build() {
      const box = hero.getBoundingClientRect();
      w = Math.round(box.width); h = Math.round(box.height);
      if (!w || !h) return;
      // На плотном экране рисуем крупнее и ужимаем стилем, иначе точки мылит.
      dpr = Math.min(2, window.devicePixelRatio || 1);
      fx.width = Math.round(w * dpr); fx.height = Math.round(h * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      const narrow = w < 700;
      const count = Math.max(narrow ? 32 : 64, Math.min(narrow ? 54 : 140, Math.round(w * h / 9200)));
      dots = Array.from({ length: count }, () => {
        const x = Math.random() * w, y = Math.random() * h;
        // hx/hy — «дом» точки. Пружина к нему держит поле от схлопывания:
        // колодец у курсора притягивает, дом возвращает.
        return { x, y, px: x, py: y, hx: x, hy: y,
          drift: Math.random() * Math.PI * 2, span: 8 + Math.random() * 22,
          vx: 0, vy: 0, r: 0.8 + Math.random() * 1.7, a: 0.34 + Math.random() * 0.46 };
      });
    }

    function draw(dt) {
      clock += dt;
      ctx2d.clearRect(0, 0, w, h);
      // Без курсора поле притягивает невидимая точка, гуляющая по фигуре
      // Лиссажу: на телефоне наведения нет, а поле должно жить.
      const well = pointer || {
        x: w * (0.5 + 0.34 * Math.sin(clock / 260)),
        y: h * (0.5 + 0.3 * Math.sin(clock / 167)),
        soft: true
      };
      const pull = well.soft ? 900 : 3400;
      const reach = well.soft ? 420 : 320;
      const damp = Math.pow(0.86, dt);

      for (const d of dots) {
        d.px = d.x; d.py = d.y;
        // Дом медленно дышит, иначе поле в покое выглядит замороженным.
        d.drift += 0.004 * dt;
        const hx = d.hx + Math.cos(d.drift) * d.span;
        const hy = d.hy + Math.sin(d.drift * 0.8) * d.span * 0.6;
        d.vx += (hx - d.x) * 0.012 * dt;
        d.vy += (hy - d.y) * 0.012 * dt;

        const dx = well.x - d.x, dy = well.y - d.y;
        const dist = Math.hypot(dx, dy);
        if (dist < reach) {
          // Смягчение в знаменателе: вплотную к центру сила иначе уходит
          // в бесконечность и точку выстреливает за экран.
          const f = pull / (dist * dist + 2200) * (1 - dist / reach);
          d.vx += (dx * f - dy * f * 0.42) * dt;
          d.vy += (dy * f + dx * f * 0.42) * dt;
        }
        d.vx *= damp; d.vy *= damp;
        const speed = Math.hypot(d.vx, d.vy);
        if (speed > 2.6) { d.vx = d.vx / speed * 2.6; d.vy = d.vy / speed * 2.6; }
        d.x += d.vx * dt; d.y += d.vy * dt;
      }

      // Хвост от прошлого положения: чем быстрее летит точка, тем он заметнее.
      ctx2d.lineCap = 'round';
      for (const d of dots) {
        const speed = Math.hypot(d.x - d.px, d.y - d.py);
        if (speed > 0.6) {
          ctx2d.strokeStyle = `rgba(${ACCENT},${Math.min(0.32, speed * 0.075) * d.a * 2})`;
          ctx2d.lineWidth = d.r * 0.9;
          ctx2d.beginPath();
          ctx2d.moveTo(d.px, d.py); ctx2d.lineTo(d.x, d.y); ctx2d.stroke();
        }
        ctx2d.fillStyle = `rgba(${ACCENT},${d.a})`;
        ctx2d.beginPath(); ctx2d.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx2d.fill();
      }
    }

    function frame(now) {
      if (!alive) return;
      // Шаг в кадрах по 60 Гц: на быстром мониторе поле не ускоряется,
      // а после фоновой вкладки точки не прыгают через пол-экрана.
      const dt = Math.min(3, (now - prev) / 16.67);
      prev = now;
      draw(dt);
      requestAnimationFrame(frame);
    }
    function run(on) {
      if (on === alive) return;
      alive = on;
      if (on) { prev = performance.now(); requestAnimationFrame(frame); }
    }

    build();
    draw(0);
    if (!reduceMotion.matches) {
      new IntersectionObserver((entries) => entries.forEach((e) => run(e.isIntersecting)),
        { threshold: 0 }).observe(hero);
      hero.addEventListener('pointermove', (event) => {
        const box = hero.getBoundingClientRect();
        pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
      });
      hero.addEventListener('pointerleave', () => { pointer = null; });
    }
    let fxTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(fxTimer);
      fxTimer = setTimeout(() => { build(); draw(0); }, 160);
    });
  }

  const ring = $('studio-ring');
  const frame = $('studio-frame');
  if (ring && frame) {
    const RING_TEXT = 'Студия основана в Иннополисе в 2024 году';
    const path = ring.querySelector('#studio-path');
    const textPath = ring.querySelector('textPath');
    const SEP = ' \u00b7 ';

    function layoutRing() {
      const w = Math.round(frame.clientWidth), h = Math.round(frame.clientHeight);
      if (!w || !h) return;
      const inset = 9, r = Math.min(26, (Math.min(w, h) - inset * 2) / 2);
      const x = inset, y = inset, W = w - inset * 2, H = h - inset * 2;
      path.setAttribute('d',
        `M${x + r},${y} H${x + W - r} A${r},${r} 0 0 1 ${x + W},${y + r} V${y + H - r}` +
        ` A${r},${r} 0 0 1 ${x + W - r},${y + H} H${x + r} A${r},${r} 0 0 1 ${x},${y + H - r}` +
        ` V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`);
      ring.setAttribute('viewBox', `0 0 ${w} ${h}`);

      // Одна фраза задаёт шаг узора. Копий нужно столько, чтобы текст покрывал
      // периметр даже когда он сдвинут на целый шаг вперёд, — тогда в момент
      // возврата смещения к нулю картинка совпадает сама с собой и стыка не видно.
      textPath.textContent = RING_TEXT + SEP;
      const unit = textPath.getComputedTextLength();
      if (!unit) return;
      const perimeter = path.getTotalLength();
      const copies = Math.ceil(perimeter / unit) + 1;
      textPath.textContent = (RING_TEXT + SEP).repeat(copies);
      ring.dataset.unit = String(unit);
      // Смещение всегда отрицательное. При положительном начало контура —
      // левый верхний угол — остаётся пустым ровно на его величину, и лента
      // там обрывается. Уехавший за начало кусок просто не рисуется.
      textPath.setAttribute('startOffset', (-unit).toFixed(2));
    }

    let offset = 0, last = 0, running = false;
    const SPEED = 26; // пикселей пути в секунду
    function step(now) {
      if (!running) return;
      const unit = Number(ring.dataset.unit) || 0;
      if (unit) {
        offset = (offset + (now - last) / 1000 * SPEED) % unit;
        textPath.setAttribute('startOffset', (offset - unit).toFixed(2));
      }
      last = now;
      requestAnimationFrame(step);
    }
    function run(on) {
      if (on === running) return;
      running = on;
      if (on) { last = performance.now(); requestAnimationFrame(step); }
    }

    layoutRing();
    // Крутим только пока блок на экране: за его пределами кадры тратятся впустую.
    if (!reduceMotion.matches) {
      new IntersectionObserver((entries) => entries.forEach((e) => run(e.isIntersecting)),
        { threshold: 0 }).observe(frame);
    }
    let ringTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(ringTimer);
      ringTimer = setTimeout(layoutRing, 160);
    });
  }

  const word = $('footer-word');
  if (word && word.getContext) {
    const wctx = word.getContext('2d');
    const ACCENT2 = '52,199,89';
    let bits = [], ww = 0, wh = 0, wdpr = 1, wptr = null, wlive = false, wprev = 0, wage = 0;

    // Маска знака — одна на всё: грузим её однажды и держим.
    let logoImg = null, logoTry = null;
    function loadLogo() {
      if (logoImg) return Promise.resolve(logoImg);
      if (logoTry) return logoTry;
      logoTry = new Promise((done) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => { logoImg = img; done(img); };
        img.onerror = () => done(null);
        img.src = '/assets/logo-mask.webp';
      });
      return logoTry;
    }

    async function buildWord() {
      const box = word.getBoundingClientRect();
      ww = Math.round(box.width); wh = Math.round(box.height);
      if (!ww || !wh) return;
      wdpr = Math.min(2, window.devicePixelRatio || 1);
      word.width = Math.round(ww * wdpr); word.height = Math.round(wh * wdpr);
      wctx.setTransform(wdpr, 0, 0, wdpr, 0, 0);

      // Раньше здесь набиралась надпись шрифтом. Теперь источник —
      // фирменный знак: та же маска, что стоит в шапке и в заставке,
      // так что в подвале собирается именно логотип, а не слово,
      // набранное похожей гарнитурой.
      const logo = await loadLogo();
      if (!logo) { bits = []; return; }

      // Знак рисуем в отдельный холст и читаем из него пиксели.
      const off = document.createElement('canvas');
      off.width = word.width; off.height = word.height;
      const octx = off.getContext('2d', { willReadFrequently: true });
      octx.setTransform(wdpr, 0, 0, wdpr, 0, 0);

      // В маске под знаком есть пустая полоса — в шапке она часть
      // лока, здесь бы просто съела низ холста. Берём только ту часть
      // картинки, где есть краска, и вписываем по меньшей стороне.
      const INK_H = 307 / 374;
      const src = { w: logo.width, h: Math.round(logo.height * INK_H) };
      // Холст выпущен за свои границы отрицательными полями — на эту
      // прибавку (--bleed) и разлетаются частицы. Сам знак вписывается
      // не в холст, а в полосу между серой линией и ссылками, иначе на
      // узком экране он вылезал бы за линию.
      const css = parseFloat(getComputedStyle(word).getPropertyValue('--bleed'));
      const bleed = Number.isFinite(css) ? css : Math.max(24, Math.min(innerWidth * 0.07, 120));
      const band = Math.max(80, wh - bleed * 2);
      // Холст во всю ширину подвала, а знак в нём — своего размера и по
      // центру: разлетаться частицам есть куда, но сам знак не растёт
      // вслед за экраном. На телефоне поля шире: там знак во всю ширину
      // упирался в края экрана.
      const maxW = ww < 700 ? ww * 0.74 : Math.min(ww * 0.92, 780);
      const k = Math.min(maxW / src.w, band * 0.92 / src.h);
      const lw = src.w * k, lh = src.h * k;
      octx.drawImage(logo, 0, 0, src.w, src.h, (ww - lw) / 2, (wh - lh) / 2, lw, lh);

      const data = octx.getImageData(0, 0, off.width, off.height).data;
      const gap = ww < 700 ? 3 : 4;
      // Наибольший отлёт частицы от центра. Сумма трёх случайных чисел
      // даёт размах от −1,5 до 1,5, поэтому делим на 1,5: иначе облако
      // начиналось бы далеко за холстом и на телефоне выглядело так,
      // будто логотип не помещается в экран.
      const outX = ww * 0.46 / 1.5;
      const outY = (band * 0.5 + bleed * 0.7) / 1.5;
      bits = [];
      for (let y = 0; y < wh; y += gap) {
        for (let x = 0; x < ww; x += gap) {
          const i = ((Math.round(y * wdpr) * off.width) + Math.round(x * wdpr)) * 4 + 3;
          if (data[i] < 130) continue;
          bits.push({
            hx: x, hy: y,
            // Старт вразброс по всей полосе. Разброс не равномерный, а
            // колоколом: сумма трёх случайных чисел сгущает россыпь к
            // середине и разрежает её к краям области — облако тает,
            // а не обрывается по линейке.
            x: ww * 0.5 + outX * (Math.random() + Math.random() + Math.random() - 1.5),
            y: wh * 0.5 + outY * (Math.random() + Math.random() + Math.random() - 1.5),
            vx: 0, vy: 0, a: 0.5 + Math.random() * 0.5, s: gap * 0.44,
            // У каждой точки своя жёсткость пружины: знак не защёлкивается
            // разом, а собирается — одни частицы приходят домой раньше,
            // другие ещё подтягиваются.
            k: 0.007 + Math.random() * 0.009
          });
        }
      }
      wage = 0;
      if (reduceMotion.matches) bits.forEach((b) => { b.x = b.hx; b.y = b.hy; });
    }

    function drawWord(dt) {
      wctx.clearRect(0, 0, ww, wh);
      // Пружина мягче и трение выше прежнего: раньше точки долетали до
      // места рывком, теперь подходят плавно и почти без отскока.
      // Плюс мягкий разгон: первую секунду тяга нарастает от нуля, иначе
      // в первый же кадр всю россыпь дёргало к знаку разом.
      const damp = Math.pow(0.80, dt);
      wage += dt;
      const warm = Math.min(1, wage / 45);
      const ease = warm * warm * (3 - 2 * warm);
      for (const b of bits) {
        if (dt) {
          b.vx += (b.hx - b.x) * b.k * ease * dt;
          b.vy += (b.hy - b.y) * b.k * ease * dt;
          if (wptr) {
            const dx = b.x - wptr.x, dy = b.y - wptr.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 110 && dist > 0.5) {
              // Отталкивание слабеет к краю зоны, иначе на её границе
              // частицы дёргаются рывком.
              const f = (1 - dist / 110) * 3.4;
              b.vx += (dx / dist) * f * dt;
              b.vy += (dy / dist) * f * dt;
            }
          }
          b.vx *= damp; b.vy *= damp;
          b.x += b.vx * dt; b.y += b.vy * dt;
        }
        wctx.fillStyle = `rgba(${ACCENT2},${b.a})`;
        wctx.fillRect(b.x, b.y, b.s, b.s);
      }
    }

    function wordFrame(now) {
      if (!wlive) return;
      const dt = Math.min(3, (now - wprev) / 16.67);
      wprev = now;
      drawWord(dt);
      requestAnimationFrame(wordFrame);
    }
    function wordRun(on) {
      if (on === wlive) return;
      wlive = on;
      if (on) { wprev = performance.now(); requestAnimationFrame(wordFrame); }
    }

    buildWord().then(() => {
      drawWord(0);
      if (reduceMotion.matches) return;
      new IntersectionObserver((entries) => entries.forEach((e) => wordRun(e.isIntersecting)),
        { threshold: 0 }).observe(word);
    });
    window.addEventListener('pointermove', (event) => {
      const box = word.getBoundingClientRect();
      const x = event.clientX - box.left, y = event.clientY - box.top;
      // Зона влияния чуть шире холста, иначе частицы у самой кромки
      // перестают реагировать ровно на границе.
      wptr = (x > -120 && x < box.width + 120 && y > -120 && y < box.height + 120)
        ? { x, y } : null;
    }, { passive: true });
    let wordTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(wordTimer);
      wordTimer = setTimeout(() => buildWord().then(() => drawWord(0)), 200);
    });
  }

  // Паук на первом экране «О студии»: грузится только там, где есть блок.
  const spiderHost = document.querySelector('.spider-fx');
  if (spiderHost && !reduceMotion.matches
      && window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
    import('/spider.js?v=27').then((m) => m.mount(spiderHost)).catch(() => {});
  }

  if (!dialog || !form) return;

  // Робота грузим ленивo: three.js весит прилично, и до первого открытия
  // формы он никому не нужен. Сбой загрузки — просто пустая полоса.
  let botLoaded = false;
  const loadBot = () => {
    if (botLoaded) return;
    botLoaded = true;
    const host = document.querySelector('.walker');
    if (!host) return;
    import('/robot.js?v=27').then((m) => m.mount(host)).catch(() => {});
  };

  /* Блокировка фона с сохранением места. Тело фиксируется и сдвигается
     вверх на текущую прокрутку — картинка не дёргается, — а при закрытии
     прокрутка возвращается ровно туда, где человек её оставил. */
  let lockedAt = 0;
  const lockScroll = () => {
    lockedAt = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = `-${lockedAt}px`;
    document.body.classList.add('dialog-open');
  };
  const unlockScroll = () => {
    document.body.classList.remove('dialog-open');
    document.body.style.top = '';
    // Плавную прокрутку на время возврата выключаем: у html включён
    // scroll-behavior:smooth, и страница уезжала бы на место анимацией
    // с нуля — человек видел бы, как сайт «долистывается» обратно.
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, lockedAt);
    root.style.scrollBehavior = prev;
  };

  const openers = Array.from(document.querySelectorAll('#contact-open,[data-contact-open]'));
  let lastOpener = null;
  openers.forEach((button) => button.addEventListener('click', () => {
    lastOpener = button;
    loadBot();
    lockScroll();
    dialog.showModal();
    // Фокус на кнопку закрытия: иначе на телефоне сразу выезжает клавиатура.
    $('contact-close').focus({ preventScroll: true });
  }));
  $('contact-close').addEventListener('click', () => dialog.close());
  // Клик мимо окна закрывает форму. Сравнивать с рамкой самого dialog нельзя:
  // он растянут на весь экран, и такая проверка не срабатывает никогда.
  dialog.addEventListener('click', (event) => {
    if (!event.target.closest('.contact-inner')) dialog.close();
  });
  dialog.addEventListener('close', () => {
    unlockScroll();
    (lastOpener || openers[0])?.focus({ preventScroll: true });
  });

  // Надпись на кнопке лежит в двух слоях: видимом и подъезжающем при наведении.
  const setSubmitLabel = (text) => {
    const face = submit.querySelector('.f1');
    const hover = submit.querySelector('.f2');
    if (face) face.textContent = text;
    if (hover && hover.firstChild) hover.firstChild.nodeValue = text;
    if (!face) submit.textContent = text;
  };

  let sending = false;
  const sendingScreen = $('form-sending');
  const fields = form.querySelector('.form-fields');
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Экран показывается не меньше секунды: при быстром ответе он иначе моргает,
  // и человек не успевает понять, что вообще произошло.
  const MIN_SENDING = 900;
  function showSending(on) {
    if (sendingScreen) sendingScreen.classList.toggle('is-on', on);
    if (fields) fields.inert = on;
    form.setAttribute('aria-busy', String(on));
  }
  /* Заявки уходят в Telegram-бота.

     Запрос идёт прямо из браузера посетителя: Bot API отвечает с
     заголовком, разрешающим обращение с чужого домена, поэтому ответ
     читается и видно точно — приняли заявку или нет. Никаких догадок по
     скрытым кадрам, как это было с почтовым сервисом.

     Токен и чат лежат в настройках (content.js) и намеренно не зашиты
     сюда: их вписывает владелец сайта. Пока их нет, форма работает
     запасным путём — предлагает написать почтой. */
  const tg = config.formService === 'telegram'
    ? { token: String(config.telegramToken || '').trim(), chat: String(config.telegramChat || '').trim() }
    : null;

  const escTg = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  async function sendToTelegram(data) {
    const lines = [
      '<b>Заявка с сайта PLAIR</b>',
      '',
      `<b>Имя:</b> ${escTg(data.name)}`,
      `<b>Контакт:</b> ${escTg(data.contact)}`,
      `<b>Бюджет:</b> ${escTg(data.budget || 'не указан')}`,
      '',
      '<b>О проекте:</b>',
      escTg(data.project)
    ];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(tg.token)}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tg.chat,
          text: lines.join('\n'),
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }),
        signal: controller.signal
      });
      const result = await response.json().catch(() => null);
      return !!(response.ok && result && result.ok === true);
    } finally {
      clearTimeout(timeout);
    }
  }

  const endpointReady = !!tg && !!tg.token && !!tg.chat;
  const emailReady = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.contactEmail || '');
  if (!endpointReady && !emailReady) {
    status.textContent = 'Форма пока не принимает заявки.';
    submit.disabled = true;
  } else if (!endpointReady) {
    status.textContent = 'Откроется почтовое приложение с текстом заявки.';
  }

  const contactInput = form.elements.contact;
  contactInput.addEventListener('input', () => {
    contactInput.setCustomValidity('');
    contactInput.removeAttribute('aria-invalid');
    $('contact-error').hidden = true;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || (!endpointReady && !emailReady)) return;
    const data = Object.fromEntries(new FormData(form).entries());
    Object.keys(data).forEach((key) => { data[key] = String(data[key]).trim(); });
    if (data._gotcha) return;
    if (!data.name || !data.project) {
      status.textContent = 'Заполните имя и описание проекта.';
      status.className = 'form-status error';
      return;
    }
    const isContact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contact)
      || /^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(data.contact)
      || /^https:\/\/t\.me\/[a-zA-Z][a-zA-Z0-9_]{4,31}\/?$/.test(data.contact);
    if (!isContact) {
      contactInput.setCustomValidity('Укажите email или Telegram в формате @username.');
      contactInput.setAttribute('aria-invalid', 'true');
      $('contact-error').hidden = false;
      contactInput.reportValidity();
      return;
    }
    if (!endpointReady) {
      const body = `Имя: ${data.name}\nКонтакт: ${data.contact}\nПримерный бюджет: ${data.budget || 'Не указан'}\n\nО проекте:\n${data.project}`;
      window.location.href = `mailto:${config.contactEmail}?subject=${encodeURIComponent('Новый проект для PLAIR')}&body=${encodeURIComponent(body)}`;
      status.textContent = 'Заявка подготовлена. Отправьте её из почтового приложения.';
      return;
    }
    sending = true;
    submit.disabled = true;
    setSubmitLabel('Отправляем…');
    status.textContent = '';
    status.className = 'form-status';
    showSending(true);
    const startedAt = Date.now();
    try {
      const delivered = await sendToTelegram(data);
      if (!delivered) throw new Error('Submission not accepted');
      status.textContent = 'Спасибо! Заявка отправлена. Скоро свяжемся с вами.';
      status.className = 'form-status success';
      form.reset();
    } catch {
      // Заявка не должна пропадать из-за чужого сервиса: текст остаётся
      // в форме, а рядом появляется ссылка, которая открывает письмо с
      // уже подставленным содержимым.
      status.textContent = 'Не удалось отправить заявку. Текст сохранён — попробуйте ещё раз или ';
      status.className = 'form-status error';
      if (emailReady) {
        const body = `Имя: ${data.name}\nКонтакт: ${data.contact}\n`
          + `Примерный бюджет: ${data.budget || 'Не указан'}\n\nО проекте:\n${data.project}`;
        const link = document.createElement('a');
        link.href = `mailto:${config.contactEmail}?subject=${encodeURIComponent('Новый проект для PLAIR')}`
          + `&body=${encodeURIComponent(body)}`;
        link.textContent = 'напишите нам почтой';
        status.appendChild(link);
      }
    } finally {
      await wait(Math.max(0, MIN_SENDING - (Date.now() - startedAt)));
      showSending(false);
      sending = false;
      submit.disabled = false;
      setSubmitLabel('Отправить');
    }
  });
})();
