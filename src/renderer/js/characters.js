// Island characters: eyes that follow the cursor, blink and show moods —
// dance to music, think while AI works, cheer on done, startle on news, sleep when idle.
import { state, bus, $$ } from './core.js';

const stage = document.getElementById('stage');
const MOODS = ['mood-dance', 'mood-think', 'mood-happy', 'mood-startle', 'mood-sleep'];
let temp = null, tempTimer = null;
let cursor = { x: 0, y: 0 };
export const flags = { aiThinking: false, agentWorking: false };

export function eyesHTML(cls = 'main') {
  return `<div class="eyes ${cls}" style="position:relative"><div class="eye"><div class="pu"></div></div><div class="eye"><div class="pu"></div></div><div class="zz" style="right:-12px;top:-6px"><b>z</b><b>z</b><b>Z</b></div></div>`;
}

function mood() {
  if (temp) return temp;
  const sleepMin = state.settings?.island?.sleepAfterMin ?? 5;
  if (state.idle > sleepMin * 60 && !state.media?.playing && !flags.agentWorking) return 'mood-sleep';
  if (flags.aiThinking || flags.agentWorking) return 'mood-think';
  if (state.media?.playing) return 'mood-dance';
  return '';
}

export function applyMood() {
  const m = mood();
  for (const c of MOODS) stage.classList.toggle(c, c === m);
  const ch = state.settings?.island?.character || 'eyes';
  stage.classList.toggle('char-buddies', ch === 'buddies');
  stage.classList.toggle('char-none', ch === 'none');
}

export function flashMood(name, ms = 2200) {
  if (state.settings?.dnd && name === 'mood-startle') return;
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
    if (!stage.classList.contains('mood-sleep')) {
      stage.classList.add('blink');
      setTimeout(() => stage.classList.remove('blink'), 130);
      if (Math.random() < 0.2) setTimeout(() => { stage.classList.add('blink'); setTimeout(() => stage.classList.remove('blink'), 120); }, 260);
    }
    blinkLoop();
  }, delay);
}

export function initCharacters() {
  bus.on('cursor', (p) => { cursor = p; follow(); });
  bus.on('media', applyMood);
  bus.on('idle', applyMood);
  bus.on('settings', applyMood);
  bus.on('notification', (n) => { if (!n.silent) flashMood(n.done ? 'mood-happy' : 'mood-startle', n.done ? 2600 : 900); });
  bus.on('beat', () => {
    if (!stage.classList.contains('mood-dance')) return;
    for (const b of $$('.buddy')) { b.style.transform = `translateY(${2 + Math.random() * 3}px) rotate(${(Math.random() - 0.5) * 20}deg)`; setTimeout(() => (b.style.transform = ''), 120); }
  });
  blinkLoop();
  setInterval(applyMood, 3000);
  applyMood();
}
