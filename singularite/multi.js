// Several browser windows, one universe. Every window publishes where it sits
// on the physical screen; each one is a black hole at its own centre. A plasma
// bridge is drawn between them in *screen* coordinates, and every particle's
// position is a pure function of (index, wall-clock time), so all windows draw
// the very same particles and the stream flows seamlessly across window edges
// without ever synchronising particle state.

const CHANNEL = 'singularite';

export function screenRect() {
  const bx = Math.max(0, (outerWidth - innerWidth) / 2);
  const by = Math.max(0, outerHeight - innerHeight - bx);
  return { x: screenX + bx, y: screenY + by, w: innerWidth, h: innerHeight };
}

export function initMulti(overlay, { onMerge, onAbsorbed } = {}) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const peers = new Map();
  const ch = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
  const ctx = overlay.getContext('2d');
  let merged = false, absorbed = false, last = 0;

  const me = () => { const r = screenRect(); return { id, cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h }; };

  function post(type = 'pos') { ch?.postMessage({ type, ...me(), at: Date.now() }); }

  ch && (ch.onmessage = ({ data }) => {
    if (data.id === id) return;
    if (data.type === 'bye') { peers.delete(data.id); return; }
    if (data.type === 'merge') {
      // the older window survives, the younger one is swallowed
      if (data.survivor === id) { if (!merged) { merged = true; onMerge?.(data.x, data.y); } }
      else if (data.victim === id && !absorbed) { absorbed = true; onAbsorbed?.(); }
      return;
    }
    const isNew = !peers.has(data.id);
    peers.set(data.id, { ...data, seen: performance.now() });
    if (isNew) post();
  });
  addEventListener('pagehide', () => post('bye'));
  post();

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    overlay.width = Math.round(innerWidth * dpr);
    overlay.height = Math.round(innerHeight * dpr);
  }
  resize();
  addEventListener('resize', resize);

  // soft glow sprite
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const sg = sprite.getContext('2d');
  const grad = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,220,1)');
  grad.addColorStop(.25, 'rgba(255,150,80,.55)');
  grad.addColorStop(1, 'rgba(255,60,40,0)');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 64, 64);

  // Returns the strongest proximity 0..1 to any peer, and the direction to it.
  function frame(now) {
    if (now - last > 50) { post(); last = now; }
    for (const [k, p] of peers) if (now - p.seen > 1500) peers.delete(k);

    const dpr = overlay.width / innerWidth;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const m = me();
    const origin = screenRect();
    let pull = 0, dir = [0, 0];
    if (absorbed) return { pull: 0, dir, count: peers.size };

    ctx.globalCompositeOperation = 'lighter';
    const t = Date.now() / 1000;
    for (const p of peers.values()) {
      const dx = p.cx - m.cx, dy = p.cy - m.cy;
      const dist = Math.hypot(dx, dy) || 1;
      const scale = Math.min(m.w, m.h, p.w, p.h);
      const prox = Math.max(0, Math.min(1, 1 - (dist - scale * .25) / (scale * 2.2)));
      if (prox > pull) { pull = prox; dir = [dx / dist, dy / dist]; }

      if (!merged && !absorbed && dist < scale * .22) {
        const survivor = id < p.id ? id : p.id;
        const victim = survivor === id ? p.id : id;
        const x = (m.cx + p.cx) / 2, y = (m.cy + p.cy) / 2;
        ch?.postMessage({ type: 'merge', id, survivor, victim, x, y });
        if (survivor === id) { merged = true; onMerge?.(x, y); } else { absorbed = true; onAbsorbed?.(); }
      }

      // canonical endpoints so every window computes the same curve
      const [A, B] = id < p.id ? [m, p] : [p, m];
      const ax = A.cx, ay = A.cy, bx = B.cx, by = B.cy;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / len, ny = (bx - ax) / len;
      const sag = len * .18 * Math.sin(t * .4);
      const mx = (ax + bx) / 2 + nx * sag, my = (ay + by) / 2 + ny * sag;
      const width = 18 + 50 * (1 - prox);
      const N = 420;
      for (let i = 0; i < N; i++) {
        const fwd = i & 1;
        const speed = .08 + (i % 7) * .012 + prox * .25;
        let s = (i * .618034 + t * speed) % 1;
        if (fwd) s = 1 - s;
        const k = 1 - s;
        // quadratic Bézier + a helical wobble that vanishes at both holes
        const bxs = k * k * ax + 2 * k * s * mx + s * s * bx;
        const bys = k * k * ay + 2 * k * s * my + s * s * by;
        const env = Math.sin(Math.PI * s);
        const wob = Math.sin(i * 12.9898 + t * (1.5 + (i % 5) * .3)) * width * env;
        const x = (bxs + nx * wob - origin.x) * dpr;
        const y = (bys + ny * wob - origin.y) * dpr;
        if (x < -40 || y < -40 || x > overlay.width + 40 || y > overlay.height + 40) continue;
        const size = (6 + 14 * env * ((i * 7) % 3 === 0 ? 1.8 : 1)) * dpr * (.6 + prox);
        ctx.globalAlpha = .35 + .5 * env;
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return { pull, dir, count: peers.size };
  }

  return { frame, id, peers };
}
