#!/usr/bin/env node
// Claude Code hook -> Island. Reads the hook JSON from stdin, forwards it to the
// island and prints the island's decision (if any). If the island is not
// running, exits silently so Claude Code behaves exactly as without the hook.
const fs = require('fs');
const path = require('path');
const http = require('http');

const cfgPath = path.join(process.env.APPDATA || '', 'Island', 'agent.json');
let cfg;
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { process.exit(0); }

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let ev = {};
  try { ev = JSON.parse(input || '{}'); } catch {}
  const blocking = ev.hook_event_name === 'PermissionRequest' || (ev.hook_event_name === 'PreToolUse' && ev.tool_name === 'AskUserQuestion');
  const req = http.request({
    host: '127.0.0.1', port: cfg.port, path: '/claude', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-island-token': cfg.token },
    timeout: blocking ? 590000 : 1500,
  }, (res) => {
    let out = '';
    res.setEncoding('utf8');
    res.on('data', (c) => (out += c));
    res.on('end', () => {
      try {
        const j = JSON.parse(out || '{}');
        if (j && Object.keys(j).length) process.stdout.write(JSON.stringify(j));
      } catch {}
      process.exit(0);
    });
  });
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.end(input);
});
