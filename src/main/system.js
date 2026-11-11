// Windows controls: Wi-Fi (netsh), VPN (rasdial), theme (registry), power,
// app launching, file search and Windows notifications.
const { execFile, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { shell } = require('electron');
const helper = require('./helper');

function run(cmd, timeout = 15000) {
  return new Promise((resolve) => {
    // chcp 65001 makes netsh/rasdial print UTF-8 instead of the OEM code page.
    exec(`chcp 65001 >nul & ${cmd}`, { windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 8e6 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: stdout || '', err: stderr || err?.message || '' });
    });
  });
}

const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// ---------- Wi-Fi ----------
async function wifiStatus() {
  const r = await run('netsh wlan show interfaces');
  const ssid = r.out.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1]?.trim() || null;
  const signal = r.out.match(/:\s*(\d+)%/)?.[1];
  return { connected: !!ssid, ssid, signal: signal ? +signal : null };
}

async function wifiScan() {
  const r = await run('netsh wlan show networks mode=bssid');
  const nets = [];
  let cur = null;
  for (const line of r.out.split(/\r?\n/)) {
    const ss = line.match(/^SSID \d+\s*:\s*(.*)$/);
    if (ss) { cur = { ssid: ss[1].trim(), signal: 0, auth: '', secure: true }; if (cur.ssid) nets.push(cur); continue; }
    if (!cur) continue;
    const sig = line.match(/:\s*(\d+)%/);
    if (sig) cur.signal = Math.max(cur.signal, +sig[1]);
    const auth = line.match(/:\s*(Open|WPA\d?-?\w*|WEP|Открыт\w*)\s*$/i);
    if (auth && !cur.auth) { cur.auth = auth[1]; cur.secure = !/open|открыт/i.test(auth[1]); }
  }
  const prof = await run('netsh wlan show profiles');
  const known = new Set([...prof.out.matchAll(/:\s*(.+)$/gm)].map((m) => m[1].trim()));
  const st = await wifiStatus();
  return nets
    .sort((a, b) => b.signal - a.signal)
    .map((n) => ({ ...n, known: known.has(n.ssid), connected: st.ssid === n.ssid }));
}

async function wifiConnect(ssid, password, auth = '') {
  if (password != null) {
    const wpa3 = /wpa3/i.test(auth);
    const open = password === '';
    const security = open
      ? '<authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption>'
      : `<authEncryption><authentication>${wpa3 ? 'WPA3SAE' : 'WPA2PSK'}</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
    <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${xmlEsc(password)}</keyMaterial></sharedKey>`;
    const xml = `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${xmlEsc(ssid)}</name>
  <SSIDConfig><SSID><name>${xmlEsc(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType><connectionMode>auto</connectionMode>
  <MSM><security>
    ${security}
  </security></MSM>
</WLANProfile>`;
    const file = path.join(os.tmpdir(), `island-wifi-${Date.now()}.xml`);
    fs.writeFileSync(file, xml, 'utf8');
    const add = await run(`netsh wlan add profile filename="${file}" user=current`);
    fs.rm(file, () => {}); // the profile file holds the password: delete right away
    if (!add.ok) return { ok: false, error: add.out || add.err };
  }
  const r = await run(`netsh wlan connect name="${ssid.replace(/"/g, '')}"`);
  if (!r.ok) return { ok: false, error: r.out || r.err, needPassword: password == null };
  for (let i = 0; i < 12; i++) {
    await new Promise((res) => setTimeout(res, 700));
    const st = await wifiStatus();
    if (st.ssid === ssid) return { ok: true };
  }
  return { ok: false, error: 'Не удалось подключиться — проверь пароль', needPassword: true };
}

// ---------- VPN (built-in Windows VPN profiles) ----------
async function vpnList() {
  const list = helper.arr(await helper.slow('vpn').catch(() => []));
  return list.map((v) => ({ ...v, connected: v.status === 'Connected' }));
}
async function vpnToggle(name, on) {
  const r = await run(on ? `rasdial "${name}"` : `rasdial "${name}" /disconnect`, 40000);
  if (!r.ok && on) {
    // Profiles without saved credentials need the Windows dialog.
    shell.openExternal('ms-settings:network-vpn');
    return { ok: false, error: 'Нужен вход — открыл настройки VPN' };
  }
  return { ok: r.ok, error: r.ok ? null : r.out };
}

// ---------- Theme ----------
const PERSONALIZE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
async function darkMode() {
  const r = await run(`reg query ${PERSONALIZE} /v AppsUseLightTheme`);
  return /0x0\b/.test(r.out);
}
async function setDarkMode(on) {
  const v = on ? 0 : 1;
  await run(`reg add ${PERSONALIZE} /v AppsUseLightTheme /t REG_DWORD /d ${v} /f`);
  await run(`reg add ${PERSONALIZE} /v SystemUsesLightTheme /t REG_DWORD /d ${v} /f`);
  return on;
}

// ---------- Power ----------
function power(action) {
  const cmds = {
    lock: ['rundll32.exe', ['user32.dll,LockWorkStation']],
    sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']],
    restart: ['shutdown.exe', ['/r', '/t', '0']],
    shutdown: ['shutdown.exe', ['/s', '/t', '0']],
    signout: ['shutdown.exe', ['/l']],
  };
  const c = cmds[action];
  if (c) execFile(c[0], c[1], { windowsHide: true });
}

// ---------- Apps & files ----------
let appsCache = { at: 0, list: [] };
async function apps() {
  if (Date.now() - appsCache.at < 10 * 60e3 && appsCache.list.length) return appsCache.list;
  const list = helper.arr(await helper.slow('startApps').catch(() => []));
  appsCache = { at: Date.now(), list: list.filter((a) => a.name && a.id) };
  return appsCache.list;
}
function launchApp(id) {
  execFile('explorer.exe', [`shell:AppsFolder\\${id}`], { windowsHide: true });
}
async function searchFiles(q) {
  if (!q || q.length < 2) return [];
  return helper.arr(await helper.slow('searchFiles', { q, limit: 8 }, 8000).catch(() => []));
}

// ---------- Windows notifications (read from the notification database) ----------
function createToastWatcher({ state, emit, enabled }) {
  const db = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
  let primed = false;
  // toast text may be plain, entity-encoded or wrapped in CDATA (OneDrive does that)
  const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  function appName(id) {
    let n = id.split('\\').pop().replace(/\.exe$/i, '');
    if (n.includes('!')) n = n.split('!').pop();
    if (/^\w+\.\w+/.test(n)) n = n.split('.').filter((x) => !/^(microsoft|windows|desktop|app)$/i.test(x)).pop() || n;
    return n;
  }
  async function poll() {
    if (!enabled() || !fs.existsSync(db)) return;
    try {
      const rows = helper.arr(await helper.fast('toasts', { db, last: state.data.lastToastId || 0 }, 4000));
      if (!rows.length) { primed = true; return; }
      const maxId = Math.max(...rows.map((r) => r.id));
      const fresh = primed && state.data.lastToastId ? rows.filter((r) => r.id > state.data.lastToastId) : [];
      state.data.lastToastId = Math.max(maxId, state.data.lastToastId || 0);
      state.save();
      primed = true;
      for (const r of fresh.reverse()) {
        const texts = [...(r.xml || '').matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decode(m[1]).trim()).filter(Boolean);
        if (!texts.length) continue;
        emit({ kind: 'windows', app: appName(r.app), logoHint: r.app, title: texts[0], body: texts.slice(1).join(' · '), at: Date.now() });
      }
    } catch {}
  }
  return { start() { setInterval(poll, 2500); poll(); } };
}

module.exports = {
  run, wifiStatus, wifiScan, wifiConnect, vpnList, vpnToggle, darkMode, setDarkMode, power,
  apps, launchApp, searchFiles, createToastWatcher,
  radios: async () => helper.arr(await helper.slow('radios').catch(() => [])),
  setRadio: (kind, on) => helper.slow('setRadio', { kind, on }),
  btDevices: async () => helper.arr(await helper.slow('btDevices', {}, 20000).catch(() => [])),
  volume: () => helper.fast('volume'),
  setVolume: (level) => helper.fast('setVolume', { level }),
  setMute: (on) => helper.fast('setMute', { on }),
  brightness: () => helper.slow('brightness').catch(() => null),
  setBrightness: (level) => helper.slow('setBrightness', { level }).catch(() => null),
};
