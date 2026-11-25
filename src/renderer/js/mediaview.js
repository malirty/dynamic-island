// A photo / video opened from Telegram (the little chat or the Telegram tab): it fills the island over
// a dark backdrop, the small preview first and the full picture as soon as it arrives. Wheel or a double
// click zooms (around the cursor), dragging moves a zoomed picture, Esc / a click beside it closes it.
import { h, icon, bus } from './core.js';

let cur = null;

// Zooming makes the picture really bigger (its size, not a stretched copy): the browser then decodes it at
// that size, so a zoomed photo stays sharp instead of getting blurry.
function sizer(img) {
  let bw = 0, bh = 0, clearT = 0;
  const EASE = 'cubic-bezier(.2, .8, .2, 1)';
  return (z, x, y, smooth) => {
    clearTimeout(clearT);
    if (z > 1.001) {
      if (!bw) { bw = img.offsetWidth; bh = img.offsetHeight; img.style.transition = 'none'; img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; img.style.width = bw + 'px'; img.style.height = bh + 'px'; void img.offsetWidth; }
      img.style.transition = smooth ? `width .3s ${EASE}, height .3s ${EASE}, transform .3s ${EASE}` : 'none';
      img.style.width = Math.round(bw * z) + 'px'; img.style.height = Math.round(bh * z) + 'px';
    } else if (bw) {
      img.style.transition = smooth ? `width .3s ${EASE}, height .3s ${EASE}, transform .3s ${EASE}` : 'none';
      img.style.width = bw + 'px'; img.style.height = bh + 'px';
      const done = () => { img.style.transition = 'none'; img.style.width = ''; img.style.height = ''; img.style.maxWidth = ''; img.style.maxHeight = ''; bw = 0; };
      if (smooth) clearT = setTimeout(done, 320); else done();
    }
    img.style.transform = `translate(${x}px, ${y}px)`;
    img.classList.toggle('zoomed', z > 1.01);
  };
}

export function closeMediaView() {
  if (!cur) return false;
  const v = cur; cur = null;
  bus.emit('viewer-close');
  window.removeEventListener('keydown', v.key, true);
  v.el.querySelector('video')?.pause();
  v.el.classList.remove('in');
  setTimeout(() => v.el.remove(), 280);
  return true;
}
export const mediaViewOpen = () => !!cur;

export async function openMediaView(host, { kind = 'photo', thumb, full, save }) {
  closeMediaView();
  const stage = h('div', { class: 'mv-stage' });
  const spin = h('div', { class: 'mv-load' }, h('i'), h('i'), h('i'));
  const bar = h('div', { class: 'mv-bar' },
    save ? h('button', { class: 'mv-btn', title: 'Сохранить на компьютер', html: icon('download', 16), onclick: (e) => { e.stopPropagation(); save(); } }) : '',
    h('button', { class: 'mv-btn', title: 'Закрыть (Esc)', html: icon('close', 16), onclick: (e) => { e.stopPropagation(); closeMediaView(); } }));
  const el = h('div', { class: 'mview' }, stage, spin, bar);
  host.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeMediaView(); } };
  window.addEventListener('keydown', key, true);
  const me = { el, key };
  cur = me;
  el.addEventListener('click', (e) => { if (e.target === el || e.target === stage) closeMediaView(); });

  if (kind === 'video' || kind === 'gif' || kind === 'round') {
    if (thumb) stage.style.backgroundImage = `url('${thumb}')`;
    const url = await full().catch(() => null);
    if (cur !== me) return;
    spin.remove();
    if (!url) { stage.append(h('div', { class: 'mv-fail' }, 'Не получилось загрузить')); return; }
    stage.style.backgroundImage = '';
    const v = h('video', { class: 'mv-video' + (kind === 'round' ? ' round' : ''), src: url, autoplay: '', playsinline: '', loop: kind === 'gif' ? '' : null, controls: kind === 'video' ? '' : null });
    v.addEventListener('click', (e) => { e.stopPropagation(); if (kind !== 'video') v.paused ? v.play() : v.pause(); });
    stage.append(v);
    return;
  }

  // a picture: zoom and pan
  const img = h('img', { class: 'mv-img' + (thumb ? ' soft' : ''), alt: '', draggable: 'false' });
  if (thumb) img.src = thumb;
  stage.append(img);
  let z = 1, x = 0, y = 0;
  const setSize = sizer(img);
  const apply = (smooth) => setSize(z, x, y, smooth);
  const zoomAt = (nz, cx, cy, smooth) => {
    nz = Math.max(1, Math.min(5, nz));
    const r = stage.getBoundingClientRect();
    const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
    // keep the point under the cursor where it is
    x = px - ((px - x) * nz) / z; y = py - ((py - y) * nz) / z; z = nz;
    if (z === 1) { x = 0; y = 0; }
    apply(smooth);
  };
  stage.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); zoomAt(z * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY, false); }, { passive: false });
  img.addEventListener('dblclick', (e) => { e.stopPropagation(); zoomAt(z > 1.01 ? 1 : 2.5, e.clientX, e.clientY, true); });
  let drag = null;
  img.addEventListener('pointerdown', (e) => { if (z <= 1.01) return; e.stopPropagation(); drag = { sx: e.clientX, sy: e.clientY, x, y }; img.setPointerCapture(e.pointerId); });
  img.addEventListener('pointermove', (e) => { if (!drag) return; x = drag.x + e.clientX - drag.sx; y = drag.y + e.clientY - drag.sy; apply(false); });
  img.addEventListener('pointerup', () => { drag = null; });
  img.addEventListener('click', (e) => e.stopPropagation());
  const url = await full().catch(() => null);
  if (cur !== me) return;
  spin.remove();
  if (!url) { if (!thumb) stage.append(h('div', { class: 'mv-fail' }, 'Не получилось загрузить')); return; }
  const pre = new Image();
  pre.onload = () => { if (cur === me) { img.src = url; img.classList.remove('soft'); bus.emit('viewer-size', { w: pre.naturalWidth, h: pre.naturalHeight }); } };
  pre.src = url;
}

// A gallery: one picture big, the arrows (or ← →) step through the rest, a counter shows where you are.
// items: [{ name, date, video, thumb: () => Promise<url>, full: () => Promise<url> }]
export function openGallery(host, items, start, { reveal, open } = {}) {
  closeMediaView();
  let i = start;
  const img = h('img', { class: 'mv-img', alt: '', draggable: 'false' });
  const play = h('button', { class: 'mv-play', title: 'Открыть видео', html: icon('play', 26) });
  const stage = h('div', { class: 'mv-stage' }, img, play);
  const count = h('span', { class: 'mv-count' });
  const cap = h('span', { class: 'mv-cap' });
  const prev = h('button', { class: 'mv-nav l', title: 'Предыдущее (←)', html: icon('back', 20) });
  const next = h('button', { class: 'mv-nav r', title: 'Следующее (→)', html: icon('chevron', 20) });
  const bar = h('div', { class: 'mv-bar' },
    open ? h('button', { class: 'mv-btn', title: 'Открыть в Windows', html: icon('window', 16), onclick: (e) => { e.stopPropagation(); open(items[i]); } }) : '',
    reveal ? h('button', { class: 'mv-btn', title: 'Показать в папке', html: icon('folder', 16), onclick: (e) => { e.stopPropagation(); reveal(items[i]); } }) : '',
    h('button', { class: 'mv-btn', title: 'Закрыть (Esc)', html: icon('close', 16), onclick: (e) => { e.stopPropagation(); closeMediaView(); } }));
  const foot = h('div', { class: 'mv-foot' }, count, cap);
  const el = h('div', { class: 'mview gallery' }, stage, prev, next, bar, foot);
  host.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  let z = 1;
  const setSize = sizer(img);
  const zoom = (nz, smooth = true) => { z = nz; setSize(z, 0, 0, smooth); };
  const show = async (k, dir = 0) => {
    i = (k + items.length) % items.length;
    const it = items[i];
    zoom(1, false);
    count.textContent = `${i + 1} из ${items.length}`;
    cap.textContent = it.date || it.name || '';
    play.style.display = it.video ? '' : 'none';
    img.classList.remove('swap-l', 'swap-r'); void img.offsetWidth;
    if (dir) img.classList.add(dir > 0 ? 'swap-r' : 'swap-l');
    const my = i;
    const t = await it.thumb().catch(() => null);
    if (my !== i || cur !== me) return;
    if (t) { img.src = t; img.classList.add('soft'); }
    if (it.video) { img.classList.remove('soft'); return; }
    const f = await it.full().catch(() => null);
    if (my !== i || cur !== me || !f) return;
    const pre = new Image();
    pre.onload = () => { if (my === i && cur === me) { img.src = f; img.classList.remove('soft'); bus.emit('viewer-size', { w: pre.naturalWidth, h: pre.naturalHeight }); } };
    pre.src = f;
    // the neighbours' previews are ready before you get there
    for (const d of [1, -1]) items[(i + d + items.length) % items.length].thumb().catch(() => {});
  };
  prev.onclick = (e) => { e.stopPropagation(); show(i - 1, -1); };
  next.onclick = (e) => { e.stopPropagation(); show(i + 1, 1); };
  play.onclick = (e) => { e.stopPropagation(); open?.(items[i]); };
  img.addEventListener('dblclick', (e) => { e.stopPropagation(); zoom(z > 1 ? 1 : 2.2); });
  img.addEventListener('click', (e) => e.stopPropagation());
  stage.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); if (e.ctrlKey || z > 1) zoom(Math.max(1, Math.min(4, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))), false); else show(i + (e.deltaY > 0 ? 1 : -1), e.deltaY > 0 ? 1 : -1); }, { passive: false });
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeMediaView(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); show(i + 1, 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); show(i - 1, -1); }
  };
  window.addEventListener('keydown', key, true);
  const me = { el, key };
  cur = me;
  el.addEventListener('click', (e) => { if (e.target === el || e.target === stage) closeMediaView(); });
  show(i);
}
