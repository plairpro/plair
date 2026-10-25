(() => {
  'use strict';
  const root = document.getElementById('studio-showcase');
  if (!root) return;
  const projects = (window.PLAIR_CASES || []).filter(p => p.media?.length);
  if (!projects.length) { root.hidden = true; return; }
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safe = value => { try { const url = new URL(value, location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const wrap = (n, length) => (n % length + length) % length;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const copy = $('showcase-copy'), spread = $('showcase-spread');
  const gallery = $('showcase-gallery'), autoplay = $('showcase-autoplay');
  const modal = $('showcase-lightbox');
  const thumbnails = $('showcase-thumbnails');
  let current = 0, image = 0, direction = 1, pointer = null, suppressClickUntil = 0;
  const remembered = new Map();
  const animations = new Map();

  const INTERVAL = 5000;
  const TRANSITION = 700;
  let timer = 0, visible = false, paused = reduced.matches, keyboardFocus = false;
  let imageChanging = false;
  let transitioning = false, lastWheel = 0, wheelSum = 0, wheelConsumed = false;
  root.tabIndex = -1;

  function scheduleImage() {
    clearTimeout(timer);
    if (!visible || paused || document.hidden || modal.open || keyboardFocus || transitioning || projects[current].media.length < 2) return;
    timer = setTimeout(() => setImage(image + 1), INTERVAL);
  }
  function updateAutoplay() {
    autoplay.setAttribute('aria-pressed', String(paused));
    autoplay.setAttribute('aria-label', paused ? 'Включить смену изображений' : 'Приостановить смену изображений');
    autoplay.firstElementChild.textContent = paused ? '▷' : 'Ⅱ';
    scheduleImage();
  }

  function animate(element, keyframes) {
    animations.get(element)?.cancel();
    if (!reduced.matches) animations.set(element, element.animate(keyframes, {duration:TRANSITION, easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  function mediaHTML(media, full = false) {
    const label = esc(media.alt || projects[current].title);
    if (media.type === 'video') return `<video src="${esc(safe(media.src))}" ${media.poster ? `poster="${esc(safe(media.poster))}"` : ''} ${full ? 'controls' : ''} playsinline preload="metadata" aria-label="${label}"></video>`;
    // Use the original in the viewer and a supplied responsive variant on the stage.
    const widths = [800,1400].filter(w => w < Number(media.w));
    const srcset = !full && /\.webp$/i.test(media.src) && widths.length ? widths.map(w => `${media.src.replace(/\.webp$/i, '')}-${w}.webp ${w}w`).concat(`${media.src} ${media.w}w`).join(', ') : '';
    return `<img src="${esc(safe(media.src))}" alt="${label}" ${srcset ? `srcset="${esc(srcset)}" sizes="(max-width:700px) 85vw, 50vw"` : ''} decoding="async">`;
  }
  function setImage(next, focus = false, immediate = false) {
    const total = projects[current].media.length;
    const target = wrap(next, total);
    if (imageChanging && !immediate) return;
    const previous = spread.children[image];
    const changed = target !== image;
    const oldTransform = previous ? getComputedStyle(previous).transform : '';
    image = target;
    remembered.set(current, image);
    [...spread.children].forEach((card, n) => {
      const depth = wrap(n - image, total);
      const angle = depth === 0 ? 0 : (depth % 2 ? -1 : 1) * (3 + depth * 1.5);
      card.dataset.active = String(n === image);
      card.style.setProperty('--depth', depth);
      card.style.setProperty('--angle', `${angle}deg`);
      card.style.zIndex = String(total - depth);
      card.setAttribute('aria-pressed', String(n === image));
      card.setAttribute('aria-label', `${n === image ? 'Следующее изображение' : 'Показать изображение ' + (n + 1)}: ${projects[current].media[n].alt || projects[current].title}`);
      card.tabIndex = n === image ? 0 : -1;
      if (focus && n === image) card.focus({preventScroll:true});
    });
    if (changed && previous && !immediate && !reduced.matches) {
      imageChanging = true;
      previous.style.zIndex = String(total + 1);
      const flight = previous.animate([
        {transform:oldTransform,opacity:1},
        {transform:'translate(-35%, -8%) rotate(-12deg) scale(.92)',opacity:0,offset:.65},
        {opacity:0}
      ], {duration:650,easing:'cubic-bezier(.22,1,.36,1)'});
      const finish = () => { previous.style.zIndex = String(total - wrap(Number(previous.dataset.image) - image, total)); imageChanging = false; };
      flight.finished.then(finish, finish);
    }
    $('showcase-frame-count').textContent = `${image + 1} / ${total}`;
    if (modal.open) renderModal();
    scheduleImage();
  }
  function renderProject(announce = true) {
    const p = projects[current];
    copy.innerHTML = `<p class="showcase-category">${esc(p.category)}</p><h3>${esc(p.title)}</h3><p class="showcase-description">${esc(p.description)}</p>${p.note ? `<p class="showcase-note">${esc(p.note)}</p>` : ''}`;
    $('showcase-number').textContent = String(current + 1);
    $('showcase-total').textContent = `/ ${projects.length}`;
    spread.innerHTML = p.media.map((media, n) => `<button type="button" class="showcase-frame" data-image="${n}" >${mediaHTML(media)}</button>`).join('');
    imageChanging = false;
    setImage(remembered.get(current) || 0, false, true);
    [...thumbnails.children].forEach((button, n) => button.setAttribute('aria-current', String(n === current)));
    const thumb = thumbnails.children[current];
    if (thumb) {
      const item = thumb.getBoundingClientRect(), rail = thumbnails.getBoundingClientRect();
      thumbnails.scrollTo({top:thumbnails.scrollTop + item.top - rail.top - rail.height / 2 + item.height / 2, behavior:reduced.matches ? 'auto':'smooth'});
    }
    if (announce) $('showcase-status').textContent = `Проект ${current + 1} из ${projects.length}: ${p.title}. ${p.media.length} изображения.`;
  }
  function go(next) {
    if (transitioning || imageChanging || wrap(next, projects.length) === current) return;
    direction = next >= current ? 1 : -1;
    const restoreFocus = spread.contains(document.activeElement);
    const outgoing = reduced.matches ? null : spread.cloneNode(true);
    if (outgoing) {
      outgoing.removeAttribute('id');
      outgoing.setAttribute('aria-hidden', 'true');
      outgoing.inert = true;
      outgoing.classList.add('showcase-outgoing');
      outgoing.style.top = `${spread.offsetTop}px`;
      outgoing.style.height = `${spread.offsetHeight}px`;
      gallery.append(outgoing);
    }
    transitioning = true;
    clearTimeout(timer);
    current = wrap(next, projects.length);
    renderProject();
    if (restoreFocus) root.focus({preventScroll:true});
    animate(copy, [{opacity:0, transform:`translateY(${direction * 30}px)`},{opacity:1, transform:'translateY(0)'}]);
    animate(spread, [{opacity:0, transform:`translateY(${direction * 100}%) rotateX(${direction * -16}deg) scale(.94)`},{opacity:1, transform:'translateY(0) rotateX(0) scale(1)'}]);
    if (outgoing) animate(outgoing, [{opacity:1, transform:'translateY(0) scale(1)'},{opacity:0, transform:`translateY(${direction * -100}%) rotateX(${direction * 16}deg) scale(.94)`}]);
    const finish = () => {
      outgoing?.remove();
      if (outgoing) animations.delete(outgoing);
      transitioning = false;
      scheduleImage();
    };
    if (reduced.matches) finish();
    else animations.get(spread).finished.then(finish, finish);
  }

  // Consume one vertical wheel gesture per project. At either end, let the
  // page continue naturally; inertial events cannot skip several projects.
  root.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || modal.open || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const rect = gallery.getBoundingClientRect(), center = (rect.top + rect.bottom) / 2;
    if (center < 80 || center > innerHeight - 40) return;
    const now = performance.now();
    if (now - lastWheel > 180) { wheelSum = 0; wheelConsumed = false; }
    lastWheel = now;
    if (transitioning || imageChanging || wheelConsumed) { event.preventDefault(); return; }
    const step = Math.sign(event.deltaY);
    if ((step < 0 && current === 0) || (step > 0 && current === projects.length - 1)) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    if (Math.sign(wheelSum) !== step) wheelSum = 0;
    wheelSum += delta;
    if (Math.abs(wheelSum) >= 60) { wheelConsumed = true; go(current + step); }
  }, {passive:false});

  function renderModal() {
    $('showcase-lightbox-title').textContent = projects[current].title;
    $('showcase-lightbox-media').innerHTML = mediaHTML(projects[current].media[image], true);
    $('showcase-lightbox-count').textContent = `${image + 1} / ${projects[current].media.length}`;
    modal.querySelectorAll('[data-image-step]').forEach(button => button.disabled = projects[current].media.length < 2);
  }
  function openModal() { clearTimeout(timer); renderModal(); modal.showModal(); $('showcase-close').focus(); }
  thumbnails.innerHTML = projects.map((p,n) => {
    const media = p.media[0];
    const src = media.poster || media.src;
    return `<button type="button" data-case="${n}" aria-label="Проект ${n + 1}: ${esc(p.title)}" title="${esc(p.title)}"><img src="${esc(safe(src))}" alt="" loading="lazy"></button>`;
  }).join('');
  root.addEventListener('click', event => {
    if (event.target.closest('.showcase-spread') && performance.now() < suppressClickUntil) { event.preventDefault(); return; }
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.caseStep) go(current + Number(button.dataset.caseStep));
    else if (button.dataset.case !== undefined) go(Number(button.dataset.case));
    else if (button.dataset.image !== undefined) {
      const n = Number(button.dataset.image);
      if (n === image) setImage(image + 1); else setImage(n);
    } else if (button === autoplay) { paused = !paused; updateAutoplay(); }
  });
  root.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    keyboardFocus = true; clearTimeout(timer);
    const inGallery = event.target.closest('.showcase-gallery');
    if (inGallery && ['ArrowLeft','ArrowRight'].includes(event.key)) {
      setImage(image + (event.key === 'ArrowRight' ? 1 : -1), true);
    } else if (['ArrowDown','ArrowRight'].includes(event.key)) go(current + 1);
    else if (['ArrowUp','ArrowLeft'].includes(event.key)) go(current - 1);
    else if (event.key === 'Home') { if (inGallery) setImage(0,true); else go(0); }
    else if (event.key === 'End') { if (inGallery) setImage(projects[current].media.length-1,true); else go(projects.length-1); }
    else return;
    event.preventDefault();
  });
  // A horizontal swipe browses frames. Vertical movement remains native page scrolling.
  spread.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse') pointer = {x:event.clientX,y:event.clientY,id:event.pointerId};
  });
  spread.addEventListener('pointercancel', () => { pointer = null; });
  spread.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX-pointer.x, dy = event.clientY-pointer.y; pointer = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)*1.5) {
      setImage(image + (dx < 0 ? 1 : -1));
      suppressClickUntil = performance.now() + 400;
    }
  });
  $('showcase-close').addEventListener('click', () => modal.close());
  modal.addEventListener('close', () => { $('showcase-lightbox-media').replaceChildren(); scheduleImage(); });
  modal.addEventListener('click', event => {
    const button = event.target.closest('[data-image-step]');
    if (button) setImage(image + Number(button.dataset.imageStep));
  });
  modal.addEventListener('keydown', event => {
    if (event.target.closest('video') || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { setImage(image + (event.key === 'ArrowRight' ? 1 : -1)); event.preventDefault(); }
  });
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .5;
    scheduleImage();
  }, {threshold:[0,.5]}).observe(gallery);
  document.addEventListener('visibilitychange', scheduleImage);
  root.addEventListener('focusin', event => {
    if (event.target !== root && event.target.matches(':focus-visible')) { keyboardFocus = true; clearTimeout(timer); }
  });
  root.addEventListener('focusout', event => {
    if (!root.contains(event.relatedTarget)) { keyboardFocus = false; scheduleImage(); }
  });
  root.addEventListener('pointerdown', () => { keyboardFocus = false; scheduleImage(); });
  reduced.addEventListener('change', () => { paused = reduced.matches; updateAutoplay(); });
  renderProject(false);
  updateAutoplay();
})();
