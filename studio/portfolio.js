(() => {
  'use strict';
  const root = document.getElementById('studio-showcase');
  if (!root) return;
  const projects = (window.PLAIR_CASES || []).filter(p => p.media?.length);
  if (!projects.length) { root.hidden = true; return; }
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safe = value => { try { const url = new URL(value, location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const pad = n => String(n).padStart(2, '0');
  const wrap = (n, length) => (n % length + length) % length;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const copy = $('showcase-copy'), spread = $('showcase-spread'), index = $('showcase-index');
  const modal = $('showcase-lightbox');
  let current = 0, image = 0, direction = 1, pointer = null, suppressClickUntil = 0;
  const remembered = new Map();
  const animations = new Map();

  function animate(element, keyframes) {
    animations.get(element)?.cancel();
    if (!reduced.matches) animations.set(element, element.animate(keyframes, {duration:560, easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  function mediaHTML(media, full = false) {
    const label = esc(media.alt || projects[current].title);
    if (media.type === 'video') return `<video src="${esc(safe(media.src))}" ${media.poster ? `poster="${esc(safe(media.poster))}"` : ''} ${full ? 'controls' : ''} playsinline preload="metadata" aria-label="${label}"></video>`;
    // Use the original in the viewer and a supplied responsive variant on the stage.
    const widths = [800,1400].filter(w => w < Number(media.w));
    const srcset = !full && /\.webp$/i.test(media.src) && widths.length ? widths.map(w => `${media.src.replace(/\.webp$/i, '')}-${w}.webp ${w}w`).concat(`${media.src} ${media.w}w`).join(', ') : '';
    return `<img src="${esc(safe(media.src))}" alt="${label}" ${srcset ? `srcset="${esc(srcset)}" sizes="(max-width:700px) 85vw, 50vw"` : ''} decoding="async">`;
  }
  function setImage(next, focus = false) {
    image = wrap(next, projects[current].media.length);
    remembered.set(current, image);
    [...spread.children].forEach((card, n) => {
      card.dataset.active = String(n === image);
      card.setAttribute('aria-pressed', String(n === image));
      card.setAttribute('aria-label', `${n === image ? 'Увеличить' : 'Показать'} изображение ${n + 1}: ${projects[current].media[n].alt || projects[current].title}`);
      if (focus && n === image) card.focus({preventScroll:true});
    });
    $('showcase-frame-count').textContent = `Кадр ${pad(image + 1)} / ${pad(projects[current].media.length)}`;
    if (modal.open) renderModal();
  }
  function renderProject(announce = true) {
    const p = projects[current];
    copy.innerHTML = `<p class="showcase-category">${esc(p.category)}</p><h3>${esc(p.title)}</h3><p class="showcase-description">${esc(p.description)}</p>${p.note ? `<p class="showcase-note">${esc(p.note)}</p>` : ''}`;
    $('showcase-number').textContent = pad(current + 1);
    $('showcase-total').textContent = `/ ${pad(projects.length)}`;
    spread.innerHTML = p.media.map((media, n) => `<button type="button" class="showcase-frame" data-image="${n}" data-number="${pad(n + 1)}" style="--stagger:${n % 2 ? 12 : -8}px">${mediaHTML(media)}</button>`).join('');
    setImage(remembered.get(current) || 0);
    root.querySelectorAll('.showcase-neighbor').forEach(button => {
      const n = wrap(current + Number(button.dataset.caseStep), projects.length), entry = projects[n];
      const preview = entry.media[0].poster || (entry.media[0].type !== 'video' ? entry.media[0].src : '');
      button.innerHTML = `${preview ? `<img src="${esc(safe(preview))}" alt="" loading="lazy">` : ''}<span>${esc(entry.title)}</span><span class="showcase-neighbor-no">${pad(n + 1)} / ${pad(projects.length)}</span>`;
      button.setAttribute('aria-label', `${Number(button.dataset.caseStep) < 0 ? 'Предыдущий' : 'Следующий'} проект: ${entry.title}`);
    });
    [...index.children].forEach((button, n) => button.setAttribute('aria-current', String(n === current)));
    if (announce) {
      $('showcase-status').textContent = `Проект ${current + 1} из ${projects.length}: ${p.title}. ${p.media.length} изображения.`;
      animate(copy, [{opacity:0, transform:'translateY(12px)'},{opacity:1, transform:'translateY(0)'}]);
      animate(spread, [{opacity:0, transform:`translateY(${direction * 42}px) rotateX(${direction * -12}deg) scale(.94)`},{opacity:1, transform:'translateY(0) rotateX(0) scale(1)'}]);
      // Reveal only the index strip; never scroll the page to the carousel.
      const button = index.children[current];
      const bounds = button.getBoundingClientRect(), strip = index.getBoundingClientRect();
      if (bounds.left < strip.left || bounds.right > strip.right) {
        index.scrollTo({left:index.scrollLeft + bounds.left - strip.left - strip.width / 2 + bounds.width / 2, behavior:reduced.matches ? 'auto':'smooth'});
      }
    }
  }
  function go(next) {
    direction = next >= current ? 1 : -1;
    current = wrap(next, projects.length);
    renderProject();
  }
  function renderModal() {
    $('showcase-lightbox-title').textContent = projects[current].title;
    $('showcase-lightbox-media').innerHTML = mediaHTML(projects[current].media[image], true);
    $('showcase-lightbox-count').textContent = `${image + 1} / ${projects[current].media.length}`;
    modal.querySelectorAll('[data-image-step]').forEach(button => button.disabled = projects[current].media.length < 2);
  }
  function openModal() { renderModal(); modal.showModal(); $('showcase-close').focus(); }
  index.innerHTML = projects.map((p, n) => `<button type="button" data-case="${n}" aria-label="Проект ${n + 1}: ${esc(p.title)}" title="${esc(p.title)}">${pad(n + 1)}</button>`).join('');
  root.addEventListener('click', event => {
    if (event.target.closest('.showcase-spread') && performance.now() < suppressClickUntil) { event.preventDefault(); return; }
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.caseStep) go(current + Number(button.dataset.caseStep));
    else if (button.dataset.case !== undefined) go(Number(button.dataset.case));
    else if (button.dataset.image !== undefined) {
      const n = Number(button.dataset.image);
      if (n === image) openModal(); else setImage(n);
    } else if (button.id === 'showcase-expand') openModal();
  });
  root.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
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
  modal.addEventListener('close', () => { $('showcase-lightbox-media').replaceChildren(); });
  modal.addEventListener('click', event => {
    const button = event.target.closest('[data-image-step]');
    if (button) setImage(image + Number(button.dataset.imageStep));
  });
  modal.addEventListener('keydown', event => {
    if (event.target.closest('video') || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { setImage(image + (event.key === 'ArrowRight' ? 1 : -1)); event.preventDefault(); }
  });
  renderProject(false);
})();
