import { api, bus, state, $, $$, h, esc, icon, mediaIcon, clock, bytes, coverColor, saveSettings, glyphTile, weatherIcon, EYE_FX } from './core.js';
import { audioActive } from './audio.js';
import { play as playSound } from './sounds.js';
import { initWater } from './water.js';
import { setBubbles, setBubbleClick, bubblesCursor, overBubble, bubblesHitArea } from './bubbles.js';
import { initJelly } from './jelly.js';
import { initMenu, openMenu, close as closeMenu } from './menu.js';
import { initCharacters, eyesHTML, flashMood, flags, applyMood, currentMood, playTrick } from './characters.js';
import { initPalette, openPalette, closePalette, paletteHeight } from './palette.js';
import home, { QUICK } from './tabs/home.js';
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
// effects (loading ring, bulb, notes, hearts, zZ, sparks…) float in their own layer
// that follows the character, so they can fly out past the island's edge
const fxl = document.createElement('div');
fxl.className = 'eyes fxl';
fxl.innerHTML = EYE_FX.replace('<div class="deco"><i></i><i></i><i></i><i></i></div>', '') + '<div class="zz"><b>z</b><b>z</b><b>Z</b></div><div class="hearts"><b>♥</b><b>♥</b><b>♥</b></div>';
stage.append(fxl);
// Pre-paint the big panel once after start, invisibly, so the very first opening doesn't stall
setTimeout(() => { if (view !== 'compact') return; isl.classList.add('prewarm'); setTimeout(() => isl.classList.remove('prewarm'), 400); }, 3000);
setInterval(() => positionFx(), 50);
function positionFx() {
  const host = view === 'compact' ? $('.v-compact .mid') : view === 'mini' ? $('.v-mini .mini-eyes') : null;
  const r = host && !stage.classList.contains('hidden') ? host.getBoundingClientRect() : null;
  if (!r || !r.width) { fxl.style.opacity = '0'; return; }
  fxl.style.opacity = '';
  fxl.style.left = (r.left + r.width / 2 - 10).toFixed(1) + 'px';
  fxl.style.top = (r.top + r.height / 2 - 10 + (view === 'compact' ? 4 : 0)).toFixed(1) + 'px';
}
const isl = $('#island');
const flash = $('#flash');
const sheen = document.querySelector('#island > .ib .sheen');
const WIN = { w: 880, h: 700 };
const TOP = 7;

let view = 'compact';
let hovering = false;
let pinnedOpen = false;
let activeTab = 'home';
let size = { w: 300, h: 38, r: 19 };
let toastQueue = [], toastTimer = null, currentToast = null;
let hideForFullscreen = false, revealUntil = 0;
// pulled up and hidden by the user; comes back when the cursor returns to the top centre
let stashed = false, stashArmed = false;
function stash() {
  stashed = true; stashArmed = false;
  isl.style.translate = '';
  if (view !== 'compact') setView('compact');
  stage.classList.add('hidden', 'stashing');
  setTimeout(() => stage.classList.remove('stashing'), 600);
  renderCompact(true);
  sendShape();
}
function unstash() {
  if (!stashed) return;
  stashed = false;
  stage.classList.remove('hidden');
  renderCompact(true);
  sendShape();
  playTrick('stretch');
}
function stashCursor(p) {
  if (!stashed) return;
  const zone = p.y <= 6 && Math.abs(p.x - WIN.w / 2) < 170;
  if (!zone && (p.y > 40 || Math.abs(p.x - WIN.w / 2) > 220)) stashArmed = true; // the cursor left: now it may come back
  if (zone && stashArmed) unstash();
}
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
      return { w: 800, h: Math.max(220, Math.min(610, ch + 92)), r: 34 };
    }
    default: {
      const a = primaryActivity();
      const w = { music: 500, download: 460, agent: 460, ask: 440, timer: 330, done: 420, clock: 310, call: 440 }[a?.kind || 'clock'] || 310;
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
  if (view === 'open') { root.style.setProperty('--ow', t.w + 'px'); root.style.setProperty('--oh', t.h + 'px'); }
  clearTimeout(shapeTimer);
  if (grow) sendShape(); else shapeTimer = setTimeout(sendShape, 560);
}

function sendShape() {
  const M = state.media?.playing && state.settings?.theme?.edgeDance !== false ? 26 : 12;
  const rects = [], hit = [];
  if (stashed || (hideForFullscreen && Date.now() > revealUntil && !hovering && view === 'compact')) {
    const hot = { x: WIN.w / 2 - 160, y: 0, width: 320, height: 4 };
    rects.push(hot); hit.push(hot);
  } else {
    const x = (WIN.w - size.w) / 2;
    const extraBelow = stage.classList.contains('char-buddies') && view === 'compact' || view === 'mini' ? 30 : 0;
    rects.push({ x: x - M, y: 0, width: size.w + 2 * M, height: TOP + size.h + M + extraBelow });
    hit.push({ x: x - 2, y: 0, width: size.w + 4, height: TOP + size.h + 4 });
    const ba = bubblesHitArea(x + size.w, TOP);
    if (ba) { rects.push(ba); hit.push(ba); }
    if (flash.classList.contains('on')) rects.push({ x: WIN.w / 2 - 200, y: TOP + size.h, width: 400, height: 70 });
  }
  // open menus and other floating panels must receive clicks
  for (const el of document.querySelectorAll('.hitzone')) {
    // layout box, not getBoundingClientRect(): menus open with a scale animation,
    // and measuring the shrunken box left their lower part click-through
    if (!el.offsetWidth) continue;
    const z = { x: el.offsetLeft - 4, y: el.offsetTop - 4, width: el.offsetWidth + 8, height: el.offsetHeight + 8 };
    rects.push(z); hit.push(z);
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
  if (state.agents.asks?.length) out.push({ kind: 'ask', prio: 100, ask: state.agents.asks[0], key: 'ask' });
  for (const call of state.calls || []) out.push({ kind: 'call', prio: 95, call, key: 'call:' + call.id });
  if (doneFlash && doneFlash.until > now) out.push({ kind: 'done', prio: 85, ...doneFlash, key: 'done' });
  const timers = state.reminders.filter((r) => !r.done && r.kind === 'timer' && r.at > now).sort((a, b) => a.at - b.at);
  if (timers[0]) out.push({ kind: 'timer', prio: 70, timer: timers[0], key: 'timer:' + timers[0].id });
  if (state.downloads.length) out.push({ kind: 'download', prio: 60, dl: state.downloads[0], count: state.downloads.length, key: 'download' });
  const working = state.agents.sessions?.filter((s) => s.state === 'working' && now - s.updated < 10 * 60e3) || [];
  const waiting = state.agents.sessions?.filter((s) => s.state === 'waiting') || [];
  // one activity per agent tool, so Claude and Codex can show at the same time
  for (const src of ['claude', 'codex']) {
    const w = waiting.find((x) => x.source === src);
    const k = working.filter((x) => x.source === src);
    if (w) out.push({ kind: 'agent', prio: 90, s: w, waiting: true, key: 'agent:' + src });
    else if (k[0]) out.push({ kind: 'agent', prio: 50, s: k[0], count: k.length, key: 'agent:' + src });
  }
  if (state.media?.active && !playerHidden() && (state.media.playing || now - (state.media.pausedAt || now) < 8e3)) out.push({ kind: 'music', prio: state.media.playing ? 40 : 20, key: 'music' });
  flags.agentWorking = working.length > 0;
  // the activity the user picked from a droplet stays on the main island while it lasts
  if (pinnedKey) {
    const pinned = out.find((x) => (x.key || x.kind) === pinnedKey);
    if (pinned) pinned.prio = 1000; else pinnedKey = null;
  }
  // folded activities live only as droplets; a fold is forgotten once the activity ends
  for (const x of out) x.folded = foldedKeys.has(x.key);
  for (const k of [...foldedKeys]) if (!out.some((x) => x.key === k)) foldedKeys.delete(k);
  return out.sort((a, b) => b.prio - a.prio);
}
let pinnedKey = null; // activity chosen by clicking its droplet
let aiPopup = false; // a sign-in window of an AI site is open
function primaryActivity() { return activities().find((x) => !x.folded) || null; }

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
  return `${weatherIcon(c.weather_code, c.is_day, 14)} ${Math.round(c.temperature_2m)}°`;
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
let walkX = 0, walkMid = null; // how far the character has walked from the middle
// long titles scroll (twice the text, loop by half) only when they really don't fit
function fitMarquee(el) {
  requestAnimationFrame(() => {
    for (const mq of el.querySelectorAll('.js-marq')) {
      const sp = mq.firstElementChild;
      if (!sp) continue;
      const t = mq.dataset.t;
      if (sp.scrollWidth > mq.clientWidth + 2) {
        mq.classList.add('run');
        sp.innerHTML = esc(t) + '&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;' + esc(t) + '&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;';
        sp.style.animationDuration = Math.max(8, t.length * 0.32) + 's';
      }
    }
  });
}
function renderCompact(force) {
  const el = $('.v-compact');
  const all = activities();
  const acts = all.filter((x) => !x.folded);
  const a = acts[0];
  const kind = a?.kind || 'clock';
  let key = kind, html = '';
  const eyes = eyesHTML('main');
  if (kind === 'music') {
    const m = state.media;
    key += m.key + m.thumb?.length;
    key += m.playing ? 'p' : 's';
    html = `<div class="side"><div class="cover" style="background-image:url('${m.thumb || ''}')"></div><div class="marq js-marq" data-t="${esc(m.title || '')}"><span>${esc(m.title)}</span></div></div>
      <div class="mid">${eyes}</div>
      <div class="side r"><div class="mpc"><button class="mpb" data-media="prev">${mediaIcon('prev', 13)}</button><button class="mpb big" data-media="toggle">${mediaIcon(m.playing ? 'pause' : 'play', 14)}</button><button class="mpb" data-media="next">${mediaIcon('next', 13)}</button></div><div class="bars">${'<i></i>'.repeat(5)}</div><button class="cbtn-s ghost fold" data-fold title="Свернуть в кружок сбоку">${icon('chevron', 13)}</button></div>`;
  } else if (kind === 'download') {
    const d = a.dl;
    key += d.name;
    html = `<div class="side"><div class="ring spin"></div><div class="marq"><span>${esc(d.name)}</span></div></div><div class="mid">${eyes}</div><div class="side r" style="flex:none"><span class="dim js-sub">${bytes(d.size)}${d.speed > 0 ? ' · ' + bytes(d.speed) + '/с' : ''}</span><button class="cbtn-s ghost fold" data-fold title="Свернуть в кружок сбоку">${icon('chevron', 13)}</button></div>`;
  } else if (kind === 'agent') {
    const s = a.s;
    key += s.id + a.waiting;
    html = a.waiting
      ? `<div class="side"><span class="alogo wait">${glyphTile({ kind: 'agent', source: s.source }, 20)}</span><span>${esc(s.project)}</span></div><div class="mid">${eyes}</div><div class="side r"><span class="dim">нужен ответ</span><button class="cbtn-s ghost fold" data-fold title="Свернуть в кружок сбоку">${icon('chevron', 13)}</button></div>`
      : `<div class="side"><span class="alogo work">${glyphTile({ kind: 'agent', source: s.source }, 20)}</span><span>${s.source === 'codex' ? 'Codex' : 'Claude'} трудится</span></div><div class="mid">${eyes}</div><div class="side r"><span class="dim js-sub">${esc(s.project)}${a.count > 1 ? ' +' + (a.count - 1) : ''}</span><button class="cbtn-s ghost fold" data-fold title="Свернуть в кружок сбоку">${icon('chevron', 13)}</button></div>`;
  } else if (kind === 'ask') {
    key += a.ask.id;
    html = `<div class="side"><span class="alogo wait">${glyphTile({ kind: 'agent', source: a.ask.source }, 20)}</span><span>${esc(a.ask.project)}</span></div><div class="mid">${eyes}</div><div class="side r dim">${a.ask.kind === 'permission' ? 'разрешить?' : 'вопрос'}</div>`;
  } else if (kind === 'call') {
    const c = a.call;
    key += c.id + c.micMuted + c.soundMuted;
    key += c.icon ? 'i' : '';
    html = `<div class="side"><span class="callapp">${callLogo(c, 'callico')}<span>${esc(c.name)}</span></span><span class="dim js-sub" style="font-variant-numeric:tabular-nums">${clock((Date.now() - c.since) / 1000)}</span></div>
      <div class="mid">${eyes}</div>
      <div class="side r"><button class="cbtn-s ghost" data-fold title="Свернуть звонок в значок">${icon('chevron', 13)}</button><button class="cbtn-s${c.micMuted ? ' muted' : ''}" data-call="mic" title="${c.micMuted ? 'Включить микрофон' : 'Выключить микрофон'}">${icon(c.micMuted ? 'micoff' : 'mic', 14)}</button><button class="cbtn-s${c.soundMuted ? ' muted' : ''}" data-call="sound" title="${c.soundMuted ? 'Вернуть звук звонка' : 'Заглушить звук звонка'}">${icon(c.soundMuted ? 'mute' : 'volume', 14)}</button></div>`;
  } else if (kind === 'timer') {
    key += a.timer.id;
    html = `<div class="side"><span class="tmr">${icon('timer', 15)}</span><span class="dim marq"><span>${esc(a.timer.text || 'Таймер')}</span></span></div><div class="mid">${eyes}</div><div class="side r"><span class="js-sub" style="font-variant-numeric:tabular-nums">${clock((a.timer.at - Date.now()) / 1000)}</span><button class="cbtn-s ghost fold" data-fold title="Свернуть в кружок сбоку">${icon('chevron', 13)}</button></div>`;
  } else if (kind === 'done') {
    key += a.project;
    html = `<div class="side"><div class="okdot">${icon('check', 12)}</div><span>Готово</span></div><div class="mid">${eyes}</div><div class="side r"><span class="dim">${esc(a.project)}</span><button class="cbtn-s ghost fold" data-fold title="Свернуть в кружок сбоку">${icon('chevron', 13)}</button></div>`;
  } else {
    html = `<div class="side dim js-date">${esc(dateText())}</div><div class="mid">${eyes}</div><div class="side r"><span class="js-time">${timeText()}</span><span class="dim js-w">${weatherText()}</span></div>`;
  }
  if (force || key !== compactKey) {
    compactKey = key;
    el.innerHTML = html;
    { const nm = $('.mid', el); if (nm && walkX) { nm.style.translate = walkX.toFixed(2) + 'px 0'; nm._wx = walkX; walkMid = nm; } } // no jump back to the middle
    applySize();
    fitMarquee(el);
  } else {
    const t = $('.js-time', el); if (t) t.textContent = timeText();
    const w = $('.js-w', el); if (w) { const wt = weatherText(); if (w._wt !== wt) { w._wt = wt; w.innerHTML = wt; } }
    const dd = $('.js-date', el); if (dd) dd.textContent = dateText();
    const sub = $('.js-sub', el);
    if (sub && kind === 'download') sub.textContent = `${bytes(a.dl.size)}${a.dl.speed > 0 ? ' · ' + bytes(a.dl.speed) + '/с' : ''}`;
    if (sub && kind === 'timer') sub.textContent = clock((a.timer.at - Date.now()) / 1000);
    if (sub && kind === 'call') sub.textContent = clock((Date.now() - a.call.since) / 1000);
  }
  // the other activities become droplets to the right of the island
  const drops = [];
  const seen = new Set([a?.key || a?.kind]);
  for (const x of all) if (x.folded && !seen.has(x.key)) { seen.add(x.key); drops.push({ ...x }); }
  for (const x of acts.slice(1)) {
    const k = x.key || x.kind;
    if (seen.has(k)) continue;
    seen.add(k);
    drops.push({ ...x, key: k });
  }
  setBubbles(drops.slice(0, state.settings.island.maxBubbles ?? 4).map(dropItem), !(view === 'compact' || view === 'mini' || view === 'toast' || view === 'ask') || hideForFullscreen || stashed);
  sendShape();
}

// "Плеер на острове" off: the track leaves the pill, the droplet row and the mini
// island — but the island keeps dancing to the music (edge, waves, glow, eyes).
const playerHidden = () => state.settings?.island?.showPlayer === false;
export function hideMusic(show = false) {
  state.settings.island.showPlayer = show;
  saveSettings();
  if (!show && view === 'mini') setView('compact');
  renderCompact(true);
  flashBelow({ icon: '🎵', title: show ? 'Плеер снова на острове' : 'Плеер убран — остров танцует дальше', ms: 1800 });
}

// Content of one droplet for an activity.
function dropItem(x) {
  const k = x.key;
  switch (x.kind) {
    case 'call': {
      const c = x.call;
      return { key: k, cls: 'call', act: x, title: `${c.name} · ${clock((Date.now() - c.since) / 1000)} — ${x.folded ? 'развернуть звонок' : 'открыть'}`,
        sig: 'call' + c.id + c.micMuted + (c.icon ? 'i' : ''), html: `${callLogo(c, 'bubble-logo')}${c.micMuted ? `<span class="mutedot">${icon('micoff', 9)}</span>` : ''}` };
    }
    case 'agent': {
      const src = x.s.source === 'codex' ? 'codex' : 'claude';
      return { key: k, cls: `agent ${src}${x.waiting ? ' waiting' : ''}`, act: x, sig: 'ag' + src + x.waiting,
        title: `${src === 'codex' ? 'Codex' : 'Claude'} · ${x.s.project} — ${x.waiting ? 'нужен ответ' : 'трудится'}`,
        html: glyphTile({ kind: 'agent', source: src }, 40, 'gtile fill') };
    }
    case 'music': return { key: k, cls: 'music', act: x, sig: 'm' + state.media.key + (state.media.thumb ? 't' : ''), title: `${state.media.title} — ${state.media.artist || ''}${x.folded ? ' · нажми, чтобы развернуть' : ''}`, html: `<div class="cover" style="background-image:url('${state.media.thumb || ''}')"></div>` };
    case 'download': return { key: k, cls: 'dl', act: x, sig: 'dl', title: (x.dl?.name || 'Загрузка') + (x.folded ? ' · нажми, чтобы развернуть' : ''), html: `<span class="ring spin"></span>${icon('download', 12)}` };
    case 'timer': return { key: k, cls: 'timer', act: x, sig: 't' + x.timer.id, title: x.timer.text || 'Таймер', html: icon('timer', 17) };
    case 'done': return { key: k, cls: 'done', act: x, sig: 'done', title: 'Готово', html: glyphTile({ done: true }, 28, 'gtile') };
    case 'ask': return { key: k, cls: 'agent waiting', act: x, sig: 'ask', title: 'Агент ждёт ответа', html: glyphTile({ kind: 'agent', source: x.ask?.source }, 40, 'gtile fill') };
    default: return { key: k, act: x, sig: k, html: '•' };
  }
}

// Activities the user folded into a side droplet (by key); a click on the droplet unfolds it.
const foldedKeys = new Set();
function foldActivity(key) {
  if (!key) return;
  foldedKeys.add(key);
  if (pinnedKey === key) pinnedKey = null;
  renderCompact(true);
}
function callLogo(c, cls) {
  return c.icon ? `<img class="${cls}" src="${c.icon}" alt="">` : `<span class="${cls} fallback">${esc((c.name || '?')[0])}</span>`;
}

// ---------------- mini player (hover) ----------------
function renderMini() {
  const m = state.media;
  const el = $('.v-mini');
  if (!m?.active || playerHidden()) return renderMiniSummary(el);
  el.classList.remove('sum');
  const key = m.key + (m.thumb?.length || 0);
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.innerHTML = `<div class="art" style="background-image:url('${m.thumb || ''}')"></div>
      <div class="meta"><div class="trow"><div class="t">${esc(m.title)}</div>${eyesHTML('main mini-eyes')}</div><div class="a">${esc(m.artist || m.app)}</div>
        <div class="prog"><span class="js-pos">0:00</span><div class="track js-seek"><i></i></div><span class="js-dur">${clock(m.duration || 0)}</span></div></div>
      <div class="ctl"><button class="cbtn" data-c="prev">${mediaIcon('prev', 19)}</button><button class="cbtn big js-pp" data-c="toggle"></button><button class="cbtn" data-c="next">${mediaIcon('next', 19)}</button></div>`;
    for (const b of $$('[data-c]', el)) b.onclick = (e) => { e.stopPropagation(); api.invoke('media:cmd', b.dataset.c); };
    $('.js-seek', el).onclick = (e) => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      if (m.canSeek && m.duration) api.invoke('media:cmd', 'seek', { position: ((e.clientX - r.left) / r.width) * m.duration });
    };
  }
  $('.js-pp', el).innerHTML = mediaIcon(m.playing ? 'pause' : 'play', 19);
  $('.js-pos', el).textContent = clock(m.position || 0);
  $('.js-dur', el).textContent = clock(m.duration || 0);
  $('.track', el).style.setProperty('--p', m.duration ? m.position / m.duration : 0);
}

// Mini island without music: big clock, weather and a few quick actions.
function renderMiniSummary(el) {
  el.classList.add('sum');
  if (el.dataset.key !== 'sum') {
    el.dataset.key = 'sum';
    const acts = [['region', 'Скриншот'], ['timer', 'Таймер'], ['ai', 'ИИ'], ['clip', 'Буфер']];
    el.innerHTML = `<div class="ms-clock"><b class="js-mt"></b><small class="js-md"></small></div>
      <div class="ms-w js-mw"></div>
      <div class="ms-acts">${acts.map(([id, t]) => `<button class="cbtn" data-q="${id}" title="${t}">${icon(QUICK[id].icon, 17)}</button>`).join('')}</div>`;
    for (const b of $$('[data-q]', el)) b.onclick = (e) => { e.stopPropagation(); QUICK[b.dataset.q].run(ctx); };
  }
  $('.js-mt', el).textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  $('.js-md', el).textContent = dateText();
  const c = state.weather?.current;
  $('.js-mw', el).innerHTML = c ? `<span class="ms-e">${weatherIcon(c.weather_code, c.is_day, 30)}</span><span><b>${Math.round(c.temperature_2m)}°</b><small>${esc(state.weather.place || '')}</small></span>` : '';
}

// ---------------- toasts & notifications ----------------
function showToast(t) {
  if (t.icon === '⚠️') { flashMood('mood-angry', 2600); playSound('error'); } // errors make the island angry (and red)
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
  el.innerHTML = `<div class="ti">${glyphTile(t, 40)}</div>
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
  flash.innerHTML = `${t.thumb ? `<div class="th" style="background-image:url('${t.thumb}')"></div>` : glyphTile(t, 24)}<span>${esc(t.title)}</span>`;
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
  if (ans) flashMood('mood-idea', 2400); // gave an answer -> a light bulb
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
      const page = h('div', { class: 'page', 'data-id': t.id, 'data-fixed': m.fixedHeight ? '' : null });
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
// Hovered-tab label: opens after a short pause and only follows real mouse movement.
// (When a label opens, the tabs next to it shift; reacting to that shift made them
// flicker back and forth under a still cursor.)
let hvTab = null, hvTimer = 0, hvX = -1, hvLock = 0;
document.addEventListener('pointermove', (e) => {
  const strip = e.target.closest?.('.tabs');
  if (!strip) return;
  const moved = Math.abs(e.clientX - hvX) > 1.5;
  hvX = e.clientX;
  const t = e.target.closest('.tab');
  if (!t || t === hvTab || !moved || performance.now() < hvLock) return;
  clearTimeout(hvTimer);
  hvTimer = setTimeout(() => {
    hvTab?.classList.remove('hv');
    hvTab = t; t.classList.add('hv');
    hvLock = performance.now() + 380;
    moveIndicator();
  }, hvTab ? 110 : 70);
});
document.addEventListener('pointerout', (e) => {
  if (!e.target.closest?.('.tabs') || e.relatedTarget?.closest?.('.tabs')) return;
  clearTimeout(hvTimer);
  hvTimer = setTimeout(() => { hvTab?.classList.remove('hv'); hvTab = null; moveIndicator(); }, 220);
});
// any width change in the tab strip (hover labels, tab switch) restarts the chase
const tabsObserver = new ResizeObserver(moveIndicator);
document.addEventListener('transitionrun', (e) => { if (e.target.closest?.('.tabs')) moveIndicator(); });
document.addEventListener('mouseover', (e) => { if (e.target.closest?.('.tabs')) moveIndicator(); });
let pageObserver = null;
export function openTab(id) {
  if (!TABS[id]) return;
  if (TABS[id].external) { collapse(false); api.invoke('settings:open'); return; } // settings live in their own window
  const order = state.settings.tabs.filter((t) => t.on).map((t) => t.id);
  const dir = order.indexOf(id) >= order.indexOf(activeTab) ? 1 : -1;
  const prev = activeTab;
  activeTab = id;
  if (view !== 'open') { setView('open'); api.invoke('island:focus'); playSound('open'); }
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
// "По умолчанию": the island's colours follow its mood (red when angry / on errors,
// violet when sleepy, cyan when busy, blue when thinking, warm when happy, the
// cover colour while music plays). Colours glide thanks to registered properties.
const MOOD_PALETTES = {
  '': [['#7c5cff', '#00d4ff', '#ff4fd8'], '#7c5cff'],
  angry: [['#ff2e3c', '#ff7a3d', '#c3133a'], '#ff3b3b'],
  sleepy: [['#7c4dff', '#b39dff', '#4b2fb0'], '#9b7bff'],
  sleep: [['#5b3fd1', '#8f73ff', '#2c1d6e'], '#7a5cff'],
  busy: [['#00a8ff', '#4fd8ff', '#1f5cff'], '#3cc8ff'],
  think: [['#5d6bff', '#a9b8ff', '#8a5cff'], '#8090ff'],
  happy: [['#ffc14d', '#ff9f43', '#ffe08a'], '#ffc14d'],
  shy: [['#ff6fa5', '#ffb3d1', '#c86bff'], '#ff7fb0'],
  idea: [['#ffd23f', '#ffb020', '#fff1a8'], '#ffd23f'],
  joy: [['#34d399', '#a3e635', '#22c55e'], '#4ade80'],
  ponder: [['#8b6bff', '#5d8bff', '#c084fc'], '#9a7bff'],
  sad: [['#5b7bb5', '#7d93c4', '#3d5a99'], '#6f8fd0'],
  startle: [['#ffffff', '#c9e4ff', '#ffd6f5'], '#ffffff'],
};
function moodColors() {
  const m = (currentMood() || '').replace('mood-', '');
  if (m === 'dance') { const cov = coverGlowColor || '#ff4fd8'; return [[cov, '#7c5cff', '#00d4ff'], cov]; }
  return MOOD_PALETTES[m] || MOOD_PALETTES[''];
}

const PLAIN = {
  white: { mode: 'light', base: '#ffffff', colors: ['#d9d9e1', '#c7c7d1', '#ececf1'], glow: '#9d9daa' },
  black: { mode: 'dark', base: '#000000', colors: ['#2c2c33', '#1d1d22', '#3a3a42'], glow: '#6e6e7a' },
};
function applyTheme() {
  const t = state.settings.theme;
  if (t.style === 'white' || t.style === 'black') { t.mode = t.style === 'white' ? 'light' : 'dark'; t.style = 'solid'; saveSettings(); }
  const plain = PLAIN[t.style]; // plain white / black: no colour at all
  root.dataset.mode = plain ? plain.mode : t.mode;
  root.dataset.plain = plain ? t.style : '';
  const moodStyle = t.style === 'mood';
  const [c1, c2, c3] = plain ? plain.colors : moodStyle ? moodColors()[0] : t.colors;
  root.style.setProperty('--c1', c1);
  root.style.setProperty('--c2', c2);
  root.style.setProperty('--c3', c3);
  root.style.setProperty('--glowK', t.glow);
  if (t.glowColor) root.style.setProperty('--glow', t.glowColor);
  else if (plain) root.style.setProperty('--glow', plain.glow);
  else if (moodStyle) root.style.setProperty('--glow', moodColors()[1]);
  else if (!coverGlowColor || !t.coverGlow) root.style.setProperty('--glow', c1);
  const dark = (plain ? plain.mode : t.mode) === 'dark';
  const op = plain ? [0, 0, 0] : { mood: [0.85, 0.4, 0], liquid: [0.55, 0, 0], gradient: [0.2, 1, 0], glass: [0.35, 0, 1], solid: [0, 0, 0] }[t.style] || [0.5, 0, 0];
  root.style.setProperty('--liquidOp', op[0]);
  root.style.setProperty('--flowOp', op[1]);
  root.style.setProperty('--glassOp', op[2]);
  root.style.setProperty('--sheenOp', t.cursorGlow ? 1 : 0);
  const base = plain ? plain.base : moodStyle ? (dark ? 'rgba(8,8,12,.96)' : 'rgba(250,250,253,.95)') : t.style === 'glass' ? (dark ? 'rgba(22,22,32,.66)' : 'rgba(255,255,255,.6)') : t.style === 'solid' ? (dark ? t.solid : '#f7f7fa') : dark ? 'rgba(6,6,10,.94)' : 'rgba(250,250,253,.9)';
  root.style.setProperty('--base', base);
  applyMood();
}
function toggleTheme() {
  const th = state.settings.theme;
  th.mode = th.mode === 'dark' ? 'light' : 'dark';
  applyTheme();
  playTrick('dizzy');
  saveSettings();
  if (view === 'open') buildTabs();
}
let coverGlowColor = null;
async function updateCoverGlow() {
  coverGlowColor = state.settings.theme.coverGlow && state.media?.thumb ? await coverColor(state.media.thumb) : null;
  if (state.settings.theme.style === 'mood') applyTheme();
  else root.style.setProperty('--glow', state.settings.theme.glowColor || coverGlowColor || state.settings.theme.colors[0]);
}

// ---------------- cursor reactions ----------------
function onCursor(p) {
  stashCursor(p);
  if (stashed) return;
  const r = isl.getBoundingClientRect();
  const inside = p.x >= r.left - 2 && p.x <= r.right + 2 && p.y >= 0 && p.y <= r.bottom + 2;
  const onBubble = overBubble(p);
  bubblesCursor(p);
  // Cursor-driven styles go straight onto the few elements that use them.
  // (Custom properties on :root/#island are inherited, so changing them every
  // frame would restyle the whole island and make it stutter.)
  sheen.style.setProperty('--mxp', (p.x - r.left).toFixed(1) + 'px');
  sheen.style.setProperty('--myp', (p.y - r.top).toFixed(1) + 'px');
  const dx = p.x - (r.left + r.width / 2), dy = p.y - (r.top + r.height / 2);
  const edgeDist = Math.max(0, Math.max(Math.abs(dx) - r.width / 2, Math.abs(dy) - r.height / 2));
  const near = Math.max(0, 1 - edgeDist / 180);
  state.near = near;
  stage.classList.toggle('curious', state.settings.island.cursorReactions !== false && near > 0.35 && !inside && (view === 'compact' || view === 'mini'));
  const small = view === 'compact' || view === 'mini' || view === 'toast';
  let tx = 0, ty = 0, rx = 0, ry = 0, sc = 1;
  if (state.settings?.theme?.reactive && small && !onBubble) {
    const k = near * near;
    tx = Math.max(-6, Math.min(6, dx * 0.02 * k));
    ty = Math.max(0, Math.min(4, dy * 0.02 * k));
    ry = Math.max(-1, Math.min(1, dx / 300)) * 7 * k;
    rx = -Math.max(-1, Math.min(1, dy / 200)) * 6 * k;
    sc = inside && view === 'compact' ? 1.045 : 1;
  }
  isl.style.transform = `translateX(-50%) translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${sc}) perspective(700px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
  trackPlay(p, inside);
  const was = hovering;
  hovering = inside || onBubble;
  islandHover = inside;
  if (hovering !== was) onHover(hovering);
}

// ---- playing with the island & resting on it ----
// Wiggling the mouse fast over the island makes it happy (like being played with);
// resting the cursor on it (still or very slow) for 2 s opens the mini island.
let islandHover = false, lastP = null, lastT = 0, playDist = 0, playT0 = 0, lastHappy = 0;
let restAt = null, restT = 0; // where/when the cursor came to rest on the island
let restShy = false, lastShy = 0;
// The character walks along the free middle of the pill: wanders on its own and
// comes over to the cursor. Movement is a damped spring (smooth start and stop),
// and it never steps onto the text on either side.
let walkNext = 0, wv = 0, wTarget = 0, wMin = 0, wMax = 0, wLast = 0, bob = null;
// what is actually drawn in a side (text nodes included), in screen pixels
function sideBox(side) {
  let l = Infinity, r = -Infinity;
  for (const n of side.childNodes) {
    let rc = null;
    if (n.nodeType === 3) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n); rc = rg.getBoundingClientRect();
    } else if (n.nodeType === 1 && n.offsetWidth) rc = n.getBoundingClientRect();
    if (!rc || !rc.width) continue;
    l = Math.min(l, rc.left); r = Math.max(r, rc.right);
  }
  return l < r ? [l, r] : null;
}
setInterval(() => {
  const el = $('.v-compact');
  const mid = el && $('.mid', el);
  if (view !== 'compact' || stashed || !mid) return;
  const L = $('.side:not(.r)', el), Rt = $('.side.r', el);
  if (!L || !Rt) return;
  const er = el.getBoundingClientRect();
  const sc = er.width / (el.offsetWidth || 1) || 1;
  const mr = mid.getBoundingClientRect();
  const baseL = mr.left - walkX * sc; // where it would stand without walking
  const lb = sideBox(L), rb = sideBox(Rt);
  const gap = 14 * sc;
  const lEnd = (lb ? lb[1] : er.left) + gap, rStart = (rb ? rb[0] : er.right) - gap;
  wMin = (lEnd - baseL) / sc;
  wMax = (rStart - mr.width - baseL) / sc;
  if (wMax < wMin) wMin = wMax = (wMin + wMax) / 2; // too tight: stay in the middle of the gap
  // stands in the middle; when the mouse is near, it stretches toward it (like it's curious)
  const near = state.near || 0;
  if (state.settings.island.walk === false || /mood-sleep/.test(stage.className) || !lastP || near <= 0) { wTarget = Math.max(wMin, Math.min(wMax, 0)); return; }
  const dx = (lastP.x - (baseL + mr.width / 2)) / sc;
  const reach = 16 + 10 * near; // a bit further when the mouse is right on it
  wTarget = Math.max(-reach, Math.min(reach, dx * 0.16 * (0.4 + 0.6 * near)));
}, 90);
function startBob(eyes) {
  bob?.cancel();
  // a two-step waddle that starts and ends in the rest pose
  bob = eyes.animate([
    { transform: 'translateY(0) rotate(0deg)' }, { transform: 'translateY(-2.4px) rotate(4deg)', offset: 0.25 },
    { transform: 'translateY(0) rotate(0deg)', offset: 0.5 }, { transform: 'translateY(-2.4px) rotate(-4deg)', offset: 0.75 },
    { transform: 'translateY(0) rotate(0deg)' },
  ], { duration: 620, iterations: Infinity, composite: 'add', easing: 'linear' });
  bob._el = eyes;
}
function stopBob() {
  const b = bob; bob = null;
  if (!b) return;
  // finish the current step and come to rest exactly in the neutral pose
  const t = b.currentTime || 0;
  b.effect.updateTiming({ iterations: Math.max(0.5, Math.ceil(t / 310) / 2) });
  b.onfinish = () => b.cancel();
}
function walkFrame(now) {
  requestAnimationFrame(walkFrame);
  const dt = Math.min(0.05, (now - (wLast || now)) / 1000);
  wLast = now;
  const mid = view === 'compact' && !stashed && !document.hidden ? $('.v-compact .mid') : null;
  if (!mid) { if (bob) stopBob(); return; }
  const t = Math.max(wMin, Math.min(wMax, wTarget));
  const W = 7; // spring stiffness; critically damped -> no overshoot, soft stop
  wv += (W * W * (t - walkX) - 2 * W * wv) * dt;
  wv = Math.max(-120, Math.min(120, wv));
  walkX += wv * dt;
  if (Math.abs(t - walkX) < 0.25 && Math.abs(wv) < 1.5) { walkX = t; wv = 0; }
  if (mid !== walkMid || mid._wx !== walkX) {
    walkMid = mid; mid._wx = walkX;
    mid.style.translate = walkX.toFixed(2) + 'px 0';
    positionFx();
  }
  // stretches in the direction it moves, then settles back round
  const st = Math.min(0.28, Math.abs(wv) / 160);
  const sk = `${(1 + st).toFixed(3)} ${(1 - st * 0.55).toFixed(3)}`;
  if (mid._sk !== sk) { mid._sk = sk; mid.style.scale = sk; mid.style.rotate = (wv * 0.05).toFixed(2) + 'deg'; }
  if (bob) stopBob();
}
requestAnimationFrame(walkFrame);
function trackPlay(p, inside) {
  const now = performance.now();
  if (state.settings.island.cursorReactions !== false && inside && !islandHover && lastP && now - lastShy > 6000) {
    const sp = (Math.hypot(p.x - lastP.x, p.y - lastP.y) / Math.max(1, now - lastT)) * 1000;
    if (sp < 350) { lastShy = now; flashMood('mood-shy', 1800); }
  }
  if (!inside) { restAt = null; restShy = false; }
  else if (!restAt || Math.hypot(p.x - restAt.x, p.y - restAt.y) > 14) { restAt = p; restT = now; restShy = false; }
  if (lastP && inside) {
    const dt = Math.max(1, now - lastT);
    const dist = Math.hypot(p.x - lastP.x, p.y - lastP.y);
    const speed = (dist / dt) * 1000;
    if (speed > 1300) {
      if (!playT0 || now - playT0 > 1400) { playT0 = now; playDist = 0; }
      playDist += dist;
      if (playDist > 1100 && now - lastHappy > 3500) {
        lastHappy = now; playDist = 0; flashMood('mood-shy', 2600); // played with -> shy and loving
      }
    }
  }
  lastP = p; lastT = now;
}
setInterval(() => {
  if (!islandHover || view !== 'compact' || hideForFullscreen) return;
  const restFor = restAt ? performance.now() - restT : 0;
  if (restAt && !restShy && restFor >= 450) { restShy = true; lastShy = performance.now(); flashMood('mood-shy', 2200); }
  if (restAt && restFor >= (state.settings.island.miniDelay ?? 1.5) * 1000) { restAt = null; renderMini(); setView('mini'); }
}, 120);
let hoverTimer = null;
function onHover(on) {
  clearTimeout(hoverTimer);
  isl.classList.toggle('hov', on);
  if (on) {
    if (hideForFullscreen && !stashed) { revealUntil = Date.now() + 1e9; stage.classList.remove('hidden'); sendShape(); }
  } else {
    hoverTimer = setTimeout(() => {
      if (view === 'mini') setView('compact');
      if (hideForFullscreen && view === 'compact' && !stashed) { revealUntil = 0; stage.classList.add('hidden'); sendShape(); }
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
    if (dragDepth++ === 0 && view !== 'open') { prevView = view; setView('drop'); flashMood('mood-startle', 700); }
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
      flashMood('mood-joy', 1500);
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
  api.on('ai-popup', (on) => { aiPopup = !!on; });
  api.on('blur', () => {
    closeMenu();
    if (aiPopup) return;
    if (pinnedOpen || !(view === 'open' || view === 'palette' || view === 'drop')) return;
    // focus taken by another program while the cursor is still on the island:
    // the user didn't click away, so keep it open and take focus back
    if (islandHover) { api.invoke('island:focus'); return; }
    collapse(false);
  });
  api.on('settings', (s) => {
    // merge into the same object: open settings controls keep editing what gets saved
    for (const k of Object.keys(s)) state.settings[k] = s[k];
    applyTheme(); bus.emit('settings', state.settings); bus.emit('settings-external');
    buildTabs();
  });
  let topClip;
  api.on('clips', (c) => { const id = c?.[0]?.id ?? c?.[0]?.at; if (topClip !== undefined && id !== undefined && id !== topClip) playSound('clip'); topClip = id ?? null; state.clips = c; bus.emit('clips', c); });
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
    if (view === 'mini') renderMini(); // switches between player and summary by itself
    renderCompact();
  });
  api.on('calls', (c) => {
    state.calls = c;
    bus.emit('calls', c);
    renderCompact(true);
  });
  api.on('lyrics', (l) => { state.lyrics = l; bus.emit('lyrics', l); });
  api.on('notification', (n) => {
    state.notifications.unshift(n);
    state.notifications.length = Math.min(50, state.notifications.length);
    bus.emit('notification', n);
    if (n.silent) return;
    playSound(n.kind === 'reminder' ? (n.icon === '⏱' ? 'timer' : 'reminder') : n.kind === 'agent' ? (n.done ? 'agentDone' : 'agentAsk') : n.kind === 'call' ? 'call' : 'notify');
    if (n.askId) return; // handled by the ask view
    if (n.done) { doneFlash = { project: n.title.split(':')[0], source: n.source, until: Date.now() + 8000 }; renderCompact(); setTimeout(renderCompact, 8100); }
    showToast({ ...n, app: n.app || (n.kind === 'reminder' ? 'Напоминание' : n.kind === 'rain' ? 'Погода' : n.kind === 'agent' ? 'Агент' : ''), ms: n.sticky ? 10000 : 5000 });
  });
  api.on('agents', (a) => {
    state.agents = a;
    bus.emit('agents', a);
    if (a.asks?.length) { renderAsk(); flags.agentWorking = true; } else if (view === 'ask') setView('compact');
    renderCompact();
    applyMood();
  });
  api.on('toast', (t) => { playTrick('wink'); if (t.icon !== '⚠️') playSound('capture'); return view === 'open' || view === 'palette' ? flashBelow(t) : showToast(t); });
  api.on('fg-change', (n) => bus.emit('fg-change', n));
  api.on('ocr-result', (r) => { openTab('text'); bus.emit('text-set', r.text); flashBelow({ icon: '🔤', title: r.translated ? 'Переведено и скопировано' : 'Текст скопирован в буфер', ms: 2200 }); });
  api.on('fullscreen', (f) => {
    hideForFullscreen = f;
    stage.classList.toggle('hidden', stashed || (f && !hovering && view === 'compact'));
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
  initMenu({ refresh: () => sendShape(), openTab, palette: () => { setView('palette'); openPalette(); }, hideMusic });
  initPalette({ setView, resize, collapse, openTab, flash: flashBelow });
  buildTabs();
  initJelly(document.querySelector('.pages'));
  wire();
  initDrop();
  renderCompact(true);
  updateCoverGlow();
  api.invoke('agents:list'); // re-sync pending agent questions after a reload
  api.invoke('calls:list');
  if (state.media?.playing) audioActive(true);

  // poking the island many times in a row makes it angry
  let pokes = [];
  isl.addEventListener('pointerdown', () => {
    const now = Date.now();
    pokes = pokes.filter((t) => now - t < 1500);
    pokes.push(now);
    playTrick('boop');
    if (pokes.length === 2 && Math.random() < 0.5) flashMood('mood-shy', 1400);
    if (pokes.length >= 4) { pokes = []; flashMood('mood-angry', 2600); }
  });
  setBubbleClick((item) => {
    // swap: this activity goes to the main island, the current one becomes a droplet
    const x = item.act;
    if (!x) return;
    ctx.swallowClick();
    foldedKeys.delete(x.key);
    pinnedKey = x.key || x.kind;
    renderCompact(true);
  });
  // Press, not click: the pill's content is re-rendered often (timers, moods, swaps),
  // so the element under the cursor can change between press and release and the
  // browser then never fires 'click'. The stray click that follows is swallowed.
  let swallowUntil = 0;
  window.addEventListener('click', (e) => {
    if (performance.now() < swallowUntil) { swallowUntil = 0; e.stopPropagation(); e.preventDefault(); }
  }, true);
  ctx.swallowClick = () => { swallowUntil = performance.now() + 700; };
  isl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !(view === 'compact' || view === 'mini' || view === 'toast')) return;
    if (e.target.closest('.v-ask, .v-mini button, .v-toast button')) return; // real buttons keep their clicks
    ctx.swallowClick();
    if (e.target.closest('[data-fold], [data-call], [data-media]')) { islandPress(e); return; }
    // a press can become a drag: pull the island up to hide it
    const g = { x: e.clientX, y: e.clientY, target: e.target, done: false };
    try { isl.setPointerCapture(e.pointerId); } catch {}
    const end = (ev) => {
      if (g.done) return;
      g.done = true;
      isl.removeEventListener('pointermove', move);
      if (!ev || Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < 10) islandPress({ target: g.target });
    };
    const move = (ev) => {
      if (g.done) return;
      const up = g.y - ev.clientY;
      if (state.settings.island.swipeHide !== false && (up >= 9 || (ev.clientY <= 2 && up >= 3))) { g.done = true; isl.removeEventListener('pointermove', move); stash(); }
      else if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) > 10) isl.style.translate = `0 ${Math.min(0, -up) * 0.6}px`;
    };
    isl.addEventListener('pointermove', move);
    isl.addEventListener('pointerup', (ev) => { isl.style.translate = ''; end(ev); }, { once: true });
    isl.addEventListener('lostpointercapture', (ev) => { isl.style.translate = ''; end(ev); }, { once: true });
  });
  function islandPress(e) {
    const mb = e.target.closest('[data-media]');
    if (mb) { api.invoke('media:cmd', mb.dataset.media); return; }
    if (e.target.closest('[data-fold]')) { foldActivity(primaryActivity()?.key); return; }
    const callBtn = e.target.closest('[data-call]');
    if (callBtn && state.calls?.[0]) {
      const id = state.calls[0].id, act = callBtn.dataset.call;
      api.invoke(act === 'mic' ? 'calls:mic' : act === 'sound' ? 'calls:sound' : 'calls:focus', id);
      return;
    }
    if (view === 'compact' || view === 'mini') expand('home');
    else if (view === 'toast') {
      const t = currentToast;
      if (t?.kind === 'agent' || t?.kind === 'reminder') expand('home');
      nextToast();
    }
  }
  // spinning the mouse wheel over the pill makes it dizzy
  let lastWheel = 0;
  isl.addEventListener('wheel', () => {
    if (view !== 'compact' && view !== 'mini') return;
    const t = performance.now();
    if (t - lastWheel > 1500) { lastWheel = t; playTrick('dizzy'); }
  }, { passive: true });
  // right click anywhere on the island (except text fields) opens the island menu
  isl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea, [contenteditable], .clip, .fitem')) return;
    e.preventDefault();
    playTrick('peekdown');
    openMenu(e.clientX, e.clientY);
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
  bus.on('mood-done', () => flashMood('mood-idea', 2400));
  bus.on('mood-changed', () => { if (state.settings.theme.style === 'mood') applyTheme(); });
  bus.on('palette-prefill', (text) => { setView('palette'); openPalette(text); });
  document.addEventListener('island-theme', toggleTheme);
  bus.on('audio', ({ bands }) => {
    const bars = $$('.v-compact .bars i');
    for (let i = 0; i < bars.length; i++) bars[i].style.height = 15 + Math.min(85, bands[2 + i * 3] * 110) + '%';
  });
}
boot();
