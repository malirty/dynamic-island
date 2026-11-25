// Tiny JSON persistence in %APPDATA%/Island. Writes are debounced and atomic.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SETTINGS = {
  theme: {
    mode: 'dark',            // dark | light
    style: 'mood',           // mood ("По умолчанию": colour follows the mood) | liquid | glass | gradient | solid
    colors: ['#7c5cff', '#00d4ff', '#ff4fd8'],
    solid: '#0b0b0f',
    glow: 0.8,               // 0..1
    coverGlow: true,         // edge glows with album-cover color
    edgeDance: true,         // waves + glowing bottom with the beat
    water: true,             // edges behave like water (react to the cursor)
    cursorGlow: true,        // light follows the cursor
    reactive: true,          // island leans toward the cursor
    blur: 28,
    scale: 1,
  },
  island: {
    character: 'eyes',       // eyes | buddies | none
    showPlayer: true,        // track in the pill / mini island (the island dances either way)
    showSeconds: false,
    hideOnFullscreen: true,
    autostart: false,
    sleepAfterMin: 5,
  },
  tabs: [
    { id: 'home', on: true }, { id: 'clip', on: true }, { id: 'ai', on: true },
    { id: 'text', on: true }, { id: 'notes', on: true }, { id: 'calendar', on: true }, { id: 'phone', on: true }, { id: 'weather', on: true },
    { id: 'control', on: true }, { id: 'tg', on: true }, { id: 'settings', on: true },
  ],
  home: [
    { id: 'player', on: true }, { id: 'actions', on: true }, { id: 'weather', on: true },
    { id: 'shelf', on: true }, { id: 'agents', on: true }, { id: 'notifs', on: true }, { id: 'clips', on: false }, { id: 'notes', on: false },
  ],
  quickActions: ['region', 'ocr', 'color', 'qr', 'timer', 'note', 'dictate', 'caffeine'],
  controlTiles: ['wifi', 'bluetooth', 'vpn', 'darkmode', 'dnd', 'mute', 'caffeine', 'islandTheme'],
  controlSliders: ['volume', 'brightness'],
  ai: {
    provider: 'gemini',
    keys: { deepseek: '', gemini: '', openai: '' },
    models: { deepseek: 'deepseek-chat', gemini: 'gemini-2.5-flash', openai: 'gpt-4.1-mini', ollama: 'llama3.2' },
    ollamaUrl: 'http://127.0.0.1:11434',
    system: 'Ты — помощник, живущий в Dynamic Island на Windows. Отвечай кратко и по делу, по-русски, если не попросили иначе.',
  },
  weather: { city: '', lat: null, lon: null, rainAlerts: true },
  downloadsDir: '',
  hotkeys: { palette: 'Alt+Space', themeToggle: 'Alt+Shift+D', region: 'Alt+Shift+S', island: 'Alt+Shift+Space' },
  dnd: false,
  phone: { enabled: true, askOnConnect: true },  // the phone over a USB cable: photos to the computer, files to the phone
  notifications: { windows: true, telegram: false, agentsBypassDnd: true, capsLock: true, numLock: false },
  telegram: { apiId: '', apiHash: '', session: '', onlyPrivate: true },
  // the mini Telegram in the island: its own look, not a copy of Telegram
  tgui: { accent: '#7c5cff', bubbles: 'round', size: 'm', wallpaper: 'theme', avatars: true, openOnClick: true },
  agents: { port: 47821, token: '' },
};

function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over || {})) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
    return out;
  }
  return over === undefined ? base : over;
}

class Store {
  constructor(name, defaults) {
    this.file = path.join(app.getPath('userData'), name + '.json');
    this.defaults = defaults;
    this.timer = null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = deepMerge(defaults, raw);
    } catch {
      this.data = JSON.parse(JSON.stringify(defaults));
    }
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }
  flush() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
}

let stores = {};
module.exports = {
  DEFAULT_SETTINGS,
  init() {
    stores.settings = new Store('settings', DEFAULT_SETTINGS);
    // new tabs appear for people who already have a saved tab list
    const tabs = stores.settings.data.tabs;
    if (Array.isArray(tabs) && !tabs.some((t) => t.id === 'tg')) {
      const i = tabs.findIndex((t) => t.id === 'settings');
      tabs.splice(i < 0 ? tabs.length : i, 0, { id: 'tg', on: true });
      stores.settings.save();
    }
    if (Array.isArray(tabs) && !tabs.some((t) => t.id === 'phone')) {
      const i = tabs.findIndex((t) => t.id === 'weather');
      tabs.splice(i < 0 ? tabs.length : i, 0, { id: 'phone', on: true });
      stores.settings.save();
    }
    if (Array.isArray(tabs) && !tabs.some((t) => t.id === 'calendar')) {
      const i = tabs.findIndex((t) => t.id === 'notes');
      tabs.splice(i < 0 ? tabs.length : i + 1, 0, { id: 'calendar', on: true });
      stores.settings.save();
    }
    stores.clips = new Store('clipboard', { items: [] });
    stores.notes = new Store('notes', { items: [] });
    stores.shelf = new Store('shelf', { items: [] });
    stores.reminders = new Store('reminders', { items: [] });
    stores.ai = new Store('ai-chats', { chats: [] });
    stores.state = new Store('state', { lastToastId: 0 });
    return stores;
  },
  get: (n) => stores[n],
  flushAll() { for (const s of Object.values(stores)) try { s.flush(); } catch {} },
  dir: () => app.getPath('userData'),
};
