// A quick chat right in the island: click a Telegram message and the island becomes a small chat
// with the last messages and a field to type. Right click a message to answer exactly it.
import { api, bus, $, h, icon } from './core.js';
import { openMediaView, closeMediaView } from './mediaview.js';

let myFace = null; // my Telegram photo (for my own voice messages)
let el, hooks, peer = null, title = '', thumb = '', msgs = [], replyTo = null, menuEl = null, loading = 0;

const snippet = (m) => m.text || { voice: '🎤 Голосовое', round: '⏺ Кружок', photo: '🖼 Фото', sticker: 'Стикер', gif: 'GIF', video: '🎬 Видео', audio: '🎵 Аудио', file: '📎 ' + (m.fileName || 'Файл') }[m.kind] || 'Сообщение';
const hhmm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function initQuickChat(view, h0) {
  el = view; hooks = h0;
  bus.on('tg-new', ({ peer: p, msg }) => {
    if (!msg || p !== peer || !hooks.isOpen() || msgs.some((x) => x.id === msg.id)) return;
    appendMsg(msg);
    if (!msg.out) api.invoke('tg:read', p).catch(() => {});
  });
  document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  bus.on('view', (v) => { if (v !== 'qchat') { stopQuickMedia(); closeViewer(); cancelRec(); clearTimeout(statusTimer); } });
}

export async function openQuickChat(t) {
  stopQuickMedia(); closeViewer();
  peer = String(t.tgPeer); title = (t.title || '').split(' · ')[0] || 'Чат'; thumb = t.thumb || ''; replyTo = null; msgs = [];
  refreshStatus();
  if (myFace === null) api.invoke('tg:me').then((me) => { myFace = me?.avatar || ''; if (msgs.length) renderMsgs(false); }).catch(() => { myFace = ''; });
  render();
  hooks.show();
  const my = ++loading;
  try { msgs = (await api.invoke('tg:messages', peer, 12)) || []; } catch { msgs = []; }
  if (my !== loading) return;
  renderMsgs(true);
  api.invoke('tg:read', peer).catch(() => {});
}

function render() {
  const av = thumb ? h('span', { class: 'qav', style: { backgroundImage: `url('${thumb}')` } }) : h('span', { class: 'qav letter' }, [...title][0]?.toUpperCase() || '•');
  const input = h('textarea', { class: 'qin', rows: 1, placeholder: 'Сообщение…', maxlength: 4096 });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (rec) return cancelRec(); if (closeViewer()) return; if (replyTo) setReply(null); else hooks.close(); }
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(84, input.scrollHeight) + 'px'; hooks.resize(); });
  el.innerHTML = '';
  el.append(
    h('div', { class: 'qhead' }, av, h('div', { class: 'qname' }, h('b', {}, title), h('small', { class: 'qstat' }, '…')),
      h('button', { class: 'ibtn', title: 'Открыть весь чат', html: icon('telegram', 15), onclick: (e) => { e.stopPropagation(); hooks.close(); bus.emit('tg-open', peer); } }),
      h('button', { class: 'ibtn', title: 'Закрыть (Esc)', html: icon('close', 15), onclick: (e) => { e.stopPropagation(); hooks.close(); } })),
    h('div', { class: 'qmsgs' }, h('div', { class: 'qload' }, h('i'), h('i'), h('i'))),
    h('div', { class: 'qreply' }),
    h('div', { class: 'qbar' }, input, h('button', { class: 'qsend', title: 'Отправить (Enter)', html: icon('send', 16), onclick: (e) => { e.stopPropagation(); if (rec) finishRec(); else if (!input.value.trim()) startRec(); else send(input); } })));
  input.addEventListener('input', syncBar);
  setTimeout(syncBar, 0);
  setTimeout(() => input.focus(), 80);
}

function msgNode(m, prevOut) {
  const quote = m.replyTo ? msgs.find((x) => x.id === m.replyTo) : null;
  const b = h('div', { class: 'qm' + (m.out ? ' out' : '') + (prevOut === m.out ? ' cont' : '') },
    quote ? h('div', { class: 'qq' }, snippet(quote)) : '',
    mediaNode(m) || '',
    (m.text || !mediaNode.has(m)) ? h('span', { class: 'qt' }, snippet(m)) : '', h('span', { class: 'qtime' }, hhmm(m.date ? m.date * (m.date < 1e12 ? 1000 : 1) : Date.now())));
  if (mediaNode.has(m)) b.classList.add('media', 'k-' + m.kind);
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(m, e.clientX, e.clientY); });
  if (m.pending) b.classList.add('pending');
  b.dataset.id = m.id;
  return b;
}
// a new message slides in at the bottom (no redraw of the whole chat); my own shows at once as "sending"
function appendMsg(m) {
  const box = $('.qmsgs', el);
  if (!box) return;
  if (m.out && !m.pending) {
    const k = msgs.findIndex((x) => x.pending && x.text === m.text);
    if (k >= 0) { const old = msgs[k]; msgs[k] = m; const e = box.querySelector(`[data-id="${old.id}"]`); if (e) { e.dataset.id = m.id; e.classList.remove('pending'); } return; }
  }
  if (msgs.some((x) => x.id === m.id)) return;
  const prev = msgs[msgs.length - 1];
  msgs.push(m);
  box.querySelector('.qempty, .qload')?.remove();
  const b = msgNode(m, prev ? prev.out : null);
  b.classList.add('qm-in');
  box.append(b);
  box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  hooks.resize();
  if (!m.out && !m.pending) api.invoke('tg:read', peer).catch(() => {});
}
function renderMsgs(toBottom) {
  const box = $('.qmsgs', el);
  if (!box) return;
  box.innerHTML = '';
  if (!msgs.length) box.append(h('div', { class: 'qempty' }, 'Здесь появятся сообщения'));
  let prevOut = null;
  for (const m of msgs) {
    const b = msgNode(m, prevOut);
    box.append(b);
    prevOut = m.out;
  }
  if (toBottom) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  hooks.resize();
}

function openMenu(m, x, y) {
  closeMenu();
  const item = (ic, label, fn) => h('button', { class: 'qmi', onclick: (e) => { e.stopPropagation(); closeMenu(); fn(); } }, h('span', { html: icon(ic, 14) }), label);
  menuEl = h('div', { class: 'qmenu hitzone' },
    item('reply', 'Ответить', () => setReply(m)),
    m.text ? item('copy', 'Копировать', () => navigator.clipboard.writeText(m.text)) : '');
  document.getElementById('stage').append(menuEl);
  const r = document.getElementById('stage').getBoundingClientRect();
  menuEl.style.left = Math.min(x - r.left, r.width - menuEl.offsetWidth - 8) + 'px';
  menuEl.style.top = Math.min(y - r.top, r.height - menuEl.offsetHeight - 8) + 'px';
  hooks.reshape();
}
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; hooks.reshape(); } }

function setReply(m) {
  replyTo = m;
  const bar = $('.qreply', el);
  bar.innerHTML = '';
  bar.classList.toggle('on', !!m);
  if (m) bar.append(h('span', { html: icon('reply', 13) }), h('div', { class: 'qrt' }, h('b', {}, m.out ? 'Ты' : title), h('span', {}, snippet(m))),
    h('button', { class: 'ibtn', title: 'Не отвечать', html: icon('close', 12), onclick: (e) => { e.stopPropagation(); setReply(null); } }));
  $('.qin', el)?.focus();
  hooks.resize();
}

async function send(input) {
  const text = input.value.trim();
  if (!text || !peer) return;
  const rt = replyTo?.id || null;
  input.value = ''; input.style.height = 'auto'; setReply(null);
  try {
    appendMsg({ id: 'tmp' + Date.now(), out: true, pending: true, text, kind: 'text', date: Date.now(), replyTo: rt });
    const m = await api.invoke('tg:send', peer, text, rt);
    if (m) appendMsg(m);
  } catch {
    const k = msgs.findIndex((x) => x.pending && x.text === text);
    if (k >= 0) { $('.qmsgs', el)?.querySelector(`[data-id="${msgs[k].id}"]`)?.remove(); msgs.splice(k, 1); }
    input.value = text;
  }
}


// ---------- media: voice messages and video notes play right here, photos / videos open on a click ----------
const blobs = new Map();
let player = null; // { id, el, row }
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
async function blobFor(m, thumb) {
  const key = `${peer}:${m.id}${thumb ? ':t' : ''}`;
  if (blobs.has(key)) return blobs.get(key);
  let r = null;
  try { r = await api.invoke('tg:media', peer, m.id, thumb); } catch {}
  if (!r?.data) return null;
  const url = URL.createObjectURL(new Blob([r.data], { type: r.mime }));
  blobs.set(key, url);
  return url;
}
export function stopQuickMedia() {
  if (!player) return;
  const p = player; player = null;
  try { p.el.pause(); } catch {}
  p.row?.classList.remove('on');
  const b = p.row?.querySelector('.qplay .qpi'); if (b) b.innerHTML = icon('play', 13);
}
function voiceNode(m) {
  const bars = (m.wave?.length ? m.wave : Array.from({ length: 36 }, (_, i) => 6 + ((i * 7) % 13)));
  const max = Math.max(1, ...bars);
  const step = Math.max(1, Math.floor(bars.length / 36));
  const wave = h('span', { class: 'qwave' }, ...bars.filter((_, i) => i % step === 0).slice(0, 36).map((v) => h('i', { style: { height: Math.max(3, Math.round((v / max) * 18)) + 'px' } })));
  const time = h('span', { class: 'qvt' }, mmss(m.duration));
  // the play button is the sender's photo: mine on my voice messages, the friend's on theirs
  const face = m.out ? myFace : (m.from ? '' : thumb);
  const who = m.out ? 'Я' : (m.from || title);
  const btn = h('button', { class: 'qplay' + (face ? ' face' : ''), title: 'Слушать', style: face ? { backgroundImage: `url('${face}')` } : {} },
    face ? '' : h('span', { class: 'qletter' }, [...who][0]?.toUpperCase() || '•'), h('span', { class: 'qpi', html: icon('play', 13) }));
  const row = h('div', { class: 'qvoice' + (m.unlistened ? ' new' : '') }, btn, wave, time);
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (player?.id === m.id) { player.el.paused ? player.el.play() : player.el.pause(); return; }
    stopQuickMedia();
    row.classList.add('load');
    const url = await blobFor(m, false);
    row.classList.remove('load');
    if (!url) { row.classList.add('fail'); return; }
    const a = new Audio(url);
    player = { id: m.id, el: a, row };
    const sync = () => {
      const k = a.duration && isFinite(a.duration) ? a.currentTime / a.duration : 0;
      row.style.setProperty('--vp', k);
      time.textContent = mmss(a.paused && !a.currentTime ? m.duration : a.currentTime);
      row.classList.toggle('on', !a.paused);
      btn.querySelector('.qpi').innerHTML = icon(a.paused ? 'play' : 'pause', 13);
    };
    a.ontimeupdate = sync; a.onplay = sync; a.onpause = sync;
    a.onended = () => { sync(); row.style.setProperty('--vp', 0); time.textContent = mmss(m.duration); if (player?.el === a) player = null; };
    a.play().catch(() => {});
    row.classList.remove('new');
    api.invoke('tg:listened', peer, m.id).catch(() => {});
  });
  return row;
}
function roundNode(m) {
  const vid = h('video', { class: 'qround-v', playsinline: '', muted: '' });
  const box = h('div', { class: 'qround' }, vid, h('span', { class: 'qrplay', html: icon('play', 18) }), h('span', { class: 'qvt' }, mmss(m.duration)));
  blobFor(m, true).then((u) => { if (u) box.style.backgroundImage = `url('${u}')`; });
  box.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (player?.id === m.id) { player.el.paused ? player.el.play() : player.el.pause(); return; }
    stopQuickMedia();
    box.classList.add('load');
    const url = await blobFor(m, false);
    box.classList.remove('load');
    if (!url) return;
    vid.src = url; vid.muted = false;
    player = { id: m.id, el: vid, row: box };
    vid.onplay = () => box.classList.add('on'); vid.onpause = () => box.classList.remove('on');
    vid.onended = () => { box.classList.remove('on'); if (player?.el === vid) player = null; };
    vid.play().catch(() => {});
    api.invoke('tg:listened', peer, m.id).catch(() => {});
  });
  return box;
}
function pictureNode(m) {
  const w = m.w || 4, hh = m.h || 3;
  const ratio = Math.max(0.6, Math.min(1.8, w / hh));
  const pic = h('div', { class: 'qpic' + (m.kind === 'sticker' ? ' st' : '') + (m.kind === 'video' || m.kind === 'gif' ? ' vid' : ''), style: { aspectRatio: String(ratio) } },
    m.kind === 'video' || m.kind === 'gif' ? h('span', { class: 'qrplay', html: icon('play', 16) }) : '');
  blobFor(m, m.kind !== 'sticker').then((u) => { if (u) { pic.style.backgroundImage = `url('${u}')`; pic.classList.add('in'); } });
  if (m.kind !== 'sticker') pic.addEventListener('click', (e) => { e.stopPropagation(); openViewer(m); });
  return pic;
}
mediaNode.has = (m) => ['voice', 'audio', 'round', 'photo', 'sticker', 'video', 'gif'].includes(m.kind);
function mediaNode(m) {
  if (m.kind === 'voice' || m.kind === 'audio') return voiceNode(m);
  if (m.kind === 'round') return roundNode(m);
  if (m.kind === 'photo' || m.kind === 'sticker' || m.kind === 'video' || m.kind === 'gif') return pictureNode(m);
  return null;
}
// a photo / video fills the little chat (zoom with the wheel); a click beside it or Esc brings the chat back
async function openViewer(m) {
  stopQuickMedia();
  const thumb = await blobFor(m, true);
  openMediaView(el, { kind: m.kind, thumb, full: () => blobFor(m, false), save: () => api.invoke('tg:save', peer, m.id) });
}
function closeViewer() { return closeMediaView(); }

// ---------- online / last seen ----------
let statusTimer = 0;
async function refreshStatus() {
  clearTimeout(statusTimer);
  const p = peer;
  let st = null;
  try { st = await api.invoke('tg:status', p); } catch {}
  if (p !== peer) return;
  const s = el && $('.qstat', el);
  if (s) { s.textContent = st?.online ? 'в сети' : (st?.status || 'Telegram'); s.classList.toggle('on', !!st?.online); }
  if (hooks.isOpen()) statusTimer = setTimeout(refreshStatus, 20000);
}

// ---------- recording a voice message ----------
let rec = null;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
async function startRec() {
  if (rec || !peer) return;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { hooks.flash?.({ icon: '🎙', title: 'Нет доступа к микрофону', ms: 2500 }); return; }
  stopQuickMedia();
  const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 });
  const ac = new AudioContext();
  const an = ac.createAnalyser(); an.fftSize = 1024;
  ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  rec = { mr, stream, ac, chunks: [], levels: [], t0: Date.now(), peer, replyTo: replyTo?.id || null, timer: 0 };
  mr.ondataavailable = (e) => e.data.size && rec?.chunks.push(e.data);
  mr.start(250);
  const strip = h('div', { class: 'qrec' },
    h('button', { class: 'ibtn', title: 'Удалить', html: icon('trash', 15), onclick: (e) => { e.stopPropagation(); cancelRec(); } }),
    h('span', { class: 'qrdot' }), h('span', { class: 'qrt' }, '0:00'), h('div', { class: 'qrw' }));
  $('.qbar', el).classList.add('recording');
  $('.qbar', el).prepend(strip);
  rec.timer = setInterval(() => {
    if (!rec) return;
    an.getFloatTimeDomainData(buf);
    let sum = 0; for (const v of buf) sum += v * v;
    const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    rec.levels.push(lvl);
    const bars = $('.qrw', el);
    if (bars) { bars.append(h('i', { style: { height: Math.max(12, lvl * 100) + '%' } })); while (bars.children.length > 46) bars.firstChild.remove(); }
    const t = $('.qrt', el); if (t) t.textContent = clock((Date.now() - rec.t0) / 1000);
    if (Date.now() - rec.t0 > 10 * 60e3) finishRec();
  }, 80);
  syncBar();
}
function endStream(r) {
  clearInterval(r.timer);
  r.stream.getTracks().forEach((t) => t.stop());
  r.ac.close().catch(() => {});
  $('.qrec', el)?.remove();
  $('.qbar', el)?.classList.remove('recording');
}
function cancelRec() {
  if (!rec) return;
  const r = rec; rec = null;
  r.mr.onstop = null;
  try { r.mr.stop(); } catch {}
  endStream(r); syncBar();
}
function finishRec() {
  if (!rec) return;
  const r = rec; rec = null;
  if (Date.now() - r.t0 < 700) { rec = r; return cancelRec(); } // a slip of the finger
  r.mr.onstop = async () => {
    const blob = new Blob(r.chunks, { type: 'audio/webm' });
    const L = r.levels.length ? r.levels : [0];
    const peak = Math.max(0.05, ...L);
    const wave = Array.from({ length: 100 }, (_, i) => Math.round((L[Math.floor((i * L.length) / 100)] / peak) * 31));
    $('.qbar', el)?.classList.add('sending');
    try {
      const m = await api.invoke('tg:sendVoice', r.peer, new Uint8Array(await blob.arrayBuffer()), wave, r.replyTo);
      if (m && r.peer === peer && !msgs.some((x) => x.id === m.id)) { msgs.push(m); renderMsgs(true); }
    } catch { hooks.flash?.({ icon: '⚠️', title: 'Голосовое не отправилось', ms: 3000 }); }
    $('.qbar', el)?.classList.remove('sending');
  };
  r.mr.stop();
  endStream(r);
  setReply(null);
  syncBar();
}
// the round button: a microphone while the field is empty (hold a voice message), the send arrow otherwise
function syncBar() {
  const btn = el && $('.qsend', el), input = el && $('.qin', el);
  if (!btn || !input) return;
  const voice = !rec && !input.value.trim();
  btn.innerHTML = icon(voice ? 'mic' : 'send', 16);
  btn.title = rec ? 'Отправить голосовое' : voice ? 'Записать голосовое' : 'Отправить (Enter)';
  btn.classList.toggle('mic', voice);
  btn.classList.toggle('rec', !!rec);
}

export const quickChatPeer = () => peer;
export const __setMsgs = (list) => { msgs = list; renderMsgs(true); }; // dev aid for tests (no Telegram needed)
