// Liquid island edge. The outline is a ring of points on springs (a water
// membrane): the cursor pulls the edge toward itself, entering the island sends
// a ripple around it, and bass beats shake the bottom edge and spread glowing
// rings below. The same shape clips the island body and is drawn as its glow.
import { state, bus } from './core.js';

const isl = document.getElementById('island');
const body = isl.querySelector('.ib');
const cv = document.getElementById('edge');
const g = cv.getContext('2d');
const PAD = 20;          // body layer is larger than the island by this much, so the edge can bulge out
const M = 36, MX = 130, MB = 120;  // canvas margins: top, sides (room for ripples), bottom

// spring constants per 60 fps frame
const K = 0.02, C = 0.05, T = 0.22;

let N = 0;
let d = new Float32Array(0), v = new Float32Array(0);
let base = [];
let geoKey = '';
let cursor = { x: -9999, y: -9999 };
let inside = false;
let ripples = [];
let rot = 0, last = performance.now(), frame = 0;
let colors = { c1: '#7c5cff', c2: '#00d4ff', c3: '#ff4fd8', glow: '#7c5cff', light: false, glowK: 0.8 };

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  colors = { c1: v('--c1'), c2: v('--c2'), c3: v('--c3'), glow: v('--glow') || v('--c1'), light: document.documentElement.dataset.mode === 'light', glowK: parseFloat(v('--glowK')) || 0.8 };
}

// point on a rounded rectangle at arc length s (clockwise from top middle) + outward normal
function rrPoint(w, h, r, s) {
  const sw = w - 2 * r, sh = h - 2 * r, arc = (Math.PI / 2) * r;
  const segs = [sw / 2, arc, sh, arc, sw, arc, sh, arc, sw / 2];
  let i = 0;
  while (i < segs.length - 1 && s > segs[i]) { s -= segs[i]; i++; }
  switch (i) {
    case 0: return [w / 2 + s, 0, 0, -1];
    case 1: { const a = -Math.PI / 2 + s / r; return [w - r + Math.cos(a) * r, r + Math.sin(a) * r, Math.cos(a), Math.sin(a)]; }
    case 2: return [w, r + s, 1, 0];
    case 3: { const a = s / r; return [w - r + Math.cos(a) * r, h - r + Math.sin(a) * r, Math.cos(a), Math.sin(a)]; }
    case 4: return [w - r - s, h, 0, 1];
    case 5: { const a = Math.PI / 2 + s / r; return [r + Math.cos(a) * r, h - r + Math.sin(a) * r, Math.cos(a), Math.sin(a)]; }
    case 6: return [0, h - r - s, -1, 0];
    case 7: { const a = Math.PI + s / r; return [r + Math.cos(a) * r, r + Math.sin(a) * r, Math.cos(a), Math.sin(a)]; }
    default: return [r + s, 0, 0, -1];
  }
}

function geometry() {
  const w = isl.offsetWidth, h = isl.offsetHeight;
  const r = Math.min(parseFloat(getComputedStyle(isl).borderTopLeftRadius) || h / 2, h / 2, w / 2);
  const key = `${w}|${h}|${r.toFixed(1)}`;
  if (key !== geoKey) {
    geoKey = key;
    const P = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
    const n = Math.max(48, Math.min(260, Math.round(P / 7)));
    if (n !== N) {
      // resample the membrane so waves survive the island changing size
      const nd = new Float32Array(n), nv = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const f = (i / n) * N, a = Math.floor(f) % Math.max(1, N), b = (a + 1) % Math.max(1, N), t = f - Math.floor(f);
        nd[i] = N ? d[a] * (1 - t) + d[b] * t : 0;
        nv[i] = N ? v[a] * (1 - t) + v[b] * t : 0;
      }
      d = nd; v = nv; N = n;
    }
    base = Array.from({ length: N }, (_, i) => rrPoint(w, h, r, (i / N) * P));
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round((w + 2 * MX) * dpr); cv.height = Math.round((h + M + MB) * dpr);
    cv.style.width = w + 2 * MX + 'px'; cv.style.height = h + M + MB + 'px';
    cv.style.left = -MX + 'px';
  }
  return { w, h };
}

function local() {
  const r = isl.getBoundingClientRect();
  return { x: cursor.x - r.left, y: cursor.y - r.top };
}

function nearest(p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < N; i++) { const q = base[i]; const dd = (q[0] - p.x) ** 2 + (q[1] - p.y) ** 2; if (dd < bd) { bd = dd; best = i; } }
  return best;
}
function kick(center, amount, spread) {
  for (let k = -spread * 2; k <= spread * 2; k++) {
    const i = (center + k + N) % N;
    v[i] += amount * Math.exp(-(k * k) / (2 * spread * spread));
  }
}

function step(dt, now, w, h) {
  const on = state.settings?.theme?.water !== false;
  const p = local();
  const k = Math.min(2.5, dt / 16.7);
  const isIn = p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  if (on && isIn !== inside) {
    const i = nearest(p);
    if (isIn) kick(i, -4.2, 5); // finger dips into the water
    else kick(i, 2.8, 5);       // and the surface springs back
  }
  inside = isIn;
  for (let i = 0; i < N; i++) {
    const prev = d[(i - 1 + N) % N], next = d[(i + 1) % N];
    let f = -K * d[i] - C * v[i] + T * (prev + next - 2 * d[i]);
    if (on) {
      const b = base[i];
      f += 0.018 * Math.sin(now * 0.0017 + i * 0.33) + 0.012 * Math.sin(now * 0.0029 - i * 0.21); // slow breathing surface
      const dx = p.x - b[0], dy = p.y - b[1];
      const dist = Math.hypot(dx, dy);
      if (dist < 150) {
        const wgt = Math.exp(-(dist * dist) / (2 * 48 * 48));
        const out = dx * b[2] + dy * b[3]; // >0: cursor is outside on this side
        if (out > 0) f += 0.26 * wgt * (1 - Math.min(1, out / 120)); // edge reaches toward the cursor
        else if (out > -30) f += 0.09 * wgt;                        // pressed from inside, bulges out
      }
    }
    v[i] += f * k;
  }
  for (let i = 0; i < N; i++) {
    d[i] += v[i] * k;
    if (d[i] > 16) { d[i] = 16; v[i] *= 0.5; }
    if (d[i] < -9) { d[i] = -9; v[i] *= 0.5; }
  }
}

function points() {
  const out = new Array(N);
  for (let i = 0; i < N; i++) { const b = base[i]; out[i] = [b[0] + b[2] * d[i], b[1] + b[3] * d[i]]; }
  return out;
}
// smooth closed curve through midpoints
function trace(ctx, pts, ox = 0, oy = 0) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2 + ox, (a[1] + b[1]) / 2 + oy];
  const s = mid(pts[n - 1], pts[0]);
  ctx.moveTo(s[0], s[1]);
  for (let i = 0; i < n; i++) { const m = mid(pts[i], pts[(i + 1) % n]); ctx.quadraticCurveTo(pts[i][0] + ox, pts[i][1] + oy, m[0], m[1]); }
  ctx.closePath();
}
function clipString(pts) {
  const n = pts.length;
  const f = (x) => Math.round(x * 10) / 10;
  const mid = (a, b) => [f((a[0] + b[0]) / 2 + PAD), f((a[1] + b[1]) / 2 + PAD)];
  const s = mid(pts[n - 1], pts[0]);
  let str = `M${s[0]} ${s[1]}`;
  for (let i = 0; i < n; i++) { const m = mid(pts[i], pts[(i + 1) % n]); str += `Q${f(pts[i][0] + PAD)} ${f(pts[i][1] + PAD)} ${m[0]} ${m[1]}`; }
  return `path('${str}Z')`;
}

function draw(now, dt, w, h, pts) {
  const dpr = window.devicePixelRatio || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w + 2 * MX, h + M + MB);
  g.translate(MX, M);
  const level = state.level || 0;
  const near = parseFloat(document.documentElement.style.getPropertyValue('--near')) || 0;
  const music = state.media?.playing && state.settings?.theme?.edgeDance !== false;
  const K2 = colors.glowK;

  // soft drop shadow + colored halo following the liquid outline
  g.save();
  g.beginPath(); trace(g, pts);
  g.fillStyle = '#000';
  g.shadowColor = colors.light ? 'rgba(0,0,0,.22)' : 'rgba(0,0,0,.5)';
  g.shadowBlur = 26; g.shadowOffsetY = 8;
  g.fill();
  g.shadowOffsetY = 0;
  g.shadowColor = colors.glow;
  g.shadowBlur = 8 + level * 30 + near * 10;
  g.globalAlpha = Math.min(1, (0.25 + level * 0.7 + near * 0.35) * K2);
  g.fill();
  g.restore();

  // glowing bottom while music plays
  if (music && level > 0.01) {
    g.save();
    g.globalCompositeOperation = colors.light ? 'source-over' : 'lighter';
    g.filter = `blur(${12 + level * 12}px)`;
    g.globalAlpha = Math.min(1, (0.2 + level * 0.9) * K2);
    g.fillStyle = colors.glow;
    g.beginPath();
    g.ellipse(w / 2, h + 2, w * (0.3 + level * 0.15), 6 + level * 20, 0, 0, Math.PI * 2);
    g.fill();
    g.filter = 'none';
    // the bottom lip itself lights up
    g.beginPath();
    const bot = pts.filter((_, i) => base[i][3] > 0.6);
    if (bot.length > 2) {
      bot.sort((a, b) => a[0] - b[0]);
      g.moveTo(bot[0][0], bot[0][1]);
      for (const q of bot) g.lineTo(q[0], q[1] + 0.5);
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'transparent'); grad.addColorStop(0.5, colors.glow); grad.addColorStop(1, 'transparent');
      g.strokeStyle = grad;
      g.lineWidth = 2 + level * 3;
      g.shadowColor = colors.glow; g.shadowBlur = 12;
      g.globalAlpha = Math.min(1, 0.4 + level);
      g.stroke();
    }
    g.restore();
  }

  // ripples spreading under the island like rings on water
  if (ripples.length) {
    g.save();
    g.globalCompositeOperation = colors.light ? 'source-over' : 'lighter';
    g.strokeStyle = colors.glow;
    g.shadowColor = colors.glow;
    g.shadowBlur = 8;
    ripples = ripples.filter((r) => now - r.born < 1500);
    for (const r of ripples) {
      for (const lag of [0, 0.18]) {
        const age = (now - r.born) / 1500 - lag;
        if (age <= 0 || age >= 1) continue;
        const e = 1 - Math.pow(1 - age, 3);
        g.globalAlpha = (1 - age) * 0.75 * r.s * K2;
        g.lineWidth = 1.6 * (1 - age) + 0.4;
        g.beginPath();
        g.ellipse(r.x, h - 1, 24 + e * w * 0.42, 4 + e * 52, 0, 0, Math.PI);
        g.stroke();
      }
    }
    g.restore();
  }

  // animated gradient rim
  g.save();
  rot += dt * 0.0009;
  const cg = g.createConicGradient(rot, w / 2, h / 2);
  cg.addColorStop(0, colors.c1); cg.addColorStop(0.3, colors.c2); cg.addColorStop(0.55, colors.c3); cg.addColorStop(0.8, colors.glow); cg.addColorStop(1, colors.c1);
  g.strokeStyle = cg;
  g.lineWidth = 1.6;
  g.globalAlpha = Math.min(1, (0.22 + level * 0.6 + near * 0.5) * K2);
  g.beginPath(); trace(g, pts);
  g.stroke();
  g.restore();
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(50, now - last);
  last = now;
  if (document.hidden) return;
  if (++frame % 30 === 1) readColors();
  const { w, h } = geometry();
  if (!N) return;
  step(dt, now, w, h);
  const pts = points();
  body.style.clipPath = clipString(pts);
  draw(now, dt, w, h, pts);
}

export function initWater() {
  bus.on('cursor', (p) => { cursor = p; });
  bus.on('settings', readColors);
  const onBeat = (bass) => {
    if (!N || !state.media?.playing || state.settings?.theme?.edgeDance === false) return;
    const w = isl.offsetWidth;
    // a drop falls somewhere along the bottom: the lip bounces and rings spread
    const x = w * (0.25 + Math.random() * 0.5);
    let best = 0, bd = Infinity;
    for (let i = 0; i < N; i++) if (base[i][3] > 0.9) { const dd = Math.abs(base[i][0] - x); if (dd < bd) { bd = dd; best = i; } }
    kick(best, 1.2 + bass * 2.6, 5);
    ripples.push({ x, born: performance.now(), s: Math.min(1, 0.4 + bass) });
    if (ripples.length > 8) ripples.shift();
  };
  bus.on('beat', onBeat);
  readColors();
  requestAnimationFrame(loop);
  // dev aid for --debug-shots: inspect the membrane / fake the cursor
  window.__water = { stats: () => ({ max: Math.max(...d), min: Math.min(...d), N }), cursor: (x, y) => { cursor = { x, y }; }, beat: onBeat, level: (l) => { state.level = l; } };
}
