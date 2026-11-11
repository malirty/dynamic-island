// iPhone-style notes with reminders and timers inside a note.
import { api, bus, state, $, h, esc, icon, ago } from '../core.js';
import { parseReminder, parseTimer, whenText } from '../nlp.js';

let ctx, root, cur = null, query = '';
const save = () => { api.invoke('notes:save', state.notes); bus.emit('notes'); };

function title(n) { return (n.text.split('\n').find((l) => l.trim()) || 'Новая заметка').slice(0, 60); }
function preview(n) { return n.text.split('\n').filter((l) => l.trim()).slice(1).join(' ').slice(0, 80) || 'Нет текста'; }
function dateShort(ts) {
  const d = new Date(ts), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function add(text = '') {
  const n = { id: 'n' + Date.now(), text, created: Date.now(), updated: Date.now(), pinned: false };
  state.notes.unshift(n);
  cur = n.id;
  save();
  render();
  setTimeout(() => { const ta = $('.neditor textarea', root); ta?.focus(); ta?.setSelectionRange(ta.value.length, ta.value.length); }, 60);
}

function renderList() {
  const list = $('.nlist .items', root);
  list.innerHTML = '';
  const q = query.toLowerCase();
  const notes = state.notes.filter((n) => !q || n.text.toLowerCase().includes(q)).sort((a, b) => (b.pinned - a.pinned) || b.updated - a.updated);
  if (!notes.length) list.append(h('div', { class: 'empty' }, q ? 'Не найдено' : 'Нет заметок'));
  for (const n of notes) {
    const rem = state.reminders.find((r) => r.noteId === n.id && !r.done);
    list.append(h('div', { class: 'nitem' + (n.id === cur ? ' on' : ''), onclick: () => { cur = n.id; render(); } },
      h('div', { class: 'nt' }, (n.pinned ? '📌 ' : '') + title(n)),
      h('div', { class: 'np' }, h('b', {}, dateShort(n.updated)), rem ? '⏰ ' : '', preview(n))));
  }
}

function renderEditor() {
  const ed = $('.neditor', root);
  ed.innerHTML = '';
  const n = state.notes.find((x) => x.id === cur);
  if (!n) { ed.append(h('div', { class: 'empty', style: 'margin:auto' }, 'Выбери заметку или создай новую')); return; }
  const ta = h('textarea', { placeholder: 'Начни писать… первая строка станет заголовком', spellcheck: 'true' });
  ta.value = n.text;
  let t;
  ta.oninput = () => { n.text = ta.value; n.updated = Date.now(); clearTimeout(t); t = setTimeout(() => { save(); renderList(); }, 300); };
  const rems = state.reminders.filter((r) => r.noteId === n.id && !r.done);
  const remIn = h('input', { class: 'field', style: 'height:28px;font-size:12px;flex:1', placeholder: 'через 20 минут · завтра в 9 · в пятницу в 18:00 · таймер 5 мин' });
  const setRem = async () => {
    const v = remIn.value.trim();
    if (!v) return;
    const tm = parseTimer(/^(таймер|\d)/.test(v) ? (v.startsWith('таймер') ? v : 'таймер ' + v) : '');
    const r = tm ? null : parseReminder('напомни ' + v.replace(/^напомни\s*/, ''));
    if (tm) await api.invoke('reminders:add', { kind: 'timer', at: Date.now() + tm.seconds * 1000, text: title(n), noteId: n.id });
    else if (r) await api.invoke('reminders:add', { kind: 'reminder', at: r.at, text: title(n), noteId: n.id });
    else return ctx.flash({ icon: '🤔', title: 'Не понял время — например «через 15 минут»', ms: 2200 });
    remIn.value = '';
    ctx.flash({ icon: '⏰', title: tm ? 'Таймер запущен' : `Напомню ${whenText(r.at)}`, ms: 1800 });
  };
  remIn.onkeydown = (e) => { if (e.key === 'Enter') setRem(); };
  ed.append(
    h('div', { class: 'ndate' }, new Date(n.updated).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })),
    ta,
    rems.length ? h('div', { class: 'row', style: 'flex-wrap:wrap' }, ...rems.map((r) => h('span', { class: 'rchip' }, r.kind === 'timer' ? '⏱ ' : '⏰ ', whenText(r.at), h('button', { html: icon('close', 10), onclick: () => api.invoke('reminders:remove', r.id) })))) : '',
    h('div', { class: 'row' }, h('span', { class: 'icw', html: icon('bell', 15) }), remIn, h('button', { class: 'btn sm', onclick: setRem }, 'Напомнить')),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm' + (n.pinned ? ' pri' : ''), onclick: () => { n.pinned = !n.pinned; save(); render(); } }, icon('pin', 12), n.pinned ? 'Закреплена' : 'Закрепить'),
      h('button', { class: 'btn sm', onclick: () => { api.invoke('text:copy', n.text); ctx.flash({ icon: '📋', title: 'Заметка скопирована', ms: 1200 }); } }, icon('copy', 12), 'Копировать'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn sm ghost', onclick: () => { state.notes = state.notes.filter((x) => x.id !== n.id); cur = state.notes[0]?.id || null; save(); render(); } }, icon('trash', 12), 'Удалить')));
}

function render() { renderList(); renderEditor(); }

export default {
  id: 'notes', label: 'Заметки', icon: 'notes', fixedHeight: 540,
  mount(el, c) {
    ctx = c; root = el;
    el.innerHTML = '';
    const search = h('input', { class: 'field', placeholder: 'Поиск', style: 'height:30px' });
    search.oninput = () => { query = search.value; renderList(); };
    el.append(h('div', { class: 'notes' },
      h('div', { class: 'nlist' }, h('div', { class: 'row' }, search, h('button', { class: 'ibtn', title: 'Новая заметка', html: icon('edit', 16), style: 'color:#ffcc00', onclick: () => add() })), h('div', { class: 'items', style: 'display:flex;flex-direction:column;gap:2px' })),
      h('div', { class: 'neditor' })));
    cur = state.notes[0]?.id || null;
    render();
    bus.on('note-add', (t) => { ctx.openTab('notes'); add(t || ''); });
    bus.on('note-open', (id) => { cur = id; render(); });
    bus.on('reminders', render);
  },
  show() { render(); },
};
