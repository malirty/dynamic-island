import { api, bus, state, $, $$, h, esc, icon, mediaIcon, clock, ago, bytes, wmo, saveSettings, glyphTile, setProgress, setPP } from '../core.js';
import { npWindik } from '../npwindik.js';

export const QUICK = {
  region: { label: 'Область', icon: 'region', run: () => api.invoke('capture:start', 'region') },
  ocr: { label: 'Текст', icon: 'ocr', run: () => api.invoke('capture:start', 'ocr') },
  translate: { label: 'Перевод', icon: 'translate', run: () => api.invoke('capture:start', 'translate') },
  color: { label: 'Пипетка', icon: 'color', run: () => api.invoke('capture:start', 'color') },
  qr: { label: 'QR-код', icon: 'qr', run: () => api.invoke('capture:start', 'qr') },
  timer: { label: 'Таймер', icon: 'timer', run: () => bus.emit('palette-prefill', 'таймер ') },
  reminder: { label: 'Напомнить', icon: 'bell', run: () => bus.emit('palette-prefill', 'напомни через ') },
  note: { label: 'Заметка', icon: 'note', run: (ctx) => { ctx.openTab('notes'); bus.emit('note-add', ''); } },
  dictate: { label: 'Голос', icon: 'mic', run: () => api.invoke('sys:dictate') },
  caffeine: { label: 'Не спать', icon: 'coffee', toggle: true, get: () => api.invoke('sys:caffeine:get'), set: (on) => api.invoke('sys:caffeine', on) },
  ai: { label: 'ИИ', icon: 'ai', run: (ctx) => ctx.openTab('ai') },
  clip: { label: 'Буфер', icon: 'clip', run: (ctx) => ctx.openTab('clip') },
  dnd: { label: 'Тишина', icon: 'belloff', toggle: true, get: async () => !!state.settings.dnd, set: (on) => { state.settings.dnd = on; saveSettings(); } },
  lock: { label: 'Блокировка', icon: 'lock', run: () => api.invoke('sys:power', 'lock') },
  theme: { label: 'Тема', icon: 'theme', run: () => document.dispatchEvent(new CustomEvent('island-theme')) },
};

let ctx, root;
let lyricsOn = false;

function playerW() {
  const w = h('div', { class: 'card player w wide' });
  w.innerHTML = `<div class="bgblur"></div>
    <div class="art-wrap"><div class="art"></div><div class="refl"></div></div>
    <div class="info" style="min-width:0">
      <div class="t"></div><div class="a"></div><div class="src"></div>
      <div class="prog"><span class="pos">0:00</span><div class="track"><i></i></div><span class="dur">0:00</span></div>
      <div class="ctl">
        <button class="cbtn" data-c="prev">${mediaIcon('prev', 24)}</button>
        <button class="cbtn big" data-c="toggle"></button>
        <button class="cbtn" data-c="next">${mediaIcon('next', 24)}</button>
        <div style="flex:1"></div>
        <button class="ibtn lyrb" title="Текст песни">${icon('lyrics', 18)}</button>
      </div>
      <div class="vol" title="Громкость только этого плеера — остальной звук не меняется">${icon('volume', 16)}<input type="range" class="slider" min="0" max="1" step="0.01" value="1"><span class="small vv" style="width:34px;text-align:right">100%</span></div>
    </div>
    <div class="lyr"><div class="lyrics"><div class="lines"></div></div></div>`;
  const noplay = h('div', { class: 'noplay', html: `<span class="npslot"></span><div><div style="font-weight:650;color:var(--fg)">Сейчас ничего не играет</div><div class="small">Включи музыку в любом плеере — остров оживёт</div></div>` });
  // nothing playing: the player's own Windik (js/npwindik.js) dozes in headphones waiting for music
  const npw = npWindik();
  $('.npslot', noplay).append(npw);
  // his size follows the card (he takes no height of his own, so he can't make the card taller);
  // in a tall card (a stretched island) he stands over the words in the middle
  new ResizeObserver(() => {
    if (!noplay.parentNode) return;
    const hh = w.clientHeight;
    if (!hh) return;
    const tall = hh > 150;
    noplay.classList.toggle('tall', tall);
    const sz = Math.round(tall ? Math.min(150, hh * 0.42) : Math.max(44, Math.min(72, hh - 18)));
    npw.style.setProperty('--s', sz + 'px');
    const slot = $('.npslot', noplay);
    slot.style.width = sz + 'px';
    slot.style.height = tall ? Math.round(sz * 0.95) + 'px' : '';
  }).observe(w);
  for (const b of $$('[data-c]', w)) b.onclick = () => {
    if (b.dataset.c === 'toggle') setPP(b, !state.media?.playing, 23, 1500); // show the new state at once
    api.invoke('media:cmd', b.dataset.c);
  };
  $('.lyrb', w).onclick = () => { lyricsOn = !lyricsOn; w.classList.toggle('showlyr', lyricsOn); $('.lyrb', w).classList.toggle('on', lyricsOn); ctx.resize(); };
  $('.track', w).onclick = (e) => {
    const m = state.media, r = e.currentTarget.getBoundingClientRect();
    if (m.canSeek && m.duration) { const k = (e.clientX - r.left) / r.width; setProgress(e.currentTarget, k); api.invoke('media:cmd', 'seek', { position: k * m.duration }); }
  };
  const vol = $('input', w);
  // the sound follows the slider while you drag it (the island sends only the newest value while
  // the previous one is still being set, so nothing piles up)
  const showVol = () => { vol.style.setProperty('--v', vol.value); $('.vv', w).textContent = Math.round(vol.value * 100) + '%'; };
  vol.oninput = () => { showVol(); api.invoke('media:setAppVolume', +vol.value); };
  let key = '';
  function update() {
    const m = state.media;
    const active = m?.active;
    w.querySelector('.info').style.display = active ? '' : 'none';
    w.querySelector('.art-wrap').style.display = active ? '' : 'none';
    if (!active) { if (!noplay.parentNode) w.append(noplay); w.classList.remove('playing'); return; }
    noplay.remove();
    w.classList.toggle('playing', !!m.playing);
    w.classList.toggle('soundonly', !!m.soundOnly); // an app that only makes sound: just its name and volume
    if (key !== m.key + (m.thumb?.length || 0)) {
      key = m.key + (m.thumb?.length || 0);
      const bg = m.thumb ? `url('${m.thumb}')` : 'none';
      $('.art', w).style.backgroundImage = bg;
      $('.refl', w).style.backgroundImage = bg;
      $('.bgblur', w).style.backgroundImage = bg;
      $('.t', w).textContent = m.title;
      $('.a', w).textContent = [m.artist, m.album].filter(Boolean).join(' — ');
      $('.src', w).innerHTML = `${icon('volume', 12)} ${esc(m.app || '')}`;
      api.invoke('media:appVolume').then((v) => { if (v != null) { vol.value = v; showVol(); } }); // just shows it, sets nothing
      renderLyrics();
    }
    setPP($('[data-c="toggle"]', w), m.playing, 23);
    $('.pos', w).textContent = clock(m.position || 0);
    $('.dur', w).textContent = clock(m.duration || 0);
    setProgress($('.track', w), m.duration ? m.position / m.duration : 0);
    $('.prog', w)?.classList.toggle('notime', !m.duration); // no track length from the player: no made-up times
    syncLyrics();
  }
  let lyrKey = '';
  function renderLyrics() {
    const lines = $('.lines', w);
    const l = state.lyrics;
    if (!l || l.key !== state.media.key) { lines.innerHTML = '<div class="ln">Ищу текст песни…</div>'; lyrKey = ''; return; }
    if (lyrKey === l.key) return;
    lyrKey = l.key;
    if (l.lyrics?.synced?.length) lines.innerHTML = l.lyrics.synced.map((x) => `<div class="ln" data-t="${x.t}">${esc(x.text || '♪')}</div>`).join('');
    else if (l.lyrics?.plain) lines.innerHTML = `<div class="plain">${esc(l.lyrics.plain)}</div>`;
    else lines.innerHTML = '<div class="ln">Текст не найден</div>';
  }
  function syncLyrics() {
    if (!lyricsOn) return;
    const lines = $$('.ln[data-t]', w);
    if (!lines.length) return;
    const pos = (state.media.position || 0) + 0.3;
    let cur = 0;
    for (let i = 0; i < lines.length; i++) if (+lines[i].dataset.t <= pos) cur = i;
    lines.forEach((l, i) => l.classList.toggle('on', i === cur));
    const box = $('.lines', w);
    box.style.transform = `translateY(${-(lines[cur].offsetTop - 80)}px)`;
  }
  bus.on('media', update);
  bus.on('lyrics', () => { lyrKey = ''; renderLyrics(); });
  update();
  return w;
}

function actionsW() {
  const w = h('div', { class: 'card w' }, h('div', { class: 'h2', style: 'margin:0 0 8px' }, 'Быстрые действия'));
  const grid = h('div', { class: 'actions' });
  for (const id of state.settings.quickActions) {
    const a = QUICK[id];
    if (!a) continue;
    const b = h('button', { class: 'act', html: `${icon(a.icon, 20)}<span>${a.label}</span>` });
    if (a.toggle) {
      a.get().then((on) => b.classList.toggle('on', !!on));
      b.onclick = async () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); await a.set(on); };
    } else b.onclick = () => a.run(ctx);
    grid.append(b);
  }
  w.append(grid);
  return w;
}

function weatherW() {
  const w = h('div', { class: 'card w wmini', onclick: () => ctx.openTab('weather') });
  function update() {
    const d = state.weather;
    if (!d?.current) { w.innerHTML = '<div class="muted small">Погода загружается…</div>'; return; }
    const c = d.current, today = d.daily;
    const info = wmo(c.weather_code, c.is_day);
    const rainSoon = (() => {
      const m = d.minutely_15; if (!m) return null;
      const now = Date.now();
      for (let i = 0; i < m.time.length; i++) { const t = new Date(m.time[i]).getTime(); if (t > now && t - now < 2 * 3600e3 && m.precipitation[i] >= 0.1) return Math.round((t - now) / 60000); }
      return null;
    })();
    w.innerHTML = `<div class="em">${info.icon}</div><div class="big">${Math.round(c.temperature_2m)}°</div>
      <div class="grow"><div style="font-weight:650">${esc(d.place || '')}</div><div class="muted small">${info.text}</div>
      <div class="muted small">↑${Math.round(today.temperature_2m_max[0])}° ↓${Math.round(today.temperature_2m_min[0])}° · ощущается ${Math.round(c.apparent_temperature)}°</div>
      ${rainSoon != null && !(c.precipitation > 0) ? `<div class="small" style="color:#7cc4ff;margin-top:3px">🌧 дождь через ~${Math.max(5, rainSoon)} мин</div>` : ''}</div>`;
  }
  bus.on('weather', update);
  update();
  return w;
}

function shelfW() {
  const w = h('div', { class: 'card w shelfw' });
  function update() {
    w.innerHTML = '';
    w.append(h('div', { class: 'h2', style: 'margin:0 0 8px' }, 'Полка', h('span', { class: 'sp' }), state.shelf.length ? h('button', { class: 'btn sm ghost', onclick: () => api.invoke('shelf:clear') }, 'Очистить') : ''));
    if (!state.shelf.length) { w.append(h('div', { class: 'drop' }, 'Перетащи сюда файлы — заберёшь их потом, просто вытянув обратно')); return; }
    const files = h('div', { class: 'files' });
    for (const f of state.shelf) {
      const it = h('div', { class: 'fitem', draggable: 'true', title: f.path + (f.note ? '\n' + f.note : '') },
        f.icon ? h('img', { src: f.icon }) : h('div', { html: icon(f.dir ? 'folder' : 'file', 30), style: 'display:grid;place-items:center;height:38px' }),
        h('div', { class: 'n' }, f.name), h('div', { class: 'note' }, f.note || bytes(f.size)),
        h('button', { class: 'ibtn x', html: icon('close', 12), title: 'Убрать с полки', onclick: (e) => { e.stopPropagation(); api.invoke('shelf:remove', f.id); } }));
      it.addEventListener('dragstart', (e) => { e.preventDefault(); api.send('shelf:drag', [f.id]); });
      it.addEventListener('dblclick', () => api.invoke('file:open', f.path));
      it.addEventListener('contextmenu', (e) => { e.preventDefault(); ctx.openTab('ai'); bus.emit('ai-attach', [f.path]); });
      files.append(it);
    }
    w.append(files, h('div', { class: 'muted small', style: 'margin-top:6px' }, 'Тяни файл наружу · двойной клик — открыть · ПКМ — спросить ИИ'));
  }
  bus.on('shelf', () => { update(); ctx.resize(); });
  update();
  return w;
}

function agentsW() {
  const w = h('div', { class: 'card w' });
  function update() {
    const a = state.agents;
    w.innerHTML = '';
    w.append(h('div', { class: 'h2', style: 'margin:0 0 6px' }, 'Агенты в терминале'));
    if (!a.sessions?.length) {
      const inst = state.agentsInstalled || {};
      w.append(h('div', { class: 'muted small', style: 'padding:6px 2px' }, inst.claude ? 'Claude Code подключён. Запусти его в терминале — остров покажет, что агент трудится.' : 'Подключи Claude Code или Codex в настройках, и остров позовёт, когда нужен твой ответ.'));
      if (!inst.claude) w.append(h('button', { class: 'btn sm', onclick: () => api.invoke('settings:open', 'agents') }, 'Подключить'));
      return;
    }
    for (const s of a.sessions) {
      const ask = a.asks?.find((x) => x.session === s.id);
      // the agent's logo (Claude / Codex) with a small state badge in the corner
      const badge = s.state === 'waiting' ? '!' : s.state === 'done' ? '✓' : '';
      const anim = s.state === 'working' ? ' work' : s.state === 'waiting' ? ' wait' : '';
      w.append(h('div', { class: 'agent' },
        h('div', { class: 'alogo' + anim, html: glyphTile({ kind: 'agent', source: s.source }, 28) + (badge ? `<i class="abadge ${s.state}">${badge}</i>` : s.state === 'working' ? '<i class="abadge working"></i>' : '') }),
        h('div', { class: 'grow' }, h('div', { class: 'nm' }, `${s.project}`, h('span', { class: 'muted small', style: 'font-weight:500' }, ` · ${s.source === 'codex' ? 'Codex' : 'Claude'} · ${ago(s.updated)}`)), h('div', { class: 'nt' }, ask ? (ask.kind === 'permission' ? `Разрешить ${ask.data.tool}?` : ask.data.questions?.[0]?.question) : (s.tool ? s.tool + ': ' : '') + (s.note || ''))),
        h('button', { class: 'ibtn', html: icon('close', 12), title: 'Убрать', onclick: () => api.invoke('agents:dismiss', s.id) })));
    }
  }
  bus.on('agents', update);
  update();
  return w;
}

function clipsW() {
  const w = h('div', { class: 'card w' });
  function update() {
    w.innerHTML = '';
    w.append(h('div', { class: 'h2', style: 'margin:0 0 6px' }, 'Недавно скопировано', h('span', { class: 'sp' }), h('button', { class: 'btn sm ghost', onclick: () => ctx.openTab('clip') }, 'Все')));
    const list = state.clips.slice(0, 4);
    if (!list.length) w.append(h('div', { class: 'empty' }, 'Скопируй что-нибудь'));
    for (const c of list) w.append(h('div', { class: 'notif', style: 'cursor:pointer', onclick: () => { ctx.collapse(false); api.invoke('clip:paste', c.id); } },
      h('div', { class: 'ap', html: icon(c.type === 'image' ? 'image' : c.type === 'file' ? 'file' : 'clip', 14) }),
      h('div', { class: 'grow' }, h('div', { class: 'small', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, c.type === 'image' ? `Изображение ${c.w}×${c.h}` : c.text), h('div', { class: 'muted small' }, `${c.source?.app || ''} · ${ago(c.ts)}`))));
  }
  bus.on('clips', update);
  update();
  return w;
}

function notesW() {
  const w = h('div', { class: 'card w' });
  function update() {
    w.innerHTML = '';
    w.append(h('div', { class: 'h2', style: 'margin:0 0 6px' }, 'Заметки', h('span', { class: 'sp' }), h('button', { class: 'btn sm ghost', onclick: () => { ctx.openTab('notes'); bus.emit('note-add', ''); } }, icon('plus', 12), 'Новая')));
    const list = [...state.notes].sort((a, b) => (b.pinned - a.pinned) || b.updated - a.updated).slice(0, 3);
    if (!list.length) w.append(h('div', { class: 'empty' }, 'Пока пусто'));
    for (const n of list) w.append(h('div', { class: 'notif', style: 'cursor:pointer', onclick: () => { ctx.openTab('notes'); bus.emit('note-open', n.id); } },
      h('div', { class: 'ap', html: n.pinned ? icon('pin', 13) : icon('note', 13) }),
      h('div', { class: 'grow' }, h('div', { class: 'small', style: 'font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, (n.text.split('\n')[0] || 'Новая заметка')), h('div', { class: 'muted small' }, ago(n.updated)))));
  }
  bus.on('notes', update);
  update();
  return w;
}

function notifsW() {
  const w = h('div', { class: 'card w' });
  function update() {
    w.innerHTML = '';
    w.append(h('div', { class: 'h2', style: 'margin:0 0 6px' }, 'Уведомления', h('span', { class: 'sp' }), state.notifications.length ? h('button', { class: 'btn sm ghost', onclick: () => { state.notifications = []; api.invoke('notifications:clear'); update(); ctx.resize(); } }, 'Очистить') : ''));
    const list = state.notifications.slice(0, 4);
    if (!list.length) w.append(h('div', { class: 'empty' }, state.settings.dnd ? 'Не беспокоить включено' : 'Нет новых уведомлений'));
    for (const n of list) w.append(h('div', { class: 'notif', style: n.kind === 'telegram' ? 'cursor:pointer' : null, onclick: n.kind === 'telegram' ? () => bus.emit('tg-open', n.tgPeer) : null },
      h('div', { class: 'ap', html: glyphTile(n, 28) }),
      h('div', { class: 'grow' }, h('div', { class: 'small', style: 'font-weight:650' }, n.title || ''), n.body ? h('div', { class: 'muted small', style: 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden' }, n.body) : '', h('div', { class: 'muted small', style: 'font-size:10.5px' }, `${n.app || ''} · ${ago(n.at)}`))));
  }
  bus.on('notification', update);
  update();
  return w;
}

let callEl = null;
function callW() {
  const w = h('div', { class: 'card w wide callcard' });
  function update() {
    const calls = state.calls || [];
    w.style.display = calls.length ? '' : 'none';
    w.innerHTML = '';
    w._timers = [];
    for (const c of calls) {
      const logo = c.icon ? h('img', { class: 'cc-logo', src: c.icon }) : h('div', { class: 'cc-logo fallback' }, (c.name || '?')[0]);
      const t = h('span', { class: 'cc-time' }, clock((Date.now() - c.since) / 1000));
      w.append(h('div', { class: 'cc-row' },
        h('div', { class: 'cc-logo-wrap' }, logo),
        h('div', { class: 'grow' }, h('div', { class: 'cc-title' }, `Звонок в ${c.name}`), h('div', { class: 'muted small' }, t, c.micMuted ? ' · микрофон выключен' : '', c.soundMuted ? ' · звук заглушён' : '')),
        h('button', { class: 'cc-btn' + (c.micMuted ? ' muted' : ''), title: c.micMuted ? 'Включить микрофон' : 'Выключить микрофон', html: icon(c.micMuted ? 'micoff' : 'mic', 18), onclick: () => api.invoke('calls:mic', c.id) }),
        h('button', { class: 'cc-btn' + (c.soundMuted ? ' muted' : ''), title: c.soundMuted ? 'Вернуть звук' : 'Заглушить звук звонка', html: icon(c.soundMuted ? 'mute' : 'volume', 18), onclick: () => api.invoke('calls:sound', c.id) }),
        h('button', { class: 'btn sm', onclick: () => api.invoke('calls:focus', c.id) }, `Открыть ${c.name}`)));
      w._timers = w._timers || [];
      w._timers.push(() => { t.textContent = clock((Date.now() - c.since) / 1000); });
    }
  }
  bus.on('calls', () => { update(); ctx.resize(); });
  setInterval(() => { for (const f of w._timers || []) f(); }, 1000);
  update();
  return w;
}

const WIDGETS = { player: playerW, actions: actionsW, weather: weatherW, shelf: shelfW, agents: agentsW, clips: clipsW, notes: notesW, notifs: notifsW };

function render() {
  const grid = $('.home', root);
  const look = state.settings.homeLook || {};
  grid.classList.toggle('fill', look.fill !== false); // the tiles grow to the island's whole height
  grid.classList.toggle('nochar', look.npChar === false);
  grid.innerHTML = '';
  const els = [];
  els.push(callEl ||= callW()); // one card for the app's life, shown only while a call is on
  for (const wd of state.settings.home) if (wd.on && WIDGETS[wd.id]) els.push(WIDGETS[wd.id]());
  // the layout adapts to whatever is left: a lone half-width card stretches
  const halves = els.filter((e) => !e.classList.contains('wide'));
  if (halves.length % 2 === 1) halves[halves.length - 1].classList.add('wide');
  grid.classList.add('stagger');
  grid.append(...els);
  if (!els.length) grid.append(h('div', { class: 'empty w wide' }, 'Главная пуста — добавь виджеты в настройках'));
  requestAnimationFrame(() => fillRows(true));
}

// No hole at the end of a row: when the last card of a row leaves room on its right (a wide card
// alone on the last row, say), it stretches to the edge. Worked out again whenever the columns change.
let fillSig = '';
function fillRows(force) {
  const grid = $('.home', root);
  if (!grid?.offsetWidth) return;
  const cs = getComputedStyle(grid);
  const cols = cs.gridTemplateColumns.split(' ').length;
  const cards = [...grid.children].filter((c) => c.offsetWidth);
  const sig = cols + ':' + cards.length + ':' + cards.map((c) => c.className).join('|');
  if (!force && sig === fillSig) return;
  fillSig = sig;
  for (const c of cards) c.style.gridColumn = '';
  if (cols < 2) return;
  const gap = parseFloat(cs.columnGap) || 0;
  const left = Math.min(...cards.map((c) => c.offsetLeft)), width = grid.clientWidth;
  const cw = (width - gap * (cols - 1)) / cols;
  const rows = new Map();
  for (const c of cards) { // the rightmost card of each row
    const cur = rows.get(c.offsetTop);
    if (!cur || c.offsetLeft > cur.offsetLeft) rows.set(c.offsetTop, c);
  }
  for (const c of rows.values()) {
    const room = left + width - (c.offsetLeft + c.offsetWidth);
    if (room > cw * 0.5) c.style.gridColumn = `${Math.round((c.offsetLeft - left) / (cw + gap)) + 1} / -1`;
  }
}

export default {
  id: 'home', label: 'Главная', icon: 'home',
  mount(el, c) {
    ctx = c; root = el;
    el.innerHTML = '<div class="pin"><div class="home"></div></div>';
    render();
    new ResizeObserver(() => fillRows()).observe($('.home', el));
    // "Перевод" (translate a screen area) joins the quick actions once, right after "Текст"
    const qa = state.settings.quickActions;
    if (qa && !state.settings.qaTranslateAdded) {
      if (!qa.includes('translate')) qa.splice(qa.includes('ocr') ? qa.indexOf('ocr') + 1 : qa.length, 0, 'translate');
      state.settings.qaTranslateAdded = true; saveSettings(); render();
    }
    let sig = JSON.stringify([state.settings.home, state.settings.quickActions, state.settings.homeLook]);
    bus.on('settings', () => {
      const s = JSON.stringify([state.settings.home, state.settings.quickActions, state.settings.homeLook]);
      if (s !== sig) { sig = s; render(); }
    });
    bus.on('drop-open', ({ paths, target }) => { if (paths.length && (target.closest?.('.shelfw') || target.closest?.('.page[data-id="home"]'))) api.invoke('shelf:add', paths).then(() => ctx.flash({ icon: '📥', title: paths.length > 1 ? `На полке: ${paths.length} файла` : 'Файл на полке', ms: 1600 })); });
  },
  show() { const g = $('.home', root); g.classList.remove('stagger'); void g.offsetWidth; g.classList.add('stagger'); },
};
