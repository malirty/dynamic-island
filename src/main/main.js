const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, session, nativeImage, clipboard, shell, dialog, powerMonitor, powerSaveBlocker, Tray, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

app.setName('Island');
app.setPath('userData', path.join(app.getPath('appData'), 'Island'));
app.setAppUserModelId('Island.DynamicIsland');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const helper = require('./helper');
const storeMod = require('./store');
const createClipboard = require('./clipboard');
const createDownloads = require('./downloads');
const createWeather = require('./weather');
const createMedia = require('./media');
const createAI = require('./ai');
const createAgents = require('./agents');
const createTelegram = require('./telegram');
const sys = require('./system');

const RENDERER = path.join(__dirname, '..', 'renderer');
const WIN_W = 880, WIN_H = 700;

let island, aiWin, captureWin, tray;
let S; // stores
let services = {};
let lastExternal = null; // last foreground window that isn't ours: paste target & clip source
let fgFullscreen = false;
let caffeineId = null;
let hitRects = [];

const send = (ch, payload) => { if (island && !island.isDestroyed()) island.webContents.send(ch, payload); };
const sendAll = (ch, payload) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, payload);
};

// ---------------- notifications pipeline ----------------
const recent = [];
function notify(n) {
  n = { id: crypto.randomUUID(), at: Date.now(), ...n };
  recent.unshift(n);
  recent.length = Math.min(recent.length, 50);
  const silent = S.settings.data.dnd && !(n.kind === 'agent' && S.settings.data.notifications.agentsBypassDnd) && n.kind !== 'reminder';
  send('notification', { ...n, silent });
}

// ---------------- reminders & timers ----------------
function remindersTick() {
  const now = Date.now();
  let changed = false;
  for (const r of S.reminders.data.items) {
    if (r.done || r.at > now) continue;
    r.done = true; changed = true;
    notify({ kind: 'reminder', title: r.kind === 'timer' ? 'Таймер' : 'Напоминание', body: r.text || 'Время вышло', icon: r.kind === 'timer' ? '⏱' : '🔔', sticky: true });
    if (Notification.isSupported() && !island?.isVisible()) new Notification({ title: 'Island', body: r.text || 'Таймер' }).show();
  }
  // keep finished items for a day for history
  const before = S.reminders.data.items.length;
  S.reminders.data.items = S.reminders.data.items.filter((r) => !r.done || now - r.at < 86400e3);
  if (changed || before !== S.reminders.data.items.length) { S.reminders.save(); send('reminders', S.reminders.data.items); }
}

// ---------------- island window ----------------
function primaryTop() {
  const d = screen.getPrimaryDisplay();
  return { x: Math.round(d.bounds.x + (d.bounds.width - WIN_W) / 2), y: d.bounds.y };
}

function createIsland() {
  const { x, y } = primaryTop();
  island = new BrowserWindow({
    x, y, width: WIN_W, height: WIN_H,
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    backgroundColor: '#00000000', title: 'Island',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, spellcheck: false },
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setVisibleOnAllWorkspaces(true);
  island.setIgnoreMouseEvents(true, { forward: true });
  hitRects = [{ x: Math.round(WIN_W / 2 - 170), y: 0, width: 340, height: 50 }];
  island.loadFile(path.join(RENDERER, 'island.html'));
  island.once('ready-to-show', () => island.showInactive());
  island.on('blur', () => send('blur'));
  // renderer warnings/errors go to %APPDATA%/Island/island.log
  const logFile = path.join(app.getPath('userData'), 'island.log');
  island.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) fs.appendFile(logFile, `${new Date().toISOString()} [${level === 3 ? 'error' : 'warn'}] ${message} (${path.basename(source || '')}:${line})\n`, () => {});
  });
  island.webContents.on('render-process-gone', (_e, d) => fs.appendFile(logFile, `${new Date().toISOString()} renderer gone: ${d.reason}\n`, () => {}));
  if (process.argv.includes('--dev')) island.webContents.openDevTools({ mode: 'detach' });
  screen.on('display-metrics-changed', () => { const p = primaryTop(); island.setBounds({ ...p, width: WIN_W, height: WIN_H }); });
}

let settingsWin = null;
function openSettingsWindow(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (section) settingsWin.webContents.send('settings-section', section);
    settingsWin.show(); settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 1040, height: 720, minWidth: 820, minHeight: 520, frame: false, transparent: true, backgroundColor: '#00000000',
    title: 'Island · Настройки', show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false },
  });
  settingsWin.loadFile(path.join(RENDERER, 'settings.html'), { query: section ? { section } : {} });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) fs.appendFile(path.join(app.getPath('userData'), 'island.log'), `${new Date().toISOString()} [settings] ${message} (${path.basename(source || '')}:${line})
`, () => {});
  });
}

function openAiWindow() {
  if (aiWin && !aiWin.isDestroyed()) { aiWin.show(); aiWin.focus(); return; }
  aiWin = new BrowserWindow({
    width: 760, height: 820, minWidth: 420, minHeight: 500, frame: false, transparent: true, backgroundColor: '#00000000',
    title: 'Island · ИИ', webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false },
  });
  aiWin.loadFile(path.join(RENDERER, 'ai.html'));
}

// ---------------- capture (region / color / qr / ocr) ----------------
let pendingCapture = null;
async function startCapture(mode) {
  if (captureWin && !captureWin.isDestroyed()) return;
  send('capture-hide', true);
  await new Promise((r) => setTimeout(r, 160));
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const sf = display.scaleFactor;
  const size = { width: Math.round(display.bounds.width * sf), height: Math.round(display.bounds.height * sf) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  send('capture-hide', false);
  if (!src) return;
  pendingCapture = { mode, dataUrl: src.thumbnail.toDataURL(), sf, display: display.bounds };
  captureWin = new BrowserWindow({
    ...display.bounds, frame: false, transparent: false, backgroundColor: '#000000', alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, fullscreenable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false },
  });
  captureWin.setAlwaysOnTop(true, 'screen-saver');
  captureWin.setBounds(display.bounds);
  captureWin.loadFile(path.join(RENDERER, 'capture.html'));
  captureWin.once('ready-to-show', () => { captureWin.show(); captureWin.focus(); });
  captureWin.on('closed', () => { captureWin = null; });
}

async function ocrImage(image, lang) {
  const file = path.join(os.tmpdir(), `island-ocr-${Date.now()}.png`);
  fs.writeFileSync(file, image.toPNG());
  try { return await helper.slow('ocr', { path: file, lang }, 30000); } finally { fs.rm(file, () => {}); }
}

// ---------------- helpers ----------------
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm', mp4: 'video/mp4',
  txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', xml: 'application/xml', html: 'text/html', css: 'text/css',
  js: 'text/javascript', ts: 'text/plain', py: 'text/x-python', java: 'text/plain', c: 'text/plain', cpp: 'text/plain', cs: 'text/plain',
  go: 'text/plain', rs: 'text/plain', php: 'text/plain', rb: 'text/plain', sh: 'text/plain', ps1: 'text/plain', bat: 'text/plain',
  yml: 'text/plain', yaml: 'text/plain', toml: 'text/plain', ini: 'text/plain', log: 'text/plain', sql: 'text/plain', jsx: 'text/plain', tsx: 'text/plain', vue: 'text/plain',
};
function readForAI(p) {
  const st = fs.statSync(p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const name = path.basename(p);
  if (mime.startsWith('text/') || /json|xml/.test(mime)) return { name, mime, text: fs.readFileSync(p, 'utf8').slice(0, 200000), size: st.size };
  if (st.size > 18 * 1024 * 1024) return { name, mime, size: st.size, tooBig: true };
  if (/^(image|audio|video)\/|pdf/.test(mime)) return { name, mime, data: fs.readFileSync(p).toString('base64'), size: st.size };
  return { name, mime, size: st.size };
}

let rates = { at: 0, data: null };
async function currency() {
  if (rates.data && Date.now() - rates.at < 3600e3) return rates.data;
  const out = { RUB: 1 };
  try {
    // Central Bank of Russia rates (RUB per unit)
    const r = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    for (const [k, v] of Object.entries(j.Valute)) out[k] = v.Value / v.Nominal;
  } catch {
    // fallback: open.er-api.com gives units per 1 RUB
    const r = await fetch('https://open.er-api.com/v6/latest/RUB', { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    for (const [k, v] of Object.entries(j.rates || {})) if (v) out[k] = 1 / v;
  }
  rates = { at: Date.now(), data: out };
  return out;
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hk = S.settings.data.hotkeys;
  const result = {};
  const reg = (acc, fn) => { if (!acc) return; try { result[acc] = globalShortcut.register(acc, fn); } catch { result[acc] = false; } };
  reg(hk.palette, () => { island.focus(); send('palette-open'); });
  reg(hk.themeToggle, () => send('theme-toggle'));
  reg(hk.region, () => startCapture('region'));
  reg(hk.island, () => { island.focus(); send('island-toggle'); });
  return result;
}

function applySettings() {
  const s = S.settings.data;
  app.setLoginItemSettings({ openAtLogin: !!s.island.autostart, args: [] });
  services.downloads.restart();
}

// Right-click menu on the island. Settings changed here are pushed to every window.
let snoozeTimer = null;
function showIslandMenu({ tab }) {
  const s = S.settings.data;
  const set = (fn) => () => { fn(s); S.settings.save(); sendAll('settings', s); applySettings(); };
  const tabs = [['home', 'Главная'], ['clip', 'Буфер'], ['ai', 'ИИ'], ['text', 'Текст'], ['notes', 'Заметки'], ['weather', 'Погода'], ['control', 'Центр управления']];
  const menu = Menu.buildFromTemplate([
    { label: 'Открыть', submenu: tabs.map(([id, label]) => ({ label, click: () => { island.focus(); send('open-tab', id); } })) },
    { label: 'Командная строка', accelerator: s.hotkeys.palette || undefined, click: () => { island.focus(); send('palette-open'); } },
    { type: 'separator' },
    { label: 'Скриншот области', accelerator: s.hotkeys.region || undefined, click: () => startCapture('region') },
    { label: 'Распознать текст с экрана', click: () => startCapture('ocr') },
    { label: 'Перевести текст с экрана', click: () => startCapture('translate') },
    { label: 'Пипетка', click: () => startCapture('color') },
    { label: 'Прочитать QR-код', click: () => startCapture('qr') },
    { type: 'separator' },
    { label: s.theme.mode === 'dark' ? 'Светлая тема' : 'Тёмная тема', accelerator: s.hotkeys.themeToggle || undefined, click: () => send('theme-toggle') },
    { label: 'Материал', submenu: [['liquid', 'Жидкий'], ['glass', 'Стекло'], ['gradient', 'Градиент'], ['solid', 'Сплошной']].map(([v, label]) => ({ label, type: 'radio', checked: s.theme.style === v, click: set((x) => (x.theme.style = v)) })) },
    { label: 'Характер', submenu: [['eyes', 'Глаза'], ['buddies', 'Человечки'], ['none', 'Никого']].map(([v, label]) => ({ label, type: 'radio', checked: s.island.character === v, click: set((x) => (x.island.character = v)) })) },
    { label: 'Края как вода', type: 'checkbox', checked: s.theme.water !== false, click: set((x) => (x.theme.water = x.theme.water === false)) },
    { label: 'Не беспокоить', type: 'checkbox', checked: !!s.dnd, click: set((x) => (x.dnd = !x.dnd)) },
    { label: 'Спрятать на 30 минут', click: () => { island.hide(); clearTimeout(snoozeTimer); snoozeTimer = setTimeout(() => island.showInactive(), 30 * 60e3); } },
    { type: 'separator' },
    { label: 'Окно ИИ', click: openAiWindow },
    { label: 'Настройки', click: () => openSettingsWindow() },
    { label: 'Перезапустить', click: () => { app.relaunch(); app.quit(); } },
    { label: 'Выход', click: () => app.quit() },
  ]);
  menu.popup({ window: island });
}

function trayIcon() {
  // 16x16 BGRA pill drawn in code, so the app ships without binary assets.
  const w = 16, h = 16, buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.max(0, Math.abs(x - 7.5) - 3.5), dy = Math.abs(y - 7.5);
    const d = Math.sqrt(dx * dx + dy * dy);
    const a = Math.max(0, Math.min(1, 4.6 - d));
    const i = (y * w + x) * 4;
    buf[i] = 255; buf[i + 1] = 140 + x * 6; buf[i + 2] = 124; buf[i + 3] = Math.round(a * 255);
  }
  return nativeImage.createFromBitmap(buf, { width: w, height: h });
}

// ---------------- polling ----------------
function startPolling() {
  // Foreground window: paste target, clip source, clipboard changes, fullscreen.
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const fg = await helper.fast('fg', {}, 3000);
      const ours = fg.pid === process.pid || BrowserWindow.getAllWindows().some((w) => String(w.getNativeWindowHandle().readBigUInt64LE()) === fg.hwnd);
      if (!ours && fg.hwnd !== '0') lastExternal = fg;
      services.clips.onSeq(fg.clipSeq, ours ? lastExternal : fg);
      const full = !ours && fg.fullscreen && S.settings.data.island.hideOnFullscreen;
      if (full !== fgFullscreen) { fgFullscreen = full; send('fullscreen', full); }
    } catch {} finally { busy = false; }
  }, 450);

  // Cursor for eyes / glow / magnetic tilt, plus click-through outside the island:
  // the glow margin stays visible but clicks there reach the windows below.
  let last = '';
  let ignoring = null;
  setInterval(() => {
    if (!island || island.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const b = island.getBounds();
    const x = p.x - b.x, y = p.y - b.y;
    const inside = hitRects.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
    if (ignoring !== !inside) { ignoring = !inside; island.setIgnoreMouseEvents(ignoring, { forward: true }); }
    const k = p.x + ',' + p.y;
    if (k === last) return;
    last = k;
    send('cursor', { x, y });
  }, 33);

  setInterval(() => send('idle', powerMonitor.getSystemIdleTime()), 10000);
  setInterval(remindersTick, 1000);
}

// ---------------- IPC ----------------
function ipc() {
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a, e));

  h('init', () => ({
    settings: S.settings.data, clips: S.clips.data.items, notes: S.notes.data.items, shelf: S.shelf.data.items,
    reminders: S.reminders.data.items, weather: services.weather.get(), media: services.media.get(), lyrics: services.media.lyrics(),
    notifications: recent, agentsInstalled: services.agents.status(), telegram: services.telegram.status(),
    providers: services.ai.PROVIDERS, user: os.userInfo().username, hotkeys: registerHotkeys(),
    winSize: { w: WIN_W, h: WIN_H },
  }));

  h('weather:refresh', () => services.weather.refresh());
  h('settings:set', (data, e) => {
    const cityChanged = data.weather?.city !== S.settings.data.weather?.city;
    S.settings.data = data; S.settings.save();
    if (cityChanged) { clearTimeout(ipc.weatherT); ipc.weatherT = setTimeout(() => services.weather.refresh(), 1500); }
    applySettings();
    const hotkeys = registerHotkeys();
    // Echo only to the other windows: replacing the sender's own settings object
    // would detach the controls that are still editing it.
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('settings', data);
    return hotkeys;
  });
  h('settings:reset', (e) => {
    S.settings.data = JSON.parse(JSON.stringify(storeMod.DEFAULT_SETTINGS)); S.settings.save();
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('settings', S.settings.data);
    applySettings(); registerHotkeys();
    return S.settings.data;
  });

  ipcMain.on('shape', (e, rects, hit) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || w.isDestroyed()) return;
    // No setShape(): on a transparent window Windows leaves stale/black pixels in the
    // area a shrinking region gives up. Click-through is done with setIgnoreMouseEvents
    // against these hit rects instead (see the cursor loop).
    if (w === island) hitRects = hit || rects;
  });
  h('island:focus', () => island.focus());
  h('island:release', async () => { if (lastExternal) await helper.fast('focus', { hwnd: lastExternal.hwnd }).catch(() => {}); });
  h('island:source', () => lastExternal);

  // clipboard
  h('clip:paste', async (id) => {
    services.clips.restore(id);
    if (lastExternal) await helper.fast('paste', { hwnd: lastExternal.hwnd }).catch(() => {});
  });
  h('clip:copy', (id) => services.clips.restore(id));
  h('clip:pin', (id, on) => services.clips.pin(id, on));
  h('clip:remove', (id) => services.clips.remove(id));
  h('clip:clear', () => services.clips.clear());
  h('clip:image', (file) => nativeImage.createFromPath(file).toDataURL());
  h('text:copy', (text) => services.clips.writeText(text));
  h('text:paste', async (text) => {
    services.clips.writeText(text);
    if (lastExternal) await helper.fast('paste', { hwnd: lastExternal.hwnd }).catch(() => {});
  });
  // Grab the selected text from the last active window (Ctrl+C there).
  h('text:grab', async () => {
    if (!lastExternal) return '';
    const before = clipboard.readText();
    await helper.fast('focus', { hwnd: lastExternal.hwnd }).catch(() => {});
    await new Promise((r) => setTimeout(r, 80));
    await helper.fast('keys', { vks: [0x11, 0x43] }).catch(() => {});
    await new Promise((r) => setTimeout(r, 180));
    const t = clipboard.readText();
    island.focus();
    return t !== before ? t : '';
  });

  // media
  h('media:cmd', (action, extra) => services.media.command(action, extra));
  h('media:appVolume', () => services.media.appVolume());
  h('media:setAppVolume', (v) => services.media.setAppVolume(v));

  // notes / reminders
  h('notes:save', (items) => { S.notes.data.items = items; S.notes.save(); });
  h('reminders:add', (r) => {
    const item = { id: crypto.randomUUID(), created: Date.now(), done: false, ...r };
    S.reminders.data.items.push(item); S.reminders.save(); send('reminders', S.reminders.data.items);
    return item;
  });
  h('reminders:remove', (id) => { S.reminders.data.items = S.reminders.data.items.filter((r) => r.id !== id); S.reminders.save(); send('reminders', S.reminders.data.items); });

  // shelf
  h('shelf:add', async (paths, note) => {
    for (const p of paths) {
      if (!fs.existsSync(p) || S.shelf.data.items.some((x) => x.path === p)) continue;
      let icon = null;
      try { icon = (await app.getFileIcon(p, { size: 'normal' })).toDataURL(); } catch {}
      const st = fs.statSync(p);
      S.shelf.data.items.unshift({ id: crypto.randomUUID(), path: p, name: path.basename(p), size: st.size, dir: st.isDirectory(), icon, note: note || '', ts: Date.now() });
    }
    S.shelf.save(); send('shelf', S.shelf.data.items);
    return S.shelf.data.items;
  });
  h('shelf:remove', (id) => { S.shelf.data.items = S.shelf.data.items.filter((x) => x.id !== id); S.shelf.save(); send('shelf', S.shelf.data.items); });
  h('shelf:clear', () => { S.shelf.data.items = []; S.shelf.save(); send('shelf', []); });
  ipcMain.on('shelf:drag', (e, ids) => {
    const items = S.shelf.data.items.filter((x) => ids.includes(x.id) && fs.existsSync(x.path));
    if (!items.length) return;
    const icon = items[0].icon ? nativeImage.createFromDataURL(items[0].icon) : trayIcon();
    e.sender.startDrag({ files: items.map((x) => x.path), file: items[0].path, icon });
  });
  h('file:open', (p) => shell.openPath(p));
  h('file:reveal', (p) => shell.showItemInFolder(p));
  h('file:read', (p) => readForAI(p));
  h('file:icon', async (p) => { try { return (await app.getFileIcon(p, { size: 'normal' })).toDataURL(); } catch { return null; } });
  h('url:open', (u) => shell.openExternal(u));

  // AI
  h('ai:chat', (reqId, req, e) => { services.ai.chat(reqId, req, (ch, p) => { if (!e.sender.isDestroyed()) e.sender.send(ch, p); }); return true; });
  h('ai:abort', (reqId) => services.ai.abort(reqId));
  h('ai:ask', (prompt, files) => services.ai.ask(prompt, files));
  h('ai:transcribe', (b64, mime) => services.ai.transcribe(b64, mime));
  h('ai:ollama', () => services.ai.listOllama());
  h('ai:window', () => openAiWindow());
  h('settings:open', (section) => openSettingsWindow(section));
  h('ai:chats:get', () => S.ai.data.chats);
  h('ai:chats:save', (chats) => { S.ai.data.chats = chats.slice(0, 60); S.ai.save(); });
  h('translate', async (text, to) => {
    try { return await createAI.translate(text, to); } catch {
      return { text: await services.ai.ask(`Переведи на ${to === 'ru' ? 'русский' : to}. Верни только перевод:\n\n${text}`) };
    }
  });

  // command bar
  h('palette:apps', () => sys.apps());
  h('palette:files', (q) => sys.searchFiles(q));
  h('launch', (id) => sys.launchApp(id));
  h('currency', () => currency());

  // capture
  h('capture:start', (mode) => startCapture(mode));
  h('capture:data', () => pendingCapture);
  h('capture:cancel', () => { captureWin?.close(); });
  h('capture:done', async (res) => {
    captureWin?.close();
    const src = { app: 'Скриншот' };
    if (res.type === 'image') {
      const img = nativeImage.createFromDataURL(res.dataUrl);
      services.clips.writeImage(img, src);
      if (res.save) {
        const r = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('pictures'), `Скриншот ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`), filters: [{ name: 'PNG', extensions: ['png'] }] });
        if (!r.canceled && r.filePath) fs.writeFileSync(r.filePath, img.toPNG());
      }
      send('toast', { icon: '🖼', title: 'Изображение сохранено в буфере', ms: 2000, thumb: res.dataUrl.length < 3e6 ? res.dataUrl : null });
    } else if (res.type === 'color') {
      services.clips.writeText(res.color, { app: 'Пипетка' });
      send('toast', { icon: '🎨', title: `Цвет ${res.color} скопирован`, color: res.color, ms: 2000 });
    } else if (res.type === 'qr') {
      if (res.text) {
        services.clips.writeText(res.text, { app: 'QR-код' });
        send('toast', { icon: '▦', title: 'QR прочитан и скопирован', body: res.text.slice(0, 80), ms: 3500, url: /^https?:\/\//.test(res.text) ? res.text : null });
      } else send('toast', { icon: '▦', title: 'QR-код не найден', ms: 2000 });
    } else if (res.type === 'ocr' || res.type === 'translate') {
      try {
        const img = nativeImage.createFromDataURL(res.dataUrl);
        const o = await ocrImage(img);
        let text = (o.text || '').trim();
        if (!text) return send('toast', { icon: '🔤', title: 'Текст не найден', ms: 2000 });
        if (res.type === 'translate') {
          let tr;
          try { tr = await createAI.translate(text, 'ru'); } catch { tr = { text: await services.ai.ask(`Переведи на русский, верни только перевод:\n${text}`) }; }
          if (tr.from === 'ru') { try { tr = await createAI.translate(text, 'en'); } catch {} }
          send('ocr-result', { original: text, text: tr.text, translated: true });
          text = tr.text;
        } else send('ocr-result', { original: text, text });
        services.clips.writeText(text, { app: 'Текст со скрина' });
      } catch (e) {
        send('toast', { icon: '⚠️', title: 'OCR не сработал', body: e.message, ms: 4000 });
      }
    }
  });

  // system
  h('sys:wifi:status', () => sys.wifiStatus());
  h('sys:wifi:scan', () => sys.wifiScan());
  h('sys:wifi:connect', (ssid, pass, auth) => sys.wifiConnect(ssid, pass, auth));
  h('sys:radios', () => sys.radios());
  h('sys:radio:set', (kind, on) => sys.setRadio(kind, on));
  h('sys:bt', () => sys.btDevices());
  h('sys:vpn', () => sys.vpnList());
  h('sys:vpn:toggle', (name, on) => sys.vpnToggle(name, on));
  h('sys:dark', () => sys.darkMode());
  h('sys:dark:set', (on) => sys.setDarkMode(on));
  h('sys:power', (a) => sys.power(a));
  h('sys:volume', () => sys.volume());
  h('sys:volume:set', (v) => sys.setVolume(v));
  h('sys:mute', (on) => sys.setMute(on));
  h('sys:brightness', () => sys.brightness());
  h('sys:brightness:set', (v) => sys.setBrightness(v));
  h('sys:caffeine', (on) => {
    if (on && caffeineId == null) caffeineId = powerSaveBlocker.start('prevent-display-sleep');
    if (!on && caffeineId != null) { powerSaveBlocker.stop(caffeineId); caffeineId = null; }
    return caffeineId != null;
  });
  h('sys:caffeine:get', () => caffeineId != null);
  h('sys:dictate', async () => {
    if (lastExternal) await helper.fast('focus', { hwnd: lastExternal.hwnd }).catch(() => {});
    await new Promise((r) => setTimeout(r, 120));
    await helper.fast('keys', { vks: [0x5b, 0x48] }); // Win+H: Windows voice typing
  });
  h('sys:settings', (uri) => shell.openExternal(uri));

  // agents
  h('agents:answer', (id, answer) => services.agents.answer(id, answer));
  h('agents:dismiss', (id) => services.agents.dismiss(id));
  h('agents:status', () => services.agents.status());
  h('agents:list', () => services.agents.list());
  h('agents:install', (which) => (which === 'codex' ? services.agents.installCodex() : services.agents.installClaude()));
  h('agents:uninstall', () => services.agents.uninstallClaude());

  // telegram
  let tgAsk = null;
  services.telegramAsk = (kind, label) => new Promise((resolve) => { tgAsk = resolve; openSettingsWindow('notify'); setTimeout(() => sendAll('telegram-ask', { kind, label }), 800); });
  h('telegram:answer', (v) => { tgAsk?.(v); tgAsk = null; });
  h('telegram:start', () => services.telegram.start());
  h('telegram:logout', () => services.telegram.logout());

  h('notifications:clear', () => { recent.length = 0; });
  h('island:menu', (info) => showIslandMenu(info || {}));
  h('app:quit', () => app.quit());
  h('app:relaunch', () => { app.relaunch(); app.quit(); });
  h('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  h('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
}

// Dev aid: saves the island window as PNG and runs commands from debug-cmd.json
// ({ "send": [channel, payload] } or { "js": "code" }) so the UI can be checked headlessly.
function debugShots() {
  const dir = app.getPath('userData');
  const cmdFile = path.join(dir, 'debug-cmd.json');
  setInterval(async () => {
    let c = null;
    try {
      if (fs.existsSync(cmdFile)) {
        c = JSON.parse(fs.readFileSync(cmdFile, 'utf8'));
        fs.rmSync(cmdFile);
        if (c.send) send(c.send[0], c.send[1]);
        if (c.js) {
          const r = await island.webContents.executeJavaScript(c.js).catch((e) => 'ERR ' + e.message);
          fs.writeFileSync(path.join(dir, 'debug-js.txt'), String(typeof r === 'object' ? JSON.stringify(r) : r));
        }
      }
      const img = await island.webContents.capturePage();
      fs.writeFileSync(path.join(dir, 'debug-island.png'), img.toPNG());
      if (settingsWin && !settingsWin.isDestroyed()) {
        if (c?.setjs) {
          const r = await settingsWin.webContents.executeJavaScript(c.setjs).catch((e) => 'ERR ' + e.message);
          fs.writeFileSync(path.join(dir, 'debug-js.txt'), String(typeof r === 'object' ? JSON.stringify(r) : r));
        }
        fs.writeFileSync(path.join(dir, 'debug-settings.png'), (await settingsWin.webContents.capturePage()).toPNG());
      }
      if (captureWin && !captureWin.isDestroyed()) {
        if (c?.capjs) await captureWin.webContents.executeJavaScript(c.capjs).catch(() => {});
        const ci = await captureWin.webContents.capturePage();
        fs.writeFileSync(path.join(dir, 'debug-capture.png'), ci.resize({ width: 960 }).toPNG());
      }
    } catch (e) { fs.appendFileSync(path.join(dir, 'island.log'), 'debug ' + e.message + '\n'); }
  }, 1500);
}

// ---------------- boot ----------------
app.whenReady().then(() => {
  S = storeMod.init();
  helper.init();
  const dataDir = storeMod.dir();

  services.clips = createClipboard({ store: S.clips, dataDir, emit: send });
  services.downloads = createDownloads({ getDir: () => S.settings.data.downloadsDir, emit: send });
  services.weather = createWeather({ settings: S.settings, emit: send, notify });
  services.media = createMedia({ emit: send });
  services.ai = createAI({ settings: S.settings });
  services.agents = createAgents({
    settings: S.settings, dataDir, emit: (ch, p) => {
      send(ch, p);
      if (ch === 'agent-attention') notify({ kind: 'agent', title: p.kind === 'permission' ? `${p.project}: нужно разрешение` : p.kind === 'question' ? `${p.project}: вопрос` : `${p.project}: нужен ответ`, body: p.data?.detail || p.data?.message || p.data?.questions?.[0]?.question || '', icon: '✳', askId: p.id, sticky: p.kind !== 'notice' });
      if (ch === 'agent-done') notify({ kind: 'agent', title: `${p.project}: задача готова`, body: p.source === 'codex' ? 'Codex закончил' : 'Claude Code закончил', icon: '✅', done: true });
    },
  });
  services.telegram = createTelegram({ settings: S.settings, emit: (ch, p) => (ch === 'notification' ? notify(p) : sendAll(ch, p)), ask: (k, l) => services.telegramAsk(k, l) });
  const toasts = sys.createToastWatcher({ state: S.state, emit: notify, enabled: () => S.settings.data.notifications.windows });

  // System audio loopback for the beat-reactive edge.
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb({ video: s[0], audio: 'loopback' })).catch(() => cb({}));
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'clipboard-read', 'clipboard-sanitized-write', 'display-capture'].includes(perm)));

  ipc();
  createIsland();
  services.downloads.start();
  services.weather.start();
  services.media.start();
  services.agents.start();
  toasts.start();
  if (S.settings.data.notifications.telegram && S.settings.data.telegram.session) services.telegram.start();
  startPolling();
  applySettings();
  if (process.argv.includes('--debug-shots')) debugShots();

  tray = new Tray(trayIcon());
  tray.setToolTip('Island');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть остров', click: () => { clearTimeout(snoozeTimer); island.showInactive(); island.focus(); send('island-toggle', true); } },
    { label: 'Настройки', click: () => openSettingsWindow() },
    { label: 'Окно ИИ', click: openAiWindow },
    { type: 'separator' },
    { label: 'Перезапустить', click: () => { app.relaunch(); app.quit(); } },
    { label: 'Выход', click: () => app.quit() },
  ]));
  tray.on('click', () => { clearTimeout(snoozeTimer); island.showInactive(); island.focus(); send('island-toggle', true); });
});

app.on('second-instance', () => { island?.focus(); send('island-toggle', true); });
app.on('window-all-closed', (e) => e.preventDefault?.());
app.on('will-quit', () => { globalShortcut.unregisterAll(); helper.stop(); storeMod.flushAll(); });
