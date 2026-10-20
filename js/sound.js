// Act IV — the cursor is an instrument. A minor pentatonic over three octaves,
// ripples per note, a live spectrum ring, and a ghost player when you stop.

import { state } from './state.js';
import * as audio from './audio.js';

const SCALE = [0, 3, 5, 7, 10];
const NAMES = ['La', 'Do', 'Ré', 'Mi', 'Sol'];
const N = 15;

export function initSound(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, running = false, raf = 0;
  let lastIdx = -1, lastNote = 0, lastHuman = 0, ghostAt = 0;
  const ghost = { x: .5, y: .5, on: false };
  const ripples = [];
  const glow = new Float32Array(N);

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.width = Math.round(canvas.clientWidth * dpr);
    H = canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.fillStyle = '#050308';
    ctx.fillRect(0, 0, W, H);
  }

  function play(x, y, strong) {
    const idx = Math.max(0, Math.min(N - 1, Math.floor(x / W * N)));
    const now = performance.now();
    if (!strong && (idx === lastIdx || now - lastNote < 55)) return;
    lastIdx = idx; lastNote = now;
    const semi = 12 * Math.floor(idx / 5) + SCALE[idx % 5];
    audio.pluck(110 * Math.pow(2, semi / 12), 1 - y / H, strong ? .9 : .5, x / W * 2 - 1);
    glow[idx] = 1;
    ripples.push({ x, y, r: 4 * dpr, a: 1, h: 320 - idx / N * 170, s: strong ? 2.2 : 1 });
    state.stats.notes++;
  }

  const local = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
  canvas.addEventListener('pointermove', (e) => { lastHuman = performance.now(); ghost.on = false; play(...local(e), false); });
  canvas.addEventListener('pointerdown', (e) => { lastHuman = performance.now(); ghost.on = false; play(...local(e), true); });

  function frame(now) {
    raf = requestAnimationFrame(frame);

    // the site plays alone when you stop
    if (now - lastHuman > 4000 && now > ghostAt) {
      ghost.on = true;
      ghost.x = Math.max(.03, Math.min(.97, ghost.x + (Math.random() - .5) * .35));
      ghost.y = Math.max(.1, Math.min(.9, ghost.y + (Math.random() - .5) * .3));
      play(ghost.x * W, ghost.y * H, Math.random() < .2);
      ghostAt = now + [240, 480, 480, 960][(Math.random() * 4) | 0];
    }

    ctx.fillStyle = 'rgba(5, 3, 8, .16)';
    ctx.fillRect(0, 0, W, H);

    // note columns
    const cw = W / N;
    ctx.font = `${10 * dpr}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    for (let i = 0; i < N; i++) {
      glow[i] *= .93;
      const g = glow[i];
      if (g > .01) {
        const grad = ctx.createLinearGradient(0, H, 0, 0);
        grad.addColorStop(0, `hsla(${320 - i / N * 170}, 90%, 60%, ${g * .25})`);
        grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(i * cw, 0, cw, H);
      }
      ctx.fillStyle = `rgba(239, 233, 244, ${.06 + g * .1})`;
      ctx.fillRect(Math.round(i * cw), 0, 1, H);
      ctx.fillStyle = `rgba(239, 233, 244, ${.25 + g * .75})`;
      ctx.fillText(NAMES[i % 5] + (2 + Math.floor(i / 5)), i * cw + cw / 2, 78 * dpr);
    }

    // spectrum ring
    const spec = audio.spectrum();
    const cx = W / 2, cy = H / 2, R0 = Math.min(W, H) * .16;
    const BARS = 96;
    ctx.lineWidth = 2 * dpr;
    ctx.lineCap = 'round';
    for (let i = 0; i < BARS; i++) {
      const k = i < BARS / 2 ? i : BARS - 1 - i;   // mirrored: bass at the top
      const v = spec ? spec[2 + Math.floor(k / (BARS / 2) * 90)] / 255 : 0;
      const a = i / BARS * Math.PI * 2 - Math.PI / 2;
      const r1 = R0 + 4 * dpr, r2 = R0 + 4 * dpr + v * v * R0 * 1.4;
      ctx.strokeStyle = `hsla(${200 + v * 140}, 90%, ${50 + v * 30}%, ${.25 + v * .75})`;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(239, 233, 244, .15)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.arc(cx, cy, R0, 0, Math.PI * 2); ctx.stroke();

    // ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.r += 3.2 * dpr * r.s;
      r.a *= .955;
      if (r.a < .02) { ripples.splice(i, 1); continue; }
      ctx.strokeStyle = `hsla(${r.h}, 95%, 65%, ${r.a})`;
      ctx.lineWidth = 2 * dpr * r.a + .5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `hsla(${r.h}, 95%, 75%, ${r.a * .6})`;
      ctx.beginPath(); ctx.arc(r.x, r.y, 3 * dpr * r.a, 0, Math.PI * 2); ctx.fill();
    }

    if (ghost.on) {
      ctx.fillStyle = 'rgba(239, 233, 244, .5)';
      ctx.fillText('je joue pour toi', ghost.x * W, ghost.y * H - 18 * dpr);
    }
  }

  resize();
  addEventListener('resize', resize);

  return {
    start() { if (!running) { running = true; lastHuman = performance.now(); audio.startPad(); raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); audio.stopPad(); },
  };
}
