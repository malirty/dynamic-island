import { api, state, bus } from './core.js';
import { createChat } from './tabs/ai.js';
const root = document.documentElement;
function theme(s) {
  const t = s.theme;
  root.dataset.mode = t.mode;
  ['--c1', '--c2', '--c3'].forEach((k, i) => root.style.setProperty(k, t.colors[i]));
  root.style.setProperty('--glow', t.colors[0]);
  const op = { liquid: [0.4, 0, 0], gradient: [0.15, 0.6, 0], glass: [0.3, 0, 1], solid: [0, 0, 0] }[t.style] || [0.4, 0, 0];
  root.style.setProperty('--liquidOp', op[0]); root.style.setProperty('--flowOp', op[1]); root.style.setProperty('--glassOp', op[2]);
}
const init = await api.invoke('init');
Object.assign(state, { settings: init.settings, providers: init.providers });
theme(state.settings);
api.on('settings', (s) => { state.settings = s; theme(s); bus.emit('settings', s); });
document.getElementById('close').onclick = () => api.invoke('win:close');
document.getElementById('min').onclick = () => api.invoke('win:minimize');
const chat = createChat(document.getElementById('chat'), { collapse() {}, flash() {}, resize() {} }, { standalone: true });
chat.focus();
