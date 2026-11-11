import { api, bus, state, $, h, esc, icon, saveSettings } from '../core.js';

let root, ctx, editing = false, detail = null;
const st = { radios: [], wifi: null, vpn: [], dark: false, mute: false, volume: 0.5, brightness: null, caffeine: false };

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
  airplane: { label: 'В самолёте', icon: 'send', on: () => false, sub: () => 'Настройки', toggle: () => api.invoke('sys:settings', 'ms-settings:network-airplanemode') },
  winsettings: { label: 'Параметры', icon: 'settings', on: () => false, sub: () => 'Windows', toggle: () => api.invoke('sys:settings', 'ms-settings:') },
};

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
  const [radios, wifi, vpn, dark, vol, bri, caf] = await Promise.all([
    api.invoke('sys:radios'), api.invoke('sys:wifi:status'), api.invoke('sys:vpn'), api.invoke('sys:dark'),
    api.invoke('sys:volume').catch(() => null), api.invoke('sys:brightness'), api.invoke('sys:caffeine:get'),
  ]);
  Object.assign(st, { radios, wifi, vpn, dark, caffeine: caf, brightness: bri?.level ?? null });
  if (vol) { st.volume = vol.level; st.mute = vol.muted; }
  render();
}

function tileEl(id) {
  const t = TILES[id];
  if (!t) return null;
  const on = t.on();
  const el = h('button', { class: 'ctile' + (on ? ' on' : '') },
    h('button', { class: 'rm', html: icon('close', 11), title: 'Убрать', onclick: (e) => { e.stopPropagation(); state.settings.controlTiles = state.settings.controlTiles.filter((x) => x !== id); saveSettings(); render(); } }),
    h('div', { class: 'ci', html: icon(t.icon, 18) }),
    h('div', {}, h('div', { class: 'cl' }, t.label), h('div', { class: 'cs' }, t.sub())),
    t.more ? h('span', { class: 'more ibtn', title: 'Подробнее', html: icon('chevron', 14), onclick: (e) => { e.stopPropagation(); openDetail(t.more); } }) : '');
  el.onclick = async () => {
    if (editing) return;
    el.classList.add('busy');
    await t.toggle();
    el.classList.remove('busy');
    render();
  };
  return el;
}

function slider(iconName, value, onInput, title) {
  const s = h('input', { type: 'range', class: 'slider', min: 0, max: 1, step: 0.01, value, title });
  s.style.setProperty('--v', value);
  let t;
  s.oninput = () => { s.style.setProperty('--v', s.value); clearTimeout(t); t = setTimeout(() => onInput(+s.value), 30); };
  return h('div', { class: 'sl' }, h('span', { class: 'icw', html: icon(iconName, 18) }), s);
}

function render() {
  const pin = $('.pin', root);
  pin.innerHTML = '';
  if (detail) return renderDetail(pin);
  pin.append(h('div', { class: 'h2' }, 'Центр управления', h('span', { class: 'sp' }), h('button', { class: 'btn sm ghost', onclick: () => { editing = !editing; render(); } }, editing ? 'Готово' : 'Изменить')));
  const grid = h('div', { class: 'cc' + (editing ? ' editing' : '') });
  for (const id of state.settings.controlTiles) { const e = tileEl(id); if (e) grid.append(e); }
  pin.append(grid);
  if (editing) {
    const rest = Object.keys(TILES).filter((id) => !state.settings.controlTiles.includes(id));
    pin.append(h('div', { class: 'h2' }, 'Добавить'), h('div', { class: 'addable' }, ...rest.map((id) => h('button', { class: 'btn sm', onclick: () => { state.settings.controlTiles.push(id); saveSettings(); render(); } }, icon('plus', 12), TILES[id].label))));
  }
  const sl = [];
  if (state.settings.controlSliders.includes('volume')) sl.push(slider(st.mute ? 'mute' : 'volume', st.volume, (v) => { st.volume = v; api.invoke('sys:volume:set', v); }, 'Громкость системы'));
  if (state.settings.controlSliders.includes('brightness') && st.brightness != null) sl.push(slider('brightness', st.brightness / 100, (v) => api.invoke('sys:brightness:set', Math.round(v * 100)), 'Яркость'));
  if (sl.length) pin.append(h('div', { class: 'sliders' }, ...sl));
  const pw = h('div', { class: 'powerrow' });
  const confirmBtn = (b, action) => {
    if (b.classList.contains('confirm')) return api.invoke('sys:power', action);
    b.classList.add('confirm');
    const old = b.lastChild.textContent;
    b.lastChild.textContent = 'Точно?';
    setTimeout(() => { b.classList.remove('confirm'); b.lastChild.textContent = old; }, 3000);
  };
  for (const [a, label, ic, danger] of [['lock', 'Блокировка', 'lock'], ['sleep', 'Сон', 'sleep'], ['restart', 'Перезагрузка', 'restart', 1], ['shutdown', 'Выключение', 'power', 1]]) {
    const b = h('button', { class: 'pbtn' + (danger ? ' danger' : ''), html: `${icon(ic, 16)}<span>${label}</span>` });
    b.onclick = () => (danger || a === 'sleep' ? confirmBtn(b, a) : api.invoke('sys:power', a));
    pw.append(b);
  }
  pin.append(pw);
}

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
        // ask for the password inline
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
}

async function connect(n, password) {
  ctx.flash({ icon: '📶', title: `Подключаюсь к ${n.ssid}…`, ms: 2500 });
  const r = await api.invoke('sys:wifi:connect', n.ssid, password, n.auth);
  if (r.ok) { ctx.flash({ icon: '✅', title: `Подключено: ${n.ssid}`, ms: 2000 }); ctx.mood('mood-happy', 1500); }
  else ctx.flash({ icon: '⚠️', title: r.error?.slice(0, 80) || 'Не удалось подключиться', ms: 3000 });
  scanWifi();
  refresh();
}

export default {
  id: 'control', label: 'Центр', icon: 'control',
  mount(el, c) {
    root = el; ctx = c;
    el.innerHTML = '<div class="pin"></div>';
    render();
    bus.on('settings', () => { if (root.classList.contains('on')) render(); });
  },
  show() { detail = null; editing = false; render(); refresh(); },
};
