// Compositor de vista previa por GPU (WebGL2).
// Convención: en todas las texturas intermedias v=0 es la fila SUPERIOR de la imagen (como FFmpeg).
import type { Clip, ProjectSettings } from '../types';
import { bakeLut, hexToRgb, lutSizeFor, needsColorLut } from './color';
import { convKernel } from './effects';
import { TRANSITION_IDS } from './effects';

export interface LayerSource {
  el: TexImageSource;
  key: string; // identifica el contenido (para no re-subir imágenes estáticas)
  dynamic: boolean; // vídeo: subir cada fotograma
  w: number; // tamaño base en píxeles del proyecto (antes de la escala del clip)
  h: number;
}

export interface LayerState {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number; // opacidad * fundido
}

export function activeEffects(c: Clip) {
  const map = new Map<string, Record<string, number | string>>();
  for (const e of c.effects || []) if (e.enabled) map.set(e.type, e.params);
  if (c.blur > 0 && !map.has('blur')) map.set('blur', { sigma: c.blur });
  return map;
}

const VS = `#version 300 es
in vec2 aPos; in vec2 aUv; out vec2 uv;
void main(){ uv = aUv; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS_PRE = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o;
uniform sampler2D src; uniform sampler3D lut; uniform vec2 size; uniform vec2 flip;
uniform float useLut, lutN, grain, seed, lensOn, k1, k2, vigAngle, keyOn, keySim, keyBlend; uniform vec3 keyCol;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + seed) * 43758.5453); }
void main(){
  vec2 p = uv * size;
  vec2 q = uv;
  if (lensOn > 0.5) {
    vec2 c = size * 0.5; vec2 off = p - c;
    float r2 = dot(off, off) / ((size.x*size.x + size.y*size.y) * 0.25);
    float m = 1.0 + k1 * r2 + k2 * r2 * r2;
    q = (c + off * m) / size;
  }
  vec2 s = vec2(flip.x > 0.5 ? 1.0 - q.x : q.x, flip.y > 0.5 ? 1.0 - q.y : q.y);
  vec4 col = texture(src, s);
  if (lensOn > 0.5 && (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0)) col = vec4(0.0, 0.0, 0.0, 1.0);
  if (grain > 0.0) col.rgb += (rnd(floor(p)) - 0.5) * grain / 255.0 * 2.0;
  if (vigAngle > 0.0) {
    float d = length(floor(p) - floor(size * 0.5)) / length(size * 0.5);
    float f = d > 1.0 ? 0.0 : pow(cos(vigAngle * d), 4.0);
    col.rgb *= f;
  }
  col.rgb = clamp(col.rgb, 0.0, 1.0);
  if (keyOn > 0.5) {
    vec3 d = col.rgb * 255.0 - keyCol * 255.0;
    float diff = sqrt(dot(d, d) / (255.0 * 255.0 * 3.0));
    col.a = keyBlend > 0.0001 ? clamp((diff - keySim) / keyBlend, 0.0, 1.0) : (diff > keySim ? 1.0 : 0.0);
  }
  if (useLut > 0.5) col.rgb = texture(lut, col.rgb * ((lutN - 1.0) / lutN) + 0.5 / lutN).rgb;
  o = col;
}`;

const FS_POST = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src; uniform vec2 size;
uniform float pix, rgbs, convOn, convDiv; uniform float k[9]; uniform vec4 crop; // l r t b
vec4 at(vec2 p){ return texture(src, clamp(p, vec2(0.5), size - 0.5) / size); }
void main(){
  vec2 p = uv * size;
  vec4 col;
  if (pix > 1.0) {
    vec2 b0 = floor(floor(p) / pix) * pix; vec4 acc = vec4(0.0);
    for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) acc += at(b0 + (vec2(float(i), float(j)) + 0.5) * pix / 4.0);
    col = acc / 16.0;
  } else col = at(p);
  if (rgbs > 0.0) { col.r = at(p - vec2(rgbs, 0.0)).r; col.b = at(p + vec2(rgbs, 0.0)).b; }
  if (convOn > 0.5) {
    vec3 acc = vec3(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) acc += at(p + vec2(float(i), float(j))).rgb * k[(j + 1) * 3 + (i + 1)];
    col.rgb = clamp(acc / convDiv, 0.0, 1.0);
  }
  vec2 f = p / size;
  if (f.x < crop.x || f.x > 1.0 - crop.y || f.y < crop.z || f.y > 1.0 - crop.w) col = vec4(0.0);
  o = col;
}`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src; uniform vec2 size; uniform vec2 dir; uniform float sigma;
void main(){
  float r = min(ceil(sigma * 3.0), 60.0); float stepv = max(1.0, r / 30.0);
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (float i = -r; i <= r; i += stepv) {
    float w = exp(-0.5 * i * i / (sigma * sigma));
    acc += texture(src, clamp(uv * size + dir * i, vec2(0.5), size - 0.5) / size) * w; wsum += w;
  }
  o = acc / wsum;
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src; uniform float alpha;
void main(){ vec4 c = texture(src, uv); float a = c.a * alpha; o = vec4(c.rgb * a, a); }`;

const FS_FILL = `#version 300 es
precision highp float; out vec4 o; uniform vec4 color; void main(){ o = color; }`;

// Transiciones: traducción directa de libavfilter/vf_xfade.c (progress va de 1 a 0).
const FS_TRANS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D A; uniform sampler2D B; uniform vec2 size; uniform float p; uniform int mode;
const vec4 BLACK = vec4(0.0, 0.0, 0.0, 1.0); const vec4 WHITE = vec4(1.0);
vec4 fm(vec4 a, vec4 b, float m){ return a * m + b * (1.0 - m); }
vec4 ta(float x, float y){ return texture(A, (vec2(x, y) + 0.5) / size); }
vec4 tb(float x, float y){ return texture(B, (vec2(x, y) + 0.5) / size); }
float frand(float x, float y){ float r = sin(x * 12.9898 + y * 78.233) * 43758.545; return r - floor(r); }
float imod(float a, float b){ float r = a - b * trunc(a / b); return r + b * float(a < 0.0 && r != 0.0); }
void main(){
  float W = size.x, H = size.y;
  float x = floor(uv.x * W), y = floor(uv.y * H);
  vec4 a = ta(x, y), b = tb(x, y);
  float s;
  switch (mode) {
    case 0: o = fm(a, b, p); break;
    case 1: o = fm(fm(a, BLACK, smoothstep(0.8, 1.0, p)), fm(BLACK, b, smoothstep(0.2, 1.0, p)), p); break;
    case 2: o = fm(fm(a, WHITE, smoothstep(0.8, 1.0, p)), fm(WHITE, b, smoothstep(0.2, 1.0, p)), p); break;
    case 3: { vec4 ga = vec4(vec3((a.r + a.g + a.b) / 3.0), a.a); vec4 gb = vec4(vec3((b.r + b.g + b.b) / 3.0), b.a);
      o = fm(fm(a, ga, smoothstep(0.8, 1.0, p)), fm(gb, b, smoothstep(0.2, 1.0, p)), p); break; }
    case 4: s = frand(x, y) * 2.0 + p * 2.0 - 1.5; o = s >= 0.5 ? a : b; break;
    case 5: o = x > trunc(W * p) ? b : a; break;
    case 6: o = x > trunc(W * (1.0 - p)) ? a : b; break;
    case 7: o = y > trunc(H * p) ? b : a; break;
    case 8: o = y > trunc(H * (1.0 - p)) ? a : b; break;
    case 9: o = (y <= trunc(H * p) && x <= trunc(W * p)) ? a : b; break;
    case 10: o = (y <= trunc(H * p) && x > trunc(W * (1.0 - p))) ? a : b; break;
    case 11: o = (y > trunc(H * (1.0 - p)) && x <= trunc(W * p)) ? a : b; break;
    case 12: o = (y > trunc(H * (1.0 - p)) && x > trunc(W * (1.0 - p))) ? a : b; break;
    case 13: o = fm(b, a, smoothstep(0.0, 1.0, 1.0 + x / W - p * 2.0)); break;
    case 14: o = fm(b, a, smoothstep(0.0, 1.0, 1.0 + (W - 1.0 - x) / W - p * 2.0)); break;
    case 15: o = fm(b, a, smoothstep(0.0, 1.0, 1.0 + y / H - p * 2.0)); break;
    case 16: o = fm(b, a, smoothstep(0.0, 1.0, 1.0 + (H - 1.0 - y) / H - p * 2.0)); break;
    case 17: case 18: { float z = trunc((mode == 17 ? -p : p) * W); float zx = z + x; float zz = imod(zx, W);
      o = (zx >= 0.0 && zx < W) ? tb(zz, y) : ta(zz, y); break; }
    case 19: case 20: { float z = trunc((mode == 19 ? -p : p) * H); float zy = z + y; float zz = imod(zy, H);
      o = (zy >= 0.0 && zy < H) ? tb(x, zz) : ta(x, zz); break; }
    case 21: { float zf = smoothstep(0.5, 1.0, p); float u = 0.5 + (x / W - 0.5) * zf; float v = 0.5 + (y / H - 0.5) * zf;
      o = fm(ta(ceil(u * (W - 1.0)), ceil(v * (H - 1.0))), b, smoothstep(0.0, 0.5, p)); break; }
    case 22: { float z = 0.5 + (y / H - 0.5) / p; o = (z < 0.0 || z > 1.0) ? b : ta(x, floor(z * (H - 1.0) + 0.5)); break; }
    case 23: { float z = 0.5 + (x / W - 0.5) / p; o = (z < 0.0 || z > 1.0) ? b : ta(floor(z * (W - 1.0) + 0.5), y); break; }
    case 24: s = length(vec2(x - floor(W / 2.0), y - floor(H / 2.0))) / length(vec2(floor(W / 2.0), floor(H / 2.0))) + (p - 0.5) * 3.0;
      o = fm(a, b, smoothstep(0.0, 1.0, s)); break;
    case 25: s = length(vec2(x - floor(W / 2.0), y - floor(H / 2.0))) / length(vec2(floor(W / 2.0), floor(H / 2.0))) + (1.0 - p - 0.5) * 3.0;
      o = fm(b, a, smoothstep(0.0, 1.0, s)); break;
    case 26: { float z = pow(2.0 * abs(p - 0.5), 3.0) * length(vec2(floor(W / 2.0), floor(H / 2.0)));
      float d = length(vec2(x - floor(W / 2.0), y - floor(H / 2.0))); o = z < d ? BLACK : (p < 0.5 ? b : a); break; }
    case 27: { float zh = trunc(abs(p - 0.5) * H), zw = trunc(abs(p - 0.5) * W);
      bool inside = abs(x - floor(W / 2.0)) < zw && abs(y - floor(H / 2.0)) < zh; o = !inside ? BLACK : (p < 0.5 ? b : a); break; }
    case 28: o = fm(b, a, smoothstep(0.0, 1.0, 2.0 - abs((x - W / 2.0) / (W / 2.0)) - p * 2.0)); break;
    case 29: o = fm(b, a, smoothstep(0.0, 1.0, 1.0 + abs((x - W / 2.0) / (W / 2.0)) - p * 2.0)); break;
    case 30: o = fm(b, a, smoothstep(0.0, 1.0, 2.0 - abs((y - H / 2.0) / (H / 2.0)) - p * 2.0)); break;
    case 31: o = fm(b, a, smoothstep(0.0, 1.0, 1.0 + abs((y - H / 2.0) / (H / 2.0)) - p * 2.0)); break;
    case 32: o = fm(b, a, smoothstep(0.0, 1.0, 1.0 + x / W * y / H - p * 2.0)); break;
    case 33: o = fm(b, a, smoothstep(0.0, 1.0, 1.0 + (W - 1.0 - x) / W * y / H - p * 2.0)); break;
    case 34: o = fm(b, a, smoothstep(0.0, 1.0, 1.0 + x / W * (H - 1.0 - y) / H - p * 2.0)); break;
    case 35: o = fm(b, a, smoothstep(0.0, 1.0, 1.0 + (W - 1.0 - x) / W * (H - 1.0 - y) / H - p * 2.0)); break;
    case 36: s = atan(x - floor(W / 2.0), y - floor(H / 2.0)) - (p - 0.5) * (3.14159265 * 2.5); o = fm(b, a, smoothstep(0.0, 1.0, s)); break;
    case 37: case 38: case 39: case 40: {
      float t = mode == 37 ? x / W : mode == 38 ? (W - 1.0 - x) / W : mode == 39 ? y / H : (H - 1.0 - y) / H;
      float sm = smoothstep(-0.5, 0.0, t - p * 1.5); o = fm(b, a, sm <= fract(10.0 * t) ? 0.0 : 1.0); break; }
    case 41: { float d = min(p, 1.0 - p); float dist = ceil(d * 50.0) / 50.0; float sq = 2.0 * dist * min(W, H) / 20.0;
      float sx = dist > 0.0 ? min((floor(x / sq) + 0.5) * sq, W - 1.0) : x; float sy = dist > 0.0 ? min((floor(y / sq) + 0.5) * sq, H - 1.0) : y;
      o = fm(ta(trunc(sx), trunc(sy)), tb(trunc(sx), trunc(sy)), p); break; }
    case 42: { float prog = p <= 0.5 ? p * 2.0 : (1.0 - p) * 2.0; float sz = 1.0 + trunc(W / 2.0 * prog);
      vec4 s0 = vec4(0.0), s1 = vec4(0.0); for (int i = 0; i < 32; i++) { float xx = min(W - 1.0, x + floor((float(i) + 0.5) / 32.0 * sz)); s0 += ta(xx, y); s1 += tb(xx, y); }
      o = fm(s0 / 32.0, s1 / 32.0, p); break; }
    default: o = fm(a, b, p);
  }
}`;

const TRANS_MODE: Record<string, number> = {
  fade: 0, fadeblack: 1, fadewhite: 2, fadegrays: 3, dissolve: 4, wipeleft: 5, wiperight: 6, wipeup: 7, wipedown: 8,
  wipetl: 9, wipetr: 10, wipebl: 11, wipebr: 12, smoothleft: 13, smoothright: 14, smoothup: 15, smoothdown: 16,
  slideleft: 17, slideright: 18, slideup: 19, slidedown: 20, zoomin: 21, squeezeh: 22, squeezev: 23, circleopen: 24,
  circleclose: 25, circlecrop: 26, rectcrop: 27, vertopen: 28, vertclose: 29, horzopen: 30, horzclose: 31, diagtl: 32,
  diagtr: 33, diagbl: 34, diagbr: 35, radial: 36, hlslice: 37, hrslice: 38, vuslice: 39, vdslice: 40, pixelize: 41, hblur: 42,
};
if (TRANSITION_IDS.some((t) => !(t in TRANS_MODE))) console.warn('Transición sin shader');

interface Target {
  fbo: WebGLFramebuffer | null;
  tex: WebGLTexture | null;
  w: number;
  h: number;
}

export class Compositor {
  gl: WebGL2RenderingContext;
  private progs: Record<string, { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }> = {};
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private srcTex = new Map<string, { tex: WebGLTexture; key: string }>();
  private luts = new Map<string, { tex: WebGLTexture; key: string; n: number }>();
  private pool: Target[] = [];
  private seed = 0;

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL2 no disponible');
    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.progs.pre = this.program(FS_PRE);
    this.progs.post = this.program(FS_POST);
    this.progs.blur = this.program(FS_BLUR);
    this.progs.comp = this.program(FS_COMPOSITE);
    this.progs.fill = this.program(FS_FILL);
    this.progs.trans = this.program(FS_TRANS);
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  }

  private program(fs: string) {
    const gl = this.gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aUv');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const u: Record<string, WebGLUniformLocation | null> = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!;
      const name = info.name.replace('[0]', '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  private newTex(w: number, h: number, data: TexImageSource | null = null) {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
  }

  private target(w: number, h: number): Target {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const i = this.pool.findIndex((t) => t.w === w && t.h === h);
    if (i >= 0) return this.pool.splice(i, 1)[0];
    const gl = this.gl;
    const tex = this.newTex(w, h);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex, w, h };
  }
  private release(t: Target) {
    this.pool.push(t);
    if (this.pool.length > 24) {
      const old = this.pool.shift()!;
      this.gl.deleteTexture(old.tex);
      this.gl.deleteFramebuffer(old.fbo);
    }
  }

  // Dibuja un cuadrilátero; corners en píxeles del destino (y hacia abajo), en orden TL, TR, BL, BR.
  private quad(corners: number[][], tw: number, th: number, flipY: boolean) {
    const gl = this.gl;
    const uvs = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const data = new Float32Array(16);
    corners.forEach(([x, y], i) => {
      data[i * 4] = (x / tw) * 2 - 1;
      data[i * 4 + 1] = flipY ? 1 - (y / th) * 2 : (y / th) * 2 - 1;
      data[i * 4 + 2] = uvs[i][0];
      data[i * 4 + 3] = uvs[i][1];
    });
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  private full(t: Target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    this.quad([[0, 0], [t.w, 0], [0, t.h], [t.w, t.h]], t.w, t.h, false);
  }

  private sourceTexture(id: string, s: LayerSource) {
    const gl = this.gl;
    let e = this.srcTex.get(id);
    if (!e) {
      e = { tex: this.newTex(1, 1), key: '' };
      this.srcTex.set(id, e);
    }
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    if (s.dynamic || e.key !== s.key) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.el);
      e.key = s.key;
    }
    return e.tex;
  }

  private lutTexture(c: Clip) {
    const gl = this.gl;
    const key = JSON.stringify([c.grade, c.effects, c.brightness, c.contrast, c.saturation, c.hue]);
    let e = this.luts.get(c.id);
    if (e && e.key === key) return e;
    const n = lutSizeFor(c);
    const data = bakeLut(c, n);
    const rgba = new Float32Array(n * n * n * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      rgba[j] = data[i];
      rgba[j + 1] = data[i + 1];
      rgba[j + 2] = data[i + 2];
      rgba[j + 3] = 1;
    }
    const tex = e?.tex ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, n, n, n, 0, gl.RGBA, gl.FLOAT, rgba);
    e = { tex, key, n };
    this.luts.set(c.id, e);
    return e;
  }

  forget(ids: Set<string>) {
    for (const [id, e] of this.srcTex) if (!ids.has(id)) (this.gl.deleteTexture(e.tex), this.srcTex.delete(id));
    for (const [id, e] of this.luts) if (!ids.has(id.split(':')[0])) (this.gl.deleteTexture(e.tex), this.luts.delete(id));
  }

  begin(settings: ProjectSettings) {
    const gl = this.gl;
    this.seed = (this.seed + 1.618) % 100;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const [r, g, b] = hexToRgb(settings.background);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // Procesa el clip (color, croma, efectos) a su tamaño de salida y devuelve la textura resultante.
  private process(c: Clip, s: LayerSource, pw: number, ph: number, procScale: number): Target {
    const gl = this.gl;
    const fx = activeEffects(c);
    gl.disable(gl.BLEND);
    const src = this.sourceTexture(c.id, s);

    let cur = this.target(pw, ph);
    const pre = this.progs.pre;
    gl.useProgram(pre.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(pre.u.src, 0);
    const useLut = needsColorLut(c);
    // El sampler 3D siempre en la unidad 1: si compartiera la 0 con el 2D, WebGL rechaza el draw (capa en negro).
    gl.uniform1i(pre.u.lut, 1);
    if (useLut) {
      const l = this.lutTexture(c);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, l.tex);
      gl.uniform1f(pre.u.lutN, l.n);
    }
    gl.uniform1f(pre.u.useLut, useLut ? 1 : 0);
    gl.uniform2f(pre.u.size, cur.w, cur.h);
    gl.uniform2f(pre.u.flip, c.flipH ? 1 : 0, c.flipV ? 1 : 0);
    gl.uniform1f(pre.u.grain, fx.has('grain') ? Number(fx.get('grain')!.amount) : 0);
    gl.uniform1f(pre.u.seed, this.seed);
    const lens = fx.get('lens');
    gl.uniform1f(pre.u.lensOn, lens ? 1 : 0);
    gl.uniform1f(pre.u.k1, lens ? Number(lens.k1) : 0);
    gl.uniform1f(pre.u.k2, lens ? Number(lens.k2) : 0);
    gl.uniform1f(pre.u.vigAngle, fx.has('vignette') ? Number(fx.get('vignette')!.angle) : 0);
    const key = fx.get('chromakey');
    gl.uniform1f(pre.u.keyOn, key ? 1 : 0);
    if (key) {
      gl.uniform3fv(pre.u.keyCol, hexToRgb(String(key.color)));
      gl.uniform1f(pre.u.keySim, Number(key.similarity));
      gl.uniform1f(pre.u.keyBlend, Number(key.blend));
    }
    this.full(cur);

    const conv = ['sharpen', 'emboss', 'edges'].find((t) => fx.has(t));
    const crop = fx.get('crop');
    if (fx.has('pixelate') || fx.has('rgbsplit') || conv || crop) {
      const next = this.target(pw, ph);
      const post = this.progs.post;
      gl.useProgram(post.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cur.tex);
      gl.uniform1i(post.u.src, 0);
      gl.uniform2f(post.u.size, next.w, next.h);
      gl.uniform1f(post.u.pix, fx.has('pixelate') ? Math.max(1, Number(fx.get('pixelate')!.size) * procScale) : 0);
      gl.uniform1f(post.u.rgbs, fx.has('rgbsplit') ? Number(fx.get('rgbsplit')!.amount) * procScale : 0);
      const k = conv ? convKernel(conv, Number(fx.get(conv)!.amount ?? 0)) : null;
      gl.uniform1f(post.u.convOn, k ? 1 : 0);
      gl.uniform1f(post.u.convDiv, k ? k.div : 1);
      gl.uniform1fv(post.u.k, k ? k.m : new Array(9).fill(0));
      gl.uniform4f(post.u.crop, crop ? Number(crop.l) : 0, crop ? Number(crop.r) : 0, crop ? Number(crop.t) : 0, crop ? Number(crop.b) : 0);
      this.full(next);
      this.release(cur);
      cur = next;
    }

    const blur = fx.get('blur');
    if (blur && Number(blur.sigma) > 0) {
      const sigma = Number(blur.sigma) * procScale;
      const b = this.progs.blur;
      gl.useProgram(b.p);
      for (const dir of [[1, 0], [0, 1]]) {
        const next = this.target(pw, ph);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, cur.tex);
        gl.uniform1i(b.u.src, 0);
        gl.uniform2f(b.u.size, next.w, next.h);
        gl.uniform2f(b.u.dir, dir[0], dir[1]);
        gl.uniform1f(b.u.sigma, Math.max(0.3, sigma));
        this.full(next);
        this.release(cur);
        cur = next;
      }
    }
    return cur;
  }

  // Dibuja una capa ya procesada con su transformación sobre el destino (null = lienzo).
  drawLayer(c: Clip, s: LayerSource, st: LayerState, settings: ProjectSettings, maxScale: number, dest: Target | null = null) {
    const gl = this.gl;
    const ps = this.canvas.width / settings.width;
    const procScale = ps * maxScale; // FFmpeg procesa al tamaño de escala máxima
    const pw = s.w * procScale;
    const ph = s.h * procScale;
    if (pw < 1 || ph < 1 || st.opacity <= 0) return;
    const tex = this.process(c, s, pw, ph, procScale);

    const tw = dest ? dest.w : this.canvas.width;
    const th = dest ? dest.h : this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest ? dest.fbo : null);
    gl.viewport(0, 0, tw, th);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const comp = this.progs.comp;
    gl.useProgram(comp.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.uniform1i(comp.u.src, 0);
    gl.uniform1f(comp.u.alpha, st.opacity);
    const w = s.w * st.scale * ps;
    const h = s.h * st.scale * ps;
    const cx = (settings.width / 2 + st.x) * ps;
    const cy = (settings.height / 2 + st.y) * ps;
    const a = (st.rotation * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const pt = (dx: number, dy: number) => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    this.quad([pt(-w / 2, -h / 2), pt(w / 2, -h / 2), pt(-w / 2, h / 2), pt(w / 2, h / 2)], tw, th, !dest);
    this.release(tex);
  }

  // Transición entre dos capas: cada una se compone en un lienzo transparente completo y se mezclan.
  transition(type: string, progress: number, drawA: (t: Target) => void, drawB: (t: Target) => void) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    const ta = this.target(W, H);
    const tb = this.target(W, H);
    for (const t of [ta, tb]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    drawA(ta);
    drawB(tb);
    // Las capas se acumularon premultiplicadas; la mezcla xfade trabaja con canales planos.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const tr = this.progs.trans;
    gl.useProgram(tr.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ta.tex);
    gl.uniform1i(tr.u.A, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tb.tex);
    gl.uniform1i(tr.u.B, 1);
    gl.uniform2f(tr.u.size, W, H);
    gl.uniform1f(tr.u.p, Math.max(0, Math.min(1, progress)));
    gl.uniform1i(tr.u.mode, TRANS_MODE[type] ?? 0);
    this.quad([[0, 0], [W, 0], [0, H], [W, H]], W, H, true);
    this.release(ta);
    this.release(tb);
  }
}
