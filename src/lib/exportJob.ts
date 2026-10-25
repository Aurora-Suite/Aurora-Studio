import type { Clip, ProjectData, Track } from '../types';
import { renderTextCanvas } from './render';
import { totalDuration } from '../store';
import { bakeLut, lutSizeFor, lutToCube, needsColorLut } from './color';
import { activeEffects } from './gl';
import { convKernel, effectDef } from './effects';
import { ffExpr, interp, propRange } from './keyframes';

export interface ExportOutput {
  path: string;
  encoder: string;
  rateControl: 'quality' | 'vbr' | 'cbr';
  quality: number;
  bitrate: number;
  bitDepth: 8 | 10;
  speed: 'fast' | 'medium' | 'slow';
  width: number;
  height: number;
  hwDecode: boolean;
  audioCodec: 'aac' | 'opus' | 'pcm' | 'flac' | 'none';
  audioBitrate: number;
  loudnorm: number | null;
  alpha: boolean;
}

const PX_PARAMS: Record<string, string[]> = { blur: ['sigma'], pixelate: ['size'], rgbsplit: ['amount'], stabilize: ['range'] };

function audioOf(c: Clip, tr: Track) {
  const fx = c.audioFx;
  return {
    volume: c.volume,
    volumeExpr: c.keyframes?.volume?.length ? ffExpr(c.keyframes.volume, 'TL') : undefined,
    trackVolume: tr.volume ?? 1,
    fadeIn: c.fadeIn,
    fadeOut: c.fadeOut,
    pan: Math.max(-1, Math.min(1, (fx?.pan ?? 0) + (tr.pan ?? 0))),
    eqLow: fx?.eqLow ?? 0,
    eqMid: fx?.eqMid ?? 0,
    eqHigh: fx?.eqHigh ?? 0,
    compressor: !!fx?.compressor,
    denoise: fx?.denoise ?? 0,
  };
}

// Construye el trabajo de render a la resolución de salida (la composición se hace a ese tamaño, no se reescala).
export function buildJob(p: ProjectData, output: ExportOutput) {
  const f = output.width / p.settings.width;
  const settings = { ...p.settings, width: output.width, height: output.height };
  const media = new Map(p.media.map((m) => [m.id, m]));
  const anySolo = p.tracks.some((t) => t.solo);
  const audible = (t: Track) => !t.muted && (!anySolo || t.solo);
  const visuals: any[] = [];
  const audios: any[] = [];

  const videoTracks = p.tracks.filter((t) => t.kind === 'video').reverse(); // 0 = capa inferior
  videoTracks.forEach((tr, layer) => {
    if (tr.hidden) return;
    for (const c of p.clips.filter((x) => x.trackId === tr.id)) {
      const fxMap = activeEffects(c);
      const fx: Record<string, Record<string, number | string>> = {};
      for (const [type, params] of fxMap) {
        const def = effectDef(type);
        if (def && def.kind === 'color') continue;
        const scaled = { ...params };
        for (const k of PX_PARAMS[type] || []) scaled[k] = Number(scaled[k]) * f;
        fx[type] = scaled;
      }
      const convType = ['sharpen', 'emboss', 'edges'].find((t) => fxMap.has(t));
      const kf: Record<string, string> = {};
      const keys = c.keyframes || {};
      if (keys.x?.length) kf.x = ffExpr(keys.x.map((k) => ({ ...k, v: k.v * f })), 'TL');
      if (keys.y?.length) kf.y = ffExpr(keys.y.map((k) => ({ ...k, v: k.v * f })), 'TL');
      if (keys.scale?.length) kf.scale = ffExpr(keys.scale, 'TL');
      if (keys.rotation?.length) kf.rotation = ffExpr(keys.rotation, 'TL');
      const procScale = kf.scale ? Math.max(0.01, propRange(c, 'scale')[1]) : c.scale;
      let opacitySamples: [number, number][] | undefined;
      if (keys.opacity?.length) {
        opacitySamples = [];
        const step = 1 / p.settings.fps;
        for (let t = -2; t <= c.duration + 2; t += step) opacitySamples.push([t, interp(keys.opacity, t)]);
      }
      const base = {
        track: layer,
        start: c.start,
        duration: c.duration,
        in: c.in,
        speed: c.speed,
        x: c.x * f,
        y: c.y * f,
        scale: c.scale,
        rotation: c.rotation,
        opacity: c.opacity,
        flipH: c.flipH,
        flipV: c.flipV,
        fadeIn: c.fadeIn,
        fadeOut: c.fadeOut,
        procScale,
        kf: Object.keys(kf).length ? kf : undefined,
        opacitySamples,
        fx,
        conv: convType ? convKernel(convType, Number(fxMap.get(convType)!.amount ?? 0)) : undefined,
        cube: needsColorLut(c) ? lutToCube(bakeLut(c), lutSizeFor(c)) : null,
        transitionIn: c.transitionIn,
      };
      if (c.kind === 'text' && c.text) {
        const r = renderTextCanvas(c.text, f * procScale);
        visuals.push({ ...base, type: 'raster', fit: 'none', srcW: r.w * f, srcH: r.h * f, png: r.canvas.toDataURL('image/png').split(',')[1] });
        continue;
      }
      const m = c.mediaId ? media.get(c.mediaId) : undefined;
      if (!m) continue;
      const v: any = { ...base, type: m.kind === 'image' ? 'image' : 'video', fit: 'contain', path: m.path, srcW: m.width, srcH: m.height, colorSpace: m.colorSpace, colorRange: m.colorRange, colorPrimaries: m.colorPrimaries };
      if (m.kind === 'video' && m.hasAudio && !c.muted && audible(tr) && c.volume > 0) v.audio = audioOf(c, tr);
      visuals.push(v);
    }
  });

  for (const c of p.clips) {
    const tr = p.tracks.find((t) => t.id === c.trackId);
    if (!tr || tr.kind !== 'audio' || !audible(tr) || c.muted || c.volume <= 0) continue;
    const m = c.mediaId ? media.get(c.mediaId) : undefined;
    if (!m) continue;
    audios.push({ path: m.path, start: c.start, duration: c.duration, in: c.in, speed: c.speed, ...audioOf(c, tr) });
  }

  return { settings, output, duration: totalDuration(p.clips), visuals, audios };
}
