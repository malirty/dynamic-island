// Island characters: eyes that follow the cursor, blink and show emotions —
// dance to music, think while AI answers, get busy while an agent works or a
// file downloads, cheer on done, startle on news, get angry on errors (or when
// poked too much), get sleepy and then fall asleep when you're away.
import { state, bus, $$, EYE_FX } from './core.js';

const stage = document.getElementById('stage');
export const MOODS = ['mood-dance', 'mood-think', 'mood-ponder', 'mood-sad', 'mood-busy', 'mood-idea', 'mood-joy', 'mood-shy', 'mood-startle', 'mood-angry', 'mood-sleepy', 'mood-sleep'];
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
  if (flags.aiThinking) return 'mood-think';
  if (flags.agentWorking) return 'mood-ponder'; // an AI agent is working: deep in thought
  if (busy) return 'mood-busy';
  if (music) return 'mood-dance';
  return '';
}

let lastMood = '', morphT = 0;
export const currentMood = () => lastMood;
export function applyMood() {
  const m = mood();
  if (m !== lastMood) {
    // a quick squint while the face changes, so one expression melts into the next
    stage.classList.add('morph');
    clearTimeout(morphT);
    morphT = setTimeout(() => stage.classList.remove('morph'), 170);
    for (const c of MOODS) stage.classList.toggle(c, c === m);
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
