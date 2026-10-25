export type MediaKind = 'video' | 'audio' | 'image';
export type ClipKind = 'video' | 'audio' | 'image' | 'text';
export type TrackKind = 'video' | 'audio';

export interface MediaItem {
  id: string;
  name: string;
  path: string;
  url: string;
  kind: MediaKind;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  colorSpace?: string;
  colorRange?: string;
  colorPrimaries?: string;
  thumb?: string;
  peaks?: { perSec: number; data: number[] };
}

export interface TextStyle {
  content: string;
  font: string;
  size: number;
  weight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
  background: string; // '' = sin fondo
  italic: boolean;
}

export type CurvePoint = [number, number];
export type RGBW = { r: number; g: number; b: number; m: number };

export interface Grade {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  saturation: number;
  vibrance: number;
  lift: RGBW;
  gamma: RGBW;
  gain: RGBW;
  curves: { m: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[] };
  hsl: { enabled: boolean; hue: number; range: number; softness: number; hueShift: number; sat: number; lum: number };
  lut?: { name: string; size: number; data: number[] }; // .cube importado
  lutMix: number;
}

export interface Effect {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, number | string>;
}

export type Easing = 'linear' | 'in' | 'out' | 'inout' | 'hold';
export interface Keyframe {
  t: number; // segundos relativos al inicio del clip
  v: number;
  ease: Easing;
}
export type AnimProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';

export interface Transition {
  type: string; // nombre xfade
  duration: number;
}

export interface AudioFx {
  pan: number; // -1..1
  eqLow: number; // dB
  eqMid: number;
  eqHigh: number;
  compressor: boolean;
  denoise: number; // 0..1, solo exportación
}

export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  mediaId?: string;
  name: string;
  start: number; // segundos en la línea de tiempo
  duration: number; // segundos en la línea de tiempo
  in: number; // segundos dentro del archivo de origen
  speed: number;
  // Transformación
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  opacity: number;
  // Color (ajustes rápidos heredados; se integran en la gradación)
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
  grade?: Grade;
  effects?: Effect[];
  keyframes?: Partial<Record<AnimProp, Keyframe[]>>;
  transitionIn?: Transition; // transición con el clip anterior adyacente en la pista
  // Tiempo / audio
  fadeIn: number;
  fadeOut: number;
  volume: number;
  muted: boolean;
  audioFx?: AudioFx;
  text?: TextStyle;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  solo?: boolean;
  volume?: number; // mezclador (ganancia lineal)
  pan?: number;
}

export interface ProjectSettings {
  name: string;
  width: number;
  height: number;
  fps: number; // 23.976, 29.97, 59.94 se exportan como fracciones NTSC exactas
  background: string;
}

export interface ProjectData {
  version: 1;
  settings: ProjectSettings;
  media: MediaItem[];
  tracks: Track[];
  clips: Clip[];
}
