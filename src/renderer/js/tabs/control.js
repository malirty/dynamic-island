// Control center, iOS style: connectivity cluster, now playing, focus, big
// vertical sliders, quick actions, per-app volume mixer, custom tiles, power.
import { api, bus, state, $, h, esc, icon, mediaIcon, saveSettings } from '../core.js';
import { QUICK } from './home.js';

let root, ctx, editing = false, detail = null;
const st = { radios: [], wifi: null, vpn: [], dark: false, mute: false, volume: 0.5, brightness: null, caffeine: false, apps: [] };

export const TILES = {
  wifi: { label: 'Wi-Fi', icon: 'wifi', on: () => radio('WiFi'), sub: () => (radio('WiFi') ? st.wifi?.ssid || 'Не подключено' : 'Выкл.'), toggle: () => setRadio('WiFi'), more: 'wifi' },
  bluetooth: { label: 'Bluetooth', icon: 'bluetooth', on: () => radio('Bluetooth'), sub: () => (radio('Bluetooth') ? 'Вкл.' : 'Выкл.'), toggle: () => setRadio('Bluetooth'), more: 'bt' },
  vpn: { label: 'VPN', icon: 'vpn', on: () => st.vpn.some((v) => v.connected), sub: () => st.vpn.find((v) => v.connected)?.name || (st.vpn.length ? 'Не подключено' : 'Нет профилей'), toggle: () => toggleVpn(), more: 'vpn' },
  darkmode: { label: 'Тёмная тема', icon: 'moon', on: () => st.dark, sub: () => 'Windows', toggle: async () => { st.dark = await api.invoke('sys:dark:set', !st.dark); } },
  dnd: { label: 'Не беспокоить', icon: 'belloff', on: () => !!state.settings.dnd, sub: () => (state.settings.dnd ? 'Остров молчит' : 'Выкл.'), toggle: () => { state.settings.dnd = !state.settings.dnd; return saveSettings(); } },
  mute: { label: 'Без звука', icon: 'mute', on: () => st.mute, sub: () => (st.mute ? 'Звук выключен' : 'Выкл.'), toggle: async () => { st.mute = !st.mute; await api.invoke('sys:mute', st.mute); } },
  caffeine: { label: 'Не засыпать', icon: 'coffee', on: () => st.caffeine, sub: () => (st.caffeine ? 'Экран не гаснет' : 'Выкл.'), toggle: async () => { st.caffeine = await api.invoke('sys:caffeine', !st.caffeine); } },
  islandTheme: { label: 'Тема острова', icon: 'theme', on: () => state.settings.theme.mode === 'light', sub: () => (state.settings.theme.mode === 'light' ? 'Светлая' : 'Тёмная'), toggle: () => document.dispatchEvent(new CustomEvent('island-theme')) },
  screenshot: { label: 'Скриншот', icon: 'region', on: () => false, sub: () => 'Область', toggle: () => api.invoke('capture:start', 'region') },
  hotspot: { label: 'Хот-спот', icon: 'hotspot', on: () => false, sub: () => 'Настройки', toggle: () => api.invoke('sys:settings', 'ms-settings:network-mobilehotspot') },
  nightlight: { label: 'Ночной свет', icon: 'sun', on: () => false, sub: () => 'Настройки', toggle: () => api.invoke('sys:settings', 'ms-settings:nightlight') },
  airplane: { label: 'В самолёте', icon: 'plane', on: () => false, sub: () => 'Настройки', toggle: () => api.invoke('sys:settings', 'ms-settings:network-airplanemode') },
  winsettings: { label: 'Параметры', icon: 'settings', on: () => false, sub: () => 'Windows', toggle: () => api.invoke('sys:settings', 'ms-settings:') },
  sound: { label: 'Звук', icon: 'volume', on: () => false, sub: () => 'Устройства', toggle: () => api.invoke('sys:settings', 'ms-settings:sound') },
  display: { label: 'Экран', icon: 'brightness', on: () => false, sub: () => 'Настройки', toggle: () => api.invoke('sys:settings', 'ms-settings:display') },
};
// these live in the fixed blocks above, so they're not repeated among the tiles
const DEFAULT_QUICK = ['region', 'color', 'qr', 'timer'];
export const CC_DEFAULTS = {
  ccBlocks: { net: true, media: true, focus: true, squares: true, sliders: true, quick: true, tiles: true, mixer: true, power: true },
  ccNet: ['wifi', 'bluetooth', 'vpn', 'mute'],
  ccSquares: ['darkmode', 'caffeine'],
  ccPower: ['lock', 'sleep', 'restart', 'shutdown'],
};
export const TOGGLE_IDS = ['wifi', 'bluetooth', 'vpn', 'mute', 'darkmode', 'caffeine', 'dnd', 'islandTheme', 'screenshot', 'airplane', 'hotspot', 'nightlight'];
const opt = (k) => state.settings[k] ?? CC_DEFAULTS[k];
const block = (k) => (state.settings.ccBlocks || {})[k] !== false;
const COLOR = { wifi: 'blue', bluetooth: 'blue', vpn: 'teal', mute: 'red', dnd: 'violet', darkmode: 'violet', caffeine: 'amber' };
const fixedIds = () => [...(block('net') ? opt('ccNet') : []), ...(block('squares') ? opt('ccSquares') : []), ...(block('focus') ? ['dnd'] : [])];

const radio = (kind) => st.radios.find((r) => r.kind === kind)?.state === 'On';
async function setRadio(kind) {
  const on = !radio(kind);
  const r = st.radios.find((x) => x.kind === kind);
  if (r) r.state = on ? 'On' : 'Off';
  render();
  try { await api.invoke('sys:radio:set', kind, on); } catch (e) { ctx.flash({ icon: '⚠️', title: 'Windows не дал переключить', ms: 2000 }); }
  setTimeout(refresh, 1200);
}
async function toggleVpn() {
  if (!st.vpn.length) return api.invoke('sys:settings', 'ms-settings:network-vpn');
  const cur = st.vpn.find((v) => v.connected) || st.vpn[0];
  const r = await api.invoke('sys:vpn:toggle', cur.name, !cur.connected);
  if (!r.ok && r.error) ctx.flash({ icon: '🛡', title: r.error, ms: 2500 });
  setTimeout(refresh, 800);
}

async function refresh() {
  const [radios, wifi, vpn, dark, vol, bri, caf, apps] = await Promise.all([
    api.invoke('sys:radios'), api.invoke('sys:wifi:status'), api.invoke('sys:vpn'), api.invoke('sys:dark'),
    api.invoke('sys:volume').catch(() => null), api.invoke('sys:brightness'), api.invoke('sys:caffeine:get'),
    api.invoke('sys:sessions').catch(() => []),
  ]);
  Object.assign(st, { radios, wifi, vpn, dark, caffeine: caf, brightness: bri?.level ?? null, apps: apps || [] });
  if (vol) { st.volume = vol.level; st.mute = vol.muted; }
  render();
}
async function refreshApps() {
  st.apps = await api.invoke('sys:sessions').catch(() => st.apps);
  const box = $('.ccmix-list', root);
  if (box && !box.matches(':hover')) renderMixer(box);
}

// ---------- building blocks ----------
const throttle = (fn, ms) => { let t = 0, last; return (v) => { last = v; if (t) return; t = setTimeout(() => { t = 0; fn(last); }, ms); }; };

// tall iOS slider: drag or scroll anywhere on it
function vslider(ic, value, onChange, label) {
  const fill = h('div', { class: 'vfill' });
  const pct = h('span', { class: 'vpct' });
  const el = h('div', { class: 'vsl', title: label }, fill, pct, h('span', { class: 'vic', html: icon(ic, 20) }));
  const send = throttle(onChange, 40);
  let v = value;
  const set = (nv, user) => {
    v = Math.max(0, Math.min(1, nv));
    fill.style.height = (v * 100).toFixed(1) + '%';
    pct.textContent = Math.round(v * 100);
    if (user) send(v);
  };
  set(v);
  el.onpointerdown = (e) => {
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const r = el.getBoundingClientRect();
    const mv = (ev) => set(1 - (ev.clientY - r.top) / r.height, true);
    mv(e);
    el.onpointermove = mv;
    el.onpointerup = el.onlostpointercapture = () => { el.onpointermove = null; el.classList.remove('drag'); };
  };
  el.onwheel = (e) => { e.preventDefault(); set(v - Math.sign(e.deltaY) * 0.04, true); };
  return el;
}

function round(id, cls = '') {
  const t = TILES[id];
  const on = t.on();
  const b = h('button', { class: 'rbtn ' + cls + (on ? ' on' : ''), title: t.label, html: icon(t.icon, 20) });
  b.onclick = async (e) => { e.stopPropagation(); b.classList.add('busy'); await t.toggle(); b.classList.remove('busy'); render(); };
  b.oncontextmenu = (e) => { if (t.more) { e.preventDefault(); e.stopPropagation(); openDetail(t.more); } };
  return h('div', { class: 'rcell' }, b,
    h('button', { class: 'rlab', title: t.more ? 'Подробнее' : '', onclick: () => t.more && openDetail(t.more) },
      h('b', {}, t.label, t.more ? h('span', { class: 'rch', html: icon('chevron', 10) }) : ''), h('small', {}, t.sub())));
}

function netBlock() {
  return h('div', { class: 'ccb ccnet' }, ...opt('ccNet').filter((id) => TILES[id]).slice(0, 4).map((id) => round(id, COLOR[id] || 'blue')));
}

function mediaBlock() {
  const m = state.media;
  if (!m?.active) return h('div', { class: 'ccb ccmedia empty' }, h('span', { class: 'icw', html: icon('note', 26) }), h('div', { class: 'muted small' }, 'Сейчас ничего не играет'));
  const btn = (c, ic, big) => h('button', { class: 'mbtn' + (big ? ' big' : ''), html: mediaIcon(ic, big ? 22 : 18), onclick: () => api.invoke('media:cmd', c) });
  return h('div', { class: 'ccb ccmedia' },
    h('div', { class: 'mbg', style: { backgroundImage: m.thumb ? `url('${m.thumb}')` : '' } }),
    h('div', { class: 'mtop' }, h('div', { class: 'mart', style: { backgroundImage: m.thumb ? `url('${m.thumb}')` : '' } }),
      h('div', { class: 'grow', style: 'min-width:0' }, h('div', { class: 'mt' }, m.title || ''), h('div', { class: 'ma' }, m.artist || m.app || ''))),
    h('div', { class: 'mctl' }, btn('prev', 'prev'), btn('toggle', m.playing ? 'pause' : 'play', 1), btn('next', 'next')));
}

function focusBlock() {
  const on = !!state.settings.dnd;
  return h('button', { class: 'ccb ccfocus' + (on ? ' on' : ''), onclick: async () => { await TILES.dnd.toggle(); render(); } },
    h('span', { class: 'fi', html: icon(on ? 'belloff' : 'moon', 18) }),
    h('div', {}, h('b', {}, 'Не беспокоить'), h('small', {}, on ? 'Уведомления не тревожат' : 'Выключено')));
}

function square(id) {
  const t = TILES[id];
  const on = t.on();
  return h('button', { class: 'ccb ccsq' + (on ? ' on' : ''), title: t.label, onclick: async () => { await t.toggle(); render(); } },
    h('span', { class: 'si', html: icon(t.icon, 20) }), h('small', {}, t.label));
}

function quickBlock() {
  const ids = (state.settings.controlQuick || DEFAULT_QUICK).filter((id) => QUICK[id] && !QUICK[id].toggle).slice(0, 4);
  return h('div', { class: 'ccb ccquick' }, ...ids.map((id) => h('button', { class: 'qb', title: QUICK[id].label, onclick: () => { ctx.collapse(false); setTimeout(() => QUICK[id].run(ctx), 120); } },
    h('span', { html: icon(QUICK[id].icon, 19) }), h('small', {}, QUICK[id].label))));
}

function niceName(n) {
  const map = { msedge: 'Edge', chrome: 'Chrome', firefox: 'Firefox', spotify: 'Spotify', discord: 'Discord', telegram: 'Telegram', yandex: 'Яндекс', browser: 'Яндекс', vlc: 'VLC', steam: 'Steam' };
  return map[n.toLowerCase()] || n.charAt(0).toUpperCase() + n.slice(1);
}
function renderMixer(box) {
  box.innerHTML = '';
  const apps = (st.apps || []).filter((a) => a.name);
  if (!apps.length) { box.append(h('div', { class: 'empty' }, 'Сейчас никакие приложения не играют звук')); return; }
  for (const a of apps) {
    const r = h('input', { type: 'range', class: 'slider', min: 0, max: 1, step: 0.01, value: a.volume });
    r.style.setProperty('--v', a.volume);
    const send = throttle((v) => api.invoke('sys:appVolume', a.name, v), 50);
    r.oninput = () => { r.style.setProperty('--v', r.value); a.volume = +r.value; send(+r.value); };
    const mb = h('button', { class: 'ibtn' + (a.muted ? ' muted' : ''), title: a.muted ? 'Включить звук' : 'Заглушить', html: icon(a.muted ? 'mute' : 'volume', 15) });
    mb.onclick = async () => { a.muted = !a.muted; await api.invoke('sys:appMute', a.name, a.muted); renderMixer(box); };
    box.append(h('div', { class: 'mixrow' + (a.muted ? ' muted' : '') },
      a.icon ? h('img', { class: 'mixic', src: a.icon }) : h('span', { class: 'mixic fb' }, niceName(a.name)[0]),
      h('span', { class: 'mixn' }, niceName(a.name)), r, mb));
  }
}

function tileEl(id) {
  const t = TILES[id];
  if (!t) return null;
  const on = t.on();
  const el = h('button', { class: 'ctile sm' + (on ? ' on' : '') },
    h('button', { class: 'rm', html: icon('close', 11), title: 'Убрать', onclick: (e) => { e.stopPropagation(); state.settings.controlTiles = state.settings.controlTiles.filter((x) => x !== id); saveSettings(); render(); } }),
    h('div', { class: 'ci', html: icon(t.icon, 16) }),
    h('div', { style: 'min-width:0' }, h('div', { class: 'cl' }, t.label), h('div', { class: 'cs' }, t.sub())));
  el.onclick = async () => {
    if (editing) return;
    el.classList.add('busy');
    await t.toggle();
    el.classList.remove('busy');
    render();
  };
  return el;
}

function render() {
  const pin = $('.pin', root);
  pin.innerHTML = '';
  if (detail) return renderDetail(pin);
  pin.append(h('div', { class: 'h2' }, 'Центр управления', h('span', { class: 'sp' }), h('button', { class: 'btn sm ghost', onclick: () => { editing = !editing; render(); } }, editing ? 'Готово' : 'Изменить')));

  const sl = state.settings.controlSliders || [];
  const grid = h('div', { class: 'cc2' },
    block('net') ? netBlock() : '', block('media') ? mediaBlock() : '', block('focus') ? focusBlock() : '',
    ...(block('squares') ? opt('ccSquares').filter((id) => TILES[id]).slice(0, 2).map(square) : []),
    block('sliders') && sl.includes('volume') ? vslider(st.mute ? 'mute' : 'volume', st.volume, (v) => { st.volume = v; api.invoke('sys:volume:set', v); }, 'Громкость') : '',
    block('sliders') && sl.includes('brightness') && st.brightness != null ? vslider('brightness', st.brightness / 100, (v) => api.invoke('sys:brightness:set', Math.round(v * 100)), 'Яркость') : '',
    block('quick') ? quickBlock() : '');
  pin.append(grid);

  // custom tiles
  const ids = state.settings.controlTiles.filter((id) => TILES[id] && !fixedIds().includes(id));
  if (block('tiles') && (ids.length || editing)) {
    const tiles = h('div', { class: 'cc' + (editing ? ' editing' : '') }, ...ids.map(tileEl));
    pin.append(tiles);
  }
  if (editing) {
    const rest = Object.keys(TILES).filter((id) => !fixedIds().includes(id) && !ids.includes(id));
    const quick = state.settings.controlQuick || DEFAULT_QUICK;
    pin.append(
      h('div', { class: 'h2' }, 'Добавить плитку'),
      h('div', { class: 'addable' }, ...rest.map((id) => h('button', { class: 'btn sm', onclick: () => { state.settings.controlTiles.push(id); saveSettings(); render(); } }, icon('plus', 12), TILES[id].label))),
      h('div', { class: 'h2' }, 'Быстрые действия (до 4)'),
      h('div', { class: 'addable' }, ...Object.entries(QUICK).filter(([, q]) => !q.toggle).map(([id, q]) => h('button', {
        class: 'btn sm' + (quick.includes(id) ? ' pri' : ''),
        onclick: () => {
          const cur = [...(state.settings.controlQuick || DEFAULT_QUICK)];
          state.settings.controlQuick = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-4);
          saveSettings(); render();
        },
      }, icon(q.icon, 12), q.label))));
  }

  // per-app volume
  if (block('mixer')) {
    const mix = h('div', { class: 'ccmix-list' });
    renderMixer(mix);
    pin.append(h('div', { class: 'ccb ccmix' }, h('div', { class: 'h3' }, h('span', { html: icon('volume', 14) }), 'Громкость приложений'), mix));
  }

  // power
  const pw = h('div', { class: 'powerrow' });
  const confirmBtn = (b, action) => {
    if (b.classList.contains('confirm') || state.settings.ccConfirm === false) return api.invoke('sys:power', action);
    b.classList.add('confirm');
    const lab = b.querySelector('span');
    const old = lab.textContent;
    lab.textContent = 'Точно?';
    setTimeout(() => { b.classList.remove('confirm'); lab.textContent = old; }, 3000);
  };
  const power = opt('ccPower');
  pw.style.gridTemplateColumns = `repeat(${Math.max(1, power.length)}, 1fr)`;
  for (const [a, label, ic, danger] of POWER.filter(([a]) => power.includes(a))) {
    const b = h('button', { class: 'pbtn' + (danger ? ' danger' : ''), html: `${icon(ic, 16)}<span>${label}</span>` });
    b.onclick = () => (danger || a === 'sleep' ? confirmBtn(b, a) : api.invoke('sys:power', a));
    pw.append(b);
  }
  if (block('power') && power.length) pin.append(pw);
  ctx.resize?.();
}
export const POWER = [['lock', 'Блокировка', 'lock'], ['sleep', 'Сон', 'sleep'], ['restart', 'Перезагрузка', 'restart', 1], ['shutdown', 'Выключение', 'power', 1]];

function openDetail(kind) { detail = kind; render(); if (kind === 'wifi') scanWifi(); if (kind === 'bt') loadBt(); if (kind === 'vpn') refresh(); }

let nets = null, bt = null, scanning = false;
async function scanWifi() { scanning = true; render(); nets = await api.invoke('sys:wifi:scan'); scanning = false; render(); }
async function loadBt() { bt = null; render(); bt = await api.invoke('sys:bt'); render(); }

function sig(p) { const n = Math.ceil(p / 25); return h('div', { class: 'sig' }, ...[4, 7, 10, 13].map((ht, i) => h('i', { class: i < n ? 'f' : '', style: { height: ht + 'px' } }))); }

function renderDetail(pin) {
  const back = h('button', { class: 'btn sm ghost', onclick: () => { detail = null; render(); } }, icon('back', 12), 'Назад');
  if (detail === 'wifi') {
    pin.append(h('div', { class: 'row' }, back, h('div', { class: 'h2 grow' }, 'Wi-Fi'), h('button', { class: 'btn sm', onclick: scanWifi }, scanning ? 'Ищу…' : 'Обновить'), h('div', { class: 'toggle' + (radio('WiFi') ? ' on' : ''), onclick: () => setRadio('WiFi').then(scanWifi) })));
    const list = h('div', { class: 'card sub' });
    if (!nets) list.append(h('div', { class: 'empty' }, 'Сканирую сети…'));
    else if (!nets.length) list.append(h('div', { class: 'empty' }, 'Сети не найдены'));
    else for (const n of nets) {
      const row = h('div', { class: 'net' + (n.connected ? ' on' : '') }, sig(n.signal), h('div', { class: 'grow' }, h('div', { style: 'font-weight:600;font-size:13px' }, n.ssid), h('div', { class: 'muted small' }, n.connected ? 'Подключено' : n.known ? 'Сохранена' : n.secure ? 'Защищена' : 'Открытая')), n.secure ? h('span', { class: 'icw muted', html: icon('lock', 13) }) : '');
      row.onclick = async () => {
        if (n.connected) return;
        if (n.known || !n.secure) return connect(n, n.secure ? undefined : '');
        if (row.nextSibling?.classList?.contains('pw')) return;
        const pass = h('input', { class: 'field grow', type: 'password', placeholder: 'Пароль сети', style: 'height:30px' });
        const box = h('div', { class: 'row pw', style: 'padding:4px 10px 8px' }, pass, h('button', { class: 'btn sm pri', onclick: () => connect(n, pass.value) }, 'Подключить'));
        pass.onkeydown = (e) => { if (e.key === 'Enter') connect(n, pass.value); };
        row.after(box);
        pass.focus();
        ctx.resize();
      };
      list.append(row);
    }
    pin.append(list);
  } else if (detail === 'bt') {
    pin.append(h('div', { class: 'row' }, back, h('div', { class: 'h2 grow' }, 'Bluetooth'), h('div', { class: 'toggle' + (radio('Bluetooth') ? ' on' : ''), onclick: () => setRadio('Bluetooth').then(loadBt) })));
    const list = h('div', { class: 'card sub' });
    if (!bt) list.append(h('div', { class: 'empty' }, 'Загружаю устройства…'));
    else if (!bt.length) list.append(h('div', { class: 'empty' }, 'Нет сопряжённых устройств'));
    else for (const d of bt) list.append(h('div', { class: 'net' + (d.connected ? ' on' : ''), onclick: () => api.invoke('sys:settings', 'ms-settings:bluetooth') },
      h('span', { class: 'icw', html: icon(/audio/i.test(d.kind) ? 'volume' : 'bluetooth', 16) }), h('div', { class: 'grow' }, h('div', { style: 'font-weight:600;font-size:13px' }, d.name), h('div', { class: 'muted small' }, d.connected ? 'Подключено' : 'Не подключено'))));
    pin.append(list, h('div', { class: 'muted small' }, 'Подключение конкретного устройства Windows разрешает только из своих настроек — нажми на устройство, откроются параметры Bluetooth.'));
  } else if (detail === 'vpn') {
    pin.append(h('div', { class: 'row' }, back, h('div', { class: 'h2 grow' }, 'VPN'), h('button', { class: 'btn sm', onclick: () => api.invoke('sys:settings', 'ms-settings:network-vpn') }, 'Настроить')));
    const list = h('div', { class: 'card sub' });
    if (!st.vpn.length) list.append(h('div', { class: 'empty' }, 'Нет VPN-профилей Windows. Добавь профиль в параметрах — и он появится здесь, включение в одно нажатие.'));
    for (const v of st.vpn) list.append(h('div', { class: 'net' + (v.connected ? ' on' : '') },
      h('span', { class: 'icw', html: icon('vpn', 16) }), h('div', { class: 'grow' }, h('div', { style: 'font-weight:600;font-size:13px' }, v.name), h('div', { class: 'muted small' }, (v.connected ? 'Подключено · ' : '') + (v.server || ''))),
      h('div', { class: 'toggle' + (v.connected ? ' on' : ''), onclick: async (e) => { e.currentTarget.classList.toggle('on'); const r = await api.invoke('sys:vpn:toggle', v.name, !v.connected); if (!r.ok && r.error) ctx.flash({ icon: '🛡', title: r.error, ms: 2500 }); refresh(); } })));
    pin.append(list);
  }
  ctx.resize?.();
}

async function connect(n, password) {
  ctx.flash({ icon: '📶', title: `Подключаюсь к ${n.ssid}…`, ms: 2500 });
  const r = await api.invoke('sys:wifi:connect', n.ssid, password, n.auth);
  if (r.ok) { ctx.flash({ icon: '✅', title: `Подключено: ${n.ssid}`, ms: 2000 }); ctx.mood('mood-joy', 1500); }
  else ctx.flash({ icon: '⚠️', title: r.error?.slice(0, 80) || 'Не удалось подключиться', ms: 3000 });
  scanWifi();
  refresh();
}

let mixTimer = null;
export default {
  id: 'control', label: 'Центр', icon: 'control',
  mount(el, c) {
    root = el; ctx = c;
    el.innerHTML = '<div class="pin"></div>';
    render();
    bus.on('settings', () => { if (root.classList.contains('on')) render(); });
    // now-playing block follows the track
    let mk = '';
    bus.on('media', (m) => {
      const k = `${m?.key}|${m?.playing}|${m?.thumb ? 1 : 0}|${m?.active}`;
      if (k === mk || !root.classList.contains('on') || detail) return;
      mk = k;
      const old = $('.ccmedia', root);
      if (old) old.replaceWith(mediaBlock());
    });
  },
  show() {
    detail = null; editing = false; render(); refresh();
    clearInterval(mixTimer);
    mixTimer = setInterval(() => { if (!root.classList.contains('on')) { clearInterval(mixTimer); return; } refreshApps(); }, 3000);
  },
};
