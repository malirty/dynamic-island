import { api, bus, state, $, h, esc, icon, debounce, saveSettings } from '../core.js';
import { QUICK } from './home.js';
import { TILES } from './control.js';

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
  if (style === 'glass') return isDark(mode) ? 'rgba(22,22,32,.66)' : 'rgba(255,255,255,.6)';
  if (style === 'solid') return isDark(mode) ? solid : '#f7f7fa';
  return isDark(mode) ? 'rgba(6,6,10,.94)' : 'rgba(250,250,253,.9)';
}
const eyesMini = (cls = '') => `<div class="eyes ${cls}"><div class="eye"></div><div class="eye"></div></div>`;
// a miniature island built from the same layers as the real one
function pill(o = {}) {
  const t = S().theme;
  const style = o.style || t.style, mode = o.mode || t.mode, colors = o.colors || t.colors;
  const op = { liquid: [0.55, 0, 0], gradient: [0.2, 1, 0], glass: [0.35, 0, 1], solid: [0, 0, 0] }[style] || [0.5, 0, 0];
  const glow = o.glow ?? t.glow;
  const vars = `--c1:${colors[0]};--c2:${colors[1]};--c3:${colors[2]};--glow:${o.glowColor || colors[0]};--glowK:${glow};--liquidOp:${op[0]};--flowOp:${op[1]};--glassOp:${op[2]};--base:${baseFor(style, mode, t.solid)};${o.vars || ''}`;
  return `<div class="mp ${o.cls || ''}" data-mode="${mode}" style="${vars}"><div class="ib"><div class="flow"></div><div class="liquid"><i></i><i></i><i></i></div><div class="glassrim"></div>${o.sheen ? '<div class="mpsheen"></div>' : ''}</div><div class="mpc">${o.content ?? `<span class="d">ср, 11</span>${eyesMini()}<span>10:42</span>`}</div>${o.after || ''}</div>`;
}
const cap = (text, on) => `<div class="mpl${on ? ' on' : ''}">${esc(text)}</div>`;
const chipsGrid = (items) => `<div class="mpgrid">${items.map(([ic, label]) => `<div class="mpi">${icon(ic, 14)}<span>${esc(label)}</span></div>`).join('') || '<div class="muted small">Пусто</div>'}</div>`;

const PREVIEW = {
  theme: () => `<div class="mprow">${['dark', 'light'].map((m) => `<div class="mpcol">${pill({ mode: m, cls: 'sm', content: eyesMini() })}${cap(m === 'dark' ? 'Тёмная' : 'Светлая', S().theme.mode === m)}</div>`).join('')}</div>`,
  material: () => `<div class="mprow wrap">${[['liquid', 'Жидкий'], ['glass', 'Стекло'], ['gradient', 'Градиент'], ['solid', 'Сплошной']].map(([st, l]) => `<div class="mpcol">${pill({ style: st, content: eyesMini() , cls: 'sm' })}${cap(l, S().theme.style === st)}</div>`).join('')}</div>`,
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
    return pill({ content, after, cls: 'big' }) + cap({ eyes: 'Глаза', buddies: 'Человечки', none: 'Никого' }[ch], true);
  },
  seconds: () => pill({ content: `<span class="d">ср, 11</span>${eyesMini()}<span>${S().island.showSeconds ? '10:42:17' : '10:42'}</span>`, cls: 'big' }),
  fullscreen: () => `<div class="mpscreen ${S().island.hideOnFullscreen ? 'hiding' : ''}">${pill({ cls: 'sm' })}<span>${S().island.hideOnFullscreen ? 'кино на весь экран' : 'остров остаётся'}</span></div>`,
  sleep: () => pill({ cls: 'big', content: `<span class="d">ср, 11</span>${eyesMini('sleepy')}<span>10:42</span>` }) + cap(`засыпает через ${S().island.sleepAfterMin} мин`, true),
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
  curHint = { t, d, hp };
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
function toggle(get, set) {
  const t = h('div', { class: 'toggle' + (get() ? ' on' : '') });
  t.onclick = () => { const v = !get(); set(v); t.classList.toggle('on', v); commit(); };
  return t;
}
function seg(options, get, set) {
  const s = h('div', { class: 'seg' });
  for (const [v, label] of options) {
    const b = h('button', { class: get() === v ? 'on' : '' }, label);
    b.onclick = () => { set(v); for (const x of s.children) x.classList.toggle('on', x === b); commit(); };
    s.append(b);
  }
  return s;
}
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

let tgAskBox = null;
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
    row('Тема', 'светлая или тёмная', seg([['dark', 'Тёмная'], ['light', 'Светлая']], () => s.theme.mode, (v) => (s.theme.mode = v)), 'Тема', `Цвет самого острова. Переключается одной клавишей: ${s.hotkeys.themeToggle}.`),
    row('Материал', null, seg([['liquid', 'Жидкий'], ['glass', 'Стекло'], ['gradient', 'Градиент'], ['solid', 'Сплошной']], () => s.theme.style, (v) => (s.theme.style = v)), 'Материал острова', 'Жидкий — цветные переливы под тёмной поверхностью. Стекло — полупрозрачный с бликами. Градиент — бегущий цветной градиент. Сплошной — классическая чёрная пилюля.'),
    row('Цвета', 'три цвета переливов и ободка', colors, 'Цвета', 'Из этих цветов собираются жидкие переливы, градиент и светящийся ободок острова.'),
    row('Готовые палитры', null, presets, 'Палитры', 'Нажми — и остров перекрасится целиком.'),
    row('Сила свечения', null, range(0, 1.5, 0.05, () => s.theme.glow, (v) => (s.theme.glow = v)), 'Свечение', 'Насколько ярко светится край острова и ореол вокруг него.'),
    row('Край в цвет обложки', null, toggle(() => s.theme.coverGlow, (v) => (s.theme.coverGlow = v)), 'Цвет обложки', 'Когда играет музыка, край острова светится главным цветом обложки трека.'),
    row('Края как вода', 'тянутся к курсору, идут рябью', toggle(() => s.theme.water !== false, (v) => (s.theme.water = v)), 'Жидкие края', 'Край острова ведёт себя как поверхность воды: тянется к подведённому курсору, расходится рябью, когда входишь в остров, и слегка колышется в покое.'),
    row('Волны под музыку', 'свечение снизу и круги', toggle(() => s.theme.edgeDance, (v) => (s.theme.edgeDance = v)), 'Волны под музыку', 'Пока играет трек, низ острова светится цветом обложки, а на каждый удар баса край вздрагивает и от него расходятся светящиеся круги, как по воде.'),
    row('Свет за курсором', null, toggle(() => s.theme.cursorGlow, (v) => (s.theme.cursorGlow = v)), 'Свет за курсором', 'Мягкий блик по поверхности острова следует за мышью, а ободок разгорается, когда курсор рядом.'),
    row('Остров тянется к курсору', null, toggle(() => s.theme.reactive, (v) => (s.theme.reactive = v)), 'Реакция на движения', 'Когда подводишь мышь, остров слегка наклоняется и тянется к ней, как живой.'),
    row('Размер', null, range(0.85, 1.3, 0.05, () => s.theme.scale, (v) => (s.theme.scale = v)), 'Размер', 'Масштаб компактной пилюли.')));

  add('island', ...group('Остров',
    row('Характер', 'кто живёт на острове', seg([['eyes', 'Глаза'], ['buddies', 'Человечки'], ['none', 'Никого']], () => s.island.character, (v) => (s.island.character = v)), 'Характер', 'Глаза следят за курсором, задумываются, пока думает нейросеть, радуются готовому, вздрагивают от уведомлений и засыпают, когда тебя долго нет. Человечки ещё и танцуют под музыку.'),
    row('Секунды в часах', null, toggle(() => s.island.showSeconds, (v) => (s.island.showSeconds = v))),
    row('Прятать в полноэкранном режиме', 'фильмы и игры', toggle(() => s.island.hideOnFullscreen, (v) => (s.island.hideOnFullscreen = v)), 'Полноэкранный режим', 'Когда смотришь кино или играешь на весь экран, остров уезжает за край. Подведи мышь к центру верхнего края — и он появится.'),
    row('Засыпать через, мин', 'без активности', text(() => s.island.sleepAfterMin, (v) => (s.island.sleepAfterMin = +v || 5), { type: 'number', style: 'width:70px' }), 'Сон', 'Через сколько минут бездействия персонажи засыпают.'),
    row('Запускать вместе с Windows', null, toggle(() => s.island.autostart, (v) => (s.island.autostart = v)))));

  add('layout', ...group('Вкладки', orderList(s.tabs, TAB_NAMES, () => { commit(); ctx.rebuild(); }, 'tabs')));
  add('layout', ...group('Главная', orderList(s.home, WIDGET_NAMES, commit, 'home')));
  const qa = h('div', { class: 'chips', style: 'padding:10px' }, ...Object.entries(QUICK).map(([id, q]) => {
    const b = h('button', { class: 'chip' + (s.quickActions.includes(id) ? ' on' : '') }, q.label);
    b.onclick = () => { s.quickActions = s.quickActions.includes(id) ? s.quickActions.filter((x) => x !== id) : [...s.quickActions, id]; b.classList.toggle('on'); commit(); };
    return b;
  }));
  add('actions', ...group('Быстрые действия', h('div', hint('Быстрые действия', 'Кнопки на главной. Выбери нужные — область скрина, пипетка, QR, перевод с экрана и другие.'), qa)));
  const ct = h('div', { class: 'chips', style: 'padding:10px' }, ...Object.entries(TILES).map(([id, t]) => {
    const b = h('button', { class: 'chip' + (s.controlTiles.includes(id) ? ' on' : '') }, t.label);
    b.onclick = () => { s.controlTiles = s.controlTiles.includes(id) ? s.controlTiles.filter((x) => x !== id) : [...s.controlTiles, id]; b.classList.toggle('on'); commit(); };
    return b;
  }));
  add('actions', ...group('Центр управления', h('div', hint('Плитки', 'Что показывать в центре управления. Например, убери Wi-Fi и поставь «Не засыпать».'), ct),
    row('Громкость', null, toggle(() => s.controlSliders.includes('volume'), (v) => (s.controlSliders = v ? [...new Set([...s.controlSliders, 'volume'])] : s.controlSliders.filter((x) => x !== 'volume')))),
    row('Яркость', 'только ноутбуки и мониторы с DDC', toggle(() => s.controlSliders.includes('brightness'), (v) => (s.controlSliders = v ? [...new Set([...s.controlSliders, 'brightness'])] : s.controlSliders.filter((x) => x !== 'brightness'))))));

  // AI
  const keyRow = (id, label, url) => row(label, null, h('div', { class: 'row' }, text(() => s.ai.keys[id], (v) => (s.ai.keys[id] = v.trim()), { type: 'password', placeholder: 'API-ключ', style: 'width:180px' }), h('button', { class: 'btn sm ghost', onclick: () => api.invoke('url:open', url) }, 'Получить')), label, `Ключ хранится только на этом компьютере (%APPDATA%\\Island\\settings.json). Получить: ${url}`);
  add('ai', ...group('ИИ',
    row('Нейросеть по умолчанию', null, seg([['gemini', 'Gemini'], ['deepseek', 'DeepSeek'], ['openai', 'ChatGPT'], ['ollama', 'Ollama']], () => s.ai.provider, (v) => (s.ai.provider = v)), 'Нейросеть', 'Кто отвечает в Alt+Space и в быстрых ИИ-действиях. В чате можно выбрать любую. Ollama — локальные модели без интернета и ключей.'),
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
  const tgStatus = h('span', { class: 'muted small' }, state.telegram === 'on' ? 'подключён' : state.telegram === 'connecting' ? 'подключаюсь…' : 'не подключён');
  add('notify', ...group('Уведомления',
    row('Уведомления Windows', 'показывать на острове', toggle(() => s.notifications.windows, (v) => (s.notifications.windows = v)), 'Windows', 'Остров читает новые уведомления Windows и показывает их у себя.'),
    row('Не беспокоить', 'остров молчит', toggle(() => s.dnd, (v) => (s.dnd = v)), 'Не беспокоить', 'Уведомления копятся тихо, персонажи не вздрагивают. Напоминания всё равно сработают.'),
    row('Агенты пробивают «Не беспокоить»', null, toggle(() => s.notifications.agentsBypassDnd, (v) => (s.notifications.agentsBypassDnd = v)), 'Агенты', 'Если Claude Code ждёт твоего ответа, остров позовёт даже в режиме тишины.'),
    row('Telegram', 'личные сообщения на острове', h('div', { class: 'row' }, tgStatus, toggle(() => s.notifications.telegram, (v) => (s.notifications.telegram = v))), 'Telegram', 'Подключается как твой собственный клиент (как Telegram Desktop). Нужны api_id и api_hash с my.telegram.org — это бесплатно и занимает минуту.'),
    row('api_id', null, text(() => s.telegram.apiId, (v) => (s.telegram.apiId = v.trim()), { style: 'width:160px' })),
    row('api_hash', null, h('div', { class: 'row' }, text(() => s.telegram.apiHash, (v) => (s.telegram.apiHash = v.trim()), { type: 'password', style: 'width:160px' }), h('button', { class: 'btn sm ghost', onclick: () => api.invoke('url:open', 'https://my.telegram.org/apps') }, 'Где взять'))),
    row('Только личные и упоминания', null, toggle(() => s.telegram.onlyPrivate, (v) => (s.telegram.onlyPrivate = v))),
    h('div', { class: 'srow' }, h('button', { class: 'btn sm pri', onclick: async () => { s.notifications.telegram = true; await saveSettings(); api.invoke('telegram:start'); } }, 'Войти в Telegram'), s.telegram.session ? h('button', { class: 'btn sm ghost', onclick: () => api.invoke('telegram:logout') }, 'Выйти') : '', tgAskBox)));

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
  ['look', 'Внешний вид', 'palette'], ['island', 'Остров', 'eye'], ['layout', 'Вкладки и главная', 'home'],
  ['actions', 'Действия и центр', 'control'], ['ai', 'ИИ', 'ai'], ['weather', 'Погода', 'weather'],
  ['notify', 'Уведомления', 'bell'], ['agents', 'Агенты', 'agent'], ['keys', 'Горячие клавиши', 'grab'], ['app', 'Файлы и приложение', 'folder'],
];
let current = 'look', query = '', navEl, contentEl, searchEl;

function layout(parts) {
  navEl.innerHTML = '';
  for (const [id, label, ic] of SECTIONS) {
    navEl.append(h('button', { class: 'sitem' + (id === current && !query ? ' on' : ''), onclick: () => { current = id; query = ''; searchEl.value = ''; render(); contentEl.scrollTop = 0; } },
      h('span', { class: 'icw', html: icon(ic, 16) }), h('span', {}, label)));
  }
  contentEl.innerHTML = '';
  const ids = query ? SECTIONS.map((x) => x[0]) : [current];
  for (const id of ids) {
    if (!parts[id]) continue;
    const box = h('div', { class: 'ssection' + (query ? '' : ' stagger') });
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

function tgAsk(q) {
  if (!tgAskBox) return;
  current = 'notify'; query = ''; render();
  const i = h('input', { class: 'field', placeholder: q.label, type: q.kind === 'password' ? 'password' : 'text', style: 'width:200px' });
  const ok = h('button', { class: 'btn sm pri', onclick: () => { api.invoke('telegram:answer', i.value.trim()); tgAskBox.innerHTML = '<span class="muted small">Проверяю…</span>'; } }, 'OK');
  tgAskBox.innerHTML = '';
  tgAskBox.append(h('div', { class: 'row' }, i, ok));
  i.onkeydown = (e) => { if (e.key === 'Enter') ok.click(); };
  i.focus();
}

// Mounts the settings UI into the standalone settings window.
export function mountSettings(el, c, startSection) {
  root = el; ctx = c;
  if (startSection) current = startSection;
  searchEl = h('input', { class: 'field ssearch', placeholder: 'Поиск настроек…', spellcheck: 'false' });
  searchEl.oninput = () => { query = searchEl.value.trim(); render(); };
  navEl = h('div', { class: 'snavlist' });
  contentEl = h('div', { class: 'scontent' });
  hintBox = h('div', { class: 'hint' });
  const wrap = h('div', { class: 'swin' }, h('nav', { class: 'snav' }, searchEl, navEl), contentEl, h('div', { class: 'sside' }, hintBox));
  wrap.addEventListener('mouseover', (e) => {
    const r = e.target.closest('[data-ht]');
    if (r && r.dataset.ht && (r.dataset.ht !== curHint?.t || r.dataset.hp !== curHint?.hp)) showHint(r.dataset.ht, r.dataset.hd, r.dataset.hp);
  });
  el.append(wrap);
  showHint('Наведи на настройку', 'Здесь появится, что именно она меняет. Всё применяется сразу.');
  render();
  bus.on('telegram-ask', tgAsk);
  bus.on('settings-external', render);
  bus.on('telegram-status', (st) => { state.telegram = st.status; if (st.error) ctx.flash({ icon: '✈️', title: 'Telegram: ' + st.error, ms: 3500 }); if (st.status === 'on' && tgAskBox) tgAskBox.innerHTML = '<span class="small" style="color:var(--ok)">Подключено</span>'; });
  return { open: (id) => { current = id; query = ''; searchEl.value = ''; render(); } };
}

// In the island the settings tab just opens the settings window.
export default {
  id: 'settings', label: 'Настройки', icon: 'settings', external: true,
  mount() {},
};
