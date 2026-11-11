// Local bridge for terminal agents (Claude Code hooks, Codex notify).
// The hook script posts every event here; permission prompts and questions
// are held open until the user answers on the island (or falls back to terminal).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

module.exports = function createAgents({ settings, dataDir, emit }) {
  const sessions = new Map(); // id -> session
  const asks = new Map();     // askId -> { resolve, session, kind, data }
  let server = null;

  function cfgFile() { return path.join(dataDir, 'agent.json'); }

  function ensureToken() {
    const a = settings.data.agents;
    if (!a.token) { a.token = crypto.randomBytes(16).toString('hex'); settings.save(); }
    fs.writeFileSync(cfgFile(), JSON.stringify({ port: a.port, token: a.token }));
  }

  function publish() {
    const list = [...sessions.values()].sort((a, b) => b.updated - a.updated).slice(0, 8);
    emit('agents', { sessions: list, asks: [...asks.values()].map(({ resolve, ...rest }) => rest) });
  }

  function touch(id, patch) {
    const s = sessions.get(id) || { id, started: Date.now() };
    Object.assign(s, patch, { updated: Date.now() });
    sessions.set(id, s);
    return s;
  }

  function describeTool(name, input = {}) {
    if (name === 'Bash') return input.command || '';
    if (/Edit|Write|Read|NotebookEdit/.test(name)) return input.file_path || input.notebook_path || '';
    if (name === 'WebFetch') return input.url || '';
    if (name === 'Grep' || name === 'Glob') return input.pattern || '';
    if (name === 'Task' || name === 'Agent') return input.description || '';
    try { return JSON.stringify(input).slice(0, 160); } catch { return ''; }
  }

  function hold(kind, s, data, toResponse) {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => finish(null), 9 * 60e3);
      function finish(answer) {
        clearTimeout(timer);
        asks.delete(id);
        touch(s.id, { state: 'working' });
        publish();
        resolve(answer == null ? {} : toResponse(answer));
      }
      asks.set(id, { id, kind, session: s.id, project: s.project, source: s.source, data, resolve: finish, at: Date.now() });
      touch(s.id, { state: 'waiting', waitingFor: kind });
      publish();
      emit('agent-attention', { id, kind, project: s.project, source: s.source, data });
    });
  }

  async function onClaude(ev) {
    const id = ev.session_id || 'claude';
    const project = ev.cwd ? path.basename(ev.cwd) : 'Claude Code';
    const base = { source: 'claude', project, cwd: ev.cwd };
    switch (ev.hook_event_name) {
      case 'SessionStart': touch(id, { ...base, state: 'idle', note: 'Сессия открыта' }); break;
      case 'UserPromptSubmit': touch(id, { ...base, state: 'working', note: (ev.prompt || '').slice(0, 120), tool: null }); emit('agent-working', { project }); break;
      case 'PreToolUse': {
        const s = touch(id, { ...base, state: 'working', tool: ev.tool_name, note: describeTool(ev.tool_name, ev.tool_input).slice(0, 160) });
        if (ev.tool_name === 'AskUserQuestion' && ev.tool_input?.questions?.length) {
          publish();
          // Experimental: answer the question from the island by filling `answers`.
          return hold('question', s, { questions: ev.tool_input.questions }, (answers) => ({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              updatedInput: { ...ev.tool_input, answers },
            },
          }));
        }
        break;
      }
      case 'PermissionRequest': {
        const s = touch(id, { ...base, tool: ev.tool_name });
        return hold('permission', s, { tool: ev.tool_name, detail: describeTool(ev.tool_name, ev.tool_input).slice(0, 400) }, (a) => ({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: a.allow ? { behavior: 'allow' } : { behavior: 'deny', message: a.message || 'Отклонено с острова' },
          },
        }));
      }
      case 'Notification': {
        const s = touch(id, { ...base, state: 'waiting', note: ev.message || 'Нужен ответ' });
        emit('agent-attention', { kind: 'notice', project, source: 'claude', data: { message: ev.message } });
        void s;
        break;
      }
      case 'Stop': case 'SubagentStop':
        if (ev.hook_event_name === 'Stop') { touch(id, { ...base, state: 'done', tool: null, note: 'Готово' }); emit('agent-done', { project, source: 'claude' }); }
        break;
      case 'SessionEnd': sessions.delete(id); break;
      default: touch(id, base);
    }
    publish();
    return {};
  }

  function onCodex(ev) {
    const id = 'codex:' + (ev['thread-id'] || ev.cwd || 'codex');
    const project = ev.cwd ? path.basename(ev.cwd) : 'Codex';
    if (ev.type === 'agent-turn-complete') {
      touch(id, { source: 'codex', project, state: 'done', note: (ev['last-assistant-message'] || 'Готово').slice(0, 200) });
      emit('agent-done', { project, source: 'codex' });
    } else touch(id, { source: 'codex', project, state: 'working', note: ev.type || '' });
    publish();
    return {};
  }

  function handle(req, res) {
    if (req.method !== 'POST' || req.headers['x-island-token'] !== settings.data.agents.token) {
      res.writeHead(403).end();
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', async () => {
      let ev = {};
      try { ev = JSON.parse(body || '{}'); } catch {}
      let out = {};
      try { out = req.url.startsWith('/codex') ? onCodex(ev) : await onClaude(ev); } catch (e) { console.warn('agent', e); }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out || {}));
    });
  }

  const hookPath = path.join(__dirname, '..', '..', 'hooks', 'claude-hook.js');
  const codexPath = path.join(__dirname, '..', '..', 'hooks', 'codex-notify.js');

  return {
    start() {
      ensureToken();
      server = http.createServer(handle);
      server.on('error', (e) => console.warn('agents server', e.message));
      server.listen(settings.data.agents.port, '127.0.0.1');
    },
    answer(askId, answer) { asks.get(askId)?.resolve(answer); },
    dismiss(id) { sessions.delete(id); publish(); },
    list: () => publish(),

    // Adds island hooks to ~/.claude/settings.json (with a backup). User-triggered.
    installClaude() {
      const file = path.join(os.homedir(), '.claude', 'settings.json');
      let cfg = {};
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        fs.writeFileSync(file + `.island-backup-${Date.now()}`, raw);
        cfg = JSON.parse(raw || '{}');
      }
      const cmd = `node "${hookPath.replace(/\\/g, '/')}"`;
      cfg.hooks = cfg.hooks || {};
      const events = {
        SessionStart: { timeout: 10 }, UserPromptSubmit: { timeout: 10 }, PreToolUse: { matcher: '*', timeout: 600 },
        PermissionRequest: { matcher: '*', timeout: 600 }, Notification: { timeout: 10 }, Stop: { timeout: 10 }, SessionEnd: { timeout: 10 },
      };
      for (const [ev, o] of Object.entries(events)) {
        const list = (cfg.hooks[ev] || []).filter((g) => !(g.hooks || []).some((h) => String(h.command || '').includes('claude-hook.js')));
        const group = { hooks: [{ type: 'command', command: cmd, timeout: o.timeout }] };
        if (o.matcher) group.matcher = o.matcher;
        list.push(group);
        cfg.hooks[ev] = list;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
      return file;
    },
    uninstallClaude() {
      const file = path.join(os.homedir(), '.claude', 'settings.json');
      if (!fs.existsSync(file)) return;
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const ev of Object.keys(cfg.hooks || {})) {
        cfg.hooks[ev] = cfg.hooks[ev].filter((g) => !(g.hooks || []).some((h) => String(h.command || '').includes('claude-hook.js')));
        if (!cfg.hooks[ev].length) delete cfg.hooks[ev];
      }
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    },
    // Codex: top-level `notify` must come before any [table] in config.toml.
    installCodex() {
      const file = path.join(os.homedir(), '.codex', 'config.toml');
      let raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (raw) fs.writeFileSync(file + `.island-backup-${Date.now()}`, raw);
      if (/^\s*notify\s*=/m.test(raw)) return { file, skipped: 'В config.toml уже есть notify — добавь codex-notify.js вручную' };
      const line = `notify = ["node", "${codexPath.replace(/\\/g, '/')}"]\n`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, line + raw);
      return { file };
    },
    status() {
      const f = path.join(os.homedir(), '.claude', 'settings.json');
      const c = path.join(os.homedir(), '.codex', 'config.toml');
      const has = (p, s) => { try { return fs.readFileSync(p, 'utf8').includes(s); } catch { return false; } };
      return { claude: has(f, 'claude-hook.js'), codex: has(c, 'codex-notify.js') };
    },
  };
};
