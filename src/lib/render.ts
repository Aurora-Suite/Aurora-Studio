import type { Clip, MediaItem, ProjectSettings, TextStyle, Track } from '../types';

export const FONTS = ['Inter Variable', 'system-ui', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Impact', 'Verdana', 'Trebuchet MS', 'Courier New'];

export function fitSize(media: Pick<MediaItem, 'width' | 'height'>, settings: ProjectSettings, scale: number) {
  const fit = Math.min(settings.width / (media.width || 1), settings.height / (media.height || 1)) * scale;
  return { w: media.width * fit, h: media.height * fit };
}

export function fadeAlpha(c: Clip, t: number) {
  const local = t - c.start;
  let a = 1;
  if (c.fadeIn > 0 && local < c.fadeIn) a = Math.min(a, local / c.fadeIn);
  if (c.fadeOut > 0 && local > c.duration - c.fadeOut) a = Math.min(a, (c.duration - local) / c.fadeOut);
  return Math.max(0, Math.min(1, a));
}

export function cssFilter(c: Clip, pxScale = 1) {
  const parts: string[] = [];
  if (c.brightness) parts.push(`brightness(${1 + c.brightness})`);
  if (c.contrast !== 1) parts.push(`contrast(${c.contrast})`);
  if (c.saturation !== 1) parts.push(`saturate(${c.saturation})`);
  if (c.hue) parts.push(`hue-rotate(${c.hue}deg)`);
  if (c.blur > 0) parts.push(`blur(${c.blur * pxScale}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

const fontString = (s: TextStyle) => `${s.italic ? 'italic ' : ''}${s.weight} ${s.size}px "${s.font}"`;

export function measureText(ctx: CanvasRenderingContext2D, s: TextStyle) {
  ctx.font = fontString(s);
  const lines = s.content.split('\n');
  const lineH = s.size * 1.2;
  const w = Math.max(1, ...lines.map((l) => ctx.measureText(l || ' ').width));
  const pad = s.background ? s.size * 0.35 : 0;
  return { lines, lineH, w: w + pad * 2, h: lines.length * lineH + pad * 2, textW: w, pad };
}

// Dibuja el texto centrado en el origen actual (ya trasladado/rotado).
export function drawTextAtOrigin(ctx: CanvasRenderingContext2D, s: TextStyle) {
  const m = measureText(ctx, s);
  ctx.textBaseline = 'middle';
  ctx.textAlign = s.align;
  if (s.background) {
    ctx.save();
    ctx.fillStyle = s.background;
    const r = s.size * 0.22;
    ctx.beginPath();
    ctx.roundRect(-m.w / 2, -m.h / 2, m.w, m.h, r);
    ctx.fill();
    ctx.restore();
  }
  const x = s.align === 'left' ? -m.textW / 2 : s.align === 'right' ? m.textW / 2 : 0;
  const top = -m.h / 2 + m.pad + m.lineH / 2;
  m.lines.forEach((line, i) => {
    const y = top + i * m.lineH;
    if (s.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = s.size * 0.18;
      ctx.shadowOffsetY = s.size * 0.05;
    }
    if (s.strokeWidth > 0) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = s.strokeColor;
      ctx.lineWidth = s.strokeWidth * 2;
      ctx.strokeText(line, x, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = s.color;
    ctx.fillText(line, x, y);
    ctx.shadowColor = 'transparent';
  });
}

export function applyTransform(ctx: CanvasRenderingContext2D, c: Clip, settings: ProjectSettings) {
  ctx.translate(settings.width / 2 + c.x, settings.height / 2 + c.y);
  if (c.rotation) ctx.rotate((c.rotation * Math.PI) / 180);
  ctx.scale(c.flipH ? -1 : 1, c.flipV ? -1 : 1);
}

// Caja del texto con margen para contorno y sombra (en píxeles del proyecto, escala 1).
export function textBox(s: TextStyle) {
  const ctx = scratch();
  const m = measureText(ctx, s);
  const pad = Math.ceil(s.strokeWidth * 2 + (s.shadow ? s.size * 0.3 : 0) + 2);
  return { w: Math.ceil(m.w + pad * 2), h: Math.ceil(m.h + pad * 2) };
}

let scratchCtx: CanvasRenderingContext2D | null = null;
const scratch = () => (scratchCtx ??= document.createElement('canvas').getContext('2d')!);

// Rasteriza el texto en un lienzo ajustado a su caja, a k píxeles por píxel del proyecto.
export function renderTextCanvas(s: TextStyle, k: number, canvas = document.createElement('canvas')) {
  const box = textBox(s);
  canvas.width = Math.max(2, Math.ceil(box.w * k));
  canvas.height = Math.max(2, Math.ceil(box.h * k));
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, (box.w * k) / 2, (box.h * k) / 2);
  drawTextAtOrigin(ctx, s);
  return { canvas, w: box.w, h: box.h };
}

export function clipBox(_ctx: CanvasRenderingContext2D, c: Clip, media: MediaItem | undefined, settings: ProjectSettings, scale = c.scale) {
  if (c.kind === 'text' && c.text) {
    const b = textBox(c.text);
    return { w: b.w * scale, h: b.h * scale };
  }
  if (media) return fitSize(media, settings, scale);
  return { w: 0, h: 0 };
}

// Capas visibles en t, de la más baja a la más alta.
export function layersAt(clips: Clip[], tracks: Track[], t: number) {
  const order = tracks.filter((tr) => tr.kind === 'video' && !tr.hidden).reverse();
  const out: Clip[] = [];
  for (const tr of order) {
    for (const c of clips) {
      if (c.trackId === tr.id && t >= c.start && t < c.start + c.duration) out.push(c);
    }
  }
  return out;
}

export function formatTime(t: number, fps = 30) {
  const sign = t < 0 ? '-' : '';
  t = Math.abs(t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * fps);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${sign}${h ? pad(h) + ':' : ''}${pad(m)}:${pad(s)}:${pad(f)}`;
}

export const LOOKS: { name: string; patch: Partial<Clip> }[] = [
  { name: 'Original', patch: { brightness: 0, contrast: 1, saturation: 1, hue: 0, blur: 0 } },
  { name: 'Vívido', patch: { brightness: 0.02, contrast: 1.12, saturation: 1.35, hue: 0 } },
  { name: 'Cine', patch: { brightness: -0.03, contrast: 1.2, saturation: 0.82, hue: -6 } },
  { name: 'Cálido', patch: { brightness: 0.03, contrast: 1.05, saturation: 1.15, hue: -12 } },
  { name: 'Frío', patch: { brightness: 0, contrast: 1.05, saturation: 0.95, hue: 14 } },
  { name: 'Mate', patch: { brightness: 0.06, contrast: 0.82, saturation: 0.85, hue: 0 } },
  { name: 'Noir', patch: { brightness: -0.02, contrast: 1.35, saturation: 0, hue: 0 } },
  { name: 'B/N suave', patch: { brightness: 0.03, contrast: 0.95, saturation: 0, hue: 0 } },
  { name: 'Pop', patch: { brightness: 0.04, contrast: 1.25, saturation: 1.6, hue: 0 } },
  { name: 'Vintage', patch: { brightness: 0.05, contrast: 0.9, saturation: 0.7, hue: -20 } },
  { name: 'Sueño', patch: { brightness: 0.08, contrast: 0.9, saturation: 1.1, hue: 0, blur: 1.5 } },
  { name: 'Nocturno', patch: { brightness: -0.1, contrast: 1.15, saturation: 0.8, hue: 25 } },
];
