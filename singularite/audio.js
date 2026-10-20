// Sound of the hole: a brown-noise rumble and a sub that deepen as you fall,
// the ticking of a distant clock sped up by time dilation, the chirp of two
// holes spiralling together and the ringdown after they merge.

let ctx, master, rumble, rumbleF, sub, subG, chirp, chirpG;
let muted = false;

export function init() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : .9;
  master.connect(comp).connect(ctx.destination);

  // brown noise, 4 s loop
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  rumbleF = ctx.createBiquadFilter();
  rumbleF.type = 'lowpass'; rumbleF.frequency.value = 120; rumbleF.Q.value = 3;
  rumble = ctx.createGain(); rumble.gain.value = 0;
  src.connect(rumbleF).connect(rumble).connect(master);
  src.start();

  sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 33;
  subG = ctx.createGain(); subG.gain.value = 0;
  sub.connect(subG).connect(master); sub.start();

  chirp = ctx.createOscillator(); chirp.type = 'sine'; chirp.frequency.value = 40;
  chirpG = ctx.createGain(); chirpG.gain.value = 0;
  chirp.connect(chirpG).connect(master); chirp.start();

  rumble.gain.linearRampToValueAtTime(.5, ctx.currentTime + 4);
}

export function resume() { ctx?.state === 'suspended' && ctx.resume(); }
export function ready() { return !!ctx; }

export function setMuted(m) {
  muted = m;
  if (ctx) master.gain.setTargetAtTime(m ? 0 : .9, ctx.currentTime, .1);
}

// r: camera distance in Schwarzschild radii
export function update(r, binary) {
  if (!ctx) return;
  const t = ctx.currentTime, near = 1 / r;
  rumbleF.frequency.setTargetAtTime(60 + 900 * near * near, t, .3);
  rumble.gain.setTargetAtTime(.35 + 1.4 * near, t, .3);
  sub.frequency.setTargetAtTime(28 + 30 * near, t, .3);
  subG.gain.setTargetAtTime(.05 + .5 * near, t, .3);
  // inspiral: frequency and amplitude rise as the separation shrinks
  const b = Math.max(0, Math.min(1, binary));
  chirp.frequency.setTargetAtTime(35 + 260 * b ** 3, t, .05);
  chirpG.gain.setTargetAtTime(.25 * b * b, t, .1);
}

export function tick(pan = 0) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
  o.type = 'square'; o.frequency.value = 2400;
  g.gain.setValueAtTime(.05, t);
  g.gain.exponentialRampToValueAtTime(.0001, t + .03);
  p.pan.value = pan;
  o.connect(g).connect(p).connect(master);
  o.start(t); o.stop(t + .04);
}

export function merge() {
  if (!ctx) return;
  const t = ctx.currentTime;
  // final chirp
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(80, t);
  o.frequency.exponentialRampToValueAtTime(420, t + .35);
  o.frequency.exponentialRampToValueAtTime(250, t + .5);
  g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime(.8, t + .33);
  g.gain.exponentialRampToValueAtTime(.0001, t + 2.6);   // ringdown
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 2.7);
  // impact
  const b = ctx.createOscillator(), bg = ctx.createGain();
  b.frequency.setValueAtTime(90, t + .33);
  b.frequency.exponentialRampToValueAtTime(24, t + 2.5);
  bg.gain.setValueAtTime(.0001, t);
  bg.gain.setValueAtTime(1, t + .34);
  bg.gain.exponentialRampToValueAtTime(.0001, t + 3);
  b.connect(bg).connect(master);
  b.start(t); b.stop(t + 3.1);
}

export function horizon() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(0, t + .4);
  master.gain.setValueAtTime(0, t + 5.5);
  master.gain.linearRampToValueAtTime(muted ? 0 : .9, t + 9);
}
