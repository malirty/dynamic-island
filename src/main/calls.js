// Detects voice calls by watching which apps hold the microphone (Windows keeps
// that list for its privacy indicator). Discord and Telegram open the mic only for
// calls / voice channels, so "mic in use" == "in a call". Mute works per app:
// its microphone sessions (on any recording device) and its sound output.
const helper = require('./helper');
const { app: electronApp } = require('electron');

const APPS = [
  { id: 'discord', name: 'Discord', match: 'discord', proc: 'Discord', re: /discord/i },
  { id: 'telegram', name: 'Telegram', match: 'telegram', proc: 'Telegram', re: /telegram/i },
];

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
    const app = APPS.find((a) => a.id === c.id);
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
      if (changed) publish();
    } catch {} finally { busy = false; }
  }

  return {
    start() { poll(); setInterval(poll, 1500); },
    list: () => publish(),
    async toggleMic(id) {
      const c = active.get(id); if (!c) return null;
      const app = APPS.find((a) => a.id === id);
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
      const app = APPS.find((a) => a.id === id);
      await helper.fast('setAppMute', { match: app.match, on: !c.soundMuted });
      c.soundMuted = !c.soundMuted;
      publish();
      return c;
    },
    focus(id) {
      const app = APPS.find((a) => a.id === id);
      return app ? helper.fast('focusProcess', { name: app.proc }) : null;
    },
  };
};
