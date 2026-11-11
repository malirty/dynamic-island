// System audio (loopback) analyser: drives the dancing edge, bars and buddies.
import { state, bus } from './core.js';

const root = document.documentElement;
let ctx = null, analyser = null, data = null, stream = null;
let mode = 'off'; // off | live | fake
let raf = 0;
let bands = new Float32Array(24);
let level = 0, bass = 0, bassAvg = 0, lastBeat = 0, beatDir = 1, peakL = 0.1, peakB = 0.1;
let prevBands = new Float32Array(24), fluxAvg = 0, lastTick = 0;
const hits = { beat: 0, tick: 0 };
window.__hits = hits; // dev aid: hit counters
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
  // normalize to the track's own recent peaks so loud and quiet songs both
  // "breathe": quiet parts dim, hits flare (instead of sitting at the maximum)
  peakL = Math.max(l, peakL * 0.996, 0.04);
  peakB = Math.max(b, peakB * 0.996, 0.04);
  const nl = Math.pow(Math.min(1, l / peakL), 3);
  const nb = Math.pow(Math.min(1, b / peakB), 2.2);
  level = level * 0.6 + (nl * 0.35 + nb * 0.65) * 0.4; // glow follows the beat more than overall loudness
  bass = bass * 0.5 + nb * 0.5;
  bassAvg = bassAvg * 0.95 + bass * 0.05;
  // spectral flux: how much the sound just "jumped" (snares, hats, vocals, synth stabs)
  let flux = 0;
  for (let i = 0; i < bands.length; i++) { flux += Math.max(0, bands[i] - prevBands[i]); prevBands[i] = bands[i]; }
  fluxAvg = fluxAvg * 0.93 + flux * 0.07;
  // big hits: kick drum / bass
  const sens = { low: [1.25, 0.32], normal: [1.12, 0.22], high: [1.05, 0.14] }[state.settings?.theme?.beatSens || 'normal'] || [1.12, 0.22];
  if (bass > bassAvg * sens[0] && bass > sens[1] && t - lastBeat > 170) {
    lastBeat = t; lastTick = t; beatDir = -beatDir;
    bus.emit('beat', bass); hits.beat++;
  } else if (flux > fluxAvg * 1.55 && flux > 0.08 && t - lastTick > 120 && t - lastBeat > 90) {
    // small hits in between: a lighter wiggle
    lastTick = t;
    bus.emit('tick', Math.min(1, flux / (fluxAvg * 3 + 0.01))); hits.tick++;
  }
}

function loop(t) {
  raf = requestAnimationFrame(loop);
  const playing = state.media?.playing;
  if (playing) sample(t);
  else { level *= 0.9; bass *= 0.85; for (let i = 0; i < bands.length; i++) bands[i] *= 0.88; }
  const dance = state.settings?.theme?.edgeDance !== false;
  state.level = dance ? level : 0;
  // only the dancing eyes/buddies use these; setting them on :root would
  // restyle the whole island every frame
  const b = bass.toFixed(3);
  for (const el of document.querySelectorAll('.eyes, .buddy')) { el.style.setProperty('--bass', b); el.style.setProperty('--beatDir', beatDir); }
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
// dev aid for --debug-shots
window.__audio = () => ({ mode, level, bass, raf: !!raf, tracks: stream?.getAudioTracks().map((t) => t.readyState + ':' + t.label), ctx: ctx?.state, playing: state.media?.playing });
