// Shared, mutable state: where the visitor is, what they did, what we remember.

const KEY = 'ce-site-te-regarde';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

const prev = load();

export const state = {
  mouse: { x: innerWidth / 2, y: innerHeight / 2, has: false, lastMove: performance.now(), speed: 0 },
  stats: { distance: 0, clicks: 0, keys: 0, blinks: 0, notes: 0, start: Date.now() },
  energy: 0,       // audio loudness 0..1, updated every frame
  awake: false,    // intro finished
  konami: false,
  fps: 60,
};

// What earlier visits left behind. Never mutated, so save() is idempotent.
export const memory = {
  visits: (prev.visits || 0) + 1,
  first: prev.first || Date.now(),
  last: prev.last || null,
  totalTime: prev.totalTime || 0,
  totalDistance: prev.totalDistance || 0,
};

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      visits: memory.visits,
      first: memory.first,
      last: Date.now(),
      totalTime: memory.totalTime + (Date.now() - state.stats.start),
      totalDistance: memory.totalDistance + state.stats.distance,
    }));
  } catch { /* private mode: we simply forget */ }
}

save();
