// Catálogo de efectos. kind:
//  - color:   se hornea en la LUT 3D (idéntico en vista previa y exportación)
//  - spatial: shader WebGL en vista previa + filtro FFmpeg equivalente en exportación
//  - render:  solo se aplica al exportar (FFmpeg), p. ej. reducción de ruido o estabilización
export interface ParamDef {
  key: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  def: number | string;
  type?: 'color';
  unit?: string;
}
export interface EffectDef {
  type: string;
  name: string;
  category: 'Color' | 'Estilizar' | 'Desenfoque y nitidez' | 'Distorsión' | 'Croma' | 'Reparar';
  kind: 'color' | 'spatial' | 'render';
  params: ParamDef[];
}

export const EFFECTS: EffectDef[] = [
  // Color
  { type: 'bw', name: 'Blanco y negro', category: 'Color', kind: 'color', params: [{ key: 'amount', label: 'Intensidad', min: 0, max: 1, step: 0.01, def: 1 }] },
  { type: 'sepia', name: 'Sepia', category: 'Color', kind: 'color', params: [{ key: 'amount', label: 'Intensidad', min: 0, max: 1, step: 0.01, def: 1 }] },
  { type: 'invert', name: 'Invertir', category: 'Color', kind: 'color', params: [] },
  { type: 'duotone', name: 'Duotono', category: 'Color', kind: 'color', params: [{ key: 'dark', label: 'Sombras', def: '#1b1464', type: 'color' }, { key: 'light', label: 'Luces', def: '#ffcc66', type: 'color' }] },
  { type: 'tint', name: 'Teñir', category: 'Color', kind: 'color', params: [{ key: 'color', label: 'Color', def: '#4aa3ff', type: 'color' }, { key: 'amount', label: 'Intensidad', min: 0, max: 1, step: 0.01, def: 0.5 }] },
  { type: 'gamma', name: 'Gamma', category: 'Color', kind: 'color', params: [{ key: 'value', label: 'Gamma', min: 0.2, max: 3, step: 0.01, def: 1.2 }] },
  { type: 'crossprocess', name: 'Proceso cruzado', category: 'Color', kind: 'color', params: [] },
  { type: 'posterize', name: 'Posterizar', category: 'Estilizar', kind: 'color', params: [{ key: 'levels', label: 'Niveles', min: 2, max: 16, step: 1, def: 5 }] },
  { type: 'threshold', name: 'Umbral', category: 'Estilizar', kind: 'color', params: [{ key: 'level', label: 'Nivel', min: 0, max: 1, step: 0.01, def: 0.5 }] },
  { type: 'solarize', name: 'Solarizar', category: 'Estilizar', kind: 'color', params: [{ key: 'level', label: 'Nivel', min: 0, max: 1, step: 0.01, def: 0.5 }] },
  // Espaciales
  { type: 'vignette', name: 'Viñeta', category: 'Estilizar', kind: 'spatial', params: [{ key: 'angle', label: 'Intensidad', min: 0.05, max: 1.57, step: 0.01, def: 0.63 }] },
  { type: 'grain', name: 'Grano de película', category: 'Estilizar', kind: 'spatial', params: [{ key: 'amount', label: 'Cantidad', min: 1, max: 60, step: 1, def: 14 }] },
  { type: 'pixelate', name: 'Pixelar / mosaico', category: 'Estilizar', kind: 'spatial', params: [{ key: 'size', label: 'Tamaño', min: 2, max: 120, step: 1, def: 16, unit: ' px' }] },
  { type: 'rgbsplit', name: 'Separación RGB', category: 'Estilizar', kind: 'spatial', params: [{ key: 'amount', label: 'Desplazamiento', min: 1, max: 60, step: 1, def: 8, unit: ' px' }] },
  { type: 'emboss', name: 'Relieve', category: 'Estilizar', kind: 'spatial', params: [] },
  { type: 'edges', name: 'Detectar bordes', category: 'Estilizar', kind: 'spatial', params: [] },
  { type: 'blur', name: 'Desenfoque gaussiano', category: 'Desenfoque y nitidez', kind: 'spatial', params: [{ key: 'sigma', label: 'Radio', min: 0.5, max: 60, step: 0.5, def: 6 }] },
  { type: 'sharpen', name: 'Enfocar', category: 'Desenfoque y nitidez', kind: 'spatial', params: [{ key: 'amount', label: 'Cantidad', min: 0.1, max: 3, step: 0.1, def: 0.6 }] },
  { type: 'lens', name: 'Distorsión de lente', category: 'Distorsión', kind: 'spatial', params: [{ key: 'k1', label: 'Barril / cojín', min: -1, max: 1, step: 0.01, def: -0.25 }, { key: 'k2', label: 'Orden 2', min: -1, max: 1, step: 0.01, def: 0 }] },
  { type: 'crop', name: 'Recortar', category: 'Distorsión', kind: 'spatial', params: [{ key: 'l', label: 'Izquierda', min: 0, max: 0.49, step: 0.005, def: 0.1 }, { key: 'r', label: 'Derecha', min: 0, max: 0.49, step: 0.005, def: 0.1 }, { key: 't', label: 'Arriba', min: 0, max: 0.49, step: 0.005, def: 0 }, { key: 'b', label: 'Abajo', min: 0, max: 0.49, step: 0.005, def: 0 }] },
  { type: 'chromakey', name: 'Croma (pantalla verde)', category: 'Croma', kind: 'spatial', params: [{ key: 'color', label: 'Color clave', def: '#00ff00', type: 'color' }, { key: 'similarity', label: 'Similitud', min: 0.01, max: 1, step: 0.01, def: 0.3 }, { key: 'blend', label: 'Suavizado', min: 0, max: 1, step: 0.01, def: 0.1 }] },
  // Solo render
  { type: 'denoise', name: 'Reducción de ruido', category: 'Reparar', kind: 'render', params: [{ key: 'strength', label: 'Intensidad', min: 1, max: 20, step: 0.5, def: 4 }] },
  { type: 'stabilize', name: 'Estabilizar', category: 'Reparar', kind: 'render', params: [{ key: 'range', label: 'Rango', min: 8, max: 64, step: 1, def: 16, unit: ' px' }] },
];

export const effectDef = (type: string) => EFFECTS.find((e) => e.type === type);

export function defaultParams(type: string) {
  const d = effectDef(type);
  return Object.fromEntries((d?.params || []).map((p) => [p.key, p.def]));
}

// Núcleos 3x3 enteros (mismos valores en el shader y en el filtro convolution de FFmpeg).
export function convKernel(type: string, amount = 0): { m: number[]; div: number } | null {
  if (type === 'sharpen') {
    const a = Math.round(amount * 10);
    return { m: [0, -a, 0, -a, 10 + 4 * a, -a, 0, -a, 0], div: 10 };
  }
  if (type === 'emboss') return { m: [-2, -1, 0, -1, 1, 1, 0, 1, 2], div: 1 };
  if (type === 'edges') return { m: [-1, -1, -1, -1, 8, -1, -1, -1, -1], div: 1 };
  return null;
}

// Transiciones: nombres idénticos a los del filtro xfade de FFmpeg.
export const TRANSITIONS: { type: string; name: string; group: string }[] = [
  { type: 'fade', name: 'Fundido cruzado', group: 'Fundidos' },
  { type: 'fadeblack', name: 'Fundido a negro', group: 'Fundidos' },
  { type: 'fadewhite', name: 'Fundido a blanco', group: 'Fundidos' },
  { type: 'fadegrays', name: 'Fundido a grises', group: 'Fundidos' },
  { type: 'dissolve', name: 'Disolver', group: 'Fundidos' },
  { type: 'wipeleft', name: 'Barrido izquierda', group: 'Barridos' },
  { type: 'wiperight', name: 'Barrido derecha', group: 'Barridos' },
  { type: 'wipeup', name: 'Barrido arriba', group: 'Barridos' },
  { type: 'wipedown', name: 'Barrido abajo', group: 'Barridos' },
  { type: 'wipetl', name: 'Barrido sup. izq.', group: 'Barridos' },
  { type: 'wipetr', name: 'Barrido sup. der.', group: 'Barridos' },
  { type: 'wipebl', name: 'Barrido inf. izq.', group: 'Barridos' },
  { type: 'wipebr', name: 'Barrido inf. der.', group: 'Barridos' },
  { type: 'smoothleft', name: 'Barrido suave izq.', group: 'Barridos' },
  { type: 'smoothright', name: 'Barrido suave der.', group: 'Barridos' },
  { type: 'smoothup', name: 'Barrido suave arriba', group: 'Barridos' },
  { type: 'smoothdown', name: 'Barrido suave abajo', group: 'Barridos' },
  { type: 'slideleft', name: 'Deslizar izquierda', group: 'Movimiento' },
  { type: 'slideright', name: 'Deslizar derecha', group: 'Movimiento' },
  { type: 'slideup', name: 'Deslizar arriba', group: 'Movimiento' },
  { type: 'slidedown', name: 'Deslizar abajo', group: 'Movimiento' },
  { type: 'zoomin', name: 'Zoom de entrada', group: 'Movimiento' },
  { type: 'squeezeh', name: 'Comprimir horizontal', group: 'Movimiento' },
  { type: 'squeezev', name: 'Comprimir vertical', group: 'Movimiento' },
  { type: 'circleopen', name: 'Círculo abrir', group: 'Formas' },
  { type: 'circleclose', name: 'Círculo cerrar', group: 'Formas' },
  { type: 'circlecrop', name: 'Iris', group: 'Formas' },
  { type: 'rectcrop', name: 'Rectángulo', group: 'Formas' },
  { type: 'vertopen', name: 'Puertas abrir (V)', group: 'Formas' },
  { type: 'vertclose', name: 'Puertas cerrar (V)', group: 'Formas' },
  { type: 'horzopen', name: 'Puertas abrir (H)', group: 'Formas' },
  { type: 'horzclose', name: 'Puertas cerrar (H)', group: 'Formas' },
  { type: 'diagtl', name: 'Diagonal sup. izq.', group: 'Formas' },
  { type: 'diagtr', name: 'Diagonal sup. der.', group: 'Formas' },
  { type: 'diagbl', name: 'Diagonal inf. izq.', group: 'Formas' },
  { type: 'diagbr', name: 'Diagonal inf. der.', group: 'Formas' },
  { type: 'radial', name: 'Radial', group: 'Formas' },
  { type: 'hlslice', name: 'Láminas izquierda', group: 'Estilizadas' },
  { type: 'hrslice', name: 'Láminas derecha', group: 'Estilizadas' },
  { type: 'vuslice', name: 'Láminas arriba', group: 'Estilizadas' },
  { type: 'vdslice', name: 'Láminas abajo', group: 'Estilizadas' },
  { type: 'pixelize', name: 'Pixelado', group: 'Estilizadas' },
  { type: 'hblur', name: 'Desenfoque horizontal', group: 'Estilizadas' },
];
export const TRANSITION_IDS = TRANSITIONS.map((t) => t.type);
