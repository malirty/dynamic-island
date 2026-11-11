// Liquid island edge. The outline is a ring of points on springs (a water
// membrane): the cursor pulls the edge toward itself, entering the island sends
// a ripple around it, and bass beats shake the bottom edge and spread glowing
// rings below. The same shape clips the island body and is drawn as its glow.
import { state, bus } from './core.js';
import { getDrops, overBubble } from './bubbles.js';

const isl = document.getElementById('island');
const body = isl.querySelector('.ib');
const views = isl.querySelectorAll('.view');

const cv = document.getElementById('edge');
const g = cv.getContext('2d');
const fx = document.createElement('canvas'); // waves + rim layer, lit by the cursor
const f = fx.getContext('2d');
let lastView = '', prevView = '', prevUntil = 0;
const PAD = 20;          // body layer is larger than the island by this much, so the edge can bulge out
const M = 36, MX = 260, MB = 120;  // canvas margins: top, sides (room for ripples), bottom

// spring constants per 60 fps frame
const K = 0.02, C = 0.05, T = 0.22;

let N = 0;
let d = new Float32Array(0), v = new Float32Array(0);
let base = [];
let geoKey = '';
let cvW = 0, cvH = 0, cvDpr = 0; // canvas size in CSS px (bucketed)
let cursor = { x: -9999, y: -9999 };
let inside = false;
let ripples = [];
let rot = 0, last = performance.now(), frame = 0;
let colors = { c1: '#7c5cff', c2: '#00d4ff', c3: '#ff4fd8', glow: '#7c5cff', light: false, glowK: 0.8 };

// saturation 0..1 of any CSS color
const probe = document.createElement('canvas').getContext('2d');
function rgbOf(c) {
  probe.fillStyle = '#000'; probe.fillStyle = c;
  const m = probe.fillStyle.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i) || [];
  return [1, 2, 3].map((i) => parseInt(m[i] || '0', 16));
}
function saturation(c) {
  const rgb = rgbOf(c);
  const mx = Math.max(...rgb), mn = Math.min(...rgb);
  return mx ? (mx - mn) / mx : 0;
}
// same color with hue rotated by `deg` (vivid, so the shimmer stays visible)
function hueShift(c, deg) {
  const [r, g, b] = rgbOf(c).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let hh = 0;
  if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hh = (hh * 60 + deg + 360) % 360;
  return `hsl(${hh.toFixed(0)}, 90%, ${Math.max(55, Math.min(68, l * 100)).toFixed(0)}%)`;
}
const VIVID = ['#7c5cff', '#00d4ff', '#ff4fd8', '#ff8a3d'];

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  colors = { c1: v('--c1'), c2: v('--c2'), c3: v('--c3'), glow: v('--glow') || v('--c1'), light: document.documentElement.dataset.mode === 'light', glowK: parseFloat(v('--glowK')) || 0.8, base: v('--base') || 'rgba(6,6,10,.94)' };
  // Waves are painted with a running gradient: the palette, or shades of the
  // cover color when the palette is grey, or a vivid set when both are grey.
  const own = [colors.c1, colors.c2, colors.c3, colors.glow];
  const sat = own.map(saturation);
  if (Math.max(sat[0], sat[1], sat[2]) >= 0.25) colors.wave = [colors.c1, colors.glow, colors.c2, colors.c3]; // colorful palette
  else if (sat[3] >= 0.25) colors.wave = [hueShift(colors.glow, -40), colors.glow, hueShift(colors.glow, 35), hueShift(colors.glow, 70)]; // grey palette: shimmer around the cover color
  else colors.wave = VIVID; // nothing colorful anywhere
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
  const changed = key !== geoKey;
  if (changed) {
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
    const cw = Math.ceil((w + 2 * MX) / 160) * 160, ch = Math.ceil((h + M + MB) / 160) * 160;
    if (cw !== cvW || ch !== cvH || dpr !== cvDpr) {
      cvW = cw; cvH = ch; cvDpr = dpr;
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
      cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
      cv.style.left = -MX + 'px';
    }
  }
  return { w, h, changed };
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

// One fixed 60 fps step (k = 1). Larger steps make the explicit spring
// integration unstable and the edge turns into a saw tooth.
function step(now, w, h, first) {
  const on = state.settings?.theme?.water !== false;
  const p = local();
  const k = 1;
  const isIn = p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  if (first && on && isIn !== inside) {
    const i = nearest(p);
    if (isIn) kick(i, -4.2, 5); // finger dips into the water
    else kick(i, 2.8, 5);       // and the surface springs back
  }
  if (first) inside = isIn;
  // while the cursor is on a droplet the island doesn't reach for it (it would shove the drop)
  const onDrop = overBubble(cursor);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b2 = (i + 1) % N;
    let f = -K * d[i] - C * v[i] + T * (d[a] + d[b2] - 2 * d[i]);
    f += 0.15 * (v[a] + v[b2] - 2 * v[i]); // viscosity: kills tiny zig-zag ripples, keeps smooth waves
    if (on) {
      const b = base[i];
      f += 0.018 * Math.sin(now * 0.0017 + i * 0.33) + 0.012 * Math.sin(now * 0.0029 - i * 0.21); // slow breathing surface
      const dx = p.x - b[0], dy = p.y - b[1];
      const dist = Math.hypot(dx, dy);
      if (dist < 150 && !onDrop) {
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
function clipString(pts, pad = PAD, padY = pad) {
  const n = pts.length;
  const f = (x) => Math.round(x * 10) / 10;
  const mid = (a, b) => [f((a[0] + b[0]) / 2 + pad), f((a[1] + b[1]) / 2 + padY)];
  const s = mid(pts[n - 1], pts[0]);
  let str = `M${s[0]} ${s[1]}`;
  for (let i = 0; i < n; i++) { const m = mid(pts[i], pts[(i + 1) % n]); str += `Q${f(pts[i][0] + pad)} ${f(pts[i][1] + padY)} ${m[0]} ${m[1]}`; }
  return `path('${str}Z')`;
}

// How far the right side of the island currently bulges out (for the droplets).
export function edgeBulge() {
  let m = 0;
  for (let i = 0; i < N; i++) if (base[i] && base[i][2] > 0.7) m = Math.max(m, d[i]);
  return m;
}

// A metaball-like waist between two bodies (A on the left, B on the right) along y = cy.
function neck(xa, ha, xb, rb, cy, gap, reach) {
  if (gap > reach || rb < 1) return;
  const t = Math.max(0, 1 - Math.max(0, gap) / reach);
  const waist = Math.min(ha, rb) * 0.82 * Math.pow(t, 1.5);
  if (waist < 0.5) return;
  const x0 = xa - 6, x1 = xb - rb * 0.45, mx = (x0 + x1) / 2;
  const hb = rb * 0.78;
  g.beginPath();
  g.moveTo(x0, cy - ha);
  g.quadraticCurveTo(mx, cy - waist, x1, cy - hb);
  g.lineTo(x1, cy + hb);
  g.quadraticCurveTo(mx, cy + waist, x0, cy + ha);
  g.closePath();
  g.fill();
}
function drawNecks(w, h, pts) {
  // only real, visible drops (not ones melting away or tucked into an opened island:
  // those produced a thin black spike on the island's edge)
  const list = getDrops().filter((b) => !b.dying && b.r > 6);
  if (!list.length) return;
  const r = isl.getBoundingClientRect();
  g.save();
  // the neck is the island's own body stretching out: base + a wash of its colour
  const grad = g.createLinearGradient(w - 10, 0, w + 60, 0);
  grad.addColorStop(0, colors.c1); grad.addColorStop(1, colors.base);
  let edgeX = w;
  for (let i = 0; i < N; i++) if (base[i][2] > 0.7) edgeX = Math.max(edgeX, pts[i][0]);
  let prev = null;
  for (const b of list) {
    const cx = b.cx - r.left, cy = b.cy - r.top;
    for (const pass of [0, 1]) {
      g.fillStyle = pass ? grad : colors.base;
      g.globalAlpha = pass ? 0.28 : 1;
      if (!prev) neck(edgeX, Math.min(h, b.r * 2) * 0.42, cx, b.r, cy, cx - b.r - edgeX, 10);
      else neck(prev.cx + prev.r, prev.r * 0.8, cx, b.r, (prev.cy + cy) / 2, cx - b.r - (prev.cx + prev.r), 9);
    }
    prev = { cx, cy, r: b.r };
  }
  g.restore();
}

function draw(now, dt, w, h, pts) {
  const dpr = window.devicePixelRatio || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cvW, cvH);
  g.translate(MX, M);
  // Everything drawn here lives OUTSIDE the island: with a see-through material
  // (glass) shadows, glow and waves would otherwise shine through the body.
  g.save();
  g.beginPath();
  g.rect(-MX, -M, cvW, cvH);
  trace(g, pts);
  g.clip('evenodd');
  const level = state.level || 0;
  const near = state.near || 0;
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

  // ---- liquid necks: island <-> droplet and droplet <-> droplet join while close ----
  drawNecks(w, h, pts);

  // ---- waves layer (offscreen) ----
  if (fx.width !== cv.width || fx.height !== cv.height) { fx.width = cv.width; fx.height = cv.height; }
  f.setTransform(dpr, 0, 0, dpr, 0, 0);
  f.clearRect(0, 0, cvW, cvH);
  f.translate(MX, M);

  // glowing bottom while music plays
  if (music && level > 0.01) {
    f.save();
    f.globalCompositeOperation = colors.light ? 'source-over' : 'lighter';
    f.filter = `blur(${12 + level * 12}px)`;
    f.globalAlpha = Math.min(1, (0.2 + level * 0.9) * K2 * (state.settings?.theme?.musicGlowK ?? 1));
    // flowing palette gradient under the island (shifts slowly sideways)
    const shift = (Math.sin(now * 0.0007) + 1) / 2;
    const under = f.createLinearGradient(-w * 0.2 + shift * w * 0.4, 0, w * 0.8 + shift * w * 0.4, 0);
    const W = colors.wave;
    under.addColorStop(0, W[0]); under.addColorStop(0.35, W[1]); under.addColorStop(0.65, W[2]); under.addColorStop(1, W[3]);
    f.fillStyle = under;
    f.beginPath();
    f.ellipse(w / 2, h + 2, w * (0.3 + level * 0.15), 6 + level * 20, 0, 0, Math.PI * 2);
    f.fill();
    f.filter = 'none';
    // the bottom lip itself lights up
    f.beginPath();
    const bot = pts.filter((_, i) => base[i][3] > 0.6);
    if (bot.length > 2) {
      bot.sort((a, b) => a[0] - b[0]);
      f.moveTo(bot[0][0], bot[0][1]);
      for (const q of bot) f.lineTo(q[0], q[1] + 0.5);
      const grad = f.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'transparent'); grad.addColorStop(0.2, W[0]); grad.addColorStop(0.5, W[1]); grad.addColorStop(0.8, W[2]); grad.addColorStop(1, 'transparent');
      f.strokeStyle = grad;
      f.lineWidth = 2 + level * 3;
      f.shadowColor = W[1]; f.shadowBlur = 12;
      f.globalAlpha = Math.min(1, 0.4 + level);
      f.stroke();
    }
    f.restore();
  }

  // ripples spreading under the island like rings on water
  if (ripples.length) {
    f.save();
    f.globalCompositeOperation = colors.light ? 'source-over' : 'lighter';
    f.shadowColor = colors.wave[1];
    f.shadowBlur = 8;
    ripples = ripples.filter((r) => now - r.born < 1500);
    for (const r of ripples) {
      for (const lag of [0, 0.18]) {
        const age = (now - r.born) / 1500 - lag;
        if (age <= 0 || age >= 1) continue;
        const e = 1 - Math.pow(1 - age, 3);
        f.globalAlpha = (1 - age) * 0.75 * r.s * K2;
        f.lineWidth = 1.6 * (1 - age) + 0.4;
        // each ring is painted with the palette running around it, like oil on water
        const rg = f.createConicGradient(rot * 2 + age * 3 + r.hue, r.x, h - 1);
        const Wr = colors.wave;
        rg.addColorStop(0, Wr[0]); rg.addColorStop(0.25, Wr[1]); rg.addColorStop(0.5, Wr[2]); rg.addColorStop(0.75, Wr[3]); rg.addColorStop(1, Wr[0]);
        f.strokeStyle = rg;
        f.beginPath();
        f.ellipse(r.x, h - 1, 24 + e * w * 0.42, 4 + e * 52, 0, 0, Math.PI);
        f.stroke();
      }
    }
    f.restore();
  }

  // animated gradient rim
  f.save();
  rot += dt * 0.0009;
  const cg = f.createConicGradient(rot, w / 2, h / 2);
  cg.addColorStop(0, colors.c1); cg.addColorStop(0.3, colors.c2); cg.addColorStop(0.55, colors.c3); cg.addColorStop(0.8, colors.glow); cg.addColorStop(1, colors.c1);
  f.strokeStyle = cg;
  f.lineWidth = 1.6;
  f.globalAlpha = Math.min(1, (0.22 + level * 0.6 + near * 0.5) * K2);
  f.beginPath(); trace(f, pts);
  f.stroke();
  f.restore();

  // cursor light falls on the waves, the glowing lip and the rim (only where they are drawn)
  if (state.settings?.theme?.cursorGlow !== false) {
    const p = local();
    const lx = p.x, ly = p.y;
    const dist = Math.max(0, Math.hypot(Math.max(0, Math.abs(lx - w / 2) - w / 2), Math.max(0, ly - h)));
    const CK = state.settings?.theme?.cursorGlowK ?? 1;
    const k = Math.max(0, 1 - dist / 260) * CK;
    if (k > 0) {
      f.save();
      f.globalCompositeOperation = 'source-atop';
      const rl = f.createRadialGradient(lx, ly, 0, lx, ly, 150);
      rl.addColorStop(0, `rgba(255,255,255,${0.85 * k})`);
      rl.addColorStop(0.4, `rgba(255,255,255,${0.35 * k})`);
      rl.addColorStop(1, 'rgba(255,255,255,0)');
      f.fillStyle = rl;
      f.fillRect(lx - 150, ly - 150, 300, 300);
      f.restore();
    }
    // the island's own edge lights up under the cursor: a bright rim plus a soft
    // white bloom that slides along the liquid outline after the pointer
    const kr = Math.min(1.6, Math.max(0, 1 - dist / 200) * CK);
    if (kr > 0) {
      const tint = colors.light ? rgbOf(colors.c1).join(',') : '255,255,255'; // white light is invisible on a light theme
      const col = (a) => `rgba(${tint},${a.toFixed(3)})`;
      const spot = (r, a) => {
        const gr = f.createRadialGradient(lx, ly, 0, lx, ly, r);
        gr.addColorStop(0, col(a)); gr.addColorStop(0.5, col(a * 0.45)); gr.addColorStop(1, col(0));
        return gr;
      };
      f.save();
      // wide soft bloom
      f.lineWidth = 16;
      f.strokeStyle = spot(170, 0.35 * kr);
      f.filter = 'blur(10px)';
      f.beginPath(); trace(f, pts); f.stroke();
      f.filter = 'none';
      // crisp bright rim
      f.lineWidth = 3;
      f.strokeStyle = spot(120, 0.95 * kr);
      f.shadowColor = col(0.9 * kr);
      f.shadowBlur = 14;
      f.beginPath(); trace(f, pts); f.stroke();
      f.restore();
    }
  }
  g.drawImage(fx, -MX, -M, cvW, cvH);
  g.restore();
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(50, now - last);
  last = now;
  if (document.hidden) return;
  if (++frame % 30 === 1) readColors();
  const { w, h, changed } = geometry();
  if (!N) return;
  if (changed) { for (let i = 0; i < N; i++) { d[i] *= 0.9; v[i] *= 0.7; } } // calm the surface while the island resizes
  const steps = Math.max(1, Math.min(4, Math.round(dt / 16.7)));
  for (let s = 0; s < steps; s++) step(now, w, h, s === 0);
  const pts = points();
  body.style.clipPath = clipString(pts);
  // the content (cards, text) follows the same liquid outline, so no corners poke out.
  // Set directly on the views: a custom property here would restyle the whole island every frame.
  const vclip = clipString(pts, 0);
  // the open view keeps its final size (centred), so its clip is shifted by half the difference
  const ow = parseFloat(document.documentElement.style.getPropertyValue('--ow')) || w;
  const oclip = clipString(pts, PAD + (ow - w) / 2, PAD);
  // only the shown view and the one fading out need the moving outline
  const cur = isl.dataset.view;
  if (cur !== lastView) { prevView = lastView; lastView = cur; prevUntil = now + 700; }
  for (const v of views) {
    const name = v.className.match(/\bv-(\w+)/)?.[1];
    if (name !== cur && !(name === prevView && now < prevUntil)) continue;
    // the pill, mini island and toasts keep their content inside anyway; leaving them
    // unclipped lets the halo, ears and antennae stick out over the edge
    if (name === 'compact' || name === 'mini' || name === 'toast') { if (v.style.clipPath) v.style.clipPath = ''; continue; }
    const c = name === 'open' ? oclip : vclip;
    if (v.style.clipPath !== c) v.style.clipPath = c;
  }
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
    // the whole island breathes out a little on every hit
    for (let i = 0; i < N; i++) v[i] += 0.3 + bass * 0.55;
    ripples.push({ x, born: performance.now(), s: Math.min(1, 0.4 + bass), hue: Math.random() * Math.PI * 2 });
    if (ripples.length > 10) ripples.shift();
  };
  bus.on('beat', onBeat);
  // lighter hits between the beats: a quick wiggle somewhere on the outline
  bus.on('tick', (k) => {
    if (!N || !state.media?.playing || state.settings?.theme?.edgeDance === false) return;
    kick(Math.floor(Math.random() * N), (Math.random() < 0.5 ? -1 : 1) * (0.7 + k * 1.3), 3);
  });
  readColors();
  requestAnimationFrame(loop);
  // dev aid for --debug-shots: inspect the membrane / fake the cursor
  window.__water = { stats: () => { let jag = 0; for (let i = 0; i < N; i++) jag = Math.max(jag, Math.abs(d[i] - (d[(i - 1 + N) % N] + d[(i + 1) % N]) / 2)); return { max: Math.max(...d), min: Math.min(...d), N, jag }; }, cursor: (x, y) => { cursor = { x, y }; }, beat: onBeat, level: (l) => { state.level = l; } };
}
