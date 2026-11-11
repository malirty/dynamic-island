// Standalone settings window: sections on the left, live preview on the right.
import { api, state, bus, h } from './core.js';
import { mountSettings } from './tabs/settings.js';

const root = document.documentElement;
function theme(s) {
  const t = s.theme;
  root.dataset.mode = t.mode;
  ['--c1', '--c2', '--c3'].forEach((k, i) => root.style.setProperty(k, t.colors[i]));
  root.style.setProperty('--glow', t.colors[0]);
  root.style.setProperty('--glowK', t.glow);
  const op = { liquid: [0.35, 0, 0], gradient: [0.12, 0.5, 0], glass: [0.25, 0, 1], solid: [0, 0, 0] }[t.style] || [0.35, 0, 0];
  root.style.setProperty('--liquidOp', op[0]); root.style.setProperty('--flowOp', op[1]); root.style.setProperty('--glassOp', op[2]);
}

const toastEl = document.getElementById('wtoast');
let toastT;
function flash(t) {
  toastEl.innerHTML = '';
  toastEl.append(h('span', {}, t.icon || '•'), h('span', {}, t.title || ''));
  toastEl.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('on'), t.ms || 2000);
}

const init = await api.invoke('init');
Object.assign(state, { settings: init.settings, providers: init.providers, agentsInstalled: init.agentsInstalled, telegram: init.telegram, weather: init.weather });
theme(state.settings);
// our own saves update `state.settings` in place; changes from the island arrive here
api.on('settings', (s) => { for (const k of Object.keys(s)) state.settings[k] = s[k]; theme(state.settings); bus.emit('settings', state.settings); bus.emit('settings-external'); });
bus.on('settings', () => theme(state.settings));
api.on('weather', (w) => { state.weather = w; });
api.on('telegram-ask', (q) => bus.emit('telegram-ask', q));
api.on('telegram-status', (s) => bus.emit('telegram-status', s));

document.getElementById('close').onclick = () => api.invoke('win:close');
document.getElementById('min').onclick = () => api.invoke('win:minimize');
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.target.closest('input, textarea')) api.invoke('win:close'); });

const section = new URLSearchParams(location.search).get('section');
const ui = mountSettings(document.getElementById('settings'), { flash, rebuild() {}, openTab() {}, collapse() {}, resize() {} }, section);
api.on('settings-section', (id) => ui.open(id));
