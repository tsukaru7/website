// Act V — everything the site noticed about you, live.

import { state, memory } from './state.js';

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s % 60).padStart(2, '0')} s`;
};
// CSS pixels are 1/96 inch: close enough to how far your hand actually moved on screen.
const fmtDist = (px) => {
  const m = px / 96 * .0254;
  return m < 1 ? `${(m * 100).toFixed(1).replace('.', ',')} cm` : `${m.toFixed(2).replace('.', ',')} m`;
};
const fmtDate = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export function initMemory(list) {
  const rows = [
    ['tu es ici depuis', () => fmtTime(Date.now() - state.stats.start)],
    ['ton curseur a parcouru', () => fmtDist(state.stats.distance)],
    ['tu as cliqué', () => `${state.stats.clicks} fois`],
    ['tu as tapé', () => `${state.stats.keys} touches`],
    ['tu as joué', () => `${state.stats.notes} notes`],
    ["j'ai cligné de l'œil", () => `${state.stats.blinks} fois`],
    ['ceci est ta visite n°', () => String(memory.visits)],
    ['on se connaît depuis le', () => fmtDate(memory.first)],
    ['au total, tu as passé ici', () => fmtTime(memory.totalTime + Date.now() - state.stats.start)],
  ];
  const cells = rows.map(([label], i) => {
    const li = document.createElement('li');
    li.style.transitionDelay = `${i * 70}ms`;
    li.innerHTML = `<span>${label}</span><span></span>`;
    list.append(li);
    return li.lastChild;
  });
  let timer = 0;
  const tick = () => {
    rows.forEach(([, fn], i) => { cells[i].textContent = fn(); });
    const fps = document.getElementById('hood-fps');
    if (fps) fps.textContent = Math.round(state.fps);
  };
  tick();
  return {
    start() { if (!timer) timer = setInterval(tick, 250); tick(); },
    stop() { clearInterval(timer); timer = 0; },
  };
}
