// Optional Telegram notifications through a user client (GramJS / MTProto).
// Needs api_id + api_hash from https://my.telegram.org. The login code and the
// 2FA password are typed by the user on the island; only the session string is kept.
module.exports = function createTelegram({ settings, emit, ask }) {
  let client = null;
  let status = 'off';

  function setStatus(s, extra = {}) { status = s; emit('telegram-status', { status, ...extra }); }

  async function start() {
    const t = settings.data.telegram;
    if (!t.apiId || !t.apiHash) return setStatus('off');
    let TelegramClient, StringSession, NewMessage;
    try {
      ({ TelegramClient } = require('telegram'));
      ({ StringSession } = require('telegram/sessions'));
      ({ NewMessage } = require('telegram/events'));
    } catch {
      return setStatus('error', { error: 'Пакет telegram не установлен (npm install)' });
    }
    try {
      client = new TelegramClient(new StringSession(t.session || ''), Number(t.apiId), t.apiHash, { connectionRetries: 5 });
      client.setLogLevel?.('error');
      setStatus('connecting');
      await client.start({
        phoneNumber: () => ask('phone', 'Номер телефона Telegram (в формате +7…)'),
        phoneCode: () => ask('code', 'Код из Telegram'),
        password: () => ask('password', 'Пароль двухэтапной проверки'),
        onError: (e) => setStatus('error', { error: e.message }),
      });
      t.session = client.session.save();
      settings.save();
      setStatus('on');
      client.addEventHandler(async (event) => {
        try {
          const m = event.message;
          if (!m || m.out) return;
          if (settings.data.telegram.onlyPrivate && !event.isPrivate && !m.mentioned) return;
          const sender = await m.getSender().catch(() => null);
          const chat = event.isPrivate ? null : await m.getChat().catch(() => null);
          const name = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.title || sender.username : 'Telegram';
          emit('notification', {
            kind: 'telegram', app: 'Telegram', logoHint: 'Telegram', title: chat?.title ? `${name} · ${chat.title}` : name,
            body: m.message || (m.media ? 'Вложение' : ''), at: Date.now(),
          });
        } catch {}
      }, new NewMessage({ incoming: true }));
    } catch (e) {
      setStatus('error', { error: e.message });
    }
  }

  return {
    start,
    status: () => status,
    async logout() {
      try { await client?.disconnect(); } catch {}
      settings.data.telegram.session = '';
      settings.save();
      setStatus('off');
    },
  };
};
