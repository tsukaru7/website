import { state, save } from './state.js';
import * as audio from './audio.js';
import { runIntro, city, clock } from './intro.js';
import { initEye } from './eye.js';
import { initMatter } from './matter.js';
import { initLife } from './life.js';
import { initSound } from './sound.js';
import { initMemory } from './memory.js';

const $ = (s) => document.querySelector(s);

// ---------- tracking the visitor ----------
addEventListener('pointermove', (e) => {
  const m = state.mouse;
  if (m.has) state.stats.distance += Math.hypot(e.clientX - m.x, e.clientY - m.y);
  m.x = e.clientX; m.y = e.clientY; m.has = true;
  m.lastMove = performance.now();
}, { passive: true });
addEventListener('pointerdown', (e) => {
  state.mouse.x = e.clientX; state.mouse.y = e.clientY; state.mouse.has = true;
  state.mouse.lastMove = performance.now();
  state.stats.clicks++;
});
addEventListener('keydown', () => { state.stats.keys++; });
addEventListener('pagehide', save);
setInterval(save, 5000);

// One global clock: cursor speed, audio level, fps, custom cursor.
const cursor = $('#cursor');
let prevX = state.mouse.x, prevY = state.mouse.y, prevT = performance.now(), cx = prevX, cy = prevY;
(function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.max(1, now - prevT) / 1000;
  prevT = now;
  const m = state.mouse;
  const v = Math.hypot(m.x - prevX, m.y - prevY) / dt;
  prevX = m.x; prevY = m.y;
  m.speed += (v - m.speed) * .2;
  state.energy += (audio.level() * 1.6 - state.energy) * .15;
  state.fps += (1 / dt - state.fps) * .05;
  cx += (m.x - cx) * .25; cy += (m.y - cy) * .25;
  cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
})(prevT);
addEventListener('pointerover', (e) => cursor.classList.toggle('hot', !!e.target.closest('button, summary, a')));

// ---------- the acts ----------
const eye = initEye($('#eye'));

const matter = initMatter($('#matter'), () => {
  const c = city();
  return ['TU ES ICI', c ? c.toUpperCase() : 'QUELQUE PART', clock(), 'TOUCHE-MOI', state.konami ? 'TRICHEUR' : 'JE TE VOIS'];
});

const life = initLife($('#life'));
if (life) {
  $('#life-preset').addEventListener('click', () => { $('#life-preset').textContent = `espèce : ${life.next()}`; });
  $('#life-reset').addEventListener('click', () => life.reset());
}

const sound = initSound($('#sound'));
const mem = initMemory($('#stats'));

// Only animate what is on screen.
const acts = { 's-eye': eye, 's-matter': matter, 's-life': life, 's-sound': sound, 's-memory': mem };
const sections = [...document.querySelectorAll('.act')];
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const a = acts[e.target.id];
    if (e.isIntersecting) {
      e.target.classList.add('in');
      if (state.awake || e.target.id === 's-eye') a?.start();
    } else a?.stop();
  }
}, { threshold: .05 });
sections.forEach((s) => io.observe(s));

// HUD: which act is centered
const hudI = $('#hud-index'), hudN = $('#hud-name');
const hudIO = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) {
    const i = sections.indexOf(e.target);
    hudI.textContent = String(i + 1).padStart(2, '0');
    hudN.textContent = e.target.dataset.name;
  }
}, { rootMargin: '-50% 0px -50% 0px' });
sections.forEach((s) => hudIO.observe(s));

// ---------- waking up ----------
runIntro(() => {
  audio.init();
  audio.resume();
  audio.awaken();
  state.awake = true;
  document.body.classList.add('awake');
  eye?.open();
  // start whatever is already visible
  sections.forEach((s) => {
    const r = s.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) acts[s.id]?.start();
  });
  cycleSub();
});

const subs = ['Bouge. Il te suit.', 'Arrête de bouger. Il s\'endort.', 'Clique sur « son » si tu préfères le silence.', 'Change d\'onglet. Pour voir.', 'Il ne cligne pas au hasard. Enfin, si.'];
function cycleSub() {
  let i = 0;
  const el = $('#eye-sub');
  setInterval(() => { i = (i + 1) % subs.length; el.textContent = subs[i]; }, 5000);
}

// ---------- sound toggle ----------
const mute = $('#mute');
mute.addEventListener('click', () => {
  const m = mute.getAttribute('aria-pressed') !== 'true';
  mute.setAttribute('aria-pressed', String(m));
  mute.textContent = m ? 'son : off' : 'son : on';
  audio.init();
  audio.resume();
  audio.setMuted(m);
});

// ---------- it notices things ----------
const toastEl = $('#toast');
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

const favicon = $('#favicon');
const openIcon = favicon.href;
const closedIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M4 30Q32 50 60 30' stroke='%23fff' stroke-width='5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E";
const title = document.title;
let hiddenAt = 0, titleTimer = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    save();
    const t = ['👁 je t\'attends', '👁 reviens…', '👁 tu es parti ?', '👁 je compte les secondes'];
    let i = 0;
    document.title = t[0];
    favicon.href = closedIcon;
    titleTimer = setInterval(() => { document.title = t[++i % t.length]; }, 2500);
  } else {
    clearInterval(titleTimer);
    document.title = title;
    favicon.href = openIcon;
    if (!state.awake) return;
    const s = Math.round((Date.now() - hiddenAt) / 1000);
    eye?.startle();
    toast(s < 2 ? 'Tu croyais que je ne verrais pas ?' : `Te revoilà. Tu es parti ${s} seconde${s > 1 ? 's' : ''}. Je les ai comptées.`);
  }
});

document.addEventListener('copy', () => toast('Je t\'ai vu copier ça.'));
addEventListener('contextmenu', () => toast('Tu cherches mes secrets ? Ouvre la console.'));
let lastW = innerWidth;
addEventListener('resize', () => {
  if (innerWidth === lastW) return; // mobile toolbars resize the height while scrolling
  lastW = innerWidth;
  toast(`${innerWidth}×${innerHeight}. Tu me changes de forme.`);
});

// Konami code: ↑ ↑ ↓ ↓ ← → ← → B A
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let kpos = 0;
addEventListener('keydown', (e) => {
  kpos = e.key.toLowerCase() === KONAMI[kpos].toLowerCase() ? kpos + 1 : (e.key === KONAMI[0] ? 1 : 0);
  if (kpos === KONAMI.length) {
    kpos = 0;
    state.konami = !state.konami;
    document.body.classList.toggle('konami', state.konami);
    toast(state.konami ? 'Mode hypnose activé. Regarde-moi dans les yeux.' : 'Retour à la réalité.');
    audio.blip();
  }
});

console.log(`%c
        .-""""""-.
      .'  .-""-.  '.
     /   /  ()  \\   \\
     \\   \\      /   /
      '.  '-..-'  .'
        '-......-'
`, 'color:#ff4f8b');
console.log('%cTu regardes dans mon code. Moi aussi, je te regarde.', 'font:bold 14px monospace;color:#efe9f4;background:#050308;padding:6px 10px');
console.log('%cIndice : ↑ ↑ ↓ ↓ ← → ← → B A', 'color:#8f839b');
