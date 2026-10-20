// Tiny Web Audio synth: plucks, an evolving pad, a convolution reverb built
// from generated noise, a feedback delay, and an analyser for the visuals.

let ctx, master, bus, reverb, delay, analyser, data, pad;
let muted = false;

export function ready() { return !!ctx; }

export function init() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = muted ? 0 : .9;
  const comp = ctx.createDynamicsCompressor();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = .82;
  data = new Uint8Array(analyser.frequencyBinCount);
  master.connect(comp).connect(analyser).connect(ctx.destination);

  // reverb: exponentially decaying stereo noise
  reverb = ctx.createConvolver();
  const len = ctx.sampleRate * 3.5;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
  }
  reverb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = .55;
  reverb.connect(wet).connect(master);

  delay = ctx.createDelay(1);
  delay.delayTime.value = .375;
  const fb = ctx.createGain();
  fb.gain.value = .35;
  const dl = ctx.createBiquadFilter();
  dl.type = 'lowpass';
  dl.frequency.value = 2400;
  delay.connect(dl).connect(fb).connect(delay);
  const dwet = ctx.createGain();
  dwet.gain.value = .3;
  dl.connect(dwet).connect(master);

  bus = ctx.createGain();
  bus.connect(master);
  bus.connect(reverb);
  bus.connect(delay);
}

export function resume() { ctx?.state === 'suspended' && ctx.resume(); }

export function setMuted(m) {
  muted = m;
  if (ctx) master.gain.setTargetAtTime(m ? 0 : .9, ctx.currentTime, .08);
}

export function pluck(freq, bright = .5, vel = .5, pan = 0) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
  o1.type = 'triangle'; o1.frequency.value = freq;
  o2.type = 'sine'; o2.frequency.value = freq * 2.005;
  const g2 = ctx.createGain(); g2.gain.value = .35;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.Q.value = 5;
  f.frequency.setValueAtTime(500 + bright * 6000, t);
  f.frequency.exponentialRampToValueAtTime(260, t + 1.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * .32, t + .006);
  g.gain.exponentialRampToValueAtTime(.0001, t + 2);
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  o1.connect(f); o2.connect(g2).connect(f);
  f.connect(g).connect(p).connect(bus);
  o1.start(t); o2.start(t);
  o1.stop(t + 2.1); o2.stop(t + 2.1);
}

// A low, breathing chord while the instrument is on screen.
export function startPad() {
  if (!ctx || pad) return;
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(.06, t + 3);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 2;
  const lfo = ctx.createOscillator(), lg = ctx.createGain();
  lfo.frequency.value = .07; lg.gain.value = 450;
  lfo.connect(lg).connect(f.frequency);
  const oscs = [55, 82.41, 110.0, 130.81].flatMap((hz) => [-6, 6].map((cents) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = cents;
    o.connect(f);
    o.start(t);
    return o;
  }));
  lfo.start(t);
  f.connect(out).connect(bus);
  pad = { out, oscs: [...oscs, lfo] };
}

export function stopPad() {
  if (!pad) return;
  const { out, oscs } = pad, t = ctx.currentTime;
  out.gain.cancelScheduledValues(t);
  out.gain.setTargetAtTime(0, t, .6);
  oscs.forEach((o) => o.stop(t + 3));
  pad = null;
}

// The eye wakes up: a deep swelling breath.
export function awaken() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(38, t);
  o.frequency.exponentialRampToValueAtTime(76, t + 2.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(.45, t + 1.2);
  g.gain.exponentialRampToValueAtTime(.0001, t + 4);
  o.connect(g).connect(bus);
  o.start(t); o.stop(t + 4.1);
  [0, .35, .7].forEach((dt, i) => setTimeout(() => pluck([440, 523.25, 659.25][i], .7, .35, i - 1), 900 + dt * 1000));
}

export function blip() { pluck(1760, .9, .08, (Math.random() - .5)); }

export function spectrum() {
  if (!analyser) return null;
  analyser.getByteFrequencyData(data);
  return data;
}

export function level() {
  const d = spectrum();
  if (!d) return 0;
  let s = 0;
  for (let i = 0; i < 64; i++) s += d[i];
  return s / (64 * 255);
}
