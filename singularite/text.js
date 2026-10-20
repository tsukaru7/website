// The billboard hanging in space behind the hole: a spacetime grid (green
// channel) and words (red channel). Gravitational lensing does the rest.

export function textCanvas(lines) {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);

  x.strokeStyle = 'rgb(0,255,0)';
  x.lineWidth = 2;
  for (let i = 0; i <= 32; i++) {
    x.globalAlpha = i % 4 ? .35 : .9;
    x.beginPath(); x.moveTo(i * W / 32, 0); x.lineTo(i * W / 32, H); x.stroke();
  }
  for (let j = 0; j <= 16; j++) {
    x.globalAlpha = j % 4 ? .35 : .9;
    x.beginPath(); x.moveTo(0, j * H / 16); x.lineTo(W, j * H / 16); x.stroke();
  }
  x.globalAlpha = 1;

  x.fillStyle = 'rgb(255,0,0)';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const sizes = [230, 230, 64];
  const ys = [H * .3, H * .58, H * .82];
  lines.forEach((t, i) => {
    let s = sizes[i] || 64;
    x.font = `900 ${s}px Unbounded, system-ui, sans-serif`;
    const tw = x.measureText(t).width;
    if (tw > W * .9) { s *= W * .9 / tw; x.font = `900 ${s}px Unbounded, system-ui, sans-serif`; }
    x.fillText(t, W / 2, ys[i] || H / 2);
  });
  return c;
}
