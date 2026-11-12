// A mini Telegram inside the island: chats, replies, voice messages and video notes.
// It has its own look (Настройки → Мини-Telegram), it's not a copy of Telegram.
import { api, bus, state, $, $$, h, esc, icon, mediaIcon, clock } from '../core.js';

let ctx, root;
let dialogs = [];
let cur = null; // open chat: peer id
let msgs = [];
let replyTo = null; // message being answered
let query = '';
let draft = {}; // unsent text per chat
const avatars = new Map(); // peer -> data url | null
const blobs = new Map(); // `${peer}:${id}` -> blob url
let player = null; // { key: 'peer:id', peer, id, el (audio/video), ui, who } - keeps playing when you leave the chat
let pend = []; // attachments waiting to be sent: { name, path? , data?, url? }
let rec = null; // voice recording in progress
const typing = new Map(); // peer -> { text, until }
let stick = true; // the chat follows new messages while you're at the bottom
let editing = null; // my message being edited
let me = null; // { id, name, premium }
const extra = new Map(); // `${peer}:${id}` -> { tr: transcription, tl: translation, readAt }
const QUICK_REACT = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🎉', '👏'];
let loadingChat = 0;

const hhmm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function dayLabel(t) {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return hhmm(t);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
const COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];
const colorOf = (peer) => COLORS[Math.abs([...String(peer)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % COLORS.length];
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function avatarEl(peer, name, size = 40) {
  const el = h('div', { class: 'tgav', style: `width:${size}px;height:${size}px;background-color:${colorOf(peer)};font-size:${Math.round(size * 0.38)}px` }, initials(name));
  const set = (url) => { if (url) { el.textContent = ''; el.style.backgroundImage = `url('${url}')`; } };
  if (avatars.has(peer)) set(avatars.get(peer));
  else {
    avatars.set(peer, null);
    api.invoke('tg:avatar', peer).then((u) => { avatars.set(peer, u || null); set(u); for (const x of $$(`.tgav[data-peer="${peer}"]`, root)) if (u) { x.textContent = ''; x.style.backgroundImage = `url('${u}')`; } }).catch(() => {});
  }
  el.dataset.peer = peer;
  return el;
}

// ---------- look: the user's own style for the mini Telegram ----------
function applyLook() {
  const u = state.settings.tgui || {};
  const w = $('.tgw', root);
  if (!w) return;
  w.style.setProperty('--tgacc', u.accent || '#7c5cff');
  w.dataset.bub = u.bubbles || 'round';
  w.dataset.size = u.size || 'm';
  w.dataset.wall = u.wallpaper || 'theme';
  w.classList.toggle('noav', u.avatars === false);
}

// ---------- chat list ----------
async function loadDialogs() {
  if (state.telegram !== 'on') return renderAll();
  try { dialogs = await api.invoke('tg:dialogs', 40); } catch (e) { dialogs = []; }
  renderList();
  if (!cur && dialogs[0]) openChat(dialogs[0].peer, false);
}
function renderList() {
  const box = $('.tgdl', root);
  if (!box) return;
  box.innerHTML = '';
  const q = query.toLowerCase();
  const list = dialogs.filter((d) => !q || d.name.toLowerCase().includes(q));
  if (!list.length) box.append(h('div', { class: 'empty' }, q ? 'Ничего не нашлось' : 'Чатов пока нет'));
  for (const d of list) {
    const ty = typing.get(d.peer);
    box.append(h('div', { class: 'tgdi' + (d.peer === cur ? ' on' : ''), onclick: () => openChat(d.peer) },
      avatarWrap(d, 38),
      h('div', { class: 'grow', style: 'min-width:0' },
        h('div', { class: 'row', style: 'gap:6px' }, h('div', { class: 'tgdn' }, d.name, d.premium ? h('span', { class: 'tgprem', title: 'Telegram Premium' }, '★') : ''), h('span', { class: 'sp' }), h('span', { class: 'tgdt' }, d.date ? dayLabel(d.date) : '')),
        h('div', { class: 'row', style: 'gap:6px' }, ty && ty.until > Date.now() && ty.text ? h('div', { class: 'tgdp live' }, ty.text) : h('div', { class: 'tgdp' }, (d.lastOut ? 'Ты: ' : '') + d.last), h('span', { class: 'sp' }), d.unread ? h('span', { class: 'tgub' + (d.muted ? ' muted' : '') }, d.unread > 99 ? '99+' : String(d.unread)) : ''))));
  }
}

// ---------- the open chat ----------
async function openChat(peer, focus = true) {
  if (rec) cancelRecording();
  if (cur && cur !== peer) { draft[cur] = $('.tgin', root)?.value || ''; pend = []; }
  cur = peer; replyTo = null; msgs = [];
  renderList();
  renderChat();
  const my = ++loadingChat;
  try { msgs = await api.invoke('tg:messages', peer, 40); } catch { msgs = []; }
  if (my !== loadingChat) return;
  renderMessages(true);
  refreshStatus(peer);
  const d = dialogs.find((x) => x.peer === peer);
  if (d?.unread) { d.unread = 0; renderList(); api.invoke('tg:read', peer).catch(() => {}); }
  if (focus) setTimeout(() => $('.tgin', root)?.focus(), 60);
}
function renderChat() {
  const pane = $('.tgchat', root);
  pane.innerHTML = '';
  const d = dialogs.find((x) => x.peer === cur);
  if (!d) { pane.append(h('div', { class: 'tgnone' }, icon('telegram', 34), h('div', {}, 'Выбери чат слева'))); return; }
  pane.append(
    h('div', { class: 'tghead' }, avatarWrap(d, 32), h('div', { class: 'grow', style: 'min-width:0' }, h('div', { class: 'tgdn' }, d.name), h('div', { class: 'tgsub' }, subText(d)))),
    h('div', { class: 'tgnow' }),
    h('div', { class: 'tgmsgs' }, h('div', { class: 'tgload' }, 'Загружаю…')),
    h('div', { class: 'tgreply' }),
    h('div', { class: 'tgatt' }),
    composer(d));
  renderNow();
  renderPend();
}
// "в сети", "был(а) в 14:20", or "печатает…" while they type
function subText(d) {
  const t = typing.get(d.peer);
  if (t && t.until > Date.now() && t.text) return t.text;
  if (d.self) return 'заметки для себя';
  if (d.type === 'user') return d.status || 'личный чат';
  return d.type === 'group' ? 'группа' : 'канал';
}
function avatarWrap(d, size) {
  return h('div', { class: 'tgavw' + (d.online ? ' online' : ''), 'data-peer': d.peer }, avatarEl(d.peer, d.name, size));
}
function updateSub() {
  const d = dialogs.find((x) => x.peer === cur);
  const el = $('.tgsub', root);
  if (d && el) { el.textContent = subText(d); el.classList.toggle('live', !!(d.online || (typing.get(d.peer)?.until > Date.now() && typing.get(d.peer).text))); }
  const hw = $('.tghead .tgavw', root);
  if (d && hw) hw.classList.toggle('online', !!d.online);
}
async function refreshStatus(peer) {
  const d = dialogs.find((x) => x.peer === peer);
  if (!d || d.type !== 'user' || d.self) return;
  try { const r = await api.invoke('tg:status', peer); d.status = r.status; d.online = r.online; } catch {}
  if (peer === cur) updateSub();
  renderList();
}

// ---------- the voice message that is playing (it keeps going in another chat) ----------
function renderNow() {
  const bar = $('.tgnow', root);
  if (!bar) return;
  const show = player && player.peer !== cur;
  bar.classList.toggle('on', !!show);
  if (!show) { bar.innerHTML = ''; return; }
  const a = player.el;
  if (!bar.firstChild) {
    bar.append(
      h('button', { class: 'tgnp', onclick: () => (player.el.paused ? player.el.play() : player.el.pause()) }),
      h('div', { class: 'grow tgnw', onclick: () => openChat(player.peer) }, h('b', {}, player.who), h('span', { class: 'tgnt' })),
      h('button', { class: 'ibtn', title: 'Остановить', html: icon('close', 12), onclick: () => { stopPlayer(); renderNow(); } }));
  }
  $('.tgnp', bar).innerHTML = mediaIcon(a.paused ? 'play' : 'pause', 13);
  $('.tgnt', bar).textContent = `${player.kind === 'round' ? 'Кружок' : 'Голосовое'} · ${clock(a.currentTime || 0)} / ${clock(a.duration || player.duration || 0)}`;
}

// ---------- attachments: files, screenshots, pasted pictures ----------
function renderPend() {
  const bar = $('.tgatt', root);
  if (!bar) return;
  bar.innerHTML = '';
  bar.classList.toggle('on', pend.length > 0);
  pend.forEach((f, i) => bar.append(h('div', { class: 'tgpf' },
    f.url ? h('img', { src: f.url }) : h('span', { class: 'tgpfi', html: icon('file', 16) }),
    h('span', { class: 'tgpfn' }, f.name),
    h('button', { class: 'ibtn', title: 'Убрать', html: icon('close', 11), onclick: () => { pend.splice(i, 1); renderPend(); syncComposer(); } }))));
  syncComposer();
}
function addFiles(list) {
  for (const f of list) pend.push(f);
  renderPend();
  $('.tgin', root)?.focus();
}
async function fileFromBlob(blob, name) {
  return { name, data: new Uint8Array(await blob.arrayBuffer()), url: blob.type.startsWith('image/') ? URL.createObjectURL(blob) : null };
}
async function dataUrlFile(dataUrl, name) { return fileFromBlob(await (await fetch(dataUrl)).blob(), name); }
const isPicName = (n) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(n);
function composer(d) {
  const ta = h('textarea', { class: 'tgin', rows: 1, placeholder: d.type === 'channel' ? 'Только чтение' : 'Сообщение…', spellcheck: 'true' });
  ta.value = draft[cur] || '';
  if (d.type === 'channel') ta.disabled = true;
  const grow = () => { if (!ta.isConnected || ta.clientWidth < 60) return; ta.style.height = ''; if (ta.scrollHeight > ta.clientHeight + 2) ta.style.height = Math.min(110, ta.scrollHeight) + 'px'; keepBottom(); };
  ta.oninput = grow;
  ta.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape' && rec) { e.stopPropagation(); cancelRecording(); return; }
    if (e.key === 'Escape' && editing) { e.stopPropagation(); stopEdit(); return; }
    if (e.key === 'ArrowUp' && !ta.value) { const last = [...msgs].reverse().find((x) => x.out && x.text); if (last) { e.preventDefault(); startEdit(last); } } // like Telegram
    if (e.key === 'Escape' && pend.length) { e.stopPropagation(); pend = []; renderPend(); return; }
    if (e.key === 'Escape' && replyTo) { e.stopPropagation(); setReply(null); }
  };
  ta.addEventListener('input', syncComposer);
  // a picture from the clipboard (Ctrl+V) becomes an attachment
  ta.onpaste = async (e) => {
    const items = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file');
    if (!items.length) return;
    e.preventDefault();
    for (const it of items) { const f = it.getAsFile(); if (f) addFiles([await fileFromBlob(f, f.name && f.name !== 'image.png' ? f.name : `Скриншот ${hhmm(Date.now()).replace(':', '-')}.png`)]); }
  };
  setTimeout(grow, 0);
  const picker = h('input', { type: 'file', multiple: true, style: 'display:none' });
  picker.onchange = () => { addFiles([...picker.files].map((f) => { const p = api.pathOf(f); return { name: f.name, path: p, url: isPicName(f.name) ? URL.createObjectURL(f) : null }; }).filter((x) => x.path)); picker.value = ''; };
  const ro = d.type === 'channel';
  return h('div', { class: 'tgcomp' + (ro ? ' ro' : '') },
    h('button', { class: 'tgtool', title: 'Прикрепить файл', html: icon('attach', 17), onclick: () => picker.click() }), picker,
    h('button', { class: 'tgtool', title: 'Скриншот области — сразу в чат', html: icon('region', 17), onclick: () => { const p = cur; ctx.collapse(false); setTimeout(() => api.invoke('tg:screenshot', p), 200); } }),
    ta,
    h('button', { class: 'tgsend', title: 'Отправить (Enter)', html: icon('send', 17), onclick: send }),
    h('button', { class: 'tgsend tgmic', title: 'Записать голосовое', html: icon('mic', 17), onclick: startRecording }));
}
// the send button turns into a microphone when there's nothing to send
function syncComposer() {
  const c = $('.tgcomp', root);
  if (!c) return;
  c.classList.toggle('empty', !($('.tgin', root)?.value.trim()) && !pend.length);
}
const errMsg = (e) => (e?.message || String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
function gotMessage(peer, m) {
  if (peer === cur && !msgs.some((x) => x.id === m.id)) { msgs.push(m); renderMessages(true); }
  bumpDialog(peer, m);
}
async function send() {
  if (rec) return finishRecording();
  if (editing) {
    const ta = $('.tgin', root), text = ta.value.trim(), m = editing;
    if (!text || text === m.text) return stopEdit();
    try { const n = await api.invoke('tg:edit', cur, m.id, text); Object.assign(m, n); stopEdit(); renderMessages(false); }
    catch (e) { ctx.flash({ icon: '⚠️', title: 'Не изменилось: ' + errMsg(e), ms: 2500 }); }
    return;
  }
  const ta = $('.tgin', root);
  const text = ta?.value.trim() || '';
  if ((!text && !pend.length) || !cur) return;
  const peer = cur, rt = replyTo?.id || null, files = pend;
  ta.value = ''; draft[peer] = ''; ta.style.height = '';
  pend = []; renderPend();
  setReply(null);
  try {
    if (files.length) {
      $('.tgcomp', root)?.classList.add('sending');
      // the text goes as the caption of the first file
      for (const [i, f] of files.entries()) gotMessage(peer, await api.invoke('tg:sendFile', peer, { path: f.path, data: f.data, name: f.name }, i === 0 ? text : '', i === 0 ? rt : null));
    } else gotMessage(peer, await api.invoke('tg:send', peer, text, rt));
  } catch (e) { ctx.flash({ icon: '⚠️', title: 'Не отправилось: ' + errMsg(e), ms: 3500 }); if (peer === cur) { ta.value = text; pend = files; renderPend(); } }
  $('.tgcomp', root)?.classList.remove('sending');
  syncComposer();
}

// ---------- recording a voice message ----------
async function startRecording() {
  if (rec || !cur) return;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { ctx.flash({ icon: '🎙', title: 'Нет доступа к микрофону', ms: 2500 }); return; }
  stopPlayer(); renderNow();
  const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 });
  const ac = new AudioContext();
  const an = ac.createAnalyser(); an.fftSize = 1024;
  ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  rec = { mr, stream, ac, an, chunks: [], levels: [], t0: Date.now(), peer: cur, replyTo: replyTo?.id || null, timer: 0, send: false };
  mr.ondataavailable = (e) => e.data.size && rec?.chunks.push(e.data);
  mr.start(250);
  // live level: drives the bars on screen and becomes the message's waveform
  rec.timer = setInterval(() => {
    if (!rec) return;
    an.getFloatTimeDomainData(buf);
    let sum = 0; for (const v of buf) sum += v * v;
    const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    rec.levels.push(lvl);
    const bars = $('.tgrecw', root);
    if (bars) { const i = h('i', { style: `height:${Math.max(10, lvl * 100)}%` }); bars.append(i); while (bars.children.length > 60) bars.firstChild.remove(); }
    const t = $('.tgrect', root); if (t) t.textContent = clock((Date.now() - rec.t0) / 1000);
    if (Date.now() - rec.t0 > 10 * 60e3) finishRecording(); // Telegram-like limit
  }, 80);
  const c = $('.tgcomp', root);
  c.classList.add('recording');
  c.append(h('div', { class: 'tgrec' },
    h('button', { class: 'tgtool', title: 'Удалить (Esc)', html: icon('trash', 17), onclick: cancelRecording }),
    h('span', { class: 'tgdot' }), h('span', { class: 'tgrect' }, '0:00'), h('div', { class: 'tgrecw grow' })));
}
function stopStream() {
  clearInterval(rec.timer);
  rec.stream.getTracks().forEach((t) => t.stop());
  rec.ac.close().catch(() => {});
  $('.tgcomp', root)?.classList.remove('recording');
  $('.tgrec', root)?.remove();
}
function cancelRecording() {
  if (!rec) return;
  const r = rec; rec = null;
  r.mr.onstop = null;
  try { r.mr.stop(); } catch {}
  rec = r; stopStream(); rec = null;
}
function finishRecording() {
  if (!rec) return;
  const r = rec;
  if (Date.now() - r.t0 < 700) return cancelRecording(); // a slip of the finger
  r.mr.onstop = async () => {
    const blob = new Blob(r.chunks, { type: 'audio/webm' });
    // 100 values 0..31, like Telegram's own waveform
    const L = r.levels.length ? r.levels : [0];
    const peak = Math.max(0.05, ...L);
    const wave = Array.from({ length: 100 }, (_, i) => Math.round((L[Math.floor((i * L.length) / 100)] / peak) * 31));
    $('.tgcomp', root)?.classList.add('sending');
    try { gotMessage(r.peer, await api.invoke('tg:sendVoice', r.peer, new Uint8Array(await blob.arrayBuffer()), wave, r.replyTo)); }
    catch (e) { ctx.flash({ icon: '⚠️', title: 'Голосовое не отправилось: ' + errMsg(e), ms: 3500 }); }
    $('.tgcomp', root)?.classList.remove('sending');
  };
  r.mr.stop();
  stopStream();
  rec = null;
  setReply(null);
}
function setReply(m) {
  replyTo = m;
  const bar = $('.tgreply', root);
  if (!bar) return;
  bar.innerHTML = '';
  bar.classList.toggle('on', !!m);
  if (m) {
    bar.append(h('span', { class: 'tgric', html: icon('reply', 14) }), h('div', { class: 'grow', style: 'min-width:0' }, h('div', { class: 'tgrn' }, m.out ? 'Ты' : m.from || dialogs.find((x) => x.peer === cur)?.name || ''), h('div', { class: 'tgrt' }, snippet(m))),
      h('button', { class: 'ibtn', html: icon('close', 12), title: 'Не отвечать (Esc)', onclick: () => setReply(null) }));
    $('.tgin', root)?.focus();
  }
}
const snippet = (m) => m.text || { voice: '🎤 Голосовое', round: '⏺ Кружок', photo: '🖼 Фото', sticker: 'Стикер', gif: 'GIF', video: '🎬 Видео', audio: '🎵 Аудио', file: '📎 ' + (m.fileName || 'Файл') }[m.kind] || 'Сообщение';

function keepBottom() { const b = $('.tgmsgs', root); if (b && stick) b.scrollTop = b.scrollHeight; }
function renderMessages(toBottom) {
  const box = $('.tgmsgs', root);
  if (!box) return;
  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    box.addEventListener('scroll', () => { stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60; });
    // pictures, stickers and video frames arrive after the text: don't let them push the chat up
    box.addEventListener('load', keepBottom, true);
    box.addEventListener('loadedmetadata', keepBottom, true);
  }
  if (toBottom) stick = true;
  const prevTop = box.scrollTop;
  box.innerHTML = '';
  if (!msgs.length) box.append(h('div', { class: 'tgload' }, 'Здесь пока пусто — напиши первым'));
  let lastDay = '';
  msgs.forEach((m, i) => {
    const day = new Date(m.date).toDateString();
    if (day !== lastDay) { lastDay = day; box.append(h('div', { class: 'tgday' }, new Date(m.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }))); }
    const next = msgs[i + 1];
    const tail = !next || next.out !== m.out || next.from !== m.from || next.date - m.date > 5 * 60e3;
    box.append(messageEl(m, tail));
  });
  if (stick) box.scrollTop = box.scrollHeight; else box.scrollTop = prevTop;
}
function messageEl(m, tail) {
  const reply = m.replyTo ? msgs.find((x) => x.id === m.replyTo) : null;
  const body = h('div', { class: 'tgb' + (m.kind === 'round' || m.kind === 'sticker' ? ' bare' : '') });
  if (m.from && !m.out) body.append(h('div', { class: 'tgfrom', style: `color:${colorOf(m.from)}` }, m.from));
  if (reply) body.append(h('div', { class: 'tgq', onclick: () => jump(reply.id) }, h('b', {}, reply.out ? 'Ты' : reply.from || dialogs.find((x) => x.peer === cur)?.name || ''), h('span', {}, snippet(reply))));
  if (m.kind === 'voice') body.append(voiceEl(m));
  else if (m.kind === 'round') body.append(roundEl(m));
  else if (m.kind === 'photo' || m.kind === 'sticker') body.append(imageEl(m));
  else if (m.kind !== 'text') body.append(h('div', { class: 'tgfile' }, h('span', { html: icon(m.kind === 'audio' ? 'note' : m.kind === 'video' || m.kind === 'gif' ? 'image' : 'file', 16) }), h('span', {}, m.fileName || snippet(m))));
  if (m.text) body.append(h('div', { class: 'tgt', html: linkify(m.text) }));
  const ex = extra.get(`${cur}:${m.id}`);
  if (ex?.tr != null) body.append(h('div', { class: 'tgtr' }, ex.tr || 'Не удалось расшифровать'));
  if (ex?.tl) body.append(h('div', { class: 'tgtl' }, h('span', { html: icon('translate', 11) }), ex.tl));
  if (m.reactions?.length) body.append(h('div', { class: 'tgreacts' }, ...m.reactions.map((r) => h('button', { class: 'tgrx' + (r.mine ? ' mine' : ''), title: r.custom ? 'Свой эмодзи (Premium)' : '', onclick: (e) => { e.stopPropagation(); if (!r.custom) react(m, r.mine ? '' : r.emoji); } }, r.emoji, r.count > 1 ? h('b', {}, String(r.count)) : ''))));
  body.append(h('span', { class: 'tgtime' }, (m.edited ? 'изм. ' : '') + hhmm(m.date)));
  const row = h('div', { class: 'tgm' + (m.out ? ' out' : '') + (tail ? ' tail' : ''), 'data-id': m.id },
    body,
    h('button', { class: 'tgrbtn', title: 'Ответить', html: icon('reply', 14), onclick: (e) => { e.stopPropagation(); setReply(m); } }));
  row.ondblclick = () => setReply(m);
  row.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); messageMenu(m, e.clientX, e.clientY); };
  return row;
}
async function react(m, emoji) {
  try { const n = await api.invoke('tg:react', cur, m.id, emoji); if (n) { Object.assign(m, { reactions: n.reactions }); renderMessages(false); } }
  catch (e) { ctx.flash({ icon: '⚠️', title: 'Реакция не поставилась: ' + errMsg(e), ms: 2500 }); }
}
async function translate(m) {
  const k = `${cur}:${m.id}`, peer = cur, ex = extra.get(k) || {};
  if (ex.tl) { delete ex.tl; extra.set(k, ex); return renderMessages(false); }
  try { const r = await api.invoke('tg:translate', peer, m.id, 'ru'); ex.tl = r.text; extra.set(k, ex); if (peer === cur) renderMessages(false); }
  catch (e) { ctx.flash({ icon: '⚠️', title: 'Перевод не получился: ' + errMsg(e), ms: 3000 }); }
}
function startEdit(m) {
  editing = m; replyTo = null;
  const bar = $('.tgreply', root), ta = $('.tgin', root);
  bar.innerHTML = '';
  bar.classList.add('on');
  bar.append(h('span', { class: 'tgric', html: icon('edit', 14) }), h('div', { class: 'grow', style: 'min-width:0' }, h('div', { class: 'tgrn' }, 'Редактирование'), h('div', { class: 'tgrt' }, m.text)),
    h('button', { class: 'ibtn', html: icon('close', 12), title: 'Отмена (Esc)', onclick: stopEdit }));
  ta.value = m.text; ta.focus(); ta.dispatchEvent(new Event('input'));
}
function stopEdit() { editing = null; const ta = $('.tgin', root); if (ta) { ta.value = ''; ta.dispatchEvent(new Event('input')); } setReply(null); }
async function remove(m, revoke) {
  try { await api.invoke('tg:remove', cur, [m.id], revoke); msgs = msgs.filter((x) => x !== m); renderMessages(false); }
  catch (e) { ctx.flash({ icon: '⚠️', title: 'Не удалилось: ' + errMsg(e), ms: 2500 }); }
}
// forward: pick a chat
function forwardPick(m) {
  const from = cur;
  const box = h('div', { class: 'tgpick' });
  const close = () => ov.remove();
  const ov = h('div', { class: 'tgview tgfw', onclick: (e) => { if (e.target === ov) close(); } }, box);
  const q = h('input', { class: 'field', placeholder: 'Кому переслать…', style: 'height:30px' });
  const list = h('div', { class: 'tgpl' });
  const draw = () => {
    list.innerHTML = '';
    for (const d of dialogs.filter((x) => x.type !== 'channel' && x.name.toLowerCase().includes(q.value.toLowerCase())).slice(0, 30)) {
      list.append(h('div', { class: 'tgdi', onclick: async () => {
        close();
        try { const n = await api.invoke('tg:forward', from, m.id, d.peer); ctx.flash({ icon: '↪', title: `Переслано: ${d.name}`, ms: 1600 }); if (n) bumpDialog(d.peer, n); }
        catch (e) { ctx.flash({ icon: '⚠️', title: 'Не переслалось: ' + errMsg(e), ms: 2500 }); }
      } }, avatarWrap(d, 30), h('div', { class: 'tgdn' }, d.name)));
    }
  };
  q.oninput = draw;
  box.append(h('div', { style: 'font-weight:650;margin-bottom:6px' }, 'Переслать'), q, list);
  $('.tgchat', root).append(ov);
  draw(); q.focus();
}
// right click on a message
function messageMenu(m, x, y) {
  closeMenu();
  const d = dialogs.find((z) => z.peer === cur);
  const media = m.kind !== 'text';
  const items = [];
  const it = (ic, label, fn, cls = '') => items.push(h('button', { class: 'tgmi ' + cls, onclick: () => { closeMenu(); fn(); } }, h('span', { html: icon(ic, 15) }), label));
  if (d?.type !== 'channel') it('reply', 'Ответить', () => setReply(m));
  if (m.text) it('copy', 'Копировать текст', () => navigator.clipboard.writeText(m.text));
  if (m.text && me?.premium) it('translate', 'Перевести', () => translate(m));
  if ((m.kind === 'voice' || m.kind === 'round') && me?.premium) it('text', 'Расшифровать в текст', () => transcribe(m));
  if (m.out && m.text && Date.now() - m.date < 48 * 3600e3) it('edit', 'Изменить', () => startEdit(m));
  it('share', 'Переслать', () => forwardPick(m));
  if (media) it('download', 'Сохранить файл…', async () => { const p = await api.invoke('tg:save', cur, m.id).catch(() => false); if (p) ctx.flash({ icon: '📥', title: 'Сохранено', ms: 1500 }); });
  it('pin', 'Выделить и прокрутить', () => jump(m.id));
  const readRow = m.out && d?.type === 'user' && !d.self && me?.premium ? h('div', { class: 'tgmr' }, 'Прочитано: проверяю…') : null;
  if (m.out) it('trash', 'Удалить у всех', () => remove(m, true), 'bad');
  it('trash', m.out ? 'Удалить у меня' : 'Удалить', () => remove(m, false), 'bad');
  const reacts = d?.type === 'channel' && !m.out ? null : h('div', { class: 'tgmreact' }, ...QUICK_REACT.map((e) => h('button', { class: (m.reactions || []).some((r) => r.mine && r.emoji === e) ? 'mine' : '', onclick: () => { closeMenu(); react(m, (m.reactions || []).some((r) => r.mine && r.emoji === e) ? '' : e); } }, e)));
  const menu = h('div', { class: 'tgmenu' }, reacts, readRow, ...items);
  const host = $('.tgw', root);
  host.append(menu);
  // keep it inside the island (it opens to the left / upwards near the edges)
  const R = host.getBoundingClientRect(), mr = menu.getBoundingClientRect();
  let lx = x - R.left, ty = y - R.top;
  if (lx + mr.width > R.width - 6) lx = Math.max(6, lx - mr.width);
  if (ty + mr.height > R.height - 6) ty = Math.max(6, R.height - mr.height - 6);
  menu.style.left = lx + 'px';
  menu.style.top = ty + 'px';
  if (readRow) api.invoke('tg:readDate', cur, m.id).then((r) => { readRow.textContent = r?.date ? `Прочитано ${dayLabel(r.date)}${new Date(r.date).toDateString() === new Date().toDateString() ? '' : ' в ' + hhmm(r.date)}` : r?.error?.includes('NOT_READ') ? 'Ещё не прочитано' : r?.error?.includes('PRIVACY') || r?.error?.includes('HIDDEN') ? 'Время прочтения скрыто' : r?.error?.includes('TOO_OLD') ? 'Сообщение слишком старое' : 'Время прочтения недоступно'; }).catch(() => readRow.remove());
}
function closeMenu() { $$('.tgmenu', root).forEach((x) => x.remove()); }

function jump(id) {
  const el = $(`.tgm[data-id="${id}"]`, root);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200);
}
function linkify(t) {
  return esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a class="tglink" data-url="$1">$1</a>').replace(/\n/g, '<br>');
}

// ---------- media ----------
async function blobFor(m, thumb = false) {
  const key = `${cur}:${m.id}${thumb ? ':t' : ''}`;
  if (blobs.has(key)) return blobs.get(key);
  const r = await api.invoke('tg:media', cur, m.id, thumb);
  if (!r?.data) { if (r?.tooBig) ctx.flash({ icon: '📎', title: 'Слишком большой файл для острова', ms: 2200 }); return null; }
  const url = URL.createObjectURL(new Blob([r.data], { type: r.mime }));
  blobs.set(key, url);
  return url;
}
function stopPlayer() {
  if (!player) return;
  const p = player; player = null;
  try { p.el.pause(); } catch {}
  p.ui?.(false, 0);
}
// the media element reports to whichever bubble shows it now (chats get redrawn)
function bindPlayer(key, el, kind, m, onEnd) {
  const upd = () => { if (player?.key !== key) return; player.ui?.(!el.paused, el.duration ? el.currentTime / el.duration : 0, el.currentTime); renderNow(); };
  el.ontimeupdate = upd; el.onplay = upd; el.onpause = upd;
  el.onended = () => { if (player?.key !== key) return; const p = player; player = null; p.ui?.(false, 0, 0); renderNow(); onEnd(p); };
  const d = dialogs.find((x) => x.peer === cur);
  player = { key, peer: cur, id: m.id, el, ui: null, kind, duration: m.duration, who: m.out ? 'Ты' : m.from || d?.name || '' };
}
function voiceEl(m) {
  const n = 46;
  const wave = m.wave?.length ? Array.from({ length: n }, (_, i) => m.wave[Math.floor((i * m.wave.length) / n)]) : Array.from({ length: n }, (_, i) => 6 + ((i * 7) % 11));
  const max = Math.max(1, ...wave);
  const bars = h('div', { class: 'tgwave' }, ...wave.map((v) => h('i', { style: `height:${Math.max(12, (v / max) * 100)}%` })));
  const btn = h('button', { class: 'tgvp', html: mediaIcon('play', 15) });
  const dur = h('span', { class: 'tgvd' }, clock(m.duration || 0));
  const el = h('div', { class: 'tgvoice' + (m.unlistened ? ' new' : '') }, btn, h('div', { class: 'grow' }, bars, dur), me?.premium ? trButton(m) : '');
  const key = `${cur}:${m.id}`;
  const ui = (on, k, t) => {
    btn.innerHTML = mediaIcon(on ? 'pause' : 'play', 15);
    const lit = Math.round(k * n);
    $$('i', bars).forEach((b, i) => b.classList.toggle('lit', i < lit));
    dur.textContent = clock(on || k > 0 ? t || 0 : m.duration || 0);
  };
  if (player?.key === key) { player.ui = ui; const a = player.el; ui(!a.paused, a.duration ? a.currentTime / a.duration : 0, a.currentTime); }
  const toggle = async () => {
    if (player?.key === key) { if (player.el.paused) player.el.play(); else player.el.pause(); return; }
    stopPlayer();
    btn.classList.add('busy');
    const url = await blobFor(m).catch(() => null);
    btn.classList.remove('busy');
    if (!url) return;
    const a = new Audio(url);
    bindPlayer(key, a, 'voice', m, (p) => playNextVoice(p));
    player.ui = ui;
    a.play();
    if (m.unlistened) { m.unlistened = false; el.classList.remove('new'); api.invoke('tg:listened', cur, m.id).catch(() => {}); }
  };
  btn.onclick = toggle;
  bars.onclick = (e) => {
    if (player?.key !== key) return toggle();
    const r = bars.getBoundingClientRect();
    player.el.currentTime = ((e.clientX - r.left) / r.width) * (player.el.duration || 0);
  };
  return el;
}
// like Telegram: after one voice message the next unheard one plays (if you're still in that chat)
function playNextVoice(p) {
  if (p.peer !== cur) return;
  const i = msgs.findIndex((x) => x.id === p.id);
  const next = msgs.slice(i + 1).find((x) => (x.kind === 'voice' || x.kind === 'round') && x.unlistened);
  if (next) $(`.tgm[data-id="${next.id}"] :is(.tgvp, .tground)`, root)?.click();
}
// Premium: turn a voice message / video note into text
function trButton(m) {
  return h('button', { class: 'tgtrb', title: 'Расшифровать в текст (Premium)', onclick: (e) => { e.stopPropagation(); transcribe(m); } }, 'Aa');
}
async function transcribe(m) {
  const k = `${cur}:${m.id}`, peer = cur;
  const ex = extra.get(k) || {};
  if (ex.tr != null) { delete ex.tr; extra.set(k, ex); return renderMessages(false); } // second press hides it
  ex.tr = '…'; extra.set(k, ex); renderMessages(false);
  try { const r = await api.invoke('tg:transcribe', peer, m.id); ex.tr = r.text || ''; }
  catch (e) { ex.tr = 'Не получилось: ' + errMsg(e); }
  if (peer === cur) renderMessages(false);
}
function roundEl(m) {
  const key = `${cur}:${m.id}`;
  // the same video keeps playing when you come back to the chat
  const vid = player?.key === key && player.el.tagName === 'VIDEO' ? player.el : h('video', { playsinline: true, preload: 'none' });
  const ring = h('div', { class: 'tgring' });
  const badge = h('span', { class: 'tgrd' }, clock(m.duration || 0));
  const at = h('span', { class: 'tgrd at' }, hhmm(m.date));
  const playIc = h('span', { class: 'tgrp', html: mediaIcon('play', 22) });
  const el = h('div', { class: 'tground' + (m.unlistened ? ' new' : '') }, vid, ring, playIc, badge, at, me?.premium ? trButton(m) : '');
  const ui = (on, k, t) => { el.classList.toggle('playing', on); ring.style.setProperty('--k', k); badge.textContent = clock(on || k > 0 ? t || 0 : m.duration || 0); };
  if (player?.key === key) { player.ui = ui; ui(!vid.paused, vid.duration ? vid.currentTime / vid.duration : 0, vid.currentTime); }
  // a still frame first, so the circle isn't empty
  if (!vid.poster) blobFor(m, true).then((u) => { if (u) vid.poster = u; }).catch(() => {});
  el.onclick = async () => {
    if (player?.key === key) { if (vid.paused) vid.play(); else vid.pause(); return; }
    stopPlayer();
    el.classList.add('busy');
    const url = await blobFor(m).catch(() => null);
    el.classList.remove('busy');
    if (!url) return;
    vid.src = url;
    bindPlayer(key, vid, 'round', m, (p) => playNextVoice(p));
    player.ui = ui;
    vid.play();
    if (m.unlistened) { m.unlistened = false; el.classList.remove('new'); api.invoke('tg:listened', cur, m.id).catch(() => {}); }
  };
  return el;
}
function imageEl(m) {
  const img = h('img', { class: m.kind === 'sticker' ? 'tgstk' : 'tgimg', alt: '' });
  if (m.kind === 'photo' && m.w && m.h) { const k = Math.min(240 / m.w, 220 / m.h); img.style.width = Math.round(m.w * k) + 'px'; img.style.height = Math.round(m.h * k) + 'px'; }
  blobFor(m, true).then((u) => { if (u) img.src = u; }).catch(() => {});
  if (m.kind === 'photo') img.onclick = async () => {
    const u = await blobFor(m).catch(() => null);
    if (!u) return;
    const ov = h('div', { class: 'tgview', onclick: () => ov.remove() }, h('img', { src: u }));
    $('.tgchat', root).append(ov);
  };
  return img;
}

function bumpDialog(peer, m) {
  const d = dialogs.find((x) => x.peer === peer);
  if (!d) { loadDialogs(); return; }
  d.last = snippet(m); d.lastOut = m.out; d.date = m.date;
  if (!m.out && peer !== cur) d.unread = (d.unread || 0) + 1;
  dialogs = [d, ...dialogs.filter((x) => x !== d)].sort((a, b) => (b.pinned - a.pinned));
  renderList();
}

function renderAll() {
  root.innerHTML = '';
  if (state.telegram !== 'on') {
    root.append(h('div', { class: 'tgw' }, h('div', { class: 'tgoff' },
      h('div', { class: 'tglogo', html: icon('telegram', 34) }),
      h('div', { style: 'font-weight:650;font-size:15px' }, 'Telegram прямо в острове'),
      h('div', { class: 'muted small', style: 'max-width:360px;text-align:center' }, 'Чаты, ответы, голосовые и кружки — в своём оформлении. Войди один раз по QR-коду или номеру телефона.'),
      h('button', { class: 'btn pri', onclick: () => { ctx.collapse(false); api.invoke('settings:open', 'notify'); } }, 'Войти в Telegram'))));
    applyLook();
    return;
  }
  const search = h('input', { class: 'field', placeholder: 'Поиск чатов', style: 'height:30px' });
  search.value = query;
  search.oninput = () => { query = search.value; renderList(); };
  root.append(h('div', { class: 'tgw' },
    h('div', { class: 'tgside' }, search, h('div', { class: 'tgdl' })),
    h('div', { class: 'tgchat' })));
  applyLook();
  renderList();
  renderChat();
  if (cur) renderMessages(true);
}

export default {
  id: 'tg', label: 'Telegram', icon: 'telegram', fixedHeight: 540,
  mount(el, c) {
    ctx = c; root = el;
    renderAll();
    root.addEventListener('click', (e) => { const a = e.target.closest('.tglink'); if (a) { e.preventDefault(); api.invoke('url:open', a.dataset.url); } });
    bus.on('telegram-status', (s) => { const was = root.querySelector('.tgoff'); if ((s.status === 'on') === !!was) { renderAll(); if (s.status === 'on') loadDialogs(); } });
    bus.on('settings', applyLook);
    bus.on('tg-new', ({ peer, msg }) => {
      if (!msg) return;
      if (peer === cur && !msgs.some((x) => x.id === msg.id)) {
        msgs.push(msg); renderMessages(false);
        if (!msg.out && root.closest('.page')?.classList.contains('on')) api.invoke('tg:read', peer).catch(() => {});
      }
      bumpDialog(peer, msg);
    });
    bus.on('tg-status', ({ peer, status, online }) => {
      const d = dialogs.find((x) => x.peer === peer);
      if (!d) return;
      d.status = status; d.online = online;
      if (peer === cur) updateSub();
      for (const w of $$(`.tgdl .tgavw[data-peer="${peer}"]`, root)) w.classList.toggle('online', !!online);
    });
    bus.on('tg-typing', ({ peer, text }) => {
      typing.set(peer, { text, until: Date.now() + 6000 });
      if (peer === cur) updateSub();
      renderList();
      setTimeout(() => { if (peer === cur) updateSub(); renderList(); }, 6100);
    });
    // a screenshot taken for this chat comes back: it waits as an attachment, with room for a caption
    bus.on('tg-shot', async ({ peer, dataUrl }) => {
      ctx.openTab('tg');
      if (peer !== cur) await openChat(peer);
      addFiles([await dataUrlFile(dataUrl, `Скриншот ${hhmm(Date.now()).replace(':', '-')}.png`)]);
    });
    // files dropped on the open Telegram tab go to this chat
    bus.on('drop-open', ({ paths }) => {
      if (!root.closest('.page')?.classList.contains('on') || !cur || !paths?.length) return;
      addFiles(paths.map((p) => { const name = p.split(/[\\/]/).pop(); return { name, path: p, url: null }; }));
    });
    // a Telegram notification was clicked: open that chat, ready to answer
    bus.on('tg-open', (peer) => { ctx.openTab('tg'); if (peer) { const go = () => openChat(String(peer)); dialogs.length ? go() : loadDialogs().then(go); } });
    if (state.telegram === 'on') { loadDialogs(); api.invoke('tg:me').then((x) => { me = x; }).catch(() => {}); }
    bus.on('telegram-status', (st) => { if (st.status === 'on' && !me) api.invoke('tg:me').then((x) => { me = x; }).catch(() => {}); });
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('.tgmenu')) closeMenu(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    // dev aid: draw test chats without signing in (used to check the layout)
    window.__tg = (d, m, peer, bl, prem) => { if (prem != null) me = { premium: prem }; if (bl) for (const k in bl) blobs.set(k, bl[k]); state.telegram = 'on'; renderAll(); dialogs = d; cur = peer || d[0]?.peer; msgs = m; renderList(); renderChat(); renderMessages(true); };
    window.__tgOpen = (peer, m) => { cur = peer; msgs = m; renderList(); renderChat(); renderMessages(true); }; // switch chats without loading
  },
  show() {
    if (state.telegram === 'on') { loadDialogs(); setTimeout(() => $('.tgin', root)?.focus(), 80); }
  },
};
