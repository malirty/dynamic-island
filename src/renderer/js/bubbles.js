// Droplets to the right of the island — one per extra activity (Claude, Codex,
// a call, music, a download…). A droplet is born from the island (or its
// neighbour) with a little liquid split, then stays calmly in its spot; only the
// island's real edge (waves, bulges) nudges it aside, smoothly. When it goes away
// it melts back into the island. water.js draws the liquid necks between them.
import { state, islandRect } from './core.js';
import { edgeBulge } from './water.js';

const isl = document.getElementById('island');
const layer = document.getElementById('bubbles');
const drops = new Map(); // key -> drop
let order = [];          // keys of live drops, left to right
let hidden = false;      // island opened / fullscreen: drops melt into the island
let cursor = { x: -9999, y: -9999 };
let raf = 0;
let onClick = () => {};

const GAP = 11;
const size = () => Math.round(38 * (state.settings?.theme?.scale || 1));

let bulgeSm = 0;
function islandEdge() {
  const r = islandRect(16); // one measurement per frame, shared
  const b = Math.max(0, edgeBulge());
  bulgeSm += (b - bulgeSm) * 0.05;
  return { right: r.right + bulgeSm, rawRight: r.right + b, top: r.top, height: r.height };
}

// items: [{ key, html, cls, title, sig }]
export function setBubbles(items, isHidden) {
  hidden = !!isHidden;
  const keys = items.map((i) => i.key);
  const edge = islandEdge();
  const s = size();
  items.forEach((it, idx) => {
    let d = drops.get(it.key);
    if (!d || d.dying) {
      if (d) d.el.remove();
      const el = document.createElement('div');
      el.className = 'bubble';
      // activate on press: the bubble's content is re-rendered every second (call timer),
      // which swaps the pressed element before release, so a 'click' would never fire
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        if (d.dying) return;
        onClick(d.item);
      });
      el.addEventListener('click', (e) => e.stopPropagation());
      // a card with the details under the drop while the cursor is on it (e.g. every task of an agent)
      el.addEventListener('pointerenter', () => { if (d.item?.detail) showTip(d); });
      el.addEventListener('pointerleave', hideTip);
      layer.append(el);
      // born from the neighbour on the left (or from the island's edge)
      const prev = idx > 0 ? drops.get(keys[idx - 1]) : null;
      const x0 = prev && !prev.dying ? prev.x : edge.right - s / 2;
      d = { key: it.key, el, x: x0, vx: 0, y: edge.top + s / 2, vy: 0, s: 0.15, vs: 0, dying: false, sig: '', born: performance.now() };
      drops.set(it.key, d);
    }
    d.item = it;
    if (d.sig !== it.sig) {
      d.sig = it.sig;
      d.el.innerHTML = it.html;
    }
    if (d.el.title !== (it.title || '')) d.el.title = it.title || ''; // live text (a game's play time) even when the look stays
    d.el.className = 'bubble' + (it.cls ? ' ' + it.cls : '');
  });
  for (const [k, d] of drops) if (!keys.includes(k) && !d.dying) { d.dying = true; d.diedAt = performance.now(); }
  order = keys;
  kick();
}

export function setBubbleClick(fn) { onClick = fn; }

let tip = null, tipFor = null;
function showTip(d) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'bubtip'; layer.append(tip); }
  tipFor = d;
  tip.innerHTML = d.item.detail;
  const s = size();
  // it opens toward the room there is: to the right of the drop, or to its left near the edge
  const w = tip.offsetWidth, room = layer.clientWidth || innerWidth;
  let left = d.x - 20;
  if (left + w > room - 8) left = d.x + 20 - w;
  tip.style.left = Math.round(Math.max(8, left)) + 'px';
  tip.style.top = Math.round(d.y + s / 2 + 10) + 'px';
  tip.style.transformOrigin = left < d.x - 20 ? `${w - 20}px 0` : '20px 0';
  tip.classList.add('on');
}
function hideTip() { tipFor = null; tip?.classList.remove('on'); }

// (drops stay calm: no beat hops)

export function bubblesCursor(p) { cursor = p; if (drops.size) kick(); }

// Live drops in stage coordinates (for necks, hover, hit area).
export function getDrops() {
  const s = size();
  const list = [];
  for (const d of drops.values()) list.push({ key: d.key, cx: d.x, cy: d.y, r: (s / 2) * d.s, dying: d.dying });
  return list.sort((a, b) => a.cx - b.cx);
}
export function overBubble(p) {
  const s = size();
  for (const d of drops.values()) if (!d.dying && Math.hypot(p.x - d.x, p.y - d.y) < (s / 2) * d.s + 4) return true;
  return false;
}
// Clickable strip to the right of the island (generous, the drops move around a bit).
export function bubblesHitArea(islandRight, top, islandH = 0) {
  const n = order.length;
  if (!n || hidden) return null;
  const s = size();
  return { x: islandRight, y: 0, width: GAP + n * (s + GAP) + 30, height: top + Math.max(s, islandH / 2 + s / 2) + 16 };
}

function kick() { if (!raf) raf = requestAnimationFrame(frame); }

function frame(now) {
  raf = 0;
  const edge = islandEdge();
  const s = size();
  const cy = edge.top + Math.max(edge.height, s) / 2;
  let busy = false;
  let slot = 0;
  for (const key of order) {
    const d = drops.get(key);
    if (!d) continue;
    d.slot = slot++;
  }
  for (const d of drops.values()) {
    // where this drop wants to be
    let tx, ty = cy, ts = 1;
    if (d.dying || hidden) {
      // melt back: into the left neighbour, or into the island
      const left = [...drops.values()].filter((o) => !o.dying && o !== d && o.x < d.x).sort((a, b) => b.x - a.x)[0];
      tx = left && !hidden ? left.x : edge.right - s / 2;
      ts = 0.12;
    } else {
      // its own spot in the row; only the island's real edge (waves, bulges) can push it
      const home = edge.right + GAP + s / 2 + d.slot * (s + GAP);
      const push = d.slot === 0 ? edge.rawRight + GAP * 0.6 + s / 2 : -Infinity;
      tx = Math.max(home, push);
    }
    const settled = !d.dying && !hidden && now - d.born > 900;
    if (settled) {
      // calm: glide to the spot, no bounce, no wobble
      d.vx = (tx - d.x) * 0.12; d.x += d.vx;
      d.vy = (ty - d.y) * 0.15; d.y += d.vy;
      d.vs = 0; d.s += (1 - d.s) * 0.2;
    } else {
      // birth / melting away: springs for the droplet split
      d.vx += (tx - d.x) * 0.11; d.vx *= 0.74; d.x += d.vx;
      d.vy += (ty - d.y) * 0.14; d.vy *= 0.7; d.y += d.vy;
      d.vs += (ts - d.s) * 0.12; d.vs *= 0.68; d.s += d.vs;
    }
    // squash & stretch only while flying out / melting
    const speed = settled ? 0 : Math.min(1, Math.hypot(d.vx, d.vy) / 9);
    const ang = Math.atan2(d.vy, d.vx) * 180 / Math.PI;
    const stretch = 1 + speed * 0.35, squash = 1 / Math.sqrt(stretch);
    const sc = Math.max(0.05, d.s);
    const tf = `translate(${(d.x - s / 2).toFixed(2)}px, ${(d.y - s / 2).toFixed(2)}px) rotate(${ang.toFixed(1)}deg) scale(${(sc * stretch).toFixed(3)}, ${(sc * squash).toFixed(3)}) rotate(${(-ang).toFixed(1)}deg)`;
    const op = Math.min(1, Math.max(0, (d.s - 0.12) * 2.2)).toFixed(3);
    // write only what changed: the same values every frame still cost a style pass
    if (d._tf !== tf) { d._tf = tf; d.el.style.transform = tf; }
    if (d._sz !== s) { d._sz = s; d.el.style.width = d.el.style.height = s + 'px'; }
    if (d._op !== op) { d._op = op; d.el.style.opacity = op; }
    const pe = d.dying || hidden ? 'none' : '';
    if (d._pe !== pe) { d._pe = pe; d.el.style.pointerEvents = pe; }
    const moving = Math.abs(d.vx) > 0.02 || Math.abs(d.vy) > 0.02 || Math.abs(d.vs) > 0.002 || Math.abs(tx - d.x) > 0.3;
    if (moving) busy = true;
    if (d.dying && d.s < 0.16 && now - d.diedAt > 450) { d.el.remove(); drops.delete(d.key); }
  }
  // moving: every frame; standing still: a look 8 times a second (the island's edge may have moved them)
  if (busy) raf = requestAnimationFrame(frame);
  else if (drops.size) { clearTimeout(idleT); idleT = setTimeout(kick, 125); }
}
let idleT = 0;
