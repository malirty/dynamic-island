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
  const names = { spotify: 'Spotify', chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', yandexmusic: 'Яндекс Музыка', 'microsoft.media.player': 'Медиаплеер', telegram: 'Telegram', vk: 'VK', browser: 'Яндекс Браузер' };
  return names[m] || (m ? m[0].toUpperCase() + m.slice(1) : '');
}

module.exports = function createMedia({ emit }) {
  let state = { active: false };
  let trackKey = '';
  let thumb = null;
  let lyrics = null;
  let busy = false;

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

  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const s = await helper.fast('media', { thumb: false }, 5000);
      if (!s?.active || !s.title) {
        if (state.active) { state = { active: false }; emit('media', state); }
        return;
      }
      const key = `${s.app}|${s.artist}|${s.title}`;
      if (key !== trackKey) {
        trackKey = key;
        thumb = null;
        lyrics = null;
        try {
          // Covers often arrive a moment after the title; retry once.
          let t = await helper.fast('media', { thumb: true }, 8000);
          if (!t?.thumb) { await new Promise((r) => setTimeout(r, 900)); t = await helper.fast('media', { thumb: true }, 8000); }
          thumb = t?.thumb ? `data:image/png;base64,${t.thumb}` : null;
        } catch {}
        fetchLyrics(s);
      }
      // SMTC position is only refreshed sporadically; extrapolate from its timestamp.
      let position = s.position || 0;
      if (s.status === 'Playing' && s.updated) position += Math.max(0, (Date.now() - s.updated) / 1000);
      if (s.duration) position = Math.min(position, s.duration);
      state = {
        active: true, key, title: s.title, artist: s.artist, album: s.album, status: s.status,
        playing: s.status === 'Playing', position, duration: s.duration, canSeek: s.canSeek,
        app: prettyApp(s.app), appMatch: processMatchFor(s.app), thumb, at: Date.now(),
      };
      emit('media', state);
    } catch {
    } finally { busy = false; }
  }

  return {
    start() { poll(); setInterval(poll, 1000); },
    get: () => state,
    lyrics: () => ({ key: trackKey, lyrics }),
    async command(action, extra = {}) {
      const r = await helper.fast('mediaCmd', { action, ...extra });
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
