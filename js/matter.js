// Act II — words made of thousands of particles that flee the cursor.
// Plain JS physics on typed arrays, rendered by writing pixels directly.

import { state } from './state.js';

export function initMatter(canvas, phrases) {
  const ctx = canvas.getContext('2d');
  const MAX = 16000;
  const px = new Float32Array(MAX), py = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX);
  const tx = new Float32Array(MAX), ty = new Float32Array(MAX);
  let W = 0, H = 0, scale = 1, N = 0, img, buf;
  let phrase = 0, nextSwap = 0, running = false, raf = 0;

  // 64-step palette: white when calm, pink then cyan when fast. ABGR for little-endian.
  const pal = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    const t = i / 63;
    const r = t < .5 ? 255 : 255 - (255 - 63) * (t - .5) * 2;
    const g = t < .5 ? 240 - (240 - 79) * t * 2 : 79 + (224 - 79) * (t - .5) * 2;
    const b = t < .5 ? 244 - (244 - 139) * t * 2 : 139 + (208 - 139) * (t - .5) * 2;
    pal[i] = 0xff000000 | (b << 16) | (g << 8) | r;
  }
  const BG = 0xff080305;

  function sample(text) {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const o = off.getContext('2d', { willReadFrequently: true });
    let size = H * .34;
    o.font = `900 ${size}px Unbounded, system-ui, sans-serif`;
    const tw = o.measureText(text).width;
    if (tw > W * .88) size *= W * .88 / tw;
    o.font = `900 ${size}px Unbounded, system-ui, sans-serif`;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillStyle = '#fff';
    o.fillText(text, W / 2, H / 2);
    const data = o.getImageData(0, 0, W, H).data;
    const pts = [];
    const step = Math.max(2, Math.round(2 * scale));
    for (let y = 0; y < H; y += step)
      for (let x = 0; x < W; x += step)
        if (data[(y * W + x) * 4 + 3] > 128) pts.push(x, y);
    return pts;
  }

  function setPhrase(text) {
    const pts = sample(text);
    const n = pts.length / 2;
    if (!n) return;
    // Fisher–Yates on point indices so particles travel across the word
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    for (let i = n - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (let i = 0; i < N; i++) {
      const k = idx[i % n];
      tx[i] = pts[k * 2] + (Math.random() - .5) * scale;
      ty[i] = pts[k * 2 + 1] + (Math.random() - .5) * scale;
    }
  }

  function resize() {
    scale = Math.min(devicePixelRatio || 1, 1.5);
    W = Math.max(1, Math.floor(canvas.clientWidth * scale));
    H = Math.max(1, Math.floor(canvas.clientHeight * scale));
    canvas.width = W; canvas.height = H;
    img = ctx.createImageData(W, H);
    buf = new Uint32Array(img.data.buffer);
    const n = Math.min(MAX, Math.max(4000, Math.round(W * H / 70)));
    for (let i = N; i < n; i++) { px[i] = Math.random() * W; py[i] = Math.random() * H; vx[i] = vy[i] = 0; }
    N = n;
    setPhrase(phrases()[phrase % phrases().length]);
    const hood = document.getElementById('hood-particles');
    if (hood) hood.textContent = N.toLocaleString('fr-FR');
  }

  function explode(cx, cy) {
    for (let i = 0; i < N; i++) {
      const dx = px[i] - cx, dy = py[i] - cy;
      const d = Math.hypot(dx, dy) + 1;
      const f = 30 * scale * (0.4 + Math.random()) * Math.min(1, 300 * scale / d);
      vx[i] += dx / d * f;
      vy[i] += dy / d * f;
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    explode((e.clientX - r.left) * scale, (e.clientY - r.top) * scale);
    nextSwap = performance.now() + 900;
    phrase++;
    setTimeout(() => setPhrase(phrases()[phrase % phrases().length]), 350);
  });

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now > nextSwap) {
      nextSwap = now + 3800;
      phrase++;
      setPhrase(phrases()[phrase % phrases().length]);
    }

    const r = canvas.getBoundingClientRect();
    const mx = (state.mouse.x - r.left) * scale, my = (state.mouse.y - r.top) * scale;
    const R = 110 * scale, R2 = R * R;
    const SPRING = .018, DAMP = .885;

    buf.fill(BG);
    for (let i = 0; i < N; i++) {
      let x = px[i], y = py[i];
      const dx = x - mx, dy = y - my, d2 = dx * dx + dy * dy;
      if (d2 < R2) {
        const d = Math.sqrt(d2) + .01, f = (1 - d / R) * 5 * scale;
        vx[i] += dx / d * f;
        vy[i] += dy / d * f;
      }
      vx[i] = (vx[i] + (tx[i] - x) * SPRING) * DAMP;
      vy[i] = (vy[i] + (ty[i] - y) * SPRING) * DAMP;
      x += vx[i]; y += vy[i];
      px[i] = x; py[i] = y;

      const xi = x | 0, yi = y | 0;
      if (xi < 0 || yi < 0 || xi >= W - 1 || yi >= H - 1) continue;
      const sp = Math.abs(vx[i]) + Math.abs(vy[i]);
      const c = pal[Math.min(63, (sp * 4 / scale) | 0)];
      const o = yi * W + xi;
      buf[o] = c; buf[o + 1] = c; buf[o + W] = c; buf[o + W + 1] = c;
    }
    ctx.putImageData(img, 0, 0);
  }

  resize();
  addEventListener('resize', () => running && resize());
  document.fonts?.ready.then(() => setPhrase(phrases()[phrase % phrases().length]));

  return {
    start() { if (!running) { running = true; resize(); nextSwap = performance.now() + 3800; raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); },
  };
}
