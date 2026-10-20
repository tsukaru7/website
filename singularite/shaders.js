// GLSL for the black hole.
//
// Units: Schwarzschild radius r_s = 1 (so M = 1/2). Photon sphere at 1.5,
// innermost stable circular orbit at 3.
//
// Each camera ray is a null geodesic. Its motion is planar, so instead of
// integrating x(t) in 3D we integrate the Binet equation in the orbital plane:
//
//     u'' + u = 3/2 u^2        with u = 1/r and ' = d/dphi
//
// with RK4 at fixed dphi. Crossings of the disk plane (y = 0) happen at angles
// known in closed form, so each crossing is found exactly and u is Hermite-
// interpolated there. Escape is handled analytically: far away the orbit is a
// straight line u = sin(phi_inf - phi) / b, which gives the exact asymptotic
// direction and the offset of the outgoing line (used to hit the text plane).

export const TRACE_FS = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;

uniform vec2 R;
uniform float T;
uniform vec3 camPos;
uniform mat3 camRot;
uniform float tanFov;
uniform float uCam;       // 1 / r_camera
uniform float dphi;       // integration step
uniform float doppler;    // 0 = cinema, 1 = physical
uniform float diskOn;
uniform float textOn;
uniform sampler2D bbLut;
uniform sampler2D textTex;

const float PI = 3.14159265;
const float RIN = 3.0;
const float ROUT = 15.0;
const int MAXSTEPS = 420;
const float TPEAK = 6200.0;

float hash13(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float v = 0., a = .5;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; v += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; }
  return v;
}

// Planck spectrum integrated against CIE 1931, normalised to luminance 1 (see blackbody.js)
vec3 blackbody(float t) {
  float x = (log(t) - log(800.)) / (log(60000.) - log(800.));
  return texture(bbLut, vec2(clamp(x, 0., 1.), .5)).rgb;
}

// ---------------------------------------------------------------- sky
vec3 sky(vec3 d, float shift) {
  vec3 gN = normalize(vec3(.32, 1., .5));
  float h = dot(d, gN);
  float band = exp(-h * h * 9.);
  float n = fbm(d * 3.2, 5);
  float dust = smoothstep(.42, .72, fbm(d * 6.5 + 3., 4)) * exp(-h * h * 40.);
  vec3 mw = mix(vec3(.18, .2, .34), vec3(1., .78, .55), smoothstep(.35, .75, n));
  vec3 col = mw * band * n * n * (1. - .85 * dust) * .22;
  vec3 core = normalize(vec3(-.7, .12, -.7));
  col += vec3(1., .7, .45) * pow(max(dot(d, core), 0.), 10.) * band * .15;

  for (int L = 0; L < 3; L++) {
    float K = 70. + float(L) * 75.;
    vec3 p = d * K;
    vec3 c = floor(p);
    vec3 r = hash33(c + float(L) * 31.7);
    if (r.x > .07 + .12 * band) continue;
    vec3 sp = c + .25 + .5 * hash33(c * 1.7 + 5.);
    float dd = length(p - sp);
    float br = .06 + 4. * pow(r.y, 10.);
    float temp = mix(2800., 16000., pow(r.z, 1.8)) * shift;
    col += blackbody(temp) * br * exp(-dd * dd * 26.);
  }
  // blueshift seen by an observer hovering deep in the well
  return col * min(pow(shift, 1.5), 5.);
}

// A giant plane of text far behind the hole, in world space.
vec3 textPlane(vec3 P0, vec3 D) {
  const float ZP = -42.;
  if (D.z > -1e-3) return vec3(0.);
  float s = (ZP - P0.z) / D.z;
  if (s < 0.) return vec3(0.);
  vec3 hp = P0 + D * s;
  vec2 q = vec2(hp.x / 84. + .5, hp.y / 42. + .5);
  if (q.x < 0. || q.y < 0. || q.x > 1. || q.y > 1.) return vec3(0.);
  vec2 a = texture(textTex, q).rg;   // r = letters, g = grid
  return vec3(1., .45, .6) * a.r * .17 + vec3(.25, .55, 1.) * a.g * .06;
}

// ---------------------------------------------------------------- disk
float density(float r, float a) {
  vec2 cs = vec2(cos(a), sin(a));
  float lr = log(r);
  float big = fbm(vec3(cs * 2.6, lr * 7.), 4);
  float streak = fbm(vec3(cs * 5., lr * 34.), 4);
  return big * .9 + streak * .75 - .25;
}

vec4 disk(vec3 pos, float r, vec3 ldir) {
  float ang = atan(pos.z, pos.x);
  float Om = sqrt(.5 / (r * r * r));          // Keplerian angular velocity
  // flow-map trick: two phases cross-faded, so differential rotation never winds up forever
  const float P = 60.;
  float t = T * 2.2;
  float t1 = mod(t, P), t2 = mod(t + P * .5, P);
  float wA = 1. - abs(2. * t1 / P - 1.);
  float dn = mix(density(r, ang + Om * t2), density(r, ang + Om * t1), wA);

  // thin-disk temperature profile, softened at the inner edge
  float x = r / RIN;
  float tn = pow(x, -.75) * pow(1. - .92 * inversesqrt(x), .25) / .54;

  // relativistic Doppler (orbital speed as seen by a static observer) x gravitational redshift
  float beta = sqrt(.5 / (r - 1.));
  float gam = inversesqrt(1. - beta * beta);
  vec3 vdir = normalize(vec3(-pos.z, 0., pos.x));
  float delta = 1. / (gam * (1. + beta * dot(vdir, ldir)));
  float grav = sqrt(1. - 1. / r) / sqrt(1. - uCam);
  float g = mix(grav, delta * grav, doppler);
  g = mix(1., g, .5 + .5 * doppler);

  float tObs = TPEAK * tn * g;
  float I = pow(tn * g, 4.);                  // bolometric intensity ~ T_obs^4
  float a = clamp(dn * 1.5, 0., 1.) * smoothstep(RIN, RIN + .6, r) * smoothstep(ROUT, ROUT - 6., r);
  vec3 c = blackbody(tObs) * I * (.35 + 1.4 * max(dn, 0.));
  return vec4(c * a * .8, a);
}

float hermite(float p0, float m0, float p1, float m1, float t) {
  float t2 = t * t, t3 = t2 * t;
  return (2. * t3 - 3. * t2 + 1.) * p0 + (t3 - 2. * t2 + t) * m0 + (-2. * t3 + 3. * t2) * p1 + (t3 - t2) * m1;
}

// ---------------------------------------------------------------- tracer
vec3 trace(vec3 ro, vec3 rd) {
  float r0 = length(ro);
  vec3 e1 = ro / r0;
  vec3 nrm = cross(e1, rd);
  float nl = length(nrm);
  if (nl < 1e-6) {
    if (dot(rd, e1) < 0.) return vec3(0.);
    nrm = normalize(cross(e1, abs(e1.y) < .9 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
  } else nrm /= nl;
  vec3 e2 = cross(nrm, e1);

  float shift = inversesqrt(1. - uCam);       // starlight blueshift at the camera
  float u = 1. / r0;
  float dr = dot(rd, e1), dt = max(dot(rd, e2), 1e-6);
  // local static-observer angle -> du/dphi
  float w = -u * sqrt(1. - u) * dr / dt;
  float b = inversesqrt(max(w * w + u * u - u * u * u, 1e-12));   // impact parameter (conserved)

  // the orbital plane meets y = 0 at phi = phc + k*pi
  float ca = e1.y, cb = e2.y;
  bool planar = abs(ca) + abs(cb) < 1e-6;
  float phc = atan(-ca, cb);
  if (phc <= 0.) phc += PI;

  vec3 col = vec3(0.);
  float trans = 1.;
  float phi = 0., h = dphi;

  for (int i = 0; i < MAXSTEPS; i++) {
    float k1u = w, k1w = -u + 1.5 * u * u;
    float u2 = u + .5 * h * k1u, w2 = w + .5 * h * k1w;
    float k2u = w2, k2w = -u2 + 1.5 * u2 * u2;
    float u3 = u + .5 * h * k2u, w3 = w + .5 * h * k2w;
    float k3u = w3, k3w = -u3 + 1.5 * u3 * u3;
    float u4 = u + h * k3u, w4 = w + h * k3w;
    float k4u = w4, k4w = -u4 + 1.5 * u4 * u4;
    float un = u + h / 6. * (k1u + 2. * k2u + 2. * k3u + k4u);
    float wn = w + h / 6. * (k1w + 2. * k2w + 2. * k3w + k4w);
    float phn = phi + h;

    if (!planar && phc <= phn) {
      float f = (phc - phi) / h;
      float uc = hermite(u, w * h, un, wn * h, f);
      if (diskOn > .5 && uc > 1. / ROUT && uc < 1. / RIN && trans > .01) {
        float rc = 1. / uc;
        float wc = mix(w, wn, f);
        vec3 er = cos(phc) * e1 + sin(phc) * e2;
        vec3 et = -sin(phc) * e1 + cos(phc) * e2;
        vec3 pos = er * rc;
        // photon direction in the local static frame
        vec3 ldir = normalize(er * (-wc / (uc * uc)) * inversesqrt(1. - uc) + et * rc);
        vec4 dc = disk(pos, rc, ldir);
        col += trans * dc.rgb;
        trans *= 1. - dc.a * .9;
      }
      phc += PI;
    }

    u = un; w = wn; phi = phn;

    if (u > 1. || (u > .667 && w > 0.)) return col;           // swallowed
    if (w < 0. && u < .04) {                                   // free: finish the straight line analytically
      float phiInf = phi + atan(u, -w);
      vec3 D = cos(phiInf) * e1 + sin(phiInf) * e2;
      vec3 P0 = b * (sin(phiInf) * e1 - cos(phiInf) * e2);
      vec3 bg = sky(D, shift);
      if (textOn > .5) bg += textPlane(P0, D) * min(shift, 3.);
      return col + trans * bg;
    }
  }
  return col;
}

void main() {
  vec2 p = uv * 2. - 1.;
  p.x *= R.x / R.y;
  vec3 rd = normalize(camRot * vec3(p * tanFov, 1.));
  vec3 col = trace(camPos, rd);
  o = vec4(min(col, vec3(200.)), 1.);
}`;

// 13-tap downsample (Jimenez, "Next generation post processing in Call of Duty")
export const DOWN_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D S;
uniform vec2 px;
vec3 c(vec2 d) { return texture(S, uv + d * px).rgb; }
void main() {
  vec3 r = c(vec2(0)) * .125
    + (c(vec2(-2, 2)) + c(vec2(2, 2)) + c(vec2(-2, -2)) + c(vec2(2, -2))) * .03125
    + (c(vec2(0, 2)) + c(vec2(-2, 0)) + c(vec2(2, 0)) + c(vec2(0, -2))) * .0625
    + (c(vec2(-1, 1)) + c(vec2(1, 1)) + c(vec2(-1, -1)) + c(vec2(1, -1))) * .125;
  o = vec4(r, 1.);
}`;

// 3x3 tent upsample, blended additively into the level above
export const UP_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D S;
uniform vec2 px;
vec3 c(vec2 d) { return texture(S, uv + d * px).rgb; }
void main() {
  vec3 s = c(vec2(-1, 1)) + c(vec2(1, 1)) + c(vec2(-1, -1)) + c(vec2(1, -1))
    + 2. * (c(vec2(0, 1)) + c(vec2(0, -1)) + c(vec2(1, 0)) + c(vec2(-1, 0)))
    + 4. * c(vec2(0));
  o = vec4(s / 16., 1.);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D S;
uniform sampler2D B;
uniform vec2 R;
uniform float T;
uniform float exposure;
uniform float bloom;
uniform float fade;       // 0 = black, 1 = visible
uniform float flash;
uniform vec4 wave;        // gravitational wave: xy centre (uv), z age (s), w strength

float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
vec3 tap(vec2 q) { return texture(S, q).rgb + texture(B, q).rgb * bloom; }

void main() {
  vec2 q = uv;
  if (wave.w > 0.) {
    vec2 d = q - wave.xy;
    d.x *= R.x / R.y;
    float L = length(d);
    float front = wave.z * .55;
    float env = exp(-pow(L - front, 2.) * 18.) * exp(-wave.z * .45);
    // quadrupolar strain: stretch one axis, squeeze the other
    float hstrain = sin(L * 48. - wave.z * 16.) * env * wave.w;
    q += vec2(d.x, -d.y) * hstrain * .06 + normalize(d + 1e-5) * hstrain * .004;
  }
  vec2 cc = q - .5;
  float k = .006 * dot(cc, cc);
  vec3 col = vec3(tap(q - cc * k).r, tap(q).g, tap(q + cc * k).b);
  col = aces(col * exposure);
  col = pow(col, vec3(1. / 2.2));
  col *= 1. - .55 * dot(cc, cc);
  col = col * fade + flash;
  col += (h12(gl_FragCoord.xy + fract(T) * 91.) - .5) / 128.;
  o = vec4(col, 1.);
}`;
