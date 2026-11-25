// Natural-language engines for the command bar: math with percents, units,
// currency, timers and reminders written as ordinary Russian/English phrases.

// ---------------- math ----------------
const FUNCS = { sqrt: Math.sqrt, корень: Math.sqrt, sin: (x) => Math.sin(x), cos: Math.cos, tan: Math.tan, tg: Math.tan, abs: Math.abs, ln: Math.log, log: Math.log10, lg: Math.log10, round: Math.round, floor: Math.floor, ceil: Math.ceil, exp: Math.exp };
const CONSTS = { pi: Math.PI, пи: Math.PI, e: Math.E };

function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = s.slice(i).match(/^\d+(?:[.,]\d+)?(?:e[+-]?\d+)?/i);
    if (num) { out.push({ t: 'n', v: parseFloat(num[0].replace(',', '.')) }); i += num[0].length; continue; }
    const word = s.slice(i).match(/^[a-zа-яё]+/i);
    if (word) {
      const w = word[0].toLowerCase();
      out.push(w === 'x' || w === 'х' ? { t: 'o', v: '*' } : { t: 'w', v: w });
      i += word[0].length;
      continue;
    }
    if ('+-*/^()%!'.includes(c)) { out.push({ t: 'o', v: c }); i++; continue; }
    if (c === '×' || c === 'x' || c === 'х') { out.push({ t: 'o', v: '*' }); i++; continue; }
    if (c === '÷' || c === ':') { out.push({ t: 'o', v: '/' }); i++; continue; }
    throw new Error('bad char');
  }
  return out;
}

function evaluate(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v) => { if (toks[p] && toks[p].v === v) { p++; return true; } return false; };

  function primary() {
    const t = toks[p++];
    if (!t) throw new Error('eof');
    if (t.t === 'n') return { v: t.v };
    if (t.v === '(') { const r = add(); if (!eat(')')) throw new Error(')'); return r; }
    if (t.v === '-') { const r = unary(); return { v: -r.v, pct: r.pct }; }
    if (t.v === '+') return unary();
    if (t.t === 'w') {
      if (t.v in CONSTS) return { v: CONSTS[t.v] };
      if (t.v in FUNCS) { const a = unary(); return { v: FUNCS[t.v](a.v) }; }
    }
    throw new Error('unexpected');
  }
  function postfix() {
    let r = primary();
    for (;;) {
      if (peek()?.v === '%') { p++; r = { v: r.v, pct: true }; continue; }
      if (peek()?.v === '!') { p++; let f = 1; for (let i = 2; i <= r.v; i++) f *= i; r = { v: f }; continue; }
      return r;
    }
  }
  function unary() { return postfix(); }
  function pow() {
    const b = unary();
    if (eat('^')) { const e = pow(); return { v: Math.pow(b.pct ? b.v / 100 : b.v, e.v) }; }
    return b;
  }
  function mul() {
    let l = pow();
    for (;;) {
      if (eat('*')) { const r = pow(); l = { v: (l.pct ? l.v / 100 : l.v) * (r.pct ? r.v / 100 : r.v) }; }
      else if (eat('/')) { const r = pow(); l = { v: (l.pct ? l.v / 100 : l.v) / (r.pct ? r.v / 100 : r.v) }; }
      else return l;
    }
  }
  function add() {
    let l = mul();
    for (;;) {
      // a + b% -> a * (1 + b/100), the way people mean it
      if (eat('+')) { const r = mul(); l = { v: r.pct ? l.v * (1 + r.v / 100) : l.v + r.v }; }
      else if (eat('-')) { const r = mul(); l = { v: r.pct ? l.v * (1 - r.v / 100) : l.v - r.v }; }
      else return l;
    }
  }
  const r = add();
  if (p < toks.length) throw new Error('trailing');
  return r.pct ? r.v / 100 : r.v;
}

export function fmtNum(v) {
  if (!isFinite(v)) return String(v);
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v);
}

export function calc(q) {
  let s = q.trim().toLowerCase().replace(/^(сколько|посчитай|вычисли|=)\s*/, '').replace(/[=?]$/, '').trim();
  if (!s || !/\d/.test(s)) return null;
  // "15% от 2000" / "15% of 2000"
  let m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*%\s*(?:от|of|из)\s*(-?\d+(?:[.,]\d+)?)$/);
  if (m) { const a = +m[1].replace(',', '.'), b = +m[2].replace(',', '.'); return { value: (a * b) / 100, expr: `${m[1]}% от ${m[2]}` }; }
  // "сколько процентов 30 от 120" / "30 из 120 в процентах"
  m = s.match(/^(?:процентов\s*)?(-?\d+(?:[.,]\d+)?)\s*(?:от|из|of)\s*(-?\d+(?:[.,]\d+)?)\s*(?:в\s*процентах|%)$/) || s.match(/^процентов?\s*(-?\d+(?:[.,]\d+)?)\s*(?:от|из)\s*(-?\d+(?:[.,]\d+)?)$/);
  if (m) { const a = +m[1].replace(',', '.'), b = +m[2].replace(',', '.'); return { value: (a / b) * 100, suffix: '%', expr: `${m[1]} от ${m[2]}` }; }
  if (!/[+\-*/^%×÷x()!:]|sqrt|корень|sin|cos|tan|ln|log|pi|пи/.test(s)) return null;
  if (/^\d+:\d{2}$/.test(s)) return null; // looks like a time, not a division
  try {
    const v = evaluate(s);
    if (typeof v !== 'number' || isNaN(v)) return null;
    return { value: v, expr: q.trim() };
  } catch { return null; }
}

// ---------------- units ----------------
const U = [
  // [regex, dimension, factor to base, label]
  [/^(mi|mile|miles|мил[ьяиеюх]*|миль)$/, 'len', 1609.344, 'мили'],
  [/^(km|км|километр[а-яёa-z]*)$/, 'len', 1000, 'км'],
  [/^(m|м|метр[а-яёa-z]*)$/, 'len', 1, 'м'],
  [/^(cm|см|сантиметр[а-яёa-z]*)$/, 'len', 0.01, 'см'],
  [/^(mm|мм|миллиметр[а-яёa-z]*)$/, 'len', 0.001, 'мм'],
  [/^(ft|foot|feet|фут[а-яёa-z]*)$/, 'len', 0.3048, 'футы'],
  [/^(in|inch|inches|дюйм[а-яёa-z]*)$/, 'len', 0.0254, 'дюймы'],
  [/^(yd|yard|yards|ярд[а-яёa-z]*)$/, 'len', 0.9144, 'ярды'],
  [/^(nmi|морск[а-яёa-z]*\s*мил[а-яёa-z]*)$/, 'len', 1852, 'морские мили'],
  [/^(kg|кг|килограмм[а-яёa-z]*|кило)$/, 'mass', 1, 'кг'],
  [/^(g|г|гр|грамм[а-яёa-z]*)$/, 'mass', 0.001, 'г'],
  [/^(t|т|тонн[а-яёa-z]*)$/, 'mass', 1000, 'т'],
  [/^(lb|lbs|pound|pounds|фунт[а-яёa-z]*)$/, 'mass', 0.45359237, 'фунты'],
  [/^(oz|ounce|унци[а-яёa-z]*)$/, 'mass', 0.0283495, 'унции'],
  [/^(l|л|литр[а-яёa-z]*)$/, 'vol', 1, 'л'],
  [/^(ml|мл|миллилитр[а-яёa-z]*)$/, 'vol', 0.001, 'мл'],
  [/^(gal|gallon|gallons|галлон[а-яёa-z]*)$/, 'vol', 3.78541, 'галлоны'],
  [/^(km\/h|kmh|kph|км\/ч|кмч)$/, 'speed', 1 / 3.6, 'км/ч'],
  [/^(mph|миль\/ч|мил[а-яёa-z]*\s*в\s*час)$/, 'speed', 0.44704, 'миль/ч'],
  [/^(m\/s|мс|м\/с)$/, 'speed', 1, 'м/с'],
  [/^(kn|knot|knots|узл[а-яёa-z]*|узел)$/, 'speed', 0.514444, 'узлы'],
  [/^(c|°c|℃|цельси[а-яёa-z]*|градус[а-яёa-z]*\s*цельси[а-яёa-z]*)$/, 'temp', 'C', '°C'],
  [/^(f|°f|℉|фаренгейт[а-яёa-z]*|градус[а-яёa-z]*\s*фаренгейт[а-яёa-z]*)$/, 'temp', 'F', '°F'],
  [/^(k|кельвин[а-яёa-z]*)$/, 'temp', 'K', 'K'],
  [/^(kb|кб|килобайт[а-яёa-z]*)$/, 'data', 1024, 'КБ'],
  [/^(mb|мб|мегабайт[а-яёa-z]*)$/, 'data', 1024 ** 2, 'МБ'],
  [/^(gb|гб|гигабайт[а-яёa-z]*)$/, 'data', 1024 ** 3, 'ГБ'],
  [/^(tb|тб|терабайт[а-яёa-z]*)$/, 'data', 1024 ** 4, 'ТБ'],
  [/^(s|sec|с|сек|секунд[а-яёa-z]*)$/, 'time', 1, 'сек'],
  [/^(min|мин|минут[а-яёa-z]*)$/, 'time', 60, 'мин'],
  [/^(h|hr|ч|час[а-яёa-z]*)$/, 'time', 3600, 'ч'],
  [/^(d|day|days|дн[а-яёa-z]*|день|сут[а-яёa-z]*)$/, 'time', 86400, 'дн'],
  [/^(ha|га|гектар[а-яёa-z]*)$/, 'area', 10000, 'га'],
  [/^(acre|acres|акр[а-яёa-z]*)$/, 'area', 4046.86, 'акры'],
  [/^(m2|м2|кв\.?\s*м)$/, 'area', 1, 'м²'],
];
const DEFAULT_TARGET = { мили: 'км', км: 'мили', футы: 'м', дюймы: 'см', ярды: 'м', фунты: 'кг', кг: 'фунты', унции: 'г', галлоны: 'л', 'миль/ч': 'км/ч', '°F': '°C', '°C': '°F', узлы: 'км/ч' };
const findUnit = (w) => { w = w.trim().toLowerCase().replace(/\.$/, ''); const u = U.find(([re]) => re.test(w)); return u ? { dim: u[1], f: u[2], label: u[3] } : null; };
const toC = (v, u) => (u === 'C' ? v : u === 'F' ? ((v - 32) * 5) / 9 : v - 273.15);
const fromC = (v, u) => (u === 'C' ? v : u === 'F' ? (v * 9) / 5 + 32 : v + 273.15);

export function units(q) {
  const s = q.trim().toLowerCase().replace(/^(переведи|сколько)\s+/, '');
  const m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*([^\d]+?)(?:\s+(?:в|во|to|in|->|=|>)\s+([^\d]+?))?\s*$/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  const from = findUnit(m[2]);
  if (!from) return null;
  let to = m[3] ? findUnit(m[3]) : null;
  if (!to) {
    if (m[3]) return null;
    const def = DEFAULT_TARGET[from.label];
    if (!def) return null;
    const u = U.find((x) => x[3] === def);
    to = { dim: u[1], f: u[2], label: u[3] };
  }
  if (from.dim !== to.dim) return null;
  const out = from.dim === 'temp' ? fromC(toC(v, from.f), to.f) : (v * from.f) / to.f;
  return { value: out, text: `${fmtNum(v)} ${from.label} = ${fmtNum(out)} ${to.label}`, copy: fmtNum(out).replace(/\s/g, '') };
}

// ---------------- currency ----------------
const CUR = [
  [/^(\$|usd|долл[а-яёa-z]*|бакс[а-яёa-z]*|dollars?)$/, 'USD'], [/^(€|eur|евро|euro?s?)$/, 'EUR'], [/^(₽|rub|руб[а-яёa-z]*|р|рубл[а-яёa-z]*)$/, 'RUB'],
  [/^(cny|юан[а-яёa-z]*|¥)$/, 'CNY'], [/^(kzt|тенге|₸)$/, 'KZT'], [/^(uah|гривн[а-яёa-z]*|₴)$/, 'UAH'], [/^(gbp|£|фунт[а-яёa-z]*\s*стерлинг[а-яёa-z]*)$/, 'GBP'],
  [/^(try|лир[а-яёa-z]*|₺)$/, 'TRY'], [/^(amd|драм[а-яёa-z]*|֏)$/, 'AMD'], [/^(byn|бел[а-яёa-z]*\s*руб[а-яёa-z]*)$/, 'BYN'], [/^(jpy|йен[а-яёa-z]*|иен[а-яёa-z]*)$/, 'JPY'],
  [/^(gel|лари)$/, 'GEL'], [/^(aed|дирхам[а-яёa-z]*)$/, 'AED'], [/^(chf|франк[а-яёa-z]*)$/, 'CHF'],
];
const findCur = (w) => { w = (w || '').trim().toLowerCase(); return CUR.find(([re]) => re.test(w))?.[1] || null; };
const SYM = { USD: '$', EUR: '€', RUB: '₽', CNY: '¥', KZT: '₸', UAH: '₴', GBP: '£', TRY: '₺', AMD: '֏', JPY: '¥' };

export function currency(q, rates) {
  if (!rates) return null;
  let s = q.trim().toLowerCase().replace(/^(сколько|переведи|курс)\s+/, '');
  s = s.replace(/^([$€£¥₽])\s*(\d)/, '$2 $1').replace(/(\d)([$€£¥₽])/, '$1 $2');
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:тыс\.?|к)?\s*([^\d\s]+(?:\s+[^\d\s]+)?)(?:\s+(?:в|во|to|in|->|=)\s+(.+?))?\s*$/);
  if (!m) return null;
  let v = parseFloat(m[1].replace(',', '.'));
  if (/\d\s*(тыс|к)(?![а-яёa-z0-9])/.test(s)) v *= 1000;
  const from = findCur(m[2]);
  if (!from) return null;
  let to = m[3] ? findCur(m[3].replace(/(ах|ях|ы|и)$/, '')) || findCur(m[3]) : from === 'RUB' ? 'USD' : 'RUB';
  if (!to || !rates[from] || !rates[to]) return null;
  const out = (v * rates[from]) / rates[to];
  return { value: out, text: `${fmtNum(v)} ${SYM[from] || from} = ${fmtNum(out)} ${SYM[to] || to}`, sub: `курс: 1 ${from} = ${fmtNum(rates[from] / rates[to])} ${to}`, copy: out.toFixed(2) };
}

// ---------------- timers & reminders ----------------
const UNIT_SEC = (u) => (/^с/.test(u) || /^s/.test(u) ? 1 : /^м/.test(u) || /^min/.test(u) ? 60 : /^ч/.test(u) || /^h/.test(u) ? 3600 : /^д/.test(u) || /^day/.test(u) ? 86400 : /^недел/.test(u) ? 604800 : 0);
const WEEK = ['воскресенье', 'понедельник', 'вторник', 'сред', 'четверг', 'пятниц', 'суббот'];

export function parseTimer(q) {
  const s = q.trim().toLowerCase();
  let m = s.match(/^(?:таймер|timer|засеки)\s*(?:на\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(.*)$/);
  if (m) {
    const sec = m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
    return { seconds: sec, text: m[4] ? q.trim().slice(s.length - m[4].length) : '' };
  }
  m = s.match(/^(?:таймер|timer|засеки)?\s*(?:на\s*)?((?:\d+(?:[.,]\d+)?\s*(?:секунд[а-яёa-z]*|сек|с|минут[а-яёa-z]*|мин|м|час[а-яёa-z]*|ч|h|min|sec|s)\s*)+|полчаса|час)\s*(.*)$/);
  if (!m) return null;
  if (!/^(таймер|timer|засеки)/.test(s) && !/^\d/.test(s) && !/^(полчаса|час)/.test(s)) return null;
  if (!/^(таймер|timer|засеки)/.test(s) && m[2]) return null; // "5 минут купить" — that's a reminder
  let sec = 0;
  if (m[1] === 'полчаса') sec = 1800;
  else if (m[1] === 'час') sec = 3600;
  else for (const p of m[1].matchAll(/(\d+(?:[.,]\d+)?)\s*([a-zа-я]+)/g)) sec += parseFloat(p[1].replace(',', '.')) * UNIT_SEC(p[2]);
  if (!sec) return null;
  return { seconds: Math.round(sec), text: m[2] ? q.trim().slice(s.length - m[2].length) : '' };
}

export function parseReminder(q, now = new Date()) {
  let s = q.trim();
  const low = s.toLowerCase();
  const isRem = /^(напомни(ть)?|напоминание|remind)/.test(low) || /(?<![а-яёa-z0-9])через\s+\d/.test(low);
  if (!isRem) return null;
  s = s.replace(/^(напомни(ть)?|напоминание|remind me|remind)\s*(мне|me)?\s*/i, '');
  let at = null;
  let rest = s;
  const take = (re, fn) => {
    const m = rest.match(re);
    if (!m) return false;
    const ok = fn(m);
    if (ok !== false) rest = (rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length)).trim();
    return ok !== false;
  };

  // "через 10 минут", "через полчаса", "через 2 часа 15 минут"
  take(/через\s+((?:\d+(?:[.,]\d+)?\s*(?:секунд[а-яёa-z]*|сек|минут[а-яёa-z]*|мин|час[а-яёa-z]*|ч|дн[а-яёa-z]*|день|недел[а-яёa-z]*)\s*)+|полчаса|час|минуту|день|неделю)/i, (m) => {
    const w = m[1].toLowerCase();
    let sec = 0;
    if (w === 'полчаса') sec = 1800; else if (w === 'час') sec = 3600; else if (w === 'минуту') sec = 60; else if (w === 'день') sec = 86400; else if (w === 'неделю') sec = 604800;
    else for (const p of w.matchAll(/(\d+(?:[.,]\d+)?)\s*([a-zа-я]+)/g)) sec += parseFloat(p[1].replace(',', '.')) * UNIT_SEC(p[2]);
    at = new Date(now.getTime() + sec * 1000);
  });

  if (!at) {
    let day = new Date(now);
    let dayGiven = false;
    take(/(?<![а-яёa-z0-9])(сегодня|завтра|послезавтра)(?![а-яёa-z0-9])/i, (m) => {
      const k = m[1].toLowerCase();
      day.setDate(day.getDate() + (k === 'завтра' ? 1 : k === 'послезавтра' ? 2 : 0));
      dayGiven = true;
    });
    take(/(?<![а-яёa-z0-9])во?\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)(?![а-яёa-z0-9])/i, (m) => {
      const idx = WEEK.findIndex((w) => m[1].toLowerCase().startsWith(w));
      let diff = (idx - day.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      day.setDate(day.getDate() + diff);
      dayGiven = true;
    });
    take(/(?<![\d.])(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?![\d.])/, (m) => {
      day = new Date(m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : now.getFullYear(), +m[2] - 1, +m[1]);
      dayGiven = true;
    });
    let hh = null, mm = 0;
    take(/(?<![а-яёa-z0-9])в\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:час[а-яёa-z]*)?\s*(утра|дня|вечера|ночи)?/i, (m) => {
      hh = +m[1]; mm = m[2] ? +m[2] : 0;
      const part = (m[3] || '').toLowerCase();
      if ((part === 'вечера' || part === 'дня') && hh < 12) hh += 12;
      if (part === 'ночи' && hh === 12) hh = 0;
      if (hh > 23 || mm > 59) return false;
    });
    if (hh == null && !dayGiven) return null;
    if (hh == null) { hh = 9; mm = 0; }
    day.setHours(hh, mm, 0, 0);
    if (!dayGiven && day <= now) day.setDate(day.getDate() + 1);
    at = day;
  }
  const text = rest.replace(/^(что|о том,? что|про|чтобы)\s+/i, '').replace(/\s+/g, ' ').trim();
  return { at: at.getTime(), text: text ? text[0].toUpperCase() + text.slice(1) : 'Напоминание' };
}

export function whenText(ts) {
  const d = new Date(ts), now = new Date();
  const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400e3);
  if (days === 0) return `сегодня в ${t}`;
  if (days === 1) return `завтра в ${t}`;
  if (days === 2) return `послезавтра в ${t}`;
  return `${d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })} в ${t}`;
}
