// Motor de reproducción del monitor de programa.
import { useStore, totalDuration } from '../store';
import type { Clip, MediaItem, Track } from '../types';
import { Compositor, type LayerSource } from './gl';
import { fadeAlpha, fitSize, renderTextCanvas } from './render';
import { propRange, valueAt } from './keyframes';
import { audioEngine } from './audio';

type MediaEl = HTMLVideoElement | HTMLAudioElement;

// Ventana extendida de un clip por transiciones (pre/post) y pareja de transición activa.
function trackPlan(clips: Clip[]) {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const pre = new Map<string, number>();
  const post = new Map<string, number>();
  const pairs: { a: Clip; b: Clip; d: number; type: string }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (b.transitionIn && Math.abs(a.start + a.duration - b.start) < 1e-3) {
      const d = Math.min(b.transitionIn.duration, a.duration, b.duration);
      post.set(a.id, d / 2);
      pre.set(b.id, d / 2);
      pairs.push({ a, b, d, type: b.transitionIn.type });
    }
  }
  return { sorted, pre, post, pairs };
}

export function createEngine(canvas: HTMLCanvasElement, getScope: () => HTMLCanvasElement | null) {
  const comp = new Compositor(canvas);
  const pool = new Map<string, { el: MediaEl; mediaId: string }>();
  const images = new Map<string, HTMLImageElement>();
  const texts = new Map<string, { key: string; canvas: HTMLCanvasElement; w: number; h: number }>();
  let raf = 0;
  let clock = { t0: 0, p0: 0, rate: 1 };
  let lastTime = -1;
  let wasPlaying = false;
  let lastScope = 0;
  const scopeCanvas = document.createElement('canvas');
  scopeCanvas.width = 128;
  scopeCanvas.height = 72;
  const scopeCtx = scopeCanvas.getContext('2d', { willReadFrequently: true })!;

  const getEl = (c: Clip, m: MediaItem) => {
    let entry = pool.get(c.id);
    if (entry && entry.mediaId !== m.id) {
      destroy(c.id);
      entry = undefined;
    }
    if (!entry) {
      const el = m.kind === 'video' ? document.createElement('video') : new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      if (el instanceof HTMLVideoElement) el.playsInline = true;
      el.src = m.url;
      if (m.hasAudio) audioEngine.attach(c.id, el);
      entry = { el, mediaId: m.id };
      pool.set(c.id, entry);
    }
    return entry.el;
  };
  const destroy = (id: string) => {
    const e = pool.get(id);
    if (!e) return;
    audioEngine.detach(id);
    e.el.pause();
    e.el.removeAttribute('src');
    e.el.load();
    pool.delete(id);
  };
  const getImage = (m: MediaItem) => {
    let img = images.get(m.id);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = m.url;
      images.set(m.id, img);
    }
    return img;
  };

  function syncMedia(t: number, playing: boolean, rate: number) {
    const s = useStore.getState();
    const media = new Map(s.media.map((m) => [m.id, m]));
    const anySolo = s.tracks.some((tr) => tr.solo);
    const keep = new Set<string>();
    for (const tr of s.tracks) {
      audioEngine.setTrack(tr.id, tr.volume ?? 1, tr.pan ?? 0, !tr.muted && (!anySolo || !!tr.solo));
      const plan = trackPlan(s.clips.filter((c) => c.trackId === tr.id));
      for (const c of plan.sorted) {
        if (c.kind !== 'video' && c.kind !== 'audio') continue;
        const m = c.mediaId ? media.get(c.mediaId) : undefined;
        if (!m || (tr.hidden && tr.kind === 'video')) continue;
        const from = c.start - (plan.pre.get(c.id) ?? 0);
        const to = c.start + c.duration + (plan.post.get(c.id) ?? 0);
        if (t < from - 1.5 || t > to + 0.3) continue;
        keep.add(c.id);
        const el = getEl(c, m);
        const active = t >= from && t < to;
        const target = Math.max(0, Math.min(m.duration - 0.01, c.in + (Math.max(from, Math.min(to, t)) - c.start) * c.speed));
        const local = t - c.start;
        const inBody = local >= 0 && local < c.duration;
        const gain = c.muted || !inBody ? 0 : valueAt(c, 'volume', local) * fadeAlpha(c, t);
        audioEngine.update(c.id, tr.id, gain, c.audioFx);
        const forward = playing && rate > 0;
        if (active && forward) {
          const pr = Math.min(16, c.speed * rate);
          if (el.playbackRate !== pr) el.playbackRate = pr;
          if (el.paused) {
            el.currentTime = target;
            el.play().catch(() => {});
          } else if (Math.abs(el.currentTime - target) > 0.3 * Math.max(1, rate)) {
            el.currentTime = target;
          }
        } else {
          if (!el.paused) el.pause();
          if (!el.seeking && Math.abs(el.currentTime - target) > 0.5 / s.settings.fps) el.currentTime = target;
        }
      }
    }
    for (const id of Array.from(pool.keys())) if (!keep.has(id)) destroy(id);
  }

  function sourceFor(c: Clip, ps: number): LayerSource | null {
    const s = useStore.getState();
    if (c.kind === 'text' && c.text) {
      const k = Math.max(0.25, ps * Math.max(c.scale, propRange(c, 'scale')[1]));
      const key = JSON.stringify(c.text) + k.toFixed(3);
      let e = texts.get(c.id);
      if (!e || e.key !== key) {
        const r = renderTextCanvas(c.text, k, e?.canvas);
        e = { key, canvas: r.canvas, w: r.w, h: r.h };
        texts.set(c.id, e);
      }
      return { el: e.canvas, key, dynamic: false, w: e.w, h: e.h };
    }
    const m = c.mediaId ? s.media.find((x) => x.id === c.mediaId) : undefined;
    if (!m) return null;
    const { w, h } = fitSize(m, s.settings, 1);
    if (c.kind === 'image') {
      const img = getImage(m);
      if (!img.complete || !img.naturalWidth) return null;
      return { el: img, key: m.id, dynamic: false, w, h };
    }
    const el = pool.get(c.id)?.el as HTMLVideoElement | undefined;
    if (!el || el.readyState < 2 || !el.videoWidth) return null;
    return { el, key: c.id, dynamic: true, w, h };
  }

  function layerState(c: Clip, t: number) {
    const local = t - c.start;
    return {
      x: valueAt(c, 'x', local),
      y: valueAt(c, 'y', local),
      scale: valueAt(c, 'scale', local),
      rotation: valueAt(c, 'rotation', local),
      opacity: valueAt(c, 'opacity', local) * fadeAlpha(c, t),
    };
  }

  function draw(t: number) {
    const s = useStore.getState();
    const { settings } = s;
    const ps = canvas.width / settings.width;
    comp.begin(settings);
    const order: Track[] = s.tracks.filter((tr) => tr.kind === 'video' && !tr.hidden).reverse();
    const ids = new Set<string>();
    const drawClip = (c: Clip, dest?: any) => {
      const src = sourceFor(c, ps);
      ids.add(c.id);
      if (!src) return;
      const maxScale = Math.max(0.01, c.keyframes?.scale?.length ? propRange(c, 'scale')[1] : c.scale);
      comp.drawLayer(c, src, layerState(c, t), settings, maxScale, dest ?? null);
    };
    for (const tr of order) {
      const plan = trackPlan(s.clips.filter((c) => c.trackId === tr.id));
      const pair = plan.pairs.find((p) => t >= p.b.start - p.d / 2 && t < p.b.start + p.d / 2);
      if (pair) {
        const progress = 1 - (t - (pair.b.start - pair.d / 2)) / pair.d;
        comp.transition(pair.type, progress, (ta) => drawClip(pair.a, ta), (tb) => drawClip(pair.b, tb));
        continue;
      }
      const c = plan.sorted.find((x) => t >= x.start && t < x.start + x.duration);
      if (c) drawClip(c);
    }
    for (const c of s.clips) ids.add(c.id);
    comp.forget(ids);
  }

  function drawScopes(now: number) {
    const out = getScope();
    if (!out || now - lastScope < 120) return;
    lastScope = now;
    scopeCtx.drawImage(canvas, 0, 0, scopeCanvas.width, scopeCanvas.height);
    const { data } = scopeCtx.getImageData(0, 0, scopeCanvas.width, scopeCanvas.height);
    const o = out.getContext('2d')!;
    const W = out.width;
    const H = out.height;
    const half = H / 2 - 4;
    o.clearRect(0, 0, W, H);
    const bins = [new Uint32Array(64), new Uint32Array(64), new Uint32Array(64)];
    for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) bins[k][data[i + k] >> 2]++;
    const max = Math.max(1, ...bins.map((b) => Math.max(...b)));
    o.globalCompositeOperation = 'lighter';
    ['rgba(255,69,58,0.75)', 'rgba(48,209,88,0.75)', 'rgba(10,132,255,0.85)'].forEach((col, k) => {
      o.fillStyle = col;
      o.beginPath();
      o.moveTo(0, half);
      for (let b = 0; b < 64; b++) o.lineTo((b / 63) * W, half - (bins[k][b] / max) * (half - 2));
      o.lineTo(W, half);
      o.fill();
    });
    o.fillStyle = 'rgba(160,255,170,0.22)';
    const sw = scopeCanvas.width;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const x = ((p % sw) / sw) * W;
      const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      o.fillRect(x, H - 2 - l * (half - 4), 1.6, 1.6);
    }
    o.globalCompositeOperation = 'source-over';
    o.fillStyle = 'rgba(255,255,255,0.08)';
    o.fillRect(0, half + 3, W, 1);
  }

  function frame(now: number) {
    const s = useStore.getState();
    let t = s.time;
    const playing = s.playing && s.monitor === 'program';
    if (playing) {
      if (!wasPlaying || Math.abs(s.time - lastTime) > 1e-6 || clock.rate !== s.shuttle) clock = { t0: s.time, p0: now, rate: s.shuttle };
      t = clock.t0 + ((now - clock.p0) / 1000) * clock.rate;
      const total = totalDuration(s.clips);
      if (t >= total || t <= 0) {
        t = Math.max(0, Math.min(total, t));
        useStore.setState({ playing: false, time: t, shuttle: 1 });
      } else useStore.setState({ time: t });
      lastTime = t;
    }
    wasPlaying = playing;
    syncMedia(t, playing, s.shuttle);
    draw(t);
    if (s.showScopes) drawScopes(now);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      cancelAnimationFrame(raf);
      for (const id of Array.from(pool.keys())) destroy(id);
    },
  };
}
