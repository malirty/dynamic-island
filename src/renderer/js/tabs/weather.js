import { api, bus, state, $, h, esc, icon, wmo, countUp } from '../core.js';

let root, ctx;
const DIRS = ['С', 'ССВ', 'СВ', 'ВСВ', 'В', 'ВЮВ', 'ЮВ', 'ЮЮВ', 'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ', 'З', 'ЗСЗ', 'СЗ', 'ССЗ'];
const dirName = (d) => DIRS[Math.round(d / 22.5) % 16];
const uvText = (u) => (u < 3 ? 'Низкий' : u < 6 ? 'Умеренный' : u < 8 ? 'Высокий' : u < 11 ? 'Очень высокий' : 'Экстремальный');
const tm = (s) => new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// ---------------- the live sky behind the header (like the iPhone Weather app) ----------------
// One canvas: a sky gradient for the weather and time of day (warm near sunrise / sunset),
// soft layered clouds drifting at different speeds, rain streaks, snow, stars with the moon,
// the sun with its glow and a lens flare, lightning. It only draws while it is on screen.
const PAL = {
  sun: [['#2a74cf', '#7fbdf2'], ['#0a1430', '#24366e']],
  partly: [['#3a70b3', '#94bde6'], ['#0d1733', '#2a3a66']],
  cloud: [['#5b6c82', '#9eabbc'], ['#161d2b', '#323c50']],
  fog: [['#6d7886', '#a9b1bc'], ['#1d232c', '#3f4752']],
  rain: [['#34475d', '#6e8298'], ['#111a26', '#2a3849']],
  storm: [['#20262f', '#4a5464'], ['#0c1017', '#262d3a']],
  snow: [['#6f87a8', '#b9c9de'], ['#1a2335', '#3c4a63']],
  night: [['#050b20', '#1c2858'], ['#050b20', '#1c2858']],
};
const mix = (a, b, k) => {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',')})`;
};
// a cloud = many puffs with a flat-ish base, blurred together and lit from above;
// drawn once into its own little canvas
function makeCloud(w, h, tone, alpha) {
  const pad = Math.round(h * 0.35);
  const c = document.createElement('canvas');
  c.width = w + pad * 2; c.height = h + pad * 2;
  const g = c.getContext('2d');
  g.filter = `blur(${Math.max(4, h * 0.09).toFixed(1)}px)`;
  const base = pad + h * 0.78;
  const n = 14 + Math.floor(Math.random() * 8);
  for (let i = 0; i < n; i++) {
    const u = Math.random();
    const x = pad + w * (0.08 + u * 0.84);
    const hump = Math.sin(u * Math.PI); // taller in the middle
    const r = h * (0.16 + 0.3 * hump * (0.6 + Math.random() * 0.4));
    const y = base - r * (0.55 + Math.random() * 0.5) * (0.6 + hump * 0.6);
    const gr = g.createRadialGradient(x, y - r * 0.35, r * 0.05, x, y, r);
    gr.addColorStop(0, `rgba(${tone},${alpha})`);
    gr.addColorStop(0.7, `rgba(${tone},${alpha * 0.85})`);
    gr.addColorStop(1, `rgba(${tone},${alpha * 0.5})`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // a darker, flat underside
  g.globalCompositeOperation = 'source-atop';
  const sh = g.createLinearGradient(0, pad, 0, base + 4);
  sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(0.55, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(40,50,70,0.22)');
  g.filter = 'none'; g.fillStyle = sh; g.fillRect(0, 0, c.width, c.height);
  c.pad = pad;
  return c;
}
function liveSky(cv, kind, isDay, glow) {
  const g = cv.getContext('2d');
  const R = Math.random;
  let W = 0, H = 0, dpr = 1, raf = 0, last = performance.now(), flash = 0, nextFlash = performance.now() + 3000, bolt = null;
  const night = !isDay;
  const [top, bot] = PAL[kind]?.[night ? 1 : 0] || PAL.cloud[0];
  // clouds: how many, what colour, how dense
  const cloudy = { partly: 5, cloud: 11, rain: 12, storm: 12, snow: 8, fog: 6 }[kind] || 0;
  const tone = night ? '150,165,195' : kind === 'rain' || kind === 'storm' ? '200,210,225' : '255,255,255';
  const alpha = night ? 0.22 : kind === 'storm' ? 0.42 : kind === 'rain' ? 0.5 : kind === 'partly' ? 0.85 : 0.6;
  let clouds = [], drops = [], flakes = [], stars = [];
  function setup() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    clouds = Array.from({ length: cloudy }, (_, i) => {
      const layer = i % 3; // far, middle, near: bigger and faster in front
      let w = (160 + R() * 160) * (0.7 + layer * 0.3), h = w * 0.42;
      const img = makeCloud(Math.round(w), Math.round(h), tone, alpha * (0.6 + layer * 0.2));
      if (kind === 'fog') { w *= 2.2; h *= 0.7; } // long low haze
      return { img, x: R() * (W + w) - w, y: (kind === 'partly' ? 0.05 : -0.15) * H + R() * H * (kind === 'fog' ? 0.9 : 0.55), w, h, v: 4 + layer * 5 + R() * 3 };
    });
    drops = kind === 'rain' || kind === 'storm' ? Array.from({ length: kind === 'storm' ? 140 : 100 }, () => ({ x: R() * W, y: R() * H, l: 8 + R() * 12, v: 380 + R() * 260, a: 0.25 + R() * 0.35 })) : [];
    flakes = kind === 'snow' ? Array.from({ length: 80 }, () => ({ x: R() * W, y: R() * H, r: 0.8 + R() * 2.4, v: 14 + R() * 26, ph: R() * 6.28 })) : [];
    stars = night ? Array.from({ length: kind === 'night' ? 90 : 30 }, () => ({ x: R() * W, y: R() * H * 0.8, r: 0.4 + R() * 1.1, ph: R() * 6.28, sp: 0.8 + R() * 2 })) : [];
  }
  function frame(t) {
    if (!cv.isConnected) return; // the tab was re-rendered: this sky is gone
    // not on screen: sleep, and look again a couple of times a second (it ran 144 times a second for nothing)
    if (document.hidden || !cv.closest('.page.on') || !cv.closest('#island[data-view="open"]')) { raf = 0; setTimeout(() => { if (!raf) raf = requestAnimationFrame(frame); }, 400); last = 0; return; }
    raf = requestAnimationFrame(frame);
    if (last && t - last < 15) return; // at most 60 frames a second, on any monitor
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    if (cv.clientWidth !== W || cv.clientHeight !== H) setup();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // sky
    const sk = g.createLinearGradient(0, 0, 0, H);
    sk.addColorStop(0, top);
    sk.addColorStop(1, glow > 0 ? mix(bot, '#f2a66b', glow * 0.75) : bot);
    g.fillStyle = sk; g.fillRect(0, 0, W, H);
    if (glow > 0) { // the warm band low on the horizon around sunrise / sunset
      const hz = g.createRadialGradient(W * 0.5, H * 1.25, 10, W * 0.5, H * 1.25, W * 0.8);
      hz.addColorStop(0, `rgba(255,170,110,${0.55 * glow})`); hz.addColorStop(1, 'rgba(255,170,110,0)');
      g.fillStyle = hz; g.fillRect(0, 0, W, H);
    }
    // stars and the moon
    for (const s of stars) {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 1000 * s.sp + s.ph));
      g.fillStyle = `rgba(255,255,255,${a * (kind === 'night' ? 1 : 0.5)})`;
      g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.28); g.fill();
    }
    if (kind === 'night') {
      const mx = W * 0.84, my = H * 0.28, mr = 15;
      const mg = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 5);
      mg.addColorStop(0, 'rgba(220,230,255,.35)'); mg.addColorStop(1, 'rgba(220,230,255,0)');
      g.fillStyle = mg; g.beginPath(); g.arc(mx, my, mr * 5, 0, 6.28); g.fill();
      // a full moon with soft grey patches (seas), lit a bit more on one side
      const md = g.createRadialGradient(mx - 4, my - 4, 2, mx, my, mr);
      md.addColorStop(0, '#fbfcff'); md.addColorStop(1, '#d9e0f2');
      g.fillStyle = md; g.beginPath(); g.arc(mx, my, mr, 0, 6.28); g.fill();
      g.fillStyle = 'rgba(150,160,190,.28)';
      [[-4, -3, 4], [4, 2, 3.2], [-1, 6, 2.4], [6, -6, 1.8]].forEach(([dx, dy, r]) => { g.beginPath(); g.arc(mx + dx, my + dy, r, 0, 6.28); g.fill(); });
    }
    // the sun: a bright core, a wide glow, slowly turning rays and a lens flare
    if (!night && (kind === 'sun' || kind === 'partly')) {
      const sx = W * 0.84, sy = H * 0.12;
      const sg = g.createRadialGradient(sx, sy, 0, sx, sy, W * 0.45);
      sg.addColorStop(0, 'rgba(255,250,225,.95)'); sg.addColorStop(0.08, 'rgba(255,240,190,.75)'); sg.addColorStop(0.3, 'rgba(255,225,150,.18)'); sg.addColorStop(1, 'rgba(255,225,150,0)');
      g.fillStyle = sg; g.fillRect(0, 0, W, H);
      g.save(); g.translate(sx, sy); g.rotate(t / 30000);
      for (let i = 0; i < 12; i++) { g.rotate(Math.PI / 6); g.fillStyle = 'rgba(255,245,210,.06)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 0.5, -10); g.lineTo(W * 0.5, 10); g.fill(); }
      g.restore();
      [[0.35, 14, 0.1], [0.55, 7, 0.14], [0.8, 22, 0.06]].forEach(([k, r, a]) => {
        const fx = sx + (W * 0.35 - sx) * k, fy = sy + (H * 0.9 - sy) * k;
        g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(fx, fy, r, 0, 6.28); g.fill();
      });
    }
    // clouds drift right, the near ones faster
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > W + 20) c.x = -c.w - R() * 60;
      const k = c.w / (c.img.width - c.img.pad * 2); // the canvas has a margin for the blur
      g.drawImage(c.img, c.x - c.img.pad * k, c.y - c.img.pad * k, c.img.width * k, c.img.height * k);
    }
    // rain
    if (drops.length) {
      g.lineCap = 'round'; g.lineWidth = 1.1;
      for (const d of drops) {
        d.y += d.v * dt; d.x += d.v * 0.12 * dt;
        if (d.y > H + 20) { d.y = -20; d.x = R() * W * 1.1 - W * 0.1; }
        g.strokeStyle = `rgba(210,225,245,${d.a})`;
        g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x - d.l * 0.12, d.y - d.l); g.stroke();
      }
    }
    // snow falls slowly and sways
    for (const f of flakes) {
      f.y += f.v * dt; f.ph += dt;
      if (f.y > H + 5) { f.y = -5; f.x = R() * W; }
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.beginPath(); g.arc(f.x + Math.sin(f.ph) * 8 * (f.r / 3), f.y, f.r, 0, 6.28); g.fill();
    }
    // lightning: now and then a bolt and a flash of the whole sky
    if (kind === 'storm') {
      if (t > nextFlash) {
        flash = 1; nextFlash = t + 4000 + R() * 6000;
        let x = W * (0.2 + R() * 0.6), y = 0; bolt = [[x, y]];
        while (y < H * 0.85) { x += (R() - 0.5) * 26; y += 10 + R() * 16; bolt.push([x, y]); }
      }
      if (flash > 0) {
        g.fillStyle = `rgba(235,240,255,${flash * 0.45})`; g.fillRect(0, 0, W, H);
        if (bolt && flash > 0.5) { g.strokeStyle = `rgba(255,255,255,${flash})`; g.lineWidth = 2; g.beginPath(); bolt.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
        flash -= dt * 3;
      }
    }
  }
  setup();
  raf = requestAnimationFrame(frame);
}

// a one-line outlook like the iPhone's: what changes next, or that it stays like this
function outlook(d) {
  const hr = d.hourly, c = d.current;
  const idx = hr.time.findIndex((t) => new Date(t).getTime() > Date.now());
  const cur = wmo(c.weather_code, c.is_day).text;
  if (idx >= 0) for (let k = idx; k < Math.min(hr.time.length, idx + 12); k++) {
    const w = wmo(hr.weather_code[k], hr.is_day[k]).text;
    if (w !== cur) return `${w} около ${new Date(hr.time[k]).getHours()}:00. Ощущается как ${Math.round(c.apparent_temperature)}°.`;
  }
  return `${cur} в ближайшие часы. Ощущается как ${Math.round(c.apparent_temperature)}°.`;
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

  // hero: like the iPhone Weather app - centred, a thin huge temperature, a live sky behind it
  const rise0 = new Date(day.sunrise[0]).getTime(), set0 = new Date(day.sunset[0]).getTime(), nowT = Date.now();
  const nearSun = Math.min(Math.abs(nowT - rise0), Math.abs(nowT - set0));
  const glow = nearSun < 75 * 60e3 && info.scene !== 'storm' ? 1 - nearSun / (75 * 60e3) : 0; // golden hour
  const sky = h('canvas', { class: 'sky' });
  const light = c.is_day && ['snow', 'fog'].includes(info.scene); // a pale sky: the text needs more shadow
  pin.append(h('div', { class: 'whero ios' + (c.is_day ? '' : ' nightsky') + (light ? ' pale' : '') }, sky,
    h('div', { class: 'wtop' },
      h('div', { class: 'place' }, d.place || 'Здесь'),
      h('div', { class: 'tbig' }, num(Math.round(c.temperature_2m)), h('span', { class: 'deg' }, '°')),
      h('div', { class: 'cond' }, info.text),
      h('div', { class: 'hilo' }, `Макс.: ${Math.round(day.temperature_2m_max[0])}°, мин.: ${Math.round(day.temperature_2m_min[0])}°`)),
    h('div', { class: 'wnote' }, outlook(d))));
  requestAnimationFrame(() => liveSky(sky, info.scene, !!c.is_day, glow));

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
  const hv = c.relative_humidity_2m;
  const uid = 'hd' + Math.random().toString(36).slice(2, 8);
  const DROP = 'M30 3C30 3 7 31 7 48a23 23 0 0 0 46 0C53 31 30 3 30 3z';
  const WAVE = 'M-60 6 q15 -6 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 V90 H-60z';
  const hum = h('div', { class: 'humdrop', style: { '--lv': animate ? 0 : hv / 100 }, html: `<svg viewBox="0 0 60 76" width="58" height="72"><defs><clipPath id="${uid}"><path d="${DROP}"/></clipPath><linearGradient id="${uid}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#2b6be0"/></linearGradient></defs><g clip-path="url(#${uid})"><rect width="60" height="76" fill="rgba(120,190,255,.08)"/><g class="hwater"><path class="hw2" d="${WAVE}" fill="rgba(150,210,255,.45)"/><path class="hw1" d="${WAVE}" fill="url(#${uid}g)"/></g></g><path d="${DROP}" fill="none" stroke="rgba(140,200,255,.6)" stroke-width="2"/><ellipse cx="21" cy="40" rx="3" ry="7" fill="rgba(255,255,255,.35)" transform="rotate(20 21 40)"/></svg>` });
  tiles.append(h('div', { class: 'tile humtile' }, h('div', { class: 'lab', html: `${icon('drop', 12)} Влажность` }), h('div', { class: 'val' }, num(hv, { suffix: '%' })),
    h('div', { class: 'sub' }, hv > 75 ? 'Сыро — воздух влажный' : hv < 35 ? 'Сухо — пей воду' : 'Комфортно'), c.dew_point_2m != null ? h('div', { class: 'sub' }, `Точка росы ${Math.round(c.dew_point_2m)}°`) : '', hum));
  // pressure gauge (mmHg)
  const mm = c.pressure_msl * 0.750062;
  const gauge = h('div', { class: 'gauge' });
  const gk = Math.max(0, Math.min(1, (mm - 720) / 70));
  tiles.append(h('div', { class: 'tile' }, h('div', { class: 'lab', html: `${icon('gauge', 12)} Давление` }), h('div', { class: 'val' }, num(Math.round(mm)), h('span', { style: 'font-size:13px;font-weight:500' }, ' мм')), h('div', { class: 'sub' }, mm < 745 ? 'Пониженное' : mm > 765 ? 'Повышенное' : 'Нормальное'), gauge));
  // sun arc
  const rise = new Date(day.sunrise[0]).getTime(), set = new Date(day.sunset[0]).getTime();
  // position along the dashed arc (a quadratic curve from sunrise on the left to sunset on the right)
  const now = Date.now();
  const k = Math.max(0, Math.min(1, (now - rise) / (set - rise)));
  // the arc: (10,48) -> control (100,-24) -> (190,48); the horizon at y = 48
  const sunX = 10 + 180 * k, sunY = 48 - 2 * (1 - k) * k * 72;
  const up = now >= rise && now <= set;
  const left = up ? set - now : now < rise ? rise - now : null;
  const hm = (ms) => `${Math.floor(ms / 3600e3)} ч ${Math.round((ms % 3600e3) / 60000)} мин`;
  const sunNote = up ? `До заката ${hm(left)}` : now < rise ? `До восхода ${hm(left)}` : `Солнце село в ${tm(day.sunset[0])}`;
  const dot = h('div');
  const ARC = 'M10 48 Q100 -24 190 48';
  // kept in proportion (no stretching): a round sun, the sky part above the horizon, the passed part filled
  dot.innerHTML = `<svg viewBox="0 0 200 58"><defs><linearGradient id="sunfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb020" stop-opacity=".28"/><stop offset="1" stop-color="#ffb020" stop-opacity="0"/></linearGradient><clipPath id="sunpast"><rect class="past" x="0" y="0" height="48" width="${animate ? 10 : sunX}"/></clipPath></defs>`
    + `<path d="${ARC} Z" fill="url(#sunfill)" clip-path="url(#sunpast)"/>`
    + `<path d="${ARC}" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="1.6" stroke-dasharray="3 4"/>`
    + `<line x1="0" y1="48" x2="200" y2="48" stroke="currentColor" stroke-opacity=".18"/>`
    + `<path class="prog" d="${ARC}" fill="none" stroke="#ffb020" stroke-width="2.4" stroke-linecap="round" pathLength="100" stroke-dasharray="${animate ? 0 : (k * 100).toFixed(1)} 200"/>`
    + `<circle class="dot" r="5.5" fill="${up ? '#ffd36e' : '#8e8aa8'}" style="filter:drop-shadow(0 0 5px ${up ? '#ffb020' : 'transparent'})" cx="${animate ? 10 : sunX}" cy="${animate ? 48 : sunY}"/>`
    + `<text x="10" y="57" font-size="8" fill="currentColor" fill-opacity=".45">${tm(day.sunrise[0])}</text><text x="190" y="57" font-size="8" text-anchor="end" fill="currentColor" fill-opacity=".45">${tm(day.sunset[0])}</text></svg>`;
  tiles.append(h('div', { class: 'tile' }, h('div', { class: 'lab', html: `${icon('sun', 12)} Солнце` }), h('div', { class: 'val', style: 'font-size:20px' }, `${tm(day.sunrise[0])} – ${tm(day.sunset[0])}`), h('div', { class: 'sub' }, `Световой день ${hm(set - rise)}`), h('div', { class: 'sub' }, sunNote), h('div', { class: 'sunarc' }, dot)));
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
      h('div', { style: 'font-weight:650' }, Math.round(day.temperature_2m_max[i]) + '°', h('div', { class: 'pp' }, day.precipitation_probability_max[i] >= 30 ? `${day.precipitation_probability_max[i]}%` : '')),
      h('div', { class: 'dsun' }, h('span', { html: icon('sunrise', 13) }), tm(day.sunrise[i]), h('span', { html: icon('sunset', 13) }), tm(day.sunset[i]))));
  });
  pin.append(h('div', { class: 'h2' }, 'Прогноз на неделю'), days);
  pin.append(h('div', { class: 'muted small', style: 'text-align:center' }, `Open-Meteo · обновлено ${new Date(d.fetched).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`));

  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => {
    needle.style.transform = `rotate(${c.wind_direction_10m}deg)`;
    hum.style.setProperty('--lv', c.relative_humidity_2m / 100);
    gauge.style.setProperty('--g', gk);
    // the sun travels along the arc (not in a straight line) to where it is now
    const circ = dot.querySelector('circle.dot'), prog = dot.querySelector('.prog'), past = dot.querySelector('.past');
    const t0 = performance.now(), T = 1400;
    const step = (t) => {
      const e = Math.min(1, (t - t0) / T), q = k * (1 - Math.pow(1 - e, 3));
      circ.setAttribute('cx', 10 + 180 * q); circ.setAttribute('cy', 48 - 2 * (1 - q) * q * 72);
      prog.setAttribute('stroke-dasharray', `${(q * 100).toFixed(1)} 200`); past.setAttribute('width', 10 + 180 * q);
      if (e < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
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
