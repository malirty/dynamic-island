// Now playing via Windows SMTC (through the helper) + synced lyrics from lrclib.
const helper = require('./helper');

const KNOWN = {
  '308046b0af4a39cb': 'firefox',
  msedge: 'msedge',
  chrome: 'chrome',
  'microsoft.zunemusic': 'microsoft.media.player',
  'spotifyab.spotifymusic': 'spotify',
};

function processMatchFor(aumid = '') {
  const id = aumid.toLowerCase();
  for (const k of Object.keys(KNOWN)) if (id.includes(k)) return KNOWN[k];
  let m = id.includes('!') ? id.split('!').pop() : id;
  m = m.replace(/\.exe$/, '').split(/[\\/]/).pop();
  m = m.split('.').filter(Boolean).pop() || m;
  return m.replace(/[^a-z0-9]/g, '');
}

function prettyApp(aumid = '') {
  const m = processMatchFor(aumid);
  const names = { spotify: 'Spotify', chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', yandexmusic: 'Яндекс Музыка', 'microsoft.media.player': 'Медиаплеер', telegram: 'Telegram', telegramdesktop: 'Telegram', vk: 'VK', browser: 'Яндекс Браузер' };
  return names[m] || (m ? m[0].toUpperCase() + m.slice(1) : '');
}

// a voice message without the sender's photo gets the Telegram logo as its cover
const TG_LOGO = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2AABEE"/><stop offset="1" stop-color="#229ED9"/></linearGradient></defs><rect width="240" height="240" fill="url(#g)"/><path fill="#fff" d="M54.3 118.8c35-15.2 58.3-25.3 70-30.2 33.3-13.9 40.3-16.3 44.8-16.4 1 0 3.2.2 4.7 1.4 1.2 1 1.5 2.3 1.7 3.3s.4 3.1.2 4.7c-1.8 19-9.6 65.1-13.6 86.3-1.7 9-5 12-8.2 12.3-7 .6-12.3-4.6-19-9-10.6-6.9-16.5-11.2-26.8-18-11.9-7.8-4.2-12.1 2.6-19.1 1.8-1.8 32.5-29.8 33.1-32.3.1-.3.1-1.5-.6-2.1-.7-.6-1.7-.4-2.5-.2-1.1.2-17.9 11.4-50.6 33.5-4.8 3.3-9.1 4.9-13 4.8-4.3-.1-12.5-2.4-18.7-4.4-7.5-2.4-13.5-3.7-13-7.9.3-2.2 3.3-4.4 8.9-6.7z"/></svg>').toString('base64');

module.exports = function createMedia({ emit, log = () => {}, onVoiceStart = () => {}, callProcs = () => [] }) {
  // who sent the Telegram voice message that is playing (from telegram.js, when signed in)
  let voice = null;
  let state = { active: false };
  let trackKey = '';
  let thumb = null;
  let lyrics = null;
  let busy = false;
  let voiceAsked = false;
  // browsers update the SMTC timeline rarely; after a seek we trust our own position
  // until the player reports a newer one
  let seekTo = null;

  async function fetchLyrics(s) {
    lyrics = null;
    try {
      const artist = (s.artist || '').split(/,|&| feat\.| ft\./i)[0].trim();
      const q = new URLSearchParams({ artist_name: artist, track_name: s.title });
      if (s.duration > 0) q.set('duration', Math.round(s.duration));
      let r = await fetch(`https://lrclib.net/api/get?${q}`, { headers: { 'User-Agent': 'Island-Desktop/0.1' } });
      let j = r.ok ? await r.json() : null;
      if (!j || (!j.syncedLyrics && !j.plainLyrics)) {
        r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(artist + ' ' + s.title)}`, { headers: { 'User-Agent': 'Island-Desktop/0.1' } });
        const list = r.ok ? await r.json() : [];
        j = list.find((x) => x.syncedLyrics) || list[0];
      }
      if (j) lyrics = { synced: j.syncedLyrics ? parseLrc(j.syncedLyrics) : null, plain: j.plainLyrics || '' };
    } catch {}
    emit('lyrics', { key: trackKey, lyrics });
  }

  function parseLrc(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      if (m) out.push({ t: +m[1] * 60 + +m[2], text: m[3].trim() });
    }
    return out;
  }

  // Sound from apps that don't publish media controls (games, messengers, some players):
  // the island still shows "<app> — играет звук" while it lasts. Windows' own processes and
  // short dings (notifications) don't count: the sound has to go on for about a second.
  const QUIET_APPS = new Set(['audiodg', 'electron', 'island', 'explorer', 'shellexperiencehost', 'systemsettings', 'svchost', 'searchhost', 'startmenuexperiencehost', 'lockapp']);
  let loudSince = 0, loudLast = 0, loudApp = null;
  let tgLoudAt = 0, tgPlayStart = 0;
  let forced = null; // { playing, until }: right after a button press the island trusts the press, not the lagging status // when Telegram was last heard / said it started playing
  async function loudNow() {
    let list = [];
    try { list = helper.arr(await helper.fast('loud', {}, 3000)); } catch {}
    const now = Date.now();
    if (list.some((x) => /telegram/i.test(x.name || '') && x.peak > 0.01)) tgLoudAt = now;
    const inCall = new Set(callProcs()); // Zoom on a call is the call, not "Zoom is playing sound"
    const top = list.filter((x) => x.name && !QUIET_APPS.has(x.name.toLowerCase()) && !inCall.has(x.name.toLowerCase()) && x.peak > 0.01).sort((a, b) => b.peak - a.peak)[0];
    if (top) {
      if (!loudApp || loudApp.name !== top.name) { loudApp = top; loudSince = now; }
      loudLast = now;
    } else if (now - loudLast > 3000) { loudApp = null; loudSince = 0; } // keep it ~3 s through short pauses
    return loudApp && now - loudSince >= 700 ? loudApp : null;
  }
  function soundOnly(a) {
    const name = prettyApp(a.name) || a.name;
    if (!state.soundOnly || !state.key.startsWith(`sound|${a.name}|`)) log(`media now: sound from ${a.name}`);
    // Telegram playing without telling Windows: that's a voice message / video note
    const tg = /telegram/i.test(a.name);
    const v = tg && voice && Date.now() - voice.at < 10 * 60e3 ? voice : null;
    state = {
      active: true, soundOnly: true, key: `sound|${a.name}|${v?.name || ''}`,
      title: tg ? (v ? v.name : 'Голосовое сообщение') : name, artist: tg ? (v ? v.kind : 'Telegram') : 'Играет звук', status: 'Playing',
      playing: true, position: 0, duration: 0, canSeek: false, app: tg ? 'Telegram' : name, appMatch: a.name.toLowerCase(), aumid: '',
      thumb: tg ? v?.avatar || TG_LOGO : null, at: Date.now(),
    };
    if (tg && !v && !voiceAsked) { voiceAsked = true; onVoiceStart(); }
    if (trackKey !== state.key) { trackKey = state.key; thumb = null; lyrics = null; emit('lyrics', { key: trackKey, lyrics }); }
    emit('media', state);
  }

  async function poll() {
    if (busy) return;
    busy = true;
    const t0 = Date.now();
    try {
      const s = await helper.fast('media', { thumb: false }, 6000);
      const dt = Date.now() - t0;
      if (dt > 1500) log(`media poll slow: ${dt} ms, ${s?.stale ? 'stale' : s?.active ? s.app + ' ' + s.status : 'nothing'}`);
      if (s?.stale) {
        // the player didn't answer in time: keep what we have, but a sound that is playing still shows
        if (!state.active || state.soundOnly) { const a = await loudNow(); if (a) soundOnly(a); }
        return;
      }
      // nothing is playing through media controls: maybe some app is still making sound
      const rawTgPlaying = !!(s?.active && s.status === 'Playing' && processMatchFor(s.app).includes('telegram'));
      if (!(s?.active && s.status === 'Playing')) {
        const a = await loudNow();
        const same = a && s?.active && processMatchFor(s.app).includes(a.name.toLowerCase());
        if (a && !same) { soundOnly(a); return; }
        // the player's own status lags (Telegram says "paused" while the voice message already plays):
        // its sound decides
        if (same) s.status = 'Playing';
      } else {
        // Telegram keeps saying "playing" for a while after a voice message is paused: silence decides
        if (processMatchFor(s.app).includes('telegram')) {
          await loudNow();
          if (!tgPlayStart) tgPlayStart = Date.now();
          if (Date.now() - Math.max(tgLoudAt, tgPlayStart) > 3000) s.status = 'Paused'; // speech has pauses: 3 s of silence
        }
        loudApp = null; loudSince = 0;
      }
      if (!rawTgPlaying) tgPlayStart = 0;
      if (forced && Date.now() < forced.until && s?.active) s.status = forced.playing ? 'Playing' : 'Paused';
      if (!s?.active) {
        voiceAsked = false;
        if (voice && Date.now() - voice.at > 5000) voice = null; // that voice message is over: don't reuse its name
        if (state.active) { state = { active: false }; emit('media', state); }
        return;
      }
      // Some players publish no title: Telegram voice messages and video notes, for example.
      // They were skipped, so the island neither showed nor controlled them. Name them instead.
      const untitled = !s.title;
      if (untitled) {
        const app = processMatchFor(s.app);
        if (!app) {
          if (state.active) { state = { active: false }; emit('media', state); }
          return;
        }
        s.isTg = app.includes('telegram');
        if (s.isTg) {
          const fresh = voice && Date.now() - voice.at < 10 * 60e3 ? voice : null;
          s.title = fresh ? fresh.name : 'Голосовое сообщение';
          s.artist = fresh ? fresh.kind : 'Telegram';
          s.voiceAvatar = fresh?.avatar || null;
          if (!fresh && !voiceAsked) { voiceAsked = true; onVoiceStart(); } // ask Telegram once per voice message
        } else s.title = prettyApp(s.app);
      }
      const key = `${s.app}|${s.artist}|${s.title}`;
      const wasActive = state.active && !state.soundOnly, prevKey = state.key;
      if (key !== trackKey) {
        trackKey = key;
        thumb = null;
        lyrics = null;
        if (untitled && s.isTg) thumb = s.voiceAvatar || TG_LOGO; // the sender's photo, or the Telegram logo
        else try {
          // Covers often arrive a moment after the title; retry once.
          let t = await helper.fast('media', { thumb: true }, 8000);
          if (!t?.thumb) { await new Promise((r) => setTimeout(r, 900)); t = await helper.fast('media', { thumb: true }, 8000); }
          thumb = t?.thumb ? `data:image/png;base64,${t.thumb}` : null;
        } catch {}
        if (untitled) { lyrics = null; emit('lyrics', { key: trackKey, lyrics }); } else fetchLyrics(s); // no lyrics for a voice message
      }
      if (untitled && s.isTg) thumb = s.voiceAvatar || TG_LOGO; // the photo can arrive after the name
      // SMTC position is only refreshed sporadically; extrapolate from its timestamp.
      let position = s.position || 0;
      if (s.status === 'Playing' && s.updated) position += Math.max(0, (Date.now() - s.updated) / 1000);
      if (seekTo) {
        if (key !== seekTo.key || (s.updated && s.updated > seekTo.at + 300)) seekTo = null; // the player caught up
        else position = seekTo.pos + (s.status === 'Playing' ? (Date.now() - seekTo.at) / 1000 : 0);
      }
      if (s.duration) position = Math.min(position, s.duration);
      state = {
        active: true, key, title: s.title, artist: s.artist, album: s.album, status: s.status,
        playing: s.status === 'Playing', position, duration: s.duration, canSeek: s.canSeek,
        app: prettyApp(s.app), appMatch: processMatchFor(s.app), aumid: s.app, thumb, at: Date.now(),
      };
      if (!wasActive || prevKey !== key) log(`media now: ${state.app} "${state.title}" ${state.status}`);
      emit('media', state);
    } catch {
    } finally { busy = false; }
  }

  return {
    setVoice(v) { voice = v; setTimeout(poll, 50); },
    start() { poll(); setInterval(poll, 1000); },
    get: () => state,
    lyrics: () => ({ key: trackKey, lyrics }),
    async command(action, extra = {}) {
      if (action === 'seek' && state.active) {
        seekTo = { key: trackKey, pos: extra.position, at: Date.now() };
        state = { ...state, position: extra.position, at: Date.now() };
        emit('media', state); // move the progress bar at once
      }
      // Telegram's own status lags: whether it really plays is told by its sound in the last 3 s
      const tg = /telegram/i.test(state.appMatch || '');
      const playing = forced && Date.now() < forced.until ? forced.playing : tg ? Date.now() - tgLoudAt < 3000 : !!state.playing;
      const r = await helper.fast('mediaCmd', { action, app: state.aumid || '', playing, ...extra }, 6000).catch((e) => ({ ok: false, error: String(e?.message || e) }));
      log(`media ${action} -> ${JSON.stringify(r)}`); // so a button that "did nothing" can be traced
      if (r?.ok && (r.sent === 'play' || r.sent === 'pause')) {
        forced = { playing: r.sent === 'play', until: Date.now() + 3000 };
        if (r.sent === 'play') tgLoudAt = Date.now(); // count the press as sound until the real sound arrives
        if (state.active) { state = { ...state, playing: forced.playing, status: forced.playing ? 'Playing' : 'Paused' }; emit('media', state); }
      }
      setTimeout(poll, 250);
      return r;
    },
    async appVolume() {
      const list = helper.arr(await helper.fast('sessions'));
      const m = state.appMatch || '';
      if (!m) return null;
      const s = list.find((x) => x.name && (x.name.toLowerCase().includes(m) || m.includes(x.name.toLowerCase())));
      return s ? s.volume : null;
    },
    setAppVolume(level) {
      return helper.fast('setAppVolume', { match: state.appMatch || '', level });
    },
  };
};
