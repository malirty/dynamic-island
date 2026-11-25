import { api, bus, state, $, $$, h, esc, icon, mediaIcon, clock, bytes, coverColor, saveSettings, glyphTile, weatherIcon, EYE_FX, setProgress, SKINS, setPP } from './core.js';
import { audioActive } from './audio.js';
import { play as playSound } from './sounds.js';
import { initWater } from './water.js';
import { setBubbles, setBubbleClick, bubblesCursor, overBubble, bubblesHitArea } from './bubbles.js';
import { initJelly } from './jelly.js';
import { initMenu, openMenu, close as closeMenu } from './menu.js';
import { initCharacters, eyesHTML, flashMood, flags, applyMood, currentMood, playTrick, isMessage, lookAt, morphFace, clearFlash } from './characters.js';
import { initPalette, openPalette, closePalette, paletteHeight } from './palette.js';
import { initQuickChat, openQuickChat, quickChatPeer } from './quickchat.js';
import home, { QUICK } from './tabs/home.js';
import clip from './tabs/clip.js';
import ai from './tabs/ai.js';
import text from './tabs/text.js';
import notes from './tabs/notes.js';
import calendar from './tabs/calendar.js';
import phone from './tabs/phone.js';
import weather from './tabs/weather.js';
import control from './tabs/control.js';
import settings from './tabs/settings.js';
import tg from './tabs/tg.js';

const TABS = { home, clip, ai, text, notes, calendar, phone, weather, control, tg, settings };
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
// the character also lives on the open island: in the header, between the tabs and the buttons,
// so it is there on every tab. When the island opens or closes it walks over to its new place.
$('.v-open .ohead .sp').innerHTML = `<div class="ochar">${eyesHTML('main open-eyes')}</div>`;
const traveller = document.createElement('div');
traveller.className = 'traveller';
traveller.innerHTML = eyesHTML('main travel-eyes');
stage.append(traveller);
let travel = null;
function faceFor(v) {
  return v === 'compact' ? $('.v-compact .mid .eyes') : v === 'mini' ? $('.v-mini .mini-eyes') : v === 'toast' ? $('.v-toast .toast-eyes') : v === 'open' ? $('.v-open .open-eyes') : null;
}
let calmUntil = 0;
function startTravel(from, to) {
  const a = faceFor(from)?.getBoundingClientRect();
  if (!a?.width || stage.classList.contains('hidden') || document.hidden) return;
  if (travel) cancelAnimationFrame(travel.raf);
  // the mini island: he arrives at his own spot and stays there a moment before strolling anywhere
  if (to === 'mini') { mw.x = mw.y = mw.vx = mw.vy = mw.tx = mw.ty = 0; mw.hold = performance.now() + 2000; mw.next = mw.hold + 1500; const w = $('.v-mini .mwalk'); if (w) { w.style.transform = ''; w._t = ''; } }
  const b0 = faceFor(to)?.getBoundingClientRect();
  const dist = b0?.width ? Math.hypot(b0.left + b0.width / 2 - (a.left + a.width / 2), b0.top + b0.height / 2 - (a.top + a.height / 2)) : 200;
  // a short hop takes a short time and barely leaves the ground; a long one is a proper little jump
  const dur = Math.round(Math.max(420, Math.min(680, 360 + dist * 1.1)));
  const hop = Math.min(9, 1.5 + dist * 0.05);
  // t0 is set on the first drawn frame: opening the island costs one heavy frame, and counting it made the
  // flight skip a piece of its way at the start
  travel = { a: { x: a.left + a.width / 2, y: a.top + a.height / 2, s: a.width / 20 }, to, t0: 0, raf: 0, dur, hop };
  calmUntil = performance.now() + dur + 700; // the flight, then a moment to settle without squashing
  // the flying face appears right where the real one is (not where the last flight ended)
  traveller.style.transform = `translate(${(travel.a.x - 10).toFixed(1)}px, ${(travel.a.y - 10).toFixed(1)}px) scale(${travel.a.s.toFixed(3)})`;
  stage.classList.remove('landing');
  stage.classList.add('travelling');
  fxl.style.translate = '';
  const step = (now) => {
    // progress by frames, at most one normal frame's worth each time: a slow frame lengthens the flight a
    // little instead of making him skip a piece of the way
    const dt = travel.t0 ? Math.min(20, now - travel.t0) : 0;
    travel.t0 = now;
    travel.p = (travel.p || 0) + dt / travel.dur;
    const b = faceFor(travel.to)?.getBoundingClientRect();
    const k = Math.min(1, travel.p);
    if (!b?.width || k >= 1) { endTravel(); return; }
    // the last part of the way: the real face fades in at its spot as the flying one fades out over it
    if (k > 0.78) stage.classList.add('landing');
    const e = -(Math.cos(Math.PI * k) - 1) / 2; // a soft ease in and out, no sudden middle rush
    const bx = b.left + b.width / 2, by = b.top + b.height / 2, bs = b.width / 20;
    const x = travel.a.x + (bx - travel.a.x) * e, s = travel.a.s + (bs - travel.a.s) * e;
    // a little hop on the way, landing softly (the arc flattens out before touching down)
    const y = travel.a.y + (by - travel.a.y) * e - Math.sin(Math.pow(k, 0.85) * Math.PI) * travel.hop;
    traveller.style.transform = `translate(${(x - 10).toFixed(1)}px, ${(y - 10).toFixed(1)}px) scale(${s.toFixed(3)})`;
    // the effects (thinking spinner, notes...) fly along in the same frame, not 20 times a second
    fxl.style.left = (x - 10).toFixed(1) + 'px';
    fxl.style.top = (y - 10).toFixed(1) + 'px';
    travel.raf = requestAnimationFrame(step);
  };
  travel.raf = requestAnimationFrame(step);
}
function endTravel() {
  if (travel) cancelAnimationFrame(travel.raf);
  travel = null;
  stage.classList.remove('travelling', 'landing');
  positionFx();
}
let fxWalkAt = 0; // how far the face had walked when the effects layer was last placed
function positionFx() {
  fxWalkAt = view === 'compact' && !travel ? walkX : 0;
  fxMiniAt = view === 'mini' && !travel ? [mw.x, mw.y] : null;
  fxl.style.translate = '';
  const host = travel ? traveller.firstElementChild : view === 'compact' ? $('.v-compact .mid') : view === 'mini' ? $('.v-mini .mini-eyes') : view === 'toast' ? $('.v-toast .toast-eyes') : flash.classList.contains('on') ? $('#flash .flash-eyes') : view === 'open' ? $('.v-open .open-eyes') : null;
  const r = host && !stage.classList.contains('hidden') ? host.getBoundingClientRect() : null;
  if (!r || !r.width) { fxl.style.opacity = '0'; return; }
  fxl.style.opacity = '';
  fxl.style.left = (r.left + r.width / 2 - 10).toFixed(1) + 'px';
  fxl.style.top = (r.top + r.height / 2 - 10 + (view === 'compact' ? 4 : 0)).toFixed(1) + 'px';
  const msgToast = view === 'toast' && $('.v-toast').classList.contains('msg');
  fxl.classList.toggle('small', (view === 'toast' && !msgToast) || view === 'open');
  fxl.classList.toggle('tbig', msgToast);
  fxl.classList.toggle('edge', view === 'toast');
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
  // the mini island / toast slides up as it is; it turns back into the pill only once it is out of sight
  // (switching first made it snap into the small island right under the finger)
  stage.classList.add('hidden', 'stashing');
  if (view !== 'compact') setTimeout(() => { if (stashed && view !== 'compact') setView('compact'); }, 480);
  setTimeout(() => stage.classList.remove('stashing'), 600);
  renderCompact(true);
  sendShape();
}
// Hidden from the menu: a sad look, then it slowly floats up and away; only then the window goes.
let leaving = false;
function goodbye(minutes) {
  if (leaving) return;
  leaving = true;
  playSound('hide');
  if (view !== 'compact') setView('compact');
  flashMood('mood-sad', 2200);
  stage.classList.add('leaving');
  setTimeout(() => {
    stage.classList.add('hidden', 'stashing', 'goodbye');
    sendShape();
    setTimeout(() => {
      api.invoke('island:hide', minutes || 0);
      stage.classList.remove('stashing', 'goodbye', 'leaving');
      leaving = false;
    }, 1000);
  }, 750);
}
// shown again (tray, hotkey, timer): slides back down
function welcomeBack() {
  if (stashed) { unstash(); return; }
  if (!stage.classList.contains('hidden')) return;
  stage.classList.remove('hidden');
  renderCompact(true);
  sendShape();
  playTrick('stretch');
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

// A photo opened from the phone or Telegram: the island grows to the picture's shape, at most 2/3 of the
// screen, with room around it for the arrows and buttons; closing it, everything goes back.
let viewBox = null, shrinkT = 0;
bus.on('viewer-size', async ({ w, h }) => {
  if (!w || !h || !(view === 'open' || view === 'qchat')) return;
  clearTimeout(shrinkT);
  const maxW = Math.round(screen.width * 2 / 3), maxH = Math.round(screen.height * 2 / 3);
  const padX = 130, padY = 96; // arrows on the sides, buttons above, the counter below
  const k = Math.min(1, (maxW - padX) / w, (maxH - padY) / h);
  const box = { w: Math.max(view === 'qchat' ? 440 : 800, Math.round(w * k + padX)), h: Math.max(430, Math.round(h * k + padY)) };
  if (viewBox && viewBox.w === box.w && viewBox.h === box.h) return;
  const win = await api.invoke('island:grow', box.w + 240, box.h + 200).catch(() => null);
  if (win) { WIN.w = win.w; WIN.h = win.h; }
  viewBox = box;
  applySize(); sendShape();
});
bus.on('viewer-close', () => {
  if (!viewBox) return;
  viewBox = null;
  applySize();
  clearTimeout(shrinkT);
  shrinkT = setTimeout(async () => { if (viewBox) return; const u = state.settings?.island?.openSize; if (view === 'open' && u) { const win = await api.invoke('island:grow', u.w + 240, u.h + 200).catch(() => null); if (win) { WIN.w = win.w; WIN.h = win.h; } sendShape(); return; } const win = await api.invoke('island:grow', 0, 0).catch(() => null); if (win) { WIN.w = win.w; WIN.h = win.h; } sendShape(); }, 750);
});

// ---- stretching the open island ----
// The handle at the bottom pulls it taller, the bottom corners pull it wider and taller at once (it stays
// centred and hugs the top of the screen). The size is remembered; a double click on the handle goes back
// to the automatic size. The window grows with it when it needs more room.
const userSize = () => state.settings?.island?.openSize || null;
async function fitWindow(w, h) {
  const need = { w: w + 240, h: h + 200 }; // room around it for the glow and the waves
  if (need.h <= WIN.h && !(WIN.h > 700 && need.h < WIN.h - 40)) return; // (the window is always screen-wide: only its height changes)
  const win = await api.invoke('island:grow', need.w, need.h).catch(() => null);
  if (win) { WIN.w = win.w; WIN.h = win.h; sendShape(); }
}
let windowBackT = 0;
bus.on('view', (v) => {
  clearTimeout(windowBackT);
  if (v === 'open') { const u = userSize(); if (u) fitWindow(u.w, u.h); }
  // the island has shrunk back: so does its window (after the animation)
  else if (!viewBox && v !== 'toast') windowBackT = setTimeout(async () => { if (view === 'open' || view === 'toast' || viewBox) return; const win = await api.invoke('island:grow', 0, 0).catch(() => null); if (win) { WIN.w = win.w; WIN.h = win.h; sendShape(); } }, 750);
});
function initStretch() {
  const mk = (cls, title) => { const e = h('div', { class: 'rz ' + cls, title }); isl.append(e); return e; };
  const grips = [mk('rz-b', 'Потяни, чтобы растянуть · двойной клик — обычный размер'), mk('rz-bl', ''), mk('rz-br', '')];
  for (const g of grips) {
    g.addEventListener('dblclick', (e) => { e.stopPropagation(); state.settings.island.openSize = null; saveSettings(); applySize(); setTimeout(() => fitWindow(size.w, size.h), 700); flashBelow({ icon: '↕', title: 'Обычный размер острова', ms: 1400 }); });
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !(view === 'open' || (view === 'qchat' && viewBox))) return;
      e.stopPropagation(); e.preventDefault();
      try { g.setPointerCapture(e.pointerId); } catch {}
      const start = { x: e.screenX, y: e.screenY, w: size.w, h: size.h }; // screen coordinates: the window itself grows and moves while stretching
      const maxW = Math.min(screen.width - 40, 1700), maxH = Math.round(screen.height * 0.9);
      isl.classList.add('stretching');
      api.invoke('island:hold', true);
      // the blocks of the shown tab (cards, tiles, buttons in grids and wrapping rows) glide to their new
      // places as the island changes size, instead of jumping there
      const page = viewBox ? null : $('.v-open .page.on');
      // (nested ones too: the tiles inside a card move inside it while the card itself moves)
      const blocks = page ? [...page.querySelectorAll('*')].filter((el) => {
        const par = el.parentElement;
        if (!par || !el.offsetWidth || el.closest('.mview')) return false;
        const d = getComputedStyle(par);
        return d.display.includes('grid') || (d.display.includes('flex') && d.flexWrap.startsWith('wrap'));
      }).map((el) => { let d = 0; for (let p = el; p && p !== page; p = p.parentElement) d++; return [d, el]; })
        .sort((x, y) => x[0] - y[0]).slice(0, 200).map((x) => x[1]) : []; // the outer ones first, if there are too many
      const sized = blocks.map(() => true); // they glide in size as well as in place
      const outer = blocks.map((b) => { for (let p = b.parentElement; p && p !== page; p = p.parentElement) { const k = blocks.indexOf(p); if (k >= 0) return k; } return -1; });
      // the window takes the whole screen once now (not a little more on every step: each resize of the
      // window shook the picture), and fits the island again when you let go
      api.invoke('island:grow', screen.width, Math.round(screen.height * 0.95)).then((win) => { if (win) { WIN.w = win.w; WIN.h = win.h; sendShape(); } }).catch(() => {});
      let raf = 0, cur = null;
      const move = (ev) => {
        const dx = ev.screenX - start.x;
        const dw = g.classList.contains('rz-br') ? dx * 2 : g.classList.contains('rz-bl') ? -dx * 2 : 0; // both sides move: it stays centred
        const w = Math.round(Math.max(640, Math.min(maxW, start.w + dw)));
        const hh = Math.round(Math.max(300, Math.min(maxH, start.h + (ev.screenY - start.y))));
        cur = { w, h: hh };
        if (!raf) raf = requestAnimationFrame(() => {
          raf = 0;
          // where every block is on screen now (with its glide), the new layout, then each block that jumped
          // (a new column, a wrap to the next row: a sudden change of place OR size) glides there from
          // where it was - its size too, so a card never snaps 200px wider. Small steady changes just
          // follow the hand. A block inside another one moves relative to it (no double motion).
          const first = blocks.map((b) => b.getBoundingClientRect()), fi = page.getBoundingClientRect();
          if (viewBox) viewBox = { ...cur }; else state.settings.island.openSize = cur; // a photo: just this time
          applySize();
          for (const b of blocks) if (b._flip) { b._flip.cancel(); b._flip = null; }
          const next = blocks.map((b) => b.getBoundingClientRect()), ni = page.getBoundingClientRect();
          const now = performance.now(), DUR = 320, sizing = [];
          blocks.forEach((b, k) => {
            const f = first[k], r = next[k], o = outer[k];
            // did the layout itself jump since the last step (not counting a glide still under way)?
            // (everything is counted from its own card, or from the tab: the window may move under it)
            const lay = { x: r.left - (o >= 0 ? next[o].left : ni.left), y: r.top - (o >= 0 ? next[o].top : ni.top), w: r.width, h: r.height };
            const was = b._lay || lay;
            b._lay = lay;
            const jump = Math.max(Math.abs(lay.x - was.x), Math.abs(lay.y - was.y), sized[k] ? Math.max(Math.abs(lay.w - was.w), Math.abs(lay.h - was.h)) : 0) >= 7;
            const run = b._fl && now - b._fl.t0 < DUR ? b._fl : null;
            // inside a card that is gliding in size, everything simply rides along (it is laid out in the
            // card's in-between size already: a glide of its own would move it twice)
            for (let q = o; q >= 0; q = outer[q]) if (sizing[q]) { b._fl = null; return; }
            let kf, t0;
            if (jump) {
              // a new jump: glide from where it is on screen right now (its card's own glide aside)
              let dx = f.left - r.left, dy = f.top - r.top;
              if (o >= 0) { dx -= first[o].left - next[o].left; dy -= first[o].top - next[o].top; } else { dx -= fi.left - ni.left; dy -= fi.top - ni.top; }
              kf = { translate: `${dx.toFixed(1)}px ${dy.toFixed(1)}px` };
              if (sized[k] && Math.abs(f.width - r.width) > 1) kf.width = f.width.toFixed(1) + 'px';
              if (sized[k] && Math.abs(f.height - r.height) > 1) kf.height = f.height.toFixed(1) + 'px';
              t0 = now; b._fl = { kf, t0 };
            } else if (run) { kf = run.kf; t0 = run.t0; } // the glide that was going on simply goes on
            else { b._fl = null; return; } // nothing jumped: it follows the hand
            // the end is where the layout is in this very step (a size can't glide towards "auto"); the
            // glide is made again every step, so the end follows the hand
            const to = { translate: '0px 0px' };
            if (kf.width) to.width = r.width.toFixed(1) + 'px';
            if (kf.height) to.height = r.height.toFixed(1) + 'px';
            b._flip = b.animate([kf, to], { duration: DUR, easing: 'cubic-bezier(.25, .8, .25, 1)' });
            b._flip.currentTime = now - t0;
            sizing[k] = !!(kf.width || kf.height);
          });
        });
      };
      const up = () => {
        g.removeEventListener('pointermove', move);
        isl.classList.remove('stretching');
        api.invoke('island:hold', false);
        if (cur && viewBox) { viewBox = { ...cur }; applySize(); }
        else if (cur) { state.settings.island.openSize = cur; saveSettings(); applySize(); }
        const fin = cur || { w: size.w, h: size.h };
        setTimeout(() => api.invoke('island:grow', fin.w + 240, fin.h + 200).then((win) => { if (win) { WIN.w = win.w; WIN.h = win.h; sendShape(); } }).catch(() => {}), 120);
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up, { once: true });
      g.addEventListener('lostpointercapture', up, { once: true });
    });
  }
}
function targetSize() {
  const k = scale();
  switch (view) {
    case 'mini': return { w: 440, h: 92, r: 30 };
    case 'toast': return currentToast?.box ? { ...currentToast.box, r: Math.min(36, currentToast.box.h / 2) } : { w: currentToast?.buttons ? 610 : 470, h: currentToast?.actions ? 84 : 72, r: 30 };
    case 'ask': return { w: 540, h: Math.min(320, contentHeight($('.v-ask'), 28)), r: 28 };
    case 'qchat': if (viewBox) return { ...viewBox, r: 34 }; return { w: 440, h: Math.max(220, Math.min(430, qchatHeight())), r: 30 };
    case 'drop': return { w: 480, h: 132, r: 30 };
    case 'palette': return { w: 660, h: paletteHeight(), r: 28 };
    case 'open': {
      if (viewBox) return { ...viewBox, r: 34 }; // a photo shown big
      if (userSize()) return { ...userSize(), r: 34 }; // stretched by hand
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
  isl.classList.toggle('usersized', view === 'open' && !viewBox && !!userSize()); // stretched by hand: Home fills it
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
    const ba = bubblesHitArea(x + size.w, TOP, size.h);
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

// The views that aren't shown are see-through but blurred (that's how they fade out); left like that, every
// change of the island's size made the browser blur all of them again, island-sized, every frame. Once
// they have faded out they are not painted at all.
let idleT = 0;
function hideIdleViews(v) {
  isl.querySelector(`:scope > .v-${v}`)?.classList.remove('gone');
  clearTimeout(idleT);
  idleT = setTimeout(() => { for (const el of isl.querySelectorAll(':scope > .view:not(.v-open)')) el.classList.toggle('gone', !el.classList.contains('v-' + view)); }, 700);
}
// A big island (stretched by hand) can't change its size smoothly: every step of it made the browser
// redraw an area the size of half the screen, and it went on screen in visible jerks. So a big one
// doesn't grow out of the pill: it takes its size at once and appears by zooming in and fading (the
// graphics card does that alone, every frame), and on closing it zooms out and fades, and the pill
// pops back. An island of the usual size still grows out of the pill as before.
const BIG = 700000;
let zooming = null; // { next } while a big island zooms out
function zoomAnim(frames, ms, easing) {
  isl.style.transformOrigin = '50% 0';
  stage.classList.add('zooming');
  return isl.animate(frames, { duration: ms, easing, fill: 'both' });
}
function zoomDone(a) {
  a.cancel();
  isl.classList.remove('zoom');
  stage.classList.remove('zooming');
  isl.style.transformOrigin = '';
}
function setView(v) {
  if (zooming) { zooming.next = v; return; } // closing a big island: whatever comes next waits for it
  if (v === view) { applySize(); return; }
  const from = view;
  // closing a big island: zoom it out first, then the new view comes in its usual size
  if (from === 'open' && v !== 'palette' && size.w * size.h > BIG) {
    zooming = { next: v };
    const a = zoomAnim([{ scale: 1, opacity: 1 }, { scale: 0.86, opacity: 0 }], 200, 'cubic-bezier(.4, 0, .9, .6)');
    a.onfinish = () => {
      const nv = zooming.next; zooming = null;
      isl.classList.add('zoom');
      showView(nv === 'open' ? 'compact' : nv, from, false);
      const b = isl.animate([{ scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.3, 1.4, .5, 1)', fill: 'both' });
      a.cancel();
      b.onfinish = () => zoomDone(b);
    };
    return;
  }
  // opening a big one: its size at once, zooming in
  const was = view; view = v; const t = targetSize(); view = was;
  if (v === 'open' && from !== 'palette' && t.w * t.h > BIG) {
    isl.classList.add('zoom');
    showView(v, from, false);
    const a = zoomAnim([{ scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1 }], 360, 'cubic-bezier(.2, .9, .3, 1.06)');
    a.onfinish = () => zoomDone(a);
    return;
  }
  showView(v, from, true);
}
function showView(v, from, travel) {
  view = v;
  isl.dataset.view = v;
  isl.classList.toggle('open', v === 'open' || v === 'palette');
  hideIdleViews(v);
  if (v !== 'palette') closePalette(true);
  applySize();
  renderCompact(true);
  if (travel && from !== v && [from, v].every((x) => ['open', 'compact', 'mini', 'toast'].includes(x))) startTravel(from, v);
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
    else if (k[0]) out.push({ kind: 'agent', prio: 50, s: k[0], count: k.length, list: k, key: 'agent:' + src });
  }
  if (state.game) out.push({ kind: 'game', prio: 45, game: state.game, key: 'game' }); // above the music: you're playing
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
// Change only the sides of the pill and leave its middle (the character) where it is: an element that is
// taken out of the page and put back restarts every CSS animation on it, so the thinking, dancing, etc.
// would jump back to their first frame on every switch of activity.
function setCompactHTML(el, html) {
  const oldMid = $(':scope > .mid', el);
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const kids = [...tpl.content.childNodes];
  const newMid = kids.find((n) => n.nodeType === 1 && n.classList.contains('mid'));
  if (!oldMid || !newMid || !$('.eyes.main', oldMid)) { el.innerHTML = html; return; }
  for (const n of [...el.childNodes]) if (n !== oldMid) n.remove();
  const i = kids.indexOf(newMid);
  oldMid.before(...kids.slice(0, i));
  oldMid.after(...kids.slice(i + 1));
  oldMid.className = newMid.className;
}
// Put the old face element back in place of the freshly written one, so a switch of activity
// (music -> game -> download...) changes only the sides and the character keeps moving.
function keepFace(el, old) {
  if (!old) return;
  const fresh = $('.mid > .eyes', el);
  if (fresh && fresh.classList.contains('main') && old.classList.contains('main')) fresh.replaceWith(old);
}
// Live text in the pill (download progress, timers, call time): the characters that changed roll in,
// and the text's width glides to its new size - so nothing next to it (Windik!) jumps aside.
function rollText(el, str) {
  if (!el) return;
  str = String(str);
  const prev = el._txt ?? el.textContent;
  if (prev === str) return;
  el._txt = str;
  const oldW = el.offsetWidth;
  el.textContent = '';
  const chars = [...str], before = [...prev];
  for (let i = 0; i < chars.length; i++) {
    const c = h('span', { class: 'rl' + (chars[i] !== before[i] && /\S/.test(chars[i]) ? ' in' : '') }, chars[i]);
    el.append(c);
  }
  el.style.width = 'auto';
  const newW = el.offsetWidth;
  if (oldW && Math.abs(newW - oldW) > 0.5) {
    el.style.width = oldW + 'px';
    void el.offsetWidth;
    el.style.width = newW + 'px';
  } else el.style.width = '';
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
    html = `<div class="side"><div class="cover${m.soundOnly ? ' snd' : ''}" style="background-image:url('${m.thumb || ''}')">${m.soundOnly ? icon('volume', 12) : ''}</div><div class="marq js-marq" data-t="${esc(m.title || '')}"><span>${esc(m.title)}</span></div></div>
      <div class="mid">${eyes}</div>
      <div class="side r">${m.soundOnly ? '' : `<div class="mpc"><button class="mpb" data-media="prev">${mediaIcon('prev', 13)}</button><button class="mpb big" data-media="toggle">${mediaIcon(m.playing ? 'pause' : 'play', 14)}</button><button class="mpb" data-media="next">${mediaIcon('next', 13)}</button></div>`}<div class="bars">${'<i></i>'.repeat(5)}</div><button class="cbtn-s ghost fold" data-fold title="Свернуть в кружок сбоку">${icon('chevron', 13)}</button></div>`;
  } else if (kind === 'download') {
    const d = a.dl;
    key += d.name;
    const frac = d.total ? Math.max(0, Math.min(1, d.size / d.total)) : 0;
    html = `<div class="side"><div class="ring ${d.total ? 'pie' : 'spin'}" style="--pie:${frac.toFixed(3)}"></div><div class="marq"><span>${esc(d.name)}</span></div></div><div class="mid">${eyes}</div><div class="side r" style="flex:none"><span class="dim js-sub">${dlText(d)}</span><button class="cbtn-s ghost fold" data-fold title="Свернуть в кружок сбоку">${icon('chevron', 13)}</button></div>`;
  } else if (kind === 'agent') {
    const s = a.s;
    key += s.id + a.waiting + (a.count || 1);
    html = a.waiting
      ? `<div class="side"><span class="alogo wait">${glyphTile({ kind: 'agent', source: s.source }, 20)}</span><span>${esc(s.project)}</span></div><div class="mid">${eyes}</div><div class="side r"><span class="dim">нужен ответ</span><button class="cbtn-s ghost fold" data-fold title="Свернуть в кружок сбоку">${icon('chevron', 13)}</button></div>`
      : `<div class="side"><span class="alogo work">${glyphTile({ kind: 'agent', source: s.source }, 20)}${a.count > 1 ? `<b class="acount">${a.count}</b>` : ''}</span><span>${s.source === 'codex' ? 'Codex' : 'Claude'} трудится</span></div><div class="mid">${eyes}</div><div class="side r"><span class="dim js-sub">${a.count > 1 ? `${a.count} ${a.count < 5 ? 'задачи' : 'задач'}` : esc(s.project)}</span><button class="cbtn-s ghost fold" data-fold title="Свернуть в кружок сбоку">${icon('chevron', 13)}</button></div>`;
  } else if (kind === 'ask') {
    key += a.ask.id;
    html = `<div class="side"><span class="alogo wait">${glyphTile({ kind: 'agent', source: a.ask.source }, 20)}</span><span>${esc(a.ask.project)}</span></div><div class="mid">${eyes}</div><div class="side r dim">${a.ask.kind === 'permission' ? 'разрешить?' : 'вопрос'}</div>`;
  } else if (kind === 'call') {
    const c = a.call;
    key += c.id + c.micMuted + c.soundMuted;
    key += c.icon ? 'i' : '';
    html = `<div class="side"><span class="callapp">${callLogo(c, 'callico')}<span>${esc(c.name)}</span></span><span class="dim js-sub" style="font-variant-numeric:tabular-nums">${clock((Date.now() - c.since) / 1000)}</span></div>
      <div class="mid">${eyes}</div>
      <div class="side r"><button class="cbtn-s ghost" data-fold title="Свернуть звонок в значок">${icon('chevron', 13)}</button><button class="cbtn-s${c.micMuted ? ' muted' : ''}" data-call="mic" data-cid="${esc(c.id)}" title="${c.micMuted ? 'Включить микрофон' : 'Выключить микрофон'}">${icon(c.micMuted ? 'micoff' : 'mic', 14)}</button><button class="cbtn-s${c.soundMuted ? ' muted' : ''}" data-call="sound" data-cid="${esc(c.id)}" title="${c.soundMuted ? 'Вернуть звук звонка' : 'Заглушить звук звонка'}">${icon(c.soundMuted ? 'mute' : 'volume', 14)}</button><button class="cbtn-s hang" data-call="hangup" data-cid="${esc(c.id)}" title="Отключиться от звонка">${icon('hangup', 14)}</button></div>`;
  } else if (kind === 'game') {
    const g = a.game;
    key += g.id + (g.icon ? 'i' : '');
    html = `<div class="side"><span class="gameapp">${gameLogo(g, 'gameico')}<span class="marq js-marq" data-t="${esc(g.name)}"><span>${esc(g.name)}</span></span></span></div>
      <div class="mid">${eyes}</div>
      <div class="side r"><span class="dim js-sub" style="font-variant-numeric:tabular-nums">${clock((Date.now() - g.since) / 1000)}</span><button class="cbtn-s ghost fold" data-fold title="Свернуть в кружок сбоку">${icon('chevron', 13)}</button></div>`;
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
    // another activity takes the pill: the old one melts away while the new one slides in
    const ident = a?.key || kind;
    const swap = lastIdent !== null && ident !== lastIdent && view === 'compact';
    lastIdent = ident;
    let ghost = null;
    if (swap) {
      ghost = document.createElement('div');
      ghost.className = 'actghost';
      ghost.innerHTML = el.innerHTML;
      ghost.querySelector('.mid')?.replaceChildren(); // the character stays, only the sides change
      const cs = getComputedStyle(el);
      ghost.style.padding = cs.padding; ghost.style.gap = cs.gap;
    }
    setCompactHTML(el, html); // the same face lives on, untouched: its animation must not restart
    if (ghost) {
      el.append(ghost);
      el.classList.remove('actswap'); void el.offsetWidth; el.classList.add('actswap');
      setTimeout(() => { ghost.remove(); el.classList.remove('actswap'); }, 520);
    }
    { const nm = $('.mid', el); if (nm && walkX) { nm.style.translate = walkX.toFixed(2) + 'px 0'; nm._wx = walkX; walkMid = nm; } } // no jump back to the middle
    applySize();
    fitMarquee(el);
  } else {
    const t = $('.js-time', el); if (t) t.textContent = timeText();
    const w = $('.js-w', el); if (w) { const wt = weatherText(); if (w._wt !== wt) { w._wt = wt; w.innerHTML = wt; } }
    const dd = $('.js-date', el); if (dd) dd.textContent = dateText();
    const sub = $('.js-sub', el);
    if (sub && kind === 'download') rollText(sub, dlText(a.dl));
    if (kind === 'download' && a.dl.total) { const rg = $('.ring', el); if (rg) { rg.classList.remove('spin'); rg.classList.add('pie'); rg.style.setProperty('--pie', Math.max(0, Math.min(1, a.dl.size / a.dl.total)).toFixed(3)); } }
    if (sub && kind === 'timer') rollText(sub, clock((a.timer.at - Date.now()) / 1000));
    if (sub && kind === 'call') rollText(sub, clock((Date.now() - a.call.since) / 1000));
    if (sub && kind === 'game') rollText(sub, clock((Date.now() - a.game.since) / 1000));
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
      const list = x.list || [x.s];
      return { key: k, cls: `agent ${src}${x.waiting ? ' waiting' : ''}`, act: x, sig: 'ag' + src + x.waiting + list.length,
        title: list.length > 1 ? '' : `${src === 'codex' ? 'Codex' : 'Claude'} · ${x.s.project} — ${x.waiting ? 'нужен ответ' : 'трудится'}`,
        detail: list.length > 1 ? `<b>${src === 'codex' ? 'Codex' : 'Claude'} · ${list.length} ${list.length < 5 ? 'задачи' : 'задач'}</b>` + list.map((t) => `<div class="btask"><span class="btdot"></span><div><div class="btp">${esc(t.project)}</div><div class="btn2">${esc(((t.tool ? t.tool + ': ' : '') + (t.note || '')).slice(0, 70))}</div></div></div>`).join('') : '',
        html: glyphTile({ kind: 'agent', source: src }, 40, 'gtile fill') + (list.length > 1 ? `<b class="acount">${list.length}</b>` : '') };
    }
    case 'music': return { key: k, cls: 'music', act: x, sig: 'm' + state.media.key + (state.media.thumb ? 't' : ''), title: `${state.media.title} — ${state.media.artist || ''}${x.folded ? ' · нажми, чтобы развернуть' : ''}`, html: `<div class="cover" style="background-image:url('${state.media.thumb || ''}')"></div>` };
    case 'download': return { key: k, cls: 'dl', act: x, sig: 'dl', title: (x.dl?.name || 'Загрузка') + (x.folded ? ' · нажми, чтобы развернуть' : ''), html: `<span class="ring spin"></span>${icon('download', 12)}` };
    case 'game': return { key: k, cls: 'game', act: x, sig: 'g' + x.game.id + (x.game.icon ? 'i' : ''), title: `${x.game.name} · играешь ${playTime(x.game.since)} (с ${hhmmOf(x.game.since)})${x.folded ? ' — нажми, чтобы развернуть' : ''}`, html: gameLogo(x.game, 'bubble-glogo') };
    case 'timer': return { key: k, cls: 'timer', act: x, sig: 't' + x.timer.id, title: x.timer.text || 'Таймер', html: icon('timer', 17) };
    case 'done': return { key: k, cls: 'done', act: x, sig: 'done', title: 'Готово', html: glyphTile({ done: true }, 28, 'gtile') };
    case 'ask': return { key: k, cls: 'agent waiting', act: x, sig: 'ask', title: 'Агент ждёт ответа', html: glyphTile({ kind: 'agent', source: x.ask?.source }, 40, 'gtile fill') };
    default: return { key: k, act: x, sig: k, html: '•' };
  }
}

// Activities the user folded into a side droplet (by key); a click on the droplet unfolds it.
const foldedKeys = new Set();
let lastIdent = null; // which activity the pill shows (to animate a swap)
function foldActivity(key) {
  if (!key) return;
  foldedKeys.add(key);
  if (pinnedKey === key) pinnedKey = null;
  renderCompact(true);
}
function gameLogo(g, cls) {
  return g.icon ? `<img class="${cls}" src="${g.icon}" alt="">` : `<span class="${cls} fallback">${icon('gamepad', 14)}</span>`;
}
function callLogo(c, cls) {
  return c.icon ? `<img class="${cls}" src="${c.icon}" alt="">` : `<span class="${cls} fallback">${esc((c.name || '?')[0])}</span>`;
}

// ---------------- mini player (hover) ----------------
// the player can be put away from the mini island (×) and brought back (♪ in the summary);
// a new track brings it back by itself
let miniMusicOff = null; // the track it was put away for
let seeking = false; // dragging the mini player's bar
function renderMini() {
  const m = state.media;
  const el = $('.v-mini');
  if (miniMusicOff && m?.key !== miniMusicOff) miniMusicOff = null;
  // the mini island opens whatever the pill shows: an agent at work, a call, a download, a timer...
  const a = primaryActivity();
  if (a && !['music', 'ask'].includes(a.kind)) return renderMiniActivity(el, a);
  // the player only when music is the activity you chose; folded into a droplet -> the summary
  if (!m?.active || playerHidden() || miniMusicOff || foldedKeys.has('music')) return renderMiniSummary(el);
  el.classList.remove('sum', 'actv');
  const key = m.key + (m.thumb?.length || 0);
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    const done = miniSwap(el, 'player', m.soundOnly ? 'soundonly' : '');
    el.classList.toggle('soundonly', !!m.soundOnly); // sound from an app without media controls: nothing to press
    el.innerHTML = `<div class="art" style="background-image:url('${m.thumb || ''}')">${m.soundOnly ? icon('volume', 26) : ''}</div>
      <div class="meta"><div class="trow"><div class="t">${esc(m.title)}</div><span class="mwalk">${eyesHTML('main mini-eyes')}</span></div><div class="a">${esc(m.artist || m.app)}</div>
        <div class="prog"><span class="js-pos">0:00</span><div class="track js-seek"><i></i></div><span class="js-dur">${clock(m.duration || 0)}</span></div></div>
      <div class="ctl"><button class="cbtn" data-c="prev">${mediaIcon('prev', 19)}</button><button class="cbtn big js-pp" data-c="toggle"></button><button class="cbtn" data-c="next">${mediaIcon('next', 19)}</button></div>`;
    done();
    for (const b of $$('[data-c]', el)) b.onclick = (e) => {
      e.stopPropagation();
      if (b.dataset.c === 'toggle') setPP(b, !state.media?.playing, 19, 1500); // show the new state at once
      api.invoke('media:cmd', b.dataset.c);
    };
    // seek: click anywhere on the bar, or grab it and drag; the time follows the finger
    const bar = $('.js-seek', el), row = $('.prog', el);
    row.onpointerdown = (e) => {
      const mm = state.media;
      if (!mm?.canSeek || !mm.duration || e.button !== 0) return;
      const br = bar.getBoundingClientRect();
      if (e.clientX < br.left - 6 || e.clientX > br.right + 6) return; // on the time labels: nothing
      e.stopPropagation(); e.preventDefault();
      try { row.setPointerCapture(e.pointerId); } catch {}
      bar.classList.add('drag');
      const at = (ev) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
      let k = at(e);
      const show = () => { bar.classList.add('jump'); bar._p = k; bar.style.setProperty('--p', k); $('.js-pos', el).textContent = clock(k * mm.duration); };
      show(); seeking = true;
      row.onpointermove = (ev) => { k = at(ev); show(); };
      row.onpointerup = row.onpointercancel = () => {
        row.onpointermove = row.onpointerup = row.onpointercancel = null;
        bar.classList.remove('drag');
        seeking = false;
        api.invoke('media:cmd', 'seek', { position: k * mm.duration });
      };
    };
    row.onclick = (e) => e.stopPropagation();
  }
  setPP($('.js-pp', el), m.playing, 19);
  if (seeking) return; // the finger is on the bar: don't fight it
  $('.js-pos', el).textContent = clock(m.position || 0);
  $('.js-dur', el).textContent = clock(m.duration || 0);
  $('.prog', el)?.classList.toggle('notime', !m.duration); // the player doesn't tell its length: no made-up numbers
  setProgress($('.track', el), m.duration ? m.position / m.duration : 0);
}

// Mini island without music: big clock, weather and a few quick actions.
// ---- the mini island changes smoothly ----
// Call before replacing its content: when it switches to another thing (player -> Claude -> clock...),
// the old content stays as a fading copy on top while the new one comes in. Same thing redrawn: no animation.
function miniSwap(el, ident, lay) {
  const changed = el.dataset.ident !== undefined && el.dataset.ident !== ident;
  const oldLay = el.dataset.lay || '';
  el.dataset.ident = ident; el.dataset.lay = lay; // remember the layout: the old content keeps its own
  if (!changed || view !== 'mini' || !el.children.length) return () => {};
  el.querySelector(':scope > .mghost')?.remove();
  const ghost = document.createElement('div');
  ghost.className = 'mghost ' + oldLay;
  ghost.innerHTML = el.innerHTML;
  ghost.querySelectorAll('.eyes').forEach((x) => (x.style.visibility = 'hidden')); // the character stays, it isn't copied
  return () => {
    el.append(ghost);
    el.classList.remove('mswap'); void el.offsetWidth; el.classList.add('mswap');
    setTimeout(() => { ghost.remove(); el.classList.remove('mswap'); }, 520);
  };
}

// ---- the mini island for one activity ----
const agoMin = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60e3)); return m < 1 ? 'только начал' : m < 60 ? `уже ${m} мин` : `уже ${Math.floor(m / 60)} ч ${m % 60} мин`; };
function renderMiniActivity(el, a) {
  el.classList.remove('sum', 'soundonly');
  el.classList.add('actv');
  const eyes = `<span class="mwalk">${eyesHTML('main mini-eyes')}</span>`;
  const btn = (act, ic, title, cls = '') => `<button class="cbtn ${cls}" data-ma="${act}" title="${title}">${icon(ic, 17)}</button>`;
  let key = 'act:' + a.key, ic = '', title = '', sub = '', extra = '', ctl = '';
  if (a.kind === 'agent') {
    const s = a.s, who = s.source === 'codex' ? 'Codex' : 'Claude';
    key += s.id + (a.waiting ? 'w' : '');
    ic = `<span class="alogo ${a.waiting ? 'wait' : 'work'}">${glyphTile({ kind: 'agent', source: s.source }, 46)}</span>`;
    title = a.waiting ? `${who} ждёт ответа` : a.count > 1 ? `${who} · ${a.count} ${a.count < 5 ? 'задачи' : 'задач'}` : `${who} трудится`;
    key += (a.list || []).map((t) => t.id).join(',');
    if (!a.waiting && a.count > 1) {
      sub = '';
      extra = `<div class="mtasks">${(a.list || []).slice(0, 3).map((t) => `<div class="mtask"><span class="mtdot"></span><b>${esc(t.project)}</b><span class="mtn">${esc(((t.tool ? t.tool + ': ' : '') + (t.note || '')).slice(0, 80))}</span></div>`).join('')}</div>`;
    } else {
      sub = `<span>${esc(s.project)}</span> · <span class="js-ms">${agoMin(s.started || s.updated)}</span>`;
      extra = `<div class="mnote2 js-mn">${esc((s.tool ? s.tool + ': ' : '') + (s.note || ''))}</div>`;
    }
    ctl = btn('home', 'home', 'Открыть остров') + btn('fold', 'chevron', 'Свернуть в кружок');
  } else if (a.kind === 'call') {
    const c = a.call;
    key += (c.micMuted ? 'm' : '') + (c.soundMuted ? 's' : '');
    ic = `<span class="mact-call">${callLogo(c, 'callico')}</span>`;
    title = esc(c.name);
    sub = `<span class="js-ms" style="font-variant-numeric:tabular-nums">${clock((Date.now() - c.since) / 1000)}</span> · звонок`;
    ctl = btn('mic', c.micMuted ? 'micoff' : 'mic', c.micMuted ? 'Включить микрофон' : 'Выключить микрофон', c.micMuted ? 'muted' : '')
      + btn('sound', c.soundMuted ? 'mute' : 'volume', c.soundMuted ? 'Вернуть звук' : 'Заглушить звук', c.soundMuted ? 'muted' : '')
      + btn('hangup', 'hangup', 'Отключиться', 'hang');
  } else if (a.kind === 'game') {
    const g = a.game;
    key += g.id + (g.icon ? 'i' : '');
    ic = `<span class="mact-game">${gameLogo(g, 'gameico')}</span>`;
    title = esc(g.name);
    sub = `<span class="js-ms" style="font-variant-numeric:tabular-nums">${playTime(g.since)}</span> · с ${hhmmOf(g.since)}`;
    ctl = btn('game', 'gamepad', 'Вернуться в игру') + btn('fold', 'chevron', 'Свернуть в кружок');
  } else if (a.kind === 'download') {
    const d = a.dl;
    key += d.name;
    ic = `<span class="mact-ic dl">${icon('download', 24)}</span>`;
    title = esc(d.name);
    sub = `<span class="js-ms">${dlText(d)}</span>${a.count > 1 ? ` · ещё ${a.count - 1}` : ''}`;
    extra = d.total ? `<div class="mbar det"><i style="width:${Math.min(100, (d.size / d.total) * 100)}%"></i></div>` : '<div class="mbar"><i></i></div>';
    ctl = btn('folder', 'folder', 'Открыть папку загрузок');
  } else if (a.kind === 'timer') {
    const t = a.timer;
    key += t.id;
    const total = Math.max(1, (t.at - (t.created || t.at - 60e3)) / 1000);
    ic = `<span class="mact-ic tm" style="--p:${Math.max(0, Math.min(1, (t.at - Date.now()) / 1000 / total))}">${icon('timer', 22)}</span>`;
    title = `<span class="js-mt mbig">${clock((t.at - Date.now()) / 1000)}</span>`;
    sub = esc(t.text || 'Таймер');
    ctl = btn('plus1', 'plus', '+1 минута') + btn('stop', 'stop', 'Остановить таймер');
  } else if (a.kind === 'done') {
    key += a.project;
    ic = `<span class="mact-ic ok">${icon('check', 26)}</span>`;
    title = 'Готово';
    sub = `${esc(a.project)} · ${a.source === 'codex' ? 'Codex' : 'Claude'} закончил`;
    ctl = btn('home', 'home', 'Открыть остров') + btn('ok', 'check', 'Понятно');
  }
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    const done = miniSwap(el, 'act:' + a.key, 'actv');
    el.innerHTML = `<div class="mact">${ic}</div>
      <div class="meta"><div class="trow"><div class="t">${title}</div>${eyes}</div><div class="a">${sub}</div>${extra}</div>
      <div class="ctl">${ctl}</div>`;
    done();
    for (const b of $$('[data-ma]', el)) b.onclick = (e) => { e.stopPropagation(); miniAction(b.dataset.ma, primaryActivity()); };
  } else {
    // live parts: elapsed time, call timer, download size, countdown
    const ms = $('.js-ms', el);
    if (ms && a.kind === 'agent') ms.textContent = agoMin(a.s.started || a.s.updated);
    if (ms && a.kind === 'call') ms.textContent = clock((Date.now() - a.call.since) / 1000);
    if (ms && a.kind === 'game') ms.textContent = playTime(a.game.since);
    if (ms && a.kind === 'download') { ms.textContent = dlText(a.dl); const bar = $('.mbar.det i', ms.closest('.v-mini') || document); if (bar && a.dl.total) bar.style.width = Math.min(100, (a.dl.size / a.dl.total) * 100) + '%'; }
    const mn = $('.js-mn', el);
    if (mn && a.kind === 'agent') mn.textContent = (a.s.tool ? a.s.tool + ': ' : '') + (a.s.note || '');
    if (a.kind === 'timer') {
      const mt = $('.js-mt', el); if (mt) mt.textContent = clock((a.timer.at - Date.now()) / 1000);
      const total = Math.max(1, (a.timer.at - (a.timer.created || a.timer.at - 60e3)) / 1000);
      $('.mact-ic.tm', el)?.style.setProperty('--p', Math.max(0, Math.min(1, (a.timer.at - Date.now()) / 1000 / total)));
    }
  }
}
function miniAction(act, a) {
  if (!a) return;
  if (act === 'home') { expand('home'); return; }
  if (act === 'fold') { foldActivity(a.key); setView('compact'); return; }
  if (act === 'folder') { api.invoke('downloads:folder'); return; }
  if (act === 'game') { setView('compact'); api.invoke('games:focus'); return; }
  if (act === 'ok') { doneFlash = null; renderCompact(true); setView('compact'); return; }
  if (a.kind === 'call') {
    if (act === 'hangup') { api.invoke('calls:hangup', a.call.id).then((r) => { if (r?.confirm) flashBelow({ icon: '📞', title: 'Подтверди выход в окне звонка', ms: 2600 }); }); return; }
    api.invoke(act === 'mic' ? 'calls:mic' : 'calls:sound', a.call.id);
    return;
  }
  if (a.kind === 'timer') {
    const t = a.timer;
    api.invoke('reminders:remove', t.id);
    if (act === 'plus1') api.invoke('reminders:add', { ...t, id: undefined, at: t.at + 60e3 });
    return;
  }
}

function renderMiniSummary(el) {
  el.classList.remove('actv');
  el.classList.add('sum');
  const back = !!(miniMusicOff && state.media?.active && !playerHidden()); // the player was put away: offer it back
  if (el.dataset.key !== 'sum' + back) {
    el.dataset.key = 'sum' + back;
    const done = miniSwap(el, 'sum', 'sum');
    const acts = [['region', 'Скриншот'], ['timer', 'Таймер'], ['ai', 'ИИ'], ['clip', 'Буфер']];
    el.innerHTML = `<div class="ms-clock"><b class="js-mt"></b><small class="js-md"></small></div>
      <div class="ms-w js-mw"></div>
      <div class="ms-acts">${back ? `<button class="cbtn ms-back" data-back title="Вернуть плеер">${icon('lyrics', 17)}</button>` : ''}${acts.map(([id, t]) => `<button class="cbtn" data-q="${id}" title="${t}">${icon(QUICK[id].icon, 17)}</button>`).join('')}</div>`;
    const bb = $('[data-back]', el);
    if (bb) bb.onclick = (e) => { e.stopPropagation(); miniMusicOff = null; el.dataset.key = ''; renderMini(); };
    done();
    for (const b of $$('[data-q]', el)) b.onclick = (e) => { e.stopPropagation(); QUICK[b.dataset.q].run(ctx); };
  }
  $('.js-mt', el).textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  $('.js-md', el).textContent = dateText();
  const c = state.weather?.current;
  $('.js-mw', el).innerHTML = c ? `<span class="ms-e">${weatherIcon(c.weather_code, c.is_day, 30)}</span><span><b>${Math.round(c.temperature_2m)}°</b><small>${esc(state.weather.place || '')}</small></span>` : '';
}

// ---------------- toasts & notifications ----------------
let lastNoticeAt = 0; // when the last notification came in (its app may grab the focus for a moment)
function showToast(t) {
  lastNoticeAt = performance.now();
  if (t.icon === '⚠️') { flashMood('mood-angry', 2600); playSound('error'); } // errors make the island angry (and red)
  // a message from the chat that is on screen right now updates that bubble instead of queueing another
  const key = isMessage(t) && (t.tgPeer || `${t.app}|${t.title}`);
  const same = (x) => !!x && isMessage(x) && (x.tgPeer || `${x.app}|${x.title}`) === key;
  if (key && view === 'toast' && same(currentToast)) {
    if (currentToast.voice && voice) return toastQueue.push(t), undefined; // a voice message is playing: the next one waits its turn
    Object.assign(currentToast, { body: t.body, thumb: t.thumb || currentToast.thumb, count: (currentToast.count || 1) + 1, voice: t.voice, media: t.media, tgMsgId: t.tgMsgId, duration: t.duration });
    renderToast(currentToast, true);
    measureToast(currentToast);
    prepTyping(currentToast);
    applySize();
    if (currentToast.words) { const ct = currentToast; setTimeout(() => startTyping(ct), 200); } else setTimeout(fitToast, 700);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(nextToast, msgMs(currentToast));
    return;
  }
  const queued = key && toastQueue.find(same);
  if (queued && !t.voice && !queued.voice) { Object.assign(queued, { body: t.body, count: (queued.count || 1) + 1 }); return; }
  toastQueue.push(t);
  if (!currentToast) nextToast();
}
// 75 000 ms -> "1 мин 15 с"
const dur = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} с` : s < 3600 ? `${Math.floor(s / 60)} мин${s % 60 ? ` ${s % 60} с` : ''}` : `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин`; };
// "45% · 12 из 26 МБ · 3.1 МБ/с" when the size is known (from the phone), else "12 МБ · 3.1 МБ/с"
const dlText = (d) => (d.total ? `${Math.floor((d.size / d.total) * 100)}% · ` : '') + bytes(d.size) + (d.total ? ` из ${bytes(d.total)}` : '') + (d.speed > 0 ? ` · ${bytes(d.speed)}/с` : '');
// how long you've been playing, exactly: "1 ч 26 мин 10 с"
const playTime = (since) => { const t = Math.max(0, Math.floor((Date.now() - since) / 1000)), hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60; return (hh ? `${hh} ч ` : '') + (hh || mm ? `${mm} мин ` : '') + `${ss} с`; };
const hhmmOf = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
// the badge beside the face while you play: the game's own round logo (a gamepad only if it has none)
function setGameBadge(g) {
  if (g?.icon) { stage.style.setProperty('--gamelogo', `url("${g.icon}")`); stage.classList.add('gamelogo'); }
  else { stage.style.removeProperty('--gamelogo'); stage.classList.remove('gamelogo'); }
}
// the quick chat's natural height: header, messages (scroll past a point), reply line, input
function qchatHeight() {
  const v = $('.v-qchat');
  if (!v) return 260;
  const m = $('.qmsgs', v);
  const rest = [...v.children].filter((x) => x !== m).reduce((a, x) => a + x.offsetHeight, 0);
  return rest + Math.min(260, m ? m.scrollHeight + 8 : 120) + 44;
}
// ---------- a voice message right in the banner: press play, it streams from Telegram ----------
let voice = null; // { key, audio, url }
const vkey = (t) => `${t.tgPeer}:${t.tgMsgId}`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// what an attachment says in the banner: an icon and a word (no emoji: they don't render everywhere)
const ATTACH = { voice: ['mic', 'Голосовое'], round: ['play', 'Кружок'], photo: ['image', 'Фото'], video: ['play', 'Видео'], gif: ['play', 'GIF'], sticker: ['image', 'Стикер'], audio: ['volume', 'Аудио'], file: ['file', 'Файл'] };
function attachBubble(t, bump) {
  const kind = t.voice || t.media;
  const [ic, word] = ATTACH[kind] || ['file', 'Вложение'];
  const dur = (kind === 'voice' || kind === 'round') && t.duration ? ' · ' + mmss(t.duration) : '';
  const caption = t.body ? esc(t.body) : `${word}${dur}`;
  const pic = /^(photo|video|gif|sticker|round)$/.test(kind) ? `<span class="mpic${kind === 'round' ? ' round' : ''}${kind === 'sticker' ? ' st' : ''}">${kind === 'video' || kind === 'gif' || kind === 'round' ? `<i>${icon('play', 12)}</i>` : ''}</span>` : `<span class="mic">${icon(ic, 14)}</span>`;
  return `<div class="mbub mattach${bump ? ' bump' : ''}">${pic}<span class="mlabel${t.body ? '' : ' one'}">${caption}</span></div>`; // a bare label ("Фото", "Голосовое · 0:14") on one line
}
// the small preview arrives a moment later; the banner already has its place
async function loadAttachThumb(t) {
  let r = null;
  try { r = await api.invoke('tg:media', t.tgPeer, t.tgMsgId, true); } catch {}
  if (!r?.data || currentToast !== t) return;
  const url = URL.createObjectURL(new Blob([r.data], { type: r.mime }));
  const pic = $('.v-toast .mpic');
  if (pic) { pic.style.backgroundImage = `url('${url}')`; pic.classList.add('in'); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function voiceRow(t) {
  const playing = voice?.key === vkey(t) && !voice.audio.paused;
  const bars = Array.from({ length: 28 }, (_, i) => `<i style="height:${4 + Math.round(10 * Math.abs(Math.sin(i * 1.7 + t.tgMsgId)))}px"></i>`).join('');
  return `<div class="mvoice" data-vkey="${esc(vkey(t))}"><button class="mplay${playing ? ' on' : ''}" title="${playing ? 'Пауза' : 'Прослушать'}">${mediaIcon(playing ? 'pause' : 'play', 14)}</button>`
    + `<div class="mwave">${bars}<b class="mprog"></b></div><span class="mtime">${mmss(t.duration || 0)}</span>${t.voice === 'round' ? '<span class="mkind">кружок</span>' : ''}</div>`;
}
async function toggleVoice(t, row) {
  const key = vkey(t);
  if (voice?.key === key) { voice.audio.paused ? voice.audio.play() : voice.audio.pause(); return; }
  stopVoice();
  const btn = row.querySelector('.mplay');
  btn.classList.add('load');
  let r = null;
  try { r = await api.invoke('tg:media', t.tgPeer, t.tgMsgId, false); } catch {}
  btn.classList.remove('load');
  if (!r?.data) { flashBelow({ icon: '🎤', title: 'Не получилось загрузить голосовое', ms: 2000 }); return; }
  const url = URL.createObjectURL(new Blob([r.data], { type: r.mime }));
  const audio = document.createElement(t.voice === 'round' ? 'video' : 'audio');
  audio.src = url;
  voice = { key, audio, url };
  const sync = () => {
    const el = document.querySelector(`.mvoice[data-vkey="${CSS.escape(key)}"]`);
    if (!el) return;
    const k = audio.duration ? audio.currentTime / audio.duration : 0;
    el.style.setProperty('--vp', k);
    el.querySelector('.mtime').textContent = mmss(audio.paused && !audio.currentTime ? (t.duration || audio.duration || 0) : audio.currentTime);
    const b = el.querySelector('.mplay'); b.classList.toggle('on', !audio.paused); b.innerHTML = mediaIcon(audio.paused ? 'play' : 'pause', 14);
  };
  audio.ontimeupdate = sync; audio.onplay = () => { sync(); clearTimeout(toastTimer); }; // the banner stays while it plays
  audio.onpause = sync;
  audio.onended = () => { sync(); stopVoice(); if (view === 'toast') toastTimer = setTimeout(nextToast, 2500); };
  audio.play().catch(() => {});
  api.invoke('tg:listened', t.tgPeer, t.tgMsgId).catch(() => {});
}
function stopVoice() { if (!voice) return; try { voice.audio.pause(); } catch {} URL.revokeObjectURL(voice.url); voice = null; }
const MSG_MS = 7000; // a message stays a little longer: there is text to read
function nextToast() {
  stopReading(); // the next banner has its own face
  stopTyping();
  clearTimeout(toastTimer);
  stopVoice();
  currentToast = toastQueue.shift() || null;
  if (!currentToast) { if (view === 'toast') setView(state.agents.asks?.length ? 'ask' : 'compact'); return; }
  if (stashed || ['open', 'palette', 'qchat', 'mini', 'ask', 'drop'].includes(view)) { // (hidden away: the banner comes down from the top)
    // something is open (the island, the mini island, the little chat...): it stays open, the news comes
    // as a small flash below it; a message from the chat that is open right now needs no flash at all
    const t = currentToast;
    currentToast = null;
    if (view === 'qchat' && t.tgPeer && String(t.tgPeer) === quickChatPeer()) return nextToast();
    if (isMessage(t)) {
      const who = (t.title || t.app || '').split(' · ')[0];
      const what = t.body || (t.voice ? 'Голосовое сообщение' : t.media ? 'Вложение' : 'Сообщение');
      flashBelow({ msg: t, who, what, ms: Math.max(4200, Math.min(7000, 3000 + what.length * 35)) });
    } else flashBelow(t);
    return nextToast();
  }
  const t = currentToast;
  renderToast(t);
  measureToast(t);
  if (t.box && t.box.h + 200 > WIN.h) fitWindow(t.box.w, t.box.h);
  prepTyping(t);
  setView('toast');
  if (t.words) setTimeout(() => startTyping(t), t.long ? 520 : 300); else setTimeout(fitToast, 700);
  toastTimer = setTimeout(nextToast, isMessage(t) ? msgMs(t) : t.ms || (t.sticky ? 9000 : 4500));
}
// A message (Telegram, WhatsApp, Discord...) looks like a message, not a system notice:
// the sender's round avatar with the app's badge, their name, and the text in a chat bubble.
// Telegram's own logo: the blue circle (its gradient) with the white plane
const TG_LOGO = '<svg viewBox="0 0 240 240" width="100%" height="100%"><defs><linearGradient id="tgLogoG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2AABEE"/><stop offset="1" stop-color="#229ED9"/></linearGradient></defs><circle cx="120" cy="120" r="120" fill="url(#tgLogoG)"/><path fill="#fff" d="M54.3 118.8c35-15.2 58.3-25.3 70-30.2 33.3-13.9 40.3-16.3 44.8-16.4 1 0 3.2.2 4.7 1.4 1.2 1 1.5 2.3 1.7 3.3s.4 3.1.2 4.7c-1.8 19-9.6 65.1-13.6 86.3-1.7 9-5 12-8.2 12.3-7 .6-12.3-4.6-19-9-10.6-6.9-16.5-11.2-26.8-18-11.9-7.8-4.2-12.1 2.6-19.1 1.8-1.8 32.5-29.8 33.1-32.3.1-.3.1-1.5-.6-2.1-.7-.6-1.7-.4-2.5-.2-1.1.2-17.9 11.4-50.6 33.5-4.8 3.3-9.1 4.9-13 4.8-4.3-.1-12.5-2.4-18.7-4.4-7.5-2.4-13.5-3.7-13-7.9.3-2.2 3.3-4.4 8.9-6.7z"/></svg>';
const AV_TONES = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];
function senderAvatar(t, name) {
  if (t.thumb) return `<span class="mav" style="background-image:url('${t.thumb}')"></span>`;
  const tone = AV_TONES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AV_TONES.length];
  return `<span class="mav" style="background:${tone}">${esc([...name][0]?.toUpperCase() || '•')}</span>`;
}
const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, font) { measureCtx.font = font; return measureCtx.measureText(text).width; }
// how many lines a text takes when wrapped at this width (word by word, like the browser does)
function wrapLines(text, font, width) {
  measureCtx.font = font;
  let n = 1, cur = '';
  for (const w of text.split(' ')) {
    const next = cur ? cur + ' ' + w : w;
    if (measureCtx.measureText(next).width <= width) { cur = next; continue; }
    if (cur) n++;
    cur = w;
    while (measureCtx.measureText(cur).width > width) { n++; cur = cur.slice(Math.max(1, Math.floor(cur.length * width / measureCtx.measureText(cur).width))); } // a very long word breaks
  }
  return n;
}
// The island around the text (avatar, button, eyes, margins) is measured on screen once the size has settled:
// if the text column came out narrower than the text, the island widens by exactly that much.
const toastChrome = {};
// the room around the text depends on whether a character sits there
const chromeKey = (k) => k + (state.settings?.island?.character === 'none' ? ':none' : '');
// The banner's real size before it opens: an invisible copy is laid out at the island's future width,
// the width is corrected once for the text, then the height is read off the copy. So the island opens
// straight to its final size in one smooth move, instead of growing in steps over the text.
function measureToast(t) {
  if (!t?.box || !isMessage(t)) return;
  const src = $('.v-toast');
  const probe = src.cloneNode(true);
  Object.assign(probe.style, { position: 'absolute', left: '-4000px', top: '0', right: 'auto', bottom: 'auto', height: 'auto', visibility: 'hidden', transition: 'none', animation: 'none', pointerEvents: 'none' });
  probe.querySelectorAll('*').forEach((n) => { n.style.animation = 'none'; n.style.transition = 'none'; });
  stage.append(probe);
  try {
    const at = (w) => { probe.style.width = w + 'px'; probe.style.setProperty('--r', Math.min(36, t.box.h / 2) + 'px'); return $('.tb', probe); };
    let tb = at(t.box.w);
    if (t.fit && tb.offsetWidth && Math.abs(tb.offsetWidth - t.fit) > 1) {
      t.box.w = Math.round(Math.max(isMessage(t) ? 250 : 340, Math.min(t.maxw || 640, t.box.w + (t.fit - tb.offsetWidth))));
      tb = at(t.box.w);
    }
    const nm = $('.mhead b', probe), realNm = $('.mhead b', src);
    if (nm && realNm) {
      let fs = parseFloat(getComputedStyle(nm).fontSize) || 15;
      nm.style.fontSize = ''; realNm.style.fontSize = '';
      while (nm.scrollWidth > nm.clientWidth + 1 && fs > 11) { fs -= 0.5; nm.style.fontSize = fs + 'px'; }
      if (nm.style.fontSize) realNm.style.fontSize = nm.style.fontSize;
    }
    const bub = $('.mbub', probe);
    const room = tb.clientWidth - (bub ? bub.offsetLeft - tb.offsetLeft : 0); // whatever indent the bubble has inside its column
    if (bub && room > 0 && bub.offsetWidth > room) {
      const w = room + 'px';
      bub.style.width = w;
      const real = $('.mbub', src); if (real) real.style.width = w;
    }
    if (bub) $('.mbub', src)?.classList.toggle('cut', bub.scrollHeight > bub.clientHeight + 1);
    if (tb.scrollHeight) t.box.h = Math.round(Math.max(78, tb.scrollHeight + 26));
    toastChrome[chromeKey('plain')] = t.box.w - tb.offsetWidth;
  } catch {} finally { probe.remove(); }
}
function fitToast(tries = 8) {
  const t = currentToast;
  if (!t?.fit || view !== 'toast') return;
  const tb = $('.v-toast .tb');
  if (!tb?.offsetWidth) return;
  const isl = $('#island');
  if (Math.abs(isl.offsetWidth - t.box.w) > 2) { if (tries > 0) setTimeout(() => fitToast(tries - 1), 250); return; } // still resizing
  toastChrome[chromeKey(t.kind === 'telegram' && t.tgPeer ? 'reply' : 'plain')] = isl.offsetWidth - tb.offsetWidth;
  // a message: what the name line and the bubble really take on screen decides the width (no estimate),
  // so a short "ок" never leaves an empty stretch between the text and Windik
  if (isMessage(t)) {
    const head = $('.v-toast .mhead'), nm = head && $('b', head), bub = $('.v-toast .mbub');
    if (head && nm) {
      const kids = [...head.children].filter((k) => k.offsetWidth || k === nm);
      const gap = parseFloat(getComputedStyle(head).columnGap) || 0;
      const headNeed = kids.reduce((sum, k) => sum + (k === nm ? nm.scrollWidth : k.offsetWidth), 0) + gap * Math.max(0, kids.length - 1) + 4;
      // an attachment keeps the width worked out for it: read back from the layout, its caption (already
      // wrapped in a too-narrow column) gave a smaller width each time, down to a letter per line
      t.fit = Math.ceil(Math.max(headNeed, t.attachFit || 0, bub ? (t.attachFit ? bub.scrollWidth : bub.offsetWidth) : 0));
    }
  }
  const w = Math.round(Math.max(isMessage(t) ? 250 : 340, Math.min(t.maxw || 640, t.box.w + (t.fit - tb.offsetWidth))));
  if (Math.abs(w - t.box.w) > 1) { t.box.w = w; applySize(); if (tries > 0) setTimeout(() => fitToast(tries - 1), 600); return; }
  // the height from the real layout: long links and words wrap differently than any estimate,
  // so the island grows to the text as it actually lies (up to 6 lines, then it fades out)
  const bub = $('.v-toast .mbub');
  if (bub) bub.classList.toggle('cut', bub.scrollHeight > bub.clientHeight + 1);
  const hNeed = Math.round(Math.max($('.v-toast').classList.contains('msg') ? 78 : 68, tb.scrollHeight + 26));
  if (Math.abs(hNeed - t.box.h) > 1) { t.box.h = hNeed; applySize(); }
}
// how far a character's body (ears, horns, the ghost's sheet...) sticks out past its eyes on each side,
// so the face can sit exactly 5px from the island's edge whoever lives there
function faceOverhang(ey) {
  let l = 0, r = ey.offsetWidth;
  for (const d of ey.querySelectorAll(':scope > .deco > i')) {
    if (!d.offsetWidth && !d.offsetHeight) continue;
    l = Math.min(l, d.offsetLeft); r = Math.max(r, d.offsetLeft + d.offsetWidth);
  }
  const k = 20 / (ey.offsetWidth || 20);
  return [Math.round(-l * k), Math.round((r - ey.offsetWidth) * k)];
}
// Reading a long message: first a "whoa, that much?", then the face glides down along the text
// line by line, its eyes running along each line (toward the text, on its left), puzzled marks overhead.
let reading = null;
function stopReading() {
  if (!reading) return;
  clearTimeout(reading.t);
  const { te, ey } = reading;
  reading = null;
  te?.style.setProperty('--rp', '.5');
  lookAt(ey, null);
}
function startReading(t, perLine) {
  stopReading();
  const el = $('.v-toast'), te = $('.teyes', el), ey = te && $('.eyes', te), bub = $('.mbub', el);
  if (!ey || !bub || view !== 'toast') return;
  const lines = Math.max(2, t.lines || Math.round((bub.clientHeight - 14) / 17));
  const per = perLine || Math.max(650, Math.min(1300, (msgMs(t) - 2400) / lines));
  reading = { te, ey, t: 0 };
  te.style.setProperty('--rp', '0');
  let line = 0, k = 0;
  const SAC = 3; // eye jumps per line
  const tick = () => {
    if (!reading || reading.te !== te || view !== 'toast') return;
    if (line === 0 && k === 0) flashMood('mood-confused', per * lines + 400);
    if (line >= lines) { reading.t = setTimeout(stopReading, 500); return; }
    te.style.setProperty('--rp', String(lines > 1 ? line / (lines - 1) : 0.5));
    // left end of the line first, then toward its end (nearer the face)
    lookAt(ey, -3.4 + (k / (SAC - 1)) * 2.2, -0.6 + (Math.random() - 0.5) * 0.6);
    if (++k >= SAC) { k = 0; line++; }
    reading.t = setTimeout(tick, per / SAC);
  };
  reading.t = setTimeout(tick, perLine ? 0 : 1100);
}
// how long a message stays: long enough to read it (and to watch it being typed)
function msgMs(t) {
  if (t?.voice || t?.media) return 6500;
  return Math.round(Math.max(5000, Math.min(40000, 4000 + (t?.chars || 0) * 45)) + (t?.typeMs || 0));
}
// A long message is typed out letter by letter and the island grows with it, line by line;
// Windik reads along, moving down with the lines.
let typing = null;
function prepTyping(t) {
  stopTyping();
  if (!t?.box || !isMessage(t) || t.voice || t.media || !t.body) return;
  t.words = true;
  if (!t.long) {
    const bub = $('.v-toast .mbub');
    if (!bub) return;
    const words = t.body.replace(/\s+/g, ' ').trim().split(' ');
    t.typeMs = Math.round(Math.max(220, Math.min(650, words.length * 45)));
    bub.innerHTML = words.map((w) => `<span class="w">${esc(w)} </span>`).join('');
    bub.classList.add('typing');
    return;
  }
  t.finalH = t.box.h;
  const bub = $('.v-toast .mbub');
  if (!bub) return;
  const words = t.body.replace(/\s+/g, ' ').trim().split(' ');
  t.typeMs = Math.round(Math.max(700, Math.min(3200, 500 + Math.sqrt(words.length) * 150))); // the longer, the faster it types
  bub.innerHTML = words.map((w) => `<span class="w">${esc(w)} </span>`).join('');
  bub.classList.add('typing');
  t.box.h = 78; // the island opens with the first line's height and grows from there
}
function stopTyping() { if (typing) { clearInterval(typing.iv); typing = null; } }
function startTyping(t) {
  const bub = $('.v-toast .mbub'), tb = $('.v-toast .tb');
  if (!bub || !tb || currentToast !== t || !t.words) return;
  const ws = [...bub.querySelectorAll('.w')];
  // several words per step when there are many: a long text is typed fast, a short one word by word
  const STEP = Math.max(16, Math.round(t.typeMs / Math.max(1, ws.length)));
  const per = Math.max(1, ws.length * STEP / Math.max(1, t.typeMs));
  let i = 0, due = 0;
  typing = { iv: 0 };
  const grow = () => {
    if (!t.long) return; // a short one already has its size
    const h = Math.round(Math.min(t.finalH, Math.max(78, tb.scrollHeight + 26)));
    if (Math.abs(h - t.box.h) > 1) { t.box.h = h; applySize(); }
  };
  typing.iv = setInterval(() => {
    if (currentToast !== t || view !== 'toast') return stopTyping();
    for (due += per; i < Math.floor(due) && i < ws.length; i++) ws[i].classList.add('in');
    grow();
    if (i >= ws.length) { stopTyping(); setTimeout(() => bub.classList.remove('typing'), 500); if (t.long) { t.box.h = t.finalH; applySize(); } setTimeout(fitToast, 450); }
  }, STEP);
  if (t.long && !state.settings?.dnd) startReading(t, Math.max(550, Math.min(1300, (msgMs(t) - 2500) / Math.max(1, t.lines)))); // at a reading pace, not the typing's
}
function placeToastFace(el) {
  const te = $('.teyes', el), ey = te && $('.eyes', te);
  if (!ey) return;
  const [l, r] = faceOverhang(ey);
  te.style.setProperty('--fl', l + 'px'); te.style.setProperty('--fr', r + 'px');
}
function renderToast(t, bump) {
  const el = $('.v-toast');
  const msg = isMessage(t);
  el.classList.toggle('msg', msg);
  if (msg) {
    const [who, where] = (t.title || t.app || '').split(' · ');
    const badge = t.kind === 'telegram' ? `<span class="mbadge tg${bump ? '' : ' intro'}">${TG_LOGO}</span>` : t.logo ? `<span class="mbadge" style="background-image:url('${t.logo}')"></span>` : '';
    const reply = false; // no button: a click on the message opens the chat to answer
    stopReading();
    el.innerHTML = `<div class="ti">${senderAvatar(t, who || '•')}${badge}</div>
      <div class="tb"><div class="mhead"><b>${esc(who || '')}</b>${where ? `<span class="mwhere">${esc(where)}</span>` : ''}${t.count > 1 ? `<span class="mcount">${t.count}</span>` : ''}</div>
      <div class="mrow">${t.voice || t.media ? attachBubble(t, bump) : `<div class="mbub${bump ? ' bump' : ''}">${esc(t.body || 'Сообщение')}</div>`}</div></div>
      <div class="tact"></div><div class="teyes"><div class="tface">${eyesHTML('main toast-eyes')}</div></div>`;
    placeToastFace(el);
    el.classList.remove('long');
    if (t.media && t.tgMsgId && /^(photo|video|gif|sticker|round)$/.test(t.media)) loadAttachThumb(t);
    // the island grows with the message: wider for a longer line, taller (up to 6 lines) for a long text
    const fontOf = (e) => { const c = getComputedStyle(e); return `${c.fontWeight} ${c.fontSize} ${c.fontFamily}`; }; // fonts are known even before the toast is shown
    const text = (t.body || 'Сообщение').replace(/\s+/g, ' ').trim();
    const chrome = toastChrome[chromeKey(reply ? 'reply' : 'plain')] || (state.settings?.island?.character === 'none' ? 160 : 186); // measured before, or what it usually is
    const where$ = $('.mwhere', el);
    const head = textWidth(who || '', fontOf($('.mhead b', el))) + 12 + (where$ ? 6 + Math.min(160, textWidth(where, fontOf(where$))) : 0) + (t.count > 1 ? 30 : 0); // +12: the name's margin and letter spacing
    if (t.voice || t.media) {
      if (!state.settings?.dnd) flashMood('mood-startle', 1300);
      const ab = $('.mbub', el), pic = !!$('.mpic', ab);
      const label = $('.mlabel', ab)?.textContent || '';
      const tw = textWidth(label, fontOf(ab)) + (pic ? 74 + 10 : 22) + 30;
      t.fit = Math.max(head, Math.min(640 - chrome, tw));
      t.attachFit = t.fit; // its own width, worked out from the text (not read back from a squeezed layout)
      t.box = { w: Math.round(Math.max(340, Math.min(640, chrome + t.fit))), h: pic ? 112 : 84 };
      return;
    }
    const bub = $('.mbub', el);
    const n = text.length;
    const sz = n > 220 ? 's' : n > 90 ? 'm' : '';
    bub.classList.toggle('sz-m', sz === 'm'); bub.classList.toggle('sz-s', sz === 's');
    const LH = sz === 's' ? 15.5 : sz === 'm' ? 16 : 17;
    const MAXL = Math.max(7, Math.floor((screen.height * 0.72 - 70) / LH)); // the whole message, up to 70% of the screen
    bub.style.maxHeight = Math.round(MAXL * LH) + 'px';
    // a longer text makes the banner wider too, not only taller (up to half the screen)
    t.maxw = sz === 's' ? Math.round(Math.min(screen.width * 0.5, 940, 540 + (n - 220) * 0.4)) : sz === 'm' ? 520 : 560;
    const font = fontOf(bub), PAD = 30, MAXW = t.maxw, MINW = 250; // padding plus a little slack, so a line that fits never wraps
    const maxBub = MAXW - chrome - (reply ? 38 : 0);
    const line = textWidth(text, font) + PAD;
    const bubW = Math.min(maxBub, line);
    const lines = line <= maxBub ? 1 : Math.min(MAXL, wrapLines(text, font, maxBub - PAD));
    bub.style.width = Math.ceil(bubW) + 'px';
    bub.style.webkitLineClamp = 6;
    t.fit = Math.max(bubW + (reply ? 38 : 0), head); // the text column's width; the rest of the island is measured once it is on screen (fitToast)
    t.box = { w: Math.round(Math.max(MINW, Math.min(MAXW, chrome + t.fit))), h: Math.round(Math.max(78, 26 + 26 + lines * LH)) };
    t.lines = lines; t.chars = n;
    // the face reacts when the message is actually on screen (also after waiting in the queue):
    // a short one - surprised; a long one - wow, that much? and it reads it line by line
    t.long = lines >= 3;
    el.classList.toggle('long', t.long);
    if (!state.settings?.dnd) flashMood('mood-startle', t.long ? 900 : 1300);
    return;
  }
  el.innerHTML = `<div class="ti">${glyphTile(t, 40)}</div>
    <div class="tb">${t.app ? `<div class="tapp">${esc(t.app)}</div>` : ''}<div class="tt">${esc(t.title || '')}</div>${t.body ? `<div class="tx">${esc(t.body)}</div>` : ''}</div>
    <div class="tact"></div><div class="teyes"><div class="tface">${eyesHTML('main toast-eyes')}</div></div>`;
  placeToastFace(el);
  const act = $('.tact', el);
  for (const b of t.buttons || []) act.append(h('button', { class: 'btn sm' + (b.pri ? ' pri' : ' ghost'), onclick: (e) => { e.stopPropagation(); api.invoke(b.ch, ...(b.args || [])); nextToast(); } }, b.label));
  if (t.url) act.append(h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); api.invoke('url:open', t.url); nextToast(); } }, 'Открыть'));
  if (t.path) {
    act.append(h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); api.invoke('file:open', t.path); nextToast(); } }, 'Открыть'));
    act.append(h('button', { class: 'btn sm ghost', onclick: (e) => { e.stopPropagation(); api.invoke('file:reveal', t.path); nextToast(); } }, h('span', { html: icon('folder', 13) }), 'Папка'));
  }
  el.classList.toggle('dldone', !!t.dlDone);
  if (t.dlDone) { $('.ti', el).innerHTML = `${t.thumb ? `<span class="dlfile" style="background-image:url('${t.thumb}')"></span>` : `<span class="dlfile gen">${icon(t.folder ? 'image' : 'file', 22)}</span>`}<span class="dltick">${icon('check', 11)}</span>`; flashMood('mood-joy', 1800); }
}
function flashBelow(t) {
  // a message while the island (or the mini island, the little chat) is open: a banner like the
  // mini island under it - the sender's picture with the app's badge, the name, two lines of text
  flash.classList.toggle('msg', !!t.msg);
  flash.classList.toggle('top', !!t.msg && stashed); // the island is hidden away: it comes down from the top edge
  if (t.msg) {
    const m = t.msg, where = (m.title || '').split(' · ')[1] || m.app || '';
    const badge = m.kind === 'telegram' ? `<span class="mbadge tg">${TG_LOGO}</span>` : m.logo ? `<span class="mbadge" style="background-image:url('${m.logo}')"></span>` : '';
    // the island's own body underneath: its colours, the liquid flowing in it, its skin and sheen
    flash.innerHTML = `<div class="fib">${isl.querySelector(':scope > .ib')?.innerHTML || ''}</div><div class="fav">${senderAvatar(m, t.who || '•')}${badge}</div>`
      + `<div class="fbody"><div class="fhead"><b>${esc(t.who || '')}</b>${where ? `<span>${esc(where)}</span>` : ''}</div><div class="ftext">${esc(t.what || '')}</div></div>`
      + `${eyesHTML('main flash-eyes')}<i class="fbar" style="animation-duration:${t.ms}ms"></i>`;
  } else flash.innerHTML = `${t.thumb ? `<div class="th" style="background-image:url('${t.thumb}')"></div>` : glyphTile(t, 24)}<span>${esc(t.title)}</span>${eyesHTML('main flash-eyes')}`;
  clearTimeout(flash._out);
  flash.classList.remove('on', 'out'); void flash.offsetWidth; // a new one comes in again, even over the last one
  if (t.icon === '🤔') flashMood('mood-confused', 2200); // didn't understand -> confused
  flash.classList.add('on');
  sendShape();
  clearTimeout(flash._t);
  clearTimeout(flash._out);
  flash._t = setTimeout(() => {
    // it leaves softly: a message banner shrinks back up like a drop and melts away
    if (flash.classList.contains('msg')) {
      flash.classList.add('out');
      flash._out = setTimeout(() => { flash.classList.remove('on', 'out'); sendShape(); }, 720);
    } else { flash.classList.remove('on'); setTimeout(sendShape, 450); }
  }, t.ms || 2200);
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
  nav.innerHTML = '<div class="ind"></div><div class="hvind"></div><div class="hvlab"></div>';
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
  // the pill glides by a CSS transition: measured once here, not read and written again every frame
  if (!indPos.init) { ind.style.transition = 'none'; indPos.init = true; }
  if (tx !== indPos.x || tw !== indPos.w) { indPos.x = tx; indPos.w = tw; ind.style.transform = `translateX(${tx}px)`; ind.style.width = tw + 'px'; }
  if (ind.style.transition === 'none') { void ind.offsetWidth; ind.style.transition = ''; }
}
function moveIndicator() { if (!indRaf) indRaf = requestAnimationFrame(indicatorFrame); }
// Hover: nothing in the strip changes size (that made the tabs jump under the cursor). A soft pill
// glides to the hovered icon and its name shows in a small tag under it; both move with CSS easing.
let hvTab = null, hvHide = 0;
function showHover(t) {
  const strip = t.closest('.tabs'), pill = strip.querySelector('.hvind'), lab = strip.querySelector('.hvlab');
  if (!pill || !lab) return;
  clearTimeout(hvHide);
  const first = !pill.classList.contains('on');
  const x = t.offsetLeft, w = t.offsetWidth;
  if (first) { pill.style.transition = 'none'; lab.style.transition = 'none'; } // appear in place, then glide from there
  pill.style.transform = `translateX(${x}px)`; pill.style.width = w + 'px';
  lab.textContent = t.title || t.textContent.trim();
  lab.style.transform = `translateX(${Math.round(x + w / 2 - lab.offsetWidth / 2)}px)`;
  if (first) { void pill.offsetWidth; pill.style.transition = ''; lab.style.transition = ''; }
  pill.classList.toggle('on', !t.classList.contains('on')); // the selected tab already has its own pill
  lab.classList.toggle('on', !t.classList.contains('on'));
  hvTab = t;
}
document.addEventListener('pointerover', (e) => {
  const t = e.target.closest?.('.tabs .tab');
  if (t && t !== hvTab) showHover(t);
});
document.addEventListener('pointerout', (e) => {
  if (!e.target.closest?.('.tabs') || e.relatedTarget?.closest?.('.tabs .tab')) return;
  clearTimeout(hvHide);
  hvHide = setTimeout(() => { for (const x of document.querySelectorAll('.tabs .hvind, .tabs .hvlab')) x.classList.remove('on'); hvTab = null; }, 120);
});
document.addEventListener('click', (e) => { const t = e.target.closest?.('.tabs .tab'); if (t) setTimeout(() => showHover(t), 0); });
// any width change in the tab strip (hover labels, tab switch) restarts the chase
const tabsObserver = new ResizeObserver(moveIndicator);
document.addEventListener('transitionrun', (e) => { if (e.target.closest?.('.tabs')) moveIndicator(); });
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
  if (view === 'open') playSound('close');
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
  call: [['#34c759', '#22c7b4', '#4ade80'], '#34c759'],
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
  love: [['#ff4f8b', '#ff8fb8', '#e040a0'], '#ff5d95'],
  laugh: [['#ffcf3f', '#ff9f43', '#ffe680'], '#ffcf3f'],
  confused: [['#a78bfa', '#60a5fa', '#c4b5fd'], '#a78bfa'],
  excited: [['#22d3ee', '#a3e635', '#f472b6'], '#22d3ee'],
  bored: [['#6b7280', '#8b93a1', '#4b5563'], '#7b8494'],
  scared: [['#e0e7ff', '#a5b4fc', '#c7d2fe'], '#c7d2fe'],
  startle: [['#ffffff', '#c9e4ff', '#ffd6f5'], '#ffffff'],
};
// "По умолчанию" when nothing special is going on: the island follows the time of day
const TOD_PALETTES = {
  morning: [['#fdba74', '#fb7185', '#fde68a'], '#fb923c'], // sunrise
  day: [['#0ea5e9', '#22d3ee', '#6366f1'], '#22d3ee'],     // clear sky / sea
  evening: [['#fb923c', '#f43f5e', '#a855f7'], '#fb7185'], // sunset
  night: [['#8b5cf6', '#3b82f6', '#ec4899'], '#8b5cf6'],   // starry night
};
function timeOfDay(d = new Date()) {
  if (window.__tod) return window.__tod; // dev aid: force a time of day
  // with weather data, follow the real sunrise / sunset for your city
  const day = state.weather?.daily;
  const hm = d.getHours() + d.getMinutes() / 60;
  let rise = 6.5, set = 18;
  if (day?.sunrise?.[0] && day?.sunset?.[0]) {
    const r = new Date(day.sunrise[0]), s = new Date(day.sunset[0]);
    rise = r.getHours() + r.getMinutes() / 60; set = s.getHours() + s.getMinutes() / 60;
  }
  if (hm >= rise - 0.5 && hm < rise + 3) return 'morning';
  if (hm >= rise + 3 && hm < set - 1) return 'day';
  if (hm >= set - 1 && hm < set + 1.5) return 'evening';
  return 'night';
}
function moodColors() {
  const m = (currentMood() || '').replace('mood-', '');
  if (coverPalette() && (!m || m === 'dance' || m === 'ponder' || m === 'busy' || m === 'think')) return coverPalette(); // music: the cover's colours, clearly
  if (m === 'dance') return [['#ff4fd8', '#7c5cff', '#00d4ff'], '#ff4fd8'];
  if (!m) return TOD_PALETTES[timeOfDay()];
  return MOOD_PALETTES[m] || TOD_PALETTES[timeOfDay()];
}

const PLAIN = {
  white: { mode: 'light', base: '#ffffff', colors: ['#d9d9e1', '#c7c7d1', '#ececf1'], glow: '#9d9daa' },
  black: { mode: 'dark', base: '#000000', colors: ['#2c2c33', '#1d1d22', '#3a3a42'], glow: '#6e6e7a' },
};
setInterval(() => { if (state.settings?.theme?.style === 'mood' && root.dataset.tod !== timeOfDay()) applyTheme(); }, 60e3);
function applyTheme() {
  const t = state.settings.theme;
  if (t.style === 'white' || t.style === 'black') { t.mode = t.style === 'white' ? 'light' : 'dark'; t.style = 'solid'; saveSettings(); }
  const plain = PLAIN[t.style] || SKINS[t.style]; // looks with fixed colours (skins)
  root.dataset.mode = plain ? plain.mode : t.mode;
  root.dataset.plain = plain ? t.style : '';
  root.dataset.tod = t.style === 'mood' && !coverPalette() ? timeOfDay() : ''; // the default look gets a live background for the time of day (music: the cover's colours instead)
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
  const op = plain ? [0, 0, 0] : moodStyle && coverPalette() ? [1, 0.55, 0] : { mood: [0.85, 0.4, 0], liquid: [0.55, 0, 0], gradient: [0.2, 1, 0], glass: [0.35, 0, 1], solid: [0, 0, 0] }[t.style] || [0.5, 0, 0];
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
let coverGlowColor = null, lastPlayingForTheme = null;
// three shades of the cover's main colour (itself, a lighter neighbour, a deeper one a bit round the wheel)
function coverPalette() {
  if (!coverGlowColor || !state.media?.playing || state.settings.theme.coverGlow === false) return null;
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(coverGlowColor.replace(/\s/g, ''));
  if (!m) return null;
  let [r, g, b] = m.slice(1).map((x) => +x / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let hh = 0; const ss = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (d) { hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
  const s = Math.round(Math.max(0.55, ss) * 100), H = Math.round(hh);
  return [[`hsl(${H} ${s}% 58%)`, `hsl(${(H + 28) % 360} ${s}% 66%)`, `hsl(${(H + 330) % 360} ${s}% 46%)`], `hsl(${H} ${s}% 60%)`];
}
bus.on('media', (m) => { const p = !!m?.playing; if (p !== lastPlayingForTheme) { lastPlayingForTheme = p; if (state.settings?.theme?.style === 'mood') applyTheme(); } });
async function updateCoverGlow() {
  coverGlowColor = state.settings.theme.coverGlow && state.media?.thumb ? await coverColor(state.media.thumb) : null;
  if (state.settings.theme.style === 'mood') applyTheme();
  else root.style.setProperty('--glow', state.settings.theme.glowColor || coverGlowColor || state.settings.theme.colors[0]);
}

// ---------------- cursor reactions ----------------
let faceNow = undefined; // the face's box for this cursor event (read once, before any write)
function onCursor(p) {
  stashCursor(p);
  if (stashed) return;
  const r = isl.getBoundingClientRect();
  faceNow = faceBox(true);
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
  lostCheck(p, near, dx);
  state.near = near;
  // a little gap between "on" and "off" so it doesn't flicker at the edge
  const wasCurious = stage.classList.contains('curious');
  stage.classList.toggle('curious', state.settings.island.cursorReactions !== false && near > (wasCurious ? 0.28 : 0.42) && !inside && (view === 'compact' || view === 'mini'));
  const small = view === 'compact' || view === 'mini' || view === 'toast';
  let tx = 0, ty = 0, rx = 0, ry = 0, sc = 1;
  if (state.settings?.theme?.reactive && small && !onBubble && !isl.classList.contains('stretching')) {
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
  faceNow = undefined;
}

// ---- "where did the mouse go?" ----
// The cursor was right by the character and suddenly flew far away (a flick, or off to another
// screen): it looks around for it, a "?" pops up, then it shrugs. At most every 20 s.
let lostNearT = 0, lostNearX = 0, lostLast = -1e9, lostPrev = null;
function lostCheck(p, near, dx) {
  const now = performance.now();
  if (near > 0.45) { lostNearT = now; lostNearX = dx; }
  const jump = lostPrev ? Math.hypot(p.x - lostPrev.x, p.y - lostPrev.y) : 0;
  lostPrev = { x: p.x, y: p.y };
  if (near > 0 || !lostNearT || now - lostNearT > 280 || now - lostLast < 20000) return;
  if (jump < 160 && now - lostNearT > 120) return; // it just walked away: that's not "lost"
  if (state.settings.island.cursorReactions === false || !(view === 'compact' || view === 'mini')) return;
  if (/mood-sleep|mood-call|mood-game/.test(stage.className)) return; // a game recentres the cursor all the time
  lostLast = now; lostNearT = 0;
  stage.style.setProperty('--lostDir', lostNearX < 0 ? '-1' : '1'); // first looks where it flew off to
  playTrick('lost');
}
// Magnetic buttons: under the cursor a button drifts a few pixels toward it and a soft light follows
// the pointer across it; leaving, it springs back to its place.
{
  const MAG = '.btn, .ibtn, .cbtn-s, .mpb, .chip, .mv-btn, .qsend, .tgtool, .qplay, .tgvp';
  let magEl = null;
  const release = (b) => { if (!b) return; b.style.removeProperty('--bx'); b.style.removeProperty('--by'); };
  stage.addEventListener('pointermove', (e) => {
    const b = e.target.closest?.(MAG);
    if (b !== magEl) { release(magEl); magEl = b; }
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    if (!r.width) return;
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const k = Math.min(3.5, 1.5 + r.width / 40); // bigger buttons travel a little further
    b.style.setProperty('--bx', (Math.max(-1, Math.min(1, dx)) * k).toFixed(2) + 'px');
    b.style.setProperty('--by', (Math.max(-1, Math.min(1, dy)) * k * 0.7).toFixed(2) + 'px');
    b.style.setProperty('--px', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
    b.style.setProperty('--py', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
  });
  stage.addEventListener('pointerleave', () => { release(magEl); magEl = null; });
}
window.__lost = () => { lostLast = 0; stage.style.setProperty('--lostDir', '1'); playTrick('lost'); }; // dev aid

// ---- playing with the island & resting on it ----
// Wiggling the mouse fast over the island makes it happy (like being played with);
// resting the cursor on it (still or very slow) for 2 s opens the mini island.
let islandHover = false, lastP = null, lastT = 0, playDist = 0, playT0 = 0, lastHappy = 0;
let restAt = null, restT = 0; // where/when the cursor came to rest on the island
let restShy = false, lastShy = 0;
// The character walks along the free middle of the pill: wanders on its own and
// comes over to the cursor. Movement is a damped spring (smooth start and stop),
// and it never steps onto the text on either side.
// ---- Windik roams the mini island ----
// Every few hundred ms the free spots are found (where his body touches no text, button, cover or bar);
// he heads for the free spot nearest the cursor when it is around, otherwise strolls to a random one now and
// then. The move is a soft spring with a little squash, like in the pill.
const mw = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, spots: [], next: 0, sq: 0, el: null };
window.__mw = mw; // dev aid
function miniRects(el, walker) {
  const out = [];
  const add = (r) => { if (r && r.width > 1 && r.height > 1) out.push(r); };
  for (const n of el.querySelectorAll('.cbtn, .mact, .art, .prog, .mbar, .bigclock, .mq, button, img, .mnote2')) {
    if (walker.contains(n) || n.closest('.mghost') || !n.offsetWidth) continue;
    add(n.getBoundingClientRect());
  }
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = tw.nextNode(); t; t = tw.nextNode()) {
    if (!t.textContent.trim() || walker.contains(t) || t.parentElement?.closest('.mghost')) continue;
    const rg = document.createRange(); rg.selectNodeContents(t);
    for (const r of rg.getClientRects()) add(r);
  }
  return out;
}
setInterval(() => {
  const el = $('.v-mini');
  const walker = el && $('.mwalk', el);
  if (view !== 'mini' || !walker || travel) { mw.spots = []; return; }
  if (mw.el !== walker) { mw.el = walker; mw.x = mw.y = mw.vx = mw.vy = mw.tx = mw.ty = 0; walker.style.transform = ''; }
  const er = el.getBoundingClientRect();
  const k = er.width / (el.offsetWidth || 1) || 1;
  const fr = walker.getBoundingClientRect();
  // where he would stand without walking (screen px), his size with a little room around
  const bx = fr.left - mw.x * k, by = fr.top - mw.y * k;
  const fw = fr.width + 10 * k, fh = fr.height + 8 * k;
  const busy = miniRects(el, walker);
  const pad = 10 * k, step = 6 * k;
  const spots = [];
  for (let y = er.top + pad; y + fh <= er.bottom - pad; y += step) {
    for (let x = er.left + pad; x + fw <= er.right - pad; x += step) {
      const hit = busy.some((r) => x < r.right && x + fw > r.left && y < r.bottom && y + fh > r.top);
      if (!hit) spots.push([(x + 5 * k - bx) / k, (y + 4 * k - by) / k]);
    }
  }
  mw.spots = spots;
  const home = spots.some(([x, y]) => Math.abs(x) < 4 && Math.abs(y) < 4);
  if (!spots.length || /mood-sleep/.test(stage.className) || state.settings.island.walk === false) { mw.tx = 0; mw.ty = 0; return; }
  const near = state.near || 0;
  const now = performance.now();
  if (mw.hold && now < mw.hold) return; // just landed: stays at his spot for a moment
  if (lastP && near > 0.25) {
    // toward the cursor: the free spot closest to it
    const cx = (lastP.x - bx) / k - fr.width / k / 2, cy = (lastP.y - by) / k - fr.height / k / 2;
    let best = spots[0], bd = Infinity;
    for (const sp of spots) { const d = Math.hypot(sp[0] - cx, sp[1] - cy); if (d < bd) { bd = d; best = sp; } }
    // he comes over after a moment, not the instant the mouse moves
    if (!mw.seenAt) mw.seenAt = now;
    if (now - mw.seenAt > 450) { mw.tx = best[0]; mw.ty = best[1]; }
    mw.next = now + 2500;
  } else if ((mw.seenAt = 0) || now > mw.next) {
    // a stroll: a random free spot (sometimes back home), then a rest
    const pick = home && Math.random() < 0.3 ? [0, 0] : spots[Math.floor(Math.random() * spots.length)];
    mw.tx = pick[0]; mw.ty = pick[1];
    mw.next = now + 4000 + Math.random() * 5000;
  } else if (!spots.some(([x, y]) => Math.abs(x - mw.tx) < 4 && Math.abs(y - mw.ty) < 4)) {
    // his spot got covered (the text changed): go to the nearest free one
    let best = spots[0], bd = Infinity;
    for (const sp of spots) { const d = Math.hypot(sp[0] - mw.tx, sp[1] - mw.ty); if (d < bd) { bd = d; best = sp; } }
    mw.tx = best[0]; mw.ty = best[1];
  }
}, 250);
let fxMiniAt = null;
function miniWalkFrame(now, dt) {
  const w = mw.el;
  if (view !== 'mini' || !w || !w.isConnected) return;
  // an unhurried walk: a soft spring and a top speed, so he strolls over instead of dashing
  const W = 3.2, VMAX = 95;
  mw.vx += (W * W * (mw.tx - mw.x) - 2 * W * mw.vx) * dt;
  mw.vy += (W * W * (mw.ty - mw.y) - 2 * W * mw.vy) * dt;
  const v = Math.hypot(mw.vx, mw.vy);
  if (v > VMAX) { mw.vx *= VMAX / v; mw.vy *= VMAX / v; }
  mw.x += mw.vx * dt; mw.y += mw.vy * dt;
  if (Math.abs(mw.tx - mw.x) < 0.2 && Math.abs(mw.ty - mw.y) < 0.2 && Math.hypot(mw.vx, mw.vy) < 1) { mw.x = mw.tx; mw.y = mw.ty; mw.vx = mw.vy = 0; }
  const sp = Math.hypot(mw.vx, mw.vy);
  mw.sq += (Math.min(0.12, sp / 260) - mw.sq) * (1 - Math.exp(-dt * 8));
  const ang = sp > 1 ? Math.atan2(mw.vy, mw.vx) : 0;
  const t = `translate(${mw.x.toFixed(2)}px, ${mw.y.toFixed(2)}px) rotate(${(mw.vx * 0.04).toFixed(2)}deg) scale(${(1 + mw.sq * Math.abs(Math.cos(ang))).toFixed(3)}, ${(1 - mw.sq * 0.5).toFixed(3)})`;
  if (w._t !== t) {
    w._t = t; w.style.transform = t;
    // the effects layer rides along (measured only when it is placed, see positionFx)
    if (fxMiniAt) fxl.style.translate = `${(mw.x - fxMiniAt[0]).toFixed(2)}px ${(mw.y - fxMiniAt[1]).toFixed(2)}px`;
  }
}
let walkNext = 0, wv = 0, wSquash = 0, wTilt = 0, wTarget = 0, wMin = 0, wMax = 0, wLast = 0, bob = null;
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
  if (stage.classList.contains('petting')) return; // being petted: stays put under the hand
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
  miniWalkFrame(now, dt);
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
    fxl.style.translate = (walkX - fxWalkAt).toFixed(2) + 'px 0'; // the effects follow without measuring anything
  }
  // stretches in the direction it moves, then settles back round. The squash eases toward the
  // speed instead of following it frame by frame, so a sudden mouse jerk doesn't flatten it at once.
  // right after the face flew in (the island opened or closed) it lands round: no squash while it settles
  const landing = travel || now < calmUntil || stage.classList.contains('petting');
  const stTarget = landing ? 0 : Math.min(0.22, Math.abs(wv) / 190);
  const ease = 1 - Math.exp(-dt * 8); // ~0.12 s to catch up
  wSquash += (stTarget - wSquash) * ease;
  wTilt += ((landing ? 0 : wv * 0.045) - wTilt) * ease;
  const st = wSquash < 0.002 ? 0 : wSquash;
  const sk = `${(1 + st).toFixed(3)} ${(1 - st * 0.5).toFixed(3)}`;
  if (mid._sk !== sk) { mid._sk = sk; mid.style.scale = sk; mid.style.rotate = wTilt.toFixed(2) + 'deg'; }
  if (bob) stopBob();
}
requestAnimationFrame(walkFrame);
let petDir = 0, petTurns = 0, petT0 = 0, lastPet = 0, petUntil = 0, petOffT = 0, lastPoke = 0;
// Being petted: eyes shut happily (^ ^), blushing cheeks, he melts a little under the hand, hearts float up.
// He stays where he is (no walking after the hand, no tilting), and it lasts while the strokes go on.
function setPetting(on) {
  if (stage.classList.contains('petting') === on) return;
  if (on) clearFlash(); // angry / shy / laughing melts away: one feeling at a time
  morphFace(() => stage.classList.toggle('petting', on)); // the face flows into the melt and back
  if (on) wTarget = Math.max(wMin, Math.min(wMax, 0)); // back to the middle, and stays there
}
setInterval(() => { if (petUntil && performance.now() > petUntil) { petUntil = 0; setPetting(false); } }, 150);
// where the face is right now: in the pill, the mini island, a toast or the open island's header
function faceBox(fresh) {
  if (!fresh && faceNow !== undefined) return faceNow;
  const f = travel ? null : view === 'compact' ? $('.v-compact .mid') : faceFor(view);
  const r = f?.getBoundingClientRect();
  return r?.width ? r : null;
}
let overFace = false, lastFaceHi = 0;
function trackPet(p, now) {
  const r = faceBox();
  if (!r || !lastP) return;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  // on the open island the face is small among buttons: say hi when the cursor runs over it
  if (view === 'open') {
    const on = Math.abs(p.x - cx) < 18 && Math.abs(p.y - cy) < 16;
    if (on && !overFace && now - lastFaceHi > 2500 && !currentMood()) { lastFaceHi = now; playTrick('giggle'); }
    overFace = on;
  }
  const reach = view === 'compact' ? 60 : 38;
  if (Math.abs(p.x - cx) > reach || p.y > r.bottom + 14 || (view !== 'compact' && p.y < r.top - 18)) { petTurns = 0; if (petUntil) petUntil = Math.min(petUntil, now + 350); return; }
  const dx = p.x - lastP.x;
  const sp = (Math.abs(dx) / Math.max(1, now - lastT)) * 1000;
  if (Math.abs(dx) < 2 || sp > 900) return; // strokes are calm, not frantic
  if (petUntil) petUntil = now + 1600; // still petting: keep melting (a pause at the turn of a stroke doesn't end it)
  const dir = Math.sign(dx);
  if (dir !== petDir) {
    if (!petTurns || now - petT0 > 1800) { petT0 = now; petTurns = 0; }
    petTurns++; petDir = dir;
    if (petTurns >= 2 && now - lastPoke > 1500) { petUntil = now + 1600; setPetting(true); } // not right after clicks
  }
}
function trackPlay(p, inside) {
  const now = performance.now();
  if (state.settings.island.cursorReactions !== false && inside) trackPet(p, now);
  if (state.settings.island.cursorReactions !== false && inside && !islandHover && lastP && now - lastShy > 6000) {
    const sp = (Math.hypot(p.x - lastP.x, p.y - lastP.y) / Math.max(1, now - lastT)) * 1000;
    // (just moving onto the island no longer makes it shy)
  }
  if (!inside) { restAt = null; restShy = false; }
  else if (!restAt || Math.hypot(p.x - restAt.x, p.y - restAt.y) > 14) { restAt = p; restT = now; restShy = false; }
  if (lastP && inside) {
    const dt = Math.max(1, now - lastT);
    const dist = Math.hypot(p.x - lastP.x, p.y - lastP.y);
    const speed = (dist / dt) * 1000;
    const fb = view === 'compact' || view === 'mini' ? true : faceBox();
    const nearFace = fb === true || (fb && Math.hypot(p.x - (fb.left + fb.width / 2), p.y - (fb.top + fb.height / 2)) < 70);
    if (speed > 1300 && nearFace && !stage.classList.contains('petting')) { // (not while being petted: that is calm)
      if (!playT0 || now - playT0 > 1400) { playT0 = now; playDist = 0; }
      playDist += dist;
      if (playDist > 1100 && now - lastHappy > 3500) {
        lastHappy = now; playDist = 0; flashMood('mood-laugh', 2400); // tickled -> laughs
      }
    }
  }
  lastP = p; lastT = now;
}
let pressing = false; // the mouse button is held on the island
setInterval(() => {
  if (!islandHover || view !== 'compact' || hideForFullscreen) return;
  if (pressing) { restT = performance.now(); return; } // held, not resting: no mini island popping up under the finger
  const restFor = restAt ? performance.now() - restT : 0;
  if (restAt && restFor >= (state.settings.island.miniDelay ?? 1.5) * 1000) {
    const under = document.elementFromPoint(restAt.x, restAt.y);
    if (under?.closest('button, [data-call], [data-media], [data-fold], a')) { restT = performance.now(); return; } // on a button: stay as is
    restAt = null; renderMini(); setView('mini');
  }
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
    if (view === 'open') {
      // the AI page and the home page decide themselves; anywhere else the files go on the shelf
      const onAi = activeTab === 'ai', onHome = activeTab === 'home' || activeTab === 'tg'; // Telegram takes files into the open chat
      bus.emit('drop-open', { paths, target: e.target });
      if (!onAi && !onHome && paths.length) {
        await api.invoke('shelf:add', paths);
        flashBelow({ icon: '📥', title: paths.length > 1 ? `На полке: ${paths.length} файла` : 'Файл на полке', ms: 1800 });
      }
      return;
    }
    if (!paths.length) { setView('compact'); return; }
    const target = zone || 'shelf'; // dropped on the island but not on a zone: the shelf
    if (target === 'shelf') {
      await api.invoke('shelf:add', paths);
      setView('compact');
      playTrick('hop'); // a small "got it", not a whole celebration
      flashBelow({ icon: '📥', title: paths.length > 1 ? `На полке: ${paths.length} файла` : 'Файл на полке', ms: 1800 });
      return;
    }
    openTab('ai');
    bus.emit('ai-attach', paths);
  });
}

// ---------------- context passed to tabs ----------------
const ctx = { resize, collapse, openTab, flash: flashBelow, toast: showToast, mood: flashMood, flags, rebuild: () => { buildTabs(); applyTheme(); } };

// ---------------- events from main ----------------
function wire() {
  api.on('cursor', (p) => { onCursor(p); bus.emit('cursor', p); });
  window.__cursor = (p) => { onCursor(p); bus.emit('cursor', p); }; // dev aid: move the cursor in tests
  window.__view = (v) => { if (v === 'mini') renderMini(); setView(v); }; // dev aid: switch views in tests
  window.__toast = () => currentToast; // dev aid
  window.__testNotify = (n) => showToast(n); // dev aid: a made-up notification
  window.__char = (c) => { state.settings.island.character = c; bus.emit('settings', state.settings); }; // dev aid: try a character without saving it
  api.on('mood-flash', (p) => bus.emit('mood-flash', p)); // "Показать" in the settings
  api.on('ai-popup', (on) => { aiPopup = !!on; });
  api.on('blur', () => {
    closeMenu();
    if (aiPopup) return;
    if (pinnedOpen || !(view === 'open' || view === 'palette' || view === 'drop' || view === 'qchat')) return;
    // a message just came in: its app (Telegram, Windows) may take the focus for a moment - that isn't you leaving
    if (performance.now() - lastNoticeAt < 2000) return;
    if (isl.classList.contains('stretching')) return; // being stretched by hand: the window is resizing, not you leaving
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
  api.on('reminders', (r) => { const live = (l) => (l || []).filter((x) => !x.done).length; if (live(r) > live(state.reminders)) playSound('timerSet'); state.reminders = r; bus.emit('reminders', r); renderCompact(); });
  api.on('weather', (w) => { state.weather = w; bus.emit('weather', w); renderCompact(); });
  api.on('downloads', (d) => {
    const had = state.downloads.length;
    state.downloads = d;
    bus.emit('downloads', d);
    if (d.length || had) renderCompact();
  });
  api.on('download-done', (d) => (bus.emit('download-done', d), playSound('download'), showToast({ icon: '✅', thumb: d.icon || undefined, dlDone: true, folder: !!d.folder, app: d.from === 'phone' ? (d.folder ? 'Перенесено с телефона' : 'Файл с телефона') : 'Загрузка завершена', title: d.name, body: `${bytes(d.size)}${d.took > 1500 ? ` · за ${dur(d.took)} · ${bytes(d.avg)}/с` : ''}`, path: d.path, actions: true, ms: 8000 })));
  // A paused track or voice message leaves the players after a minute (it comes back as soon as it plays).
  // One that is already paused when the island starts (an old Telegram voice message) is gone at once.
  const STALE_MS = 60e3;
  // When it was paused is kept for every source on its own: when the sound switched between two
  // sources (a Telegram sound and an old paused video, say), the old video counted as "just paused"
  // again each time and showed up in the players for a moment. A source never heard playing since the
  // island started is old news at once.
  const pausedSince = new Map(), heardPlaying = new Set();
  const takeMedia = (m) => {
    if (m.playing) { heardPlaying.add(m.key); pausedSince.delete(m.key); return m; }
    if (!pausedSince.has(m.key)) pausedSince.set(m.key, heardPlaying.has(m.key) ? Date.now() : Date.now() - STALE_MS - 1);
    m.pausedAt = pausedSince.get(m.key);
    if (m.active && Date.now() - m.pausedAt > STALE_MS) m = { ...m, active: false, stale: true };
    return m;
  };
  setInterval(() => { const m = state.media; if (m?.active && !m.playing && Date.now() - (m.pausedAt || 0) > STALE_MS) onMedia({ ...m }); }, 5000);
  // Is it a video (YouTube, TikTok, a film) or music? Then Windik watches instead of dancing.
  // Video players and video sites are known by name, music apps too; in a browser the picture tells:
  // a video's preview is wide (16:9), a song's cover is square.
  const VIDEO_APP = /vlc|mpc-?hc|mpc-?be|mpv|potplayer|kmplayer|smplayer|gom|zunevideo|movies|кино|netflix|kinopoisk|кинопоиск|ivi|okko|wink|tiktok|twitch|plex|jellyfin|kodi/i;
  const MUSIC_APP = /spotify|yandex.?music|яндекс.?музык|aimp|foobar|winamp|musicbee|itunes|apple.?music|zunemusic|groove|deezer|soundcloud|tidal|vk.?music|boom|youtube music|music\.youtube|telegram/i;
  const BROWSER = /chrome|msedge|edge|firefox|opera|yandex|brave|vivaldi|browser|arc/i;
  const VIDEO_WORD = /tiktok|twitch|rutube|кинопоиск|netflix|vk видео|vk video|сериал|серия|episode|трейлер|trailer|фильм|movie/i;
  const wideOf = new Map(); // a picture is checked once
  const classify = (m) => {
    const app = `${m.appMatch || ''} ${m.app || ''}`, all = `${app} ${m.title || ''} ${m.artist || ''}`;
    if (MUSIC_APP.test(all)) return false;
    if (VIDEO_APP.test(app) || VIDEO_WORD.test(all)) return true;
    if (!BROWSER.test(app) || !m.thumb) return false;
    if (wideOf.has(m.thumb)) return wideOf.get(m.thumb);
    const img = new Image();
    img.onload = () => {
      wideOf.set(m.thumb, img.naturalWidth / Math.max(1, img.naturalHeight) > 1.25);
      if (wideOf.size > 40) wideOf.delete(wideOf.keys().next().value);
      if (state.media?.key === m.key && state.media.thumb === m.thumb) { state.media.video = wideOf.get(m.thumb); applyMood(); }
    };
    img.src = m.thumb;
    return false;
  };
  const onMedia = (m) => {
    const prev = state.media;
    m = takeMedia(m);
    m.video = classify(m);
    if (prev?.video !== m.video) setTimeout(applyMood, 0);
    state.media = m;
    if (prev?.key !== m.key || prev?.thumb !== m.thumb) updateCoverGlow();
    if (prev?.playing !== m.playing) { audioActive(m.playing); applyMood(); }
    bus.emit('media', m);
    if (view === 'mini') renderMini(); // switches between player and summary by itself
    renderCompact();
  };
  api.on('media', onMedia);
  window.__mediaTest = onMedia; // dev aid: feed a made-up track in tests
  window.__stash = (on) => (on ? stash() : unstash()); // dev aid: hide / bring back the island in tests
  api.on('calls', (c) => {
    if ((c?.length || 0) < (state.calls?.length || 0)) playSound('callEnd'); // a call ended
    state.calls = c;
    stage.classList.toggle('oncall', !!c?.length); // its own animation, not the music one
    bus.emit('calls', c);
    bus.emit('calls', c);
    renderCompact(true);
  });
  api.on('game', (g) => {
    if (g && (!state.game || state.game.id !== g.id) && Date.now() - g.since < 5 * 60e3) playSound('game'); // just launched
    state.game = g;
    setGameBadge(g);
    stage.classList.toggle('ongame', !!g); // its own look: not the music dance
    bus.emit('game', g);
    renderCompact(true);
  });
  // Caps Lock / Num Lock switched: a quick note on the island, like on a laptop's screen
  api.on('lock-key', ({ key, on }) => {
    playSound('timerSet');
    const name = key === 'caps' ? 'Caps Lock' : 'Num Lock';
    const t = { kind: 'lock', on, title: `${name} ${on ? 'включён' : 'выключен'}`, body: key === 'caps' ? (on ? 'ПИШЕШЬ ЗАГЛАВНЫМИ' : 'обычные буквы') : (on ? 'цифры на боковой клавиатуре' : 'стрелки на боковой клавиатуре'), ms: 1600 };
    if (view === 'toast' && currentToast?.kind === 'lock') { Object.assign(currentToast, t); renderToast(currentToast); clearTimeout(toastTimer); toastTimer = setTimeout(nextToast, 1600); return; } // pressed again: just update it
    if (view === 'open' || view === 'palette') return flashBelow(t);
    showToast(t);
  });
  // the phone plugged in by cable: show it and offer to bring the new photos over
  api.on('phone-usb', (list) => { state.phones = list; bus.emit('phone-usb', list); });
  api.on('phone-connected', ({ name }) => {
    if (state.settings.phone?.askOnConnect === false) return;
    playSound('unlock');
    flashMood('mood-joy', 1600);
    showToast({ kind: 'phone', icon: '📱', app: 'Телефон подключён', title: name, body: 'Перенести новые фото и видео?', ms: 12000, actions: true,
      buttons: [{ label: 'Перенести фото', pri: true, ch: 'phone:import', args: [name] }, { label: /iphone|ipad|apple/i.test(name) ? 'Отправить (Telegram)' : 'Отправить файлы', ch: 'phone:send', args: [name] }, { label: 'Открыть', ch: 'phone:open', args: [name] }] });
  });
  api.on('phone-disconnected', ({ name }) => { flashBelow({ kind: 'phone', icon: '📱', title: `${name} отключён`, ms: 1800 }); });
  api.on('lyrics', (l) => { state.lyrics = l; bus.emit('lyrics', l); });
  api.on('notification', (n) => {
    state.notifications.unshift(n);
    state.notifications.length = Math.min(50, state.notifications.length);
    bus.emit('notification', n);
    if (n.silent) return;
    playSound(n.kind === 'reminder' ? (n.icon === '⏱' ? 'timer' : 'reminder') : n.kind === 'agent' ? (n.done ? 'agentDone' : 'agentAsk') : n.kind === 'call' ? 'call' : isMessage(n) ? 'message' : 'notify');
    if (n.askId) return; // handled by the ask view
    // a finished task: the pill shows it (a tick) and a sound plays - no extra little notice under the island
    if (n.done) { doneFlash = { project: n.title.split(':')[0], source: n.source, until: Date.now() + 8000 }; renderCompact(); setTimeout(renderCompact, 8100); return; }
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
  api.on('ocr-result', (r) => { flashMood('mood-idea', 2200); /* read the text: got it! */ openTab('text'); bus.emit('text-set', r.text); flashBelow({ icon: '🔤', title: r.translated ? 'Переведено и скопировано' : 'Текст скопирован в буфер', ms: 2200 }); });
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
  api.on('island-shown', welcomeBack);
  api.on('telegram-status', (s) => { state.telegram = s.status; bus.emit('telegram-status', s); });
  api.on('tg-new', (p) => bus.emit('tg-new', p)); // live messages for the mini Telegram
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
  api.on('win-size', (z) => { WIN.w = z.w; WIN.h = z.h; sendShape(); });
  applyTheme();
  initCharacters();
  initWater();
  initMenu({ refresh: () => sendShape(), openTab, palette: () => { setView('palette'); openPalette(); }, hideMusic, goodbye });
  initPalette({ setView, resize, collapse, openTab, flash: flashBelow });
  initQuickChat($('.v-qchat'), { flash: (x) => flashBelow(x), show: () => { setView('qchat'); api.invoke('island:focus'); }, close: () => collapse(true), resize: () => { if (view === 'qchat') applySize(); }, reshape: () => sendShape(), isOpen: () => view === 'qchat' });
  buildTabs();
  initJelly(document.querySelector('.pages'));
  wire();
  initDrop();
  initStretch();
  hideIdleViews(view);
  // put away (pulled up, or hidden for a full-screen app): once it has slid out of sight, everything in
  // it rests - no animations, no edge drawing, nothing painted - until it comes back
  let awayT = 0;
  new MutationObserver(() => {
    const hid = stage.classList.contains('hidden');
    if (!hid) { clearTimeout(awayT); awayT = 0; if (stage.classList.contains('away')) stage.classList.remove('away'); return; } // (touching the class when it isn't there would wake this observer again, forever)
    if (!awayT && !stage.classList.contains('away')) awayT = setTimeout(() => { awayT = 0; if (stage.classList.contains('hidden')) stage.classList.add('away'); }, 700);
  }).observe(stage, { attributes: true, attributeFilter: ['class'] });
  if (stage.classList.contains('hidden')) stage.classList.add('away');
  renderCompact(true);
  updateCoverGlow();
  api.invoke('agents:list'); // re-sync pending agent questions after a reload
  api.invoke('calls:list');
  api.invoke('games:get').then((g) => { if (g) { state.game = g; setGameBadge(g); stage.classList.add('ongame'); bus.emit('game', g); renderCompact(true); } });
  if (state.media?.playing) audioActive(true);

  // poking the island many times in a row makes it angry
  let pokes = [];
  isl.addEventListener('pointerdown', (e) => {
    lastPoke = performance.now();
    // on the open island only a poke at the face counts (not clicks on buttons and cards)
    if (view !== 'compact' && view !== 'mini') {
      const r = faceBox();
      if (!r || Math.abs(e.clientX - (r.left + r.width / 2)) > 22 || Math.abs(e.clientY - (r.top + r.height / 2)) > 20) return;
    }
    const now = Date.now();
    // clicking right on him: a slight wobble of the hand could look like petting; a click ends that softly
    // and still counts (so pokes on the face make him cross just like pokes beside it)
    if (stage.classList.contains('petting')) { petUntil = 0; petTurns = 0; setPetting(false); }
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
    restT = performance.now(); // a press is not "resting" on the island
    if (e.target.closest('.v-ask, .v-mini button, .v-mini .prog, .v-toast button')) return; // real buttons and the seek bar keep their clicks
    ctx.swallowClick();
    if (e.target.closest('[data-fold], [data-call], [data-media]')) { islandPress(e); return; }
    // a press can become a drag: pull the island up to hide it
    const g = { x: e.clientX, y: e.clientY, target: e.target, done: false };
    pressing = true;
    try { isl.setPointerCapture(e.pointerId); } catch {}
    const end = (ev) => {
      pressing = false;
      if (g.done) return;
      g.done = true;
      isl.removeEventListener('pointermove', move);
      if (!ev || Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < 10) islandPress({ target: g.target });
    };
    const move = (ev) => {
      if (g.done) return;
      const up = g.y - ev.clientY;
      if (state.settings.island.swipeHide !== false && (view === 'compact' || view === 'mini' || view === 'toast') && (up >= 22 || (ev.clientY <= 2 && up >= 8))) { g.done = true; pressing = false; isl.removeEventListener('pointermove', move); isl.style.transition = ''; isl.style.translate = ''; stash(); }
      else if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) > 6) { isl.style.transition = 'none'; isl.style.translate = `0 ${(Math.min(0, -up) * 0.5).toFixed(1)}px`; } // follows the finger at once
    };
    isl.addEventListener('pointermove', move);
    isl.addEventListener('pointerup', (ev) => { isl.style.transition = ''; isl.style.translate = ''; end(ev); }, { once: true }); // glides back
    isl.addEventListener('lostpointercapture', (ev) => { isl.style.transition = ''; isl.style.translate = ''; end(ev); }, { once: true });
  });
  function islandPress(e) {
    const mb = e.target.closest('[data-media]');
    if (mb) { api.invoke('media:cmd', mb.dataset.media); return; }
    if (e.target.closest('[data-fold]')) { foldActivity(primaryActivity()?.key); return; }
    const callBtn = e.target.closest('[data-call]');
    if (callBtn && state.calls?.[0]) {
      const id = callBtn.dataset.cid || state.calls[0].id, act = callBtn.dataset.call; // the call shown in the pill, not just the first one
      if (act === 'hangup') {
        api.invoke('calls:hangup', id).then((r) => {
          if (r?.confirm) flashBelow({ icon: '📞', title: 'Подтверди выход в окне звонка', ms: 2600 });
          else if (!r?.ok) flashBelow({ icon: '📞', title: 'Не нашёл кнопку — открыл звонок', ms: 2600 });
        });
        return;
      }
      api.invoke(act === 'mic' ? 'calls:mic' : act === 'sound' ? 'calls:sound' : 'calls:focus', id);
      return;
    }
    if (view === 'compact' || view === 'mini') expand('home');
    else if (view === 'toast') {
      const t = currentToast;
      if (t?.kind === 'agent' || t?.kind === 'reminder') expand('home');
      else if (t?.kind === 'telegram' && t.tgPeer && state.settings.tgui?.openOnClick !== false) { clearTimeout(toastTimer); toastQueue.length = 0; currentToast = null; openQuickChat(t); return; } // a small chat right here to answer
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
      if (view === 'open' || view === 'palette' || view === 'drop' || view === 'qchat') { e.preventDefault(); collapse(true); }
      else if (view === 'mini') { e.preventDefault(); setView('compact'); } // Esc folds the mini island back into the pill
    }
    if (view === 'open' && e.ctrlKey && /^[1-8]$/.test(e.key)) {
      const order = state.settings.tabs.filter((t) => t.on);
      const t = order[+e.key - 1];
      if (t) openTab(t.id);
    }
  });
  setInterval(() => { renderCompact(); if (view === 'mini') renderMini(); }, 1000);
  bus.on('settings', () => { applyTheme(); renderCompact(true); });
  bus.on('flash', (t) => flashBelow(t)); // a short note under the open island from any tab
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
