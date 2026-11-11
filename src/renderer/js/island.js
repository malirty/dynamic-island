import { api, bus, state, $, $$, h, esc, icon, clock, bytes, coverColor, saveSettings } from './core.js';
import { audioActive } from './audio.js';
import { initWater } from './water.js';
import { initCharacters, eyesHTML, flashMood, flags, applyMood } from './characters.js';
import { initPalette, openPalette, closePalette, paletteHeight } from './palette.js';
import home from './tabs/home.js';
import clip from './tabs/clip.js';
import ai from './tabs/ai.js';
import text from './tabs/text.js';
import notes from './tabs/notes.js';
import weather from './tabs/weather.js';
import control from './tabs/control.js';
import settings from './tabs/settings.js';

const TABS = { home, clip, ai, text, notes, weather, control, settings };
const root = document.documentElement;
const stage = $('#stage');
const isl = $('#island');
const bubble = $('#bubble');
const flash = $('#flash');
const WIN = { w: 880, h: 700 };
const TOP = 7;

let view = 'compact';
let hovering = false;
let pinnedOpen = false;
let activeTab = 'home';
let size = { w: 300, h: 38, r: 19 };
let toastQueue = [], toastTimer = null, currentToast = null;
let hideForFullscreen = false, revealUntil = 0;
let doneFlash = null; // { project, until }
let dragDepth = 0;

// ---------------- sizing & window shape ----------------
function scale() { return state.settings?.theme?.scale || 1; }

function targetSize() {
  const k = scale();
  switch (view) {
    case 'mini': return { w: 440, h: 92, r: 30 };
    case 'toast': return { w: 470, h: currentToast?.actions ? 84 : 72, r: 30 };
    case 'ask': return { w: 540, h: Math.min(320, contentHeight($('.v-ask'), 28)), r: 28 };
    case 'drop': return { w: 480, h: 132, r: 30 };
    case 'palette': return { w: 660, h: paletteHeight(), r: 28 };
    case 'open': {
      const t = TABS[activeTab];
      if (t.fixedHeight) return { w: 800, h: t.fixedHeight, r: 34 };
      const pin = $(`.page[data-id="${activeTab}"] .pin`);
      const ch = pin ? pin.scrollHeight : 300;
      return { w: 800, h: Math.max(220, Math.min(610, ch + 82)), r: 34 };
    }
    default: {
      const a = primaryActivity();
      const w = { music: 350, download: 380, agent: 390, ask: 390, timer: 300, done: 340, clock: 310 }[a?.kind || 'clock'] || 310;
      return { w: Math.round(w * k), h: Math.round(38 * k), r: Math.round(19 * k) };
    }
  }
}

// natural height of a flex-column view: children + gaps + vertical padding
function contentHeight(el, pad) {
  const kids = [...el.children];
  const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
  return kids.reduce((s, k) => s + k.offsetHeight, 0) + gap * Math.max(0, kids.length - 1) + pad;
}

let shapeTimer = null;
let lastShape = '';
function applySize() {
  const t = targetSize();
  const grow = t.w > size.w || t.h > size.h;
  size = t;
  root.style.setProperty('--w', t.w + 'px');
  root.style.setProperty('--h', t.h + 'px');
  root.style.setProperty('--r', t.r + 'px');
  clearTimeout(shapeTimer);
  if (grow) sendShape(); else shapeTimer = setTimeout(sendShape, 560);
}

function sendShape() {
  const M = state.media?.playing && state.settings?.theme?.edgeDance !== false ? 26 : 12;
  const rects = [], hit = [];
  if (hideForFullscreen && Date.now() > revealUntil && !hovering && view === 'compact') {
    const hot = { x: WIN.w / 2 - 160, y: 0, width: 320, height: 4 };
    rects.push(hot); hit.push(hot);
  } else {
    const x = (WIN.w - size.w) / 2;
    const extraBelow = stage.classList.contains('char-buddies') && view === 'compact' || view === 'mini' ? 30 : 0;
    rects.push({ x: x - M, y: 0, width: size.w + 2 * M, height: TOP + size.h + M + extraBelow });
    hit.push({ x: x - 2, y: 0, width: size.w + 4, height: TOP + size.h + 4 });
    if (bubble.classList.contains('on')) {
      const b = { x: x + size.w + 4, y: 0, width: size.h + 18, height: TOP + size.h + 10 };
      rects.push(b); hit.push(b);
    }
    if (flash.classList.contains('on')) rects.push({ x: WIN.w / 2 - 200, y: TOP + size.h, width: 400, height: 70 });
  }
  const key = JSON.stringify(rects);
  if (key === lastShape) return;
  lastShape = key;
  api.send('shape', rects, hit);
}

function setView(v) {
  if (v === view) { applySize(); return; }
  view = v;
  isl.dataset.view = v;
  isl.classList.toggle('open', v === 'open' || v === 'palette');
  if (v !== 'palette') closePalette(true);
  applySize();
  renderCompact(true);
  bus.emit('view', v);
}
export function resize() { applySize(); }

// ---------------- activities shown in the pill ----------------
function activities() {
  const out = [];
  const now = Date.now();
  if (state.agents.asks?.length) out.push({ kind: 'ask', prio: 100, ask: state.agents.asks[0] });
  if (doneFlash && doneFlash.until > now) out.push({ kind: 'done', prio: 85, ...doneFlash });
  const timers = state.reminders.filter((r) => !r.done && r.kind === 'timer' && r.at > now).sort((a, b) => a.at - b.at);
  if (timers[0]) out.push({ kind: 'timer', prio: 70, timer: timers[0] });
  if (state.downloads.length) out.push({ kind: 'download', prio: 60, dl: state.downloads[0], count: state.downloads.length });
  const working = state.agents.sessions?.filter((s) => s.state === 'working' && now - s.updated < 10 * 60e3) || [];
  const waiting = state.agents.sessions?.filter((s) => s.state === 'waiting') || [];
  if (waiting[0]) out.push({ kind: 'agent', prio: 90, s: waiting[0], waiting: true });
  else if (working[0]) out.push({ kind: 'agent', prio: 50, s: working[0], count: working.length });
  if (state.media?.active && (state.media.playing || now - (state.media.pausedAt || now) < 30e3)) out.push({ kind: 'music', prio: state.media.playing ? 40 : 20 });
  flags.agentWorking = working.length > 0;
  return out.sort((a, b) => b.prio - a.prio);
}
function primaryActivity() { return activities()[0] || null; }

function dateText() {
  const d = new Date();
  return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
}
function timeText() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: state.settings?.island?.showSeconds ? '2-digit' : undefined });
}
function weatherText() {
  const c = state.weather?.current;
  if (!c) return '';
  return `${wIcon(c.weather_code, c.is_day)} ${Math.round(c.temperature_2m)}°`;
}
function wIcon(code, day) {
  if (code === 0) return day ? '☀️' : '🌙';
  if (code <= 2) return day ? '🌤' : '☁️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫';
  if (code <= 67 || (code >= 80 && code <= 82)) return '🌧';
  if (code <= 86) return '🌨';
  return '⛈';
}

let compactKey = '';
function renderCompact(force) {
  const el = $('.v-compact');
  const acts = activities();
  const a = acts[0];
  const kind = a?.kind || 'clock';
  let key = kind, html = '';
  const eyes = eyesHTML('main');
  if (kind === 'music') {
    const m = state.media;
    key += m.key + m.thumb?.length;
    html = `<div class="side"><div class="cover" style="background-image:url('${m.thumb || ''}')"></div><div class="marq ${(m.title || '').length > 22 ? 'run' : ''}"><span>${esc(m.title)}${(m.title || '').length > 22 ? '&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;' + esc(m.title) : ''}</span></div></div>
      <div class="side r"><div class="bars">${'<i></i>'.repeat(5)}</div></div>`;
  } else if (kind === 'download') {
    const d = a.dl;
    key += d.name;
    html = `<div class="side"><div class="ring spin"></div><div class="marq"><span>${esc(d.name)}</span></div></div><div class="side r dim js-sub" style="flex:none">${bytes(d.size)}${d.speed > 0 ? ' · ' + bytes(d.speed) + '/с' : ''}</div>`;
  } else if (kind === 'agent') {
    const s = a.s;
    key += s.id + a.waiting;
    html = a.waiting
      ? `<div class="side"><div class="pulse"></div><span>${esc(s.project)}</span></div><div class="side r dim">нужен ответ</div>`
      : `<div class="side"><span class="spark">${icon('agent', 16)}</span><span>${s.source === 'codex' ? 'Codex' : 'Claude'} трудится</span></div><div class="side r dim js-sub">${esc(s.project)}${a.count > 1 ? ' +' + (a.count - 1) : ''}</div>`;
  } else if (kind === 'ask') {
    key += a.ask.id;
    html = `<div class="side"><div class="pulse"></div><span>${esc(a.ask.project)}</span></div><div class="side r dim">${a.ask.kind === 'permission' ? 'разрешить?' : 'вопрос'}</div>`;
  } else if (kind === 'timer') {
    key += a.timer.id;
    html = `<div class="side"><span>⏱</span><span class="dim marq"><span>${esc(a.timer.text || 'Таймер')}</span></span></div><div class="mid">${eyes}</div><div class="side r js-sub" style="font-variant-numeric:tabular-nums">${clock((a.timer.at - Date.now()) / 1000)}</div>`;
  } else if (kind === 'done') {
    key += a.project;
    html = `<div class="side"><div class="okdot">${icon('check', 12)}</div><span>Готово</span></div><div class="side r dim">${esc(a.project)}</div>`;
  } else {
    html = `<div class="side dim js-date">${esc(dateText())}</div><div class="mid">${eyes}</div><div class="side r"><span class="js-time">${timeText()}</span><span class="dim js-w">${weatherText()}</span></div>`;
  }
  if (force || key !== compactKey) {
    compactKey = key;
    el.innerHTML = html;
    applySize();
  } else {
    const t = $('.js-time', el); if (t) t.textContent = timeText();
    const w = $('.js-w', el); if (w) w.textContent = weatherText();
    const dd = $('.js-date', el); if (dd) dd.textContent = dateText();
    const sub = $('.js-sub', el);
    if (sub && kind === 'download') sub.textContent = `${bytes(a.dl.size)}${a.dl.speed > 0 ? ' · ' + bytes(a.dl.speed) + '/с' : ''}`;
    if (sub && kind === 'timer') sub.textContent = clock((a.timer.at - Date.now()) / 1000);
  }
  // secondary bubble
  const b = acts[1];
  const showB = b && view === 'compact' && !hideForFullscreen;
  bubble.classList.toggle('on', !!showB);
  if (showB) {
    const sig = b.kind + (b.kind === 'music' ? state.media.key : '');
    if (bubble.dataset.sig !== sig) {
      bubble.dataset.sig = sig;
      bubble.innerHTML = b.kind === 'music' ? `<div class="cover" style="background-image:url('${state.media.thumb || ''}')"></div>` : b.kind === 'download' ? icon('download', 16) : b.kind === 'timer' ? '⏱' : b.kind === 'agent' ? `<span class="spark">${icon('agent', 15)}</span>` : b.kind === 'done' ? '✅' : '•';
    }
  }
  sendShape();
}

// ---------------- mini player (hover) ----------------
function renderMini() {
  const m = state.media;
  const el = $('.v-mini');
  if (!m?.active) return;
  const key = m.key + (m.thumb?.length || 0);
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.innerHTML = `<div class="art" style="background-image:url('${m.thumb || ''}')"></div>
      <div class="meta"><div class="t">${esc(m.title)}</div><div class="a">${esc(m.artist || m.app)}</div>
        <div class="prog"><span class="js-pos">0:00</span><div class="track js-seek"><i></i></div><span class="js-dur">${clock(m.duration || 0)}</span></div></div>
      <div class="ctl"><button class="cbtn" data-c="prev">${icon('prev', 16)}</button><button class="cbtn big js-pp" data-c="toggle"></button><button class="cbtn" data-c="next">${icon('next', 16)}</button></div>`;
    for (const b of $$('[data-c]', el)) b.onclick = (e) => { e.stopPropagation(); api.invoke('media:cmd', b.dataset.c); };
    $('.js-seek', el).onclick = (e) => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      if (m.canSeek && m.duration) api.invoke('media:cmd', 'seek', { position: ((e.clientX - r.left) / r.width) * m.duration });
    };
  }
  $('.js-pp', el).innerHTML = icon(m.playing ? 'pause' : 'play', 18);
  $('.js-pos', el).textContent = clock(m.position || 0);
  $('.js-dur', el).textContent = clock(m.duration || 0);
  $('.track', el).style.setProperty('--p', m.duration ? m.position / m.duration : 0);
}

// ---------------- toasts & notifications ----------------
function showToast(t) {
  toastQueue.push(t);
  if (!currentToast) nextToast();
}
function nextToast() {
  clearTimeout(toastTimer);
  currentToast = toastQueue.shift() || null;
  if (!currentToast) { if (view === 'toast') setView(state.agents.asks?.length ? 'ask' : 'compact'); return; }
  if (view === 'open' || view === 'palette') {
    // don't interrupt an open island: show a small flash below instead
    flashBelow(currentToast);
    currentToast = null;
    return nextToast();
  }
  const t = currentToast;
  const el = $('.v-toast');
  const iconHtml = t.thumb ? '' : t.color ? '' : esc(t.icon || (t.app ? t.app[0] : '•'));
  el.innerHTML = `<div class="ti" style="${t.thumb ? `background-image:url('${t.thumb}')` : t.color ? `background:${t.color}` : ''}">${iconHtml}</div>
    <div class="tb">${t.app ? `<div class="tapp">${esc(t.app)}</div>` : ''}<div class="tt">${esc(t.title || '')}</div>${t.body ? `<div class="tx">${esc(t.body)}</div>` : ''}</div>
    <div class="tact"></div>`;
  const act = $('.tact', el);
  if (t.url) act.append(h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); api.invoke('url:open', t.url); nextToast(); } }, 'Открыть'));
  if (t.path) {
    act.append(h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); api.invoke('file:open', t.path); nextToast(); } }, 'Открыть'));
    act.append(h('button', { class: 'btn sm ghost', onclick: (e) => { e.stopPropagation(); api.invoke('file:reveal', t.path); nextToast(); } }, 'В папке'));
  }
  setView('toast');
  toastTimer = setTimeout(nextToast, t.ms || (t.sticky ? 9000 : 4500));
}
function flashBelow(t) {
  flash.innerHTML = `${t.thumb ? `<div class="th" style="background-image:url('${t.thumb}')"></div>` : t.color ? `<div class="sw" style="background:${t.color}"></div>` : `<span style="font-size:16px;padding-left:4px">${esc(t.icon || '•')}</span>`}<span>${esc(t.title)}</span>`;
  flash.classList.add('on');
  sendShape();
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { flash.classList.remove('on'); setTimeout(sendShape, 450); }, t.ms || 2200);
}

// ---------------- agent questions answered from the island ----------------
let askStep = { id: null, i: 0, answers: {} };
function renderAsk() {
  const a = state.agents.asks?.[0];
  const el = $('.v-ask');
  if (!a) { if (view === 'ask') setView('compact'); return; }
  if (askStep.id !== a.id) askStep = { id: a.id, i: 0, answers: {} };
  el.innerHTML = '';
  const who = a.source === 'codex' ? 'Codex' : 'Claude Code';
  if (a.kind === 'permission') {
    el.append(
      h('div', { class: 'q' }, h('span', { class: 'spark', html: icon('agent', 16) }), `${who} · ${a.project}: можно выполнить ${a.data.tool}?`),
      a.data.detail ? h('div', { class: 'd' }, a.data.detail) : '',
      h('div', { class: 'opts' },
        h('button', { class: 'btn ok', onclick: () => answer(a.id, { allow: true }) }, icon('check', 14), 'Разрешить'),
        h('button', { class: 'btn bad', onclick: () => answer(a.id, { allow: false }) }, 'Запретить'),
        h('button', { class: 'btn ghost', onclick: () => answer(a.id, null) }, 'Ответить в терминале')),
    );
  } else {
    const qs = a.data.questions || [];
    const q = qs[askStep.i];
    const input = h('input', { class: 'field', placeholder: 'Свой ответ…', onkeydown: (e) => { if (e.key === 'Enter' && input.value.trim()) pick(input.value.trim()); } });
    const pick = (label) => {
      askStep.answers[q.question] = label;
      if (askStep.i + 1 < qs.length) { askStep.i++; renderAsk(); applySize(); }
      else answer(a.id, askStep.answers);
    };
    el.append(
      h('div', { class: 'q' }, h('span', { class: 'spark', html: icon('agent', 16) }), `${who} · ${a.project}${qs.length > 1 ? ` · ${askStep.i + 1}/${qs.length}` : ''}`),
      h('div', { style: 'font-size:14px;font-weight:600' }, q.question),
      h('div', { class: 'opts' }, ...(q.options || []).map((o) => h('button', { class: 'btn', title: o.description || '', onclick: () => pick(o.label) }, o.label)), input),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => answer(a.id, null) }, 'Ответить в терминале')),
    );
  }
  if (view !== 'open' && view !== 'palette') setView('ask');
  applySize();
}
function answer(id, ans) {
  api.invoke('agents:answer', id, ans);
  state.agents.asks = state.agents.asks.filter((x) => x.id !== id);
  if (ans) flashMood('mood-happy', 1500);
  renderAsk();
  renderCompact();
}

// ---------------- expanded island & tabs ----------------
function buildTabs() {
  const nav = $('.tabs');
  const pages = $('.pages');
  nav.innerHTML = '<div class="ind"></div>';
  const enabled = state.settings.tabs.filter((t) => t.on && TABS[t.id]);
  if (!enabled.find((t) => t.id === activeTab && !TABS[t.id].external)) activeTab = enabled.find((t) => !TABS[t.id].external)?.id || 'home';
  for (const t of enabled) {
    const m = TABS[t.id];
    nav.append(h('button', { class: 'tab' + (t.id === activeTab ? ' on' : ''), 'data-id': t.id, title: m.label, onclick: (e) => { e.stopPropagation(); openTab(t.id); } }, h('span', { class: 'icw', html: icon(m.icon, 16) }), h('span', {}, m.label)));
    if (!m.external && !$(`.page[data-id="${t.id}"]`, pages)) {
      const page = h('div', { class: 'page', 'data-id': t.id });
      pages.append(page);
      m.mount(page, ctx);
    }
  }
  for (const p of $$('.page', pages)) p.classList.toggle('on', p.dataset.id === activeTab);
  indPos.init = false; // new strip: snap the pill instead of sliding from 0
  tabsObserver.disconnect();
  tabsObserver.observe(nav);
  for (const t of $$('.tab', nav)) tabsObserver.observe(t);
  moveIndicator();
  const hb = $('.hbtns');
  hb.innerHTML = '';
  hb.append(
    h('button', { class: 'ibtn', title: 'Светлая / тёмная тема (' + (state.settings.hotkeys.themeToggle || '') + ')', html: icon(state.settings.theme.mode === 'dark' ? 'sun' : 'moon', 16), onclick: (e) => { e.stopPropagation(); toggleTheme(); } }),
    h('button', { class: 'ibtn' + (state.settings.dnd ? ' on' : ''), title: 'Не беспокоить', html: icon(state.settings.dnd ? 'belloff' : 'bell', 16), onclick: (e) => { e.stopPropagation(); state.settings.dnd = !state.settings.dnd; saveSettings(); buildTabs(); } }),
    h('button', { class: 'ibtn' + (pinnedOpen ? ' on' : ''), title: 'Не сворачивать', html: icon('pin', 16), onclick: (e) => { e.stopPropagation(); pinnedOpen = !pinnedOpen; buildTabs(); } }),
    h('button', { class: 'ibtn', title: 'Свернуть (Esc)', html: icon('close', 16), onclick: (e) => { e.stopPropagation(); collapse(true); } }),
  );
}
// The selected-tab pill follows its tab every frame with an eased chase, so it
// stays glued while labels expand on hover and glides when the tab changes.
const indPos = { x: 0, w: 0, init: false };
let indRaf = 0;
function indicatorFrame() {
  indRaf = 0;
  const on = $(`.tab[data-id="${activeTab}"]`);
  const ind = $('.tabs .ind');
  if (!on || !ind || view !== 'open') { indPos.init = false; return; }
  const tx = on.offsetLeft, tw = on.offsetWidth;
  if (!indPos.init) { indPos.x = tx; indPos.w = tw; indPos.init = true; }
  indPos.x += (tx - indPos.x) * 0.28;
  indPos.w += (tw - indPos.w) * 0.28;
  const settled = Math.abs(tx - indPos.x) < 0.3 && Math.abs(tw - indPos.w) < 0.3;
  if (settled) { indPos.x = tx; indPos.w = tw; }
  ind.style.transform = `translateX(${indPos.x}px)`;
  ind.style.width = indPos.w + 'px';
  if (!settled) indRaf = requestAnimationFrame(indicatorFrame);
}
function moveIndicator() { if (!indRaf) indRaf = requestAnimationFrame(indicatorFrame); }
// any width change in the tab strip (hover labels, tab switch) restarts the chase
const tabsObserver = new ResizeObserver(moveIndicator);
document.addEventListener('transitionrun', (e) => { if (e.target.closest?.('.tabs')) moveIndicator(); });
document.addEventListener('mouseover', (e) => { if (e.target.closest?.('.tabs')) moveIndicator(); });
let pageObserver = null;
export function openTab(id) {
  if (!TABS[id]) return;
  if (TABS[id].external) { api.invoke('settings:open'); return; } // settings live in their own window
  const order = state.settings.tabs.filter((t) => t.on).map((t) => t.id);
  const dir = order.indexOf(id) >= order.indexOf(activeTab) ? 1 : -1;
  const prev = activeTab;
  activeTab = id;
  if (view !== 'open') { setView('open'); api.invoke('island:focus'); }
  for (const t of $$('.tab')) t.classList.toggle('on', t.dataset.id === id);
  for (const p of $$('.page')) {
    p.style.setProperty('--dir', dir);
    p.classList.toggle('on', p.dataset.id === id);
    p.classList.toggle('out', p.dataset.id === prev && prev !== id);
  }
  moveIndicator();
  TABS[id].show?.();
  pageObserver?.disconnect();
  const pin = $(`.page[data-id="${id}"] .pin`);
  if (pin) { pageObserver = new ResizeObserver(() => view === 'open' && applySize()); pageObserver.observe(pin); }
  applySize();
}
function expand(tab) { openTab(tab || activeTab || 'home'); }
export function collapse(release) {
  if (view === 'compact') return;
  pinnedOpen = false;
  setView(state.agents.asks?.length ? 'ask' : 'compact');
  if (release) api.invoke('island:release');
}

// ---------------- theme ----------------
function applyTheme() {
  const t = state.settings.theme;
  root.dataset.mode = t.mode;
  const [c1, c2, c3] = t.colors;
  root.style.setProperty('--c1', c1);
  root.style.setProperty('--c2', c2);
  root.style.setProperty('--c3', c3);
  root.style.setProperty('--glowK', t.glow);
  if (!coverGlowColor || !t.coverGlow) root.style.setProperty('--glow', c1);
  const dark = t.mode === 'dark';
  const op = { liquid: [0.55, 0, 0], gradient: [0.2, 1, 0], glass: [0.35, 0, 1], solid: [0, 0, 0] }[t.style] || [0.5, 0, 0];
  root.style.setProperty('--liquidOp', op[0]);
  root.style.setProperty('--flowOp', op[1]);
  root.style.setProperty('--glassOp', op[2]);
  root.style.setProperty('--sheenOp', t.cursorGlow ? 1 : 0);
  const base = t.style === 'glass' ? (dark ? 'rgba(22,22,32,.66)' : 'rgba(255,255,255,.6)') : t.style === 'solid' ? (dark ? t.solid : '#f7f7fa') : dark ? 'rgba(6,6,10,.94)' : 'rgba(250,250,253,.9)';
  root.style.setProperty('--base', base);
  applyMood();
}
function toggleTheme() {
  state.settings.theme.mode = state.settings.theme.mode === 'dark' ? 'light' : 'dark';
  applyTheme();
  saveSettings();
  if (view === 'open') buildTabs();
}
let coverGlowColor = null;
async function updateCoverGlow() {
  coverGlowColor = state.settings.theme.coverGlow && state.media?.thumb ? await coverColor(state.media.thumb) : null;
  root.style.setProperty('--glow', coverGlowColor || state.settings.theme.colors[0]);
}

// ---------------- cursor reactions ----------------
function onCursor(p) {
  const r = isl.getBoundingClientRect();
  const inside = p.x >= r.left - 2 && p.x <= r.right + 2 && p.y >= 0 && p.y <= r.bottom + 2;
  const bub = bubble.getBoundingClientRect();
  const onBubble = bubble.classList.contains('on') && p.x >= bub.left && p.x <= bub.right && p.y <= bub.bottom;
  root.style.setProperty('--mx', ((p.x - r.left) / r.width) * 100 + '%');
  root.style.setProperty('--my', ((p.y - r.top) / r.height) * 100 + '%');
  const dx = p.x - (r.left + r.width / 2), dy = p.y - (r.top + r.height / 2);
  const edgeDist = Math.max(0, Math.max(Math.abs(dx) - r.width / 2, Math.abs(dy) - r.height / 2));
  const near = Math.max(0, 1 - edgeDist / 180);
  root.style.setProperty('--near', near.toFixed(3));
  const small = view === 'compact' || view === 'mini' || view === 'toast';
  if (state.settings?.theme?.reactive && small) {
    const k = near * near;
    root.style.setProperty('--tx', Math.max(-6, Math.min(6, dx * 0.02 * k)) + 'px');
    root.style.setProperty('--ty', Math.max(0, Math.min(4, dy * 0.02 * k)) + 'px');
    root.style.setProperty('--ry', (Math.max(-1, Math.min(1, dx / 300)) * 7 * k).toFixed(2) + 'deg');
    root.style.setProperty('--rx', (-Math.max(-1, Math.min(1, dy / 200)) * 6 * k).toFixed(2) + 'deg');
    root.style.setProperty('--sc', inside && view === 'compact' ? 1.045 : 1);
  } else {
    root.style.setProperty('--tx', '0px'); root.style.setProperty('--ty', '0px');
    root.style.setProperty('--rx', '0deg'); root.style.setProperty('--ry', '0deg'); root.style.setProperty('--sc', 1);
  }
  const was = hovering;
  hovering = inside || onBubble;
  if (hovering !== was) onHover(hovering);
}
let hoverTimer = null;
function onHover(on) {
  clearTimeout(hoverTimer);
  if (on) {
    if (hideForFullscreen) { revealUntil = Date.now() + 1e9; stage.classList.remove('hidden'); sendShape(); }
    hoverTimer = setTimeout(() => {
      if (view === 'compact' && state.media?.active && primaryActivity()?.kind === 'music') { renderMini(); setView('mini'); }
    }, 180);
  } else {
    hoverTimer = setTimeout(() => {
      if (view === 'mini') setView('compact');
      if (hideForFullscreen && view === 'compact') { revealUntil = 0; stage.classList.add('hidden'); sendShape(); }
    }, 420);
  }
}

// ---------------- drag & drop: shelf or ask AI ----------------
function initDrop() {
  const zones = { shelf: $('[data-zone="shelf"]'), ai: $('[data-zone="ai"]') };
  zones.shelf.innerHTML = `${icon('shelf', 26)}<div>На полку</div><small class="muted small">заберёшь потом</small>`;
  zones.ai.innerHTML = `${icon('ai', 26)}<div>Спросить ИИ</div><small class="muted small">о чём этот файл?</small>`;
  let prevView = 'compact';
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    if (dragDepth++ === 0 && view !== 'open') { prevView = view; setView('drop'); }
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; if (view === 'drop') setView(prevView === 'drop' ? 'compact' : prevView); for (const z of Object.values(zones)) z.classList.remove('hot'); }
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    for (const [k, z] of Object.entries(zones)) {
      const r = z.getBoundingClientRect();
      z.classList.toggle('hot', e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
    }
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    const paths = [...(e.dataTransfer?.files || [])].map((f) => api.pathOf(f)).filter(Boolean);
    const zone = zones.ai.classList.contains('hot') ? 'ai' : zones.shelf.classList.contains('hot') ? 'shelf' : null;
    for (const z of Object.values(zones)) z.classList.remove('hot');
    if (view === 'open') { bus.emit('drop-open', { paths, target: e.target }); return; }
    if (!paths.length || !zone) { setView('compact'); return; }
    if (zone === 'shelf') {
      await api.invoke('shelf:add', paths);
      setView('compact');
      flashBelow({ icon: '📥', title: paths.length > 1 ? `На полке: ${paths.length} файла` : 'Файл на полке', ms: 1800 });
    } else {
      openTab('ai');
      bus.emit('ai-attach', paths);
    }
  });
}

// ---------------- context passed to tabs ----------------
const ctx = { resize, collapse, openTab, flash: flashBelow, toast: showToast, mood: flashMood, flags, rebuild: () => { buildTabs(); applyTheme(); } };

// ---------------- events from main ----------------
function wire() {
  api.on('cursor', (p) => { onCursor(p); bus.emit('cursor', p); });
  api.on('blur', () => { if (!pinnedOpen && (view === 'open' || view === 'palette' || view === 'drop')) collapse(false); });
  api.on('settings', (s) => {
    // merge into the same object: open settings controls keep editing what gets saved
    for (const k of Object.keys(s)) state.settings[k] = s[k];
    applyTheme(); bus.emit('settings', state.settings); bus.emit('settings-external');
    buildTabs();
  });
  api.on('clips', (c) => { state.clips = c; bus.emit('clips', c); });
  api.on('shelf', (s) => { state.shelf = s; bus.emit('shelf', s); });
  api.on('reminders', (r) => { state.reminders = r; bus.emit('reminders', r); renderCompact(); });
  api.on('weather', (w) => { state.weather = w; bus.emit('weather', w); renderCompact(); });
  api.on('downloads', (d) => {
    const had = state.downloads.length;
    state.downloads = d;
    if (d.length || had) renderCompact();
  });
  api.on('download-done', (d) => showToast({ icon: '✅', app: 'Загрузки', title: d.name, body: `Скачано · ${bytes(d.size)}`, path: d.path, actions: true, ms: 6000 }));
  api.on('media', (m) => {
    const prev = state.media;
    if (prev?.playing && !m.playing) m.pausedAt = Date.now(); else if (!m.playing) m.pausedAt = prev?.pausedAt || Date.now();
    state.media = m;
    if (prev?.key !== m.key || prev?.thumb !== m.thumb) updateCoverGlow();
    if (prev?.playing !== m.playing) { audioActive(m.playing); applyMood(); }
    bus.emit('media', m);
    if (view === 'mini') { if (m.active) renderMini(); else setView('compact'); }
    renderCompact();
  });
  api.on('lyrics', (l) => { state.lyrics = l; bus.emit('lyrics', l); });
  api.on('notification', (n) => {
    state.notifications.unshift(n);
    state.notifications.length = Math.min(50, state.notifications.length);
    bus.emit('notification', n);
    if (n.silent) return;
    if (n.askId) return; // handled by the ask view
    if (n.done) { doneFlash = { project: n.title.split(':')[0], until: Date.now() + 8000 }; renderCompact(); setTimeout(renderCompact, 8100); }
    showToast({ ...n, app: n.app || (n.kind === 'reminder' ? 'Напоминание' : n.kind === 'rain' ? 'Погода' : n.kind === 'agent' ? 'Агент' : ''), ms: n.sticky ? 10000 : 5000 });
  });
  api.on('agents', (a) => {
    state.agents = a;
    bus.emit('agents', a);
    if (a.asks?.length) { renderAsk(); flags.agentWorking = true; } else if (view === 'ask') setView('compact');
    renderCompact();
    applyMood();
  });
  api.on('toast', (t) => (view === 'open' || view === 'palette' ? flashBelow(t) : showToast(t)));
  api.on('ocr-result', (r) => { openTab('text'); bus.emit('text-set', r.text); flashBelow({ icon: '🔤', title: r.translated ? 'Переведено и скопировано' : 'Текст скопирован в буфер', ms: 2200 }); });
  api.on('fullscreen', (f) => {
    hideForFullscreen = f;
    stage.classList.toggle('hidden', f && !hovering && view === 'compact');
    renderCompact();
    sendShape();
  });
  api.on('idle', (s) => { state.idle = s; bus.emit('idle', s); });
  api.on('palette-open', () => { if (view === 'palette') { collapse(true); return; } setView('palette'); openPalette(); });
  api.on('theme-toggle', toggleTheme);
  api.on('island-toggle', (force) => { if (view === 'open' && !force) collapse(true); else expand(); });
  api.on('open-tab', (id) => openTab(id));
  api.on('capture-hide', (on) => stage.classList.toggle('capturing', on));
  api.on('telegram-ask', (q) => bus.emit('telegram-ask', q));
  api.on('telegram-status', (s) => bus.emit('telegram-status', s));
}

// ---------------- boot ----------------
async function boot() {
  const init = await api.invoke('init');
  Object.assign(state, {
    settings: init.settings, clips: init.clips, notes: init.notes, shelf: init.shelf, reminders: init.reminders,
    weather: init.weather, media: init.media || { active: false }, lyrics: init.lyrics, notifications: init.notifications || [],
    providers: init.providers, agentsInstalled: init.agentsInstalled, telegram: init.telegram, hotkeyStatus: init.hotkeys,
  });
  WIN.w = init.winSize.w; WIN.h = init.winSize.h;
  applyTheme();
  initCharacters();
  initWater();
  initPalette({ setView, resize, collapse, openTab, flash: flashBelow });
  buildTabs();
  wire();
  initDrop();
  renderCompact(true);
  updateCoverGlow();
  api.invoke('agents:list'); // re-sync pending agent questions after a reload
  if (state.media?.playing) audioActive(true);

  isl.addEventListener('click', (e) => {
    if (e.target.closest('.v-ask, .v-mini button, .v-toast button')) return; // buttons inside small views
    if (view === 'compact' || view === 'mini') expand('home');
    else if (view === 'toast') {
      const t = currentToast;
      if (t?.kind === 'agent' || t?.kind === 'reminder') expand('home');
      nextToast();
    }
  });
  // right click anywhere on the island (except text fields) opens the island menu
  isl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea, [contenteditable], .clip, .fitem')) return;
    e.preventDefault();
    api.invoke('island:menu', { tab: activeTab, view });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (view === 'open' || view === 'palette' || view === 'drop') { e.preventDefault(); collapse(true); }
    }
    if (view === 'open' && e.ctrlKey && /^[1-8]$/.test(e.key)) {
      const order = state.settings.tabs.filter((t) => t.on);
      const t = order[+e.key - 1];
      if (t) openTab(t.id);
    }
  });
  setInterval(() => { renderCompact(); if (view === 'mini') renderMini(); }, 1000);
  bus.on('settings', () => { applyTheme(); renderCompact(true); });
  bus.on('mood-done', () => flashMood('mood-happy', 2000));
  bus.on('palette-prefill', (text) => { setView('palette'); openPalette(text); });
  document.addEventListener('island-theme', toggleTheme);
  bus.on('audio', ({ bands }) => {
    const bars = $$('.v-compact .bars i');
    for (let i = 0; i < bars.length; i++) bars[i].style.height = 15 + Math.min(85, bands[2 + i * 3] * 110) + '%';
  });
}
boot();
