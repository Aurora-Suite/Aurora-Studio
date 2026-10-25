import { create } from 'zustand';
import type { Clip, Effect, Grade, MediaItem, ProjectData, ProjectSettings, TextStyle, Track, TrackKind } from './types';
import { defaultGrade } from './lib/color';
import { defaultParams } from './lib/effects';
import { shiftKeys } from './lib/keyframes';

export type Tool = 'select' | 'ripple' | 'roll' | 'slip' | 'slide' | 'razor';

export const uid = () => Math.random().toString(36).slice(2, 10);
export const mediaUrl = (p: string) => 'media://local/' + encodeURIComponent(p);

const MIN_CLIP = 1 / 30;

const defaultTracks = (): Track[] => [
  { id: uid(), kind: 'video', name: 'V2', muted: false, hidden: false, locked: false },
  { id: uid(), kind: 'video', name: 'V1', muted: false, hidden: false, locked: false },
  { id: uid(), kind: 'audio', name: 'A1', muted: false, hidden: false, locked: false },
  { id: uid(), kind: 'audio', name: 'A2', muted: false, hidden: false, locked: false },
];

export const defaultSettings = (): ProjectSettings => ({ name: 'Proyecto sin título', width: 1920, height: 1080, fps: 30, background: '#000000' });

export const defaultText = (): TextStyle => ({
  content: 'Tu texto',
  font: 'Inter Variable',
  size: 96,
  weight: 700,
  color: '#ffffff',
  align: 'center',
  strokeColor: '#000000',
  strokeWidth: 0,
  shadow: true,
  background: '',
  italic: false,
});

const baseClip = (): Omit<Clip, 'id' | 'trackId' | 'kind' | 'name' | 'start' | 'duration'> => ({
  in: 0,
  speed: 1,
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  flipH: false,
  flipV: false,
  opacity: 1,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  hue: 0,
  blur: 0,
  fadeIn: 0,
  fadeOut: 0,
  volume: 1,
  muted: false,
});

interface Snapshot {
  settings: ProjectSettings;
  tracks: Track[];
  clips: Clip[];
}

interface State {
  settings: ProjectSettings;
  media: MediaItem[];
  tracks: Track[];
  clips: Clip[];
  filePath: string | null;
  dirty: boolean;
  selected: string[];
  time: number;
  playing: boolean;
  pps: number;
  snapping: boolean;
  showScopes: boolean;
  exportOpen: boolean;
  importing: number;
  toast: string | null;
  tool: Tool;
  shuttle: number;
  monitor: 'program' | 'source';
  source: { mediaId: string | null; time: number; in: number | null; out: number | null };
  markIn: number | null;
  markOut: number | null;
  rightPanel: 'inspector' | 'mixer';
  past: Snapshot[];
  future: Snapshot[];
  lastKey: string | null;
  lastKeyAt: number;

  set: (p: Partial<State>) => void;
  notify: (msg: string) => void;
  commit: (key?: string) => void;
  undo: () => void;
  redo: () => void;
  importPaths: (paths: string[]) => Promise<MediaItem[]>;
  removeMedia: (id: string) => void;
  addClipFromMedia: (mediaId: string, trackId?: string, start?: number) => void;
  addText: () => void;
  updateClip: (id: string, patch: Partial<Clip>, key?: string) => void;
  updateText: (id: string, patch: Partial<TextStyle>, key?: string) => void;
  placeClip: (id: string, trackId: string, start: number) => boolean;
  splitAt: (t?: number) => void;
  deleteSelected: (ripple?: boolean) => void;
  duplicateSelected: () => void;
  addTrack: (kind: TrackKind) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  removeTrack: (id: string) => void;
  setSettings: (p: Partial<ProjectSettings>) => void;
  setTime: (t: number) => void;
  openSource: (mediaId: string) => void;
  editFromSource: (mode: 'insert' | 'overwrite') => void;
  detachAudio: (id: string) => void;
  freezeFrame: (id: string) => Promise<void>;
  setTransition: (id: string, type: string | null, duration?: number) => boolean;
  addEffect: (type: string, ids?: string[]) => void;
  updateEffect: (clipId: string, effectId: string, patch: Partial<Effect>, key?: string) => void;
  removeEffect: (clipId: string, effectId: string) => void;
  updateGrade: (clipId: string, patch: Partial<Grade>, key?: string) => void;
  newProject: () => void;
  loadProject: (data: ProjectData, filePath?: string | null) => void;
  toData: () => ProjectData;
}

export const totalDuration = (clips: Clip[]) => clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);

const overlaps = (clips: Clip[], trackId: string, start: number, end: number, ignore?: string) =>
  clips.some((c) => c.trackId === trackId && c.id !== ignore && start < c.start + c.duration - 1e-6 && end > c.start + 1e-6);

const trackFits = (kind: Clip['kind'], track: Track) => (kind === 'audio' ? track.kind === 'audio' : track.kind === 'video');

export const useStore = create<State>((set, get) => ({
  settings: defaultSettings(),
  media: [],
  tracks: defaultTracks(),
  clips: [],
  filePath: null,
  dirty: false,
  selected: [],
  time: 0,
  playing: false,
  pps: 60,
  snapping: true,
  showScopes: false,
  exportOpen: false,
  importing: 0,
  toast: null,
  tool: 'select',
  shuttle: 1,
  monitor: 'program',
  source: { mediaId: null, time: 0, in: null, out: null },
  markIn: null,
  markOut: null,
  rightPanel: 'inspector',
  past: [],
  future: [],
  lastKey: null,
  lastKeyAt: 0,

  set: (p) => set(p),
  notify: (msg) => {
    set({ toast: msg });
    setTimeout(() => get().toast === msg && set({ toast: null }), 2600);
  },

  // Guarda un punto de deshacer. Las llamadas seguidas con la misma clave (sliders, arrastres) se agrupan en uno.
  commit: (key) => {
    const s = get();
    const now = performance.now();
    if (key && key === s.lastKey && now - s.lastKeyAt < 1200) {
      set({ lastKeyAt: now, dirty: true });
      return;
    }
    const snap: Snapshot = { settings: s.settings, tracks: s.tracks, clips: s.clips };
    set({ past: [...s.past.slice(-199), snap], future: [], lastKey: key || null, lastKeyAt: now, dirty: true });
  },
  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({
      past: s.past.slice(0, -1),
      future: [{ settings: s.settings, tracks: s.tracks, clips: s.clips }, ...s.future],
      ...prev,
      lastKey: null,
      selected: s.selected.filter((id) => prev.clips.some((c) => c.id === id)),
    });
  },
  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({ future: s.future.slice(1), past: [...s.past, { settings: s.settings, tracks: s.tracks, clips: s.clips }], ...next, lastKey: null });
  },

  importPaths: async (paths) => {
    const added: MediaItem[] = [];
    set((s) => ({ importing: s.importing + paths.length }));
    await Promise.all(
      paths.map(async (p) => {
        try {
          const existing = get().media.find((m) => m.path === p);
          if (existing) {
            added.push(existing);
            return;
          }
          const info = await window.api.probe(p);
          const name = p.split(/[\\/]/).pop() || p;
          const item: MediaItem = { id: uid(), name, path: p, url: mediaUrl(p), ...info };
          set((s) => ({ media: [...s.media, item], dirty: true }));
          added.push(item);
          if (info.kind !== 'audio') {
            window.api
              .thumb(p, info.kind === 'video' ? Math.min(1, info.duration / 3) : 0)
              .then((t) => set((s) => ({ media: s.media.map((m) => (m.id === item.id ? { ...m, thumb: mediaUrl(t) } : m)) })))
              .catch(() => {});
          }
          if (info.hasAudio) {
            window.api
              .peaks(p)
              .then((pk) => set((s) => ({ media: s.media.map((m) => (m.id === item.id ? { ...m, peaks: pk } : m)) })))
              .catch(() => {});
          }
        } catch (e) {
          get().notify(`No se pudo importar ${p.split(/[\\/]/).pop()}`);
        } finally {
          set((s) => ({ importing: s.importing - 1 }));
        }
      })
    );
    return added;
  },

  removeMedia: (id) => {
    get().commit();
    set((s) => ({ media: s.media.filter((m) => m.id !== id), clips: s.clips.filter((c) => c.mediaId !== id) }));
  },

  addClipFromMedia: (mediaId, trackId, start) => {
    const s = get();
    const m = s.media.find((x) => x.id === mediaId);
    if (!m) return;
    const kind: Clip['kind'] = m.kind;
    const candidates = s.tracks.filter((t) => trackFits(kind, t) && !t.locked);
    let track = s.tracks.find((t) => t.id === trackId && trackFits(kind, t) && !t.locked);
    if (!track) track = kind === 'audio' ? candidates[0] : candidates[candidates.length - 1];
    if (!track) return;
    const duration = m.kind === 'image' ? 5 : m.duration;
    let at = start ?? s.time;
    if (overlaps(s.clips, track.id, at, at + duration)) {
      at = totalDuration(s.clips.filter((c) => c.trackId === track!.id));
    }
    const clip: Clip = { ...baseClip(), id: uid(), trackId: track.id, kind, mediaId, name: m.name, start: Math.max(0, at), duration };
    s.commit();
    set({ clips: [...s.clips, clip], selected: [clip.id] });
  },

  addText: () => {
    const s = get();
    const videoTracks = s.tracks.filter((t) => t.kind === 'video' && !t.locked);
    const duration = 4;
    let track = videoTracks.find((t) => !overlaps(s.clips, t.id, s.time, s.time + duration));
    s.commit();
    let tracks = s.tracks;
    if (!track) {
      track = { id: uid(), kind: 'video', name: `V${videoTracks.length + 1}`, muted: false, hidden: false, locked: false };
      tracks = [track, ...s.tracks];
    }
    const clip: Clip = { ...baseClip(), id: uid(), trackId: track.id, kind: 'text', name: 'Texto', start: s.time, duration, text: defaultText() };
    set({ tracks, clips: [...s.clips, clip], selected: [clip.id] });
  },

  updateClip: (id, patch, key) => {
    get().commit(key ? `${key}:${id}` : undefined);
    set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  },
  updateText: (id, patch, key) => {
    get().commit(key ? `text-${key}:${id}` : undefined);
    set((s) => ({ clips: s.clips.map((c) => (c.id === id && c.text ? { ...c, text: { ...c.text, ...patch } } : c)) }));
  },

  placeClip: (id, trackId, start) => {
    const s = get();
    const c = s.clips.find((x) => x.id === id);
    const track = s.tracks.find((t) => t.id === trackId);
    if (!c || !track || track.locked || !trackFits(c.kind, track)) return false;
    if (overlaps(s.clips, trackId, start, start + c.duration, id)) return false;
    set({ clips: s.clips.map((x) => (x.id === id ? { ...x, trackId, start: Math.max(0, start) } : x)) });
    return true;
  },

  splitAt: (t) => {
    const s = get();
    const at = t ?? s.time;
    const lockedTracks = new Set(s.tracks.filter((tr) => tr.locked).map((tr) => tr.id));
    let targets = s.clips.filter((c) => at > c.start + MIN_CLIP && at < c.start + c.duration - MIN_CLIP && !lockedTracks.has(c.trackId));
    if (s.selected.length) {
      const sel = targets.filter((c) => s.selected.includes(c.id));
      if (sel.length) targets = sel;
    }
    if (!targets.length) return;
    s.commit();
    const ids = new Set(targets.map((c) => c.id));
    const newOnes: Clip[] = [];
    const clips = s.clips.map((c) => {
      if (!ids.has(c.id)) return c;
      const leftDur = at - c.start;
      newOnes.push({ ...c, id: uid(), start: at, duration: c.duration - leftDur, in: c.in + leftDur * c.speed, fadeIn: 0, transitionIn: undefined, keyframes: shiftKeys(c, leftDur) });
      return { ...c, duration: leftDur, fadeOut: 0 };
    });
    set({ clips: [...clips, ...newOnes], selected: newOnes.map((c) => c.id) });
  },

  deleteSelected: (ripple) => {
    const s = get();
    if (!s.selected.length) return;
    s.commit();
    let clips = s.clips;
    for (const id of s.selected) {
      const c = clips.find((x) => x.id === id);
      if (!c) continue;
      clips = clips.filter((x) => x.id !== id);
      if (ripple) {
        clips = clips.map((x) => (x.trackId === c.trackId && x.start >= c.start + c.duration - 1e-6 ? { ...x, start: x.start - c.duration } : x));
      }
    }
    set({ clips, selected: [] });
  },

  duplicateSelected: () => {
    const s = get();
    if (!s.selected.length) return;
    s.commit();
    const copies: Clip[] = [];
    for (const id of s.selected) {
      const c = s.clips.find((x) => x.id === id);
      if (!c) continue;
      const all = [...s.clips, ...copies];
      let start = c.start + c.duration;
      while (overlaps(all, c.trackId, start, start + c.duration)) {
        const blocker = all.filter((x) => x.trackId === c.trackId && x.start + x.duration > start).sort((a, b) => a.start - b.start)[0];
        start = blocker.start + blocker.duration;
      }
      copies.push({ ...c, id: uid(), start, text: c.text ? { ...c.text } : undefined });
    }
    set({ clips: [...s.clips, ...copies], selected: copies.map((c) => c.id) });
  },

  addTrack: (kind) => {
    const s = get();
    s.commit();
    const count = s.tracks.filter((t) => t.kind === kind).length;
    const track: Track = { id: uid(), kind, name: `${kind === 'video' ? 'V' : 'A'}${count + 1}`, muted: false, hidden: false, locked: false };
    set({ tracks: kind === 'video' ? [track, ...s.tracks] : [...s.tracks, track] });
  },
  updateTrack: (id, patch) => {
    get().commit();
    set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  },
  removeTrack: (id) => {
    const s = get();
    const t = s.tracks.find((x) => x.id === id);
    if (!t || s.tracks.filter((x) => x.kind === t.kind).length <= 1) return;
    s.commit();
    set({ tracks: s.tracks.filter((x) => x.id !== id), clips: s.clips.filter((c) => c.trackId !== id) });
  },

  setSettings: (p) => {
    get().commit('settings');
    set((s) => ({ settings: { ...s.settings, ...p } }));
  },
  setTime: (t) => set({ time: Math.max(0, t) }),

  openSource: (mediaId) => {
    const m = get().media.find((x) => x.id === mediaId);
    if (!m) return;
    set({ monitor: 'source', playing: false, source: { mediaId, time: 0, in: null, out: null } });
  },

  // Edición de tres puntos: entrada/salida del origen + cabezal (o marcas) de la línea de tiempo.
  editFromSource: (mode) => {
    const s = get();
    const m = s.media.find((x) => x.id === s.source.mediaId);
    if (!m) return s.notify('Abre un medio en el monitor de origen');
    const srcIn = s.source.in ?? 0;
    const srcOut = s.source.out ?? (m.kind === 'image' ? srcIn + 5 : m.duration);
    let duration = Math.max(MIN_CLIP, srcOut - srcIn);
    const at = s.markIn ?? s.time;
    if (s.markIn !== null && s.markOut !== null) duration = Math.min(duration, s.markOut - s.markIn);
    const kind: Clip['kind'] = m.kind;
    const track = kind === 'audio' ? s.tracks.find((t) => t.kind === 'audio' && !t.locked) : [...s.tracks].reverse().find((t) => t.kind === 'video' && !t.locked);
    if (!track) return;
    s.commit();
    let clips = s.clips;
    const end = at + duration;
    if (mode === 'insert') {
      // Divide lo que cruza el punto de inserción y desplaza todo lo posterior en las pistas desbloqueadas.
      const unlocked = new Set(s.tracks.filter((t) => !t.locked).map((t) => t.id));
      const out: Clip[] = [];
      for (const c of clips) {
        if (!unlocked.has(c.trackId)) out.push(c);
        else if (c.start >= at - 1e-6) out.push({ ...c, start: c.start + duration });
        else if (c.start + c.duration > at + 1e-6) {
          const left = at - c.start;
          out.push({ ...c, duration: left, fadeOut: 0 });
          out.push({ ...c, id: uid(), start: end, duration: c.duration - left, in: c.in + left * c.speed, fadeIn: 0, transitionIn: undefined, keyframes: shiftKeys(c, left) });
        } else out.push(c);
      }
      clips = out;
    } else {
      // Sobrescribir: recorta o elimina lo que ocupe el hueco en la pista destino.
      const out: Clip[] = [];
      for (const c of clips) {
        const cEnd = c.start + c.duration;
        if (c.trackId !== track.id || cEnd <= at + 1e-6 || c.start >= end - 1e-6) out.push(c);
        else {
          if (c.start < at) out.push({ ...c, duration: at - c.start, fadeOut: 0 });
          if (cEnd > end) {
            const cut = end - c.start;
            out.push({ ...c, id: uid(), start: end, duration: cEnd - end, in: c.in + cut * c.speed, fadeIn: 0, transitionIn: undefined, keyframes: shiftKeys(c, cut) });
          }
        }
      }
      clips = out;
    }
    const clip: Clip = { ...baseClip(), id: uid(), trackId: track.id, kind, mediaId: m.id, name: m.name, start: at, duration, in: m.kind === 'image' ? 0 : srcIn };
    set({ clips: [...clips, clip], selected: [clip.id], time: end, monitor: 'program', markIn: null, markOut: null });
  },

  detachAudio: (id) => {
    const s = get();
    const c = s.clips.find((x) => x.id === id);
    const m = c?.mediaId ? s.media.find((x) => x.id === c.mediaId) : undefined;
    if (!c || !m || c.kind !== 'video' || !m.hasAudio) return;
    const tracks = s.tracks.filter((t) => t.kind === 'audio' && !t.locked);
    let track = tracks.find((t) => !overlaps(s.clips, t.id, c.start, c.start + c.duration));
    s.commit();
    let allTracks = s.tracks;
    if (!track) {
      track = { id: uid(), kind: 'audio', name: `A${s.tracks.filter((t) => t.kind === 'audio').length + 1}`, muted: false, hidden: false, locked: false };
      allTracks = [...s.tracks, track];
    }
    const a: Clip = {
      ...baseClip(), id: uid(), trackId: track.id, kind: 'audio', mediaId: m.id, name: m.name, start: c.start, duration: c.duration, in: c.in, speed: c.speed,
      volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut, audioFx: c.audioFx, keyframes: c.keyframes?.volume ? { volume: c.keyframes.volume } : undefined,
    };
    set({ tracks: allTracks, clips: [...s.clips.map((x) => (x.id === id ? { ...x, muted: true } : x)), a], selected: [a.id] });
    s.notify('Audio separado en su propia pista');
  },

  freezeFrame: async (id) => {
    const s = get();
    const c = s.clips.find((x) => x.id === id);
    const m = c?.mediaId ? s.media.find((x) => x.id === c.mediaId) : undefined;
    if (!c || !m || c.kind !== 'video') return;
    const local = Math.max(0, Math.min(c.duration - MIN_CLIP, s.time - c.start));
    const file = await window.api.frame(m.path, c.in + local * c.speed);
    const [img] = await get().importPaths([file]);
    if (!img) return;
    const st = get();
    st.commit();
    const at = c.start + local;
    const hold = 2;
    // Divide en el cabezal, inserta 2 s de imagen congelada y desplaza el resto del clip.
    const left = { ...c, duration: local, fadeOut: 0 };
    const right = { ...c, id: uid(), start: at + hold, duration: c.duration - local, in: c.in + local * c.speed, fadeIn: 0, transitionIn: undefined, keyframes: shiftKeys(c, local) };
    const frozen: Clip = { ...c, id: uid(), kind: 'image', mediaId: img.id, name: 'Fotograma congelado', start: at, duration: hold, in: 0, speed: 1, fadeIn: 0, fadeOut: 0, keyframes: undefined, transitionIn: undefined };
    const clips = st.clips.flatMap((x) => {
      if (x.id === c.id) return [left, frozen, right].filter((y) => y.duration > MIN_CLIP / 2);
      if (x.trackId === c.trackId && x.start >= c.start + c.duration - 1e-6) return [{ ...x, start: x.start + hold }];
      return [x];
    });
    set({ clips, selected: [frozen.id] });
  },

  setTransition: (id, type, duration = 1) => {
    const s = get();
    const c = s.clips.find((x) => x.id === id);
    if (!c) return false;
    if (type) {
      const prev = s.clips.find((x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(x.start + x.duration - c.start) < 1e-3);
      if (!prev || c.kind === 'audio') {
        s.notify('La transición necesita un clip pegado justo antes en la misma pista');
        return false;
      }
      duration = Math.min(duration, prev.duration, c.duration);
    }
    s.commit();
    set({ clips: s.clips.map((x) => (x.id === id ? { ...x, transitionIn: type ? { type, duration } : undefined } : x)) });
    return true;
  },

  addEffect: (type, ids) => {
    const s = get();
    const targets = (ids ?? s.selected).filter((id) => {
      const c = s.clips.find((x) => x.id === id);
      return c && c.kind !== 'audio';
    });
    if (!targets.length) return s.notify('Selecciona un clip de vídeo, imagen o texto');
    s.commit();
    set({
      clips: s.clips.map((c) => {
        if (!targets.includes(c.id)) return c;
        const list = (c.effects || []).filter((e) => e.type !== type);
        return { ...c, effects: [...list, { id: uid(), type, enabled: true, params: defaultParams(type) }] };
      }),
    });
  },
  updateEffect: (clipId, effectId, patch, key) => {
    get().commit(key ? `fx-${key}:${effectId}` : undefined);
    set((s) => ({
      clips: s.clips.map((c) => (c.id === clipId ? { ...c, effects: (c.effects || []).map((e) => (e.id === effectId ? { ...e, ...patch, params: { ...e.params, ...(patch.params || {}) } } : e)) } : c)),
    }));
  },
  removeEffect: (clipId, effectId) => {
    get().commit();
    set((s) => ({ clips: s.clips.map((c) => (c.id === clipId ? { ...c, effects: (c.effects || []).filter((e) => e.id !== effectId) } : c)) }));
  },
  updateGrade: (clipId, patch, key) => {
    get().commit(key ? `grade-${key}:${clipId}` : undefined);
    set((s) => ({ clips: s.clips.map((c) => (c.id === clipId ? { ...c, grade: { ...(c.grade ?? defaultGrade()), ...patch } } : c)) }));
  },

  newProject: () =>
    set({
      settings: defaultSettings(),
      media: [],
      tracks: defaultTracks(),
      clips: [],
      filePath: null,
      dirty: false,
      selected: [],
      time: 0,
      playing: false,
      past: [],
      future: [],
    }),
  loadProject: (data, filePath = null) =>
    set({
      settings: { ...defaultSettings(), ...data.settings },
      media: data.media.map((m) => ({ ...m, url: mediaUrl(m.path) })),
      tracks: data.tracks,
      clips: data.clips,
      filePath,
      dirty: false,
      selected: [],
      time: 0,
      playing: false,
      past: [],
      future: [],
    }),
  toData: () => {
    const s = get();
    return { version: 1, settings: s.settings, media: s.media, tracks: s.tracks, clips: s.clips };
  },
}));
