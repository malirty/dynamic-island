// Bridge to the PowerShell/C# helper (helper.ps1). One process per lane so slow
// calls (OCR, file search) never stall fast polling (foreground window, media).
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

class Helper {
  constructor(name) {
    this.name = name;
    this.seq = 0;
    this.pending = new Map();
    this.ready = null;
    this.proc = null;
    this.dead = false;
    this.start();
  }

  start() {
    const script = path.join(__dirname, 'helper.ps1');
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let resolveReady;
    this.ready = new Promise((r) => (resolveReady = r));
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.ready) return resolveReady(true);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error || 'helper error'));
    });
    this.proc.stderr.on('data', (d) => {
      const s = d.toString().trim();
      if (s) console.warn(`[helper:${this.name}]`, s.slice(0, 400));
    });
    this.proc.on('exit', () => {
      for (const p of this.pending.values()) p.reject(new Error('helper exited'));
      this.pending.clear();
      if (!this.dead) setTimeout(() => this.start(), 1500);
    });
  }

  async call(cmd, args = {}, timeoutMs = 15000) {
    await this.ready;
    const id = ++this.seq;
    // ASCII-only payload: PowerShell 5.1 stdin decoding is not reliably UTF-8.
    const line = JSON.stringify({ id, cmd, args }).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`helper timeout: ${cmd}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(line + '\n');
    });
  }

  stop() {
    this.dead = true;
    try { this.proc.kill(); } catch {}
  }
}

// PowerShell unrolls one-element arrays and turns empty arrays into null.
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

let fast, slow;
module.exports = {
  init() {
    fast = new Helper('fast');
    slow = new Helper('slow');
  },
  fast: (cmd, args, t) => fast.call(cmd, args, t),
  slow: (cmd, args, t) => slow.call(cmd, args, t ?? 60000),
  arr,
  stop() { fast?.stop(); slow?.stop(); },
};
