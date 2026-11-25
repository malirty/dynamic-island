// Island characters: eyes that follow the cursor, blink and show emotions —
// dance to music, think while AI answers, get busy while an agent works or a
// file downloads, cheer on done, startle on news, get angry on errors (or when
// poked too much), get sleepy and then fall asleep when you're away.
import { state, bus, $$, EYE_FX, frozen } from './core.js';

const stage = document.getElementById('stage');
export const MOODS = ['mood-surprise', 'mood-call', 'mood-game', 'mood-done', 'mood-dance', 'mood-watch', 'mood-think', 'mood-ponder', 'mood-sad', 'mood-love', 'mood-laugh', 'mood-confused', 'mood-excited', 'mood-bored', 'mood-scared', 'mood-busy', 'mood-idea', 'mood-joy', 'mood-shy', 'mood-startle', 'mood-angry', 'mood-sleepy', 'mood-sleep'];
let temp = null, tempTimer = null;
let cursor = { x: 0, y: 0 };
export const flags = { aiThinking: false, agentWorking: false };

// a message from a person (Telegram, or a messenger's Windows notification), not a system notice
const MESSENGERS = /telegram|whatsapp|discord|viber|slack|teams|signal|messenger|vk|вконтакте|skype|wechat|max/i;
export const isMessage = (n) => n?.kind === 'telegram' || (n?.kind === 'windows' && MESSENGERS.test(`${n.app || ''} ${n.logoHint || ''}`));

export function eyesHTML(cls = 'main') {
  return `<div class="eyes ${cls}"><div class="eye"></div><div class="eye"></div><div class="zz"><b>z</b><b>z</b><b>Z</b></div><div class="hearts"><b>♥</b><b>♥</b><b>♥</b></div>${EYE_FX}</div>`;
}

function mood() {
  if (frozen()) return ''; // locked: calm, no matter what is going on
  if (temp) return temp;
  // on a call (Zoom, Telegram, Discord): listening and talking along - never "asleep" while you talk
  if (state.calls?.length) return 'mood-call';
  // a game is running: focused "gamer" eyes. While it is in front you're busy playing, never "asleep"
  // (the mouse and keyboard may be captured by the game); behind other windows it yields to work
  if (state.game && (state.game.front || !(flags.aiThinking || flags.agentWorking))) return 'mood-game';
  const sleepMin = state.settings?.island?.sleepAfterMin ?? 5;
  const music = state.media?.playing && !state.silent; // playing and actually audible
  const busy = flags.agentWorking || state.downloads?.length > 0;
  const away = !music && !busy && !flags.aiThinking;
  if (away && state.idle > sleepMin * 60) return 'mood-sleep';
  // sleepy first: half the sleep timeout, or late at night after a minute idle
  const night = (() => { const hh = new Date().getHours(); return hh >= 1 && hh < 6; })();
  if (away && (state.idle > sleepMin * 30 || (night && state.idle > 60))) return 'mood-sleepy';
  if (away && state.idle > 50) return 'mood-bored';
  if (flags.aiThinking || flags.agentWorking) return 'mood-ponder'; // an AI is working: deep in thought
  if (busy) return 'mood-busy';
  if (music) return state.media?.video ? 'mood-watch' : 'mood-dance'; // a video: he lies back and watches; music: he dances
  // nothing going on: the favourite emotion (Настройки → Остров → Эмоции), or calm
  const fav = state.settings?.island?.favMood;
  return fav ? 'mood-' + fav : '';
}

// the effects each mood shows (beside the head); used to let them fade out still moving
const MOOD_FX = {
  'mood-think': ['fx-load'], 'mood-ponder': ['fx-orbit'], 'mood-busy': ['fx-dots'], 'mood-bored': ['fx-dots3'], 'mood-scared': ['fx-sweat'],
  'mood-joy': ['fx-rings', 'fx-bubbles', 'f-spark'], 'mood-laugh': ['f-spark'], 'mood-excited': ['f-spark'],
  'mood-done': ['f-done'], 'mood-call': ['f-call'], 'mood-game': ['f-game'], 'mood-startle': ['f-bang'], 'mood-idea': ['f-idea'],
  'mood-confused': ['f-q'], 'mood-dance': ['f-eq'], 'mood-watch': ['f-pop'], 'mood-angry': ['f-vein'],
};
let holdTimer = 0;
function holdEffects(from, to) {
  const keep = new Set(MOOD_FX[to] || []);
  for (const c of keep) for (const e of $$('.fx > i.hold.' + c)) e.classList.remove('hold'); // came back: just stays
  const gone = (MOOD_FX[from] || []).filter((c) => !keep.has(c));
  if (!gone.length) return;
  const els = gone.flatMap((c) => $$('.fx > i.' + c));
  for (const e of els) e.classList.add('hold');
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { for (const e of $$('.fx > i.hold')) e.classList.remove('hold'); }, 700);
}
let lastMood = '', morphT = 0;
export const currentMood = () => lastMood;
export function applyMood() {
  const m = mood();
  if (m !== lastMood) {
    // one expression melts into the next: remember how the face looks right now,
    // switch the mood, then glide from that pose to wherever the new mood is going
    const snaps = snapshotFaces();
    holdEffects(lastMood, m);
    for (const tt of TENDER) if (clashes(tt, m)) stage.classList.remove('trick-' + tt);
    for (const c of MOODS) stage.classList.toggle(c, c === m);
    // let the new mood's own CSS animations start *before* the glide is added, so the glide
    // sits on top of them from the very first frame (otherwise they flick through once)
    for (const [e, , parts] of snaps) { getComputedStyle(e).transform; for (const [x] of parts) getComputedStyle(x).height; }
    blendFrom(snaps);
    lastMood = m;
    bus.emit('mood-changed', m);
  }
  const ch = state.settings?.island?.character || 'eyes';
  stage.classList.toggle('char-buddies', ch === 'buddies');
  stage.classList.toggle('char-none', ch === 'none');
  for (const c of ['cat', 'bunny', 'robot', 'ghost', 'alien', 'angel', 'frog', 'devil']) stage.classList.toggle('char-' + c, ch === c);
  stage.classList.toggle('nofx', state.settings?.island?.moodFx === false);
  // a light island gets the opposite eyes: the same hue, lightness flipped (white eyes turn black)
  const eyeC = state.settings?.island?.eyeColor;
  document.documentElement.style.setProperty('--eyeBase', eyeC ? (document.documentElement.dataset.mode === 'light' ? flipLight(eyeC) : eyeC) : 'var(--fg)');
  // your own eye colour: only when calm (emotions keep their colours) or for every emotion
  const ec = state.settings?.island?.eyeColor;
  stage.classList.toggle('eyecol', !!ec);
  stage.classList.toggle('eyecol-all', !!ec && state.settings?.island?.eyeScope === 'all');
}

// ---------- smooth blending between emotions ----------
// Each mood has its own shapes and its own looping animations; switching classes would
// snap from one pose to the other. Instead the current look is captured and a Web Animation
// with only a start keyframe runs over it: the end is the live value of the new mood
// (including its CSS animation), so the face flows into it without a jump.
const EYE_PROPS = ['height', 'width', 'translate', 'scale', 'rotate', 'transform', 'opacity', 'filter', 'boxShadow', 'top', 'marginLeft',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'clipPath'];
// the whole face, not only the eyes: its tilt and size, and the character's ears / horns / halo
const FACE_PROPS = ['transform', 'translate', 'scale', 'rotate', 'filter', 'opacity', 'gap'];
const DECO_PROPS = ['transform', 'translate', 'scale', 'rotate', 'opacity', 'filter', 'boxShadow', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'];
// a gentle start and a long soft landing: the face eases out of one look and settles into the next
const BLEND = { duration: 720, easing: 'cubic-bezier(.45, 0, .2, 1)' };
const GAZE = { duration: 320, easing: 'cubic-bezier(.3, 0, .2, 1)' };
function pick(el, props) {
  const cs = getComputedStyle(el), o = {};
  for (const p of props) { const v = cs[p]; if (v && v !== 'auto') o[p] = v; }
  return o;
}
function snapshotFaces() {
  const out = [];
  for (const e of $$('.eyes:not(.fxl)')) {
    if (!e.offsetWidth) continue;
    const parts = [...e.querySelectorAll(':scope > .eye')].map((x) => [x, pick(x, EYE_PROPS)]);
    for (const d of e.querySelectorAll(':scope > .deco > i')) parts.push([d, pick(d, DECO_PROPS)]);
    out.push([e, pick(e, FACE_PROPS), parts]);
  }
  return out;
}
function blendFrom(snaps) {
  // let the new look's own CSS animations start *before* the glide goes on top of them, so not a single
  // frame of the new pose flashes through (a trick showed its first frame, then the glide took over)
  for (const [e, , parts] of snaps) { if (!e.isConnected) continue; getComputedStyle(e).transform; for (const [x] of parts) getComputedStyle(x).translate; }
  for (const [e, face, parts] of snaps) {
    if (!e.isConnected) continue;
    // start in this very frame (a new animation otherwise waits a frame, and the new face flashes in)
    const run = (el, kf) => {
      try {
        // where the eyes look glides on its own, quicker: they turn smoothly to the new pose / the cursor
        // without seeming frozen while the shape is still changing
        const { translate, ...shape } = kf;
        el._blend?.cancel(); el._blendT?.cancel(); // its look is already in the snapshot: no stacking of glides pulling different ways
        const an = el.animate([{ ...shape, offset: 0 }], BLEND); an.currentTime = 0;
        el._blend = an;
        an.onfinish = () => { if (el._blend === an) el._blend = null; };
        if (translate && el.classList.contains('eye')) {
          const at = el.animate([{ translate, offset: 0 }], GAZE); at.currentTime = 0;
          el._blendT = at;
          at.onfinish = () => { if (el._blendT === at) el._blendT = null; };
        }
      } catch {}
    };
    run(e, face);
    for (const [x, st] of parts) run(x, st);
  }
}

// drop a short emotion right away (it blends back into the current mood)
export function clearFlash() {
  if (!temp) return;
  temp = null;
  clearTimeout(tempTimer);
  applyMood();
}

// change something about the face (a class) and let it flow from how it looked into the new look
export function morphFace(change) {
  const s = snapshotFaces();
  change();
  blendFrom(s);
}

// a short-lived emotion over the current one (petted while thinking -> shy -> back to thinking);
// the face blends both ways because every change goes through applyMood
export function flashMood(name, ms = 2200) {
  if (frozen()) return;
  if (state.settings?.dnd && (name === 'mood-startle' || name === 'mood-angry')) return;
  temp = name;
  clearTimeout(tempTimer);
  applyMood();
  tempTimer = setTimeout(() => { temp = null; applyMood(); }, ms);
}

// look somewhere on purpose (reading a message): the cursor is ignored for this face until released
export function lookAt(pair, x, y) {
  if (!pair) return;
  if (x == null) { delete pair.dataset.look; follow(); return; }
  pair.dataset.look = '1';
  pair.style.setProperty('--ex', x.toFixed(1) + 'px');
  pair.style.setProperty('--ey', y.toFixed(1) + 'px');
}
function follow() {
  // One offset per pair (from the pair's center), so both eyes move identically
  // and render at the same size. All positions are read first, then all offsets written:
  // a read after a write forces the browser to restyle the whole island on the spot.
  const pairs = $$('.eyes').filter((x) => !x.dataset.look).map((pair) => [pair, pair.getBoundingClientRect()]);
  for (const [pair, r] of pairs) {
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
const TRICK_MS = { spin: 1200, roll: 1550, cross: 1350, wink: 800, swap: 1150, jump: 950, look: 1850, peek: 1300, bounce: 1000, giggle: 900, nod: 900, squint: 1100, love: 1900, stretch: 1800, boop: 520, glance: 650, dizzy: 1300, peekdown: 1000, shh: 1250, hop: 560, lost: 2700 };
let lastTrick = '';
// Tricks play in any mood: the face flows out of its emotion into the trick and back into it
// (thinking keeps its spinner / dots on the effects layer the whole time). Only sleep is left alone.
const ASLEEP = /mood-(sleep|sleepy)/;
const POKES = new Set(['boop', 'dizzy', 'peekdown', 'giggle', 'love', 'hop', 'stretch']);
// tender tricks (pink eyes, hearts, giggles) don't go with a cross or sad face: they never mix
const TENDER = new Set(['love', 'giggle']);
const HARSH = /mood-(angry|sad|scared|startle|confused|bored)\b/;
const clashes = (trick, m) => TENDER.has(trick) && HARSH.test(m || '');
export function playTrick(name) {
  if (frozen()) return;
  if (ASLEEP.test(lastMood || '') && !POKES.has(name)) return;
  if (stage.classList.contains('petting') && name !== 'boop') return; // being petted: he just melts, no tricks
  const pool = TRICKS.filter((x) => x !== lastTrick && !clashes(x, lastMood));
  const t = name || pool[Math.floor(Math.random() * pool.length)];
  if (clashes(t, lastMood)) return; // e.g. no hearts while he is angry
  if (name !== 'boop') lastTrick = t;
  // the face flows into the trick and back out of it, never snaps
  const others = [...stage.classList].filter((c) => c.startsWith('trick-') && c !== 'trick-' + t);
  const quick = t === 'boop' && !others.length; // a lone poke is a quick jolt; over another trick it glides
  const before = quick ? null : snapshotFaces();
  for (const c of others) stage.classList.remove(c);
  stage.classList.remove('trick-' + t); void stage.offsetWidth; // restart if it is already playing
  stage.classList.add('trick-' + t);
  if (before) blendFrom(before);
  const token = (playTrick.n = (playTrick.n || 0) + 1);
  setTimeout(() => {
    if (!stage.classList.contains('trick-' + t) || (playTrick.last?.[t] ?? token) !== token) return; // replaced meanwhile
    const s = snapshotFaces(); stage.classList.remove('trick-' + t); blendFrom(s);
  }, TRICK_MS[t] || 1200);
  (playTrick.last ||= {})[t] = token;
}
function trickDelay() {
  const r = state.settings?.island?.trickRate || 'normal';
  const [a, b] = { rare: [25000, 15000], normal: [9000, 9000], often: [4000, 4000], off: [15000, 0] }[r] || [9000, 9000];
  return a + Math.random() * b;
}
function trickLoop() {
  setTimeout(() => {
    if (!ASLEEP.test(lastMood || '') && !temp && !stage.classList.contains('petting') && document.visibilityState === 'visible' && state.settings?.island?.trickRate !== 'off') playTrick();
    trickLoop();
  }, trickDelay());
}

export function initCharacters() {
  bus.on('cursor', (p) => { cursor = p; follow(); });
  bus.on('media', applyMood);
  bus.on('silence', applyMood);
  bus.on('calls', applyMood);
  bus.on('game', applyMood);
  bus.on('idle', applyMood);
  bus.on('settings', applyMood);
  bus.on('agents', applyMood);
  bus.on('notification', (n) => { if (!n.silent) flashMood(n.done ? 'mood-done' : isMessage(n) ? 'mood-surprise' : 'mood-startle', n.done ? 2600 : isMessage(n) ? 1700 : 900); });
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
  let period = 480, phase = 0, phaseErr = 0, lastBeatT = 0, lastFrame = 0, hit = 0, hitTarget = 0, grooving = false, amp = 0;
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
    const on = stage.classList.contains('mood-dance') && state.media?.playing && !state.silent && !document.hidden;
    if (!on && !grooving) return; // not dancing: nothing to do (no DOM lookups every frame)
    const list = $$('.eyes:not(.fxl)');
    // the moves swell in over ~half a second and die down the same way, so starting / stopping never jerks
    amp += ((on ? 1 : 0) - amp) * Math.min(1, dt / 260);
    if (!on && amp < 0.02) { grooving = false; amp = 0; for (const e of list) { e.style.translate = ''; e.style.rotate = ''; e.style.scale = ''; } return; }
    grooving = true;
    const fix = phaseErr * Math.min(1, dt / 480);
    phaseErr -= fix;
    phase += dt / period + fix;
    hit += (hitTarget - hit) * Math.min(1, dt / 70); // a soft swell, not a kick
    hitTarget *= Math.pow(0.86, dt / 16.7);
    const nod = (1 + Math.cos(phase * 2 * Math.PI)) / 2;     // 1 on the beat, 0 between
    const sway = Math.sin(phase * Math.PI);                   // left on one beat, right on the next
    const y = ((nod * 2.6 - 1) * amp).toFixed(2);
    const r = (sway * 7 * amp).toFixed(2);
    const x = (sway * 2.2 * amp).toFixed(2);
    const sq = (1 + (-nod * 0.08 + hit * 0.06) * amp).toFixed(3), sx = (1 + (nod * 0.05 + hit * 0.05) * amp).toFixed(3);
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
    if (temp) return; // a shown / short emotion plays to its end
    if (lastMood === 'mood-sleep' || lastMood === 'mood-sleepy') { state.idle = 0; applyMood(); if (lastMood !== 'mood-sleep' && lastMood !== 'mood-sleepy') playTrick('stretch'); } // wakes up with a stretch, once
  });
  // copying something: a quick nod "got it"
  bus.on('clips', () => { if (!temp) playTrick('nod'); });
  // music starts: a happy hop, then dancing
  // reactions to what you do with the music
  let wasPlaying = false, lastKey = null;
  bus.on('media', (m) => {
    const playing = !!m?.playing;
    // play / pause no longer flash joy or sadness: it just starts or stops dancing
    if (playing && wasPlaying && lastKey && m.key !== lastKey) playTrick('glance'); // next track: looks over
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

// #rrggbb with its lightness turned over (hue and saturation kept): for eyes on a light island
function flipLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let hh = 0, ss = 0;
  if (d) { ss = d / (1 - Math.abs(2 * l - 1)); hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
  const L = Math.min(0.42, 1 - l); // never lighter than mid-dark, so it reads on a light island
  return `hsl(${Math.round(hh)} ${Math.round(ss * 100)}% ${Math.round(L * 100)}%)`;
}
// the theme switched light / dark: recolour the eyes right away
new MutationObserver(() => applyMood()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
