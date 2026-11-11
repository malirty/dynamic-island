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
  sunrise: 'M12 3v5M8.5 6.5L12 3l3.5 3.5M5 19h14M7 15.5a5 5 0 0 1 10 0M3 15.5h1.5M19.5 15.5H21M5.6 10.6l1 1M18.4 10.6l-1 1',
  sunset: 'M12 8V3M8.5 4.5L12 8l3.5-3.5M5 19h14M7 15.5a5 5 0 0 1 10 0M3 15.5h1.5M19.5 15.5H21M5.6 10.6l1 1M18.4 10.6l-1 1',
  alert: 'M12 3.5l9 16H3zM12 10v4.2M12 17.2v.01',
  plane: 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  question: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01',
  rain: 'M7 14.5a4 4 0 0 1-.6-8 5.5 5.5 0 0 1 10.6 1.5 3.5 3.5 0 0 1 0 6.5zM8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5',
  cloud: 'M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.7A3.7 3.7 0 0 1 17.5 18z',
  snow: 'M7 13.5a4 4 0 0 1-.6-8 5.5 5.5 0 0 1 10.6 1.5 3.5 3.5 0 0 1 0 6.5zM8 17.5h.01M12 19.5h.01M16 17.5h.01M10 21.5h.01M14 21.5h.01',
  storm: 'M7 14a4 4 0 0 1-.6-8 5.5 5.5 0 0 1 10.6 1.5A3.5 3.5 0 0 1 17 14M13 11l-3 5h4l-3 5',
  fog: 'M4 9h16M6 13h13M4 17h15M8 5h9',
  partly: 'M8 3v1.5M3.5 8H2M4.6 4.6l1 1M12.4 4.6l-1 1M5.5 10.5A3.5 3.5 0 1 1 11.4 7M9 20a4 4 0 0 1-.5-8 5 5 0 0 1 9.6 1.4A3.3 3.3 0 0 1 18 20z',
  claude: 'M12 3v6.5M12 14.5V21M3 12h6.5M14.5 12H21M5.6 5.6l4.6 4.6M13.8 13.8l4.6 4.6M5.6 18.4l4.6-4.6M13.8 10.2l4.6-4.6',
  codex: 'M4 4.5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM7 10l3 2.2L7 14.4M12.5 15h4.5',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z',
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
  micoff: 'M15 10V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 5.1 2.1M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.7 3M12 18v3M3 3l18 18',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
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
// ---------- glyphs: app logos / drawn symbols instead of emoji ----------
const TONES = {
  ok: ['#34c759', '#1d9a46'], bad: ['#ff5b4f', '#d02a20'], blue: ['#4c8dff', '#2459d6'], violet: ['#9b6bff', '#6436d8'],
  amber: ['#ffae2b', '#e07800'], pink: ['#ff5aa5', '#cc2271'], teal: ['#22c7b4', '#0e8e80'], gray: ['#7b8494', '#4d5563'],
  claude: ['#ee8a5e', '#c75a32'], codex: ['#3a3a44', '#0d0d12'],
};
const EMO = {
  '✅': ['check', 'ok'], '⚠️': ['alert', 'bad'], '📋': ['clip', 'blue'], '🎙': ['mic', 'violet'], '⏱': ['timer', 'amber'],
  '⏰': ['bell', 'amber'], '🔔': ['bell', 'amber'], '🖼': ['image', 'blue'], '🎨': ['color', 'pink'], '▦': ['qr', 'gray'],
  '🔤': ['ocr', 'blue'], '📥': ['download', 'blue'], '🎵': ['note', 'pink'], '🛡': ['vpn', 'teal'], '📶': ['wifi', 'blue'],
  '✈️': ['plane', 'blue'], '⌨️': ['keyboard', 'gray'], '🤔': ['question', 'violet'], '✋': ['stop', 'amber'], '📞': ['phone', 'ok'],
  '🌧': ['rain', 'blue'], '⛅': ['partly', 'blue'], '✳': ['claude', 'claude'], '📎': ['attach', 'gray'],
};
// which symbol a notification/toast gets: by where it came from, then by its emoji
export function glyphFor(t) {
  let g = null;
  if (t.done) g = ['check', 'ok', 1]; // finished: a round green tick, not a logo
  else if (t.kind === 'agent') g = t.source === 'codex' ? ['codex', 'codex'] : ['claude', 'claude'];
  else if (t.kind === 'reminder') g = [t.icon === '⏱' ? 'timer' : 'bell', 'amber'];
  else if (t.kind === 'rain') g = ['rain', 'blue'];
  else if (t.kind === 'call') g = ['phone', 'ok'];
  else g = EMO[t.icon] || null;
  if (!g) return null;
  const [a, b] = TONES[g[1]];
  return { ic: g[0], bg: `linear-gradient(145deg, ${a}, ${b})`, round: !!g[2] };
}
// a small tile: app logo, drawn symbol, or (last resort) the first letter
export function glyphTile(t, size = 28, cls = 'gtile') {
  const r = Math.round(size * 0.3);
  if (t.thumb) return `<span class="${cls}" style="width:${size}px;height:${size}px;border-radius:${r}px;background:center/cover url('${t.thumb}')"></span>`;
  if (t.logo) return `<span class="${cls} logo" style="width:${size}px;height:${size}px;border-radius:${r}px;background:center/78% no-repeat url('${t.logo}')"></span>`;
  const g = glyphFor(t);
  if (g) return `<span class="${cls}${g.round ? ' round' : ''}" style="width:${size}px;height:${size}px;border-radius:${g.round ? '50%' : r + 'px'};background:${g.bg};color:#fff">${icon(g.ic, Math.round(size * (g.round ? 0.52 : 0.58)))}</span>`;
  if (t.color) return `<span class="${cls}" style="width:${size}px;height:${size}px;border-radius:${r}px;background:${t.color}"></span>`;
  const letter = (t.app || t.title || '•').trim()[0] || '•';
  return `<span class="${cls}" style="width:${size}px;height:${size}px;border-radius:${r}px;background:var(--card2);font-weight:800;font-size:${Math.round(size * 0.45)}px">${letter.toUpperCase().replace(/[<>&"']/g, '')}</span>`;
}
// weather as a drawn icon
export function weatherIcon(code, day = 1, size = 15) {
  const n = code === 0 ? (day ? 'sun' : 'moon') : code <= 2 ? (day ? 'partly' : 'moon') : code === 3 ? 'cloud' : code <= 48 ? 'fog'
    : code <= 67 || (code >= 80 && code <= 82) ? 'rain' : code <= 86 ? 'snow' : 'storm';
  return icon(n, size, 'wic w-' + n);
}

// effects around the character's eyes (shown by mood classes in CSS)
export const CHARACTERS = [['eyes', 'Глаза'], ['cat', 'Котик'], ['bunny', 'Зайка'], ['robot', 'Робот'], ['ghost', 'Призрак'], ['alien', 'Пришелец'], ['angel', 'Ангел'], ['frog', 'Лягушка'], ['devil', 'Чертёнок'], ['buddies', 'Человечки'], ['none', 'Никого']];
export const EYE_FX = `<div class="deco"><i></i><i></i><i></i><i></i></div><div class="fx"><i class="fx-load"></i><i class="fx-orbit"><b></b><b></b><b></b></i><i class="fx-dots"><b></b><b></b><b></b></i><i class="fx-bulb"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg></i><i class="fx-bang">!</i><i class="fx-notes"><b>♪</b><b>♫</b><b>♪</b></i><i class="fx-joy"><b>✦</b><b>✦</b><b>✦</b><b>✦</b></i><i class="fx-vein"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M3 9.5c3.5 0 6.5-3 6.5-6.5M14.5 3c0 3.5 3 6.5 6.5 6.5M21 14.5c-3.5 0-6.5 3-6.5 6.5M9.5 21c0-3.5-3-6.5-6.5-6.5"/></svg></i></div>`;

export function icon(name, size = 18, cls = '') {
  const d = P[name] || P.spark;
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}
// Filled, softly rounded media controls (iOS-like) for the players.
const MEDIA = {
  play: '<path d="M7.6 3.8c-1-.62-2.4.1-2.4 1.3v13.8c0 1.2 1.4 1.92 2.4 1.3l11.2-6.9a1.5 1.5 0 0 0 0-2.6z" transform="translate(1 0)"/>',
  pause: '<rect x="5" y="3.6" width="5" height="16.8" rx="1.8"/><rect x="14" y="3.6" width="5" height="16.8" rx="1.8"/>',
  next: '<path d="M1.6 6.6c0-1 1.1-1.55 1.9-1l7.3 5.2c.66.47.66 1.45 0 1.92l-7.3 5.2c-.8.55-1.9 0-1.9-1z"/><path d="M11.4 6.6c0-1 1.1-1.55 1.9-1l7.3 5.2c.66.47.66 1.45 0 1.92l-7.3 5.2c-.8.55-1.9 0-1.9-1z"/>',
  prev: '<g transform="translate(24 0) scale(-1 1)"><path d="M1.6 6.6c0-1 1.1-1.55 1.9-1l7.3 5.2c.66.47.66 1.45 0 1.92l-7.3 5.2c-.8.55-1.9 0-1.9-1z"/><path d="M11.4 6.6c0-1 1.1-1.55 1.9-1l7.3 5.2c.66.47.66 1.45 0 1.92l-7.3 5.2c-.8.55-1.9 0-1.9-1z"/></g>',
};
export function mediaIcon(name, size = 18) {
  return `<svg class="ic mic-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">${MEDIA[name]}</svg>`;
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
