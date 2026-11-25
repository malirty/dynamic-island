// The phone tab: the phone plugged in by cable, what it can do, and the photos brought over from it.
// Drop files on the tab to send them to the phone.
import { api, bus, state, $, h, icon, bytes } from '../core.js';
import { openGallery } from '../mediaview.js';

let root, recent = [], shownFor = '';
// sending: an iPhone goes through Telegram; without it signed in, say how to fix that
async function sendTo(name, files) {
  const r = await api.invoke('phone:send', name, files);
  if (r === 'notg') bus.emit('flash', { icon: '✈️', title: 'Войди в Telegram в настройках острова — через него файлы уйдут на iPhone', ms: 3500 });
}

const PHONE_SVG = `<svg viewBox="0 0 48 64" width="46" height="62" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="32" height="54" rx="7"/><path d="M20 8h8"/></svg>`;

// the cable hangs from the phone's port and moves with it; its plug keeps reaching up to plug in
const CORD_SVG = `<svg viewBox="0 0 60 64" width="60" height="64" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <path class="ph-wire" d="M30 4 C30 22, 30 30, 30 64"/>
  <path class="ph-flow" d="M30 64 C30 30, 30 22, 30 4"/>
  <g class="ph-plug"><rect x="24" y="4" width="12" height="12" rx="3"/><path d="M27.5 4V0.5M32.5 4V0.5"/></g>
</svg>`;

async function loadRecent(name) {
  try { recent = (await api.invoke('phone:recent', name, 400)) || []; } catch { recent = []; }
  shownFor = name;
  renderPhotos();
}

const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
const thumbs = new Map(); // path -> Promise<data url>
const thumbOf = (f, size = 220) => { const k = f.path + size; if (!thumbs.has(k)) thumbs.set(k, api.invoke('phone:thumb', f.path, size).catch(() => null)); return thumbs.get(k); };
const fullOf = (f) => (/\.(heic|heif)$/i.test(f.path) ? thumbOf(f, 1800) : Promise.resolve(fileUrl(f.path)));
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function dayName(t) {
  const d = new Date(t), now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
const hhmm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function openAt(i) {
  const items = recent.map((f) => ({ name: f.name, video: f.video, date: `${dayName(f.t)}, ${hhmm(f.t)} · ${f.name}`, thumb: () => thumbOf(f, 480), full: () => fullOf(f), path: f.path }));
  openGallery(root.closest('.v-open') || root, items, i, { reveal: (it) => api.invoke('file:reveal', it.path), open: (it) => api.invoke('file:open', it.path) });
}
// previews load as the tiles scroll into view, a few at a time
let io = null;
function watchTile(tile, f) {
  if (!io) io = new IntersectionObserver((ents) => {
    for (const e of ents) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const t = e.target;
      thumbOf(t._f).then((u) => { if (u) { t.style.backgroundImage = `url('${u}')`; t.classList.add('in'); } else t.classList.add('none'); });
    }
  }, { root: $('.ph-gal', root), rootMargin: '120px' });
  tile._f = f;
  io.observe(tile);
}
let photosSig = '';
function renderPhotos() {
  const box = $('.ph-gal', root);
  if (!box) return;
  const sig = recent.map((f) => f.path).join('|');
  const cnt = $('.ph-count', root); if (cnt) cnt.textContent = recent.length ? String(recent.length) : '';
  if (sig === photosSig && box.children.length) return; // nothing new: leave it as it is (no flicker, no reload)
  photosSig = sig;
  if (io) { io.disconnect(); io = null; }
  box.innerHTML = '';
  if (!recent.length) { box.append(h('div', { class: 'ph-none' }, h('span', { html: icon('image', 26) }), 'Здесь появятся фото, перенесённые с телефона')); return; }
  let day = '', grid = null;
  recent.forEach((f, i) => {
    const dn = dayName(f.t);
    if (dn !== day) { day = dn; box.append(h('div', { class: 'ph-day' }, dn)); grid = h('div', { class: 'ph-grid' }); box.append(grid); }
    const tile = h('button', { class: 'ph-tile' + (f.video ? ' vid' : ''), title: f.name, onclick: (e) => { e.stopPropagation(); openAt(i); } },
      f.video ? h('span', { class: 'ph-play', html: icon('play', 14) }) : '');
    grid.append(tile);
    watchTile(tile, f);
  });
}

let drawnSig = '', seenPhone = '';
function render() {
  if (!root?.isConnected) return;
  const devs = state.phones || [];
  const job = (state.downloads || []).find((d) => d.phone);
  const sig = JSON.stringify([devs.map((x) => [x.name, x.apple, x.busy]), !!job, job?.name]);
  if (sig === drawnSig && root.children.length) { updateProgress(job); return; }
  drawnSig = sig;
  root.innerHTML = '';
  if (!devs.length) {
    root.append(h('div', { class: 'ph-wrap nodev' },
      h('div', { class: 'ph-hero' }, h('div', { class: 'ph-rig' }, h('div', { class: 'ph-phone wait', html: PHONE_SVG }), h('div', { class: 'ph-cord', html: CORD_SVG }))),
      h('div', { class: 'ph-title' }, 'Подключи телефон кабелем'),
      h('div', { class: 'ph-sub' }, 'Остров сам заметит его и предложит перенести новые фото и видео.'),
      h('div', { class: 'ph-tips' },
        h('div', {}, h('b', {}, 'Android'), ' — в уведомлении «USB» выбери «Передача файлов»'),
        h('div', {}, h('b', {}, 'iPhone'), ' — разблокируй и нажми «Доверять этому компьютеру»'))));
    return;
  }
  const d = devs[0];
  const busy = d.busy || (job ? 'import' : null);
  const pct = job?.total ? Math.min(100, Math.round((job.size / job.total) * 100)) : null;
  const drop = h('div', { class: 'ph-wrap' },
    h('div', { class: 'ph-card' },
      h('div', { class: 'ph-phone on' + (seenPhone !== d.name ? ' arrive' : ''), html: PHONE_SVG }),
      h('div', { class: 'ph-info' },
        h('div', { class: 'ph-name' }, d.name, h('span', { class: 'ph-dot' }), h('span', { class: 'ph-state' }, busy === 'send' ? 'отправляю…' : busy ? 'переношу…' : 'подключён')),
        job ? h('div', { class: 'ph-prog' }, h('div', { class: 'ph-bar' }, h('i', { style: `width:${pct ?? 30}%` })), h('small', {}, `${job.count || ''}${job.count ? ' · ' : ''}${bytes(job.size)}${job.total ? ' из ' + bytes(job.total) : ''}`)) : '',
        h('div', { class: 'ph-acts' },
          h('button', { class: 'btn sm pri', disabled: !!busy, onclick: (e) => { e.stopPropagation(); api.invoke('phone:import', d.name); } }, h('span', { html: icon('image', 14) }), 'Перенести фото'),
          h('button', { class: 'btn sm', disabled: !!busy, title: d.apple ? 'iPhone по кабелю файлы не принимает — отправлю в Telegram «Избранное»' : '', onclick: (e) => { e.stopPropagation(); sendTo(d.name); } }, h('span', { html: icon(d.apple ? 'telegram' : 'send', 14) }), d.apple ? 'Отправить через Telegram' : 'Отправить'),
          h('button', { class: 'ibtn', title: 'Открыть телефон в Проводнике', html: icon('window', 16), onclick: (e) => { e.stopPropagation(); api.invoke('phone:open', d.name); } }),
          h('button', { class: 'ibtn', title: 'Папка с перенесёнными фото', html: icon('folder', 16), onclick: (e) => { e.stopPropagation(); api.invoke('phone:folder', d.name); } })))),
    h('div', { class: 'ph-head' }, h('b', {}, 'Фото с телефона'), h('span', { class: 'ph-count' }), h('div', { class: 'grow' }),
      h('button', { class: 'btn sm ghost', onclick: (e) => { e.stopPropagation(); api.invoke('phone:folder', d.name); } }, h('span', { html: icon('folder', 13) }), 'Вся папка')),
    h('div', { class: 'ph-gal' }),
    h('div', { class: 'ph-drop' }, h('span', { html: icon(d.apple ? 'telegram' : 'send', 22) }), h('b', {}, 'Отпусти — отправлю на телефон'), h('small', {}, d.apple ? 'на iPhone через Telegram «Избранное»' : 'в папку «Download» на телефоне')));
  // files dropped on the tab go to the phone's Download folder
  drop.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer?.types?.includes('Files')) drop.classList.add('over'); });
  drop.addEventListener('dragleave', (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const files = [...(e.dataTransfer?.files || [])].map((f) => window.island.pathOf?.(f) || f.path).filter(Boolean);
    if (files.length) sendTo(d.name, files);
  });
  root.append(drop);
  seenPhone = d.name;
  if (shownFor !== d.name) loadRecent(d.name); else renderPhotos();
}
// the transfer's bar and numbers move without redrawing the tab
function updateProgress(job) {
  const box = root && $('.ph-prog', root);
  if (!box || !job) return;
  const pct = job.total ? Math.min(100, Math.round((job.size / job.total) * 100)) : null;
  const bar = $('.ph-bar i', box); if (bar) bar.style.width = (pct ?? 30) + '%';
  const sm = $('small', box); if (sm) sm.textContent = `${job.count || ''}${job.count ? ' · ' : ''}${bytes(job.size)}${job.total ? ' из ' + bytes(job.total) : ''}`;
}

export default {
  id: 'phone', label: 'Телефон', icon: 'phone', fixedHeight: 430,
  mount(el) {
    root = el;
    api.invoke('phone:list').then((l) => { state.phones = l; render(); }).catch(render);
    bus.on('phone-usb', () => render());
    bus.on('downloads', () => { if (root.closest('.page')?.classList.contains('on')) render(); });
    bus.on('download-done', (d) => { if (d.from === 'phone' && state.phones?.[0]) loadRecent(state.phones[0].name); });
    render();
  },
  show() { render(); if (state.phones?.[0]) loadRecent(state.phones[0].name); },
};
