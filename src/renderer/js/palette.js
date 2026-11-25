// Alt+Space command bar: one line for everything.
import { api, bus, state, $, h, esc, icon, debounce } from './core.js';
import { calc, units, currency, parseTimer, parseReminder, whenText, fmtNum, } from './nlp.js';
import { md } from './markdown.js';
import { flags } from './characters.js';

let ui, input, list, results = [], sel = 0, rates = null, apps = [], fileHits = [], answer = null, lastQ = '';
let hostApi;

const COMMANDS = [
  { k: ['скрин', 'скриншот', 'screenshot', 'область'], t: 'Скриншот области', i: 'region', run: () => api.invoke('capture:start', 'region') },
  { k: ['пипетка', 'цвет', 'color'], t: 'Пипетка — цвет с экрана', i: 'color', run: () => api.invoke('capture:start', 'color') },
  { k: ['qr', 'кьюар', 'куар'], t: 'Прочитать QR-код с экрана', i: 'qr', run: () => api.invoke('capture:start', 'qr') },
  { k: ['текст со скрина', 'ocr', 'распознать'], t: 'Распознать текст с экрана', i: 'ocr', run: () => api.invoke('capture:start', 'ocr') },
  { k: ['перевести экран', 'перевод скрина', 'translate screen'], t: 'Перевести текст с экрана', i: 'translate', run: () => api.invoke('capture:start', 'translate') },
  { k: ['тема', 'темная', 'светлая', 'theme'], t: 'Переключить тему острова', i: 'theme', run: () => bus.emit('theme-toggle-cmd') },
  { k: ['не беспокоить', 'dnd', 'тишина'], t: 'Режим «Не беспокоить»', i: 'belloff', run: () => { state.settings.dnd = !state.settings.dnd; api.invoke('settings:set', state.settings); } },
  { k: ['блокировка', 'заблокировать', 'lock'], t: 'Заблокировать компьютер', i: 'lock', run: () => api.invoke('sys:power', 'lock') },
  { k: ['сон', 'sleep', 'спящий'], t: 'Спящий режим', i: 'sleep', run: () => api.invoke('sys:power', 'sleep') },
  { k: ['буфер', 'clipboard', 'история'], t: 'Открыть буфер обмена', i: 'clip', tab: 'clip' },
  { k: ['заметки', 'notes'], t: 'Открыть заметки', i: 'notes', tab: 'notes' },
  { k: ['погода', 'weather'], t: 'Открыть погоду', i: 'weather', tab: 'weather' },
  { k: ['настройки', 'settings'], t: 'Настройки острова', i: 'settings', tab: 'settings' },
  { k: ['центр', 'wifi', 'вайфай', 'bluetooth', 'блютуз', 'vpn', 'впн'], t: 'Центр управления', i: 'control', tab: 'control' },
  { k: ['ии', 'ai', 'чат', 'нейросеть'], t: 'Открыть ИИ', i: 'ai', tab: 'ai' },
  { k: ['голос', 'диктовка', 'dictate'], t: 'Голосовой ввод Windows (Win+H)', i: 'mic', run: () => api.invoke('sys:dictate') },
];

function fuzzy(name, q) {
  const n = name.toLowerCase(), s = q.toLowerCase();
  if (n === s) return 100;
  if (n.startsWith(s)) return 80 - n.length / 100;
  const words = n.split(/[\s\-_.]+/);
  if (words.some((w) => w.startsWith(s))) return 60;
  const ini = words.map((w) => w[0]).join('');
  if (ini.startsWith(s)) return 50;
  if (n.includes(s)) return 40;
  let i = 0;
  for (const c of n) if (c === s[i]) i++;
  return i === s.length ? 20 : 0;
}

function build(q) {
  const out = [];
  const t = q.trim();
  if (!t) {
    out.push({ t: 'Введи что угодно', s: 'программа · файл · 15% от 2000 · 10 миль в км · 100$ · таймер 5 мин · напомни через час…', i: 'search', hint: true });
    for (const c of COMMANDS.slice(0, 5)) out.push({ t: c.t, i: c.i, run: c.run, tab: c.tab, k: 'команда' });
    return out;
  }
  const c = calc(t);
  if (c) out.push({ big: true, t: '= ' + fmtNum(c.value) + (c.suffix || ''), s: c.expr + ' · Enter — скопировать', i: 'plus', copy: String(+c.value.toFixed(10)).replace('.', ',') });
  const u = units(t);
  if (u) out.push({ big: true, t: u.text, s: 'Enter — скопировать', i: 'gauge', copy: u.copy });
  const cur = currency(t, rates);
  if (cur) out.push({ big: true, t: cur.text, s: cur.sub + ' · Enter — скопировать', i: 'palette', copy: cur.copy });
  const tm = parseTimer(t);
  if (tm) out.push({ t: `Таймер на ${fmtDur(tm.seconds)}`, s: tm.text ? `«${tm.text}»` : 'Enter — дальше напишешь, зачем', i: 'timer', stay: !tm.text, run: () => (tm.text ? addTimer(tm) : askWhy(tm)) });
  const rem = parseReminder(t);
  if (rem) out.push({ t: `Напомнить ${whenText(rem.at)}`, s: rem.text, i: 'bell', run: () => addReminder(rem) });
  const lower = t.toLowerCase();
  for (const cmd of COMMANDS) if (cmd.k.some((k) => k.startsWith(lower) || lower.startsWith(k))) out.push({ t: cmd.t, i: cmd.i, run: cmd.run, tab: cmd.tab, k: 'команда' });
  if (/^(заметка|запиши|note)\s+/i.test(t)) {
    const body = t.replace(/^(заметка|запиши|note)\s+/i, '');
    out.push({ t: 'Новая заметка', s: body, i: 'notes', run: () => bus.emit('note-add', body) });
  }
  if (/^(переведи|перевод|translate)\s+/i.test(t)) {
    const body = t.replace(/^(переведи|перевод|translate)\s+/i, '');
    out.push({ t: 'Перевести', s: body, i: 'translate', run: () => translate(body) });
  }
  const appHits = apps.map((a) => ({ a, sc: fuzzy(a.name, t) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 6);
  for (const { a } of appHits) out.push({ t: a.name, s: 'Программа', i: 'app', letter: a.name[0], run: () => api.invoke('launch', a.id), k: 'запустить' });
  for (const f of fileHits) out.push({ t: f.name, s: f.path, i: 'file', path: f.path, run: () => api.invoke('file:open', f.path), alt: () => api.invoke('file:reveal', f.path), k: 'открыть' });
  if (/^https?:\/\/|^www\.|^[\w-]+\.(ru|com|org|net|io|dev|me|app)(\/|$)/i.test(t)) out.push({ t: 'Открыть ссылку', s: t, i: 'link', run: () => api.invoke('url:open', /^https?:/.test(t) ? t : 'https://' + t) });
  out.push({ t: `Спросить ИИ: ${t}`, s: `${state.providers?.[state.settings.ai.provider]?.name || 'ИИ'} · Tab`, i: 'ai', ai: true, k: 'Tab' });
  out.push({ t: `Найти в интернете`, s: t, i: 'search', run: () => api.invoke('url:open', 'https://www.google.com/search?q=' + encodeURIComponent(t)) });
  return out;
}

function fmtDur(s) {
  const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [hh && hh + ' ч', m && m + ' мин', sec && sec + ' сек'].filter(Boolean).join(' ');
}
// the second step of a timer: what is it for? (tea, laundry, a call...)
let pendingTimer = null;
function askWhy(tm) {
  pendingTimer = tm;
  input.value = '';
  lastQ = '';
  input.placeholder = `Таймер на ${fmtDur(tm.seconds)} — зачем? Например: чай. Enter — запустить`;
  results = whyResults('');
  sel = 0;
  render();
  input.focus();
}
function whyResults(q) {
  const tm = pendingTimer;
  return [{ t: q ? `Таймер на ${fmtDur(tm.seconds)}: ${q}` : `Таймер на ${fmtDur(tm.seconds)}`, s: q ? 'Enter — запустить' : 'Напиши, зачем таймер, или нажми Enter', i: 'timer', run: () => { pendingTimer = null; addTimer({ ...tm, text: q }); } }];
}
function resetWhy() { pendingTimer = null; if (input) input.placeholder = 'Программа, файл, 15% от 2000, таймер 10 мин, вопрос…'; }
async function addTimer(tm) {
  await api.invoke('reminders:add', { kind: 'timer', at: Date.now() + tm.seconds * 1000, text: tm.text || `Таймер ${fmtDur(tm.seconds)}`, duration: tm.seconds });
  hostApi.flash({ icon: '⏱', title: `Таймер на ${fmtDur(tm.seconds)} запущен`, ms: 1800 });
}
async function addReminder(r) {
  await api.invoke('reminders:add', { kind: 'reminder', at: r.at, text: r.text });
  hostApi.flash({ icon: '🔔', title: `Напомню ${whenText(r.at)}`, ms: 2200 });
}
async function translate(text) {
  showAnswer('…');
  const to = /[а-яё]/i.test(text) ? 'en' : 'ru';
  const r = await api.invoke('translate', text, to);
  showAnswer(esc(r.text), r.text);
}

function render() {
  list.innerHTML = '';
  results.forEach((r, i) => {
    const ico = r.letter ? `<b>${esc(r.letter.toUpperCase())}</b>` : icon(r.i, 18);
    const el = h('div', { class: 'res' + (i === sel ? ' sel' : '') + (r.big ? ' big' : ''), onmousemove: () => { if (sel !== i) { sel = i; mark(); } }, onclick: () => exec(r) },
      h('div', { class: 'ri', html: ico }),
      h('div', { class: 'grow' }, h('div', { class: 'rt' }, r.t), r.s ? h('div', { class: 'rs' }, r.s) : ''),
      r.k ? h('div', { class: 'rk' }, r.k) : '');
    list.append(el);
    if (r.path && !r.iconLoaded) {
      r.iconLoaded = true;
      api.invoke('file:icon', r.path).then((d) => { if (d) el.querySelector('.ri').innerHTML = `<img src="${d}">`; });
    }
  });
  if (answer) list.append(answer);
  hostApi.resize();
}
function mark() { [...list.querySelectorAll('.res')].forEach((e, i) => e.classList.toggle('sel', i === sel)); }

async function exec(r) {
  if (!r || r.hint) return;
  if (r.ai) return askAI(input.value.trim());
  if (r.copy != null) {
    await api.invoke('text:copy', r.copy);
    hostApi.flash({ icon: '📋', title: `Скопировано: ${r.copy}`, ms: 1600 });
    hostApi.collapse(true);
    return;
  }
  if (r.tab) { hostApi.openTab(r.tab); return; }
  if (r.stay) { r.run?.(); return; } // a next step in the same field
  hostApi.collapse(true);
  r.run?.();
}

function showAnswer(html, raw) {
  answer = h('div', { class: 'answer', html });
  answer.dataset.raw = raw || '';
  render();
}

let aiReq = null;
async function askAI(q) {
  if (!q) return;
  if ((state.settings.ai.mode || 'web') === 'web') { hostApi.openTab('ai'); setTimeout(() => bus.emit('ai-web-ask', q), 150); return; }
  const id = 'pal-' + Date.now();
  aiReq = id;
  let text = '';
  flags.aiThinking = true;
  showAnswer('<span class="typing"><i></i><i></i><i></i></span>');
  const off1 = api.on('ai-delta', (d) => { if (d.reqId !== id || !d.text) return; text += d.text; answer.innerHTML = md(text); answer.scrollTop = 1e9; hostApi.resize(); });
  const done = () => { off1(); off2(); off3(); flags.aiThinking = false; bus.emit('mood-done'); };
  const off2 = api.on('ai-done', (d) => {
    if (d.reqId !== id) return;
    done();
    answer.append(h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn sm', onclick: () => api.invoke('text:copy', text) }, 'Скопировать'),
      h('button', { class: 'btn sm', onclick: () => { hostApi.collapse(false); api.invoke('text:paste', text); } }, 'Вставить'),
      h('button', { class: 'btn sm ghost', onclick: () => { hostApi.openTab('ai'); bus.emit('ai-continue', { q, a: text }); } }, 'Продолжить в чате')));
    hostApi.resize();
  });
  const off3 = api.on('ai-error', (d) => { if (d.reqId !== id) return; done(); bus.emit('mood-flash', { mood: 'mood-angry', ms: 2600 }); answer.innerHTML = `<span style="color:var(--bad)">${esc(d.error)}</span>`; hostApi.resize(); });
  api.invoke('ai:chat', id, { messages: [{ role: 'user', content: q }] });
}

const searchFiles = debounce(async (q) => {
  if (q !== input.value.trim() || q.length < 3 || calc(q) || units(q) || parseTimer(q) || parseReminder(q)) { fileHits = []; return; }
  fileHits = await api.invoke('palette:files', q);
  if (q === input.value.trim()) { results = build(q); render(); }
}, 260);

export function paletteHeight() {
  if (!list) return 58;
  // sum the rows instead of the (flex-stretched) container height
  const content = [...list.children].reduce((s, k) => s + k.offsetHeight + 2, 0);
  return Math.min(520, 58 + (results.length ? content + 10 : 0));
}

export function initPalette(host) {
  hostApi = host;
  ui = $('.v-palette');
  const top = $('.pin-input', ui);
  top.innerHTML = `${icon('search', 20)}<input placeholder="Программа, файл, 15% от 2000, таймер 10 мин, вопрос…" spellcheck="false"><span class="kbd">Alt+Space</span>`;
  input = $('input', top);
  list = $('.results', ui);
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q === lastQ) return;
    lastQ = q;
    answer = null;
    sel = 0;
    fileHits = [];
    if (pendingTimer) { results = whyResults(input.value.trim()); render(); return; }
    results = build(q);
    render();
    searchFiles(q);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); mark(); list.querySelectorAll('.res')[sel]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); list.querySelectorAll('.res')[sel]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[sel]; if (e.ctrlKey && r?.alt) { r.alt(); hostApi.collapse(false); } else exec(r?.hint ? results[1] : r); }
    else if (e.key === 'Tab') { e.preventDefault(); askAI(input.value.trim()); }
  });
  bus.on('theme-toggle-cmd', () => document.dispatchEvent(new CustomEvent('island-theme')));
}

export async function openPalette(prefill = '') {
  resetWhy();
  input.value = prefill;
  lastQ = null;
  answer = null;
  results = build(prefill);
  sel = 0;
  render();
  api.invoke('island:focus');
  setTimeout(() => input.focus(), 30);
  setTimeout(() => input.focus(), 200);
  if (!rates) api.invoke('currency').then((r) => (rates = r)).catch(() => {});
  if (!apps.length) api.invoke('palette:apps').then((a) => (apps = a || []));
}
export function closePalette() { if (aiReq) api.invoke('ai:abort', aiReq); aiReq = null; resetWhy(); }
