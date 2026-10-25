import type { Clip, CurvePoint, Grade } from '../types';
import { EFFECTS } from './effects';

export const defaultGrade = (): Grade => ({
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  saturation: 1,
  vibrance: 0,
  lift: { r: 0, g: 0, b: 0, m: 0 },
  gamma: { r: 1, g: 1, b: 1, m: 1 },
  gain: { r: 1, g: 1, b: 1, m: 1 },
  curves: { m: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] },
  hsl: { enabled: false, hue: 0, range: 60, softness: 30, hueShift: 0, sat: 1, lum: 0 },
  lutMix: 1,
});

const isIdentityCurve = (c: CurvePoint[]) => c.length === 2 && c[0][0] === 0 && c[0][1] === 0 && c[1][0] === 1 && c[1][1] === 1;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16) || 0;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// Interpolación cúbica monótona (Fritsch–Carlson) tabulada a 1024 valores.
export function curveTable(points: CurvePoint[], n = 1024): Float32Array {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(n);
  if (p.length < 2) {
    for (let i = 0; i < n; i++) out[i] = i / (n - 1);
    return out;
  }
  const k = p.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < k - 1; i++) {
    dx.push(Math.max(1e-6, p[i + 1][0] - p[i][0]));
    m.push((p[i + 1][1] - p[i][1]) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < k - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[k - 2]);
  for (let i = 0; i < k - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }
  let seg = 0;
  for (let j = 0; j < n; j++) {
    const x = j / (n - 1);
    if (x <= p[0][0]) {
      out[j] = p[0][1];
      continue;
    }
    if (x >= p[k - 1][0]) {
      out[j] = p[k - 1][1];
      continue;
    }
    while (seg < k - 2 && x > p[seg + 1][0]) seg++;
    const h = dx[seg];
    const u = (x - p[seg][0]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    out[j] = h00 * p[seg][1] + h10 * h * t[seg] + h01 * p[seg + 1][1] + h11 * h * t[seg + 1];
  }
  return out;
}

const lookup = (tab: Float32Array, v: number) => {
  const x = Math.max(0, Math.min(1, v)) * (tab.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return i >= tab.length - 1 ? tab[tab.length - 1] : tab[i] * (1 - f) + tab[i + 1] * f;
};
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

function sampleCube(lut: { size: number; data: number[] }, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size;
  const fx = clamp01(r) * (n - 1);
  const fy = clamp01(g) * (n - 1);
  const fz = clamp01(b) * (n - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  const x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1), z1 = Math.min(n - 1, z0 + 1);
  const dx = fx - x0, dy = fy - y0, dz = fz - z0;
  const at = (x: number, y: number, z: number, c: number) => lut.data[(x + y * n + z * n * n) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(x0, y0, z0, c) * (1 - dx) + at(x1, y0, z0, c) * dx;
    const c10 = at(x0, y1, z0, c) * (1 - dx) + at(x1, y1, z0, c) * dx;
    const c01 = at(x0, y0, z1, c) * (1 - dx) + at(x1, y0, z1, c) * dx;
    const c11 = at(x0, y1, z1, c) * (1 - dx) + at(x1, y1, z1, c) * dx;
    out[c] = (c00 * (1 - dy) + c10 * dy) * (1 - dz) + (c01 * (1 - dy) + c11 * dy) * dz;
  }
  return out;
}

const COLOR_EFFECTS = new Set(EFFECTS.filter((e) => e.kind === 'color').map((e) => e.type));

export function needsColorLut(c: Clip) {
  const g = c.grade;
  const legacy = c.brightness !== 0 || c.contrast !== 1 || c.saturation !== 1 || c.hue !== 0;
  const fx = (c.effects || []).some((e) => e.enabled && COLOR_EFFECTS.has(e.type));
  if (legacy || fx) return true;
  if (!g) return false;
  const d = defaultGrade();
  return JSON.stringify({ ...g, curves: undefined, lut: undefined }) !== JSON.stringify({ ...d, curves: undefined, lut: undefined }) ||
    !!g.lut || !(['m', 'r', 'g', 'b'] as const).every((k) => isIdentityCurve(g.curves[k]));
}

// Pipeline de color completo de un clip (valores 0..1). Se hornea en una LUT 3D compartida por vista previa y exportación.
export function makePipeline(c: Clip) {
  const g = c.grade ?? defaultGrade();
  const tabs = { m: curveTable(g.curves.m), r: curveTable(g.curves.r), g: curveTable(g.curves.g), b: curveTable(g.curves.b) };
  const fx = (c.effects || []).filter((e) => e.enabled && COLOR_EFFECTS.has(e.type));
  const hueRad = (c.hue * Math.PI) / 180;
  const cosH = Math.cos(hueRad), sinH = Math.sin(hueRad);
  const exp = Math.pow(2, g.exposure);
  const ch = ['r', 'g', 'b'] as const;

  return (r0: number, g0: number, b0: number): [number, number, number] => {
    let v: number[] = [r0, g0, b0];
    if (g.lut && g.lutMix > 0) {
      const l = sampleCube(g.lut, v[0], v[1], v[2]);
      v = v.map((x, i) => x + (l[i] - x) * g.lutMix);
    }
    // Ajustes rápidos (brillo/contraste/saturación/tono)
    if (c.brightness) v = v.map((x) => x + c.brightness);
    if (c.contrast !== 1) v = v.map((x) => (x - 0.5) * c.contrast + 0.5);
    if (c.saturation !== 1) {
      const L = luma(v[0], v[1], v[2]);
      v = v.map((x) => L + (x - L) * c.saturation);
    }
    if (c.hue) {
      // Rotación de tono en YIQ
      const Y = 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2];
      const I = 0.596 * v[0] - 0.274 * v[1] - 0.322 * v[2];
      const Q = 0.211 * v[0] - 0.523 * v[1] + 0.312 * v[2];
      const I2 = I * cosH - Q * sinH;
      const Q2 = I * sinH + Q * cosH;
      v = [Y + 0.956 * I2 + 0.621 * Q2, Y - 0.272 * I2 - 0.647 * Q2, Y - 1.106 * I2 + 1.703 * Q2];
    }
    // Básicos de la gradación
    if (exp !== 1) v = v.map((x) => x * exp);
    if (g.temperature || g.tint) {
      v[0] *= 1 + 0.2 * g.temperature;
      v[2] *= 1 - 0.2 * g.temperature;
      v[1] *= 1 - 0.15 * g.tint;
    }
    if (g.contrast) v = v.map((x) => (x - 0.5) * (1 + g.contrast) + 0.5);
    if (g.highlights || g.shadows || g.whites || g.blacks) {
      const L = clamp01(luma(v[0], v[1], v[2]));
      const d = g.highlights * 0.25 * smooth(0.45, 1, L) + g.shadows * 0.25 * (1 - smooth(0, 0.55, L)) + g.whites * 0.2 * L * L * L + g.blacks * 0.2 * (1 - L) ** 3;
      v = v.map((x) => x + d);
    }
    // Ruedas lift / gamma / gain
    v = v.map((x, i) => {
      const k = ch[i];
      const gain = g.gain[k] * g.gain.m;
      const lift = g.lift[k] + g.lift.m;
      const gam = g.gamma[k] * g.gamma.m;
      let y = x * gain;
      y = y + lift * (1 - y);
      return gam !== 1 ? Math.pow(Math.max(0, y), 1 / gam) : y;
    });
    if (g.saturation !== 1 || g.vibrance) {
      const L = luma(v[0], v[1], v[2]);
      const satNow = Math.max(v[0], v[1], v[2]) - Math.min(v[0], v[1], v[2]);
      const s = g.saturation * (1 + g.vibrance * (1 - clamp01(satNow * 2)));
      v = v.map((x) => L + (x - L) * s);
    }
    // Curvas
    v = v.map((x) => lookup(tabs.m, x));
    v = v.map((x, i) => lookup(tabs[ch[i]], x));
    // Secundaria HSL
    if (g.hsl.enabled) {
      let [h, s, l] = rgbToHsl(clamp01(v[0]), clamp01(v[1]), clamp01(v[2]));
      let d = Math.abs(h - g.hsl.hue) % 360;
      if (d > 180) d = 360 - d;
      const w = (1 - smooth(g.hsl.range / 2, g.hsl.range / 2 + Math.max(1, g.hsl.softness), d)) * smooth(0.04, 0.18, s);
      if (w > 0) {
        h += g.hsl.hueShift * w;
        s = clamp01(s * (1 + (g.hsl.sat - 1) * w));
        l = clamp01(l + g.hsl.lum * 0.5 * w);
        v = hslToRgb(h, s, l);
      }
    }
    // Efectos de color
    for (const e of fx) {
      const p = e.params;
      const L = luma(v[0], v[1], v[2]);
      switch (e.type) {
        case 'bw': {
          const a = Number(p.amount);
          v = v.map((x) => x + (L - x) * a);
          break;
        }
        case 'sepia': {
          const a = Number(p.amount);
          const s = [0.393 * v[0] + 0.769 * v[1] + 0.189 * v[2], 0.349 * v[0] + 0.686 * v[1] + 0.168 * v[2], 0.272 * v[0] + 0.534 * v[1] + 0.131 * v[2]];
          v = v.map((x, i) => x + (s[i] - x) * a);
          break;
        }
        case 'invert':
          v = v.map((x) => 1 - clamp01(x));
          break;
        case 'posterize': {
          const n = Math.max(2, Number(p.levels));
          v = v.map((x) => Math.round(clamp01(x) * (n - 1)) / (n - 1));
          break;
        }
        case 'threshold': {
          const t = L >= Number(p.level) ? 1 : 0;
          v = [t, t, t];
          break;
        }
        case 'solarize': {
          const t = Number(p.level);
          v = v.map((x) => (x > t ? 1 - x : x));
          break;
        }
        case 'duotone': {
          const a = hexToRgb(String(p.dark));
          const b = hexToRgb(String(p.light));
          const k = clamp01(L);
          v = a.map((x, i) => x + (b[i] - x) * k);
          break;
        }
        case 'tint': {
          const col = hexToRgb(String(p.color));
          const a = Number(p.amount);
          v = v.map((x, i) => x + (clamp01(L * col[i] * 1.6) - x) * a);
          break;
        }
        case 'gamma': {
          const gm = Number(p.value);
          v = v.map((x) => Math.pow(Math.max(0, x), 1 / gm));
          break;
        }
        case 'crossprocess':
          v = [clamp01(v[0] * 1.1 - 0.02) ** 0.9, clamp01(v[1] * 1.05) ** 1.05, clamp01(v[2] * 0.85 + 0.1)];
          break;
      }
    }
    return [clamp01(v[0]), clamp01(v[1]), clamp01(v[2])];
  };
}

export function lutSizeFor(c: Clip) {
  return (c.effects || []).some((e) => e.enabled && ['posterize', 'threshold', 'solarize'].includes(e.type)) ? 65 : 33;
}

// LUT 3D (r más rápido, luego g, luego b) como Float32Array RGB.
export function bakeLut(c: Clip, size = lutSizeFor(c)): Float32Array {
  const f = makePipeline(c);
  const out = new Float32Array(size * size * size * 3);
  let o = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const v = f(r / (size - 1), g / (size - 1), b / (size - 1));
        out[o++] = v[0];
        out[o++] = v[1];
        out[o++] = v[2];
      }
  return out;
}

export function lutToCube(data: Float32Array, size: number) {
  const lines = [`LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let i = 0; i < data.length; i += 3) lines.push(`${data[i].toFixed(5)} ${data[i + 1].toFixed(5)} ${data[i + 2].toFixed(5)}`);
  return lines.join('\n');
}

export function parseCube(text: string): { size: number; data: number[] } {
  let size = 0;
  const data: number[] = [];
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('LUT_3D_SIZE')) size = parseInt(line.split(/\s+/)[1], 10);
    else if (line.startsWith('DOMAIN_MIN')) min = line.split(/\s+/).slice(1).map(Number);
    else if (line.startsWith('DOMAIN_MAX')) max = line.split(/\s+/).slice(1).map(Number);
    else if (/^[-\d.]/.test(line)) {
      const v = line.split(/\s+/).map(Number);
      if (v.length >= 3) data.push(...v.slice(0, 3).map((x, i) => (x - min[i]) / (max[i] - min[i] || 1)));
    }
  }
  if (!size || data.length !== size * size * size * 3) throw new Error('Archivo .cube no válido (solo LUT 3D)');
  return { size, data };
}
