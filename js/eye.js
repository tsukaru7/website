// Act I — a giant procedural eye. Analytic ray/sphere intersection, procedural
// iris, cornea highlights, eyelids and lashes, all in one fragment shader.

import { getGL, createProgram, fullscreenTriangle, fitCanvas, fallback } from './gl.js';
import { state } from './state.js';

const FS = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform vec2 R;
uniform float T;
uniform vec2 look;     // gaze direction, -1..1
uniform vec2 mouse;    // cursor, -1..1 (drives the light)
uniform float pupil;   // 1 = rest
uniform float lid;     // 0 open .. 1 closed
uniform float energy;  // audio
uniform float mode;    // konami

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0., a = .5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= .5; }
  return v;
}
vec3 hue(float h) { return .5 + .5 * cos(6.28318 * (h + vec3(0., .33, .67))); }
float lidCurve(float x, float w, float h) { float k = clamp(x / w, -1., 1.); return h * pow(1. - k * k, .85); }

void main() {
  vec2 fc = uv * R;
  vec2 p = (fc - .5 * R) / R.y;
  float asp = R.x / R.y;
  if (asp < 1.35) p *= 1.35 / asp;            // portrait: shrink the eye to fit
  p = p * 1.18 - vec2(0., .07);                 // a bit smaller, a bit higher than the title
  float t = T;

  // --- living nebula around the eye
  vec2 q = p * 1.6;
  vec2 w = vec2(fbm(q * 1.3 + vec2(t * .03, -t * .02)), fbm(q * 1.3 + vec2(5.2, 1.3) - t * .025));
  float f = fbm(q + 2.5 * w + vec2(0., t * .02));
  vec3 col = mix(vec3(.01, 0., .025), vec3(.3, .03, .34), f * f * 1.4);
  col += vec3(0., .18, .25) * pow(w.y, 3.) * 1.3;
  col += hue(.85 + f * .3) * .12 * energy * f;
  col *= smoothstep(1.7, .1, length(p));

  // --- eyelid opening (almond)
  float W = .62, H = .3 * (1. - lid);
  float hy = lidCurve(p.x, W, H);
  float d = max(abs(p.y) - hy, abs(p.x) - W);  // < 0 inside

  float rim = exp(-max(d, 0.) * 26.) * smoothstep(W + .08, W - .2, abs(p.x));
  col += vec3(1., .33, .55) * rim * .4 * (1. + 1.5 * energy);

  float s = p.y - hy;                          // height above the upper lid
  if (p.y > 0. && s > 0. && abs(p.x) < W) {
    float ax = p.x + s * p.x * 2.2;            // lashes fan outward
    float len = .075 * (1. - .7 * abs(p.x / W)) * (1. - lid * .5);
    float lash = smoothstep(.7, 1., sin(ax * 115.)) * (1. - smoothstep(0., len, s));
    col = mix(col, vec3(0.), lash * .95);
  }

  if (d < .01) {
    vec3 ro = vec3(0., 0., 3.2);
    vec3 rd = normalize(vec3(p, -1.9));
    float b = dot(ro, rd), c = dot(ro, ro) - 1., disc = b * b - c;
    vec3 eye = vec3(0.);
    if (disc > 0.) {
      vec3 pos = ro + rd * (-b - sqrt(disc));
      vec3 n = normalize(pos);

      // eye-local frame looking toward the gaze
      vec3 fz = normalize(vec3(look.x * .75, look.y * .55, 1.));
      vec3 fx = normalize(cross(vec3(0., 1., 0.), fz));
      vec3 fy = cross(fz, fx);
      vec3 l = vec3(dot(n, fx), dot(n, fy), dot(n, fz));
      float th = acos(clamp(l.z, -1., 1.));
      float ang = atan(l.y, l.x);
      vec2 dir = vec2(cos(ang), sin(ang));

      // sclera with veins
      vec3 scl = vec3(.93, .89, .87);
      float vn = fbm(l.xy * 4. + l.z * 2. + 7.);
      float vein = (1. - smoothstep(0., .03, abs(vn - .5))) * smoothstep(.55, 1.4, th);
      scl = mix(scl, vec3(.72, .08, .1), vein * .85);
      scl = mix(scl, vec3(.86, .6, .62), smoothstep(.6, 1.6, th) * .45);

      // iris
      float IR = .36;
      float r = th / IR;
      float pr = .12 * pupil / IR;
      if (mode > .5) ang += r * 6. - t * 2.;   // hypnotic swirl
      dir = vec2(cos(ang), sin(ang));
      float fib = fbm(dir * 18. + vec2(r * 1.2, -r * .7));
      float fib2 = noise(dir * 60. + r * 3.);
      vec3 inner = vec3(.98, .64, .18);
      vec3 outer = mix(vec3(.04, .42, .56), hue(t * .08), mode);
      outer = mix(outer, vec3(.55, .1, .5), .25 + .25 * sin(t * .15));
      vec3 iris = mix(inner, outer, smoothstep(.22, .8, r));
      iris *= .35 + 1.15 * fib * (.6 + .6 * fib2);
      iris *= 1. - .5 * smoothstep(.55, .7, noise(dir * 9. + r * 5.)) * smoothstep(.3, .5, r) * smoothstep(.95, .7, r);
      iris *= 1. - .88 * smoothstep(.8, 1., r);   // limbal ring
      float pm = smoothstep(pr + .02, pr - .01, r);
      iris += vec3(1., .5, .2) * smoothstep(pr + .1, pr, r) * (1. - pm) * .4 * (.4 + 1.5 * energy);
      iris = mix(iris, vec3(0.), pm);
      float im = smoothstep(1.02, .98, r);
      vec3 base = mix(scl, iris, im);

      // light comes from the cursor
      vec3 L = normalize(vec3(mouse.x * 1.6, mouse.y * 1.2, 1.6));
      float dif = max(dot(n, L), 0.) * .75 + .3;
      vec3 nc = normalize(n + fz * .35 * smoothstep(1.3, 0., r));   // cornea bulge
      vec3 rf = reflect(rd, nc);
      float sp = pow(max(dot(rf, L), 0.), 90.) * 1.5;
      vec2 dv = rf.xy / max(rf.z, .05) - L.xy / L.z;            // window reflection
      float win = smoothstep(.13, .12, abs(dv.x)) * smoothstep(.1, .09, abs(dv.y))
                * smoothstep(.01, .02, abs(dv.x)) * smoothstep(.01, .02, abs(dv.y));
      eye = base * dif + sp + win * .22 * smoothstep(1.3, .9, r) * step(0., rf.z);
      eye *= .25 + .75 * smoothstep(0., .1, -d);                // occlusion by the lids
    }
    col = mix(col, eye, smoothstep(.003, -.003, d));
  }

  col += (h21(fc + fract(t) * 100.) - .5) * .045;                // film grain
  o = vec4(col, 1.);
}`;

export function initEye(canvas, { onBlink } = {}) {
  const gl = getGL(canvas);
  if (!gl) { fallback(canvas, "Ton navigateur ne voit pas en WebGL2. Moi, si."); return null; }
  let prog;
  try { prog = createProgram(gl, FS); } catch (e) { console.error(e); fallback(canvas, "L'œil n'a pas pu s'ouvrir."); return null; }
  const vao = fullscreenTriangle(gl);

  const look = { x: 0, y: 0 }, target = { x: 0, y: 0 };
  let lidBase = .96, lidBaseTarget = .96, lid = .96, pupil = 1, surprise = 0;
  let blinkStart = -1, nextBlink = performance.now() + 4000;
  let opened = false, running = false, raf = 0, last = performance.now();
  let saccadeAt = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000);
    last = now;

    fitCanvas(canvas, Math.min(devicePixelRatio || 1, 1.5));
    const rect = canvas.getBoundingClientRect();
    const m = state.mouse;
    const mx = (m.x - rect.left - rect.width / 2) / (rect.width / 2);
    const my = -(m.y - rect.top - rect.height / 2) / (rect.height / 2);
    const idle = now - m.lastMove > 9000;

    // gaze: saccades toward the cursor, lazy wandering when idle
    if (!idle) { target.x = Math.max(-1.2, Math.min(1.2, mx)); target.y = Math.max(-1.2, Math.min(1.2, my)); }
    else if (now > saccadeAt) { target.x = (Math.random() * 2 - 1) * .8; target.y = (Math.random() * 2 - 1) * .5; saccadeAt = now + 900 + Math.random() * 2200; }
    const k = 1 - Math.exp(-dt * (idle ? 6 : 20));
    look.x += (target.x - look.x) * k;
    look.y += (target.y - look.y) * k;

    // eyelids: sleepy when ignored, random blinks
    if (opened) lidBaseTarget = idle ? .55 : 0;
    lidBase += (lidBaseTarget - lidBase) * (1 - Math.exp(-dt * (opened && lidBase > .5 && !idle ? 1.1 : 3)));
    if (opened && now > nextBlink) {
      blinkStart = now;
      nextBlink = now + 2200 + Math.random() * 5000;
      state.stats.blinks++;
      onBlink?.();
    }
    const bt = (now - blinkStart) / 190;
    const blink = blinkStart > 0 && bt < 1 ? Math.sin(Math.PI * bt) : 0;
    lid = Math.max(lidBase, blink);

    // pupil: contracts on fast moves and surprise, dilates with sound
    surprise *= Math.exp(-dt * 1.5);
    const pt = 1 + state.energy * .9 - Math.min(m.speed / 2500, .45) - surprise * .55 + (idle ? .25 : 0);
    pupil += (pt - pupil) * (1 - Math.exp(-dt * 4));

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog.p);
    const u = prog.loc;
    gl.uniform2f(u.R, canvas.width, canvas.height);
    gl.uniform1f(u.T, now / 1000);
    gl.uniform2f(u.look, look.x, look.y);
    gl.uniform2f(u.mouse, mx, my);
    gl.uniform1f(u.pupil, Math.max(.35, pupil));
    gl.uniform1f(u.lid, lid);
    gl.uniform1f(u.energy, state.energy);
    gl.uniform1f(u.mode, state.konami ? 1 : 0);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    start() { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); },
    open() { opened = true; nextBlink = performance.now() + 2600; },
    startle() { surprise = 1; blinkStart = performance.now(); },
  };
}
