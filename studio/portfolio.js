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
  const gallery = $('showcase-gallery');
  const modal = $('showcase-lightbox');
  const thumbnails = $('showcase-thumbnails');
  let current = 0, image = 0, direction = 1;
  const animations = new Map();

  const TRANSITION = 650;
  let transitioning = false;
  root.tabIndex = -1;

  function layoutGallery() {
    const ratios = projects[current].media.map((media, n) => {
      const element = spread.children[n]?.querySelector('img,video');
      return Number(media.w) / Number(media.h) || (element?.naturalWidth / element?.naturalHeight) || (element?.videoWidth / element?.videoHeight) || 1;
    });
    const boxes = portfolioLayout(ratios, spread.clientWidth, spread.clientHeight, innerWidth <= 700 ? 8 : 12);
    boxes.forEach((box, n) => Object.assign(spread.children[n].style, {
      left:box.x + 'px', top:box.y + 'px', width:box.width + 'px', height:box.height + 'px'
    }));
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
  function setImage(next) {
    image = wrap(next, projects[current].media.length);
    if (modal.open) renderModal();
  }
  function renderProject(announce = true) {
    const p = projects[current];
    copy.innerHTML = `<p class="showcase-category">${esc(p.category)}</p><h3>${esc(p.title)}</h3><p class="showcase-description">${esc(p.description)}</p>${p.note ? `<p class="showcase-note">${esc(p.note)}</p>` : ''}`;
    $('showcase-number').textContent = String(current + 1);
    $('showcase-total').textContent = `/ ${projects.length}`;
    spread.innerHTML = p.media.map((media, n) => `<button type="button" class="showcase-frame" data-image="${n}" aria-label="Открыть изображение ${n + 1}: ${esc(media.alt || p.title)}" >${mediaHTML(media)}</button>`).join('');
    image = 0;
    layoutGallery();
    spread.querySelectorAll('img,video').forEach(media => {
      media.addEventListener('load', layoutGallery, {once:true});
      media.addEventListener('loadedmetadata', layoutGallery, {once:true});
    });
    [...thumbnails.children].forEach((button, n) => button.setAttribute('aria-current', String(n === current)));
    const thumb = thumbnails.children[current];
    if (thumb) {
      const item = thumb.getBoundingClientRect(), rail = thumbnails.getBoundingClientRect();
      thumbnails.scrollTo({top:thumbnails.scrollTop + item.top - rail.top - rail.height / 2 + item.height / 2, behavior:reduced.matches ? 'auto':'smooth'});
    }
    if (announce) $('showcase-status').textContent = `Проект ${current + 1} из ${projects.length}: ${p.title}. ${p.media.length} изображения.`;
  }
  function go(next) {
    if (transitioning || wrap(next, projects.length) === current) return;
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
    };
    if (reduced.matches) finish();
    else animations.get(spread).finished.then(finish, finish);
  }

  // Колёсико мыши больше не листает проекты — оно просто прокручивает
  // страницу. Проекты переключаются стрелками, миниатюрами и клавиатурой.

  function renderModal() {
    $('showcase-lightbox-title').textContent = projects[current].title;
    $('showcase-lightbox-media').innerHTML = mediaHTML(projects[current].media[image], true);
    $('showcase-lightbox-count').textContent = `${image + 1} / ${projects[current].media.length}`;
    modal.querySelectorAll('[data-image-step]').forEach(button => button.disabled = projects[current].media.length < 2);
  }
  function openModal() { renderModal(); modal.showModal(); $('showcase-close').focus(); }
  thumbnails.innerHTML = projects.map((p,n) => {
    const media = p.media[0];
    const src = media.poster || media.src;
    return `<button type="button" data-case="${n}" aria-label="Проект ${n + 1}: ${esc(p.title)}" title="${esc(p.title)}"><img src="${esc(safe(src))}" alt="" loading="lazy"></button>`;
  }).join('');
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.caseStep) go(current + Number(button.dataset.caseStep));
    else if (button.dataset.case !== undefined) go(Number(button.dataset.case));
    else if (button.dataset.image !== undefined) {
      image = Number(button.dataset.image);
      openModal();
    }
  });
  root.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (['ArrowDown','ArrowRight'].includes(event.key)) go(current + 1);
    else if (['ArrowUp','ArrowLeft'].includes(event.key)) go(current - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(projects.length - 1);
    else return;
    event.preventDefault();
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
  new ResizeObserver(layoutGallery).observe(spread);
  renderProject(false);
})();
