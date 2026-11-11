// Island characters: eyes that follow the cursor, blink and show emotions —
// dance to music, think while AI answers, get busy while an agent works or a
// file downloads, cheer on done, startle on news, get angry on errors (or when
// poked too much), get sleepy and then fall asleep when you're away.
import { state, bus, $$, EYE_FX } from './core.js';

const stage = document.getElementById('stage');
export const MOODS = ['mood-dance', 'mood-think', 'mood-ponder', 'mood-sad', 'mood-love', 'mood-laugh', 'mood-confused', 'mood-excited', 'mood-bored', 'mood-scared', 'mood-busy', 'mood-idea', 'mood-joy', 'mood-shy', 'mood-startle', 'mood-angry', 'mood-sleepy', 'mood-sleep'];
let temp = null, tempTimer = null;
let cursor = { x: 0, y: 0 };
export const flags = { aiThinking: false, agentWorking: false };

export function eyesHTML(cls = 'main') {
  return `<div class="eyes ${cls}"><div class="eye"></div><div class="eye"></div><div class="zz"><b>z</b><b>z</b><b>Z</b></div><div class="hearts"><b>♥</b><b>♥</b><b>♥</b></div>${EYE_FX}</div>`;
}

function mood() {
  if (temp) return temp;
  const sleepMin = state.settings?.island?.sleepAfterMin ?? 5;
  const music = state.media?.playing;
  const busy = flags.agentWorking || state.downloads?.length > 0;
  const away = !music && !busy && !flags.aiThinking;
  if (away && state.idle > sleepMin * 60) return 'mood-sleep';
  // sleepy first: half the sleep timeout, or late at night after a minute idle
  const night = (() => { const hh = new Date().getHours(); return hh >= 1 && hh < 6; })();
  if (away && (state.idle > sleepMin * 30 || (night && state.idle > 60))) return 'mood-sleepy';
  if (away && state.idle > 50) return 'mood-bored';
  if (flags.aiThinking || flags.agentWorking) return 'mood-ponder'; // an AI is working: deep in thought
  if (busy) return 'mood-busy';
  if (music) return 'mood-dance';
  return '';
}

let lastMood = '', morphT = 0;
export const currentMood = () => lastMood;
export function applyMood() {
  const m = mood();
  if (m !== lastMood) {
    // one expression melts into the next: remember how the face looks right now,
    // switch the mood, then glide from that pose to wherever the new mood is going
    const snaps = snapshotFaces();
    for (const c of MOODS) stage.classList.toggle(c, c === m);
    // let the new mood's own CSS animations start *before* the glide is added, so the glide
    // sits on top of them from the very first frame (otherwise they flick through once)
    for (const [e, , eyes] of snaps) { getComputedStyle(e).transform; for (const [x] of eyes) getComputedStyle(x).height; }
    blendFrom(snaps);
    lastMood = m;
    bus.emit('mood-changed', m);
  }
  const ch = state.settings?.island?.character || 'eyes';
  stage.classList.toggle('char-buddies', ch === 'buddies');
  stage.classList.toggle('char-none', ch === 'none');
  for (const c of ['cat', 'bunny', 'robot', 'ghost', 'alien', 'angel', 'frog', 'devil']) stage.classList.toggle('char-' + c, ch === c);
  stage.classList.toggle('nofx', state.settings?.island?.moodFx === false);
  document.documentElement.style.setProperty('--eyeBase', state.settings?.island?.eyeColor || 'var(--fg)');
}

// ---------- smooth blending between emotions ----------
// Each mood has its own shapes and its own looping animations; switching classes would
// snap from one pose to the other. Instead the current look is captured and a Web Animation
// with only a start keyframe runs over it: the end is the live value of the new mood
// (including its CSS animation), so the face flows into it without a jump.
const EYE_PROPS = ['height', 'width', 'translate', 'scale', 'rotate', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderLeftColor', 'clipPath'];
const BLEND = { duration: 560, easing: 'cubic-bezier(.33, 0, .2, 1)' };
function pick(el, props) {
  const cs = getComputedStyle(el), o = {};
  for (const p of props) { const v = cs[p]; if (v && v !== 'auto') o[p] = v; }
  return o;
}
function snapshotFaces() {
  const out = [];
  for (const e of $$('.eyes:not(.fxl)')) {
    if (!e.offsetWidth) continue;
    out.push([e, pick(e, ['transform', 'filter']), [...e.querySelectorAll('.eye')].map((x) => [x, pick(x, EYE_PROPS)])]);
  }
  return out;
}
function blendFrom(snaps) {
  for (const [e, face, eyes] of snaps) {
    if (!e.isConnected) continue;
    // start in this very frame (a new animation otherwise waits a frame, and the new face flashes in)
    const run = (el, kf) => { try { const an = el.animate([{ ...kf, offset: 0 }], BLEND); an.currentTime = 0; } catch {} };
    run(e, face);
    for (const [x, s] of eyes) run(x, s);
  }
}

// a short-lived emotion over the current one (petted while thinking -> shy -> back to thinking);
// the face blends both ways because every change goes through applyMood
export function flashMood(name, ms = 2200) {
  if (state.settings?.dnd && (name === 'mood-startle' || name === 'mood-angry')) return;
  temp = name;
  clearTimeout(tempTimer);
  applyMood();
  tempTimer = setTimeout(() => { temp = null; applyMood(); }, ms);
}

function follow() {
  // One offset per pair (from the pair's center), so both eyes move identically
  // and render at the same size.
  for (const pair of $$('.eyes')) {
    const r = pair.getBoundingClientRect();
    if (!r.width) continue;
    const dx = cursor.x - (r.left + r.width / 2), dy = cursor.y - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 120);
    const small = !!pair.closest('.buddy');
    // the sticks lean toward the cursor; a bit more sideways than up/down
    pair.style.setProperty('--ex', ((dx / d) * (small ? 1.2 : 3) * k).toFixed(1) + 'px');
    pair.style.setProperty('--ey', ((dy / d) * (small ? 0.8 : 1.8) * k).toFixed(1) + 'px');
  }
}

function blinkLoop() {
  const delay = 2500 + Math.random() * 4000;
  setTimeout(() => {
    // no blinking while asleep / drowsy (they have their own lids)
    if (!stage.classList.contains('mood-sleep') && !stage.classList.contains('mood-sleepy')) {
      stage.classList.add('blink');
      setTimeout(() => stage.classList.remove('blink'), 130);
      if (Math.random() < 0.2) setTimeout(() => { stage.classList.add('blink'); setTimeout(() => stage.classList.remove('blink'), 120); }, 260);
    }
    blinkLoop();
  }, delay);
}

// Little idle tricks when nothing is going on: spin, roll, cross-eyed, wink,
// swap places, jump, look around. Every 25–40 s, only in the calm mood.
const TRICKS = ['spin', 'roll', 'cross', 'wink', 'swap', 'jump', 'look', 'peek', 'bounce', 'giggle', 'nod', 'squint', 'love'];
const TRICK_MS = { spin: 1200, roll: 1550, cross: 1350, wink: 800, swap: 1150, jump: 950, look: 1850, peek: 1300, bounce: 1000, giggle: 900, nod: 900, squint: 1100, love: 1900, stretch: 1800, boop: 520, glance: 650, dizzy: 1300, peekdown: 1000, shh: 1250, hop: 560 };
let lastTrick = '';
export function playTrick(name) {
  const t = name || TRICKS.filter((x) => x !== lastTrick)[Math.floor(Math.random() * (TRICKS.length - 1))];
  if (name !== 'boop') lastTrick = t;
  stage.classList.remove('trick-' + t); void stage.offsetWidth; // restart if it is already playing
  stage.classList.add('trick-' + t);
  setTimeout(() => stage.classList.remove('trick-' + t), TRICK_MS[t] || 1200);
}
function trickDelay() {
  const r = state.settings?.island?.trickRate || 'normal';
  const [a, b] = { rare: [25000, 15000], normal: [9000, 9000], often: [4000, 4000], off: [15000, 0] }[r] || [9000, 9000];
  return a + Math.random() * b;
}
function trickLoop() {
  setTimeout(() => {
    if (!lastMood && !temp && document.visibilityState === 'visible' && state.settings?.island?.trickRate !== 'off') playTrick();
    trickLoop();
  }, trickDelay());
}

export function initCharacters() {
  bus.on('cursor', (p) => { cursor = p; follow(); });
  bus.on('media', applyMood);
  bus.on('idle', applyMood);
  bus.on('settings', applyMood);
  bus.on('agents', applyMood);
  bus.on('notification', (n) => { if (!n.silent) flashMood(n.done ? 'mood-joy' : 'mood-startle', n.done ? 3000 : 900); });
  bus.on('mood-flash', ({ mood: m, ms }) => flashMood(m, ms));
  bus.on('tick', () => {
    if (!stage.classList.contains('mood-dance')) return;
    const bs = $$('.buddy');
    const b = bs[Math.floor(Math.random() * bs.length)];
    if (b) { b.style.transform = `rotate(${(Math.random() - 0.5) * 14}deg)`; setTimeout(() => (b.style.transform = ''), 90); }
  });
  // Dancing: a smooth groove locked to the song's tempo. The face nods down on every
  // beat and sways left/right over two beats (like vibing to music), the eyes narrow
  // a little on the beat and a strong bass hit gives a small bounce.
  let period = 480, phase = 0, phaseErr = 0, lastBeatT = 0, lastFrame = 0, hit = 0, hitTarget = 0, grooving = false;
  bus.on('beat', (bass) => {
    if (!stage.classList.contains('mood-dance')) return;
    const t = performance.now();
    if (lastBeatT) { const g = t - lastBeatT; if (g > 250 && g < 1100) period = period * 0.7 + g * 0.3; }
    lastBeatT = t;
    phaseErr = Math.round(phase) - phase; // drift toward the beat over the next frames, never jump
    hitTarget = Math.min(1, 0.5 + (bass || 0.5));
  });
  function groove(now) {
    requestAnimationFrame(groove);
    const dt = Math.min(50, now - (lastFrame || now));
    lastFrame = now;
    const on = stage.classList.contains('mood-dance') && state.media?.playing && !document.hidden;
    const list = $$('.eyes:not(.fxl)');
    if (!on) { if (grooving) { grooving = false; for (const e of list) { e.style.translate = ''; e.style.rotate = ''; e.style.scale = ''; } } return; }
    grooving = true;
    const fix = phaseErr * Math.min(1, dt / 480);
    phaseErr -= fix;
    phase += dt / period + fix;
    hit += (hitTarget - hit) * Math.min(1, dt / 70); // a soft swell, not a kick
    hitTarget *= Math.pow(0.86, dt / 16.7);
    const nod = (1 + Math.cos(phase * 2 * Math.PI)) / 2;     // 1 on the beat, 0 between
    const sway = Math.sin(phase * Math.PI);                   // left on one beat, right on the next
    const y = (nod * 2.6 - 1).toFixed(2);
    const r = (sway * 7).toFixed(2);
    const x = (sway * 2.2).toFixed(2);
    const sq = (1 - nod * 0.08 + hit * 0.06).toFixed(3), sx = (1 + nod * 0.05 + hit * 0.05).toFixed(3);
    for (const e of list) {
      if (!e.offsetWidth) continue;
      e.style.translate = `${x}px ${y}px`;
      e.style.rotate = `${r}deg`;
      e.style.scale = `${sx} ${sq}`;
    }
  }
  requestAnimationFrame(groove);
  bus.on('beat', () => {
    if (!stage.classList.contains('mood-dance')) return;
    for (const b of $$('.buddy')) { b.style.transform = `translateY(${2 + Math.random() * 3}px) rotate(${(Math.random() - 0.5) * 20}deg)`; setTimeout(() => (b.style.transform = ''), 120); }
  });
  // waking up: any activity after being sleepy brings the eyes back at once
  bus.on('cursor', () => {
    if (lastMood === 'mood-sleep' || lastMood === 'mood-sleepy') { state.idle = 0; applyMood(); playTrick('stretch'); } // wakes up with a stretch
  });
  // copying something: a quick nod "got it"
  bus.on('clips', () => { if (!temp) playTrick('nod'); });
  // music starts: a happy hop, then dancing
  // reactions to what you do with the music
  let wasPlaying = false, lastKey = null;
  bus.on('media', (m) => {
    const playing = !!m?.playing;
    if (playing && !wasPlaying) flashMood('mood-joy', 1300); // play: happy hop
    else if (!playing && wasPlaying && m?.active) flashMood('mood-sad', 1700); // pause: a little sad
    else if (playing && lastKey && m.key !== lastKey) playTrick('glance'); // next track: looks over
    wasPlaying = playing; if (m?.key) lastKey = m.key;
  });
  bus.on('download-done', () => flashMood('mood-excited', 2400));
  // other things you do
  let lastGlance = 0, dnd = state.settings?.dnd, remCount = null;
  bus.on('fg-change', () => { const t = performance.now(); if (!temp && t - lastGlance > 4000) { lastGlance = t; playTrick('glance'); } }); // switched windows
  bus.on('settings', (s) => { if (s?.dnd === undefined) return; if (dnd === undefined) { dnd = s.dnd; return; } if (s.dnd !== dnd) { dnd = s.dnd; playTrick(dnd ? 'shh' : 'hop'); } }); // do not disturb on/off
  bus.on('reminders', (list) => { const n = (list || []).filter((r) => !r.done).length; if (remCount !== null && n > remCount) playTrick('nod'); remCount = n; }); // timer / reminder set
  blinkLoop();
  trickLoop();
  window.__trick = playTrick; // dev aid
  window.__mood = flashMood;
  setInterval(applyMood, 1000);
  applyMood();
}
