// Island sounds: small synthesized effects (no audio files needed) or your own file,
// chosen per event in Settings → Звуки.
import { state } from './core.js';

export const SOUND_EVENTS = [
  ['timer', 'Таймер закончился', 'alarm'],
  ['reminder', 'Напоминание', 'bell'],
  ['notify', 'Уведомление', 'pop'],
  ['agentDone', 'Агент закончил работу', 'chime'],
  ['agentAsk', 'Агент ждёт ответа', 'ding'],
  ['call', 'Начался звонок', 'marimba'],
  ['capture', 'Скриншот и копирование с экрана', 'shutter'],
  ['error', 'Ошибка', 'soft'],
  ['open', 'Открытие острова', 'none'],
  ['clip', 'Что-то скопировано', 'none'],
];
export const SOUNDS = [
  ['none', 'Без звука'], ['pop', 'Пузырёк'], ['chime', 'Колокольчики'], ['bell', 'Колокол'], ['ding', 'Дзынь'],
  ['marimba', 'Маримба'], ['glass', 'Стекло'], ['bubble', 'Бульк'], ['shutter', 'Затвор'], ['soft', 'Мягкий вниз'],
  ['alarm', 'Будильник'], ['custom', 'Свой файл…'],
];

let ctx = null, out = null;
function audio() {
  if (!ctx) { ctx = new AudioContext(); out = ctx.createGain(); out.connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// one note: frequency (optionally gliding), shape, attack/decay envelope
function tone(t, f, dur, { type = 'sine', gain = 0.3, to = null, attack = 0.005 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, freq, gain) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8; g.gain.value = gain;
  s.connect(f); f.connect(g); g.connect(out);
  s.start(t);
}
const SYNTH = {
  pop: (t) => tone(t, 700, 0.14, { to: 1300, gain: 0.35 }),
  chime: (t) => { tone(t, 1046.5, 0.9, { gain: 0.22 }); tone(t + 0.12, 1568, 1.1, { gain: 0.2 }); tone(t + 0.12, 3136, 0.5, { gain: 0.04 }); },
  bell: (t) => { tone(t, 880, 1.4, { gain: 0.25 }); tone(t, 2428, 0.8, { gain: 0.06 }); tone(t, 1760, 1, { gain: 0.08 }); },
  ding: (t) => { tone(t, 1318.5, 0.7, { gain: 0.26 }); tone(t, 2637, 0.3, { gain: 0.05 }); },
  marimba: (t) => [659.3, 784, 1046.5].forEach((f, i) => tone(t + i * 0.09, f, 0.35, { type: 'triangle', gain: 0.25 })),
  glass: (t) => { tone(t, 2093, 0.5, { gain: 0.16 }); tone(t, 4186, 0.25, { gain: 0.05 }); },
  bubble: (t) => tone(t, 380, 0.18, { to: 950, gain: 0.32 }),
  shutter: (t) => { noise(t, 0.05, 3200, 0.5); noise(t + 0.07, 0.06, 1800, 0.4); },
  soft: (t) => { tone(t, 523.3, 0.25, { type: 'triangle', gain: 0.22 }); tone(t + 0.15, 392, 0.4, { type: 'triangle', gain: 0.22 }); },
  alarm: (t) => { for (let k = 0; k < 3; k++) for (let i = 0; i < 4; i++) tone(t + k * 0.9 + i * 0.13, 1760, 0.09, { gain: 0.18 }); },
};

const cfg = () => state.settings?.sounds || {};
// play the sound picked for an event; `preview` plays it even when sounds are off
export function play(event, { preview = false, sound = null } = {}) {
  const s = cfg();
  if (!preview && s.enabled === false) return;
  const def = SOUND_EVENTS.find((e) => e[0] === event)?.[2] || 'none';
  const name = sound || s.events?.[event] || def;
  if (name === 'none') return;
  if (!preview && s.quietInDnd !== false && state.settings?.dnd && event !== 'timer' && event !== 'reminder') return;
  const vol = s.volume ?? 0.6;
  if (name === 'custom') {
    const file = s.custom?.[event];
    if (!file) return;
    const a = new Audio('file:///' + file.replace(/\\/g, '/'));
    a.volume = Math.max(0, Math.min(1, vol));
    a.play().catch(() => {});
    return;
  }
  const f = SYNTH[name];
  if (!f) return;
  const c = audio();
  out.gain.value = vol;
  f(c.currentTime + 0.02);
}
