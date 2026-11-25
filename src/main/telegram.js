// Optional Telegram through a user client (GramJS / MTProto), like a second Telegram Desktop.
// Needs api_id + api_hash from https://my.telegram.org (kept in settings).
// Sign in: scan a QR code with Telegram on the phone, or by phone number + code (+ 2FA password).
// The login steps live here, in the main process, so the settings window can redraw at any time
// without losing the half-finished login. Only the session string is stored.
const QRCode = require('qrcode');
const path = require('path');
const { webmToOgg } = require('./webm2ogg');

const ERRORS = {
  PHONE_NUMBER_INVALID: 'Неверный номер телефона',
  PHONE_CODE_INVALID: 'Неверный код',
  PHONE_CODE_EXPIRED: 'Код устарел — запроси новый',
  PASSWORD_HASH_INVALID: 'Неверный пароль',
  PHONE_NUMBER_BANNED: 'Этот номер заблокирован в Telegram',
  API_ID_INVALID: 'Неверные api_id / api_hash',
  AUTH_USER_CANCEL: 'Вход отменён',
};
const errText = (e) => ERRORS[e?.errorMessage] || ERRORS[e?.message] || (e?.errorMessage?.startsWith('FLOOD_WAIT') ? 'Слишком много попыток — подожди немного' : e?.errorMessage || e?.message || 'Ошибка');
const RETRY = new Set(['PHONE_CODE_INVALID', 'PASSWORD_HASH_INVALID']); // ask again instead of giving up

module.exports = function createTelegram({ settings, emit, onVoice = () => {} }) {
  let client = null;
  let status = 'off';
  let login = { step: 'idle' };
  let waiting = null; // resolves the step the user is answering (code / password)
  let attempt = 0; // a new login or cancel makes older flows stop

  const lib = () => ({ ...require('telegram'), ...require('telegram/sessions'), ...require('telegram/events') });
  function setStatus(s, extra = {}) { status = s; emit('telegram-status', { status, ...extra }); }
  function setLogin(l) { login = l; emit('telegram-login', login); }
  const creds = () => { const t = settings.data.telegram || {}; return t.apiId && t.apiHash ? { apiId: Number(t.apiId), apiHash: String(t.apiHash).trim() } : null; };
  function newClient(session = '') {
    const { TelegramClient, StringSession } = lib();
    const c = creds();
    const cl = new TelegramClient(new StringSession(session), c.apiId, c.apiHash, { connectionRetries: 5 });
    cl.setLogLevel?.('error');
    return cl;
  }
  async function dropClient() {
    const c = client; client = null;
    try { await c?.disconnect(); } catch {}
    try { await c?.destroy?.(); } catch {}
  }
  function askUser(step, extra = {}) {
    return new Promise((resolve) => { waiting = resolve; setLogin({ step, ...extra }); });
  }

  // ---------- after sign in: notifications + who sent the voice message being played ----------
  const nameOf = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.title || u.username || 'Telegram' : 'Telegram');
  const avatarCache = new Map();
  async function avatarOf(u) {
    if (!u) return null;
    const id = String(u.id);
    if (avatarCache.has(id)) return avatarCache.get(id);
    let url = null;
    try {
      const buf = await client.downloadProfilePhoto(u, { isBig: false });
      if (buf?.length) url = `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`;
    } catch {}
    avatarCache.set(id, url);
    return url;
  }
  const isVoice = (m) => {
    const d = m?.media?.document;
    return !!d?.attributes?.some((a) => (a.className === 'DocumentAttributeAudio' && a.voice) || (a.className === 'DocumentAttributeVideo' && a.roundMessage));
  };
  async function reportVoice(m, users = []) {
    let u = null;
    if (m.out) u = await client.getMe().catch(() => null);
    else {
      const uid = m.fromId?.userId ?? m.peerId?.userId;
      u = uid != null ? users.find((x) => String(x.id) === String(uid)) : null;
    }
    if (!u) u = await m.getSender?.().catch(() => null);
    const round = m.media.document.attributes.some((a) => a.className === 'DocumentAttributeVideo');
    onVoice({ name: m.out ? 'Ты' : nameOf(u), avatar: await avatarOf(u), kind: round ? 'Кружок' : 'Голосовое сообщение', at: Date.now() });
  }
  function listen() {
    const { Api, NewMessage, Raw } = lib();
    client.addEventHandler(async (event) => {
      try {
        const m = event.message;
        if (!m) return;
        const peer = String(m.chatId ?? '');
        emit('tg-new', { peer, msg: await shape(m) }); // the open chat and the chat list update live
        if (m.out) return;
        if (!settings.data.notifications?.telegram) return;
        if (settings.data.telegram.onlyPrivate && !event.isPrivate && !m.mentioned) return;
        const sender = await m.getSender().catch(() => null);
        const chat = event.isPrivate ? null : await m.getChat().catch(() => null);
        const name = nameOf(sender);
        emit('notification', {
          kind: 'telegram', app: 'Telegram', logoHint: 'Telegram', tgPeer: peer, thumb: (await avatarOf(sender)) || undefined, title: chat?.title ? `${name} · ${chat.title}` : name,
          body: m.message || '', at: Date.now(),
          ...(m.media && !isVoice(m) ? { tgMsgId: m.id, media: kindOf(m) } : {}),
          ...(isVoice(m) ? (() => { const at = m.media.document.attributes || []; const a = at.find((x) => x.className === 'DocumentAttributeAudio') || at.find((x) => x.className === 'DocumentAttributeVideo'); return { tgMsgId: m.id, voice: at.some((x) => x.className === 'DocumentAttributeVideo' && x.roundMessage) ? 'round' : 'voice', duration: a?.duration || 0 }; })() : {}),
        });
      } catch {}
    }, new NewMessage({}));
    // Listening to a voice message in Telegram marks it "listened": the server tells every session
    // which messages those were, so the island learns whose voice message is playing.
    client.addEventHandler(async (u) => {
      try {
        let res;
        if (u instanceof Api.UpdateReadMessagesContents) {
          res = await client.invoke(new Api.messages.GetMessages({ id: u.messages.map((id) => new Api.InputMessageID({ id })) }));
        } else if (u instanceof Api.UpdateChannelReadMessagesContents) {
          res = await client.invoke(new Api.channels.GetMessages({ channel: u.channelId, id: u.messages.map((id) => new Api.InputMessageID({ id })) }));
        } else return;
        const m = (res?.messages || []).find(isVoice);
        if (m) await reportVoice(m, res.users || []);
      } catch {}
    }, new Raw({ types: [Api.UpdateReadMessagesContents, Api.UpdateChannelReadMessagesContents] }));
    client.addEventHandler((u) => {
      try {
        if (u instanceof Api.UpdateUserStatus) {
          const peer = String(u.userId);
          const e = entities.get(peer);
          if (e) e.status = u.status;
          emit('tg-status', { peer, status: statusText({ className: 'User', status: u.status }), online: u.status?.className === 'UserStatusOnline' });
        } else if (u instanceof Api.UpdateTranscribedAudio) {
          if (!u.pending) transcribing.get(String(u.transcriptionId))?.(u.text);
        } else if (u instanceof Api.UpdateUserTyping) {
          const a = u.action?.className || '';
          emit('tg-typing', { peer: String(u.userId), text: a.includes('RecordAudio') ? 'записывает голосовое…' : a.includes('RecordRound') ? 'записывает кружок…' : a.includes('Cancel') ? '' : 'печатает…' });
        }
      } catch {}
    }, new Raw({ types: [Api.UpdateUserStatus, Api.UpdateUserTyping, Api.UpdateTranscribedAudio] }));
  }
  // a voice message that was already listened to before: guess the newest one
  async function guessVoice() {
    if (status !== 'on' || !client) return;
    try {
      const { Api } = lib();
      const r = await client.invoke(new Api.messages.SearchGlobal({ q: '', filter: new Api.InputMessagesFilterVoice(), minDate: 0, maxDate: 0, offsetRate: 0, offsetPeer: new Api.InputPeerEmpty(), offsetId: 0, limit: 1 }));
      const m = r?.messages?.[0];
      const fresh = m && Date.now() / 1000 - (m.date || 0) < 10 * 60;
      if (m && isVoice(m) && fresh) await reportVoice(m, r.users || []);
    } catch {}
  }

  // ---------- the mini Telegram on the island ----------
  // "в сети" / "был(а) в 14:20" / "был(а) недавно"…
  function statusText(u) {
    if (!u || u.className !== 'User') return '';
    if (u.self) return '';
    if (u.bot) return 'бот';
    const st = u.status;
    if (!st) return 'был(а) давно';
    switch (st.className) {
      case 'UserStatusOnline': return 'в сети';
      case 'UserStatusRecently': return 'был(а) недавно';
      case 'UserStatusLastWeek': return 'был(а) на этой неделе';
      case 'UserStatusLastMonth': return 'был(а) в этом месяце';
      case 'UserStatusOffline': {
        const d = new Date(st.wasOnline * 1000), now = new Date();
        const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        if (now - d < 60e3) return 'был(а) только что';
        if (d.toDateString() === now.toDateString()) return `был(а) в ${t}`;
        const y = new Date(now); y.setDate(now.getDate() - 1);
        if (d.toDateString() === y.toDateString()) return `был(а) вчера в ${t}`;
        return `был(а) ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
      }
      default: return 'был(а) давно';
    }
  }
  const entities = new Map(); // peer id -> entity, filled from the chat list
  const transcribing = new Map(); // transcription id -> resolve
  const kindOf = (m) => {
    if (m.photo) return 'photo';
    const d = m.media?.document;
    if (!d) return m.media ? 'other' : 'text';
    const at = d.attributes || [];
    if (at.some((a) => a.className === 'DocumentAttributeSticker')) return 'sticker';
    if (at.some((a) => a.className === 'DocumentAttributeVideo' && a.roundMessage)) return 'round';
    if (at.some((a) => a.className === 'DocumentAttributeAudio' && a.voice)) return 'voice';
    if (at.some((a) => a.className === 'DocumentAttributeAnimated')) return 'gif';
    if (at.some((a) => a.className === 'DocumentAttributeAudio')) return 'audio';
    if (at.some((a) => a.className === 'DocumentAttributeVideo')) return 'video';
    return 'file';
  };
  // Telegram packs a voice message's waveform as 5-bit values
  function waveform(bytes) {
    if (!bytes?.length) return null;
    const n = Math.floor((bytes.length * 8) / 5), out = [];
    for (let i = 0; i < n; i++) {
      const bit = i * 5, byte = bit >> 3, shift = bit & 7;
      const v = ((bytes[byte] | ((bytes[byte + 1] || 0) << 8)) >> shift) & 31;
      out.push(v);
    }
    return out;
  }
  async function shape(m) {
    const kind = kindOf(m);
    const d = m.media?.document;
    const audio = d?.attributes?.find((a) => a.className === 'DocumentAttributeAudio');
    const video = d?.attributes?.find((a) => a.className === 'DocumentAttributeVideo');
    const fileName = d?.attributes?.find((a) => a.className === 'DocumentAttributeFilename')?.fileName;
    let from = '';
    if (!m.out && m.isGroup) { const u = await m.getSender().catch(() => null); from = nameOf(u); }
    return {
      id: m.id, out: !!m.out, date: (m.date || 0) * 1000, text: m.message || '', kind, from,
      duration: audio?.duration || video?.duration || 0, wave: kind === 'voice' ? waveform(audio?.waveform) : null,
      fileName: fileName || '', size: Number(d?.size || 0), replyTo: m.replyTo?.replyToMsgId || null,
      unlistened: !!m.mediaUnread && (kind === 'voice' || kind === 'round'), edited: !!m.editDate,
      reactions: (m.reactions?.results || []).map((r) => ({ emoji: r.reaction?.emoticon || (r.reaction?.className === 'ReactionCustomEmoji' ? '⭐' : '❤️'), custom: r.reaction?.className === 'ReactionCustomEmoji', count: r.count, mine: r.chosenOrder != null })),
      ...(() => { const sz = m.photo?.sizes?.filter((x) => x.w).pop(); return sz ? { w: sz.w, h: sz.h } : {}; })(),
    };
  }
  const preview = (m) => {
    if (!m) return '';
    const k = kindOf(m);
    const label = { photo: '🖼 Фото', voice: '🎤 Голосовое', round: '⏺ Кружок', sticker: 'Стикер', gif: 'GIF', audio: '🎵 Аудио', video: '🎬 Видео', file: '📎 Файл', other: 'Сообщение' }[k];
    return m.message || label || '';
  };
  function need() { if (status !== 'on' || !client) throw new Error('Telegram не подключён'); }
  async function entityOf(peer) {
    if (entities.has(peer)) return entities.get(peer);
    // a numeric id must go in as a number (a string would be read as a username)
    const e = await client.getEntity(/^-?\d+$/.test(peer) ? require('telegram/Helpers').returnBigInt(peer) : peer);
    entities.set(peer, e);
    return e;
  }
  const tg = {
    async dialogs(limit = 40) {
      need();
      const ds = await client.getDialogs({ limit });
      return ds.filter((d) => d.entity).map((d) => {
        const peer = String(d.id);
        entities.set(peer, d.entity);
        const self = d.entity?.self;
        return {
          peer, name: self ? 'Избранное' : d.title || d.name || 'Без имени', status: statusText(d.entity), online: d.entity?.status?.className === 'UserStatusOnline', self: !!self, premium: !!d.entity?.premium && !self, unread: d.unreadCount || 0, pinned: !!d.pinned, muted: !!d.dialog?.notifySettings?.muteUntil,
          type: d.isUser ? 'user' : d.isGroup ? 'group' : 'channel', last: preview(d.message), lastOut: !!d.message?.out, date: (d.message?.date || 0) * 1000,
        };
      });
    },
    async avatar(peer) { need(); return avatarOf(await entityOf(peer)); },
    async messages(peer, limit = 40) {
      need();
      const e = await entityOf(peer);
      const list = await client.getMessages(e, { limit });
      const out = [];
      for (const m of list) if (m && m.className === 'Message') out.push(await shape(m));
      return out.reverse();
    },
    async send(peer, text, replyTo) {
      need();
      const m = await client.sendMessage(await entityOf(peer), { message: String(text || ''), replyTo: replyTo || undefined });
      return shape(m);
    },
    // fresh status of a person when their chat opens
    async status(peer) {
      need();
      const { Api } = lib();
      const e = await entityOf(peer);
      if (e.className !== 'User') return { status: '', online: false };
      try { const [u] = await client.invoke(new Api.users.GetUsers({ id: [e] })); if (u) { entities.set(peer, u); return { status: statusText(u), online: u.status?.className === 'UserStatusOnline' }; } } catch {}
      return { status: statusText(e), online: e.status?.className === 'UserStatusOnline' };
    },
    // a file from disk, or bytes (a screenshot / pasted picture); pictures go as photos
    async sendFile(peer, f, caption = '', replyTo) {
      need();
      const { CustomFile } = require('telegram/client/uploads');
      let file, name;
      if (f?.path) { file = f.path; name = path.basename(f.path); }
      else { const buf = Buffer.from(f.data); name = f.name || 'image.png'; file = new CustomFile(name, buf.length, '', buf); }
      const isPic = /\.(png|jpe?g|webp|bmp)$/i.test(name) && !f.asFile;
      const m = await client.sendFile(await entityOf(peer), { file, caption: String(caption || ''), forceDocument: !isPic, replyTo: replyTo || undefined, workers: 2 });
      return shape(m);
    },
    // a voice message recorded on the island: WebM from the recorder becomes Ogg/Opus like Telegram's own
    async sendVoice(peer, data, waveform100, replyTo) {
      need();
      const { Api } = lib();
      const { CustomFile } = require('telegram/client/uploads');
      const { ogg, duration } = webmToOgg(Buffer.from(data));
      // Telegram stores the waveform as 5-bit values
      const vals = (waveform100 || []).map((v) => Math.max(0, Math.min(31, Math.round(v))));
      const packed = Buffer.alloc(Math.ceil((vals.length * 5) / 8) + 1);
      vals.forEach((v, i) => { const bit = i * 5, byte = bit >> 3, sh = bit & 7; const w = (packed[byte] | (packed[byte + 1] << 8)) | (v << sh); packed[byte] = w & 0xff; packed[byte + 1] = (w >> 8) & 0xff; });
      const file = new CustomFile('voice.ogg', ogg.length, '', ogg);
      const m = await client.sendFile(await entityOf(peer), {
        file, voiceNote: true, replyTo: replyTo || undefined,
        attributes: [new Api.DocumentAttributeAudio({ voice: true, duration: Math.max(1, Math.round(duration)), waveform: packed.subarray(0, Math.ceil((vals.length * 5) / 8)) })],
      });
      return shape(m);
    },
    // who I am (and whether I have Telegram Premium)
    async me() { need(); const u = await client.getMe(); return { id: String(u.id), name: nameOf(u), premium: !!u.premium, avatar: (await avatarOf(u)) || null }; },
    async react(peer, id, emoji) {
      need();
      const { Api } = lib();
      await client.invoke(new Api.messages.SendReaction({ peer: await entityOf(peer), msgId: Number(id), reaction: emoji ? [new Api.ReactionEmoji({ emoticon: emoji })] : [] }));
      const [m] = await client.getMessages(await entityOf(peer), { ids: [Number(id)] });
      return m ? shape(m) : null;
    },
    async remove(peer, ids, revoke) { need(); await client.deleteMessages(await entityOf(peer), ids.map(Number), { revoke: !!revoke }); return true; },
    async edit(peer, id, text) { need(); const m = await client.editMessage(await entityOf(peer), { message: Number(id), text: String(text) }); return shape(m); },
    async forward(fromPeer, id, toPeer) { need(); const r = await client.forwardMessages(await entityOf(toPeer), { messages: [Number(id)], fromPeer: await entityOf(fromPeer) }); return r?.[0] ? shape(r[0]) : null; },
    // Premium: a voice message / video note as text (the server may finish it a bit later)
    async transcribe(peer, id) {
      need();
      const { Api } = lib();
      const r = await client.invoke(new Api.messages.TranscribeAudio({ peer: await entityOf(peer), msgId: Number(id) }));
      if (!r.pending) return { text: r.text };
      const tid = String(r.transcriptionId);
      return new Promise((resolve) => {
        const done = (text) => { transcribing.delete(tid); resolve({ text }); };
        transcribing.set(tid, done);
        setTimeout(() => transcribing.has(tid) && done(r.text || ''), 30e3);
      });
    },
    // Premium: translate a message
    async translate(peer, id, toLang = 'ru') {
      need();
      const { Api } = lib();
      const r = await client.invoke(new Api.messages.TranslateText({ peer: await entityOf(peer), id: [Number(id)], toLang }));
      return { text: r.result?.[0]?.text || '' };
    },
    // Premium: when the other person read my message (private chats)
    async readDate(peer, id) {
      need();
      const { Api } = lib();
      try { const r = await client.invoke(new Api.messages.GetOutboxReadDate({ peer: await entityOf(peer), msgId: Number(id) })); return { date: r.date * 1000 }; }
      catch (e) { return { error: e.errorMessage || e.message }; }
    },
    // save a message's file to disk (the window asks where)
    async download(peer, id) {
      need();
      const [m] = await client.getMessages(await entityOf(peer), { ids: [Number(id)] });
      if (!m?.media) return null;
      const buf = await client.downloadMedia(m, {});
      const k = kindOf(m);
      const fn = m.media.document?.attributes?.find((a) => a.className === 'DocumentAttributeFilename')?.fileName;
      const ext = { voice: '.ogg', round: '.mp4', video: '.mp4', gif: '.mp4', photo: '.jpg', sticker: '.webp', audio: '.mp3' }[k] || '';
      return { data: buf, name: fn || `telegram-${m.id}${ext}` };
    },
    async read(peer) { need(); try { await client.markAsRead(await entityOf(peer)); } catch {} return true; },
    // the file of a voice message / video note / photo: bytes go to the window (it plays them from a blob)
    async media(peer, id, thumb = false) {
      need();
      const e = await entityOf(peer);
      const [m] = await client.getMessages(e, { ids: [Number(id)] });
      if (!m?.media) return null;
      const k = kindOf(m);
      if (!thumb && (m.media.document?.size || 0) > 60e6) return { tooBig: true }; // played on the island; bigger ones: «Сохранить»
      const buf = await client.downloadMedia(m, thumb || k === 'photo' || k === 'sticker' ? { thumb: k === 'photo' ? 1 : 0 } : {});
      if (!buf?.length) return null;
      const mime = k === 'voice' ? 'audio/ogg' : k === 'round' || k === 'video' || k === 'gif' ? 'video/mp4' : k === 'sticker' ? 'image/webp' : 'image/jpeg';
      return { mime, data: new Uint8Array(buf) };
    },
    // a voice message / video note played on the island counts as listened, like in Telegram
    async listened(peer, id) {
      need();
      const { Api } = lib();
      const e = await entityOf(peer);
      try {
        if (e.className === 'Channel') await client.invoke(new Api.channels.ReadMessageContents({ channel: e, id: [Number(id)] }));
        else await client.invoke(new Api.messages.ReadMessageContents({ id: [Number(id)] }));
      } catch {}
      return true;
    },
  };

  async function finish(cl) {
    settings.data.telegram.session = cl.session.save();
    settings.save();
    client = cl;
    setStatus('on');
    setLogin({ step: 'done' });
    listen();
  }

  // start with the saved session (on launch); never asks anything
  async function start() {
    if (!creds()) return setStatus('off');
    if (!settings.data.telegram.session) return setStatus('off');
    try { lib(); } catch { return setStatus('error', { error: 'Пакет telegram не установлен (npm install)' }); }
    const my = ++attempt;
    await dropClient();
    const cl = newClient(settings.data.telegram.session);
    try {
      setStatus('connecting');
      await cl.connect();
      if (!(await cl.checkAuthorization())) throw Object.assign(new Error('session'), { errorMessage: 'AUTH_KEY_UNREGISTERED' });
      if (my !== attempt) return cl.disconnect();
      await finish(cl);
    } catch (e) {
      try { await cl.disconnect(); } catch {}
      if (e?.errorMessage === 'AUTH_KEY_UNREGISTERED') { settings.data.telegram.session = ''; settings.save(); setStatus('off', { error: 'Сессия закончилась — войди заново' }); }
      else setStatus('error', { error: errText(e) });
    }
  }

  // method: 'qr' (scan with the phone) or 'phone' (number + code)
  async function beginLogin(method, phone) {
    if (!creds()) { setLogin({ step: 'idle', error: 'Сначала впиши api_id и api_hash' }); return; }
    const my = ++attempt;
    waiting = null;
    await dropClient();
    const cl = newClient('');
    client = cl;
    setStatus('connecting');
    setLogin({ step: 'busy', text: 'Подключаюсь к Telegram…' });
    const alive = () => { if (my !== attempt) throw new Error('AUTH_USER_CANCEL'); };
    const password = async (hint) => { alive(); const p = await askUser('password', { hint: hint || '' }); alive(); return p; };
    const onError = async (e) => {
      if (my !== attempt) return true;
      if (RETRY.has(e?.errorMessage)) { setLogin({ ...login, error: errText(e) }); return false; }
      return true;
    };
    try {
      await cl.connect();
      alive();
      if (method === 'qr') {
        await cl.signInUserWithQrCode(creds(), {
          qrCode: async ({ token, expires }) => {
            alive();
            const url = 'tg://login?token=' + Buffer.from(token).toString('base64url');
            setLogin({ step: 'qr', qr: await QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#000000', light: '#ffffff' } }), expires: expires * 1000 });
          },
          password,
          onError,
        });
      } else {
        await cl.start({
          phoneNumber: async () => phone,
          phoneCode: async (viaApp) => { alive(); const c = await askUser('code', { viaApp: !!viaApp, phone }); alive(); return c; },
          password,
          onError,
        });
      }
      alive();
      await finish(cl);
    } catch (e) {
      if (my !== attempt) return; // cancelled or replaced by a newer attempt
      await dropClient();
      setStatus('off');
      setLogin({ step: 'idle', error: errText(e) });
    }
  }

  return {
    start,
    status: () => status,
    loginState: () => login,
    login: (method, phone) => { beginLogin(method, phone); return true; },
    answer(v) { const w = waiting; waiting = null; w?.(String(v || '').trim()); },
    async cancel() {
      attempt++; waiting?.(''); waiting = null;
      await dropClient();
      setLogin({ step: 'idle' });
      if (settings.data.telegram.session) start(); else setStatus('off');
    },
    guessVoice,
    tg,
    async logout() {
      attempt++;
      await dropClient();
      settings.data.telegram.session = '';
      settings.save();
      setStatus('off');
      setLogin({ step: 'idle' });
    },
  };
};
