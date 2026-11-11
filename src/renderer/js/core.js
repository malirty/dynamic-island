// Shared renderer core: state + event bus, API, formatting, icons.
export const api = window.island;

const listeners = new Map();
export const bus = {
  on(ev, fn) { (listeners.get(ev) || listeners.set(ev, new Set()).get(ev)).add(fn); return () => listeners.get(ev).delete(fn); },
  emit(ev, p) { for (const fn of listeners.get(ev) || []) try { fn(p); } catch (e) { console.error(ev, e); } },
};

export const state = {
  settings: null, clips: [], notes: [], shelf: [], reminders: [], weather: null, media: { active: false }, lyrics: null,
  notifications: [], downloads: [], agents: { sessions: [], asks: [] }, providers: {}, level: 0, idle: 0,
};

export function saveSettings() {
  return api.invoke('settings:set', state.settings).then((hk) => { bus.emit('settings', state.settings); return hk; });
}

// ---------- DOM helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    if (kid.nodeType) el.append(kid);
    else if (typeof kid === 'string' && kid.startsWith('<svg')) el.insertAdjacentHTML('beforeend', kid); // icon() markup
    else el.append(document.createTextNode(kid));
  }
  return el;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- formatting ----------
export function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const hh = Math.round(m / 60);
  if (hh < 24) return `${hh} ч назад`;
  const d = Math.round(hh / 24);
  return d === 1 ? 'вчера' : `${d} дн назад`;
}
export function bytes(n) {
  if (!n && n !== 0) return '';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}
export const clock = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (hh ? hh + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
export const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const n1 = n % 10; return n > 10 && n < 20 ? c : n1 > 1 && n1 < 5 ? b : n1 === 1 ? a : c; };

// Count-up animation for numbers ("цифры оживают").
export function countUp(el, to, { dur = 900, decimals = 0, suffix = '' } = {}) {
  const from = 0, t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = (from + (to - from) * e).toFixed(decimals) + suffix;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- weather codes ----------
export function wmo(code, isDay = 1) {
  const day = !!isDay;
  if (code === 0) return { icon: day ? '☀️' : '🌙', text: 'Ясно', scene: day ? 'sun' : 'night' };
  if (code <= 2) return { icon: day ? '🌤' : '🌙', text: code === 1 ? 'Преимущественно ясно' : 'Переменная облачность', scene: day ? 'partly' : 'night' };
  if (code === 3) return { icon: '☁️', text: 'Пасмурно', scene: 'cloud' };
  if (code <= 48) return { icon: '🌫', text: 'Туман', scene: 'fog' };
  if (code <= 57) return { icon: '🌦', text: 'Морось', scene: 'rain' };
  if (code <= 67) return { icon: '🌧', text: code >= 66 ? 'Ледяной дождь' : 'Дождь', scene: 'rain' };
  if (code <= 77) return { icon: '🌨', text: 'Снег', scene: 'snow' };
  if (code <= 82) return { icon: '🌧', text: 'Ливень', scene: 'rain' };
  if (code <= 86) return { icon: '🌨', text: 'Снегопад', scene: 'snow' };
  return { icon: '⛈', text: 'Гроза', scene: 'storm' };
}

// ---------- icons (stroke icons, 24x24) ----------
const P = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  clip: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2M9 12h6M9 16h4',
  ai: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
  text: 'M4 7V5h16v2M9 19h6M12 5v14',
  notes: 'M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M8 13h8M8 17h5',
  weather: 'M7 18a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 18.5 12 3 3 0 0 1 18 18z',
  control: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  play: 'M7 4.5v15l13-7.5z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  next: 'M5 5l10 7-10 7zM18 5v14',
  prev: 'M19 5L9 12l10 7zM6 5v14',
  pin: 'M12 17v5M8 3h8l-1 7 3 3H6l3-3z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h10v11H9zM5 15V4h11',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  send: 'M4 12l16-8-6 16-2-7z',
  attach: 'M20 11.5l-8.5 8.5a5 5 0 0 1-7-7L13 4.5a3.5 3.5 0 0 1 5 5L9.5 18a2 2 0 0 1-3-3L14 7.5',
  window: 'M4 5h16v14H4zM4 9h16',
  region: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M9 9h6v6H9z',
  color: 'M14.5 4.5l5 5M12 7l5 5-8 8H4v-5zM15 3.5a2.1 2.1 0 0 1 3 0l2.5 2.5a2.1 2.1 0 0 1 0 3L19 10.5 13.5 5z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2M14 18h2v2M18 18h2v2',
  ocr: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 9h8M12 9v7',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2.5M9 2h6',
  note: 'M5 4h14v12l-4 4H5zM15 16v4M15 16h4M8 9h8M8 12h5',
  coffee: 'M5 8h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM17 9h1.5a2.5 2.5 0 0 1 0 5H17M8 2.5v3M11 2.5v3M14 2.5v3',
  translate: 'M4 5h9M8.5 3v2M6 5c.6 3 2.7 5.6 5.5 7M11 5c-.8 3.6-3.4 6.6-7 8M13 20l4-9 4 9M14.5 17h5',
  wifi: 'M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01',
  bluetooth: 'M7 7l10 10-5 4V3l5 4L7 17',
  vpn: 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6zM9 12l2 2 4-4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4',
  belloff: 'M6 8a6 6 0 0 1 9.3-5M18 8c0 7 3 9 3 9H9M10 21h4M3 3l18 18',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 5M22 9l-5 5',
  brightness: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 1 1 8 0v4',
  sleep: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5zM15 4h4l-4 4h4',
  restart: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  file: 'M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
  lyrics: 'M4 6h12M4 10h12M4 14h8M17 14v6a2 2 0 1 1-2-2h2',
  shelf: 'M3 14l2-9h14l2 9M3 14v5h18v-5M3 14h5l1 2h6l1-2h5',
  agent: 'M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8',
  spark: 'M12 3v18M3 12h18M6 6l12 12M18 6L6 18',
  theme: 'M12 3a9 9 0 1 0 0 18V3z',
  palette: 'M12 3a9 9 0 0 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 1.8-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5zM7.5 11h.01M10 7.5h.01M15 7.5h.01',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  wind: 'M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7',
  gauge: 'M12 14l4-4M3.5 18a9 9 0 1 1 17 0',
  uv: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v3M12 20v3M3 12H1M23 12h-2',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  stop: 'M7 7h10v10H7z',
  hotspot: 'M12 12h.01M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8',
  grab: 'M8 12V5a1.5 1.5 0 0 1 3 0v6M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3 15.5a1.5 1.5 0 0 1 2.5-1.7L8 16',
};
export function icon(name, size = 18, cls = '') {
  const d = P[name] || P.spark;
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}
export const iconEl = (name, size, cls) => { const s = document.createElement('span'); s.className = 'icw'; s.innerHTML = icon(name, size, cls); return s; };

// Dominant, saturated color of an image (for the cover glow).
export function coverColor(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data;
      let best = null, bestScore = -1, avg = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        avg[0] += r; avg[1] += g; avg[2] += b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx ? (mx - mn) / mx : 0;
        const score = sat * 0.7 + (mx / 255) * 0.3 - (mx > 245 && sat < 0.1 ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = [r, g, b]; }
      }
      const n = d.length / 4;
      const pick = bestScore > 0.35 ? best : avg.map((v) => v / n);
      // lift dark colors so the glow is visible
      const mx = Math.max(...pick) || 1;
      const k = mx < 150 ? 150 / mx : 1;
      resolve(`rgb(${pick.map((v) => Math.min(255, Math.round(v * k))).join(',')})`);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
