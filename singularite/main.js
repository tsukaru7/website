import { Renderer } from './renderer.js';
import { textCanvas } from './text.js';
import { initMulti, screenRect } from './multi.js';
import * as audio from './audio.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#gl');
const twin = new URLSearchParams(location.search).has('jumelle');
if (twin) document.body.classList.add('twin');

// Physical scale for the readouts: a 10^8 solar-mass hole.
const RS_KM = 2.953 * 1e8;
const AU_KM = 1.496e8;
const B_CRIT = 3 * Math.sqrt(3) / 2;   // critical impact parameter, in r_s

let renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  console.error(e);
  $('#loading').textContent = "Ta carte graphique ne peut pas calculer l'espace-temps courbe (WebGL2 + textures flottantes requis). Essaie sur un ordinateur récent avec Chrome, Edge, Firefox ou Safari.";
  throw e;
}

// ---------------------------------------------------------------- the billboard
function city() {
  try { return (Intl.DateTimeFormat().resolvedOptions().timeZone || '').split('/').pop().replace(/_/g, ' '); } catch { return ''; }
}
function updateText() {
  const c = city();
  const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  renderer.setText(textCanvas(['RIEN NE', "S'ÉCHAPPE", `${c ? c.toUpperCase() + ' · ' : ''}${time} · TU ES ICI`]));
}
updateText();
document.fonts?.ready.then(updateText);
setInterval(updateText, 60000);

// ---------------------------------------------------------------- camera
const cam = { yaw: .35, pitch: .1, dist: 26, tYaw: .35, tPitch: .1, tDist: 17, look: 0 };
let lastInput = performance.now();
const pointers = new Map();
let pinch0 = 0, pinchDist0 = 0;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
    pinchDist0 = cam.tDist;
  }
  lastInput = performance.now();
});
canvas.addEventListener('pointermove', (e) => {
  mouse.x = e.clientX / innerWidth * 2 - 1;
  mouse.y = -(e.clientY / innerHeight * 2 - 1);
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  lastInput = performance.now();
  if (mode !== 'free') return;
  if (pointers.size === 1) {
    cam.tYaw -= (e.clientX - prev[0]) * .005;
    cam.tPitch = clamp(cam.tPitch + (e.clientY - prev[1]) * .004, -1.4, 1.4);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch0) cam.tDist = clamp(pinchDist0 * pinch0 / d, 2.2, 70);
  }
});
const lift = (e) => { pointers.delete(e.pointerId); pinch0 = 0; };
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
addEventListener('wheel', (e) => {
  if (mode !== 'free') return;
  cam.tDist = clamp(cam.tDist * Math.exp(e.deltaY * .0012), 2.2, 70);
  lastInput = performance.now();
}, { passive: true });
addEventListener('keydown', (e) => {
  lastInput = performance.now();
  if (e.key === 'Escape' && mode === 'dive') endDive(false);
  if (mode !== 'free') return;
  if (e.key === 'ArrowLeft') cam.tYaw += .15;
  if (e.key === 'ArrowRight') cam.tYaw -= .15;
  if (e.key === 'ArrowUp') cam.tPitch = clamp(cam.tPitch + .1, -1.4, 1.4);
  if (e.key === 'ArrowDown') cam.tPitch = clamp(cam.tPitch - .1, -1.4, 1.4);
  if (e.key === '+' || e.key === '=') cam.tDist = clamp(cam.tDist * .85, 2.2, 70);
  if (e.key === '-') cam.tDist = clamp(cam.tDist / .85, 2.2, 70);
});
const mouse = { x: 0, y: 0 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function basis(tilt) {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const pos = [cam.dist * cp * Math.sin(cam.yaw), cam.dist * sp, cam.dist * cp * Math.cos(cam.yaw)];
  let f = norm(pos.map((v) => -v));
  let r = norm(cross(f, [0, 1, 0]));
  let u = cross(r, f);
  // turn around to look outward (used at the end of the dive)
  const a = Math.PI * cam.look;
  f = norm(add(scale(f, Math.cos(a)), scale(r, Math.sin(a))));
  r = norm(cross(f, [0, 1, 0]));
  u = cross(r, f);
  // parallax toward the cursor + tidal lean toward a twin window
  f = norm(add(f, add(scale(r, mouse.x * .035 + tilt[0]), scale(u, mouse.y * .025 + tilt[1]))));
  r = norm(cross(f, [0, 1, 0]));
  u = cross(r, f);
  return { pos, rot: [...r, ...u, ...f] };
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const add = (a, b) => a.map((v, i) => v + b[i]);
const scale = (a, s) => a.map((v) => v * s);

// ---------------------------------------------------------------- the fall
let mode = 'free';           // free | dive | horizon
let dive = null;
const caption = $('#caption');
let captionTimer = 0;
function say(html, ms = 4500) {
  caption.innerHTML = html;
  caption.classList.add('show');
  clearTimeout(captionTimer);
  if (ms) captionTimer = setTimeout(() => caption.classList.remove('show'), ms);
}

const DIVE_LINES = [
  [12, 'Tu tombes.'],
  [6, "Le disque passe sous toi à la moitié de la vitesse de la lumière."],
  [3.2, "Dernière orbite stable. Plus rien ne tourne en rond ici."],
  [1.6, "Sphère des photons : la lumière elle-même orbite autour du trou."],
  [1.25, "Retourne-toi. Tout l'Univers tient maintenant dans un cercle."],
  [1.04, "Ton temps ralentit. Regarde l'horloge de la Terre s'emballer."],
];

function startDive() {
  if (mode !== 'free') return;
  mode = 'dive';
  dive = { t0: performance.now(), d0: cam.dist, p0: cam.pitch, said: 0 };
  $('#b-dive').textContent = 'remonter (échap)';
}
function endDive(reachedHorizon) {
  if (reachedHorizon) {
    mode = 'horizon';
    audio.horizon();
    say("Tu as franchi l'horizon.<small>Plus rien ne peut en sortir. Pas même la lumière.<br>Pas même ce message.</small>", 0);
    setTimeout(() => say("…sauf qu'ici, c'est un site web.<small>On recommence ?</small>", 3500), 4200);
    setTimeout(() => { cam.dist = cam.tDist = 30; cam.pitch = cam.tPitch = .1; cam.look = 0; mode = 'free'; }, 5200);
  } else {
    mode = 'free';
    cam.tDist = Math.max(cam.dist, 6) * 2;
    cam.look = 0;
    caption.classList.remove('show');
  }
  dive = null;
  $('#b-dive').textContent = 'plonger';
}
$('#b-dive').addEventListener('click', () => (mode === 'dive' ? endDive(false) : startDive()));

let doppler = 1, dopplerT = 1;
$('#b-doppler').addEventListener('click', (e) => {
  dopplerT = dopplerT ? 0 : 1;
  e.currentTarget.textContent = dopplerT ? 'physique : réaliste' : 'physique : cinéma';
  e.currentTarget.setAttribute('aria-pressed', String(!!dopplerT));
  say(dopplerT
    ? "Mode réaliste.<small>Le côté du disque qui fonce vers toi est amplifié par l'effet Doppler relativiste, l'autre s'éteint dans le rouge.</small>"
    : "Mode cinéma.<small>Comme dans Interstellar : on coupe l'effet Doppler pour garder un disque symétrique. Faux, mais beau.</small>");
});

$('#b-sound').addEventListener('click', (e) => {
  const m = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(m));
  e.currentTarget.textContent = m ? 'son : off' : 'son : on';
  audio.init(); audio.resume(); audio.setMuted(m);
});

$('#b-twin').addEventListener('click', () => {
  const r = screenRect();
  const w = 520, h = 520;
  const left = Math.round(r.x + r.w - w - 40), top = Math.round(r.y + 60);
  const win = window.open(`${location.pathname}?jumelle`, `jumelle-${Date.now()}`, `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!win) say("Ton navigateur a bloqué la fenêtre.<small>Autorise les pop-ups pour ce site, ou ouvre cette page dans une deuxième fenêtre.</small>");
  else say('Une jumelle est née.<small>Attrape sa fenêtre et rapproche-la de celle-ci. Lentement.</small>', 6000);
});

// ---------------------------------------------------------------- twins
let wave = [0, 0, 0, 0], flash = 0, fade = 1, absorbed = false;
const multi = initMulti($('#overlay'), {
  onMerge(x, y) {
    const r = screenRect();
    wave = [(x - r.x) / r.w, 1 - (y - r.y) / r.h, 0, 1];
    flash = 1.2;
    cam.dist /= 1.6;            // twice the mass: every length in r_s units shrinks
    cam.tDist = Math.max(cam.tDist / 1.6, 2.4);
    audio.merge();
    say('Fusion.<small>Deux trous noirs viennent de n\'en faire qu\'un.<br>L\'onde gravitationnelle que tu vois traverser l\'écran a fait vibrer l\'espace lui-même.</small>', 7000);
  },
  onAbsorbed() {
    absorbed = true;
    flash = 1.2;
    say("Absorbée.", 0);
    setTimeout(() => { if (window.opener) window.close(); else say("Absorbée.<small>Cette fenêtre a été avalée par sa jumelle.</small>", 0); }, 1600);
  },
});

// ---------------------------------------------------------------- loop
let renderScale = .5, frames = 0, acc = 0, last = performance.now(), fps = 60;
let started = false, compiled = false;
const birth = performance.now();
let myTime = 0, earthTime = 0, lastTick = 0;

function sizeCanvas() {
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  renderer.resize(Math.max(64, Math.round(w * renderScale)), Math.max(36, Math.round(h * renderScale)));
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - last);
  last = now;
  const dt = dtMs / 1000;

  // adaptive resolution: keep the frame rate, trade pixels for it
  acc += dtMs; frames++;
  if (frames === 30) {
    const avg = acc / frames;
    fps = 1000 / avg;
    if (avg > 24 && renderScale > .22) renderScale = Math.max(.22, renderScale * .85);
    else if (avg < 17.5 && renderScale < .9) renderScale = Math.min(.9, renderScale * 1.07);
    frames = 0; acc = 0;
  }
  sizeCanvas();

  // twins
  const m = multi.frame(now);
  const tilt = [-m.dir[0] * m.pull * .22, m.dir[1] * m.pull * .16];

  // camera
  if (mode === 'free') {
    if (now - lastInput > 7000) {
      cam.tYaw += dt * .04;
      cam.tPitch += (.12 + .1 * Math.sin(now / 9000) - cam.tPitch) * dt * .2;
    }
    const k = 1 - Math.exp(-dt * 3.5);
    cam.yaw += (cam.tYaw - cam.yaw) * k;
    cam.pitch += (cam.tPitch - cam.pitch) * k;
    cam.dist *= Math.exp((Math.log(cam.tDist) - Math.log(cam.dist)) * (1 - Math.exp(-dt * 2)));
  } else if (mode === 'dive') {
    const p = clamp((now - dive.t0) / 34000, 0, 1);
    const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    cam.dist = Math.exp(Math.log(dive.d0) + (Math.log(1.0015) - Math.log(dive.d0)) * e);
    cam.pitch = dive.p0 + (.06 - dive.p0) * e;
    cam.yaw += dt * .05 * (1 - p);
    cam.look = smooth(2.4, 1.3, cam.dist);
    // one caption at a time: the next waits until the previous had time to be read
    if (dive.said < DIVE_LINES.length && cam.dist < DIVE_LINES[dive.said][0] && now - (dive.sayAt || 0) > 3200) {
      say(DIVE_LINES[dive.said++][1], 3800);
      dive.sayAt = now;
    }
    if (p >= 1) endDive(true);
  }

  if (mode === 'horizon') fade = Math.max(0, fade - dt * 3);
  else if (absorbed) fade = Math.max(0, fade - dt * 1.2);
  else fade = Math.min(1, fade + dt * (started ? .5 : 0));

  doppler += (dopplerT - doppler) * (1 - Math.exp(-dt * 3));
  flash = Math.max(0, flash - dt * 1.5);
  if (wave[3] > 0) { wave[2] += dt; if (wave[2] > 6) wave = [0, 0, 0, 0]; }

  // time dilation: a static observer at r sees distant clocks run faster by 1/sqrt(1 - r_s/r)
  const dil = 1 / Math.sqrt(1 - 1 / cam.dist);
  if (started) {
    myTime += dt;
    earthTime += dt * (mode === 'horizon' ? 400 : dil);
    if (Math.floor(earthTime) !== lastTick) { lastTick = Math.floor(earthTime); audio.tick(Math.sin(earthTime) * .6); }
  }
  audio.update(cam.dist, m.pull);

  // behind the opaque intro, one frame is enough to compile the shaders
  if (!started && compiled) return;
  compiled = true;
  const b = basis(tilt);
  renderer.render({
    time: (now - birth) / 1000,
    camPos: b.pos,
    camRot: b.rot,
    fov: innerWidth < innerHeight ? 1.25 : .95,
    dphi: renderScale < .3 ? .06 : .045,
    doppler,
    exposure: 1.,
    bloom: .03,
    fade,
    flash,
    wave,
  });

  hud(dil);
}

// ---------------------------------------------------------------- readouts
const H = { r: $('#h-r'), dil: $('#h-dil'), shadow: $('#h-shadow'), me: $('#h-me'), earth: $('#h-earth'), rays: $('#h-rays') };
let hudAt = 0;
const fr = (v, d = 2) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtDur(s) {
  if (s < 3600) return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  if (s < 86400 * 2) return `${Math.floor(s / 3600)} h ${String(Math.floor(s / 60) % 60).padStart(2, '0')} min`;
  return `${fr(s / 86400, 1)} jours`;
}
function hud(dil) {
  const now = performance.now();
  if (now - hudAt < 100) return;
  hudAt = now;
  const r = cam.dist;
  H.r.textContent = `${fr(r)} rₛ · ${fr(r * RS_KM / AU_KM, 1)} UA`;
  H.dil.textContent = `×${fr(dil, 3)}`;
  // angular diameter of the shadow for a static observer
  const s = clamp(B_CRIT * Math.sqrt(1 - 1 / r) / r, 0, 1);
  const half = r > 1.5 ? Math.asin(s) : Math.PI - Math.asin(s);
  H.shadow.textContent = `${fr(half * 2 * 180 / Math.PI, 1)}°`;
  H.me.textContent = fmtDur(myTime);
  H.earth.textContent = fmtDur(earthTime);
  const rays = renderer.w * renderer.h;
  H.rays.textContent = `${renderer.w}×${renderer.h} · ${fr(rays * fps / 1e6, 1)} M/s`;
}

// ---------------------------------------------------------------- intro
const INTRO = [
  ['Ce que tu vas voir n\'est pas une vidéo.', ''],
  ['C\'est un trou noir de cent millions de soleils, calculé en direct par ta carte graphique.', ''],
  ['Pour chaque pixel, je suis un rayon de lumière à rebours à travers l\'espace-temps courbé par la relativité générale d\'Einstein. Des millions de rayons, soixante fois par seconde.', 'dim'],
  ['Mets du son.', 'dim'],
];

async function intro() {
  const box = $('#intro-text');
  const btn = $('#enter');
  let fast = false;
  $('#intro').addEventListener('pointerdown', () => { fast = true; });
  const wait = (ms) => new Promise((r) => setTimeout(r, fast ? 0 : ms));
  for (const [line, cls] of INTRO) {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    box.append(p);
    for (const ch of line) { p.textContent += ch; await wait(ch === '.' || ch === ',' ? 160 : 18 + Math.random() * 22); }
    await wait(500);
  }
  btn.hidden = false;
  btn.focus({ preventScroll: true });
  const go = () => {
    if (started) return;
    started = true;
    audio.init(); audio.resume();
    $('#intro').classList.add('gone');
    document.body.classList.add('live');
    lastInput = performance.now() - 6000;
    setTimeout(() => say('Glisse pour tourner autour.<small>Le disque au-dessus du trou est le même que celui de devant : sa lumière passe par-dessus.</small>', 6000), 3500);
  };
  btn.addEventListener('click', go);
  addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.hidden) go(); });
}

// First frame compiles the shaders; let the browser paint the intro first.
requestAnimationFrame(() => {
  fade = 0;
  requestAnimationFrame(frame);
  const loading = $('#loading');
  if (loading) { loading.textContent = 'espace-temps prêt.'; loading.classList.add('done'); }
});

if (new URLSearchParams(location.search).has('debug')) {
  // test hook: skip the intro and expose the camera
  $('#intro').remove();
  document.body.classList.add('live');
  started = true;
  window.__bh = { cam, set: (o) => Object.assign(cam, o), fade: () => { fade = 1; }, dive: startDive };
} else if (twin) {
  $('#intro').remove();
  document.body.classList.add('live');
  started = true;
  cam.dist = cam.tDist = 15;
  setTimeout(() => say('Je suis la jumelle.<small>Rapproche ma fenêtre de l\'autre.</small>', 5000), 800);
} else {
  intro();
}

console.log('%cSINGULARITÉ', 'font:900 20px sans-serif;color:#ffb070');
console.log('%cÉquation de Binet  u\'\' + u = 3/2·u²  intégrée en RK4 pour chaque pixel. Code : /singularite/shaders.js', 'color:#9c9087');
