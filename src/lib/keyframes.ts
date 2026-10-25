import type { AnimProp, Clip, Easing, Keyframe } from '../types';

export const ANIM_PROPS: { prop: AnimProp; label: string }[] = [
  { prop: 'x', label: 'Posición X' },
  { prop: 'y', label: 'Posición Y' },
  { prop: 'scale', label: 'Escala' },
  { prop: 'rotation', label: 'Rotación' },
  { prop: 'opacity', label: 'Opacidad' },
  { prop: 'volume', label: 'Volumen' },
];

export const EASINGS: { value: Easing; label: string }[] = [
  { value: 'linear', label: 'Lineal' },
  { value: 'inout', label: 'Suave' },
  { value: 'in', label: 'Acelerar' },
  { value: 'out', label: 'Frenar' },
  { value: 'hold', label: 'Mantener' },
];

export function ease(e: Easing, u: number) {
  switch (e) {
    case 'in':
      return u * u;
    case 'out':
      return 1 - (1 - u) * (1 - u);
    case 'inout':
      return u * u * (3 - 2 * u);
    case 'hold':
      return 0;
    default:
      return u;
  }
}

export const hasKeys = (c: Clip, p: AnimProp) => (c.keyframes?.[p]?.length ?? 0) > 0;

export function interp(kfs: Keyframe[], t: number) {
  if (t <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t < b.t) return a.v + (b.v - a.v) * ease(a.ease, (t - a.t) / Math.max(1e-6, b.t - a.t));
  }
  return last.v;
}

// Valor de una propiedad en el tiempo local del clip (segundos desde su inicio).
export function valueAt(c: Clip, p: AnimProp, local: number): number {
  const k = c.keyframes?.[p];
  return k && k.length ? interp(k, local) : (c[p] as number);
}

// Rango [min, max] que alcanza una propiedad (para dimensionar lienzos en la exportación).
export function propRange(c: Clip, p: AnimProp): [number, number] {
  const k = c.keyframes?.[p];
  if (!k || !k.length) return [c[p] as number, c[p] as number];
  const vs = k.map((x) => x.v);
  return [Math.min(...vs), Math.max(...vs)];
}

const num = (v: number) => Number(v.toFixed(6)).toString();

function easeExpr(e: Easing, u: string) {
  switch (e) {
    case 'in':
      return `(${u})*(${u})`;
    case 'out':
      return `(1-(1-(${u}))*(1-(${u})))`;
    case 'inout':
      return `(${u})*(${u})*(3-2*(${u}))`;
    case 'hold':
      return '0';
    default:
      return `(${u})`;
  }
}

// Expresión FFmpeg equivalente a interp(); tv es la variable de tiempo local (p. ej. "(t-3.5)").
export function ffExpr(kfs: Keyframe[], tv: string): string {
  if (kfs.length === 1) return num(kfs[0].v);
  let expr = num(kfs[kfs.length - 1].v);
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i];
    const b = kfs[i + 1];
    const u = `(${tv}-${num(a.t)})/${num(Math.max(1e-6, b.t - a.t))}`;
    const seg = `${num(a.v)}+${num(b.v - a.v)}*${easeExpr(a.ease, u)}`;
    expr = `if(lt(${tv},${num(b.t)}),${seg},${expr})`;
  }
  return `if(lt(${tv},${num(kfs[0].t)}),${num(kfs[0].v)},${expr})`;
}

export function setKey(c: Clip, p: AnimProp, t: number, v: number): Partial<Clip> {
  const list = [...(c.keyframes?.[p] || [])];
  const i = list.findIndex((k) => Math.abs(k.t - t) < 1 / 120);
  if (i >= 0) list[i] = { ...list[i], v };
  else list.push({ t, v, ease: 'inout' });
  list.sort((a, b) => a.t - b.t);
  return { keyframes: { ...c.keyframes, [p]: list } };
}

export function removeKey(c: Clip, p: AnimProp, t: number): Partial<Clip> {
  const list = (c.keyframes?.[p] || []).filter((k) => Math.abs(k.t - t) >= 1 / 120);
  const kf = { ...c.keyframes, [p]: list };
  if (!list.length) delete kf[p];
  return { keyframes: kf, ...(list.length ? {} : { [p]: valueAt(c, p, t) }) };
}

export const keyAt = (c: Clip, p: AnimProp, t: number) => c.keyframes?.[p]?.find((k) => Math.abs(k.t - t) < 1 / 120);

// Recoloca keyframes al recortar el inicio de un clip.
export function shiftKeys(c: Clip, delta: number): Clip['keyframes'] {
  if (!c.keyframes) return c.keyframes;
  const out: Clip['keyframes'] = {};
  for (const [p, list] of Object.entries(c.keyframes)) if (list) out[p as AnimProp] = list.map((k) => ({ ...k, t: k.t - delta }));
  return out;
}
