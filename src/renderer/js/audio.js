// System audio (loopback) analyser: drives the dancing edge, bars and buddies.
import { state, bus } from './core.js';

const root = document.documentElement;
let ctx = null, analyser = null, data = null, stream = null;
let mode = 'off'; // off | live | fake
let raf = 0;
let bands = new Float32Array(24);
let level = 0, bass = 0, bassAvg = 0, lastBeat = 0, beatDir = 1;
let stopTimer = null;

async function startLive() {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 16, height: 16, frameRate: 1 } });
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!stream.getAudioTracks().length) throw new Error('no audio');
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    src.connect(analyser);
    data = new Uint8Array(analyser.frequencyBinCount);
    mode = 'live';
  } catch (e) {
    console.warn('loopback audio unavailable, using simulated levels', e?.message);
    mode = 'fake';
  }
}

function stopLive() {
  try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
  try { ctx?.close(); } catch {}
  stream = ctx = analyser = data = null;
}

function sample(t) {
  if (mode === 'live' && analyser) {
    analyser.getByteFrequencyData(data);
    const n = data.length;
    // log-spaced bands from ~40 Hz to ~12 kHz
    for (let i = 0; i < bands.length; i++) {
      const a = Math.floor(Math.pow(n * 0.5, i / bands.length)) + 1;
      const b = Math.max(a + 1, Math.floor(Math.pow(n * 0.5, (i + 1) / bands.length)) + 1);
      let s = 0;
      for (let k = a; k < b && k < n; k++) s += data[k];
      const v = s / (b - a) / 255;
      bands[i] = bands[i] * 0.4 + v * 0.6;
    }
  } else {
    // simulated groove so the island still breathes when capture is not possible
    const beat = Math.pow(Math.max(0, Math.sin(t / 1000 * Math.PI * 2 * 1.9)), 8);
    for (let i = 0; i < bands.length; i++) {
      const v = 0.25 + 0.35 * Math.sin(t / (300 + i * 37) + i) * Math.sin(t / 900 + i * 0.5) + (i < 5 ? beat * 0.6 : beat * 0.15);
      bands[i] = bands[i] * 0.6 + Math.max(0, v) * 0.4;
    }
  }
  let sum = 0;
  for (let i = 0; i < bands.length; i++) sum += bands[i];
  const l = sum / bands.length;
  const b = (bands[0] + bands[1] + bands[2] + bands[3]) / 4;
  level = level * 0.6 + Math.min(1, l * 2.2) * 0.4;
  bass = bass * 0.5 + Math.min(1, b * 1.4) * 0.5;
  bassAvg = bassAvg * 0.97 + bass * 0.03;
  if (bass > bassAvg * 1.3 && bass > 0.35 && t - lastBeat > 260) {
    lastBeat = t; beatDir = -beatDir;
    bus.emit('beat', bass);
  }
}

function loop(t) {
  raf = requestAnimationFrame(loop);
  const playing = state.media?.playing;
  if (playing) sample(t);
  else { level *= 0.9; bass *= 0.85; for (let i = 0; i < bands.length; i++) bands[i] *= 0.88; }
  const dance = state.settings?.theme?.edgeDance !== false;
  state.level = dance ? level : 0;
  root.style.setProperty('--level', (dance ? level : 0).toFixed(3));
  root.style.setProperty('--bass', bass.toFixed(3));
  root.style.setProperty('--beatDir', beatDir);
  bus.emit('audio', { level, bass, bands });
  if (!playing && level < 0.005 && mode === 'off') { cancelAnimationFrame(raf); raf = 0; }
}

export function audioActive(playing) {
  clearTimeout(stopTimer);
  if (playing) {
    if (mode === 'off') { mode = 'starting'; startLive(); }
    if (!raf) raf = requestAnimationFrame(loop);
  } else {
    // keep capture alive briefly between tracks
    stopTimer = setTimeout(() => { if (!state.media?.playing && mode !== 'off') { stopLive(); mode = 'off'; } }, 15000);
    if (!raf) raf = requestAnimationFrame(loop);
  }
}
export const getBands = () => bands;
