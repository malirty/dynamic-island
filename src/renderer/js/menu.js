// Custom right-click menu for the island: glass panel in the island's style
// with quick tools, inline switches and "hide island".
import { api, state, h, icon, saveSettings, SKIN_LIST } from './core.js';

let host, root, sub = null, closeTimer = null, subTimer = null;

const TABS = [['home', 'Главная', 'home'], ['clip', 'Буфер', 'clip'], ['ai', 'ИИ', 'ai'], ['text', 'Текст', 'text'], ['notes', 'Заметки', 'notes'], ['weather', 'Погода', 'weather'], ['control', 'Центр управления', 'control']];
const HIDE = [[15, 'На 15 минут'], [30, 'На 30 минут'], [60, 'На час'], [180, 'На 3 часа'], [0, 'Пока не позову']];

function set(fn) { fn(state.settings); saveSettings(); render(); }

function item(ic, label, { kbd, onClick, chevron, danger, onEnter, inSub } = {}) {
  const el = h('button', { class: 'mi' + (danger ? ' danger' : '') },
    h('span', { class: 'mic', html: icon(ic, 16) }), h('span', { class: 'ml' }, label),
    kbd ? h('span', { class: 'mk' }, kbd) : '', chevron ? h('span', { class: 'mch', html: icon('chevron', 13) }) : '');
  if (onClick) el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  // items inside a submenu must not close it; other items close it after a short
  // delay, so moving the mouse diagonally across them doesn't kill the submenu
  el.addEventListener('mouseenter', () => { if (inSub) return; if (onEnter) onEnter(el); else closeSubSoon(); });
  return el;
}
function sw(ic, label, get, toggle) {
  const t = h('span', { class: 'msw' + (get() ? ' on' : '') });
  const el = h('button', { class: 'mi' }, h('span', { class: 'mic', html: icon(ic, 16) }), h('span', { class: 'ml' }, label), t);
  el.addEventListener('click', (e) => { e.stopPropagation(); toggle(); t.classList.toggle('on', get()); });
  el.addEventListener('mouseenter', closeSubSoon);
  return el;
}
function chips(label, options, get, setv) {
  const row = h('div', { class: 'mchips' });
  for (const [v, l] of options) row.append(h('button', { class: 'mchip' + (get() === v ? ' on' : ''), onclick: (e) => { e.stopPropagation(); setv(v); } }, l));
  const el = h('div', { class: 'mrow' }, h('div', { class: 'mlab' }, label), row);
  el.addEventListener('mouseenter', closeSubSoon);
  return el;
}
const sep = () => h('div', { class: 'msep' });

function closeSub() { clearTimeout(subTimer); sub?.remove(); sub = null; host.refresh(); }
function closeSubSoon() { clearTimeout(subTimer); if (sub) subTimer = setTimeout(closeSub, 260); }
function openSub(anchor, build) {
  clearTimeout(subTimer);
  if (sub && sub._anchor === anchor) return; // already open for this item
  closeSub();
  sub = h('div', { class: 'imenu sub hitzone' });
  sub._anchor = anchor;
  sub.addEventListener('mouseenter', () => clearTimeout(subTimer));
  build(sub);
  document.getElementById('stage').append(sub);
  const a = anchor.getBoundingClientRect(), m = root.getBoundingClientRect();
  let x = m.right - 4, y = a.top - 6;
  if (x + sub.offsetWidth > innerWidth - 8) x = m.left - sub.offsetWidth + 4; // flip to the left
  if (y + sub.offsetHeight > innerHeight - 8) y = innerHeight - 8 - sub.offsetHeight;
  sub.style.left = x + 'px'; sub.style.top = y + 'px';
  host.refresh();
}

function render() {
  if (!root) return;
  const s = state.settings;
  root.innerHTML = '';
  root.append(
    h('div', { class: 'mtools' }, ...[
      ['region', 'Скриншот', () => api.invoke('capture:start', 'region')],
      ['ocr', 'Текст', () => api.invoke('capture:start', 'ocr')],
      ['translate', 'Перевод', () => api.invoke('capture:start', 'translate')],
      ['color', 'Пипетка', () => api.invoke('capture:start', 'color')],
      ['qr', 'QR', () => api.invoke('capture:start', 'qr')],
    ].map(([ic, l, fn]) => h('button', { class: 'mtool', title: l, onclick: (e) => { e.stopPropagation(); close(); fn(); } }, h('span', { html: icon(ic, 18) }), h('span', {}, l)))),
    sep(),
    item('home', 'Открыть', { chevron: true, onEnter: (el) => openSub(el, (box) => TABS.forEach(([id, l, ic]) => box.append(item(ic, l, { inSub: true, onClick: () => { close(); host.openTab(id); } })))) }),
    item('search', 'Командная строка', { kbd: s.hotkeys.palette, onClick: () => { close(); host.palette(); } }),
    item('ai', 'Окно ИИ', { onClick: () => { close(); api.invoke('ai:window'); } }),
    sw('lyrics', 'Плеер на острове', () => s.island.showPlayer !== false, () => host.hideMusic(s.island.showPlayer === false)),
    ...(state.calls || []).flatMap((c) => [
      sw(c.micMuted ? 'micoff' : 'mic', `Микрофон в ${c.name}`, () => !c.micMuted, () => { api.invoke('calls:mic', c.id); c.micMuted = !c.micMuted; }),
      sw(c.soundMuted ? 'mute' : 'volume', `Звук звонка ${c.name}`, () => !c.soundMuted, () => { api.invoke('calls:sound', c.id); c.soundMuted = !c.soundMuted; }),
    ]),
    sep(),
    chips('Тема', [['dark', 'Тёмная'], ['light', 'Светлая']], () => s.theme.mode, (v) => set((x) => (x.theme.mode = v))),
    chips('Материал', [['mood', 'По умолчанию'], ['liquid', 'Жидкий'], ['glass', 'Стекло'], ['gradient', 'Градиент'], ['solid', 'Сплошной'], ...SKIN_LIST], () => s.theme.style, (v) => set((x) => { if (['white', 'black'].includes(x.theme.style)) x.theme.mode = x.theme.style === 'white' ? 'light' : 'dark'; x.theme.style = v; })),
    chips('Характер', [['eyes', 'Глаза'], ['cat', 'Котик'], ['bunny', 'Зайка'], ['robot', 'Робот'], ['ghost', 'Призрак'], ['alien', 'Пришелец'], ['angel', 'Ангел'], ['frog', 'Лягушка'], ['devil', 'Чертёнок'], ['buddies', 'Человечки'], ['none', 'Никого']], () => s.island.character, (v) => set((x) => (x.island.character = v))),
    sep(),
    sw('drop', 'Края как вода', () => s.theme.water !== false, () => set((x) => (x.theme.water = x.theme.water === false))),
    sw('volume', 'Волны под музыку', () => s.theme.edgeDance !== false, () => set((x) => (x.theme.edgeDance = x.theme.edgeDance === false))),
    sw('belloff', 'Не беспокоить', () => !!s.dnd, () => set((x) => (x.dnd = !x.dnd))),
    sep(),
    item('eye', 'Скрыть остров', { chevron: true, onEnter: (el) => openSub(el, (box) => {
      box.append(h('div', { class: 'mnote' }, 'Вернуть: иконка в трее или ' + (s.hotkeys.island || 'горячая клавиша')));
      HIDE.forEach(([min, l]) => box.append(item(min ? 'timer' : 'eye', l, { inSub: true, onClick: () => { close(); api.invoke('island:hide', min); } })));
    }) }),
    item('settings', 'Настройки', { onClick: () => { close(); api.invoke('settings:open'); } }),
    item('restart', 'Перезапустить', { onClick: () => api.invoke('app:relaunch') }),
    item('power', 'Выход', { danger: true, onClick: () => api.invoke('app:quit') }),
  );
}

export function openMenu(x, y) {
  close(true);
  clearTimeout(closeTimer);
  root = h('div', { class: 'imenu hitzone' });
  // a soft light inside the menu follows the pointer, like on the island
  root.addEventListener('mousemove', (e) => {
    const r = root.getBoundingClientRect();
    root.style.setProperty('--px', e.clientX - r.left + 'px');
    root.style.setProperty('--py', e.clientY - r.top + 'px');
  });
  render();
  document.getElementById('stage').append(root);
  const w = root.offsetWidth, hh = root.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, x - 12));
  const top = Math.max(8, Math.min(innerHeight - hh - 8, y + 6));
  root.style.left = left + 'px';
  root.style.top = top + 'px';
  root.style.transformOrigin = `${x - left}px ${y - top}px`;
  requestAnimationFrame(() => root?.classList.add('in'));
  setTimeout(() => host.refresh(), 420); // once the open animation has settled
  api.invoke('island:focus');
  host.refresh();
}

export function close(instant) {
  closeSub();
  if (!root) return;
  const el = root;
  root = null;
  if (instant) el.remove();
  else { el.classList.remove('in'); el.classList.add('out'); closeTimer = setTimeout(() => { el.remove(); host.refresh(); }, 180); }
  host.refresh();
}
export const isOpen = () => !!root;

export function initMenu(hostApi) {
  host = hostApi;
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root) { e.stopPropagation(); close(); } }, true);
  window.addEventListener('mousedown', (e) => { if (root && !e.target.closest('.imenu')) close(); });
}
