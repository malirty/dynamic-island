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
const createPhone = require('./phone');
const createWeather = require('./weather');
const createMedia = require('./media');
const createAI = require('./ai');
const createAgents = require('./agents');
const createTelegram = require('./telegram');
const createCalls = require('./calls');
const createGames = require('./games');
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
let mouseHold = false;
let ignoring = null; // click-through state of the island window

const send = (ch, payload) => { if (island && !island.isDestroyed()) island.webContents.send(ch, payload); };
const sendAll = (ch, payload) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, payload);
};

// ---------------- notifications pipeline ----------------
const recent = [];
// app logo for a notification (exe icon, found by path or by running process name)
const logoCache = new Map();
async function appLogo(hint) {
  if (!hint) return null;
  if (logoCache.has(hint)) return logoCache.get(hint);
  let exe = /\.exe$/i.test(hint) && fs.existsSync(hint) ? hint : '';
  if (!exe) {
    const name = hint.split('\\').pop().split('!')[0].split('_')[0].replace(/\.exe$/i, '').split('.').pop();
    if (/^[\w .-]+$/.test(name)) exe = (await helper.fast('procPath', { name }).catch(() => null))?.path || '';
  }
  let url = null;
  if (exe) try { url = (await app.getFileIcon(exe, { size: 'large' })).toDataURL(); } catch {}
  logoCache.set(hint, url);
  return url;
}
function notify(n) {
  if (n.logoHint && !n.logo) { // the app's badge even when the sender's picture is there (avatar + Discord badge)
    const hint = n.logoHint; delete n.logoHint;
    appLogo(hint).then((l) => notify(l ? { ...n, logo: l } : n), () => notify(n));
    return;
  }
  delete n.logoHint;
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
    const fireAt = r.at - (r.cal ? (r.before || 0) * 60e3 : 0); // a calendar event can warn a little ahead
    if (r.done || fireAt > now) continue;
    r.done = true; changed = true;
    const title = r.cal ? (r.before ? `Через ${r.before >= 60 ? r.before / 60 + ' ч' : r.before + ' мин'} · ${new Date(r.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Событие') : r.kind === 'timer' ? 'Таймер' : 'Напоминание';
    notify({ kind: 'reminder', title, body: r.text || 'Время вышло', icon: r.kind === 'timer' ? '⏱' : '🔔', sticky: true });
    if (Notification.isSupported() && !island?.isVisible()) new Notification({ title: 'Island', body: r.text || 'Таймер' }).show();
  }
  // keep finished items for a day for history
  const before = S.reminders.data.items.length;
  S.reminders.data.items = S.reminders.data.items.filter((r) => !r.done || now - r.at < (r.cal ? 60 : 1) * 86400e3); // calendar events stay visible in the past two months
  if (changed || before !== S.reminders.data.items.length) { S.reminders.save(); send('reminders', S.reminders.data.items); }
}

// ---------------- island window ----------------
// The island's window is as wide as the screen: when it grows (opening, stretching, a big photo) only its
// height changes, so the window never moves sideways under the island - moving it while the island
// animated made the island skip for a frame. Clicks still go through everywhere outside the island.
function winW() { return screen.getPrimaryDisplay().bounds.width; }
// ...and as tall as it can ever need, once and for all: a window that grew and shrank with the island
// flashed empty for a frame each time (the island vanished and came back at the end of closing). It
// stops above the taskbar, so Windows never takes it for a full-screen app.
function winH() {
  const d = screen.getPrimaryDisplay();
  return Math.max(WIN_H, Math.min(d.workArea.y + d.workArea.height - d.bounds.y, Math.round(d.bounds.height * 0.95)));
}
function primaryTop() {
  const d = screen.getPrimaryDisplay();
  return { x: d.bounds.x, y: d.bounds.y };
}

function createIsland() {
  const { x, y } = primaryTop();
  island = new BrowserWindow({
    icon: APP_ICON,
    x, y, width: winW(), height: winH(),
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    backgroundColor: '#00000000', title: 'Island',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, spellcheck: false, webviewTag: true },
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setVisibleOnAllWorkspaces(true);
  island.setIgnoreMouseEvents(true, { forward: true });
  hitRects = [{ x: Math.round(winW() / 2 - 170), y: 0, width: 340, height: 50 }];
  island.loadFile(path.join(RENDERER, 'island.html'));
  island.once('ready-to-show', () => island.showInactive());
  island.on('blur', () => { if (captureWin) return; /* put away for a screenshot: stays as it was */ send('blur'); if (process.env.ISLAND_TRACE) setTimeout(() => helper.fast('fg', {}, 3000).then((fg) => fs.appendFile(path.join(app.getPath('userData'), 'island.log'), `${new Date().toISOString()} BLUR -> ${JSON.stringify(fg)}
`, () => {})).catch(() => {}), 120); });
  // renderer warnings/errors go to %APPDATA%/Island/island.log
  const logFile = path.join(app.getPath('userData'), 'island.log');
  island.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) fs.appendFile(logFile, `${new Date().toISOString()} [${level === 3 ? 'error' : 'warn'}] ${message} (${path.basename(source || '')}:${line})\n`, () => {});
  });
  island.webContents.on('render-process-gone', (_e, d) => fs.appendFile(logFile, `${new Date().toISOString()} renderer gone: ${d.reason}\n`, () => {}));
  if (process.argv.includes('--dev')) island.webContents.openDevTools({ mode: 'detach' });
  screen.on('display-metrics-changed', () => { const p = primaryTop(); island.setBounds({ ...p, width: winW(), height: winH() }); send('win-size', { w: winW(), h: winH() }); });
}

let settingsWin = null;
function openSettingsWindow(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (section) settingsWin.webContents.send('settings-section', section);
    settingsWin.show(); settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    icon: APP_ICON,
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
    icon: APP_ICON,
    width: 760, height: 820, minWidth: 420, minHeight: 500, frame: false, transparent: true, backgroundColor: '#00000000',
    title: 'Island · ИИ', webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false, webviewTag: true },
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
  if (!src) { send('capture-hide', false); return; }
  pendingCapture = { mode, dataUrl: src.thumbnail.toDataURL(), sf, display: display.bounds };
  captureWin = new BrowserWindow({
    icon: APP_ICON,
    ...display.bounds, frame: false, transparent: false, backgroundColor: '#000000', alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, fullscreenable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false },
  });
  captureWin.setAlwaysOnTop(true, 'screen-saver');
  captureWin.setBounds(display.bounds);
  captureWin.loadFile(path.join(RENDERER, 'capture.html'));
  // the island stays away while you pick the area (it covered the screenshot, and Esc went to it
  // instead of cancelling); it comes back just as it was when the capture is done or cancelled
  const islandWasShown = island && !island.isDestroyed() && island.isVisible();
  captureWin.once('ready-to-show', () => { captureWin.show(); captureWin.focus(); if (islandWasShown) island.hide(); });
  captureWin.on('closed', () => {
    captureWin = null;
    if (islandWasShown && !island.isDestroyed()) island.showInactive();
    setTimeout(() => send('capture-hide', false), 60);
  });
}

async function ocrImage(image, lang) {
  // small screen text is read much better from an enlarged picture
  const sz = image.getSize();
  if (sz.height < 900 && sz.width * 2 < 9000) image = image.resize({ width: sz.width * 2, quality: 'best' });
  const file = path.join(os.tmpdir(), `island-ocr-${Date.now()}.png`);
  fs.writeFileSync(file, image.toPNG());
  try {
    if (lang) return await helper.slow('ocr', { path: file, lang }, 30000);
    // The profile language (often English) turns Russian into look-alike Latin letters.
    // The Russian recognizer reads both alphabets; plain Latin text goes to the English one.
    const ru = await helper.slow('ocr', { path: file, lang: 'ru' }, 30000).catch(() => null);
    const t = ru?.text || '';
    const letters = (t.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
    const cyr = (t.match(/[А-Яа-яЁё]/g) || []).length;
    if (ru && String(ru.lang || '').startsWith('ru') && (!letters || cyr / letters > 0.15)) return ru;
    const en = await helper.slow('ocr', { path: file, lang: 'en-US' }, 30000).catch(() => null);
    return en || ru || await helper.slow('ocr', { path: file }, 30000);
  } finally { fs.rm(file, () => {}); }
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
  reg(hk.palette, () => { showIsland(); island.focus(); send('palette-open'); });
  reg(hk.themeToggle, () => send('theme-toggle'));
  reg(hk.region, () => startCapture('region'));
  reg(hk.island, () => { const wasHidden = !island.isVisible(); showIsland(); island.focus(); if (!wasHidden) send('island-toggle'); });
  return result;
}

function applySettings() {
  const s = S.settings.data;
  // Run from the sources (not an installed build), Windows must start electron.exe *with the app folder*,
  // otherwise it opens Electron's empty default window instead of the island.
  const login = app.isPackaged ? { args: ['--autostart'] } : { path: process.execPath, args: [app.getAppPath(), '--autostart'] };
  app.setLoginItemSettings({ openAtLogin: !!s.island.autostart, ...login });
  services.downloads.restart();
  if (services.phone) (s.phone?.enabled !== false ? services.phone.start() : services.phone.stop());
}

// Hide the island for a while (minutes) or until called back (0).
let snoozeTimer = null;
function hideIsland(minutes) {
  clearTimeout(snoozeTimer);
  island.hide();
  if (minutes > 0) snoozeTimer = setTimeout(showIsland, minutes * 60e3);
}
function showIsland() {
  clearTimeout(snoozeTimer);
  if (island && !island.isVisible()) { island.showInactive(); setTimeout(() => send('island-shown'), 60); } // it slides back in
}

// The island's icon (assets/): the glowing pill for the tray (tray@2x.png is picked up on 200% screens),
// the full tile for windows and the taskbar.
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const APP_ICON = path.join(ASSETS, 'icon.ico');
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  return img.isEmpty() ? nativeImage.createFromPath(APP_ICON) : img;
}

// ---------------- polling ----------------
function startPolling() {
  // Foreground window: paste target, clip source, clipboard changes, fullscreen.
  let busy = false, lastKeys = null;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const fg = await helper.fast('fg', {}, 3000);
      const ours = fg.pid === process.pid || BrowserWindow.getAllWindows().some((w) => String(w.getNativeWindowHandle().readBigUInt64LE()) === fg.hwnd);
      if (!ours && fg.hwnd !== '0') { if (lastExternal && lastExternal.hwnd !== fg.hwnd) send('fg-change', fg.process || ''); lastExternal = fg; }
      services.clips.onSeq(fg.clipSeq, ours ? lastExternal : fg);
      services.games?.onForeground(fg, ours);
      // Caps Lock / Num Lock: the island shows a short note when they change (not at start)
      const keys = `${fg.caps ? 1 : 0}${fg.num ? 1 : 0}`;
      if (lastKeys !== null && keys !== lastKeys && fg.caps !== undefined) {
        if (keys[0] !== lastKeys[0] && S.settings.data.notifications?.capsLock !== false) send('lock-key', { key: 'caps', on: !!fg.caps });
        else if (keys[1] !== lastKeys[1] && S.settings.data.notifications?.numLock) send('lock-key', { key: 'num', on: !!fg.num });
      }
      lastKeys = keys;
      const full = !ours && fg.fullscreen && S.settings.data.island.hideOnFullscreen;
      if (full !== fgFullscreen) { fgFullscreen = full; send('fullscreen', full); }
    } catch {} finally { busy = false; }
  }, 450);

  // Cursor for eyes / glow / magnetic tilt, plus click-through outside the island:
  // the glow margin stays visible but clicks there reach the windows below.
  let last = '';
  ignoring = null;
  setInterval(() => {
    if (!island || island.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const b = island.getBounds();
    const x = p.x - b.x, y = p.y - b.y;
    const inside = mouseHold || hitRects.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height); // held: a drag that left the island goes on
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
  // Handlers get exactly the arguments the window sent. (Appending the IPC event after them
  // filled optional parameters with it - e.g. a shelf note - and broke cloning/saving.)
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a));
  // the few handlers that need to know which window asked: the event comes last, after padding
  const he = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { while (a.length < fn.length - 1) a.push(undefined); return fn(...a.slice(0, fn.length - 1), e); });
  // shelf entries saved by the old bug carry that event object as their note: clean them
  for (const it of S.shelf.data.items) if (typeof it.note !== 'string') it.note = '';

  h('init', () => ({
    settings: S.settings.data, clips: S.clips.data.items, notes: S.notes.data.items, shelf: S.shelf.data.items,
    reminders: S.reminders.data.items, weather: services.weather.get(), media: services.media.get(), lyrics: services.media.lyrics(),
    notifications: recent, agentsInstalled: services.agents.status(), telegram: services.telegram.status(),
    providers: services.ai.PROVIDERS, user: os.userInfo().username, hotkeys: registerHotkeys(),
    winSize: { w: winW(), h: winH() },
  }));

  h('weather:refresh', () => services.weather.refresh());
  he('settings:set', (data, e) => {
    const cityChanged = data.weather?.city !== S.settings.data.weather?.city;
    // the Telegram session belongs to the main process (it changes on sign-in); a window's older copy must never wipe it
    data.telegram = { ...(data.telegram || {}), session: S.settings.data.telegram?.session || '' };
    S.settings.data = data; S.settings.save();
    if (cityChanged) { clearTimeout(ipc.weatherT); ipc.weatherT = setTimeout(() => services.weather.refresh(), 1500); }
    applySettings();
    const hotkeys = registerHotkeys();
    // Echo only to the other windows: replacing the sender's own settings object
    // would detach the controls that are still editing it.
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('settings', data);
    return hotkeys;
  });
  he('settings:reset', (e) => {
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
  h('island:mood', (m) => send('mood-flash', { mood: m, ms: 3500 }));
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
    if (typeof note !== 'string') note = '';
    for (const p of paths || []) {
      if (!fs.existsSync(p) || S.shelf.data.items.some((x) => x.path === p)) continue;
      let icon = null;
      try { icon = (await app.getFileIcon(p, { size: 'normal' })).toDataURL(); } catch {}
      const st = fs.statSync(p);
      S.shelf.data.items.unshift({ id: crypto.randomUUID(), path: p, name: path.basename(p), size: st.size, dir: st.isDirectory(), icon, note: note || '', ts: Date.now() });
    }
    S.shelf.save(); S.shelf.flush(); send('shelf', S.shelf.data.items);
    return S.shelf.data.items;
  });
  h('shelf:remove', (id) => { S.shelf.data.items = S.shelf.data.items.filter((x) => x.id !== id); S.shelf.save(); send('shelf', S.shelf.data.items); });
  h('shelf:clear', () => { S.shelf.data.items = []; S.shelf.save(); send('shelf', []); });
  ipcMain.on('shelf:drag', (e, ids) => {
    const items = S.shelf.data.items.filter((x) => ids.includes(x.id) && fs.existsSync(x.path));
    if (!items.length) return;
    const icon = items[0].icon ? nativeImage.createFromDataURL(items[0].icon) : nativeImage.createFromPath(path.join(ASSETS, 'icon-64.png'));
    e.sender.startDrag({ files: items.map((x) => x.path), file: items[0].path, icon });
  });
  h('file:open', (p) => shell.openPath(p));
  h('file:reveal', (p) => shell.showItemInFolder(p));
  // the phone over USB
  h('phone:list', () => services.phone.list());
  h('phone:recent', (name, n) => services.phone.recent(name, n));
  // a photo shown big: the island's window grows (centred at the top) up to the screen; 0,0 = back to normal
  // while the island is being stretched it keeps the mouse, even outside its outline (else the drag broke off)
  h('island:hold', (on) => { mouseHold = !!on; if (mouseHold && ignoring) { ignoring = false; island.setIgnoreMouseEvents(false); } return true; });
  h('island:grow', (w, hh) => {
    const d = screen.getPrimaryDisplay();
    const W = d.bounds.width, H = winH(); // the window keeps its size (see winH)
    const b = island.getBounds();
    if (b.width !== W || b.height !== H || b.x !== d.bounds.x || b.y !== d.bounds.y) island.setBounds({ x: d.bounds.x, y: d.bounds.y, width: W, height: H });
    return { w: W, h: H };
  });
  // small previews made by Windows itself (fast, and they work for HEIC and videos too); a full-size
  // picture only for what the island can't show by itself (HEIC)
  const thumbCache = new Map();
  h('phone:thumb', async (p, size = 220) => {
    const key = p + '|' + size;
    if (thumbCache.has(key)) return thumbCache.get(key);
    let url = null;
    try { const img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size }); if (!img.isEmpty()) url = 'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64'); } catch {}
    if (thumbCache.size > 600) thumbCache.delete(thumbCache.keys().next().value);
    thumbCache.set(key, url);
    return url;
  });
  h('phone:import', (name) => { services.phone.importPhotos(name); return true; });
  h('phone:open', (name) => services.phone.open(name));
  h('phone:folder', (name) => shell.openPath(services.phone.folder(name)));
  h('phone:send', async (name, files) => {
    const viaTg = !name || /iphone|ipad|apple/i.test(name);
    if (viaTg && services.telegram?.status?.() !== 'on' && !S.settings.data.telegram?.session) return 'notg';
    if (!files?.length) { const r = await dialog.showOpenDialog({ title: viaTg ? 'Отправить на телефон через Telegram' : `Отправить на ${name}`, properties: ['openFile', 'multiSelections'] }); if (r.canceled) return false; files = r.filePaths; }
    if (viaTg) services.phone.sendViaTelegram(files, (f) => services.telegram.tg.sendFile('me', { path: f, asFile: true }));
    else services.phone.sendFiles(name, files);
    return true;
  });
  h('downloads:folder', () => shell.openPath(S.settings.data.downloadsDir || app.getPath('downloads')));
  h('file:read', (p) => readForAI(p));
  h('file:icon', async (p) => { try { return (await app.getFileIcon(p, { size: 'normal' })).toDataURL(); } catch { return null; } });
  h('url:open', (u) => shell.openExternal(u));

  // AI
  he('ai:chat', (reqId, req, e) => { services.ai.chat(reqId, req, (ch, p) => { if (!e.sender.isDestroyed()) e.sender.send(ch, p); }); return true; });
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
  let tgShotPeer = null;
  h('capture:cancel', () => { captureWin?.close(); tgShotPeer = null; });
  h('capture:done', async (res) => {
    captureWin?.close();
    const src = { app: 'Скриншот' };
    if (tgShotPeer) {
      const peer = tgShotPeer; tgShotPeer = null;
      if (res.type === 'image') send('tg-shot', { peer, dataUrl: res.dataUrl });
      return;
    }
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
  // per-app volume mixer
  h('sys:sessions', async () => {
    const list = helper.arr(await helper.fast('sessions', {}, 4000).catch(() => []));
    const out = new Map();
    for (const s of list) {
      const k = (s.name || '').toLowerCase();
      if (!k || s.pid === 0 || /^(audiodg|system|idle|electron)$|helper$/.test(k) || out.has(k)) continue; // skip the island itself and helper processes
      out.set(k, { ...s, icon: await appLogo(s.name).catch(() => null) });
    }
    return [...out.values()];
  });
  h('sys:appVolume', (name, level) => helper.latest('appvol:' + name, () => helper.audio('setAppVolume', { match: name, level })));
  h('sys:appMute', (name, on) => helper.audio('setAppMute', { match: name, on }));
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
  h('calls:list', () => services.calls.list());
  h('games:get', () => services.games.get());
  h('games:focus', () => { const w = services.games.hwnd(); return w ? helper.fast('focus', { hwnd: w }) : null; });
  h('calls:mic', (id) => services.calls.muteInApp(id)); // the app's own mute button / shortcut, else Windows
  h('calls:hangup', (id) => services.calls.hangup(id));
  h('calls:sound', (id) => services.calls.toggleSound(id));
  h('calls:focus', (id) => services.calls.focus(id));
  h('agents:install', (which) => (which === 'codex' ? services.agents.installCodex() : services.agents.installClaude()));
  h('agents:uninstall', () => services.agents.uninstallClaude());

  // telegram
  // sign in by QR code or phone number; the steps live in telegram.js and are pushed as 'telegram-login'
  h('telegram:login', (method, phone) => services.telegram.login(method, phone));
  h('telegram:loginState', () => services.telegram.loginState());
  h('telegram:answer', (v) => services.telegram.answer(v));
  h('telegram:cancel', () => services.telegram.cancel());
  h('telegram:start', () => services.telegram.start());
  h('telegram:logout', () => services.telegram.logout());
  // the mini Telegram on the island
  h('tg:dialogs', (n) => services.telegram.tg.dialogs(n));
  h('tg:avatar', (peer) => services.telegram.tg.avatar(peer));
  h('tg:messages', (peer, n) => services.telegram.tg.messages(peer, n));
  h('tg:send', (peer, text, replyTo) => services.telegram.tg.send(peer, text, replyTo));
  h('tg:read', (peer) => services.telegram.tg.read(peer));
  h('tg:media', (peer, id, thumb) => services.telegram.tg.media(peer, id, thumb));
  h('tg:listened', (peer, id) => services.telegram.tg.listened(peer, id));
  h('tg:status', (peer) => services.telegram.tg.status(peer));
  h('tg:me', () => services.telegram.tg.me());
  h('tg:react', (peer, id, emoji) => services.telegram.tg.react(peer, id, emoji));
  h('tg:remove', (peer, ids, revoke) => services.telegram.tg.remove(peer, ids, revoke));
  h('tg:edit', (peer, id, text) => services.telegram.tg.edit(peer, id, text));
  h('tg:forward', (from, id, to) => services.telegram.tg.forward(from, id, to));
  h('tg:transcribe', (peer, id) => services.telegram.tg.transcribe(peer, id));
  h('tg:translate', (peer, id, lang) => services.telegram.tg.translate(peer, id, lang));
  h('tg:readDate', (peer, id) => services.telegram.tg.readDate(peer, id));
  h('tg:save', async (peer, id) => {
    const f = await services.telegram.tg.download(peer, id);
    if (!f) return false;
    const r = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('downloads'), f.name) });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, f.data);
    return r.filePath;
  });
  h('tg:sendFile', (peer, f, caption, replyTo) => services.telegram.tg.sendFile(peer, f, caption, replyTo));
  h('tg:sendVoice', (peer, data, wave, replyTo) => services.telegram.tg.sendVoice(peer, data, wave, replyTo));
  // a screenshot straight into a chat: the usual area picker, the picture goes back to the island
  h('tg:screenshot', (peer) => { tgShotPeer = peer; return startCapture('region'); });

  h('notifications:clear', () => { recent.length = 0; });
  h('island:hide', (minutes) => hideIsland(+minutes || 0));
  h('app:quit', () => app.quit());
  h('app:relaunch', () => { app.relaunch(); app.quit(); });
  he('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  he('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  he('win:maximize', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.isMaximized() ? w.unmaximize() : w.maximize(); });
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
        // { "input": [[type, x, y, delayMs], ...] }: mouse events straight into the island window
        if (c.input) for (const [type, x, y, ms] of c.input) {
          island.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
          if (ms) await new Promise((r) => setTimeout(r, ms));
        }
        // { "profile": ms, "js": "..." }: a CPU profile of the island while the js runs (dev aid: where the time goes)
        if (c.profile) {
          const dbg = island.webContents.debugger;
          try { if (!dbg.isAttached()) dbg.attach('1.3'); await dbg.sendCommand('Profiler.enable'); await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 200 }); await dbg.sendCommand('Profiler.start'); } catch (e) { fs.writeFileSync(path.join(dir, 'debug-js.txt'), 'profiler: ' + e.message); }
          if (c.js) island.webContents.executeJavaScript(c.js).catch(() => {});
          await new Promise((r) => setTimeout(r, c.profile));
          try { const { profile } = await dbg.sendCommand('Profiler.stop'); fs.writeFileSync(path.join(dir, 'debug-profile.json'), JSON.stringify(profile)); dbg.detach(); } catch (e) { fs.writeFileSync(path.join(dir, 'debug-js.txt'), 'profiler stop: ' + e.message); }
          c.js = null;
        }
        if (c.js) {
          const r = await island.webContents.executeJavaScript(c.js).catch((e) => 'ERR ' + e.message);
          fs.writeFileSync(path.join(dir, 'debug-js.txt'), String(typeof r === 'object' ? JSON.stringify(r) : r));
        }
      }
      fs.writeFileSync(path.join(dir, 'debug-hit.json'), JSON.stringify({ ignoring, hitRects, cursor: screen.getCursorScreenPoint(), bounds: island.getBounds(), focused: island.isFocused() }));
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
// AI sites opened through the user's own accounts (no API keys), in their own
// persistent session; sign-in popups of those sites are allowed.
function setupAiWeb() {
  app.on('web-contents-created', (_e, wc) => {
    if (wc.getType() !== 'webview') return;
    wc.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 700, autoHideMenuBar: true, webPreferences: { partition: 'persist:aiweb' } } }));
    wc.on('did-create-window', (win) => { send('ai-popup', true); win.on('closed', () => send('ai-popup', false)); });
  });
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (_ev, prefs, params) => {
      delete prefs.preload; prefs.nodeIntegration = false; prefs.contextIsolation = true;
      params.partition = 'persist:aiweb';
    });
  });
}

app.whenReady().then(() => {
  setupAiWeb();
  S = storeMod.init();
  helper.init();
  const dataDir = storeMod.dir();

  services.clips = createClipboard({ store: S.clips, dataDir, emit: send });
  // a finished download comes with the file's own icon (an .exe shows its logo, a .zip the archive icon...)
  // Browser downloads and files coming from the phone share one list on the island.
  let dlList = [], phoneList = [];
  const dlEmit = async (ch, d) => {
    if (ch === 'downloads') { dlList = d; return send('downloads', [...phoneList, ...dlList]); }
    if (ch === 'phone-uploads') { phoneList = d; return send('downloads', [...phoneList, ...dlList]); }
    if (ch === 'download-done' && !d.folder) try { d = { ...d, icon: (await app.getFileIcon(d.path, { size: 'large' })).toDataURL() }; } catch {}
    send(ch, d);
  };
  services.downloads = createDownloads({ getDir: () => S.settings.data.downloadsDir, emit: dlEmit });
  services.phone = createPhone({ helper, state: { dir: app.getPath('userData') }, picturesDir: () => app.getPath('pictures'), emit: dlEmit, notify, log: (m) => fs.appendFile(path.join(app.getPath('userData'), 'island.log'), `${new Date().toISOString()} ${m}\n`, () => {}) });
  if (S.settings.data.phone?.enabled !== false) services.phone.start();
  services.weather = createWeather({ settings: S.settings, emit: send, notify });
  services.games = createGames({ emit: send, helper, log: (m) => fs.appendFile(path.join(app.getPath('userData'), 'island.log'), `${new Date().toISOString()} ${m}
`, () => {}) });
  services.games.start();
  services.media = createMedia({ emit: send, onVoiceStart: () => services.telegram?.guessVoice(), callProcs: () => services.calls?.procs() || [], gameProcs: () => services.games?.procs() || [], looksLikeGame: (n) => services.games?.looksLikeGame(n), log: (m) => fs.appendFile(path.join(app.getPath('userData'), 'island.log'), `${new Date().toISOString()} ${m}\n`, () => {}) });
  services.ai = createAI({ settings: S.settings });
  services.agents = createAgents({
    settings: S.settings, dataDir, emit: (ch, p) => {
      send(ch, p);
      if (ch === 'agent-attention') notify({ kind: 'agent', source: p.source, title: p.kind === 'permission' ? `${p.project}: нужно разрешение` : p.kind === 'question' ? `${p.project}: вопрос` : `${p.project}: нужен ответ`, body: p.data?.detail || p.data?.message || p.data?.questions?.[0]?.question || '', icon: '✳', askId: p.id, sticky: p.kind !== 'notice' });
      if (ch === 'agent-done') notify({ kind: 'agent', source: p.source, title: `${p.project}: задача готова`, body: p.source === 'codex' ? 'Codex закончил' : 'Claude Code закончил', icon: '✅', done: true });
    },
  });
  services.telegram = createTelegram({
    settings: S.settings, emit: (ch, p) => (ch === 'notification' ? notify(p) : sendAll(ch, p)),
    onVoice: (v) => services.media.setVoice(v), // who sent the voice message that is playing
  });
  services.calls = createCalls({ emit: send, notify });
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
  services.calls.start();
  if (S.settings.data.telegram?.session) services.telegram.start(); // also for voice-message names, even with notifications off
  startPolling();
  applySettings();
  if (process.argv.includes('--debug-shots')) debugShots();

  tray = new Tray(trayIcon());
  tray.setToolTip('Island');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть остров', click: () => { showIsland(); island.focus(); send('island-toggle', true); } },
    { label: 'Скрыть остров', click: () => hideIsland(0) },
    { label: 'Настройки', click: () => openSettingsWindow() },
    { label: 'Окно ИИ', click: openAiWindow },
    { type: 'separator' },
    { label: 'Перезапустить', click: () => { app.relaunch(); app.quit(); } },
    { label: 'Выход', click: () => app.quit() },
  ]));
  tray.on('click', () => { if (!island.isVisible()) { showIsland(); return; } island.focus(); send('island-toggle', true); });
});

app.on('second-instance', () => { showIsland(); island?.focus(); send('island-toggle', true); });
app.on('window-all-closed', (e) => e.preventDefault?.());
app.on('will-quit', () => { globalShortcut.unregisterAll(); helper.stop(); storeMod.flushAll(); });
