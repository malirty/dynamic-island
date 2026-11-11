import { api, bus, state, $, h, esc, icon, bytes } from '../core.js';
import { md } from '../markdown.js';
import { flags } from '../characters.js';

const MODELS = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o', 'o4-mini'],
  ollama: [],
};

export function createChat(el, ctx, { standalone = false } = {}) {
  let chats = [];
  let chat = null;
  let pending = []; // attachments for the next message
  let reqId = null;
  let recorder = null;

  el.classList.add('ai');
  el.innerHTML = '';
  const provSel = h('select', { class: 'field', title: 'Нейросеть' });
  const modelIn = h('input', { class: 'field', style: 'width:150px;height:28px;font-size:12px', list: 'ai-models', title: 'Модель' });
  const models = h('datalist', { id: 'ai-models' });
  const chatSel = h('select', { class: 'field', style: 'max-width:180px', title: 'История чатов' });
  const msgs = h('div', { class: 'msgs' });
  const ta = h('textarea', { rows: 1, placeholder: 'Спроси что угодно, перетащи файл или нажми микрофон…', spellcheck: 'false' });
  const att = h('div', { class: 'att' });
  const fileIn = h('input', { type: 'file', multiple: true, style: 'display:none' });
  const micBtn = h('button', { class: 'ibtn', title: 'Сказать голосом', html: icon('mic', 16) });
  const sendBtn = h('button', { class: 'sendbtn', title: 'Отправить (Enter)', html: icon('send', 16) });
  const composer = h('div', { class: 'composer' }, att, ta, h('div', { class: 'bar' },
    h('button', { class: 'ibtn', title: 'Прикрепить файл', html: icon('attach', 16), onclick: () => fileIn.click() }), micBtn,
    h('div', { class: 'grow' }), sendBtn));
  el.append(
    h('div', { class: 'row' }, provSel, modelIn, models, h('div', { class: 'grow' }), chatSel,
      h('button', { class: 'ibtn', title: 'Новый чат', html: icon('plus', 16), onclick: () => newChat() }),
      !standalone ? h('button', { class: 'ibtn', title: 'Открыть в отдельном окне', html: icon('window', 16), onclick: () => { api.invoke('ai:window'); ctx.collapse(false); } }) : ''),
    msgs, composer, fileIn);

  function fillProviders() {
    provSel.innerHTML = '';
    for (const [id, p] of Object.entries(state.providers || {})) {
      const hasKey = !p.needsKey || state.settings.ai.keys[id];
      provSel.append(h('option', { value: id }, p.name + (hasKey ? '' : ' — нет ключа')));
    }
    provSel.value = chat?.provider || state.settings.ai.provider;
    fillModels();
  }
  async function fillModels() {
    const p = provSel.value;
    let list = MODELS[p] || [];
    if (p === 'ollama') list = await api.invoke('ai:ollama');
    models.innerHTML = list.map((m) => `<option value="${esc(m)}">`).join('');
    modelIn.value = chat?.provider === p && chat?.model ? chat.model : state.settings.ai.models[p] || list[0] || '';
  }
  provSel.onchange = () => { if (chat) { chat.provider = provSel.value; chat.model = null; } fillModels(); };
  modelIn.onchange = () => { if (chat) chat.model = modelIn.value; };

  function fillChats() {
    chatSel.innerHTML = '';
    for (const c of chats) chatSel.append(h('option', { value: c.id }, (c.title || 'Новый чат').slice(0, 40)));
    if (chat) chatSel.value = chat.id;
  }
  chatSel.onchange = () => { chat = chats.find((c) => c.id === chatSel.value); renderAll(); fillProviders(); };

  function newChat() {
    if (chat && !chat.messages.length) return ta.focus();
    chat = { id: 'c' + Date.now(), title: '', messages: [], provider: state.settings.ai.provider, model: null, updated: Date.now() };
    chats.unshift(chat);
    fillChats(); renderAll(); fillProviders(); ta.focus();
  }
  function persist() {
    const slim = chats.filter((c) => c.messages.length).map((c) => ({ ...c, messages: c.messages.map((m) => ({ role: m.role, content: m.content, error: m.error, files: (m.files || []).map((f) => ({ name: f.name, mime: f.mime, text: f.text && f.text.length < 20000 ? f.text : undefined })) })) }));
    api.invoke('ai:chats:save', slim);
  }

  function bubble(m) {
    const b = h('div', { class: 'msg ' + m.role + (m.error ? ' err' : '') });
    if (m.files?.length) {
      const f = h('div', { class: 'files' });
      for (const x of m.files) {
        if (x.data && x.mime?.startsWith('image/')) f.append(h('img', { class: 'att', src: `data:${x.mime};base64,${x.data}` }));
        else f.append(h('span', { class: 'fchip', html: `${icon('file', 12)} ${esc(x.name)}` }));
      }
      b.append(f);
    }
    const body = h('div', { class: 'body' });
    if (m.role === 'assistant') body.innerHTML = m.content ? md(m.content) : '<span class="typing"><i></i><i></i><i></i></span>';
    else body.textContent = m.content;
    b.append(body);
    if (m.role === 'assistant' && m.content && !m.error) b.append(h('div', { class: 'row', style: 'margin-top:6px;gap:4px' },
      h('button', { class: 'btn sm ghost', onclick: () => { api.invoke('text:copy', m.content); ctx.flash?.({ icon: '📋', title: 'Скопировано', ms: 1200 }); } }, icon('copy', 12), 'Копировать'),
      !standalone ? h('button', { class: 'btn sm ghost', onclick: () => { ctx.collapse(false); api.invoke('text:paste', m.content); } }, 'Вставить') : ''));
    return b;
  }
  function renderAll() {
    msgs.innerHTML = '';
    if (!chat?.messages.length) {
      msgs.append(h('div', { class: 'empty', style: 'margin:auto' },
        h('div', { style: 'font-size:28px;margin-bottom:6px' }, '✦'),
        h('div', { style: 'font-weight:650;color:var(--fg)' }, 'Чем помочь?'),
        h('div', {}, 'Перетащи файл, вставь картинку (Ctrl+V) или скажи голосом')));
    } else for (const m of chat.messages) msgs.append(bubble(m));
    msgs.scrollTop = msgs.scrollHeight;
  }
  function renderAtt() {
    att.innerHTML = '';
    pending.forEach((f, i) => att.append(h('span', { class: 'chip', style: 'display:inline-flex;align-items:center;gap:5px' },
      f.mime?.startsWith('image/') && f.data ? h('img', { src: `data:${f.mime};base64,${f.data}`, style: 'width:18px;height:18px;border-radius:4px;object-fit:cover' }) : h('span', { class: 'icw', html: icon('file', 12) }),
      `${f.name}${f.size ? ' · ' + bytes(f.size) : ''}`, f.tooBig ? ' (слишком большой)' : '',
      h('button', { html: icon('close', 10), onclick: () => { pending.splice(i, 1); renderAtt(); } }))));
  }
  async function attachPaths(paths) {
    for (const p of paths) { try { pending.push(await api.invoke('file:read', p)); } catch {} }
    renderAtt();
    ta.focus();
  }
  fileIn.onchange = () => { attachPaths([...fileIn.files].map((f) => api.pathOf(f)).filter(Boolean)); fileIn.value = ''; };
  ta.addEventListener('paste', async (e) => {
    const img = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!img) return;
    e.preventDefault();
    const blob = img.getAsFile();
    const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
    pending.push({ name: 'изображение.png', mime: blob.type, data, size: blob.size });
    renderAtt();
  });
  composer.addEventListener('dragover', (e) => { e.preventDefault(); composer.classList.add('hot'); });
  composer.addEventListener('dragleave', () => composer.classList.remove('hot'));
  if (standalone) composer.addEventListener('drop', (e) => { e.preventDefault(); composer.classList.remove('hot'); attachPaths([...e.dataTransfer.files].map((f) => api.pathOf(f)).filter(Boolean)); });

  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  sendBtn.onclick = () => (reqId ? stop() : send());

  function stop() { if (reqId) api.invoke('ai:abort', reqId); }

  async function send(textOverride) {
    const text = (textOverride ?? ta.value).trim();
    if (!text && !pending.length) return;
    if (reqId) return;
    if (!chat) newChat();
    const files = pending.filter((f) => !f.tooBig);
    pending = []; renderAtt();
    ta.value = ''; ta.style.height = 'auto';
    chat.messages.push({ role: 'user', content: text, files });
    if (!chat.title) chat.title = text.slice(0, 50) || files[0]?.name;
    const reply = { role: 'assistant', content: '' };
    chat.messages.push(reply);
    chat.updated = Date.now();
    renderAll(); fillChats();
    const node = msgs.lastElementChild;
    const body = node.querySelector('.body');
    reqId = 'ai-' + Date.now();
    const id = reqId;
    sendBtn.innerHTML = icon('stop', 14);
    flags.aiThinking = true;
    let think = '';
    const offD = api.on('ai-delta', (d) => {
      if (d.reqId !== id) return;
      if (d.think) { think += d.think; }
      if (d.text) reply.content += d.text;
      body.innerHTML = (think ? `<div class="think">${esc(think.slice(-600))}</div>` : '') + (reply.content ? md(reply.content) : '<span class="typing"><i></i><i></i><i></i></span>');
      msgs.scrollTop = msgs.scrollHeight;
    });
    const finish = () => {
      offD(); offE(); offF();
      reqId = null; flags.aiThinking = false;
      sendBtn.innerHTML = icon('send', 16);
      bus.emit('mood-done');
      renderAll(); persist();
    };
    const offF = api.on('ai-done', (d) => { if (d.reqId === id) finish(); });
    const offE = api.on('ai-error', (d) => { if (d.reqId !== id) return; reply.content = '⚠️ ' + d.error; reply.error = true; finish(); });
    const history = chat.messages.slice(0, -1).filter((m) => !m.error).slice(-20).map((m) => ({ role: m.role, content: m.content, files: m.files }));
    api.invoke('ai:chat', id, { provider: provSel.value, model: modelIn.value.trim(), messages: history });
  }

  micBtn.onclick = async () => {
    if (recorder) { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder = null;
        micBtn.classList.remove('rec');
        micBtn.innerHTML = icon('mic', 16);
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
        ta.placeholder = 'Распознаю речь…';
        try {
          const text = await api.invoke('ai:transcribe', b64, 'audio/webm');
          ta.value = (ta.value ? ta.value + ' ' : '') + text;
          ta.dispatchEvent(new Event('input'));
          ta.focus();
        } catch (e) {
          ctx.flash?.({ icon: '🎙', title: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), ms: 3500 });
        }
        ta.placeholder = 'Спроси что угодно, перетащи файл или нажми микрофон…';
      };
      recorder.start();
      micBtn.classList.add('rec');
      micBtn.innerHTML = icon('stop', 16);
    } catch (e) {
      ctx.flash?.({ icon: '🎙', title: 'Нет доступа к микрофону', ms: 2500 });
    }
  };

  bus.on('ai-attach', (paths) => attachPaths(paths));
  bus.on('drop-open', ({ paths, target }) => { if (el.closest('.page.on') && !target.closest?.('.shelfw')) attachPaths(paths); });
  bus.on('ai-continue', ({ q, a }) => {
    newChat();
    chat.messages.push({ role: 'user', content: q }, { role: 'assistant', content: a });
    chat.title = q.slice(0, 50);
    renderAll(); fillChats(); persist();
  });
  bus.on('settings', fillProviders);

  api.invoke('ai:chats:get').then((c) => {
    chats = c || [];
    chat = chats[0] || null;
    if (!chat) newChat(); else { fillChats(); renderAll(); }
    fillProviders();
  });
  return { focus: () => ta.focus() };
}

let inst;
export default {
  id: 'ai', label: 'ИИ', icon: 'ai', fixedHeight: 560,
  mount(el, ctx) {
    const box = h('div', { style: 'height:100%' });
    el.append(box);
    el.style.paddingBottom = '12px';
    inst = createChat(box, ctx);
  },
  show() { setTimeout(() => inst?.focus(), 80); },
};
