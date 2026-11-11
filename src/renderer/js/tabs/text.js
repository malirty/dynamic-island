import { api, bus, $, h, icon } from '../core.js';
import { TRANSFORMS, stats } from '../transforms.js';
import { flags } from '../characters.js';

let ta, ctx, statEl, history = [];

function setText(t, push = true) {
  if (push) history.push(ta.value);
  if (history.length > 50) history.shift();
  ta.value = t;
  updStats();
}
function updStats() {
  const s = stats(ta.value);
  statEl.innerHTML = `<span>${s.chars} симв.</span><span>${s.noSpaces} без пробелов</span><span>${s.words} слов</span><span>${s.lines} строк</span><span>~${s.read} мин чтения</span>`;
}
function selection() {
  const a = ta.selectionStart, b = ta.selectionEnd;
  return a !== b ? { a, b } : null;
}
function apply(fn, btn) {
  const sel = selection();
  if (sel) {
    const v = ta.value;
    setText(v.slice(0, sel.a) + fn(v.slice(sel.a, sel.b)) + v.slice(sel.b));
  } else setText(fn(ta.value));
  btn?.classList.add('flash');
  setTimeout(() => btn?.classList.remove('flash'), 300);
}

export default {
  id: 'text', label: 'Текст', icon: 'text',
  mount(el, c) {
    ctx = c;
    el.innerHTML = '<div class="pin"></div>';
    const pin = $('.pin', el);
    ta = h('textarea', { class: 'field', rows: 5, placeholder: 'Вставь или набери текст. Ghbdtn → «Раскладка» → Привет. Выдели часть — изменится только она.', spellcheck: 'false', style: 'user-select:text;min-height:110px;max-height:200px' });
    ta.oninput = updStats;
    statEl = h('div', { class: 'stats' });
    const mic = h('button', { class: 'btn sm', title: 'Голос в текст' }, h('span', { class: 'icw', html: icon('mic', 14) }), 'Голос');
    let rec = null;
    mic.onclick = async () => {
      if (rec) return rec.stop();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks = [];
        rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          rec = null; mic.classList.remove('rec'); mic.lastChild.textContent = 'Голос';
          const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(new Blob(chunks, { type: 'audio/webm' })); });
          mic.lastChild.textContent = 'Распознаю…';
          try { const t = await api.invoke('ai:transcribe', b64, 'audio/webm'); setText((ta.value ? ta.value + ' ' : '') + t); }
          catch { ctx.flash({ icon: '🎙', title: 'Нужен ключ Gemini или OpenAI — или используй Win+H', ms: 3500 }); }
          mic.lastChild.textContent = 'Голос';
        };
        rec.start(); mic.classList.add('rec'); mic.lastChild.textContent = 'Стоп';
      } catch { ctx.flash({ icon: '🎙', title: 'Нет доступа к микрофону', ms: 2000 }); }
    };
    pin.append(
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', title: 'Скопирует выделенный текст из окна, где ты работал', onclick: async () => { const t = await api.invoke('text:grab'); if (t) setText(t); else ctx.flash({ icon: '✋', title: 'Выдели текст в окне и попробуй снова', ms: 2000 }); } }, h('span', { class: 'icw', html: icon('grab', 14) }), 'Взять выделенное'),
        h('button', { class: 'btn sm', onclick: async () => { const t = await navigator.clipboard.readText().catch(() => ''); if (t) setText(t); } }, h('span', { class: 'icw', html: icon('clip', 14) }), 'Из буфера'),
        mic,
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm ghost', title: 'Отменить', onclick: () => { if (history.length) setText(history.pop(), false); } }, '↶'),
        h('button', { class: 'btn sm ghost', onclick: () => setText('') }, 'Очистить')),
      ta, statEl,
      h('div', { class: 'tgrid' },
        ...TRANSFORMS.map((t) => { const b = h('button', { class: 'tbtn', title: t.hint }, t.label, h('small', {}, t.hint)); b.onclick = () => apply(t.fn, b); return b; }),
        (() => { const b = h('button', { class: 'tbtn' }, 'Перевести', h('small', {}, 'RU ⇄ EN')); b.onclick = async () => { const src = ta.value; if (!src.trim()) return; b.classList.add('flash'); const r = await api.invoke('translate', src, /[а-яё]/i.test(src) ? 'en' : 'ru'); setText(r.text); b.classList.remove('flash'); }; return b; })(),
        (() => { const b = h('button', { class: 'tbtn' }, 'Исправить ИИ', h('small', {}, 'орфография и стиль')); b.onclick = async () => { const src = ta.value; if (!src.trim()) return; b.classList.add('flash'); flags.aiThinking = true; try { setText(await api.invoke('ai:ask', `Исправь орфографию, пунктуацию и стиль, сохранив смысл и язык. Верни только исправленный текст:\n\n${src}`)); } catch (e) { ctx.flash({ icon: '⚠️', title: 'Нужен ключ ИИ в настройках', ms: 2500 }); } flags.aiThinking = false; b.classList.remove('flash'); }; return b; })(),
        (() => { const b = h('button', { class: 'tbtn' }, 'Короче ИИ', h('small', {}, 'сжать до сути')); b.onclick = async () => { const src = ta.value; if (!src.trim()) return; b.classList.add('flash'); flags.aiThinking = true; try { setText(await api.invoke('ai:ask', `Сократи текст до сути, сохрани язык. Верни только результат:\n\n${src}`)); } catch { ctx.flash({ icon: '⚠️', title: 'Нужен ключ ИИ в настройках', ms: 2500 }); } flags.aiThinking = false; b.classList.remove('flash'); }; return b; })()),
      h('div', { class: 'row' },
        h('button', { class: 'btn pri', onclick: () => { ctx.collapse(false); api.invoke('text:paste', ta.value); } }, 'Вставить в окно'),
        h('button', { class: 'btn', onclick: () => { api.invoke('text:copy', ta.value); ctx.flash({ icon: '📋', title: 'Скопировано', ms: 1200 }); } }, 'Скопировать')));
    updStats();
    bus.on('text-set', (t) => setText(t));
  },
  show() { setTimeout(() => ta.focus(), 60); },
};
