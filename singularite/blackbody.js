// Colour of a black body, computed from first principles: Planck's law
// integrated against the CIE 1931 colour matching functions (multi-lobe
// Gaussian fit by Wyman, Sloan & Shirley, 2013), then XYZ -> linear sRGB.
// Each entry is normalised to luminance Y = 1; brightness is handled in the shader.

const h = 6.62607015e-34, c = 2.99792458e8, k = 1.380649e-23;

const lobe = (x, mu, s1, s2) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-.5 * t * t);
};
const xBar = (l) => 1.056 * lobe(l, 599.8, 37.9, 31.0) + .362 * lobe(l, 442.0, 16.0, 26.7) - .065 * lobe(l, 501.1, 20.4, 26.2);
const yBar = (l) => .821 * lobe(l, 568.8, 46.9, 40.5) + .286 * lobe(l, 530.9, 16.3, 31.1);
const zBar = (l) => 1.217 * lobe(l, 437.0, 11.8, 36.0) + .681 * lobe(l, 459.0, 26.0, 13.8);

function planck(nm, T) {
  const l = nm * 1e-9;
  return (2 * h * c * c) / (l ** 5 * (Math.exp((h * c) / (l * k * T)) - 1));
}

export const T_MIN = 800, T_MAX = 60000;

export function blackbodyLUT(size = 256) {
  const out = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) {
    const T = Math.exp(Math.log(T_MIN) + (Math.log(T_MAX) - Math.log(T_MIN)) * i / (size - 1));
    let X = 0, Y = 0, Z = 0;
    for (let nm = 380; nm <= 780; nm += 2) {
      const p = planck(nm, T);
      X += p * xBar(nm); Y += p * yBar(nm); Z += p * zBar(nm);
    }
    X /= Y; Z /= Y; Y = 1;
    const r = 3.2406 * X - 1.5372 * Y - .4986 * Z;
    const g = -.9689 * X + 1.8758 * Y + .0415 * Z;
    const b = .0557 * X - .2040 * Y + 1.0570 * Z;
    out.set([Math.max(r, 0), Math.max(g, 0), Math.max(b, 0), 1], i * 4);
  }
  return out;
}
