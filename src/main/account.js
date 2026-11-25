// The user's account and subscription on this PC.
// The server hands out a licence signed with Ed25519; it is checked here with the public key that
// ships with the app (license-public.pem), so it keeps working offline for a few days and can't be
// edited by hand. Without an active subscription the island stays locked (only the account screen).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SERVER = 'http://127.0.0.1:8787';

module.exports = function createAccount({ emit }) {
  const file = path.join(app.getPath('userData'), 'account.json');
  let data = { server: DEFAULT_SERVER, token: '', license: '', profile: null, device: '' };
  try { data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  if (!data.device) data.device = crypto.randomUUID();
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {} };
  save();

  let pub = null;
  try { pub = crypto.createPublicKey(fs.readFileSync(path.join(__dirname, 'license-public.pem'))); } catch {}

  function decode(lic) {
    if (!pub || !lic) return null;
    const [body, sig] = String(lic).split('.');
    if (!body || !sig) return null;
    try {
      if (!crypto.verify(null, Buffer.from(body), pub, Buffer.from(sig, 'base64url'))) return null;
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch { return null; }
  }
  let offline = false;
  function status() {
    if (!data.token) return { state: 'signedout', server: data.server };
    const p = decode(data.license);
    const now = Date.now();
    const base = { id: data.profile?.id ?? p?.uid ?? null, email: data.profile?.email || p?.email || '', name: data.profile?.name || '', admin: !!data.profile?.admin, server: data.server, offline };
    if (!p || p.dev !== data.device) return { ...base, state: 'check' };       // nothing valid yet: needs the server
    // offline too long: a forever plan (lifetime / admin) keeps working, a monthly one needs the server
    if (p.exp < now && !(p.plan === 'lifetime' || p.plan === 'admin')) return { ...base, state: 'stale' };
    const until = p.until;
    const active = p.active && (p.plan === 'lifetime' || !until || until > now);
    return { ...base, state: active ? 'active' : 'expired', plan: p.plan, until, checked: p.iat };
  }
  const entitled = () => status().state === 'active';
  function publish() { emit('account', status()); }

  async function call(p, body, method) {
    let r;
    try {
      r = await fetch(data.server.replace(/\/+$/, '') + p, {
        method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (data.token || '') },
        body: body ? JSON.stringify({ ...body, device: data.device }) : undefined, signal: AbortSignal.timeout(10000),
      });
    } catch { throw Object.assign(new Error('Сервер подписки недоступен'), { offline: true }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Ошибка сервера'), { status: r.status });
    return j;
  }
  function take(j) {
    if (j.token) data.token = j.token;
    if (j.license) data.license = j.license;
    if (j.profile) data.profile = j.profile;
    offline = false;
    save(); publish();
    return status();
  }

  async function refresh() {
    if (!data.token) { publish(); return status(); }
    try { return take(await call(`/api/me?device=${encodeURIComponent(data.device)}`)); }
    catch (e) {
      // the server doesn't know this sign-in any more: ask to sign in again only once the saved licence has run out,
      // so a server restart or a hiccup never throws you out of an island you already signed in to
      if (e.status === 401 || e.status === 403) { const p = decode(data.license); if (!p || p.dev !== data.device || (p.exp < Date.now() && !(p.plan === 'lifetime' || p.plan === 'admin'))) { data.token = ''; data.license = ''; data.profile = null; save(); } }
      else if (e.offline) offline = true;
      publish();
      return status();
    }
  }
  // check often while locked (a payment in the bot should unlock within a minute), rarely when active
  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(async () => { await refresh(); schedule(); }, entitled() ? 30 * 60e3 : 45e3); }

  return {
    status, entitled,
    start() { publish(); refresh().then(schedule); },
    refresh,
    async register(email, password, name) { const s = take(await call('/api/register', { email, password, name })); schedule(); return s; },
    async login(email, password) { const s = take(await call('/api/login', { email, password })); schedule(); return s; },
    async logout() { try { await call('/api/logout', {}); } catch {} data.token = ''; data.license = ''; data.profile = null; save(); publish(); return status(); },
    async activate(key) { const s = take(await call('/api/activate', { key })); schedule(); return s; },
    async setName(name) { return take(await call('/api/profile', { name })); },
    async buyLink() { return call('/api/buy'); },
    async adminToken() { return (await call('/api/admin/session', {})).token; },
    server: () => data.server.replace(/\/+$/, ''),
    setServer(url) { data.server = String(url || '').trim() || DEFAULT_SERVER; save(); publish(); return status(); },
  };
};
