// WebGL2 pipeline: relativistic ray tracer -> HDR target -> bloom mip chain
// (downsample / additive upsample) -> composite (ACES, aberration, GW ripple).

import { getGL, createProgram, fullscreenTriangle } from '../js/gl.js';
import { TRACE_FS, DOWN_FS, UP_FS, COMPOSITE_FS } from './shaders.js';
import { blackbodyLUT } from './blackbody.js';

const LEVELS = 6;

export class Renderer {
  constructor(canvas) {
    const gl = getGL(canvas);
    if (!gl) throw new Error('webgl2');
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) throw new Error('float targets');
    this.gl = gl;
    this.canvas = canvas;
    this.vao = fullscreenTriangle(gl);
    this.trace = createProgram(gl, TRACE_FS);
    this.down = createProgram(gl, DOWN_FS);
    this.up = createProgram(gl, UP_FS);
    this.comp = createProgram(gl, COMPOSITE_FS);
    this.levels = [];
    this.lut = this.texture(256, 1, blackbodyLUT(256));
    this.text = null;
    this.w = this.h = 0;
  }

  texture(w, h, data = null) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  setText(canvas2d) {
    const gl = this.gl;
    if (!this.text) this.text = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.text);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // Ray-tracing resolution (w, h); bloom levels halve from there.
  resize(w, h) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.levels.forEach((l) => { gl.deleteTexture(l.tex); gl.deleteFramebuffer(l.fbo); });
    this.levels = [];
    this.w = w; this.h = h;
    for (let i = 0; i < LEVELS; i++) {
      const lw = Math.max(1, w >> i), lh = Math.max(1, h >> i);
      const tex = this.texture(lw, lh);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.levels.push({ tex, fbo, w: lw, h: lh });
    }
  }

  bindTex(unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  render(p) {
    const gl = this.gl, L = this.levels;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    // 1. trace
    gl.bindFramebuffer(gl.FRAMEBUFFER, L[0].fbo);
    gl.viewport(0, 0, L[0].w, L[0].h);
    const t = this.trace, u = t.loc;
    gl.useProgram(t.p);
    gl.uniform2f(u.R, L[0].w, L[0].h);
    gl.uniform1f(u.T, p.time);
    gl.uniform3fv(u.camPos, p.camPos);
    gl.uniformMatrix3fv(u.camRot, false, p.camRot);
    gl.uniform1f(u.tanFov, Math.tan(p.fov / 2));
    gl.uniform1f(u.uCam, 1 / Math.hypot(...p.camPos));
    gl.uniform1f(u.dphi, p.dphi);
    gl.uniform1f(u.doppler, p.doppler);
    gl.uniform1f(u.diskOn, 1);
    gl.uniform1f(u.textOn, this.text ? 1 : 0);
    this.bindTex(0, this.lut);
    gl.uniform1i(u.bbLut, 0);
    this.bindTex(1, this.text);
    gl.uniform1i(u.textTex, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. bloom: down the chain...
    gl.useProgram(this.down.p);
    gl.uniform1i(this.down.loc.S, 0);
    for (let i = 1; i < L.length; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, L[i].fbo);
      gl.viewport(0, 0, L[i].w, L[i].h);
      this.bindTex(0, L[i - 1].tex);
      gl.uniform2f(this.down.loc.px, 1 / L[i - 1].w, 1 / L[i - 1].h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // ...and back up, accumulating
    gl.useProgram(this.up.p);
    gl.uniform1i(this.up.loc.S, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = L.length - 1; i > 1; i--) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, L[i - 1].fbo);
      gl.viewport(0, 0, L[i - 1].w, L[i - 1].h);
      this.bindTex(0, L[i].tex);
      gl.uniform2f(this.up.loc.px, 1 / L[i].w, 1 / L[i].h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    // 3. composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const c = this.comp, cu = c.loc;
    gl.useProgram(c.p);
    this.bindTex(0, L[0].tex);
    this.bindTex(1, L[1].tex);
    gl.uniform1i(cu.S, 0);
    gl.uniform1i(cu.B, 1);
    gl.uniform2f(cu.R, this.canvas.width, this.canvas.height);
    gl.uniform1f(cu.T, p.time);
    gl.uniform1f(cu.exposure, p.exposure);
    gl.uniform1f(cu.bloom, p.bloom);
    gl.uniform1f(cu.fade, p.fade);
    gl.uniform1f(cu.flash, p.flash);
    gl.uniform4fv(cu.wave, p.wave);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
