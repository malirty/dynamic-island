// Detects voice calls by watching which apps hold the microphone (Windows keeps
// that list for its privacy indicator). Discord and Telegram open the mic only for
// calls / voice channels, so "mic in use" == "in a call". Mute works per app:
// its microphone sessions (on any recording device) and its sound output.
const helper = require('./helper');
const { app: electronApp } = require('electron');

const APPS = [
  { id: 'discord', name: 'Discord', match: 'discord', proc: 'Discord', re: /discord/i },
  { id: 'telegram', name: 'Telegram', match: 'telegram', proc: 'Telegram', re: /telegram/i },
  { id: 'zoom', name: 'Zoom', match: 'zoom', proc: 'Zoom', re: /zoom/i },
  { id: 'teams', name: 'Teams', match: 'teams', proc: 'ms-teams', re: /teams/i },
  { id: 'skype', name: 'Skype', match: 'skype', proc: 'Skype', re: /skype/i },
  { id: 'whatsapp', name: 'WhatsApp', match: 'whatsapp', proc: 'WhatsApp', re: /whatsapp/i },
  { id: 'viber', name: 'Viber', match: 'viber', proc: 'Viber', re: /viber/i },
  { id: 'slack', name: 'Slack', match: 'slack', proc: 'slack', re: /slack/i },
];
// Calls in a browser (Google Meet, Teams, Телемост…): the browser holds the mic, and the
// window title (the open tab) tells the site. If the call's tab isn't in front, it's "Звонок в Chrome".
const BROWSERS = [
  { proc: 'chrome', name: 'Chrome', re: /chrome\.exe$/i },
  { proc: 'msedge', name: 'Edge', re: /msedge\.exe$/i },
  { proc: 'firefox', name: 'Firefox', re: /firefox\.exe$/i },
  { proc: 'browser', name: 'Яндекс Браузер', re: /yandex.*browser\.exe$/i },
  { proc: 'opera', name: 'Opera', re: /opera\.exe$/i },
  { proc: 'brave', name: 'Brave', re: /brave\.exe$/i },
  { proc: 'vivaldi', name: 'Vivaldi', re: /vivaldi\.exe$/i },
];
const SITES = [
  [/google meet|^meet\b|meet\.google/i, 'Google Meet'], [/microsoft teams|\bteams\b/i, 'Teams'], [/телемост|telemost/i, 'Телемост'],
  [/zoom/i, 'Zoom'], [/discord/i, 'Discord'], [/telegram/i, 'Telegram'], [/whatsapp/i, 'WhatsApp'], [/jitsi/i, 'Jitsi'],
  [/vk\s*(звонки|calls)|звонок vk/i, 'VK Звонки'], [/skype/i, 'Skype'], [/webex/i, 'Webex'], [/whereby/i, 'Whereby'], [/slack/i, 'Slack'],
];

// How to control each app from the island: press its own button (UI Automation) or its shortcut.
// Button names are matched in English and Russian. Without a way in, the mic is muted by Windows.
const K = { ctrl: 0x11, shift: 0x10, alt: 0x12, a: 0x41, d: 0x44, e: 0x45, h: 0x48, m: 0x4d, q: 0x51, space: 0x20 };
const keys = (...k) => k.map((x) => K[x]);
// only exact call phrases: a loose "Выйти" / "Завершить" could hit "log out" or "end other sessions",
// and Discord's "Откл. звук" is deafen, not the microphone
const MUTE_NAMES = ['^(un)?mute( microphone| mic)?$', '^(turn (off|on)|mute|unmute) (the )?microphone', '^микрофон$', '^(вкл|выкл|откл)\\w*\\.? ?микрофон', '^(выключить|включить) микрофон'];
const HANGUP_NAMES = ['^(end|leave) (call|meeting|huddle)$', '^hang up$', '^leave call', '^завершить (звонок|вызов|встречу|конференцию)', '^покинуть (звонок|встречу|видеовстречу|конференцию)', '^выйти из (звонка|встречи|конференции)', '^положить трубку$'];
const CONTROL = {
  zoom: { mute: { keys: keys('alt', 'a') }, hangup: { keys: keys('alt', 'q'), stay: true, confirm: true } }, // Zoom asks to confirm leaving
  discord: { mute: { uia: MUTE_NAMES, keys: keys('ctrl', 'shift', 'm') }, hangup: { uia: ['^disconnect$', '^отключиться'] } },
  telegram: { mute: { uia: MUTE_NAMES }, hangup: { uia: HANGUP_NAMES } },
  teams: { mute: { keys: keys('ctrl', 'shift', 'm') }, hangup: { keys: keys('ctrl', 'shift', 'h') } },
  skype: { mute: { keys: keys('ctrl', 'm') }, hangup: { uia: HANGUP_NAMES } },
  slack: { mute: { keys: keys('ctrl', 'shift', 'space') }, hangup: { uia: HANGUP_NAMES } },
  whatsapp: { mute: { uia: MUTE_NAMES }, hangup: { uia: HANGUP_NAMES } },
  viber: { mute: { uia: MUTE_NAMES }, hangup: { uia: HANGUP_NAMES } },
};
// calls in a browser, by site (the call's own window gets the shortcut)
const WEB = {
  'Google Meet': { mute: { uia: ['^(turn (off|on) microphone|выключить микрофон|включить микрофон)'], keys: keys('ctrl', 'd') }, hangup: { uia: ['^leave call', '^покинуть (встречу|видеовстречу|звонок)', '^выйти из (звонка|встречи)'] } },
  Teams: { mute: { keys: keys('ctrl', 'shift', 'm') }, hangup: { keys: keys('ctrl', 'shift', 'h') } },
  Zoom: { mute: { keys: keys('alt', 'a') }, hangup: { uia: HANGUP_NAMES } },
};
const WEB_DEFAULT = { mute: { uia: MUTE_NAMES }, hangup: { uia: HANGUP_NAMES } };

// A pressed "Mute" switch means the mic is off; a pressed "Unmute" / "Turn on microphone" switch means it is on
function isMutedSwitch(name, state) {
  const on = state === 'On';
  return /^un|unmute|^включить|turn on/.test(name) ? !on : on;
}

module.exports = function createCalls({ emit, notify }) {
  const active = new Map(); // id -> { id, name, since, micMuted, soundMuted }
  let busy = false;

  function publish() { emit('calls', [...active.values()]); }

  // The app's real logo, taken from its .exe (the mic list stores the path with '#' for '\';
  // Store apps store a package name instead, then we ask the running process).
  const icons = new Map();
  async function iconFor(appDef, entry) {
    let exe = entry && entry.includes('#') ? entry.replace(/#/g, '\\') : '';
    if (!exe) exe = (await helper.fast('procPath', { name: appDef.proc }).catch(() => null))?.path || '';
    if (!exe) return null;
    try {
      const url = (await electronApp.getFileIcon(exe, { size: 'large' })).toDataURL();
      icons.set(appDef.id, url);
      return url;
    } catch { return null; }
  }

  async function refreshMutes(c) {
    const app = APPS.find((a) => a.id === c.id) || (c.id.startsWith('web:') ? { match: c.id.slice(4) } : null);
    if (!app) return;
    const [mic, snd] = await Promise.all([
      helper.fast('appMicMute', { match: app.match }).catch(() => null),
      helper.fast('appMute', { match: app.match }).catch(() => null),
    ]);
    if (mic) c.micMuted = !!mic.muted;
    if (snd) c.soundMuted = !!snd.muted;
  }

  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const users = helper.arr(await helper.fast('micUsers', {}, 5000));
      const now = Date.now();
      let changed = false;
      for (const app of APPS) {
        const inCall = users.some((u) => app.re.test(u));
        if (inCall && !active.has(app.id)) {
          const c = { id: app.id, name: app.name, since: now, micMuted: false, soundMuted: false, icon: icons.get(app.id) || null };
          active.set(app.id, c);
          await refreshMutes(c);
          if (!c.icon) c.icon = await iconFor(app, users.find((u) => app.re.test(u)));
          notify({ kind: 'call', app: app.name, title: `Звонок в ${app.name}`, body: 'Управление звонком — на острове', icon: '📞', thumb: c.icon || undefined });
          changed = true;
        } else if (!inCall && active.has(app.id)) {
          const c = active.get(app.id);
          active.delete(app.id);
          // don't leave the app muted after the call
          if (c.micMuted) helper.fast('setAppMicMute', { match: app.match, on: false }).catch(() => {});
          if (c.soundMuted) helper.fast('setAppMute', { match: app.match, on: false }).catch(() => {});
          changed = true;
        }
      }
      // browser calls
      for (const b of BROWSERS) {
        const id = 'web:' + b.proc;
        const entry = users.find((u) => b.re.test(u.replace(/#/g, '\\')));
        if (entry) {
          const wins = helper.arr(await helper.fast('windowTitles', { name: b.proc }, 3000).catch(() => []));
          let site = null, hwnd = 0;
          for (const w of wins) { const s = SITES.find(([re]) => re.test(w.title || '')); if (s) { site = s[1]; hwnd = w.hwnd; break; } }
          const prev = active.get(id);
          const name = site || prev?.site || `Звонок в ${b.name}`;
          if (!prev) {
            const c = { id, name, site, browser: b.name, since: now, micMuted: false, soundMuted: false, hwnd, icon: icons.get(id) || null };
            active.set(id, c);
            await refreshMutes(c);
            if (!c.icon) { c.icon = await iconFor({ id, proc: b.proc }, entry); }
            notify({ kind: 'call', app: name, title: site ? `Звонок в ${site}` : name, body: site ? `в ${b.name} — управление на острове` : 'Управление звонком — на острове', icon: '📞', thumb: c.icon || undefined });
            changed = true;
          } else if (site && (prev.site !== site || prev.hwnd !== hwnd)) { prev.site = site; prev.name = site; prev.hwnd = hwnd; changed = true; }
        } else if (active.has(id)) {
          const c = active.get(id);
          active.delete(id);
          if (c.micMuted) helper.fast('setAppMicMute', { match: b.proc, on: false }).catch(() => {});
          if (c.soundMuted) helper.fast('setAppMute', { match: b.proc, on: false }).catch(() => {});
          changed = true;
        }
      }
      if (changed) publish();
    } catch {} finally { busy = false; }
  }
  // Zoom: read its toolbar every few seconds so the island's mic icon matches Zoom's own
  let zoomBusy = false;
  async function zoomWindow() {
    const wins = helper.arr(await helper.fast('windowTitles', { name: 'Zoom' }, 3000).catch(() => []));
    return (wins.find((w) => w.cls === 'ConfMultiTabContentWndClass') || wins.find((w) => /meeting|конференц|встреч/i.test(w.title)) || {}).hwnd || 0;
  }
  setInterval(async () => {
    const c = active.get('zoom');
    if (!c || zoomBusy) return;
    zoomBusy = true;
    try {
      const hwnd = await zoomWindow();
      if (!hwnd) return;
      const r = await helper.slow('zoomMic', { hwnd }, 8000).catch(() => null);
      if (r?.state === 'muted' || r?.state === 'on') {
        const m = r.state === 'muted';
        if (c.micMuted !== m) { c.micMuted = m; publish(); }
      }
    } finally { zoomBusy = false; }
  }, 2500);
  // Apps with a mic switch (Discord): read its real state every few seconds, so a mute made in the app
  // itself shows on the island too. A call whose app has no readable switch is left alone after a few tries.
  let switchBusy = false;
  setInterval(async () => {
    if (switchBusy) return;
    switchBusy = true;
    try {
      for (const c of active.values()) {
        if (c.id === 'zoom' || (c.switchMiss || 0) >= 3) continue;
        const plan = (c.id.startsWith('web:') ? WEB[c.site] || WEB_DEFAULT : CONTROL[c.id])?.mute;
        const t = target(c.id);
        if (!plan?.uia || !t) continue;
        const r = await helper.slow('uiaToggle', { proc: t.proc, hwnd: c.id.startsWith('web:') ? c.hwnd || 0 : 0, names: plan.uia }, 8000).catch(() => null);
        if (!r?.found || (r.state !== 'On' && r.state !== 'Off')) { c.switchMiss = (c.switchMiss || 0) + 1; continue; }
        c.switchMiss = 0;
        const m = isMutedSwitch((r.name || '').toLowerCase(), r.state);
        if (c.micMuted !== m) { c.micMuted = m; c.inApp = true; publish(); }
      }
    } finally { switchBusy = false; }
  }, 2500);
  // run "mute" / "hangup" for a call: its button first, then its shortcut
  async function act(c, what) {
    const t = target(c.id);
    const plan = (c.id.startsWith('web:') ? WEB[c.site] || WEB_DEFAULT : CONTROL[c.id])?.[what];
    if (!t || !plan) return { ok: false };
    let hwnd = c.hwnd || 0;
    if (!hwnd && c.id === 'zoom') hwnd = await zoomWindow(); // the meeting window, not Zoom's home window
    if (plan.uia) {
      const r = await helper.slow('uiaPress', { proc: t.proc, hwnd: c.id.startsWith('web:') ? hwnd : 0, names: plan.uia }, 15000).catch(() => null);
      if (r?.ok) return { ok: true, how: 'button', name: r.name, toggle: r.toggle };
    }
    if (plan.keys) {
      const r = await helper.fast('sendKeys', { proc: t.proc, hwnd, vks: plan.keys, stay: !!plan.stay }, 5000).catch(() => null);
      if (r?.ok) return { ok: true, how: 'keys', confirm: !!plan.confirm };
    }
    return { ok: false };
  }
  // what to mute / focus for a call: a desktop app, or a browser
  function target(id) {
    const app = APPS.find((a) => a.id === id);
    if (app) return { match: app.match, proc: app.proc };
    const b = BROWSERS.find((x) => 'web:' + x.proc === id);
    return b ? { match: b.proc, proc: b.proc } : null;
  }

  return {
    start() { poll(); setInterval(poll, 1500); },
    list: () => publish(),
    // processes that are on a call right now (their sound is the call, not "music")
    procs: () => [...active.keys()].map((id) => (target(id)?.proc || '').toLowerCase()).filter(Boolean),
    // mute inside the app itself (its own mic button), so the app shows it too
    async muteInApp(id) {
      const c = active.get(id); if (!c) return null;
      const r = await act(c, 'mute');
      if (r.ok) {
        // a pressed button says which way it went ("Mute" -> now muted, "Unmute" -> now on); a shortcut can't
        const n = (r.name || '').toLowerCase();
        if (r.toggle === 'On' || r.toggle === 'Off') c.micMuted = isMutedSwitch(n, r.toggle); // a switch (Discord): its real state
        else if (/^un|unmute|^включить|turn on/.test(n)) c.micMuted = false;
        else if (/mute|выключить|выкл|откл|turn off/.test(n)) c.micMuted = true;
        else c.micMuted = !c.micMuted;
        c.inApp = true; publish(); return c;
      }
      return this.toggleMic(id); // no way in: Windows mutes this app's microphone
    },
    async hangup(id) {
      const c = active.get(id); if (!c) return { ok: false };
      const r = await act(c, 'hangup');
      if (!r.ok) await this.focus(id); // couldn't find the button: at least open the call
      return { ok: r.ok, confirm: !!r.confirm, how: r.how };
    },
    async toggleMic(id) {
      const c = active.get(id); if (!c) return null;
      const app = target(id);
      const r = await helper.fast('setAppMicMute', { match: app.match, on: !c.micMuted });
      if (!r?.count) {
        // the app has no separate mic session: fall back to the default microphone
        const m = await helper.fast('setMicMute', { on: !c.micMuted });
        c.micMuted = !!m?.muted;
      } else c.micMuted = !c.micMuted;
      publish();
      return c;
    },
    async toggleSound(id) {
      const c = active.get(id); if (!c) return null;
      const app = target(id);
      await helper.fast('setAppMute', { match: app.match, on: !c.soundMuted });
      c.soundMuted = !c.soundMuted;
      publish();
      return c;
    },
    focus(id) {
      const c = active.get(id);
      if (c?.hwnd) return helper.fast('focus', { hwnd: c.hwnd }); // the browser window with the call
      const t = target(id);
      return t ? helper.fast('focusProcess', { name: t.proc }) : null;
    },
  };
};
