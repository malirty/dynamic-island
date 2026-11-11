// Text transformations for the "Текст" tab.
const EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./~QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?@#$^&";
const RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю.ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,"№;:?';
const en2ru = new Map([...EN].map((c, i) => [c, RU[i]]));
const ru2en = new Map([...RU].map((c, i) => [c, EN[i]]));

// Fix text typed in the wrong layout; direction is detected per word.
export function layout(text) {
  return text.replace(/[^\s]+/g, (w) => {
    const ru = (w.match(/[а-яё]/gi) || []).length;
    const en = (w.match(/[a-z]/gi) || []).length;
    const map = en >= ru ? en2ru : ru2en;
    return [...w].map((c) => map.get(c) ?? c).join('');
  });
}

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
export function translit(text) {
  if (!/[а-яё]/i.test(text)) return untranslit(text);
  return [...text].map((c) => {
    const low = c.toLowerCase();
    if (!(low in TR)) return c;
    const t = TR[low];
    return c === low ? t : t.charAt(0).toUpperCase() + t.slice(1);
  }).join('');
}
const UNTR = [['shch', 'щ'], ['yo', 'ё'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'], ['yu', 'ю'], ['ya', 'я'], ['a', 'а'], ['b', 'б'], ['v', 'в'], ['g', 'г'], ['d', 'д'], ['e', 'е'], ['z', 'з'], ['i', 'и'], ['y', 'ы'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['c', 'ц'], ['w', 'в'], ['x', 'кс'], ['q', 'к'], ['j', 'дж']];
function untranslit(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const rest = text.slice(i).toLowerCase();
    const hit = UNTR.find(([l]) => rest.startsWith(l));
    if (!hit) { out += text[i++]; continue; }
    const src = text.slice(i, i + hit[0].length);
    out += src[0] === src[0].toUpperCase() && src[0] !== src[0].toLowerCase() ? hit[1][0].toUpperCase() + hit[1].slice(1) : hit[1];
    i += hit[0].length;
  }
  return out;
}

const words = (t) => t.replace(/([a-zа-яё])([A-ZА-ЯЁ])/g, '$1 $2').split(/[^a-zа-яё0-9]+/i).filter(Boolean);

export const TRANSFORMS = [
  { id: 'layout', label: 'Раскладка', hint: 'ghbdtn → привет и обратно', fn: layout },
  { id: 'translit', label: 'Транслит', hint: 'привет ⇄ privet', fn: translit },
  { id: 'upper', label: 'ВЕРХНИЙ', hint: 'все буквы заглавные', fn: (t) => t.toUpperCase() },
  { id: 'lower', label: 'нижний', hint: 'все буквы строчные', fn: (t) => t.toLowerCase() },
  { id: 'title', label: 'Каждое Слово', hint: 'Заглавная в каждом слове', fn: (t) => t.toLowerCase().replace(/(^|[\s\-«"(])([a-zа-яё])/g, (m, a, b) => a + b.toUpperCase()) },
  { id: 'sentence', label: 'Как в предложении', hint: 'Заглавная только в начале фраз', fn: (t) => t.toLowerCase().replace(/(^\s*|[.!?…]\s+)([a-zа-яё])/g, (m, a, b) => a + b.toUpperCase()) },
  { id: 'invert', label: 'иНВЕРСИЯ', hint: 'поменять регистр каждой буквы', fn: (t) => [...t].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('') },
  { id: 'camel', label: 'camelCase', hint: 'для переменных', fn: (t) => words(t).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') },
  { id: 'pascal', label: 'PascalCase', hint: 'для классов', fn: (t) => words(t).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('') },
  { id: 'snake', label: 'snake_case', hint: 'через подчёркивание', fn: (t) => words(t).map((w) => w.toLowerCase()).join('_') },
  { id: 'kebab', label: 'kebab-case', hint: 'через дефис', fn: (t) => words(t).map((w) => w.toLowerCase()).join('-') },
  { id: 'const', label: 'CONST_CASE', hint: 'константы', fn: (t) => words(t).map((w) => w.toUpperCase()).join('_') },
  { id: 'spaces', label: 'Лишние пробелы', hint: 'убрать двойные пробелы и пробелы по краям', fn: (t) => t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim() },
  { id: 'oneline', label: 'В одну строку', hint: 'убрать переносы строк', fn: (t) => t.replace(/\s*\n+\s*/g, ' ').trim() },
  { id: 'sort', label: 'Сортировать строки', hint: 'по алфавиту', fn: (t) => t.split('\n').sort((a, b) => a.localeCompare(b, 'ru')).join('\n') },
  { id: 'unique', label: 'Убрать дубли', hint: 'оставить уникальные строки', fn: (t) => [...new Set(t.split('\n'))].join('\n') },
  { id: 'reverse', label: 'Задом наперёд', hint: 'перевернуть текст', fn: (t) => [...t].reverse().join('') },
  { id: 'typo', label: '«Типограф»', hint: 'кавычки-ёлочки, тире, неразрывные пробелы', fn: (t) => t.replace(/"([^"]*)"/g, '«$1»').replace(/ - /g, ' — ').replace(/(^|\s)(в|и|к|с|у|о|а|на|не|по|за|из|от|до)\s/gi, '$1$2 ').replace(/\.\.\./g, '…') },
  { id: 'urlenc', label: 'URL encode', hint: 'кодировать для ссылки', fn: (t) => encodeURIComponent(t) },
  { id: 'urldec', label: 'URL decode', hint: 'раскодировать ссылку', fn: (t) => { try { return decodeURIComponent(t); } catch { return t; } } },
  { id: 'b64', label: 'Base64', hint: 'закодировать', fn: (t) => btoa(unescape(encodeURIComponent(t))) },
  { id: 'unb64', label: 'из Base64', hint: 'раскодировать', fn: (t) => { try { return decodeURIComponent(escape(atob(t.trim()))); } catch { return t; } } },
  { id: 'nums', label: 'Нумерация', hint: 'пронумеровать строки', fn: (t) => t.split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n') },
  { id: 'json', label: 'JSON красиво', hint: 'отформатировать JSON', fn: (t) => { try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t; } } },
];

export function stats(t) {
  const w = (t.match(/[^\s]+/g) || []).length;
  return { chars: t.length, noSpaces: t.replace(/\s/g, '').length, words: w, lines: t ? t.split('\n').length : 0, read: Math.max(1, Math.round(w / 180)) };
}
