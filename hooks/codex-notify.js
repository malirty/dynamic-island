#!/usr/bin/env node
// Codex `notify` program -> Island. Codex passes the event JSON as the last argument.
const fs = require('fs');
const path = require('path');
const http = require('http');

let cfg;
try { cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'Island', 'agent.json'), 'utf8')); } catch { process.exit(0); }
let ev = {};
try { ev = JSON.parse(process.argv[process.argv.length - 1]); } catch {}
ev.cwd = ev.cwd || process.cwd();
const req = http.request({
  host: '127.0.0.1', port: cfg.port, path: '/codex', method: 'POST', timeout: 1500,
  headers: { 'Content-Type': 'application/json', 'x-island-token': cfg.token },
}, (res) => { res.resume(); res.on('end', () => process.exit(0)); });
req.on('error', () => process.exit(0));
req.on('timeout', () => { req.destroy(); process.exit(0); });
req.end(JSON.stringify(ev));
