// Calendar, iPhone-style: the month on the left (today in a red circle, dots under days with events),
// the chosen day on the right with its events and a quick "add" line. An event is a reminder with
// `cal: true`, so the island itself tells you when it is time (or a few minutes before).
import { api, bus, state, $, h, icon } from '../core.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const BEFORE = [[0, 'В момент события'], [5, 'За 5 мин'], [15, 'За 15 мин'], [30, 'За 30 мин'], [60, 'За 1 час']];

let root, month, sel, slide = 0;
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const sameDay = (a, b) => dayKey(a) === dayKey(b);
const hhmm = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// everything with a date: calendar events and the reminders set from notes or the palette (timers are not)
function events() {
  return (state.reminders || []).filter((r) => r.at && r.kind !== 'timer').sort((a, b) => a.at - b.at);
}
function byDay() {
  const m = new Map();
  for (const e of events()) { const k = dayKey(new Date(e.at)); m.set(k, (m.get(k) || []).concat(e)); }
  return m;
}

// The month is drawn once; picking a day only moves the round marker (it glides from day to day)
// and recolours the numbers. Flipping the month slides the grid and the days ripple in.
let ring = null, ringAt = null, shownKey = '';
function placeRing(animate) {
  const grid = $('.cal-grid', root);
  if (!grid || !ring) return;
  // only on a day of the month that is shown (after flipping with the arrows the chosen day may be in
  // another month: no marker on a grey neighbour's day)
  const cell = grid.querySelector('.cal-d.sel:not(.other) .n');
  if (!cell) { ring.classList.add('gone'); ringAt = null; return; }
  // its place in the layout, not on screen: the days are still sliding / rippling in while it is measured
  let x = 0, y = 0;
  for (let e = cell; e && e !== grid; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; if (e.offsetParent === grid) break; }
  if (cell.offsetParent !== grid && !grid.contains(cell.offsetParent)) { const g = grid.getBoundingClientRect(), c = cell.getBoundingClientRect(); x = c.left - g.left; y = c.top - g.top; }
  ring.classList.toggle('today', !!cell.closest('.today'));
  ring.classList.remove('gone');
  if (!animate || !ringAt) { ring.style.transition = 'none'; ring.style.transform = `translate(${x}px, ${y}px)`; void ring.offsetWidth; ring.style.transition = ''; }
  else { ring.style.transform = `translate(${x}px, ${y}px)`; ring.classList.remove('pop'); void ring.offsetWidth; ring.classList.add('pop'); }
  ringAt = { x, y };
}
function pick(d) {
  sel = d;
  if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) { slide = d > month ? 1 : -1; month = new Date(d.getFullYear(), d.getMonth(), 1); render(); return; }
  for (const c of root.querySelectorAll('.cal-d')) c.classList.toggle('sel', c.dataset.k === dayKey(sel));
  placeRing(true);
  renderHead();
  renderDay(true);
}
function renderHead() {
  const head = $('.cal-head', root);
  if (!head) return;
  const today = new Date();
  const go = (k) => (e) => { e.stopPropagation(); slide = k; month = new Date(month.getFullYear(), month.getMonth() + k, 1); render(); };
  head.innerHTML = '';
  head.append(
    h('div', { class: 'cal-title' + (slide ? ' roll' : '') }, h('b', {}, MONTHS[month.getMonth()]), ' ', h('span', {}, String(month.getFullYear()))),
    h('div', { class: 'grow' }),
    sameDay(sel, today) ? '' : h('button', { class: 'btn sm ghost cal-today', onclick: (e) => { e.stopPropagation(); pick(new Date()); } }, 'Сегодня'),
    h('button', { class: 'ibtn', title: 'Предыдущий месяц', html: icon('back', 16), onclick: go(-1) }),
    h('button', { class: 'ibtn', title: 'Следующий месяц', html: icon('chevron', 16), onclick: go(1) }));
}
function renderMonth() {
  const box = $('.cal-month', root);
  const map = byDay(), today = new Date();
  const key = `${month.getFullYear()}-${month.getMonth()}`;
  const fresh = key !== shownKey; shownKey = key;
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // back to Monday
  const grid = h('div', { class: 'cal-grid' + (fresh && slide ? (slide > 0 ? ' in-next' : ' in-prev') : '') + (fresh ? ' ripple' : '') });
  for (const w of WEEK) grid.append(h('div', { class: 'cal-wd' + (w === 'Сб' || w === 'Вс' ? ' we' : '') }, w));
  ring = h('div', { class: 'cal-ring gone' });
  grid.append(ring);
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const ev = map.get(dayKey(d)) || [];
    const cls = ['cal-d'];
    if (d.getMonth() !== month.getMonth()) cls.push('other');
    if (sameDay(d, today)) cls.push('today');
    if (sameDay(d, sel)) cls.push('sel');
    if (d.getDay() === 0 || d.getDay() === 6) cls.push('we');
    grid.append(h('div', { class: cls.join(' '), 'data-k': dayKey(d), style: `--i:${i}`, onclick: (e) => { e.stopPropagation(); pick(d); } },
      h('span', { class: 'n' }, String(d.getDate())),
      h('span', { class: 'dots' }, ...ev.slice(0, 3).map((e) => h('i', { class: e.cal ? '' : 'rem' })))));
  }
  box.innerHTML = '';
  box.append(h('div', { class: 'cal-head' }), grid);
  renderHead();
  slide = 0;
  if (!fresh) ringAt = null; // same month redrawn (events changed): the marker just stays
  requestAnimationFrame(() => placeRing(false));
}

function renderDay(changed) {
  const box = $('.cal-day', root);
  box.classList.remove('swap'); if (changed) { void box.offsetWidth; box.classList.add('swap'); }
  const today = new Date();
  const list = events().filter((e) => sameDay(new Date(e.at), sel));
  const rel = sameDay(sel, today) ? 'Сегодня' : sameDay(sel, new Date(today.getTime() + 86400e3)) ? 'Завтра' : sameDay(sel, new Date(today.getTime() - 86400e3)) ? 'Вчера' : DAYS[sel.getDay()];
  box.innerHTML = '';
  box.append(h('div', { class: 'cal-dhead' }, h('b', {}, rel), h('span', {}, `${sel.getDate()} ${MONTHS_OF[sel.getMonth()]}${sel.getFullYear() !== today.getFullYear() ? ' ' + sel.getFullYear() : ''}${rel !== DAYS[sel.getDay()] ? ', ' + DAYS[sel.getDay()].toLowerCase() : ''}`)));
  const items = h('div', { class: 'cal-list' });
  if (!list.length) items.append(h('div', { class: 'cal-empty' }, h('span', { html: icon('calendar', 26) }), h('div', {}, 'Событий нет'), h('small', {}, 'Добавь ниже — остров напомнит')));
  for (const e of list) {
    const past = e.at < Date.now();
    items.append(h('div', { class: 'cal-ev' + (past ? ' past' : '') + (e.cal ? '' : ' rem'), style: `--i:${list.indexOf(e)}` },
      h('span', { class: 'bar' }),
      h('div', { class: 'cal-evt' }, h('b', {}, e.text || 'Без названия'), h('small', {}, hhmm(e.at), e.cal ? '' : ' · напоминание', e.cal && e.before ? ` · ${BEFORE.find((b) => b[0] === e.before)?.[1].toLowerCase() || ''}` : '')),
      h('button', { class: 'ibtn cal-del', title: 'Удалить', html: icon('trash', 14), onclick: (ev) => { ev.stopPropagation(); api.invoke('reminders:remove', e.id); } })));
  }
  box.append(items);
  // add an event: what, at what time, warn how much ahead
  const now = new Date();
  const next = new Date(now.getTime() + 60 * 60e3);
  const what = h('input', { class: 'field', placeholder: 'Новое событие', maxlength: 120 });
  const time = h('input', { class: 'field cal-time', type: 'time', value: `${String(sameDay(sel, now) ? next.getHours() : 10).padStart(2, '0')}:00` });
  const before = h('select', { class: 'field cal-before', title: 'Когда напомнить' }, ...BEFORE.map(([v, l]) => h('option', { value: v, selected: v === 15 ? '' : null }, l)));
  const add = async () => {
    const text = what.value.trim();
    if (!text) { what.focus(); return; }
    const [hh, mm] = (time.value || '10:00').split(':').map(Number);
    const at = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate(), hh, mm).getTime();
    await api.invoke('reminders:add', { text, at, cal: true, before: +before.value });
    what.value = '';
  };
  what.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  box.append(h('div', { class: 'cal-add' }, what, h('div', { class: 'row' }, time, before, h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); add(); } }, h('span', { html: icon('plus', 14) }), 'Добавить'))));
}

function render() { if (!root?.isConnected) return; renderMonth(); renderDay(); }

export default {
  id: 'calendar', label: 'Календарь', icon: 'calendar', fixedHeight: 470,
  mount(el) {
    root = el;
    sel = new Date();
    month = new Date(sel.getFullYear(), sel.getMonth(), 1);
    el.innerHTML = '';
    const m = h('div', { class: 'cal-month' });
    // the mouse wheel flips months
    let wheelT = 0;
    m.addEventListener('wheel', (e) => { if (Date.now() - wheelT < 350 || Math.abs(e.deltaY) < 8) return; wheelT = Date.now(); slide = e.deltaY > 0 ? 1 : -1; month = new Date(month.getFullYear(), month.getMonth() + slide, 1); render(); }, { passive: true });
    el.append(h('div', { class: 'cal' }, m, h('div', { class: 'cal-day' })));
    render();
    bus.on('reminders', render);
    // midnight: "today" moves on
    setInterval(() => { const t = new Date(); if (t.getHours() === 0 && t.getMinutes() === 0) render(); }, 60e3);
  },
  show() { render(); },
};
