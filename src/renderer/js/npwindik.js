// Windik of the empty player: the island's own Windik (the little ghost with two tall dark eyes, no
// mouth), drawn on his own and with volume - light from the top left, a glossy highlight, a rim of
// light, a soft glow and a shadow on the floor; glossy eyes. Everything he feels is in his eyes, like
// on the island. Nothing is playing, so he lives his own little life: dozes, wakes up and stretches,
// looks around for the music, sways to a tune of his own, nods off again. The cursor over the card
// wakes him and he watches it; a click makes him jump for joy.

// his outline is the island ghost's: a round top, a flatter bottom
const BODY = 'M0 57.6A60 57.6 0 0 1 60 0A60 57.6 0 0 1 120 57.6A42 38.4 0 0 1 78 96L42 96A42 38.4 0 0 1 0 57.6Z';
const EYE = (x) => `<g class="npw-eye" transform="translate(${x} 50)"><g class="npw-lid">
      <rect x="-8.5" y="-24" width="17" height="48" rx="8.5" fill="url(#npwEye)"/>
      <rect x="-5" y="-20" width="4.2" height="15" rx="2.1" fill="#fff" opacity=".55"/>
      <circle cx="3" cy="14" r="1.7" fill="#fff" opacity=".35"/>
    </g></g>`;
const SVG = `<svg class="npw-svg" viewBox="0 0 120 100" overflow="visible" aria-hidden="true">
  <defs>
    <radialGradient id="npwBody" cx="36%" cy="26%" r="82%">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#f1f0ff"/>
      <stop offset=".8" stop-color="#cdcaf2"/><stop offset="1" stop-color="#a6a0e0"/>
    </radialGradient>
    <linearGradient id="npwEye" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a5e"/><stop offset=".55" stop-color="#1a1a30"/><stop offset="1" stop-color="#0c0c1c"/></linearGradient>
    <filter id="npwSoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>
    <filter id="npwSofter" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
    <clipPath id="npwClip"><path d="${BODY}"/></clipPath>
  </defs>
  <g class="npw-head">
    <path d="${BODY}" fill="url(#npwBody)"/>
    <g clip-path="url(#npwClip)">
      <ellipse cx="62" cy="104" rx="70" ry="22" fill="#7d74d6" opacity=".28" filter="url(#npwSofter)"/>
      <path d="M112 34C122 54 118 80 100 94" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7" filter="url(#npwSoft)"/>
    </g>
    <ellipse cx="34" cy="20" rx="17" ry="8" fill="#fff" opacity=".95" transform="rotate(-24 34 20)" filter="url(#npwSoft)"/>
    <ellipse cx="27" cy="17" rx="5" ry="2.6" fill="#fff" transform="rotate(-24 27 17)"/>
    <ellipse class="npw-cheek" cx="22" cy="70" rx="10" ry="5" fill="#ff8fbf" filter="url(#npwSoft)"/>
    <ellipse class="npw-cheek" cx="98" cy="70" rx="10" ry="5" fill="#ff8fbf" filter="url(#npwSoft)"/>
    <g class="npw-eyes">
      <g class="npw-open">${EYE(42)}${EYE(78)}</g>
      <g class="npw-joy" stroke="url(#npwEye)" stroke-width="7" stroke-linecap="round" fill="none"><path d="M33 56Q42 42 51 56"/><path d="M69 56Q78 42 87 56"/></g>
    </g>
  </g>
</svg>`;

const FX = '<div class="npw-fx"><b class="z">z</b><b class="z">z</b><b class="z">Z</b><b class="n">♪</b><b class="n">♫</b><b class="n">♪</b><b class="q">?</b>'
  + '<i class="sp"></i><i class="sp"></i><i class="sp"></i><i class="sp"></i><i class="sp"></i></div>';

export function npWindik() {
  const el = document.createElement('div');
  el.className = 'npw st-sleep';
  el.innerHTML = `<div class="npw-shadow"></div><div class="npw-float"><div class="npw-squash">${SVG}</div></div>${FX}`;
  const look = (x, y) => { el.style.setProperty('--px', x.toFixed(2) + 'px'); el.style.setProperty('--py', y.toFixed(2) + 'px'); };
  let state = 'sleep', timer = 0, hover = false, lookT = 0;
  const set = (s) => {
    state = s;
    el.className = 'npw st-' + s;
    clearTimeout(lookT);
    if (s === 'look') { // looking around for the music: left... right... and a "?"
      look(-9, 1);
      lookT = setTimeout(() => { look(9, 1); lookT = setTimeout(() => look(0, -4), 900); }, 900);
    } else if (!hover) look(0, 0);
  };
  // his day while nothing plays
  const LIFE = [['sleep', 8500], ['yawn', 1500], ['look', 2700], ['hum', 3600], ['sleepy', 1400]];
  let k = 0;
  const live = () => {
    clearTimeout(timer);
    if (hover) return;
    const [s, ms] = LIFE[k++ % LIFE.length];
    if (el.isConnected && !document.hidden) set(s);
    timer = setTimeout(live, ms);
  };
  timer = setTimeout(live, 2500);
  // the cursor over the card wakes him up, and he watches it
  const card = () => el.closest('.card') || el.parentElement;
  const onMove = (e) => {
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.52);
    const d = Math.hypot(dx, dy) || 1, k2 = Math.min(1, d / 160);
    look((dx / d) * 9 * k2, (dy / d) * 6 * k2);
  };
  const enter = () => { hover = true; clearTimeout(timer); if (state !== 'joy') set('wake'); };
  const leave = () => { hover = false; look(0, 0); k = 2; timer = setTimeout(live, 1600); };
  queueMicrotask(() => {
    const c = card();
    c?.addEventListener('pointerenter', enter);
    c?.addEventListener('pointerleave', leave);
    c?.addEventListener('pointermove', onMove);
  });
  // a click: a happy jump with sparkles
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    clearTimeout(timer);
    set('joy');
    void el.offsetWidth;
    timer = setTimeout(() => { if (hover) set('wake'); else { k = 3; live(); } }, 1300);
  });
  return el;
}
