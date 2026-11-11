import { api, bus, state, $, h, esc, icon, wmo, countUp } from '../core.js';

let root, ctx;
const DIRS = ['С', 'ССВ', 'СВ', 'ВСВ', 'В', 'ВЮВ', 'ЮВ', 'ЮЮВ', 'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ', 'З', 'ЗСЗ', 'СЗ', 'ССЗ'];
const dirName = (d) => DIRS[Math.round(d / 22.5) % 16];
const uvText = (u) => (u < 3 ? 'Низкий' : u < 6 ? 'Умеренный' : u < 8 ? 'Высокий' : u < 11 ? 'Очень высокий' : 'Экстремальный');
const tm = (s) => new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function scene(kind) {
  const s = h('div', { class: 'scene ' + kind });
  if (kind === 'sun' || kind === 'partly') s.append(h('div', { class: 'sunball' }));
  if (kind === 'partly' || kind === 'cloud' || kind === 'rain' || kind === 'storm' || kind === 'snow' || kind === 'fog')
    for (let i = 0; i < 4; i++) s.append(h('div', { class: 'cl', style: { top: 10 + i * 28 + 'px', animationDuration: 25 + i * 9 + 's', animationDelay: -i * 7 + 's', opacity: 0.5 + i * 0.1 } }));
  if (kind === 'rain' || kind === 'storm') for (let i = 0; i < 60; i++) s.append(h('div', { class: 'drop', style: { left: Math.random() * 110 + '%', animationDelay: -Math.random() + 's', animationDuration: 0.6 + Math.random() * 0.4 + 's' } }));
  if (kind === 'storm') s.append(h('div', { class: 'flashl' }));
  if (kind === 'snow') for (let i = 0; i < 40; i++) s.append(h('div', { class: 'flake', style: { left: Math.random() * 100 + '%', animationDelay: -Math.random() * 5 + 's', animationDuration: 4 + Math.random() * 3 + 's', transform: `scale(${0.5 + Math.random()})` } }));
  if (kind === 'night') for (let i = 0; i < 40; i++) s.append(h('div', { class: 'star', style: { left: Math.random() * 100 + '%', top: Math.random() * 100 + '%', animationDelay: -Math.random() * 3 + 's' } }));
  return s;
}

function render(animate) {
  const pin = $('.pin', root);
  pin.innerHTML = '';
  const d = state.weather;
  if (!d?.current) {
    pin.append(h('div', { class: 'empty' }, 'Загружаю погоду…'), h('button', { class: 'btn sm', style: 'align-self:center', onclick: () => api.invoke('settings:open', 'weather') }, 'Указать город'));
    return;
  }
  const c = d.current, day = d.daily, hr = d.hourly;
  const info = wmo(c.weather_code, c.is_day);
  const num = (v, opts) => { const s = h('span'); if (animate) countUp(s, v, opts); else s.textContent = v.toFixed(opts?.decimals || 0) + (opts?.suffix || ''); return s; };

  // hero
  pin.append(h('div', { class: 'whero' }, scene(info.scene),
    h('div', {}, h('div', { class: 'place' }, d.place || 'Здесь'), h('div', { class: 'tbig' }, num(Math.round(c.temperature_2m), { suffix: '°' })), h('div', { class: 'cond' }, info.text)),
    h('div', { style: 'text-align:right' }, h('div', { class: 'cond' }, `↑${Math.round(day.temperature_2m_max[0])}°  ↓${Math.round(day.temperature_2m_min[0])}°`), h('div', { class: 'cond' }, `Ощущается как ${Math.round(c.apparent_temperature)}°`))));

  // rain warning (nowcast)
  const m = d.minutely_15;
  if (m) {
    const now = Date.now();
    let soon = null;
    for (let i = 0; i < m.time.length; i++) { const t = new Date(m.time[i]).getTime(); if (t > now && t - now < 3 * 3600e3 && m.precipitation[i] >= 0.1) { soon = t; break; } }
    if (soon && !(c.precipitation > 0)) pin.append(h('div', { class: 'alert' }, '🌧', `Дождь начнётся примерно в ${tm(soon)} — через ${Math.max(5, Math.round((soon - now) / 60000))} мин`));
    else if (c.precipitation > 0) pin.append(h('div', { class: 'alert' }, '☔', `Сейчас осадки: ${c.precipitation} мм`));
  }

  // hourly
  const nowIdx = Math.max(0, hr.time.findIndex((t) => new Date(t).getTime() > Date.now() - 3600e3));
  const hourly = h('div', { class: 'card', style: 'padding:8px' }, h('div', { class: 'hourly' }, ...hr.time.slice(nowIdx, nowIdx + 24).map((t, i) => {
    const k = nowIdx + i;
    const w = wmo(hr.weather_code[k], hr.is_day[k]);
    return h('div', { class: 'hour' + (i === 0 ? ' now' : '') }, h('div', { class: 'muted' }, i === 0 ? 'Сейчас' : new Date(t).getHours() + ':00'), h('div', { class: 'e' }, w.icon), h('div', { class: 'pp' }, hr.precipitation_probability[k] >= 20 ? hr.precipitation_probability[k] + '%' : ''), h('div', { style: 'font-weight:650' }, Math.round(hr.temperature_2m[k]) + '°'));
  })));
  pin.append(hourly);

  // tiles
  const tiles = h('div', { class: 'tiles stagger' });
  // wind compass
  const needle = h('div', { class: 'needle', style: { transform: `rotate(${animate ? 0 : c.wind_direction_10m}deg)` } });
  tiles.append(h('div', { class: 'tile' }, h('div', { class: 'lab', html: `${icon('wind', 12)} Ветер` }),
    h('div', { class: 'val' }, num(c.wind_speed_10m, { decimals: 1 }), h('span', { style: 'font-size:13px;font-weight:500' }, ' м/с')),
    h('div', { class: 'sub' }, `${dirName(c.wind_direction_10m)} · порывы ${Math.round(c.wind_gusts_10m || 0)} м/с`),
    h('div', { class: 'compass' }, h('span', { class: 'n', style: 'left:50%;top:3px;transform:translateX(-50%)' }, 'С'), h('span', { class: 'n', style: 'right:4px;top:50%;transform:translateY(-50%)' }, 'В'), h('span', { class: 'n', style: 'left:50%;bottom:3px;transform:translateX(-50%)' }, 'Ю'), h('span', { class: 'n', style: 'left:4px;top:50%;transform:translateY(-50%)' }, 'З'), needle)));
  // humidity
  const hum = h('div', { class: 'humfill', style: { height: animate ? '0%' : c.relative_humidity_2m + '%' } });
  tiles.append(h('div', { class: 'tile' }, hum, h('div', { class: 'lab', html: `${icon('drop', 12)} Влажность`, style: 'position:relative' }), h('div', { class: 'val', style: 'position:relative' }, num(c.relative_humidity_2m, { suffix: '%' })), h('div', { class: 'sub', style: 'position:relative' }, c.relative_humidity_2m > 75 ? 'Сыро' : c.relative_humidity_2m < 35 ? 'Сухо' : 'Комфортно')));
  // pressure gauge (mmHg)
  const mm = c.pressure_msl * 0.750062;
  const gauge = h('div', { class: 'gauge' });
  const gk = Math.max(0, Math.min(1, (mm - 720) / 70));
  tiles.append(h('div', { class: 'tile' }, h('div', { class: 'lab', html: `${icon('gauge', 12)} Давление` }), h('div', { class: 'val' }, num(Math.round(mm)), h('span', { style: 'font-size:13px;font-weight:500' }, ' мм')), h('div', { class: 'sub' }, mm < 745 ? 'Пониженное' : mm > 765 ? 'Повышенное' : 'Нормальное'), gauge));
  // sun arc
  const rise = new Date(day.sunrise[0]).getTime(), set = new Date(day.sunset[0]).getTime();
  const k = Math.max(0, Math.min(1, (Date.now() - rise) / (set - rise)));
  const ang = Math.PI * (1 - k);
  const dot = h('div');
  dot.innerHTML = `<svg viewBox="0 0 200 50" preserveAspectRatio="none"><path d="M5 48 Q100 -40 195 48" fill="none" stroke="var(--line)" stroke-width="2" stroke-dasharray="4 4"/><line x1="0" y1="48" x2="200" y2="48" stroke="var(--line)"/><circle class="dot" r="7" fill="#ffd36e" style="filter:drop-shadow(0 0 6px #ffb020)" cx="${animate ? 5 : 100 - Math.cos(ang) * 95}" cy="${animate ? 48 : 48 - Math.sin(ang) * 44}"/></svg>`;
  tiles.append(h('div', { class: 'tile' }, h('div', { class: 'lab', html: `${icon('sun', 12)} Солнце` }), h('div', { class: 'val', style: 'font-size:20px' }, `${tm(day.sunrise[0])} – ${tm(day.sunset[0])}`), h('div', { class: 'sub' }, `Световой день ${Math.floor((set - rise) / 3600e3)} ч ${Math.round(((set - rise) % 3600e3) / 60000)} мин`), h('div', { class: 'sunarc' }, dot)));
  // precipitation
  const next = hr.precipitation.slice(nowIdx, nowIdx + 12);
  const maxP = Math.max(0.5, ...next);
  const bars = h('div', { class: 'precip' }, ...next.map((p) => h('i', { style: { height: animate ? '2px' : (p / maxP) * 100 + '%' }, 'data-h': (p / maxP) * 100 + '%', title: p + ' мм' })));
  tiles.append(h('div', { class: 'tile' }, h('div', { class: 'lab', html: `${icon('drop', 12)} Осадки` }), h('div', { class: 'val' }, num(day.precipitation_sum[0], { decimals: 1 }), h('span', { style: 'font-size:13px;font-weight:500' }, ' мм')), h('div', { class: 'sub' }, `Вероятность ${day.precipitation_probability_max[0] ?? 0}% · 12 ч`), bars));
  // UV
  const uv = c.uv_index ?? day.uv_index_max[0] ?? 0;
  const uvDot = h('i', { style: { left: animate ? '0%' : Math.min(100, (uv / 11) * 100) + '%' } });
  tiles.append(h('div', { class: 'tile' }, h('div', { class: 'lab', html: `${icon('uv', 12)} УФ-индекс` }), h('div', { class: 'val' }, num(uv, { decimals: 0 })), h('div', { class: 'sub' }, `${uvText(uv)} · макс. ${Math.round(day.uv_index_max[0] || 0)}`), h('div', { class: 'uvbar' }, uvDot)));
  pin.append(tiles);

  // 7 days
  const lo = Math.min(...day.temperature_2m_min), hi = Math.max(...day.temperature_2m_max);
  const days = h('div', { class: 'card days' });
  day.time.forEach((t, i) => {
    const w = wmo(day.weather_code[i], 1);
    const l = ((day.temperature_2m_min[i] - lo) / (hi - lo || 1)) * 100, r = 100 - ((day.temperature_2m_max[i] - lo) / (hi - lo || 1)) * 100;
    const bar = h('i', { style: { left: animate ? '50%' : l + '%', right: animate ? '50%' : r + '%' }, 'data-l': l, 'data-r': r });
    days.append(h('div', { class: 'day' },
      h('div', { style: 'font-weight:600' }, i === 0 ? 'Сегодня' : new Date(t).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' })),
      h('div', { style: 'font-size:18px' }, w.icon),
      h('div', { class: 'muted', style: 'text-align:right' }, Math.round(day.temperature_2m_min[i]) + '°'),
      h('div', { class: 'range' }, bar),
      h('div', { style: 'font-weight:650' }, Math.round(day.temperature_2m_max[i]) + '°', h('div', { class: 'pp' }, day.precipitation_probability_max[i] >= 30 ? `💧${day.precipitation_probability_max[i]}%` : ''))));
  });
  pin.append(h('div', { class: 'h2' }, 'Прогноз на неделю'), days);
  pin.append(h('div', { class: 'muted small', style: 'text-align:center' }, `Open-Meteo · обновлено ${new Date(d.fetched).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`));

  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => {
    needle.style.transform = `rotate(${c.wind_direction_10m}deg)`;
    hum.style.height = c.relative_humidity_2m + '%';
    gauge.style.setProperty('--g', gk);
    const circ = dot.querySelector('circle');
    circ.setAttribute('cx', 100 - Math.cos(ang) * 95);
    circ.setAttribute('cy', 48 - Math.sin(ang) * 44);
    uvDot.style.left = Math.min(100, (uv / 11) * 100) + '%';
    for (const b of bars.children) b.style.height = b.dataset.h;
    for (const b of days.querySelectorAll('.range i')) { b.style.left = b.dataset.l + '%'; b.style.right = b.dataset.r + '%'; }
  }));
  else gauge.style.setProperty('--g', gk);
}

export default {
  id: 'weather', label: 'Погода', icon: 'weather',
  mount(el, c) {
    root = el; ctx = c;
    el.innerHTML = '<div class="pin"></div>';
    render(false);
    bus.on('weather', () => render(!!root.classList.contains('on')));
  },
  show() { render(true); },
};
