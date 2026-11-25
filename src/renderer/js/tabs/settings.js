import { api, bus, state, $, h, esc, icon, debounce, saveSettings, EYE_FX, SKINS, SKIN_LIST } from '../core.js';
import { QUICK } from './home.js';
import { SOUND_EVENTS, SOUNDS, play as playSound } from '../sounds.js';
import { TILES, CC_DEFAULTS, TOGGLE_IDS, POWER } from './control.js';

// a switch tile: the feature's icon, its name, and a round mark that fills when it is on
function chipBody(id, label) {
  const ic = TILES[id]?.icon || QUICK[id]?.icon || POWER.find((p) => p[0] === id)?.[2];
  return [h('span', { class: 'chi', html: ic ? icon(ic, 15) : '' }), h('span', { class: 'chl' }, label), h('span', { class: 'chk', html: icon('check', 10) })];
}

let root, ctx, hintBox;
const S = () => state.settings;

const TAB_NAMES = { home: 'Главная', clip: 'Буфер', ai: 'ИИ', text: 'Текст', notes: 'Заметки', weather: 'Погода', control: 'Центр управления', settings: 'Настройки' };
const WIDGET_NAMES = { player: 'Плеер', actions: 'Быстрые действия', weather: 'Погода', shelf: 'Полка файлов', agents: 'Агенты (Claude Code / Codex)', notifs: 'Уведомления', clips: 'Недавний буфер', notes: 'Заметки' };
const PRESETS = [
  ['#7c5cff', '#00d4ff', '#ff4fd8'], ['#ff6b6b', '#ffd93d', '#ff8e3c'], ['#00f5a0', '#00d9f5', '#7cff6b'], ['#f72585', '#7209b7', '#4361ee'],
  ['#ff9a8b', '#ff6a88', '#ff99ac'], ['#43e97b', '#38f9d7', '#4facfe'], ['#fdfbfb', '#c3cfe2', '#a1c4fd'], ['#232526', '#414345', '#8e9eab'],
];

// ---------------- live preview in the hint panel ----------------
// Each setting shows a small picture of exactly what it changes; after a change
// the panel redraws with the new value and a short "applied" mark.
const HP_BY_TITLE = {
  'Тема': 'theme', 'Материал острова': 'material', 'Цвета': 'colors', 'Палитры': 'colors', 'Свечение': 'glow', 'Цвет обложки': 'cover',
  'Танцующий край': 'dance', 'Волны под музыку': 'dance', 'Жидкие края': 'water', 'Свет за курсором': 'sheen', 'Реакция на движения': 'tilt', 'Размер': 'scale', 'Характер': 'character',
  'Секунды в часах': 'seconds', 'Полноэкранный режим': 'fullscreen', 'Сон': 'sleep', 'Запускать вместе с Windows': 'autostart',
  'Быстрые действия': 'quick', 'Плитки': 'tiles', 'Громкость': 'tiles', 'Яркость': 'tiles', 'Нейросеть': 'ai', 'Ключ Gemini': 'ai',
  'Ключ DeepSeek': 'ai', 'Ключ ChatGPT (OpenAI)': 'ai', 'Город': 'weather', 'Дождь': 'rain', 'Обновить сейчас': 'weather', 'Windows': 'notif',
  'Не беспокоить': 'dnd', 'Агенты': 'agent', 'Telegram': 'telegram', 'Только личные и упоминания': 'telegram', 'Claude Code': 'agent', 'Codex': 'agent',
  'Командная строка': 'hotkey:palette', 'Светлая / тёмная тема': 'hotkey:themeToggle', 'Скриншот области': 'hotkey:region', 'Раскрыть остров': 'hotkey:island',
};
const DESC_BY_TITLE = {
  'Секунды в часах': 'Часы в пилюле показывают секунды.',
  'Запускать вместе с Windows': 'Остров появится сам после включения компьютера.',
  'Громкость': 'Ползунок общей громкости в центре управления.',
  'Яркость': 'Ползунок яркости экрана. Работает на ноутбуках и мониторах, которые это поддерживают.',
  'Модель Gemini': 'Какая модель Gemini отвечает. Можно вписать любую из доступных.',
  'Модель DeepSeek': 'deepseek-chat — быстрые ответы, deepseek-reasoner — с рассуждением.',
  'Модель ChatGPT': 'Какая модель OpenAI отвечает.',
  'Модель Ollama': 'Локальная модель Ollama, например llama3.2 или qwen2.5.',
  'Адрес Ollama': 'Где запущена Ollama. Обычно менять не нужно.',
  'api_id': 'Число с my.telegram.org → API development tools.',
  'api_hash': 'Строка с той же страницы my.telegram.org.',
  'Только личные и упоминания': 'Без этого остров покажет сообщения из всех групп и каналов.',
  'Обновить сейчас': 'Сразу загрузить свежий прогноз.',
};

const isDark = (m) => m !== 'light';
function baseFor(style, mode, solid) {
  if (SKINS[style]) return SKINS[style].base;
  if (style === 'white') return '#ffffff';
  if (style === 'black') return '#000000';
  if (style === 'glass') return isDark(mode) ? 'rgba(22,22,32,.66)' : 'rgba(255,255,255,.6)';
  if (style === 'solid') return isDark(mode) ? solid : '#f7f7fa';
  return isDark(mode) ? 'rgba(6,6,10,.94)' : 'rgba(250,250,253,.9)';
}
const eyesMini = (cls = '') => `<div class="eyes ${cls}"><div class="eye"></div><div class="eye"></div>${EYE_FX}</div>`;
// a miniature island built from the same layers as the real one
function pill(o = {}) {
  const t = S().theme;
  const style = o.style || t.style;
  const sk = SKINS[style];
  const plainP = sk ? [sk.mode, sk.colors, sk.glow] : { white: ['light', ['#d9d9e1', '#c7c7d1', '#ececf1'], '#9d9daa'], black: ['dark', ['#2c2c33', '#1d1d22', '#3a3a42'], '#6e6e7a'] }[style];
  const mode = plainP ? plainP[0] : o.mode || t.mode, colors = plainP ? plainP[1] : o.colors || t.colors;
  if (plainP) o = { ...o, glowColor: plainP[2] };
  const op = sk ? [0, 0, 0] : { mood: [0.62, 0, 0], liquid: [0.55, 0, 0], gradient: [0.2, 1, 0], glass: [0.35, 0, 1], solid: [0, 0, 0], white: [0, 0, 0], black: [0, 0, 0] }[style] || [0.5, 0, 0];
  const glow = o.glow ?? t.glow;
  const vars = `--c1:${colors[0]};--c2:${colors[1]};--c3:${colors[2]};--glow:${o.glowColor || colors[0]};--glowK:${glow};--liquidOp:${op[0]};--flowOp:${op[1]};--glassOp:${op[2]};--base:${baseFor(style, mode, t.solid)};${o.vars || ''}`;
  return `<div class="mp ${o.cls || ''}" data-mode="${mode}"${sk ? ` data-skin="${style}"` : ''} style="${vars}"><div class="ib"><div class="flow"></div><div class="liquid"><i></i><i></i><i></i></div><div class="skin"></div><div class="glassrim"></div>${o.sheen ? '<div class="mpsheen"></div>' : ''}</div><div class="mpc">${o.content ?? `<span class="d">ср, 11</span>${eyesMini()}<span>10:42</span>`}</div>${o.after || ''}</div>`;
}
const cap = (text, on) => `<div class="mpl${on ? ' on' : ''}">${esc(text)}</div>`;
const chipsGrid = (items) => `<div class="mpgrid">${items.map(([ic, label]) => `<div class="mpi">${icon(ic, 14)}<span>${esc(label)}</span></div>`).join('') || '<div class="muted small">Пусто</div>'}</div>`;

const PREVIEW = {
  theme: () => `<div class="mprow">${['dark', 'light'].map((m) => `<div class="mpcol">${pill({ mode: m, cls: 'sm', content: eyesMini() })}${cap(m === 'dark' ? 'Тёмная' : 'Светлая', S().theme.mode === m)}</div>`).join('')}</div>`,
  skin: (id) => pill({ style: id, cls: 'big', content: `<span class="d">пт, 13</span>${eyesMini()}<span>10:42</span>` }) + cap(S().theme.style === id ? 'выбран' : 'нажми, чтобы выбрать', S().theme.style === id),
  material: () => `<div class="mprow wrap">${[['mood', 'По умолч.'], ['liquid', 'Жидкий'], ['glass', 'Стекло'], ['gradient', 'Градиент'], ['solid', 'Сплошной'], ...SKIN_LIST].map(([st, l]) => `<div class="mpcol">${pill({ style: st, content: eyesMini() , cls: 'sm' })}${cap(l, S().theme.style === st)}</div>`).join('')}</div>`,
  colors: () => `${pill({ cls: 'big' })}<div class="mprow" style="margin-top:8px">${S().theme.colors.map((c) => `<i class="dot" style="background:${c}"></i>`).join('')}</div>`,
  glow: () => `${pill({ cls: 'glowing big' })}<div class="mpl">Сила ${Math.round(S().theme.glow * 100)}%</div>`,
  cover: () => S().theme.coverGlow
    ? pill({ glowColor: '#ff8a3d', cls: 'glowing', content: `<i class="cov"></i><span>Трек</span><div class="bars">${'<i></i>'.repeat(4)}</div>` }) + cap('край в цвет обложки', true)
    : pill({ cls: 'glowing', content: `<i class="cov"></i><span>Трек</span><div class="bars">${'<i></i>'.repeat(4)}</div>` }) + cap('цвет из палитры', false),
  dance: () => S().theme.edgeDance
    ? pill({ cls: 'big wavy', after: '<div class="mpglow"></div><div class="mpring"></div><div class="mpring r2"></div>', content: `<i class="cov"></i><span>Трек</span>${eyesMini()}` }) + cap('низ светится, расходятся волны', true)
    : pill({ cls: 'big', content: `<i class="cov"></i><span>Трек</span>${eyesMini()}` }) + cap('выключено', false),
  water: () => (S().theme.water !== false ? pill({ cls: 'big watery' }) + cap('край живой, как вода', true) : pill({ cls: 'big' }) + cap('ровный край', false)),
  sheen: () => (S().theme.cursorGlow ? pill({ sheen: true, cls: 'big' }) + cap('блик бежит за мышью', true) : pill({ cls: 'big' }) + cap('выключено', false)),
  tilt: () => (S().theme.reactive ? pill({ cls: 'tilting big' }) + cap('тянется к курсору', true) : pill({ cls: 'big' }) + cap('стоит на месте', false)),
  scale: () => `<div class="mpcol">${pill({ vars: `transform:scale(${S().theme.scale})` })}${cap(`${Math.round(S().theme.scale * 100)}%`, true)}</div>`,
  character: () => {
    const ch = S().island.character;
    const content = ch === 'none' ? '<span class="d">ср, 11</span><span>10:42</span>' : undefined;
    const after = ch === 'buddies' ? `<div class="mpbud"><i>${eyesMini('b')}</i><i>${eyesMini('b')}</i></div>` : '';
    // every emotion the eyes can show, live (they animate here too)
    const grid = '';
    return pill({ content, after, cls: 'big' }) + cap({ eyes: 'Глаза', buddies: 'Человечки', none: 'Никого' }[ch], true) + grid;
  },
  seconds: () => pill({ content: `<span class="d">ср, 11</span>${eyesMini()}<span>${S().island.showSeconds ? '10:42:17' : '10:42'}</span>`, cls: 'big' }),
  fullscreen: () => `<div class="mpscreen ${S().island.hideOnFullscreen ? 'hiding' : ''}">${pill({ cls: 'sm' })}<span>${S().island.hideOnFullscreen ? 'кино на весь экран' : 'остров остаётся'}</span></div>`,
  sleep: () => pill({ cls: 'big', content: `<span class="d">ср, 11</span>${eyesMini('e-sleepy')}<span>10:42</span>` }) + cap(`засыпает через ${S().island.sleepAfterMin} мин`, true),
  autostart: () => `<div class="mpbig">${icon('power', 26)}</div>` + cap(S().island.autostart ? 'запускается с Windows' : 'запуск вручную', S().island.autostart),
  quick: () => chipsGrid(S().quickActions.filter((id) => QUICK[id]).map((id) => [QUICK[id].icon, QUICK[id].label])),
  tiles: () => chipsGrid(S().controlTiles.filter((id) => TILES[id]).map((id) => [TILES[id].icon, TILES[id].label])) + `<div class="mpl">${S().controlSliders.map((x) => (x === 'volume' ? '🔊 громкость' : '☀ яркость')).join(' · ') || 'без ползунков'}</div>`,
  tabs: () => `<div class="mptabs">${S().tabs.filter((t) => t.on).map((t) => `<span>${icon({ home: 'home', clip: 'clip', ai: 'ai', text: 'text', notes: 'notes', weather: 'weather', control: 'control', settings: 'settings' }[t.id], 14)}</span>`).join('')}</div>` + cap(`${S().tabs.filter((t) => t.on).length} вкладок`, true),
  home: () => `<div class="mphome">${S().home.filter((w) => w.on).map((w) => `<div class="${w.id === 'player' ? 'wide' : ''}">${esc(WIDGET_NAMES[w.id] || w.id)}</div>`).join('') || '<div class="wide">пусто</div>'}</div>`,
  ai: () => chipsGrid([['ai', `Gemini ${S().ai.keys.gemini ? '✓' : '— нет ключа'}`], ['ai', `DeepSeek ${S().ai.keys.deepseek ? '✓' : '— нет ключа'}`], ['ai', `ChatGPT ${S().ai.keys.openai ? '✓' : '— нет ключа'}`], ['ai', 'Ollama ✓']]) + cap(`по умолчанию: ${state.providers?.[S().ai.provider]?.name || S().ai.provider}`, true),
  weather: () => { const c = state.weather?.current; return pill({ cls: 'big', content: `<span class="d">${esc(state.weather?.place || S().weather.city || 'по IP')}</span><span>${c ? Math.round(c.temperature_2m) + '°' : '…'}</span>` }); },
  rain: () => (S().weather.rainAlerts ? pill({ cls: 'toast', content: `<span>🌧</span><span>Дождь через ~20 мин</span>` }) + cap('предупреждение включено', true) : cap('без предупреждений', false)),
  notif: () => (S().notifications.windows ? pill({ cls: 'toast', content: `<span>💬</span><span>Новое сообщение</span>` }) : cap('уведомления Windows не показываются', false)),
  dnd: () => pill({ cls: 'big', content: `<span>${S().dnd ? '🔕' : '🔔'}</span>${eyesMini()}<span>${S().dnd ? 'тишина' : 'звонко'}</span>` }),
  telegram: () => pill({ cls: 'toast', content: `<span>✈️</span><span>Денис: привет!</span>` }) + cap(S().notifications.telegram ? 'Telegram включён' : 'Telegram выключен', S().notifications.telegram),
  agent: () => pill({ cls: 'toast', content: `<span class="spark">${icon('agent', 13)}</span><span>Claude трудится</span>` }) + pill({ cls: 'toast', content: `<span>❗</span><span>Разрешить npm test?</span>` }),
  hotkey: (k) => `<div class="mpkeys">${(S().hotkeys[k] || '—').split('+').map((x) => `<kbd>${esc(x)}</kbd>`).join('<b>+</b>')}</div>`,
};

let curHint = null;
let appliedTimer = null;
function hint(title, desc, hp) {
  return { 'data-ht': title, 'data-hd': desc, 'data-hp': hp || HP_BY_TITLE[title] || '' };
}
function showHint(t, d, hp, applied) {
  const changed = !curHint || curHint.t !== t || curHint.hp !== hp;
  curHint = { t, d, hp };
  if (changed && !applied) { hintBox.classList.remove('swap'); void hintBox.offsetWidth; hintBox.classList.add('swap'); }
  const [key, arg] = (hp || '').split(':');
  let preview = '';
  try { preview = PREVIEW[key]?.(arg) || ''; } catch {}
  hintBox.innerHTML = `<div class="ht">${esc(t)}</div><div class="hd">${esc(d || DESC_BY_TITLE[t] || '')}</div>${preview ? `<div class="hp">${preview}</div>` : ''}${applied ? `<div class="applied">${icon('check', 13)} Применено</div>` : ''}`;
}
// save + redraw the preview of the setting being edited
function commit() {
  const p = saveSettings();
  if (curHint) {
    showHint(curHint.t, curHint.d, curHint.hp, true);
    clearTimeout(appliedTimer);
    appliedTimer = setTimeout(() => hintBox.querySelector('.applied')?.classList.add('gone'), 1400);
  }
  return p;
}
const commitSoon = (() => { const s = debounce(saveSettings, 350); return () => { s(); if (curHint) showHint(curHint.t, curHint.d, curHint.hp, true); }; })();

function row(label, sub, control, ht, hd) {
  return h('div', { class: 'srow', ...hint(ht || label, hd || sub || '') }, h('div', { class: 'sl2' }, label, sub ? h('small', {}, sub) : ''), control);
}
// label on top, control under it (for wide controls)
function rowWide(label, sub, control, ht, hd) {
  return h('div', { class: 'srow wide', ...hint(ht || label, hd || sub || '') }, h('div', { class: 'sl2' }, label, sub ? h('small', {}, sub) : ''), control);
}
function toggle(get, set) {
  const t = h('div', { class: 'toggle' + (get() ? ' on' : '') });
  t.onclick = () => { const v = !get(); set(v); t.classList.toggle('on', v); commit(); };
  return t;
}
function seg(options, get, set) {
  const s = h('div', { class: 'seg live' });
  const thumb = h('i', { class: 'segthumb' });
  s.append(thumb);
  const place = (snap) => {
    const b = s.querySelector('button.on');
    if (!b || !b.offsetWidth) { thumb.style.opacity = '0'; return; }
    if (snap) thumb.style.transition = 'none';
    thumb.style.opacity = '1';
    thumb.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
    thumb.style.width = b.offsetWidth + 'px';
    thumb.style.height = b.offsetHeight + 'px';
    if (snap) { void thumb.offsetWidth; thumb.style.transition = ''; }
  };
  for (const [v, label] of options) {
    const b = h('button', { class: get() === v ? 'on' : '' }, label);
    b.onclick = () => { set(v); for (const x of s.querySelectorAll('button')) x.classList.toggle('on', x === b); place(false); commit(); };
    s.append(b);
  }
  // placed once it's on screen (and again if it wraps or resizes)
  new ResizeObserver(() => place(true)).observe(s);
  return s;
}

// ---------- choices as pictures: each option is a little card with a drawing of what it does ----------
function pics(options, get, set, cls = '') {
  const box = h('div', { class: 'picgrid ' + cls });
  for (const [v, label, art] of options) {
    const b = h('button', { class: 'piccard' + (get() === v ? ' on' : ''), title: label },
      h('span', { class: 'picart', html: typeof art === 'function' ? art() : art || '' }), h('span', { class: 'picname' }, label));
    b.onclick = () => { set(v); for (const x of box.children) x.classList.toggle('on', x === b); commit(); };
    box.append(b);
  }
  return box;
}
const ART = {
  dark: () => `<span class="pa-scene dark">${pill({ mode: 'dark', cls: 'sm', content: eyesMini() })}</span>`,
  light: () => `<span class="pa-scene light">${pill({ mode: 'light', cls: 'sm', content: eyesMini() })}</span>`,
  char: (id) => () => `<span class="pa-scene dark char-${id}">${id === 'none' ? pill({ cls: 'sm', content: '<span class="d">10:42</span>' }) : id === 'buddies' ? `<span class="mpbud"><i>${eyesMini('b')}</i><i>${eyesMini('b')}</i></span>` : pill({ cls: 'sm', content: eyesMini() })}</span>`,
  level: (n, of = 3) => `<span class="pa-bars">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}" style="height:${8 + i * 6}px"></i>`).join('')}</span>`,
  sparks: (n) => `<span class="pa-sparks">${n ? Array.from({ length: n }, (_, i) => `<i style="--k:${i}">✦</i>`).join('') : '<b>—</b>'}</span>`,
  eyesCalm: `<span class="pa-eyes"><i></i><i></i></span>`,
  eyesAll: `<span class="pa-eyes all"><i></i><i></i><em>♥</em><em>!</em><em>?</em></span>`,
  web: `<span class="pa-ico">${icon('user', 24)}</span>`,
  api: `<span class="pa-ico">${icon('lock', 24)}</span>`,
  logo: (letter, bg) => `<span class="pa-logo" style="background:${bg}">${letter}</span>`,
  bubble: (r) => `<span class="pa-chat"><i style="border-radius:${r}"></i><i class="me" style="border-radius:${r}"></i></span>`,
  size: (px) => `<span class="pa-aa" style="font-size:${px}px">Aa</span>`,
  wall: (bg) => `<span class="pa-wall" style="background:${bg}"><i></i><i class="me"></i></span>`,
};
function range(min, max, step, get, set) {
  const r = h('input', { type: 'range', class: 'slider', min, max, step, value: get(), style: 'max-width:150px' });
  const upd = () => r.style.setProperty('--v', (r.value - min) / (max - min));
  upd();
  r.oninput = () => { set(+r.value); upd(); bus.emit('settings', S()); commitSoon(); };
  return r;
}
function text(get, set, attrs = {}) {
  const i = h('input', { class: 'field', value: get() ?? '', style: 'width:220px', spellcheck: 'false', ...attrs });
  i.oninput = () => { set(i.value); commitSoon(); };
  return i;
}
function group(title, ...rows) { return [h('div', { class: 'h2' }, title), h('div', { class: 'sgroup' }, ...rows)]; }

function orderList(list, names, onChange, hp) {
  const box = h('div', { class: 'order' });
  const draw = () => {
    box.innerHTML = '';
    list.forEach((it, i) => {
      if (!names[it.id]) return;
      box.append(h('div', { class: 'srow', ...hint(names[it.id], 'Выключи то, чем не пользуешься — остров подстроится под оставшееся. Стрелки меняют порядок.', hp) },
        h('div', { class: 'sl2' }, names[it.id]),
        h('button', { class: 'ibtn', html: '↑', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); onChange(); } }),
        h('button', { class: 'ibtn', html: '↓', disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); onChange(); } }),
        it.id === 'settings' ? h('span', { class: 'muted small', style: 'width:42px;text-align:center' }, 'всегда') : (() => { const t = h('div', { class: 'toggle' + (it.on ? ' on' : '') }); t.onclick = () => { it.on = !it.on; t.classList.toggle('on', it.on); onChange(); }; return t; })()));
    });
  };
  draw();
  return box;
}

function hotkeyInput(key) {
  const i = h('input', { class: 'field', value: S().hotkeys[key] || '', readonly: true, style: 'width:170px;cursor:pointer;text-align:center' });
  i.onfocus = () => { i.value = 'Нажми сочетание…'; };
  i.onblur = () => { i.value = S().hotkeys[key] || ''; };
  i.onkeydown = async (e) => {
    e.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.key === 'Escape') return i.blur();
    if (e.key === 'Backspace') { S().hotkeys[key] = ''; }
    else {
      const k = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      S().hotkeys[key] = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', k].filter(Boolean).join('+');
    }
    const status = await saveSettings();
    i.value = S().hotkeys[key];
    i.style.borderColor = status && S().hotkeys[key] && status[S().hotkeys[key]] === false ? 'var(--bad)' : '';
    if (status && status[S().hotkeys[key]] === false) ctx.flash({ icon: '⌨️', title: 'Это сочетание занято другой программой', ms: 2500 });
    i.blur();
  };
  return i;
}


// ---------- themes as cards: each shows a tiny island in that material ----------
const THEME_PREV = {
  mood: ['linear-gradient(120deg,#ff9a5a,#7c5cff 55%,#22d3ee)', '#0b0b12'], liquid: ['linear-gradient(120deg,#7c5cff,#22d3ee)', '#0b0b14'],
  glass: ['linear-gradient(120deg,rgba(255,255,255,.55),rgba(255,255,255,.12))', 'rgba(255,255,255,.14)'], gradient: ['linear-gradient(90deg,#7c5cff,#ff4fd8,#22d3ee)', 'linear-gradient(90deg,#3b2a7a,#6b2160,#0e4a5a)'],
  solid: ['#2a2a30', '#000'], aurora: ['linear-gradient(120deg,#22d3ee,#34d399,#7c5cff)', '#06121a'], neon: ['linear-gradient(90deg,#00e5ff,#ff2bd6)', '#05050c'],
  holo: ['linear-gradient(120deg,#a5f3fc,#f0abfc,#fde68a)', 'linear-gradient(120deg,#2b3550,#45304f)'], galaxy: ['linear-gradient(120deg,#6d28d9,#db2777)', 'radial-gradient(circle at 30% 40%,#3b1d6e,#0b0820)'],
  frost: ['linear-gradient(120deg,#e0f2fe,#93c5fd)', 'linear-gradient(#dbeafe,#a5c8f5)'], sunset: ['linear-gradient(90deg,#f97316,#ec4899)', 'linear-gradient(90deg,#3a1408,#3a0c25)'],
  ocean: ['linear-gradient(90deg,#0ea5e9,#22d3ee)', 'linear-gradient(90deg,#071a33,#0b3350)'], carbon: ['linear-gradient(90deg,#555,#999)', 'repeating-linear-gradient(45deg,#1b1b1f 0 3px,#0e0e11 3px 6px)'],
};
// what each material looks like and does, shown in the preview card when you point at it
const THEME_DESC = {
  mood: 'Остров живёт по времени суток: утром рассвет, днём море, вечером закат, ночью звёзды (по восходу и закату твоего города). И по настроению: краснеет, когда злится или случилась ошибка, голубеет, когда занят, синеет, когда думает, теплеет, когда радуется. Под музыку берёт цвет обложки.',
  liquid: 'Под тёмной поверхностью медленно переливаются три цвета, как жидкость в стекле. Цвета задаются ниже, в «Цвета» или «Готовых палитрах».',
  glass: 'Полупрозрачный остров: сквозь него видно то, что под ним, а по краю идут блики, как у стекла. Светлее и легче остальных.',
  gradient: 'По острову медленно бежит яркий градиент из твоих трёх цветов. Самый цветной из простых материалов.',
  solid: 'Чёрная пилюля как на iPhone: без переливов и анимаций фона. Самый спокойный вариант и самый лёгкий для компьютера.',
  aurora: 'Северное сияние: внутри медленно плывут зелёные, бирюзовые и сиреневые ленты света на тёмном небе.',
  neon: 'Тёмная пилюля с неоновой трубкой по краю: она светится и плавно перебирает цвета, как вывеска ночью.',
  holo: 'Голограмма: по поверхности скользит радужный блик — розовый, голубой, золотой, как на голографической наклейке.',
  galaxy: 'Глубокий космос: фиолетовые и синие туманности, а поверх мерцают звёзды.',
  frost: 'Единственный светлый материал: матовый лёд с тонким узором инея и холодным бликом сверху. Глаза на нём тёмные.',
  sunset: 'Тёплый закат: оранжевые, розовые и фиолетовые краски медленно вращаются, а книзу остров темнеет, как вечернее небо.',
  ocean: 'Глубокая синяя вода: по ней плывут голубые блики, как свет сквозь волны.',
  carbon: 'Карбон: тёмное плетение волокон с металлическим бликом сверху. Строго и без лишних цветов.',
};
function themeCards(s) {
  const list = [['mood', 'Живой'], ['liquid', 'Жидкий'], ['glass', 'Стекло'], ['gradient', 'Градиент'], ['solid', 'Классика'], ...SKIN_LIST];
  const grid = h('div', { class: 'thgrid' });
  const draw = () => {
    grid.innerHTML = '';
    for (const [id, label] of list) {
      const [rim, body] = THEME_PREV[id] || THEME_PREV.liquid;
      grid.append(h('button', { class: 'thcard' + (s.theme.style === id ? ' on' : ''), ...hint(label, THEME_DESC[id] || '', 'skin:' + id), onclick: () => {
        if (['white', 'black'].includes(s.theme.style)) s.theme.mode = s.theme.style === 'white' ? 'light' : 'dark';
        s.theme.style = id; commit(); draw();
      } },
      h('span', { class: 'thprev', 'data-th': id }, h('span', { class: 'thpill', style: { background: `${/gradient/.test(body) ? body : `linear-gradient(${body},${body})`} padding-box, ${/gradient/.test(rim) ? rim : `linear-gradient(${rim},${rim})`} border-box` } }, h('i'), h('i'))),
      h('span', { class: 'thname' }, label)));
    }
  };
  draw();
  return grid;
}

// ---------- the phone over USB: photos to the computer, files to the phone ----------
let phoneTimer = 0;
function phoneView(s) {
  const box = h('div', { class: 'phonew' });
  const list = h('div', { class: 'phdevs' });
  const draw = (devs) => {
    list.innerHTML = '';
    if (!devs?.length) {
      list.append(h('div', { class: 'phcard phnone' },
        h('div', { class: 'phplug', html: `<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="20" y="6" width="24" height="40" rx="5"/><path d="M29 11h6"/><path d="M32 46v6M26 52h12M28 52v6M36 52v6"/></svg>` }),
        h('div', { class: 'phtext' },
          h('div', { class: 'phtitle' }, 'Подключи телефон кабелем'),
          h('div', { class: 'muted' }, 'Остров заметит его сам и предложит перенести новые фото и видео. Отсюда же можно отправлять файлы на телефон.'),
          h('ol', { class: 'phsteps' },
            h('li', {}, 'Android: в уведомлении «USB» выбери «Передача файлов»'),
            h('li', {}, 'iPhone: разблокируй и нажми «Доверять этому компьютеру»'),
            h('li', {}, 'Просто зарядка без выбора режима — телефон не виден компьютеру')))));
      return;
    }
    for (const d of devs) {
      const busy = d.busy === 'import' ? 'Переношу фото…' : d.busy === 'send' ? 'Отправляю файлы…' : '';
      list.append(h('div', { class: 'phcard' },
        h('div', { class: 'phdev', html: `<svg viewBox="0 0 48 48" width="46" height="46" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="13" y="4" width="22" height="40" rx="5"/><path d="M21 9h6"/></svg>` }),
        h('div', { class: 'phtext' },
          h('div', { class: 'phtitle' }, d.name, h('span', { class: 'phok' }, busy || 'подключён')),
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
            h('button', { class: 'btn sm pri', disabled: !!d.busy, onclick: () => { api.invoke('phone:import', d.name); setTimeout(refresh, 400); } }, h('span', { html: icon('image', 14) }), ' Перенести новые фото'),
            h('button', { class: 'btn sm', disabled: !!d.busy, title: d.apple ? 'iPhone по кабелю файлы не принимает — уйдут в Telegram «Избранное»' : '', onclick: () => api.invoke('phone:send', d.name).then((r) => { if (r === 'notg') ctx?.flash?.({ icon: '✈️', title: 'Сначала войди в Telegram (раздел «Уведомления»)', ms: 3000 }); setTimeout(refresh, 400); }) }, h('span', { html: icon(d.apple ? 'telegram' : 'send', 14) }), d.apple ? ' Отправить через Telegram' : ' Отправить файлы'),
            h('button', { class: 'btn sm ghost', onclick: () => api.invoke('phone:open', d.name) }, 'Открыть'),
            h('button', { class: 'btn sm ghost', onclick: () => api.invoke('phone:folder', d.name) }, h('span', { html: icon('folder', 13) }), ' Папка с фото')))));
    }
  };
  const refresh = () => api.invoke('phone:list').then(draw).catch(() => draw([]));
  refresh();
  clearInterval(phoneTimer);
  phoneTimer = setInterval(() => { if (!list.isConnected) return clearInterval(phoneTimer); refresh(); }, 2500);
  box.append(list, ...group('Подключение',
    row('Следить за телефоном', 'по USB-кабелю', toggle(() => s.phone?.enabled !== false, (v) => { s.phone = { ...(s.phone || {}), enabled: v }; }), 'Телефон', 'Остров видит телефон, подключённый кабелем, как его видит Проводник. Фото и видео копируются в «Изображения\\Island\\<телефон>», уже перенесённые второй раз не копируются.'),
    row('Предлагать перенести фото', 'когда подключаешь телефон', toggle(() => s.phone?.askOnConnect !== false, (v) => { s.phone = { ...(s.phone || {}), askOnConnect: v }; }), 'При подключении', 'Подключил телефон — остров покажет его и спросит, перенести ли новые фото и видео.')));
  return box;
}

let tgAskBox = null;
let tgDraft = { phone: '', code: '', password: '' }; // typed values survive redraws
function render() {
  const s = S();
  const parts = {};
  const add = (id, ...nodes) => (parts[id] ||= []).push(...nodes);


  // appearance
  const colors = h('div', { class: 'row' }, ...s.theme.colors.map((c, i) => {
    const sw = h('label', { class: 'swatch', style: { background: c } });
    const inp = h('input', { type: 'color', value: c });
    inp.oninput = () => { s.theme.colors[i] = inp.value; sw.style.background = inp.value; bus.emit('settings', s); commitSoon(); };
    sw.append(inp);
    return sw;
  }));
  const presets = h('div', { class: 'presets' }, ...PRESETS.map((p) => h('div', { class: 'preset', style: { background: `linear-gradient(90deg, ${p.join(',')})` }, onclick: () => { s.theme.colors = [...p]; commit(); render(); showHint('Палитры', 'Нажми — и остров перекрасится целиком.', 'colors', true); } })));
  add('look', ...group('Внешний вид',
    rowWide('Тема', 'светлая или тёмная', pics([['dark', 'Тёмная', ART.dark], ['light', 'Светлая', ART.light]], () => s.theme.mode, (v) => (s.theme.mode = v)), 'Тема', `Цвет самого острова. Переключается одной клавишей: ${s.hotkeys.themeToggle}.`),
    rowWide('Тема острова', null, themeCards(s), 'Материал острова', 'Аврора, Неон, Голограмма, Галактика, Иней, Закат, Океан и Карбон — живые оформления со своей анимацией и цветами. По умолчанию — остров живёт по времени суток (утром рассвет, днём море, вечером закат, ночью звёзды — по восходу и закату твоего города) и меняет цвет по настроению: красный, когда злится или случилась ошибка, фиолетовый, когда сонный, голубой, когда занят, синий, когда думает, тёплый, когда радуется, и цвет обложки под музыку. Жидкий — цветные переливы под тёмной поверхностью. Стекло — полупрозрачный с бликами. Градиент — бегущий цветной градиент. Сплошной — классическая чёрная пилюля.'),
    row('Цвета', 'три цвета переливов и ободка', colors, 'Цвета', 'Из этих цветов собираются жидкие переливы, градиент и светящийся ободок острова.'),
    rowWide('Готовые палитры', null, presets, 'Палитры', 'Нажми — и остров перекрасится целиком.'),
    row('Край в цвет обложки', null, toggle(() => s.theme.coverGlow, (v) => (s.theme.coverGlow = v)), 'Цвет обложки', 'Когда играет музыка, край острова светится главным цветом обложки трека.'),
    row('Края как вода', 'тянутся к курсору, идут рябью', toggle(() => s.theme.water !== false, (v) => (s.theme.water = v)), 'Жидкие края', 'Край острова ведёт себя как поверхность воды: тянется к подведённому курсору, расходится рябью, когда входишь в остров, и слегка колышется в покое.'),
    row('Волны под музыку', 'свечение снизу и круги', toggle(() => s.theme.edgeDance, (v) => (s.theme.edgeDance = v)), 'Волны под музыку', 'Пока играет трек, низ острова светится цветом обложки, а на каждый удар баса край вздрагивает и от него расходятся светящиеся круги, как по воде.'),
    row('Остров тянется к курсору', null, toggle(() => s.theme.reactive, (v) => (s.theme.reactive = v)), 'Реакция на движения', 'Когда подводишь мышь, остров слегка наклоняется и тянется к ней, как живой.'),
    row('Размер', null, range(0.85, 1.3, 0.05, () => s.theme.scale, (v) => (s.theme.scale = v)), 'Размер', 'Масштаб компактной пилюли.')));

  const glowColor = (() => {
    const auto = h('button', { class: 'btn sm' + (s.theme.glowColor ? '' : ' pri') }, 'Авто');
    const sw = h('label', { class: 'swatch', style: { background: s.theme.glowColor || 'conic-gradient(#ff4fd8, #7c5cff, #00d4ff, #34d399, #ffd23f, #ff4fd8)' } });
    const inp = h('input', { type: 'color', value: s.theme.glowColor || '#7c5cff' });
    inp.oninput = () => { s.theme.glowColor = inp.value; sw.style.background = inp.value; auto.classList.remove('pri'); bus.emit('settings', s); commitSoon(); };
    auto.onclick = () => { s.theme.glowColor = ''; auto.classList.add('pri'); sw.style.background = 'conic-gradient(#ff4fd8, #7c5cff, #00d4ff, #34d399, #ffd23f, #ff4fd8)'; commit(); };
    sw.append(inp);
    return h('div', { class: 'row' }, auto, sw);
  })();
  add('look', ...group('Свечение',
    row('Сила свечения', 'ореол и ободок', range(0, 1.5, 0.05, () => s.theme.glow, (v) => (s.theme.glow = v)), 'Свечение', 'Насколько ярко светится край острова и ореол вокруг него.'),
    row('Цвет свечения', 'авто — по теме, настроению и обложке', glowColor, 'Цвет свечения', 'Авто: свечение берёт цвет темы, настроения персонажа и обложки трека. Или выбери один свой цвет.'),
    row('Свет за курсором', null, toggle(() => s.theme.cursorGlow, (v) => (s.theme.cursorGlow = v)), 'Свет за курсором', 'Мягкий блик по поверхности острова следует за мышью, а ободок разгорается, когда курсор рядом.'),
    row('Яркость света у курсора', null, range(0, 1.5, 0.05, () => s.theme.cursorGlowK ?? 1, (v) => (s.theme.cursorGlowK = v)), 'Свет у курсора', 'Насколько ярко ободок и волны вспыхивают рядом с мышью.'),
    row('Свечение под музыку', 'низ острова и круги', range(0, 1.5, 0.05, () => s.theme.musicGlowK ?? 1, (v) => (s.theme.musicGlowK = v)), 'Свечение под музыку', 'Яркость цветного свечения снизу острова, пока играет трек.')));

  const EMOTIONS = [
    ['', 'Спокоен', 'Обычное состояние, когда ничего не происходит. Следит за курсором, моргает, иногда сам делает трюки.'],
    ['joy', 'Радуется', 'Агент (Claude / Codex) закончил задачу.'],
    ['love', 'Влюблён', 'Погладь его: спокойно поводи мышью влево-вправо прямо над глазами 3 раза.'],
    ['shy', 'Смущается', 'Ткни в остров два раза подряд (через раз).'],
    ['laugh', 'Смеётся', 'Пощекочи: очень быстро поводи мышью по острову.'],
    ['excited', 'В восторге', 'Закончилась загрузка файла.'],
    ['idea', 'Придумал', 'Распознан текст со скриншота или перевод готов; ИИ дал ответ (в режиме API-ключей).'],
    ['ponder', 'Размышляет', 'Работает агент Claude / Codex или ИИ готовит ответ.'],
    ['busy', 'Занят', 'Идёт загрузка файла.'],
    ['dance', 'Танцует', 'Играет музыка — качается и кивает в такт.'],
    ['call', 'Разговаривает', 'Ты в звонке — Zoom, Telegram или Discord. Слушает и кивает, рядом трубка.'],
    ['confused', 'Не понял', 'Остров не понял команду, например время в напоминании.'],
    ['startle', 'Удивлён', 'Пришло уведомление; ты тянешь файл на остров.'],
    ['scared', 'Испугался', 'Ткни в остров три раза подряд.'],
    ['sad', 'Грустит', 'Пока только по кнопке «Показать».'],
    ['angry', 'Злится', 'Ошибка; или ткни в остров 4 раза подряд.'],
    ['bored', 'Скучает', 'Тебя нет около минуты.'],
    ['sleepy', 'Сонный', 'Тебя нет пару минут (ночью — раньше).'],
    ['sleep', 'Спит', 'Тебя нет дольше, чем указано в «Засыпать через». Пошевели мышью — проснётся и потянется.'],
  ];
  // ★ — the favourite: the character stays in it when nothing else is going on
  const NO_FAV = new Set(['call', 'startle', 'sleep']); // these only make sense as reactions
  const fav = s.island.favMood || '';
  add('island', ...group('Эмоции — как вызвать',
    h('div', { class: 'mnote', style: 'padding:8px 12px 2px' }, '★ — любимая эмоция: в ней персонаж находится по умолчанию, когда ничего не происходит. Сон, музыка, звонки и реакции работают как обычно.'),
    ...EMOTIONS.map(([id, name, how]) => h('div', { class: 'srow emo-row' + (id === fav ? ' fav' : ''), ...hint(name, how) },
      h('div', { class: 'emo-prev', html: pill({ cls: 'emo', content: eyesMini(id ? 'e-' + id : '') }) }),
      h('div', { class: 'sl2' }, name, id === fav ? h('span', { class: 'favtag' }, 'по умолчанию') : '', h('small', {}, how)),
      h('div', { class: 'row', style: 'gap:6px;flex:none' },
        NO_FAV.has(id) ? '' : h('button', { class: 'favbtn' + (id === fav ? ' on' : ''), title: id === fav ? 'Это любимая эмоция' : 'Сделать любимой — персонаж будет в ней по умолчанию', onclick: () => { s.island.favMood = id; commit(); render(); } }, '★'),
        id ? h('button', { class: 'btn sm', onclick: () => api.invoke('island:mood', 'mood-' + id) }, 'Показать') : '')))));

  add('island', ...group('Персонаж',
    rowWide('Трюки сами по себе', 'крутится, прыгает, подмигивает', pics([['off', 'Выкл', ART.sparks(0)], ['rare', 'Редко', ART.sparks(1)], ['normal', 'Обычно', ART.sparks(2)], ['often', 'Часто', ART.sparks(3)]], () => s.island.trickRate || 'normal', (v) => (s.island.trickRate = v)), 'Трюки', 'Как часто персонаж сам что-то вытворяет, когда ничего не происходит: крутится, прыгает, подмигивает, хихикает, выглядывает, пускает сердечки.'),
    row('Реагирует на курсор', 'любопытство и смущение', toggle(() => s.island.cursorReactions !== false, (v) => (s.island.cursorReactions = v)), 'Реакции на курсор', 'Глаза увеличиваются, когда мышь подходит близко; смущается, если медленно подвести курсор или задержать его на острове.'),
    row('Тянется к курсору', 'из центра — ближе к мыши', toggle(() => s.island.walk !== false, (v) => (s.island.walk = v)), 'Тянется к курсору', 'Персонаж стоит по центру, а когда мышь рядом — тянется к ней, слегка вытягиваясь, и мягко возвращается обратно.'),
    row('Эффекты над головой', 'загрузка, лампочка, ноты…', toggle(() => s.island.moodFx !== false, (v) => (s.island.moodFx = v)), 'Эффекты', 'Значки над персонажем: колечко загрузки, когда думает, точки, когда занят, лампочка, ноты, zZ, сердечки, искры радости.'),
    row('Цвет глаз', s.island.eyeScope === 'all' ? 'для всех эмоций' : 'в спокойном настроении', h('div', { class: 'row' }, h('button', { class: 'btn sm' + (s.island.eyeColor ? '' : ' pri'), onclick: () => { s.island.eyeColor = ''; commit(); render(); } }, 'Авто'), (() => { const sw = h('label', { class: 'swatch', style: { background: s.island.eyeColor || '#ffffff' } }); const inp = h('input', { type: 'color', value: s.island.eyeColor || '#ffffff' }); inp.oninput = () => { s.island.eyeColor = inp.value; sw.style.background = inp.value; bus.emit('settings', s); commitSoon(); }; sw.append(inp); return sw; })()), 'Цвет глаз', 'Авто — белые на тёмном острове и тёмные на светлом (у робота, пришельца и других — свой цвет).'),
    rowWide('Где действует цвет глаз', null, pics([['calm', 'Только спокойный', ART.eyesCalm], ['all', 'Все эмоции', ART.eyesAll]], () => s.island.eyeScope || 'calm', (v) => (s.island.eyeScope = v)), 'Где действует цвет глаз', 'Только спокойный — твой цвет, пока персонаж спокоен, а эмоции красят глаза по-своему (сонный — фиолетовый, злой — красный…). Все эмоции — глаза всегда твоего цвета, меняются только форма и движения. Работает, когда выбран свой цвет, не «Авто».'),
    rowWide('Чувствительность к битам', 'как часто дёргается под музыку', pics([['low', 'Низкая', ART.level(1)], ['normal', 'Обычная', ART.level(2)], ['high', 'Высокая', ART.level(3)]], () => s.theme.beatSens || 'normal', (v) => (s.theme.beatSens = v)), 'Биты', 'Высокая — край, волны и персонаж реагируют почти на каждый удар; низкая — только на сильные.')));

  add('island', ...group('Поведение',
    row('Мини-остров через', 'сколько держать курсор', range(0.6, 4, 0.1, () => s.island.miniDelay ?? 1.5, (v) => (s.island.miniDelay = v)), 'Мини-остров', 'Если задержать курсор на острове на это время, откроется мини-остров (плеер или часы с быстрыми действиями).'),
    row('Кружков активностей сбоку', null, range(1, 6, 1, () => s.island.maxBubbles ?? 4, (v) => (s.island.maxBubbles = v)), 'Кружки', 'Сколько активностей одновременно показывать кружками справа от острова.'),
    row('Прятать жестом вверх', 'зажми остров и потяни вверх', toggle(() => s.island.swipeHide !== false, (v) => (s.island.swipeHide = v)), 'Жест вверх', 'Зажми остров и потяни вверх — он спрячется. Чтобы вернуть, уведи курсор и снова подведи его к центру верхнего края экрана.')));

  add('island', ...group('Остров',
    rowWide('Кто живёт на острове', null, pics([['eyes', 'Глаза', ART.char('eyes')], ['cat', 'Котик', ART.char('cat')], ['bunny', 'Зайка', ART.char('bunny')], ['robot', 'Робот', ART.char('robot')], ['ghost', 'Призрак', ART.char('ghost')], ['alien', 'Пришелец', ART.char('alien')], ['angel', 'Ангел', ART.char('angel')], ['frog', 'Лягушка', ART.char('frog')], ['devil', 'Чертёнок', ART.char('devil')], ['buddies', 'Человечки', ART.char('buddies')], ['none', 'Никого', ART.char('none')]], () => s.island.character, (v) => (s.island.character = v)), 'Характер', 'У глаз есть эмоции: следят за курсором, танцуют под музыку, думают, пока отвечает ИИ, заняты, пока работает агент или идёт загрузка, радуются готовому, вздрагивают от уведомлений, злятся на ошибки и если их тыкать, становятся сонными и засыпают, когда тебя долго нет. Человечки ещё и раскачиваются в такт.'),
    row('Плеер на острове', 'трек в пилюле и мини-плеер', toggle(() => s.island.showPlayer !== false, (v) => (s.island.showPlayer = v)), 'Плеер на острове', 'Показывать играющий трек в пилюле, в капле и в мини-острове. Если выключить, плеер пропадёт с острова, но остров всё равно будет танцевать под музыку: края, волны, свечение и глаза.'),
    row('Секунды в часах', null, toggle(() => s.island.showSeconds, (v) => (s.island.showSeconds = v))),
    row('Прятать в полноэкранном режиме', 'фильмы и игры', toggle(() => s.island.hideOnFullscreen, (v) => (s.island.hideOnFullscreen = v)), 'Полноэкранный режим', 'Когда смотришь кино или играешь на весь экран, остров уезжает за край. Подведи мышь к центру верхнего края — и он появится.'),
    row('Засыпать через, мин', 'без активности', text(() => s.island.sleepAfterMin, (v) => (s.island.sleepAfterMin = +v || 5), { type: 'number', style: 'width:70px' }), 'Сон', 'Через сколько минут бездействия персонажи засыпают.'),
    row('Запускать вместе с Windows', null, toggle(() => s.island.autostart, (v) => (s.island.autostart = v)))));

  add('layout', ...group('Вкладки', orderList(s.tabs, TAB_NAMES, () => { commit(); ctx.rebuild(); }, 'tabs')));
  // Home has its own section: which tiles and in what order, the quick actions, how the tiles look
  add('home', ...group('Плитки', orderList(s.home, WIDGET_NAMES, commit, 'home')));
  s.homeLook = s.homeLook || {};
  add('home', ...group('Вид',
    row('Плитки на всю высоту', 'растянутый остров заполняется целиком', toggle(() => s.homeLook.fill !== false, (v) => (s.homeLook.fill = v)), 'Плитки на всю высоту', 'Когда растягиваешь остров, плитки главной растут вместе с ним и занимают всё место, без пустоты внизу.'),
    row('Виндик в пустом плеере', 'когда ничего не играет', toggle(() => s.homeLook.npChar !== false, (v) => (s.homeLook.npChar = v)), 'Виндик в плеере', 'Когда музыка не играет, в плеере дремлет Виндик. Можно убрать — останется только подсказка.')));
  const qa = h('div', { class: 'chips', style: 'padding:10px' }, ...Object.entries(QUICK).map(([id, q]) => {
    const b = h('button', { class: 'chip' + (s.quickActions.includes(id) ? ' on' : '') }, ...chipBody(id, q.label));
    b.onclick = () => { s.quickActions = s.quickActions.includes(id) ? s.quickActions.filter((x) => x !== id) : [...s.quickActions, id]; b.classList.toggle('on'); commit(); };
    return b;
  }));
  add('home', ...group('Быстрые действия', h('div', hint('Быстрые действия', 'Кнопки на главной. Выбери нужные — область скрина, пипетка, QR, перевод с экрана и другие.'), qa)));
  const ct = h('div', { class: 'chips', style: 'padding:10px' }, ...Object.entries(TILES).map(([id, t]) => {
    const b = h('button', { class: 'chip' + (s.controlTiles.includes(id) ? ' on' : '') }, ...chipBody(id, t.label));
    b.onclick = () => { s.controlTiles = s.controlTiles.includes(id) ? s.controlTiles.filter((x) => x !== id) : [...s.controlTiles, id]; b.classList.toggle('on'); commit(); };
    return b;
  }));
  // pick up to `max` items; the newest choice pushes out the oldest
  const pick = (items, key, max, hd) => h('div', hint(hd[0], hd[1]), h('div', { class: 'chips', style: 'padding:6px 10px 10px' }, ...items.map(([id, label]) => {
    const cur = () => s[key] ?? CC_DEFAULTS[key] ?? [];
    const b = h('button', { class: 'chip' + (cur().includes(id) ? ' on' : '') }, ...chipBody(id, label));
    b.onclick = () => {
      const c = [...cur()];
      s[key] = c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-max);
      for (const x of b.parentNode.children) x.classList.toggle('on', s[key].includes(x._id));
      commit();
    };
    b._id = id;
    return b;
  })));
  const blk = (k, label, sub, hd) => row(label, sub, toggle(() => (s.ccBlocks || {})[k] !== false, (v) => { s.ccBlocks = { ...CC_DEFAULTS.ccBlocks, ...(s.ccBlocks || {}), [k]: v }; }), label, hd);
  const toggles = TOGGLE_IDS.filter((id) => TILES[id]).map((id) => [id, TILES[id].label]);
  add('actions', ...group('Центр управления — блоки',
    blk('net', 'Связь', 'четыре круглые кнопки', 'Блок с круглыми кнопками: Wi-Fi, Bluetooth, VPN и т.д. Нажатие на название открывает подробности.'),
    blk('media', 'Сейчас играет', 'обложка и кнопки трека', 'Карточка с текущим треком, обложкой и кнопками.'),
    blk('focus', 'Не беспокоить', 'большая кнопка фокуса', 'Широкая кнопка режима «Не беспокоить».'),
    blk('squares', 'Квадратные кнопки', 'две быстрые плитки', 'Две квадратные кнопки рядом с «Не беспокоить».'),
    blk('sliders', 'Большие ползунки', 'громкость и яркость', 'Высокие ползунки как в iPhone: тяни или крути колёсиком.'),
    blk('quick', 'Быстрые действия', 'четыре большие кнопки', 'Скриншот области, пипетка, QR, таймер и другие — до четырёх.'),
    blk('tiles', 'Свои плитки', 'добавляются через «Изменить»', 'Дополнительные плитки под основными блоками.'),
    blk('mixer', 'Громкость приложений', 'микшер', 'Отдельная громкость и кнопка «заглушить» для каждого приложения, которое сейчас играет звук.'),
    blk('power', 'Питание', 'блокировка, сон, перезагрузка…', 'Кнопки блокировки, сна, перезагрузки и выключения.')));
  add('actions', ...group('Центр управления — что внутри',
    pick(toggles, 'ccNet', 4, ['Кнопки связи', 'Какие четыре круглые кнопки показывать в блоке «Связь».']),
    h('div', { class: 'muted small', style: 'padding:0 12px' }, 'Круглые кнопки (до 4)'),
    pick(toggles, 'ccSquares', 2, ['Квадратные кнопки', 'Две квадратные кнопки рядом с «Не беспокоить».']),
    h('div', { class: 'muted small', style: 'padding:0 12px' }, 'Квадратные кнопки (до 2)'),
    pick(Object.entries(QUICK).filter(([, q]) => !q.toggle).map(([id, q]) => [id, q.label]), 'controlQuick', 4, ['Быстрые действия центра', 'Четыре большие кнопки в центре управления.']),
    h('div', { class: 'muted small', style: 'padding:0 12px' }, 'Быстрые действия (до 4)'),
    pick(POWER.map(([id, label]) => [id, label]), 'ccPower', 4, ['Питание', 'Какие кнопки питания показывать.']),
    h('div', { class: 'muted small', style: 'padding:0 12px 6px' }, 'Кнопки питания'),
    row('Спрашивать «Точно?»', 'перед сном, перезагрузкой и выключением', toggle(() => s.ccConfirm !== false, (v) => (s.ccConfirm = v)), 'Подтверждение', 'Первое нажатие на сон, перезагрузку или выключение только спрашивает «Точно?», второе — выполняет.')));
  add('actions', ...group('Центр управления', h('div', hint('Плитки', 'Что показывать в центре управления. Например, убери Wi-Fi и поставь «Не засыпать».'), ct),
    row('Громкость', null, toggle(() => s.controlSliders.includes('volume'), (v) => (s.controlSliders = v ? [...new Set([...s.controlSliders, 'volume'])] : s.controlSliders.filter((x) => x !== 'volume')))),
    row('Яркость', 'только ноутбуки и мониторы с DDC', toggle(() => s.controlSliders.includes('brightness'), (v) => (s.controlSliders = v ? [...new Set([...s.controlSliders, 'brightness'])] : s.controlSliders.filter((x) => x !== 'brightness'))))));

  // AI
  const keyRow = (id, label, url) => row(label, null, h('div', { class: 'row' }, text(() => s.ai.keys[id], (v) => (s.ai.keys[id] = v.trim()), { type: 'password', placeholder: 'API-ключ', style: 'width:180px' }), h('button', { class: 'btn sm ghost', onclick: () => api.invoke('url:open', url) }, 'Получить')), label, `Ключ хранится только на этом компьютере (%APPDATA%\\Island\\settings.json). Получить: ${url}`);
  add('ai', ...group('ИИ',
    rowWide('Как подключаться', null, pics([['web', 'Через аккаунт', ART.web], ['api', 'API-ключи', ART.api]], () => s.ai.mode || 'web', (v) => (s.ai.mode = v)), 'Подключение', 'Через аккаунт — на вкладке ИИ открываются настоящие сайты Gemini, DeepSeek и ChatGPT, ты входишь в свой аккаунт (например Google), и никакие ключи не нужны. Вопросы из Alt+Space отправляются туда же. API-ключи — свой чат внутри острова с выбором модели и файлами.'),
    rowWide('Нейросеть по умолчанию', null, pics([['gemini', 'Gemini', ART.logo('G', 'linear-gradient(135deg,#4285f4,#9b72cb,#d96570)')], ['deepseek', 'DeepSeek', ART.logo('D', 'linear-gradient(135deg,#4d6bfe,#2a3fb8)')], ['openai', 'ChatGPT', ART.logo('C', 'linear-gradient(135deg,#10a37f,#0b7a5f)')], ['ollama', 'Ollama', ART.logo('O', 'linear-gradient(135deg,#555,#222)')]], () => s.ai.provider, (v) => (s.ai.provider = v)), 'Нейросеть', 'Кто отвечает в Alt+Space и в быстрых ИИ-действиях. В чате можно выбрать любую. Ollama — локальные модели без интернета и ключей.'),
    keyRow('gemini', 'Ключ Gemini', 'https://aistudio.google.com/apikey'),
    keyRow('deepseek', 'Ключ DeepSeek', 'https://platform.deepseek.com/api_keys'),
    keyRow('openai', 'Ключ ChatGPT (OpenAI)', 'https://platform.openai.com/api-keys'),
    row('Модель Gemini', null, text(() => s.ai.models.gemini, (v) => (s.ai.models.gemini = v.trim()), { style: 'width:180px' })),
    row('Модель DeepSeek', null, text(() => s.ai.models.deepseek, (v) => (s.ai.models.deepseek = v.trim()), { style: 'width:180px' })),
    row('Модель ChatGPT', null, text(() => s.ai.models.openai, (v) => (s.ai.models.openai = v.trim()), { style: 'width:180px' })),
    row('Модель Ollama', null, text(() => s.ai.models.ollama, (v) => (s.ai.models.ollama = v.trim()), { style: 'width:180px' })),
    row('Адрес Ollama', null, text(() => s.ai.ollamaUrl, (v) => (s.ai.ollamaUrl = v.trim()), { style: 'width:180px' })),
    row('Инструкция для ИИ', null, (() => { const t = h('textarea', { class: 'field', rows: 3, style: 'width:260px' }); t.value = s.ai.system; t.oninput = () => { s.ai.system = t.value; commitSoon(); }; return t; })(), 'Системная инструкция', 'Как ИИ должен себя вести во всех чатах острова.')));

  add('weather', ...group('Погода',
    row('Город', 'пусто — определить по IP', text(() => s.weather.city, (v) => (s.weather.city = v)), 'Город', 'Напиши город, например «Москва». Если оставить пустым, место определится автоматически по IP.'),
    row('Предупреждать о дожде', null, toggle(() => s.weather.rainAlerts, (v) => (s.weather.rainAlerts = v)), 'Дождь', 'Остров сам скажет примерно за 15–120 минут до начала дождя.'),
    row('Обновить сейчас', null, h('button', { class: 'btn sm', onclick: () => { saveSettings().then(() => api.invoke('weather:refresh')); ctx.flash({ icon: '⛅', title: 'Обновляю погоду…', ms: 1500 }); } }, 'Обновить'))));

  // notifications + telegram
  tgAskBox = h('div');
  const tgStatus = h('span', { class: 'muted small tgst' }, tgStatusText());
  // sounds
  const snd = (s.sounds ||= { enabled: true, volume: 0.6, quietInDnd: true });
  snd.events ||= {}; snd.custom ||= {};
  const fileName = (p) => (p ? p.split(/[\\/]/).pop() : '');
  const soundRow = ([id, label, def]) => {
    const sel = h('select', { class: 'field', style: 'width:150px;height:30px' }, ...SOUNDS.map(([v, l]) => h('option', { value: v }, l)));
    sel.value = snd.events[id] || def;
    const name = h('small', { class: 'muted', style: 'max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, snd.events[id] === 'custom' ? fileName(snd.custom[id]) : '');
    const file = h('input', { type: 'file', accept: 'audio/*', style: 'display:none' });
    file.onchange = () => {
      const f = file.files?.[0];
      const pth = f && api.pathOf(f);
      if (pth) { snd.custom[id] = pth; snd.events[id] = 'custom'; sel.value = 'custom'; name.textContent = fileName(pth); commit(); playSound(id, { preview: true }); }
      else sel.value = snd.events[id] || def;
    };
    sel.onchange = () => {
      if (sel.value === 'custom' && !snd.custom[id]) return file.click();
      snd.events[id] = sel.value;
      name.textContent = sel.value === 'custom' ? fileName(snd.custom[id]) : '';
      commit();
      playSound(id, { preview: true });
    };
    return row(label, null, h('div', { class: 'row', style: 'gap:6px;flex:none' }, name, sel,
      h('button', { class: 'ibtn', title: 'Послушать', html: icon('play', 14), onclick: () => playSound(id, { preview: true }) }),
      h('button', { class: 'ibtn', title: 'Выбрать свой звуковой файл', html: icon('folder', 14), onclick: () => file.click() }), file),
      label, 'Выбери звук из списка или свой файл (mp3, wav, ogg). Кнопка ▶ — послушать.');
  };
  add('sounds', ...group('Звуки',
    row('Звуки острова', null, toggle(() => snd.enabled !== false, (v) => (snd.enabled = v)), 'Звуки', 'Остров озвучивает события: таймер, напоминания, уведомления, работу агентов, звонки, скриншоты.'),
    row('Громкость', null, range(0, 1, 0.05, () => snd.volume ?? 0.6, (v) => (snd.volume = v)), 'Громкость', 'Общая громкость звуков острова.'),
    row('Тише в «Не беспокоить»', 'таймер и напоминания всё равно звучат', toggle(() => snd.quietInDnd !== false, (v) => (snd.quietInDnd = v)), 'Не беспокоить', 'Когда включено «Не беспокоить», остров молчит — кроме таймера и напоминаний.')));
  add('sounds', ...group('Какой звук на что', ...SOUND_EVENTS.map(soundRow)));

  add('phone', phoneView(s));

  add('notify', ...group('Уведомления',
    row('Уведомления Windows', 'показывать на острове', toggle(() => s.notifications.windows, (v) => (s.notifications.windows = v)), 'Windows', 'Остров читает новые уведомления Windows и показывает их у себя.'),
    row('Не беспокоить', 'остров молчит', toggle(() => s.dnd, (v) => (s.dnd = v)), 'Не беспокоить', 'Уведомления копятся тихо, персонажи не вздрагивают. Напоминания всё равно сработают.'),
    row('Caps Lock', 'показывать, когда включён', toggle(() => s.notifications.capsLock !== false, (v) => (s.notifications.capsLock = v)), 'Caps Lock', 'Нажал Caps Lock — остров на секунду покажет, что теперь буквы заглавные (и когда выключил).'),
    row('Num Lock', null, toggle(() => !!s.notifications.numLock, (v) => (s.notifications.numLock = v)), 'Num Lock', 'То же для Num Lock: цифры или стрелки на боковой клавиатуре.'),
    row('Агенты пробивают «Не беспокоить»', null, toggle(() => s.notifications.agentsBypassDnd, (v) => (s.notifications.agentsBypassDnd = v)), 'Агенты', 'Если Claude Code ждёт твоего ответа, остров позовёт даже в режиме тишины.'),
    row('Telegram', 'личные сообщения на острове', h('div', { class: 'row' }, tgStatus, toggle(() => s.notifications.telegram, (v) => (s.notifications.telegram = v))), 'Telegram', 'Подключается как твой собственный клиент (как ещё один Telegram Desktop): сообщения на острове и имя с аватаркой у голосовых в плеере. Войти можно по QR-коду с телефона или по номеру. Нужны api_id и api_hash с my.telegram.org — один раз, это бесплатно.'),
    row('api_id', null, text(() => s.telegram.apiId, (v) => (s.telegram.apiId = v.trim()), { style: 'width:160px' })),
    row('api_hash', null, h('div', { class: 'row' }, text(() => s.telegram.apiHash, (v) => (s.telegram.apiHash = v.trim()), { type: 'password', style: 'width:160px' }), h('button', { class: 'btn sm ghost', onclick: () => api.invoke('url:open', 'https://my.telegram.org/apps') }, 'Где взять'))),
    row('Только личные и упоминания', null, toggle(() => s.telegram.onlyPrivate, (v) => (s.telegram.onlyPrivate = v))),
    tgAskBox));
  renderTg();

  // the mini Telegram's own look
  const tu = (s.tgui ||= { accent: '#7c5cff', bubbles: 'round', size: 'm', wallpaper: 'theme', avatars: true, openOnClick: true });
  const ACC = ['#7c5cff', '#2aabee', '#34c759', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#8e8e93'];
  const accRow = h('div', { class: 'row', style: 'gap:6px' },
    ...ACC.map((c) => h('button', { class: 'tgsw' + (tu.accent === c ? ' on' : ''), style: { background: c }, title: c, onclick: () => { tu.accent = c; commit(); render(); } })),
    (() => { const sw = h('label', { class: 'swatch', title: 'Свой цвет', style: { background: ACC.includes(tu.accent) ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : tu.accent } }); const inp = h('input', { type: 'color', value: tu.accent || '#7c5cff' }); inp.oninput = () => { tu.accent = inp.value; sw.style.background = inp.value; bus.emit('settings', s); commitSoon(); }; sw.append(inp); return sw; })());
  add('tg', ...group('Мини-Telegram',
    row('Цвет моих сообщений', null, accRow, 'Цвет', 'Пузыри твоих сообщений, кнопки и отметки непрослушанных голосовых.'),
    rowWide('Форма сообщений', null, pics([['round', 'Скруглённые', ART.bubble('10px')], ['sharp', 'Строгие', ART.bubble('3px')], ['capsule', 'Капсулы', ART.bubble('20px')]], () => tu.bubbles || 'round', (v) => (tu.bubbles = v)), 'Форма', 'Скруглённые — как в мессенджерах, строгие — почти прямоугольные, капсулы — полностью круглые края.'),
    rowWide('Размер текста', null, pics([['s', 'Мелкий', ART.size(13)], ['m', 'Обычный', ART.size(17)], ['l', 'Крупный', ART.size(22)]], () => tu.size || 'm', (v) => (tu.size = v)), 'Размер текста', 'Текст сообщений и поля ввода.'),
    rowWide('Фон чата', null, pics([['theme', 'Как остров', ART.wall('linear-gradient(135deg,#2a1d5c,#0e3b4a)')], ['aurora', 'Аврора', ART.wall('linear-gradient(135deg,#0f766e,#4c1d95)')], ['dots', 'Точки', ART.wall('radial-gradient(circle,rgba(255,255,255,.25) 1px,transparent 1.5px) 0 0/8px 8px,#1b1b22')], ['none', 'Без фона', ART.wall('#15151a')]], () => tu.wallpaper || 'theme', (v) => (tu.wallpaper = v)), 'Фон чата', 'Как остров — мягкие пятна цветов твоего оформления. Аврора — северное сияние. Точки — спокойная сетка.'),
    row('Аватарки', null, toggle(() => tu.avatars !== false, (v) => (tu.avatars = v)), 'Аватарки', 'Фото чатов в списке и в заголовке.'),
    row('Уведомление открывает чат', null, toggle(() => tu.openOnClick !== false, (v) => (tu.openOnClick = v)), 'Открывать чат', 'Нажми на уведомление Telegram на острове — откроется этот чат с полем для ответа.')));

  // agents
  const inst = state.agentsInstalled || {};
  add('agents', ...group('Агенты в терминале',
    row('Claude Code', inst.claude ? 'подключён' : 'не подключён', h('div', { class: 'row' },
      h('button', { class: 'btn sm' + (inst.claude ? '' : ' pri'), onclick: async () => { const f = await api.invoke('agents:install', 'claude'); state.agentsInstalled = await api.invoke('agents:status'); ctx.flash({ icon: '✳', title: 'Хуки добавлены в ' + f, ms: 3000 }); render(); } }, inst.claude ? 'Переустановить' : 'Подключить'),
      inst.claude ? h('button', { class: 'btn sm ghost', onclick: async () => { await api.invoke('agents:uninstall'); state.agentsInstalled = await api.invoke('agents:status'); render(); } }, 'Отключить') : ''),
      'Claude Code', 'Добавляет хуки в ~/.claude/settings.json (старая версия сохраняется рядом). Остров покажет, что агент трудится, позовёт, когда нужен ответ, и отметит готовую задачу. На запросы разрешений и вопросы можно отвечать прямо с острова. Перезапусти Claude Code после подключения.'),
    row('Codex', inst.codex ? 'подключён' : 'уведомление о готовности', h('button', { class: 'btn sm', onclick: async () => { const r = await api.invoke('agents:install', 'codex'); state.agentsInstalled = await api.invoke('agents:status'); ctx.flash({ icon: '✳', title: r.skipped || 'Codex подключён', ms: 3500 }); render(); } }, inst.codex ? 'Готово' : 'Подключить'), 'Codex', 'Добавляет notify в ~/.codex/config.toml: остров отметит, когда Codex закончил ход.')));

  const hk = (k, label, d) => row(label, null, hotkeyInput(k), label, d + ' Нажми на поле и сочетание клавиш. Backspace — убрать.');
  add('keys', ...group('Горячие клавиши',
    hk('palette', 'Командная строка', 'Одна строка на всё: программы, файлы, расчёты, валюты, таймеры, вопросы к ИИ.'),
    hk('themeToggle', 'Светлая / тёмная тема', 'Переключить тему острова одной клавишей.'),
    hk('region', 'Скриншот области', 'Выделить область, нарисовать, заблюрить и скопировать.'),
    hk('island', 'Раскрыть остров', 'Открыть или закрыть остров с клавиатуры.')));

  add('app', ...group('Файлы',
    row('Папка загрузок', 'пусто — стандартная', text(() => s.downloadsDir, (v) => (s.downloadsDir = v.trim())), 'Загрузки', 'Остров следит за этой папкой и показывает идущие и завершённые загрузки браузера.')));

  add('app', ...group('Приложение',
    h('div', { class: 'srow' }, h('button', { class: 'btn sm', onclick: () => api.invoke('app:relaunch') }, 'Перезапустить'), h('button', { class: 'btn sm ghost', onclick: async () => { state.settings = await api.invoke('settings:reset'); ctx.rebuild(); render(); } }, 'Сбросить настройки'), h('div', { class: 'grow' }), h('button', { class: 'btn sm bad', onclick: () => api.invoke('app:quit') }, 'Выйти'))));

  layout(parts);
}

// ---------------- window layout: sections on the left, search, live preview on the right ----------------
const SECTIONS = [
  ['island', 'Остров', 'eye'], ['look', 'Внешний вид', 'palette'], ['layout', 'Вкладки', 'window'], ['home', 'Главная', 'home'], ['actions', 'Центр управления', 'control'],
  ['notify', 'Уведомления', 'bell'], ['phone', 'Телефон', 'phone'], ['tg', 'Мини-Telegram', 'telegram'], ['sounds', 'Звуки и музыка', 'volume'],
  ['ai', 'ИИ', 'ai'], ['weather', 'Погода', 'weather'], ['agents', 'Агенты', 'agent'], ['keys', 'Горячие клавиши', 'grab'], ['app', 'Система', 'folder'],
];
let current = 'look', query = '', navEl, contentEl, searchEl, footEl;

let shownKey = null, shownIdx = 0;
function moveNavInd(snap) {
  const on = navEl.querySelector('.sitem.on'), ind = navEl.querySelector('.snind');
  if (!ind) return;
  if (!on) { ind.style.opacity = '0'; return; }
  if (snap) ind.style.transition = 'none';
  ind.style.opacity = '1';
  ind.style.transform = `translateY(${on.offsetTop}px)`;
  ind.style.height = on.offsetHeight + 'px';
  if (snap) { void ind.offsetWidth; ind.style.transition = ''; }
}
function layout(parts) {
  const key = query ? 'q' : current;
  const fresh = key !== shownKey; // a new section: animate it in; a redraw of the same one: stay still
  const idx = SECTIONS.findIndex((x) => x[0] === current);
  const dir = idx >= shownIdx ? 1 : -1;
  const firstLayout = shownKey === null;
  shownKey = key; shownIdx = idx;
  const oldInd = navEl.querySelector('.snind');
  const prevY = oldInd?.style.transform || '';
  navEl.innerHTML = '';
  const ind = h('div', { class: 'snind' });
  if (prevY) { ind.style.transform = prevY; ind.style.height = oldInd.style.height; ind.style.transition = 'none'; }
  navEl.append(ind);
  for (const [id, label, ic] of SECTIONS) {
    navEl.append(h('button', { class: 'sitem' + (id === current && !query ? ' on' : ''), onclick: () => { current = id; query = ''; searchEl.value = ''; render(); contentEl.scrollTop = 0; } },
      h('span', { class: 'icw', html: icon(ic, 16) }), h('span', {}, label)));
  }
  requestAnimationFrame(() => { ind.style.transition = ''; moveNavInd(firstLayout); });
  renderFoot();
  contentEl.innerHTML = '';
  contentEl.classList.toggle('fresh', fresh && !query);
  contentEl.style.setProperty('--dir', dir);
  if (fresh && !query) { contentEl.classList.remove('swap'); void contentEl.offsetWidth; contentEl.classList.add('swap'); }
  const ids = query ? SECTIONS.map((x) => x[0]) : [current];
  for (const id of ids) {
    if (!parts[id]) continue;
    const box = h('div', { class: 'ssection' + (query || !fresh ? '' : ' stagger') });
    const title = SECTIONS.find((x) => x[0] === id)[1];
    if (!query) box.append(h('div', { class: 'stitle' }, title));
    box.append(...parts[id]);
    // a lone group named like its section doesn't need its own heading
    const first = box.querySelector('.h2');
    if (!query && first && box.querySelectorAll('.h2').length === 1) first.remove();
    contentEl.append(box);
  }
  if (query) {
    // search across every section: keep matching rows, drop empty groups
    const q = query.toLowerCase();
    for (const r of contentEl.querySelectorAll('.srow')) r.style.display = (r.textContent + ' ' + (r.dataset.hd || '')).toLowerCase().includes(q) ? '' : 'none';
    for (const g of contentEl.querySelectorAll('.sgroup')) {
      const any = [...g.querySelectorAll('.srow')].some((r) => r.style.display !== 'none') || (g.textContent.toLowerCase().includes(q) && !g.querySelector('.srow'));
      g.style.display = any ? '' : 'none';
      if (g.previousElementSibling?.classList.contains('h2')) g.previousElementSibling.style.display = any ? '' : 'none';
    }
    for (const sec of contentEl.querySelectorAll('.ssection')) sec.style.display = [...sec.querySelectorAll('.sgroup')].some((g) => g.style.display !== 'none') ? '' : 'none';
    if (![...contentEl.querySelectorAll('.sgroup')].some((g) => g.style.display !== 'none')) contentEl.append(h('div', { class: 'empty' }, 'Ничего не нашлось'));
  }
}


// the bottom of the sidebar: help
function renderFoot() {
  if (!footEl) return;
  footEl.innerHTML = '';
  footEl.append(
    h('button', { class: 'sitem shelp', onclick: () => showHint('Справка', 'Наведи на любую настройку — здесь появится, что она меняет, с живым примером. Всё сохраняется сразу. Остров раскрывается кликом или горячей клавишей, Esc сворачивает. Поиск слева ищет по всем разделам.') },
      h('span', { class: 'icw', html: icon('question', 16) }), h('span', {}, 'Справка')));
}

// ---------- Telegram sign in: QR code or phone number ----------
// Drawn from the login state kept in the main process, so a redraw never loses a step.
const tgStatusText = () => (state.telegram === 'on' ? 'подключён' : state.telegram === 'connecting' ? 'подключаюсь…' : 'не подключён');
function renderTg() {
  for (const e of document.querySelectorAll('.tgst')) e.textContent = tgStatusText();
  if (!tgAskBox) return;
  const l = state.tgLogin || { step: 'idle' };
  const s = state.settings;
  const box = tgAskBox;
  box.className = 'tglogin';
  box.innerHTML = '';
  const err = l.error ? h('div', { class: 'small', style: 'color:var(--bad)' }, l.error) : '';
  const cancel = h('button', { class: 'btn sm ghost', onclick: () => api.invoke('telegram:cancel') }, 'Отмена');
  const field = (key, ph, type = 'text', onEnter) => {
    const i = h('input', { class: 'field', placeholder: ph, type, value: tgDraft[key] || '', style: 'width:210px', autocomplete: 'off' });
    i.oninput = () => (tgDraft[key] = i.value);
    i.onkeydown = (e) => { if (e.key === 'Enter') onEnter(); };
    setTimeout(() => i.focus(), 30);
    return i;
  };
  const hasKeys = s.telegram.apiId && s.telegram.apiHash;
  if (state.telegram === 'on' && s.telegram.session) {
    box.append(h('div', { class: 'row' }, h('span', { class: 'small', style: 'color:var(--ok);font-weight:650' }, '✓ Вход выполнен'), h('div', { class: 'grow' }),
      h('button', { class: 'btn sm ghost', onclick: () => api.invoke('telegram:logout') }, 'Выйти')));
    return;
  }
  if (l.step === 'busy') { box.append(h('div', { class: 'muted small' }, l.text || 'Подключаюсь…'), cancel); return; }
  if (l.step === 'qr') {
    box.append(h('div', { class: 'tgqr' }, h('img', { src: l.qr, width: 168, height: 168, alt: 'QR' }),
      h('div', { class: 'small', style: 'line-height:1.5' },
        h('div', { style: 'font-weight:650;margin-bottom:4px' }, 'Отсканируй телефоном'),
        h('div', { class: 'muted' }, 'Telegram на телефоне → Настройки → Устройства → Подключить устройство, и наведи камеру на код.'),
        h('div', { style: 'margin-top:8px' }, cancel))), err);
    return;
  }
  if (l.step === 'code') {
    const send = () => { api.invoke('telegram:answer', tgDraft.code); tgDraft.code = ''; state.tgLogin = { step: 'busy', text: 'Проверяю код…' }; renderTg(); };
    box.append(h('div', { class: 'small muted' }, l.viaApp ? 'Код пришёл в Telegram (на телефоне или в Telegram Desktop)' : 'Код пришёл по SMS'),
      h('div', { class: 'row' }, field('code', 'Код', 'text', send), h('button', { class: 'btn sm pri', onclick: send }, 'Войти'), cancel), err);
    return;
  }
  if (l.step === 'password') {
    const send = () => { api.invoke('telegram:answer', tgDraft.password); tgDraft.password = ''; state.tgLogin = { step: 'busy', text: 'Проверяю пароль…' }; renderTg(); };
    box.append(h('div', { class: 'small muted' }, 'У аккаунта включена двухэтапная проверка' + (l.hint ? ` (подсказка: ${l.hint})` : '')),
      h('div', { class: 'row' }, field('password', 'Облачный пароль', 'password', send), h('button', { class: 'btn sm pri', onclick: send }, 'OK'), cancel), err);
    return;
  }
  // idle: choose how to sign in
  const go = async (method) => {
    if (!hasKeys) { state.tgLogin = { step: 'idle', error: 'Сначала впиши api_id и api_hash ниже' }; renderTg(); return; }
    if (method === 'phone' && !/^\+?\d{7,15}$/.test((tgDraft.phone || '').replace(/[\s()-]/g, ''))) { state.tgLogin = { step: 'idle', phoneOpen: true, error: 'Впиши номер в формате +380…' }; renderTg(); return; }
    await saveSettings();
    state.tgLogin = { step: 'busy', text: 'Подключаюсь к Telegram…' }; renderTg();
    api.invoke('telegram:login', method, '+' + (tgDraft.phone || '').replace(/[\s()+-]/g, ''));
  };
  box.append(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
    h('button', { class: 'btn sm pri', onclick: () => go('qr') }, 'Войти по QR-коду'),
    h('button', { class: 'btn sm', onclick: () => { state.tgLogin = { step: 'idle', phoneOpen: !l.phoneOpen }; renderTg(); } }, 'По номеру телефона')));
  if (l.phoneOpen || tgDraft.phone) box.append(h('div', { class: 'row' }, field('phone', '+380 …', 'tel', () => go('phone')), h('button', { class: 'btn sm pri', onclick: () => go('phone') }, 'Получить код')));
  if (err) box.append(err);
}

// Mounts the settings UI into the standalone settings window.
export function mountSettings(el, c, startSection) {
  root = el; ctx = c;
  if (startSection && SECTIONS.some(([id]) => id === startSection)) current = startSection;
  searchEl = h('input', { class: 'field ssearch', placeholder: 'Поиск настроек…', spellcheck: 'false' });
  searchEl.oninput = () => { query = searchEl.value.trim(); render(); };
  navEl = h('div', { class: 'snavlist' });
  contentEl = h('div', { class: 'scontent' });
  hintBox = h('div', { class: 'hint' });
  footEl = h('div', { class: 'sfoot' });
  const brand = h('div', { class: 'sbrand' }, h('span', { class: 'sbicon' }, h('i'), h('i')), h('div', {}, h('b', {}, 'Island'), h('small', {}, 'Настройки')));
  const main = h('div', { class: 'smain' }, h('div', { class: 'sprev' }, hintBox), contentEl);
  const wrap = h('div', { class: 'swin' }, h('nav', { class: 'snav' }, brand, searchEl, navEl, footEl), main);
  wrap.addEventListener('mouseover', (e) => {
    const r = e.target.closest('[data-ht]');
    if (r && r.dataset.ht && (r.dataset.ht !== curHint?.t || r.dataset.hp !== curHint?.hp)) showHint(r.dataset.ht, r.dataset.hd, r.dataset.hp);
  });
  el.append(wrap);
  showHint('Наведи на настройку', 'Здесь появится, что именно она меняет, с живым примером. Всё применяется сразу.', 'colors');
  render();
  api.invoke('telegram:loginState').then((l) => { state.tgLogin = l; renderTg(); });
  bus.on('telegram-login', (l) => { state.tgLogin = l; if (l.step !== 'idle' && current !== 'notify') { current = 'notify'; query = ''; render(); } else renderTg(); });
  bus.on('settings-external', render);
  bus.on('telegram-status', (st) => { state.telegram = st.status; if (st.error) ctx.flash({ icon: '✈️', title: 'Telegram: ' + st.error, ms: 3500 }); renderTg(); });
  return { open: (id) => { current = id; query = ''; searchEl.value = ''; render(); } };
}

// In the island the settings tab just opens the settings window.
export default {
  id: 'settings', label: 'Настройки', icon: 'settings', external: true,
  mount() {},
};
