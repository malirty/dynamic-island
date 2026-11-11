import { api, bus, state, $, h, icon, ago } from '../core.js';

let ctx, root, filter = 'all', query = '', sel = 0, shown = [];
const imgCache = new Map();

const FILTERS = [['all', 'Все'], ['pinned', 'Закреплённые'], ['text', 'Текст'], ['url', 'Ссылки'], ['image', 'Картинки'], ['file', 'Файлы'], ['color', 'Цвета']];

function match(c) {
  if (filter === 'pinned' && !c.pinned) return false;
  if (filter === 'text' && !(c.type === 'text' && c.kind === 'text')) return false;
  if (filter === 'url' && c.kind !== 'url') return false;
  if (filter === 'image' && c.type !== 'image') return false;
  if (filter === 'file' && c.type !== 'file') return false;
  if (filter === 'color' && c.kind !== 'color') return false;
  if (query) {
    const q = query.toLowerCase();
    return (c.text || '').toLowerCase().includes(q) || (c.source?.app || '').toLowerCase().includes(q) || (c.source?.title || '').toLowerCase().includes(q);
  }
  return true;
}

function sourceText(c) {
  const s = c.source;
  if (!s) return '';
  let t = s.app || s.process || '';
  if (s.title && s.title !== t) t += ' — ' + s.title.slice(0, 50);
  return t;
}

function item(c, i) {
  const isCode = c.type === 'text' && /[{};=<>]|^\s{2,}/m.test(c.text || '') && (c.text || '').includes('\n');
  const tyIcon = c.type === 'image' ? 'image' : c.type === 'file' ? 'file' : c.kind === 'url' ? 'link' : 'clip';
  const el = h('div', { class: 'clip' + (c.pinned ? ' pinned' : '') + (i === sel ? ' sel' : ''), title: 'Клик — вставить туда, где печатал' });
  el.append(c.kind === 'color' ? h('div', { class: 'sw', style: { background: c.text.startsWith('#') ? c.text : '#' + c.text } }) : h('div', { class: 'ty', html: c.pinned ? icon('pin', 15) : icon(tyIcon, 15) }));
  const body = h('div', { class: 'body' });
  if (c.type === 'image') {
    const img = h('img', { class: 'thumb' });
    if (imgCache.has(c.file)) img.src = imgCache.get(c.file);
    else api.invoke('clip:image', c.file).then((d) => { imgCache.set(c.file, d); img.src = d; });
    body.append(img);
  } else body.append(h('div', { class: 'tx' + (isCode ? ' mono' : '') }, c.type === 'file' ? c.name + '\n' + c.text : (c.text || '').slice(0, 600)));
  body.append(h('div', { class: 'meta' }, sourceText(c) ? h('span', {}, sourceText(c)) : '', h('span', {}, '·'), h('span', {}, ago(c.ts)), c.type === 'image' ? h('span', {}, `· ${c.w}×${c.h}`) : '', c.type === 'text' && c.text.length > 80 ? h('span', {}, `· ${c.text.length} симв.`) : ''));
  el.append(body);
  el.append(h('div', { class: 'tools' },
    h('button', { class: 'ibtn' + (c.pinned ? ' on' : ''), title: c.pinned ? 'Открепить' : 'Закрепить', html: icon('pin', 14), onclick: (e) => { e.stopPropagation(); api.invoke('clip:pin', c.id, !c.pinned); } }),
    h('button', { class: 'ibtn', title: 'Только скопировать', html: icon('copy', 14), onclick: (e) => { e.stopPropagation(); api.invoke('clip:copy', c.id); ctx.flash({ icon: '📋', title: 'Скопировано', ms: 1200 }); } }),
    c.type === 'text' ? h('button', { class: 'ibtn', title: 'Открыть во вкладке «Текст»', html: icon('text', 14), onclick: (e) => { e.stopPropagation(); ctx.openTab('text'); bus.emit('text-set', c.text); } }) : '',
    h('button', { class: 'ibtn', title: 'Удалить из буфера', html: icon('trash', 14), onclick: (e) => { e.stopPropagation(); el.style.transform = 'translateX(30px)'; el.style.opacity = 0; setTimeout(() => api.invoke('clip:remove', c.id), 180); } })));
  el.onclick = () => paste(c);
  return el;
}

function paste(c) {
  ctx.collapse(false);
  api.invoke('clip:paste', c.id);
}

function render() {
  const list = $('.clips', root);
  const all = state.clips.filter(match);
  shown = [...all.filter((c) => c.pinned), ...all.filter((c) => !c.pinned)].slice(0, 120);
  sel = Math.min(sel, Math.max(0, shown.length - 1));
  list.innerHTML = '';
  if (!shown.length) list.append(h('div', { class: 'empty' }, query || filter !== 'all' ? 'Ничего не найдено' : 'Всё, что ты скопируешь, появится здесь — с подписью, откуда и когда'));
  shown.forEach((c, i) => list.append(item(c, i)));
  $('.cnt', root).textContent = `${state.clips.length} записей`;
}

export default {
  id: 'clip', label: 'Буфер', icon: 'clip',
  mount(el, c) {
    ctx = c; root = el;
    el.innerHTML = '<div class="pin"></div>';
    const pin = $('.pin', el);
    const search = h('input', { class: 'field grow', placeholder: 'Поиск по буферу…', spellcheck: 'false' });
    search.oninput = () => { query = search.value.trim(); sel = 0; render(); };
    search.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); $('.clip.sel', root)?.scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); $('.clip.sel', root)?.scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'Enter' && shown[sel]) paste(shown[sel]);
      if (e.key === 'Delete' && shown[sel] && !search.value) api.invoke('clip:remove', shown[sel].id);
    };
    const chips = h('div', { class: 'chips' }, ...FILTERS.map(([id, label]) => h('button', { class: 'chip' + (id === filter ? ' on' : ''), 'data-f': id, onclick: (e) => { filter = id; for (const x of chips.children) x.classList.toggle('on', x.dataset.f === id); render(); } }, label)));
    pin.append(
      h('div', { class: 'cliptop' }, h('span', { class: 'icw', html: icon('search', 16), style: 'color:var(--fg3)' }), search,
        h('span', { class: 'muted small cnt' }),
        h('button', { class: 'btn sm ghost', title: 'Удалить всё, кроме закреплённого', onclick: () => api.invoke('clip:clear') }, 'Очистить')),
      chips,
      h('div', { class: 'clips' }));
    render();
    bus.on('clips', () => { render(); ctx.resize(); });
    setInterval(() => { if (root.classList.contains('on')) render(); }, 60000); // refresh "N мин назад"
  },
  show() { render(); setTimeout(() => $('input', root)?.focus(), 60); },
};
