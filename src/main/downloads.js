// Watches the Downloads folder for in-progress browser downloads
// (.crdownload / .part / .opdownload / .download) and finished files.
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEMP = /\.(crdownload|part|opdownload|download|partial)$/i;

module.exports = function createDownloads({ getDir, emit }) {
  let active = new Map(); // tempName -> { name, size, speed, started, lastSize, lastT }
  let timer = null;
  let dir = null;

  function finalName(tempName) {
    return tempName.replace(TEMP, '');
  }

  function scan() {
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    const now = Date.now();
    const seen = new Set();
    for (const n of names) {
      if (!TEMP.test(n)) continue;
      seen.add(n);
      let st;
      try { st = fs.statSync(path.join(dir, n)); } catch { continue; }
      const prev = active.get(n);
      if (!prev) {
        active.set(n, { name: finalName(n), size: st.size, speed: 0, started: now, lastSize: st.size, lastT: now });
      } else {
        const dt = (now - prev.lastT) / 1000;
        const inst = dt > 0 ? (st.size - prev.lastSize) / dt : 0;
        prev.speed = prev.speed ? prev.speed * 0.6 + inst * 0.4 : inst;
        prev.size = st.size; prev.lastSize = st.size; prev.lastT = now;
      }
    }
    for (const [n, info] of active) {
      if (seen.has(n)) continue;
      active.delete(n);
      // Find the finished file: same name without temp suffix, or the newest fresh file.
      let done = null;
      const direct = path.join(dir, info.name);
      if (!/^Unconfirmed \d+/i.test(info.name) && fs.existsSync(direct)) done = direct;
      if (!done) {
        let best = null;
        for (const m of names) {
          if (TEMP.test(m)) continue;
          try {
            const st = fs.statSync(path.join(dir, m));
            if (now - st.mtimeMs < 8000 && (!best || st.mtimeMs > best.t)) best = { p: path.join(dir, m), t: st.mtimeMs };
          } catch {}
        }
        done = best?.p;
      }
      if (done) {
        let size = 0; try { size = fs.statSync(done).size; } catch {}
        emit('download-done', { name: path.basename(done), path: done, size });
      }
    }
    emit('downloads', [...active.values()].map(({ name, size, speed, started }) => ({ name, size, speed, started })));
  }

  return {
    start() {
      dir = getDir() || path.join(os.homedir(), 'Downloads');
      clearInterval(timer);
      timer = setInterval(scan, 1000);
      try { fs.watch(dir, () => scan()); } catch {}
    },
    restart() { this.start(); },
  };
};
