// Act III — Gray-Scott reaction–diffusion on the GPU. Two float textures
// ping-pong several simulation steps per frame; the cursor seeds chemical B.

import { getGL, createProgram, fullscreenTriangle, fitCanvas, fallback } from './gl.js';
import { state } from './state.js';

const INIT_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform float aspect, seed;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21) + seed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 g = uv * vec2(aspect, 1.) * 7.;
  vec2 c = floor(g);
  float b = h21(c) > .78 && length(fract(g) - .5) < .18 ? 1. : 0.;
  o = vec4(1., b, 0., 1.);
}`;

const SIM_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D S;
uniform vec2 px;
uniform float F, K, aspect, rad;
uniform vec4 seg;   // brush segment: from xy to zw, in uv
vec2 at(vec2 off) { return texture(S, uv + off * px).xy; }
void main() {
  vec2 c = at(vec2(0));
  vec2 lap = -c
    + .2 * (at(vec2(1, 0)) + at(vec2(-1, 0)) + at(vec2(0, 1)) + at(vec2(0, -1)))
    + .05 * (at(vec2(1, 1)) + at(vec2(-1, -1)) + at(vec2(1, -1)) + at(vec2(-1, 1)));
  float a = c.x, b = c.y, abb = a * b * b;
  a += lap.x - abb + F * (1. - a);
  b += .5 * lap.y + abb - (K + F) * b;
  if (rad > 0.) {
    vec2 p = uv * vec2(aspect, 1.), A = seg.xy * vec2(aspect, 1.), B = seg.zw * vec2(aspect, 1.);
    vec2 ab = B - A;
    float h = clamp(dot(p - A, ab) / max(dot(ab, ab), 1e-6), 0., 1.);
    if (length(p - A - ab * h) < rad) b = .95;
  }
  o = vec4(clamp(a, 0., 1.), clamp(b, 0., 1.), 0., 1.);
}`;

const SHOW_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D S;
uniform vec2 px;
uniform vec3 c1, c2;
uniform float energy;
void main() {
  float b = texture(S, uv).y;
  float bx = texture(S, uv + vec2(px.x, 0)).y - texture(S, uv - vec2(px.x, 0)).y;
  float by = texture(S, uv + vec2(0, px.y)).y - texture(S, uv - vec2(0, px.y)).y;
  vec3 n = normalize(vec3(-bx, -by, .035));
  vec3 L = normalize(vec3(-.5, .6, .7));
  float dif = dot(n, L) * .5 + .5;
  float spec = pow(max(dot(reflect(-L, n), vec3(0, 0, 1)), 0.), 24.);
  float v = smoothstep(.08, .42, b);
  vec3 col = mix(vec3(.02, .01, .03), mix(c1, c2, smoothstep(.2, .5, b)), v) * (.35 + .9 * dif);
  col += spec * v * (.55 + energy);
  col *= smoothstep(1.25, .35, length(uv - .5) * 1.6);
  o = vec4(col, 1.);
}`;

export const PRESETS = [
  { name: 'corail',    F: .0545, K: .062,  c1: [1, .31, .55], c2: [1, .85, .6] },
  { name: 'mitose',    F: .0367, K: .0649, c1: [.25, .88, .82], c2: [.9, 1, .95] },
  { name: 'vers',      F: .078,  K: .061,  c1: [.95, .7, .2], c2: [1, .35, .2] },
  { name: 'labyrinthe', F: .029, K: .057,  c1: [.55, .35, 1], c2: [.95, .6, 1] },
  { name: 'bulles',    F: .039,  K: .058,  c1: [.2, .55, 1], c2: [.75, .95, 1] },
];

export function initLife(canvas) {
  const gl = getGL(canvas);
  const ext = gl && gl.getExtension('EXT_color_buffer_float');
  const half = gl && !ext && gl.getExtension('EXT_color_buffer_half_float');
  if (!gl || (!ext && !half)) { fallback(canvas, "Ta carte graphique refuse de faire pousser la vie ici."); return null; }
  const linear = !!gl.getExtension('OES_texture_float_linear');
  const fmt = ext ? gl.RGBA32F : gl.RGBA16F;
  const type = ext ? gl.FLOAT : gl.HALF_FLOAT;
  const filter = ext && !linear ? gl.NEAREST : gl.LINEAR;

  let init, sim, show;
  try { init = createProgram(gl, INIT_FS); sim = createProgram(gl, SIM_FS); show = createProgram(gl, SHOW_FS); }
  catch (e) { console.error(e); fallback(canvas, "La vie n'a pas pu éclore."); return null; }
  const vao = fullscreenTriangle(gl);

  let SW = 0, SH = 0, tex = [], fbo = [], cur = 0;
  let preset = 0, running = false, raf = 0;
  let prev = null, pressed = false;

  function target(i) { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[i]); gl.viewport(0, 0, SW, SH); }

  function reset() {
    target(cur);
    gl.useProgram(init.p);
    gl.uniform1f(init.loc.aspect, SW / SH);
    gl.uniform1f(init.loc.seed, Math.random() * 100);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function build() {
    fitCanvas(canvas, Math.min(devicePixelRatio || 1, 1.5));
    SW = Math.max(2, Math.round(canvas.clientWidth / 2));
    SH = Math.max(2, Math.round(canvas.clientHeight / 2));
    tex.forEach((t) => gl.deleteTexture(t));
    fbo.forEach((f) => gl.deleteFramebuffer(f));
    tex = []; fbo = [];
    for (let i = 0; i < 2; i++) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt, SW, SH, 0, gl.RGBA, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      tex.push(t); fbo.push(f);
    }
    gl.bindVertexArray(vao);
    reset();
  }

  function toUV(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
  }
  canvas.addEventListener('pointerdown', (e) => { pressed = true; prev = toUV(e); });
  addEventListener('pointerup', () => { pressed = false; });

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (fitCanvas(canvas, Math.min(devicePixelRatio || 1, 1.5))) build();
    gl.bindVertexArray(vao);

    const r = canvas.getBoundingClientRect();
    const m = state.mouse;
    const inside = m.has && m.x >= r.left && m.x <= r.right && m.y >= r.top && m.y <= r.bottom;
    const uv = [(m.x - r.left) / r.width, 1 - (m.y - r.top) / r.height];
    const brush = inside && (now - m.lastMove < 120 || pressed);
    const p0 = brush && prev ? prev : uv;
    prev = inside ? uv : null;

    const P = PRESETS[preset];
    gl.useProgram(sim.p);
    gl.uniform2f(sim.loc.px, 1 / SW, 1 / SH);
    gl.uniform1f(sim.loc.F, P.F);
    gl.uniform1f(sim.loc.K, P.K);
    gl.uniform1f(sim.loc.aspect, SW / SH);
    gl.uniform1i(sim.loc.S, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (let i = 0; i < 12; i++) {
      gl.uniform1f(sim.loc.rad, i === 0 && brush ? (pressed ? .03 : .012) : 0);
      gl.uniform4f(sim.loc.seg, p0[0], p0[1], uv[0], uv[1]);
      gl.bindTexture(gl.TEXTURE_2D, tex[cur]);
      target(1 - cur);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = 1 - cur;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(show.p);
    gl.bindTexture(gl.TEXTURE_2D, tex[cur]);
    gl.uniform1i(show.loc.S, 0);
    gl.uniform2f(show.loc.px, 1 / SW, 1 / SH);
    gl.uniform3fv(show.loc.c1, P.c1);
    gl.uniform3fv(show.loc.c2, P.c2);
    gl.uniform1f(show.loc.energy, state.energy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  build();

  return {
    start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); },
    next() { preset = (preset + 1) % PRESETS.length; return PRESETS[preset].name; },
    reset,
  };
}
