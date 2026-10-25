import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Undo2, Redo2, Scissors, Trash2, Copy, Type, Magnet, Film, Music, Eye, EyeOff, Volume2, VolumeX, Lock, Unlock, Plus, ZoomIn, ZoomOut, Maximize, X,
  MousePointer2, StretchHorizontal, Columns2, MoveHorizontal, ArrowLeftRight, SlidersVertical, Blend,
} from 'lucide-react';
import { useStore, totalDuration, type Tool } from '../store';
import { shiftKeys as shiftKeysOf } from '../lib/keyframes';
import { TRANSITIONS } from '../lib/effects';
import type { Clip, MediaItem, Track } from '../types';

const RULER_H = 30;
const TOOLS: { id: Tool; name: string; key: string; icon: React.ReactNode }[] = [
  { id: 'select', name: 'Selección', key: 'V', icon: <MousePointer2 size={15} /> },
  { id: 'ripple', name: 'Recorte de rizo', key: 'B', icon: <StretchHorizontal size={15} /> },
  { id: 'roll', name: 'Recorte de rodillo', key: 'R', icon: <Columns2 size={15} /> },
  { id: 'slip', name: 'Deslizar contenido', key: 'Y', icon: <ArrowLeftRight size={15} /> },
  { id: 'slide', name: 'Desplazar entre vecinos', key: 'U', icon: <MoveHorizontal size={15} /> },
  { id: 'razor', name: 'Cuchilla', key: 'C', icon: <Scissors size={15} /> },
];
const laneH = (t: Track) => (t.kind === 'video' ? 66 : 52);
const MIN_DUR = 1 / 30;

function pickStep(pps: number) {
  const steps = [1 / 30, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  return steps.find((s) => s * pps >= 90) ?? 3600;
}
const label = (t: number, step: number) => {
  const m = Math.floor(t / 60);
  const s = t % 60;
  if (step < 1) return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  return `${m}:${String(Math.round(s)).padStart(2, '0')}`;
};

export default function Timeline() {
  const tracks = useStore((s) => s.tracks);
  const clips = useStore((s) => s.clips);
  const media = useStore((s) => s.media);
  const pps = useStore((s) => s.pps);
  const selected = useStore((s) => s.selected);
  const snapping = useStore((s) => s.snapping);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const tool = useStore((s) => s.tool);
  const rightPanel = useStore((s) => s.rightPanel);
  const markIn = useStore((s) => s.markIn);
  const markOut = useStore((s) => s.markOut);
  const st = useStore.getState;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, top: 0, w: 800 });
  const [snapX, setSnapX] = useState<number | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const total = totalDuration(clips);
  const contentW = Math.max((total + 30) * pps, view.w);
  const mediaMap = new Map(media.map((m) => [m.id, m]));
  const lanesH = tracks.reduce((h, t) => h + laneH(t), 0);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, w: el.clientWidth })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Seguir el cabezal durante la reproducción.
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (!s.playing || s.time === prev.time) return;
        const el = scrollRef.current;
        if (!el) return;
        const x = s.time * s.pps;
        if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = x - 60;
      }),
    []
  );

  // Zoom con Ctrl/⌘ + rueda, anclado al ratón.
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const s = st();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const tAtMouse = (el.scrollLeft + mx) / s.pps;
      const next = Math.max(2, Math.min(600, s.pps * Math.exp(-e.deltaY * 0.0025)));
      useStore.setState({ pps: next });
      requestAnimationFrame(() => (el.scrollLeft = tAtMouse * next - mx));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const trackAtY = (clientY: number) => {
    const el = scrollRef.current!;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop - RULER_H;
    let acc = 0;
    for (const t of tracks) {
      acc += laneH(t);
      if (y < acc) return t;
    }
    return null;
  };

  const xToTime = (clientX: number) => {
    const el = scrollRef.current!;
    return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft) / st().pps);
  };

  const scrub = (e: React.PointerEvent) => {
    useStore.setState({ playing: false });
    st().setTime(xToTime(e.clientX));
    const move = (ev: PointerEvent) => st().setTime(xToTime(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------- Arrastrar y recortar clips (según la herramienta activa) ----------
  const onClipDown = (e: React.PointerEvent, clip: Clip, mode: 'move' | 'l' | 'r') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = st();
    const track = s.tracks.find((t) => t.id === clip.trackId);
    const tool = s.tool;
    if (tool === 'razor') {
      if (track?.locked) return;
      useStore.setState({ selected: [clip.id] });
      st().splitAt(xToTime(e.clientX));
      return;
    }
    let sel = s.selected;
    if (e.shiftKey || e.metaKey || e.ctrlKey) sel = sel.includes(clip.id) ? sel.filter((i) => i !== clip.id) : [...sel, clip.id];
    else if (!sel.includes(clip.id)) sel = [clip.id];
    useStore.setState({ selected: sel });
    if (track?.locked) return;

    const startX = e.clientX;
    const group = mode === 'move' && tool === 'select' && sel.length > 1 ? s.clips.filter((c) => sel.includes(c.id)) : [clip];
    const origs = new Map(group.map((c) => [c.id, { ...c }]));
    const orig = { ...clip };
    const origEnd = orig.start + orig.duration;
    const m = clip.mediaId ? s.media.find((x) => x.id === clip.mediaId) : undefined;
    const hasSource = !!m && m.kind !== 'image';
    const others = s.clips.filter((c) => !origs.has(c.id));
    const sameTrack = others.filter((c) => c.trackId === orig.trackId);
    const prevAdj = sameTrack.find((c) => Math.abs(c.start + c.duration - orig.start) < 1e-3);
    const nextAdj = sameTrack.find((c) => Math.abs(c.start - origEnd) < 1e-3);
    const after = sameTrack.filter((c) => c.start >= origEnd - 1e-6).map((c) => ({ ...c }));
    const edges = [0, s.time, ...others.flatMap((c) => [c.start, c.start + c.duration])];
    const srcDur = (c: Clip) => {
      const mm = c.mediaId ? s.media.find((x) => x.id === c.mediaId) : undefined;
      return mm && mm.kind !== 'image' ? mm.duration : Infinity;
    };
    let committed = false;

    const snap = (t: number, pps: number) => {
      if (!st().snapping) return { t, hit: null as number | null };
      const thr = 8 / pps;
      let best: number | null = null;
      for (const ed of edges) if (Math.abs(ed - t) < thr && (best === null || Math.abs(ed - t) < Math.abs(best - t))) best = ed;
      return best === null ? { t, hit: null } : { t: best, hit: best };
    };
    const patch = (updates: Record<string, Partial<Clip>>) =>
      useStore.setState((s2) => ({ clips: s2.clips.map((c) => (updates[c.id] ? { ...c, ...updates[c.id] } : c)) }));
    const shiftAfter = (delta: number) => Object.fromEntries(after.map((c) => [c.id, { start: c.start + delta }]));

    const move = (ev: PointerEvent) => {
      const pps = st().pps;
      const dx = (ev.clientX - startX) / pps;
      if (!committed) {
        if (Math.abs(ev.clientX - startX) < 3) return;
        st().commit();
        committed = true;
        setDraggingId(clip.id);
      }
      if (mode === 'move' && tool === 'slip') {
        // Deslizar contenido: cambia qué parte del origen se ve, sin mover el clip.
        if (!hasSource) return;
        const inMax = Math.max(0, m!.duration - orig.duration * orig.speed);
        patch({ [clip.id]: { in: Math.max(0, Math.min(inMax, orig.in - dx * orig.speed)) } });
        return;
      }
      if (mode === 'move' && tool === 'slide') {
        // Desplazar: mueve el clip entre sus vecinos ajustando el final del anterior y el inicio del siguiente.
        let d = dx;
        if (prevAdj) d = Math.max(d, -(prevAdj.duration - MIN_DUR));
        else d = Math.max(d, -orig.start);
        if (prevAdj) d = Math.min(d, (srcDur(prevAdj) - prevAdj.in) / prevAdj.speed - prevAdj.duration);
        if (nextAdj) {
          d = Math.min(d, nextAdj.duration - MIN_DUR);
          d = Math.max(d, -nextAdj.in / nextAdj.speed);
        }
        const up: Record<string, Partial<Clip>> = { [clip.id]: { start: orig.start + d } };
        if (prevAdj) up[prevAdj.id] = { duration: prevAdj.duration + d };
        if (nextAdj) up[nextAdj.id] = { start: nextAdj.start + d, duration: nextAdj.duration - d, in: nextAdj.in + d * nextAdj.speed };
        patch(up);
        return;
      }
      if (mode === 'move') {
        let start = Math.max(0, orig.start + dx);
        const a = snap(start, pps);
        const b = snap(start + orig.duration, pps);
        let hit: number | null = null;
        if (a.hit !== null && (b.hit === null || Math.abs(a.t - start) <= Math.abs(b.t - start - orig.duration))) {
          start = a.t;
          hit = a.hit;
        } else if (b.hit !== null) {
          start = b.t - orig.duration;
          hit = b.hit;
        }
        setSnapX(hit);
        if (group.length === 1) {
          const target = trackAtY(ev.clientY);
          const ok = target && st().placeClip(clip.id, target.id, start);
          if (!ok) st().placeClip(clip.id, st().clips.find((c) => c.id === clip.id)!.trackId, start);
        } else {
          const shift = Math.max(start - orig.start, -Math.min(...group.map((c) => origs.get(c.id)!.start)));
          const moved = group.map((c) => ({ ...origs.get(c.id)!, start: origs.get(c.id)!.start + shift }));
          const clash = moved.some((mc) => others.some((o) => o.trackId === mc.trackId && mc.start < o.start + o.duration - 1e-6 && mc.start + mc.duration > o.start + 1e-6));
          if (!clash) useStore.setState((s2) => ({ clips: s2.clips.map((c) => moved.find((mc) => mc.id === c.id) ?? c) }));
        }
        return;
      }

      if (mode === 'l') {
        const srcMin = hasSource ? orig.start - orig.in / orig.speed : -Infinity;
        if (tool === 'roll' && prevAdj) {
          // Rodillo: mueve el punto de corte entre el anterior y este clip.
          const lo = Math.max(prevAdj.start + MIN_DUR, srcMin);
          const hi = Math.min(origEnd - MIN_DUR, prevAdj.start + (srcDur(prevAdj) - prevAdj.in) / prevAdj.speed);
          const cut = Math.max(lo, Math.min(hi, snap(orig.start + dx, pps).t));
          const d = cut - orig.start;
          patch({ [prevAdj.id]: { duration: prevAdj.duration + d }, [clip.id]: { start: cut, duration: orig.duration - d, in: orig.in + d * orig.speed, keyframes: shiftKeysOf(orig, d) } });
          return;
        }
        const prevEnd = tool === 'ripple' ? 0 : Math.max(0, ...sameTrack.filter((c) => c.start + c.duration <= orig.start + 1e-6).map((c) => c.start + c.duration));
        const ns = snap(orig.start + dx, pps);
        const start = Math.max(prevEnd, srcMin, tool === 'ripple' ? -Infinity : 0, Math.min(ns.t, origEnd - MIN_DUR));
        setSnapX(start === ns.t ? ns.hit : null);
        const delta = start - orig.start;
        const inNew = Math.max(0, orig.in + delta * orig.speed);
        if (tool === 'ripple') {
          // Rizo: el clip conserva su posición y todo lo posterior se desplaza.
          patch({ [clip.id]: { duration: orig.duration - delta, in: inNew, keyframes: shiftKeysOf(orig, delta) }, ...shiftAfter(-delta) });
        } else {
          patch({ [clip.id]: { start, duration: orig.duration - delta, in: inNew, keyframes: shiftKeysOf(orig, delta) } });
        }
        return;
      }

      // Borde derecho
      const srcMax = hasSource ? orig.start + (m!.duration - orig.in) / orig.speed : Infinity;
      if (tool === 'roll' && nextAdj) {
        const lo = Math.max(orig.start + MIN_DUR, nextAdj.start - nextAdj.in / nextAdj.speed);
        const hi = Math.min(nextAdj.start + nextAdj.duration - MIN_DUR, srcMax);
        const cut = Math.max(lo, Math.min(hi, snap(origEnd + dx, pps).t));
        const d = cut - origEnd;
        patch({ [clip.id]: { duration: orig.duration + d }, [nextAdj.id]: { start: cut, duration: nextAdj.duration - d, in: nextAdj.in + d * nextAdj.speed, keyframes: shiftKeysOf(nextAdj, d) } });
        return;
      }
      const next = tool === 'ripple' ? Infinity : Math.min(Infinity, ...sameTrack.filter((c) => c.start >= origEnd - 1e-6).map((c) => c.start));
      const ne = snap(origEnd + dx, pps);
      const end = Math.min(next, srcMax, Math.max(orig.start + MIN_DUR, ne.t));
      setSnapX(end === ne.t ? ne.hit : null);
      patch({ [clip.id]: { duration: end - orig.start }, ...(tool === 'ripple' ? shiftAfter(end - origEnd) : {}) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSnapX(null);
      setDraggingId(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onLaneDrop = async (e: React.DragEvent, track: Track) => {
    e.preventDefault();
    setDropTrack(null);
    const t = xToTime(e.clientX);
    const mediaId = e.dataTransfer.getData('application/x-media-id');
    if (mediaId) return st().addClipFromMedia(mediaId, track.id, t);
    if (e.dataTransfer.files.length) {
      const paths = Array.from(e.dataTransfer.files).map((f) => window.api.pathForFile(f)).filter(Boolean);
      const items = await st().importPaths(paths);
      let at = t;
      for (const it of items) {
        st().addClipFromMedia(it.id, track.id, at);
        at += it.kind === 'image' ? 5 : it.duration;
      }
    }
  };

  const fit = () => {
    const w = scrollRef.current?.clientWidth ?? 800;
    useStore.setState({ pps: Math.max(2, Math.min(600, (w - 60) / Math.max(5, total))) });
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  };

  const s = st();
  const hasSel = selected.length > 0;

  return (
    <div className="panel timeline-panel">
      <div className="tl-toolbar">
        <button className="icon-btn" title="Deshacer (Ctrl/⌘ Z)" disabled={!canUndo} onClick={s.undo}>
          <Undo2 size={16} />
        </button>
        <button className="icon-btn" title="Rehacer (Ctrl/⌘ Shift Z)" disabled={!canRedo} onClick={s.redo}>
          <Redo2 size={16} />
        </button>
        <div className="tl-sep" />
        <button className="icon-btn" title="Dividir en el cabezal (S)" onClick={() => s.splitAt()}>
          <Scissors size={16} />
        </button>
        <button className="icon-btn" title="Duplicar (Ctrl/⌘ D)" disabled={!hasSel} onClick={s.duplicateSelected}>
          <Copy size={15} />
        </button>
        <button className="icon-btn" title="Eliminar (Supr) · Shift+Supr cierra el hueco" disabled={!hasSel} onClick={() => s.deleteSelected()}>
          <Trash2 size={15} />
        </button>
        <div className="tl-sep" />
        <button className="icon-btn" title="Añadir texto (T)" onClick={s.addText}>
          <Type size={16} />
        </button>
        <button className={`icon-btn ${snapping ? 'on' : ''}`} title="Imán (N)" onClick={() => useStore.setState({ snapping: !snapping })}>
          <Magnet size={15} />
        </button>
        <div className="tl-sep" />
        <div className="tl-sep" />
        {TOOLS.map((t) => (
          <button key={t.id} className={`icon-btn ${tool === t.id ? 'on' : ''}`} title={`${t.name} (${t.key})`} onClick={() => useStore.setState({ tool: t.id })}>
            {t.icon}
          </button>
        ))}
        <div className="tl-sep" />
        <button className="btn ghost" style={{ height: 26, padding: '0 8px' }} onClick={() => s.addTrack('video')}>
          <Plus size={13} /> <Film size={13} />
        </button>
        <button className="btn ghost" style={{ height: 26, padding: '0 8px' }} onClick={() => s.addTrack('audio')}>
          <Plus size={13} /> <Music size={13} />
        </button>
        <button className={`icon-btn ${rightPanel === 'mixer' ? 'on' : ''}`} title="Mezclador y sonoridad" style={{ marginLeft: 6 }} onClick={() => useStore.setState({ rightPanel: rightPanel === 'mixer' ? 'inspector' : 'mixer' })}>
          <SlidersVertical size={15} />
        </button>
        <div className="tl-zoom">
          <button className="icon-btn sm" onClick={() => useStore.setState({ pps: Math.max(2, pps / 1.4) })}>
            <ZoomOut size={14} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={Math.log(pps / 2) / Math.log(300)}
            style={{ ['--p' as any]: `${(Math.log(pps / 2) / Math.log(300)) * 100}%` }}
            onChange={(e) => useStore.setState({ pps: 2 * Math.pow(300, parseFloat(e.target.value)) })}
          />
          <button className="icon-btn sm" onClick={() => useStore.setState({ pps: Math.min(600, pps * 1.4) })}>
            <ZoomIn size={14} />
          </button>
          <button className="icon-btn sm" title="Ajustar a la ventana" onClick={fit}>
            <Maximize size={13} />
          </button>
        </div>
      </div>

      <div className="tl-main">
        <div className="tl-heads">
          <div className="tl-heads-inner" style={{ transform: `translateY(${-view.top}px)` }}>
            {tracks.map((t) => (
              <TrackHead key={t.id} track={t} canRemove={tracks.filter((x) => x.kind === t.kind).length > 1} />
            ))}
          </div>
        </div>

        <div className={`tl-scroll tool-${tool}`} ref={scrollRef} onScroll={(e) => {
            const { scrollLeft, scrollTop } = e.currentTarget;
            setView((v) => ({ ...v, left: scrollLeft, top: scrollTop }));
          }}>
          <div className="tl-content" style={{ width: contentW, height: RULER_H + lanesH + 40 }}>
            <Ruler left={view.left} width={view.w} pps={pps} onPointerDown={scrub} />
            <div onPointerDown={(e) => e.target === e.currentTarget && useStore.setState({ selected: [] })}>
              {tracks.map((t) => (
                <div
                  key={t.id}
                  className={`tl-lane ${t.kind} ${dropTrack === t.id ? 'drop' : ''} ${t.locked ? 'locked' : ''}`}
                  style={{ height: laneH(t), opacity: t.hidden ? 0.45 : 1 }}
                  onPointerDown={(e) => e.target === e.currentTarget && useStore.setState({ selected: [] })}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dropTrack !== t.id) setDropTrack(t.id);
                  }}
                  onDragLeave={() => setDropTrack(null)}
                  onDrop={(e) => onLaneDrop(e, t)}
                >
                  {clips
                    .filter((c) => c.trackId === t.id)
                    .map((c) => (
                      <ClipView
                        key={c.id}
                        clip={c}
                        media={c.mediaId ? mediaMap.get(c.mediaId) : undefined}
                        pps={pps}
                        height={laneH(t) - 6}
                        selected={selected.includes(c.id)}
                        dragging={draggingId === c.id}
                        onDown={onClipDown}
                      />
                    ))}
                </div>
              ))}
            </div>
            {(markIn !== null || markOut !== null) && (
              <div className="mark-range" style={{ left: (markIn ?? 0) * pps, width: Math.max(2, ((markOut ?? markIn ?? 0) - (markIn ?? 0)) * pps) }} />
            )}
            <Playhead pps={pps} onScrub={scrub} />
            {snapX !== null && <div className="snap-line" style={{ left: snapX * pps }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackHead({ track, canRemove }: { track: Track; canRemove: boolean }) {
  const update = useStore((s) => s.updateTrack);
  const remove = useStore((s) => s.removeTrack);
  return (
    <div className="tl-head" style={{ height: laneH(track) }}>
      <span className="name">
        {track.kind === 'video' ? <Film size={12} /> : <Music size={12} />}
        {track.name}
      </span>
      {track.kind === 'video' && (
        <button className={`icon-btn sm ${track.hidden ? 'on' : ''}`} title={track.hidden ? 'Mostrar pista' : 'Ocultar pista'} onClick={() => update(track.id, { hidden: !track.hidden })}>
          {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      )}
      <button className={`icon-btn sm ${track.muted ? 'on' : ''}`} title={track.muted ? 'Activar audio' : 'Silenciar pista'} onClick={() => update(track.id, { muted: !track.muted })}>
        {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>
      <button className={`icon-btn sm ${track.locked ? 'on' : ''}`} title={track.locked ? 'Desbloquear' : 'Bloquear'} onClick={() => update(track.id, { locked: !track.locked })}>
        {track.locked ? <Lock size={12} /> : <Unlock size={12} />}
      </button>
      {canRemove && (
        <button className="icon-btn sm" title="Eliminar pista" onClick={() => remove(track.id)}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function Ruler({ left, width, pps, onPointerDown }: { left: number; width: number; pps: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fps = useStore((s) => s.settings.fps);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = RULER_H * dpr;
    c.style.width = `${width}px`;
    c.style.height = `${RULER_H}px`;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, RULER_H);
    const step = pickStep(pps);
    const minor = step / 5;
    const t0 = Math.floor(left / pps / minor) * minor;
    ctx.font = '500 10.5px "Inter Variable", system-ui';
    ctx.textBaseline = 'top';
    for (let t = t0; t * pps < left + width; t += minor) {
      const x = Math.round(t * pps - left) + 0.5;
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      ctx.fillStyle = major ? 'rgba(235,235,245,0.4)' : 'rgba(235,235,245,0.15)';
      ctx.fillRect(x, major ? 16 : 22, 1, major ? 14 : 8);
      if (major) {
        ctx.fillStyle = 'rgba(235,235,245,0.55)';
        ctx.fillText(step < 1 / 10 ? `${Math.round(t * fps)}f` : label(Math.max(0, t), step), x + 4, 5);
      }
    }
  }, [left, width, pps, fps]);
  return (
    <div className="tl-ruler" onPointerDown={onPointerDown}>
      <canvas ref={ref} style={{ left }} />
    </div>
  );
}

function Playhead({ pps, onScrub }: { pps: number; onScrub: (e: React.PointerEvent) => void }) {
  const time = useStore((s) => s.time);
  return (
    <div className="playhead" style={{ left: time * pps }}>
      <div className="knob" onPointerDown={onScrub} />
    </div>
  );
}

const ClipView = memo(function ClipView({
  clip,
  media,
  pps,
  height,
  selected,
  dragging,
  onDown,
}: {
  clip: Clip;
  media?: MediaItem;
  pps: number;
  height: number;
  selected: boolean;
  dragging: boolean;
  onDown: (e: React.PointerEvent, c: Clip, mode: 'move' | 'l' | 'r') => void;
}) {
  const w = Math.max(2, clip.duration * pps);
  const waveH = clip.kind === 'audio' ? height - 18 : Math.min(18, height - 30);
  const showWave = !!media?.peaks && (clip.kind === 'audio' || clip.kind === 'video') && !clip.muted;
  return (
    <div
      className={`clip ${clip.kind} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
      style={{ left: clip.start * pps, width: w, height }}
      onPointerDown={(e) => onDown(e, clip, 'move')}
      onDoubleClick={() => useStore.getState().setTime(clip.start)}
      onDragOver={(e) => {
        const types = e.dataTransfer.types;
        if (types.includes('application/x-transition') || types.includes('application/x-effect')) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onDrop={(e) => {
        const tr = e.dataTransfer.getData('application/x-transition');
        const fx = e.dataTransfer.getData('application/x-effect');
        if (!tr && !fx) return;
        e.preventDefault();
        e.stopPropagation();
        const s = useStore.getState();
        useStore.setState({ selected: [clip.id] });
        if (tr) s.setTransition(clip.id, tr, 1);
        else s.addEffect(fx, [clip.id]);
      }}
    >
      {media?.thumb && clip.kind !== 'audio' && <div className="strip" style={{ backgroundImage: `url("${media.thumb}")`, bottom: showWave ? waveH : 0 }} />}
      {showWave && <Wave peaks={media!.peaks!} clip={clip} width={w} height={waveH} />}
      <div className="label">
        {clip.kind === 'text' ? <Type size={11} /> : null}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.kind === 'text' ? clip.text?.content.split('\n')[0] : clip.name}</span>
        {clip.speed !== 1 && <span className="tag">{Number(clip.speed.toFixed(2))}×</span>}
        {clip.muted && <VolumeX size={11} />}
      </div>
      {clip.transitionIn && (
        <div className="trans-badge" style={{ width: Math.max(14, clip.transitionIn.duration * pps / 2) }} title={TRANSITIONS.find((t) => t.type === clip.transitionIn!.type)?.name}>
          <Blend size={10} />
        </div>
      )}
      {clip.keyframes && (
        <div className="kf-row">
          {Array.from(new Set(Object.values(clip.keyframes).flatMap((l) => (l || []).map((k) => k.t)))).map((t) => (
            <span key={t} className="kf-dot" style={{ left: t * pps }} />
          ))}
        </div>
      )}
      {(clip.effects?.length || clip.grade) ? <span className="fx-dot" title="Tiene efectos o corrección de color" /> : null}
      {clip.fadeIn > 0 && <div className="fade in" style={{ width: clip.fadeIn * pps }} />}
      {clip.fadeOut > 0 && <div className="fade out" style={{ width: clip.fadeOut * pps }} />}
      <div className="trim l" onPointerDown={(e) => onDown(e, clip, 'l')} />
      <div className="trim r" onPointerDown={(e) => onDown(e, clip, 'r')} />
    </div>
  );
});

function Wave({ peaks, clip, width, height }: { peaks: { perSec: number; data: number[] }; clip: Clip; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cw = Math.min(8000, Math.ceil(width));
  useEffect(() => {
    const c = ref.current;
    if (!c || height <= 2) return;
    c.width = cw;
    c.height = height;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, cw, height);
    ctx.fillStyle = clip.kind === 'audio' ? 'rgba(210,255,225,0.75)' : 'rgba(220,235,255,0.7)';
    const srcStart = clip.in * peaks.perSec;
    const srcLen = clip.duration * clip.speed * peaks.perSec;
    let peakMax = 1;
    for (let i = 0; i < peaks.data.length; i++) if (peaks.data[i] > peakMax) peakMax = peaks.data[i];
    const gain = Math.min(2, clip.volume) * (255 / peakMax);
    for (let x = 0; x < cw; x++) {
      const a = Math.floor(srcStart + (x / cw) * srcLen);
      const b = Math.max(a + 1, Math.floor(srcStart + ((x + 1) / cw) * srcLen));
      let max = 0;
      for (let i = a; i < b && i < peaks.data.length; i++) if (peaks.data[i] > max) max = peaks.data[i];
      const h = Math.min(1, (max / 255) * gain) * (height - 2);
      ctx.fillRect(x, (height - h) / 2, 1, Math.max(1, h));
    }
  }, [peaks, clip.in, clip.duration, clip.speed, clip.volume, clip.kind, cw, height]);
  return <canvas ref={ref} className="wave" style={{ width, height }} />;
}
