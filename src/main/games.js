// Games: noticed when one is in front (its folder, process name or engine window class), then
// remembered until the process exits. The island shows "playing <game>" with the session time
// instead of a sound-only player, and the character gets into the game.
const { app } = require('electron');

// game libraries (launchers themselves live elsewhere or are excluded below)
const GAME_DIRS = /\\(steamapps\\common|Epic Games\\(?!Launcher)|Riot Games\\|GOG Galaxy\\Games|GOG Games|Ubisoft Game Launcher\\games|EA Games|Electronic Arts\\|Rockstar Games\\|XboxGames\\|Wargaming\.net\\|Lesta\\|Roblox\\Versions|miHoYo|HoYoPlay\\games|Battle\.net\\(?!Battle\.net)|Blizzard Entertainment\\|Games\\)/i;
const LAUNCHERS = /^(steam|steamwebhelper|epicgameslauncher|epicwebhelper|battle\.net|agent|riotclient\w*|riot client|eadesktop|origin|upc|ubisoftconnect|galaxyclient|gogalaxy|rockstarlauncher|socialclubhelper|launcher|robloxstudiobeta|wgc|lgc|crashreport\w*|unitycrashhandler\w*)$/i;
const KNOWN = new Set(['rustclient', 'cs2', 'csgo', 'dota2', 'valorant-win64-shipping', 'league of legends', 'fortniteclient-win64-shipping', 'gta5', 'gta5_enhanced', 'gtaiv', 'rdr2', 'robloxplayerbeta', 'minecraft.windows', 'r5apex', 'r5apex_dx12', 'overwatch', 'eldenring', 'cyberpunk2077', 'witcher3', 'tslgame', 'destiny2', 'rainbowsix', 'rainbowsix_vulkan', 'rocketleague', 'escapefromtarkov', 'hl2', 'hl', 'wow', 'worldoftanks', 'dayz_x64', 'terraria', 'stardew valley', 'bg3', 'bg3_dx11', 'starfield', 'cod', 'deadlock', 'pathofexile', 'pathofexile_x64', 'pathofexilesteam', 'factorio', 'hollow_knight', 'among us', 'genshinimpact', 'starrail', 'zenlesszonezero', 'helldivers2', 'warframe.x64', 'thefinals', 'marvel-win64-shipping', 'osu!', 'teardown', 'sekiro', 'darksoulsiii', 'nms', 'skyrimse', 'fallout4', 'mcc-win64-shipping', 'witcher3']);
const ENGINE_CLASS = /^(UnityWndClass|UnrealWindow|Valve001|SDL_app|GLFW30|CryENGINE|RiotWindowClass|LWJGL|GameMaker|OgreD3D11Wnd|Godot_Engine|grcWindow)$/;
// these window classes are used by some ordinary programs too: only a fullscreen one counts
const WEAK_CLASS = /^(SDL_app|GLFW30|LWJGL)$/;

function looksLikeGame(name) {
  const n = String(name || '').toLowerCase().replace(/\.exe$/, '');
  return !!n && (KNOWN.has(n) || /-win64-shipping$/.test(n));
}

function isGame(fg) {
  const name = String(fg.process || '').toLowerCase();
  if (!name || LAUNCHERS.test(name)) return false;
  if (looksLikeGame(name)) return true;
  if (name === 'javaw' && /minecraft/i.test(fg.title || '')) return true;
  if (ENGINE_CLASS.test(fg.cls || '')) return !WEAK_CLASS.test(fg.cls) || !!fg.fullscreen;
  return GAME_DIRS.test(fg.exe || '') && !!fg.fullscreen; // a library folder holds tools too: fullscreen settles it
}

// "RustClient" -> "Rust", "FortniteClient-Win64-Shipping" -> "Fortnite"
function prettyName(fg) {
  const t = String(fg.title || '').trim();
  if (t && t.length <= 32 && !/[\\/]|\.exe$/i.test(t)) return t;
  const d = String(fg.app || '').trim();
  if (d && d.length <= 32 && !/launcher|unity|unreal|engine|java/i.test(d)) return d;
  return String(fg.process || 'Игра').replace(/-win64-shipping$/i, '').replace(/client$/i, '').replace(/[_-]+/g, ' ').trim() || 'Игра';
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

module.exports = function createGames({ emit, helper, log = () => {} }) {
  let game = null;
  const pub = () => game && { id: String(game.pid), name: game.name, process: game.process, since: game.since, icon: game.icon, front: game.front };
  // the game's own logo: its exe icon at 256 px, else Electron's 32 px one
  async function iconFor(exe) {
    if (!exe) return null;
    try { const r = await helper.slow('exeIcon', { path: exe, size: 256 }, 8000); if (r?.png) return 'data:image/png;base64,' + r.png; } catch {}
    try { return (await app.getFileIcon(exe, { size: 'large' })).toDataURL(); } catch { return null; }
  }
  async function found(w, how) {
    // play time counts from when the game was started, not from when the island noticed it
    game = { pid: w.pid, process: String(w.process).toLowerCase(), name: prettyName(w), hwnd: w.hwnd, since: w.start > 0 ? Math.round(w.start) : Date.now(), icon: null, front: !!w.front };
    log(`game: ${game.name} (${w.process}, ${w.cls}, ${how})`);
    emit('game', pub());
    const g = game, icon = await iconFor(w.exe);
    if (game === g && icon) { g.icon = icon; emit('game', pub()); }
  }
  let scanning = false;
  async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      if (game && !alive(game.pid)) { log(`game over: ${game.name}`); game = null; emit('game', null); }
      if (game) return;
      // a game running behind other windows counts too (you alt-tabbed, or the island restarted mid-game)
      const wins = helper.arr(await helper.fast('appWindows', {}, 5000).catch(() => []));
      const w = wins.find((x) => x.pid !== process.pid && isGame({ ...x, fullscreen: false }));
      if (w) await found(w, 'running');
    } finally { scanning = false; }
  }
  return {
    looksLikeGame,
    // called with every foreground poll: a fullscreen game from a library folder is only recognisable here
    async onForeground(fg, ours) {
      if (!ours && fg.pid && (!game || game.pid !== fg.pid) && isGame(fg)) {
        const ws = helper.arr(await helper.fast('appWindows', {}, 5000).catch(() => []));
        const w = ws.find((x) => x.pid === fg.pid);
        return found({ ...fg, start: w?.start || 0, front: true }, 'front');
      }
      if (game) {
        const front = !ours && fg.pid === game.pid;
        if (front) game.hwnd = fg.hwnd;
        if (front !== game.front) { game.front = front; emit('game', pub()); }
      }
    },
    start() { scan(); setInterval(scan, 4000); },
    get: pub,
    procs: () => (game ? [game.process] : []),
    hwnd: () => game?.hwnd,
  };
};
