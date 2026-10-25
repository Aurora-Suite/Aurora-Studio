import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, Activity, Grid3x3, Maximize2, ArrowDownToLine, Replace, CornerDownRight, CornerDownLeft } from 'lucide-react';
import { useStore, totalDuration } from '../store';
import { clipBox, formatTime, layersAt } from '../lib/render';
import { stepFrames, togglePlay } from '../lib/actions';
import { createEngine } from '../lib/engine';
import { audioEngine, type MeterReading } from '../lib/audio';
import { hasKeys, setKey, valueAt } from '../lib/keyframes';
import { Segmented } from './ui';
import type { AnimProp, Clip } from '../types';

export default function Viewer() {
  const monitor = useStore((s) => s.monitor);
  return (
    <div className="panel viewer">
      <div className="viewer-tabs">
        <Segmented
          value={monitor}
          onChange={(v) => useStore.setState({ monitor: v, playing: false })}
          options={[
            { value: 'source', label: 'Origen' },
            { value: 'program', label: 'Programa' },
          ]}
        />
      </div>
      <ProgramMonitor />
      {monitor === 'source' && (
        <div className="source-layer">
          <SourceMonitor />
        </div>
      )}
    </div>
  );
}

function useFit(stageRef: React.RefObject<HTMLDivElement | null>, w: number, h: number, key?: string) {
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const pad = 20;
      const aw = el.clientWidth - pad * 2;
      const ah = el.clientHeight - pad * 2;
      const r = w / Math.max(1, h);
      let dw = aw;
      let dh = aw / r;
      if (dh > ah) {
        dh = ah;
        dw = ah * r;
      }
      setDisp({ w: Math.max(0, Math.floor(dw)), h: Math.max(0, Math.floor(dh)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h, key]);
  return disp;
}

function ProgramMonitor() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scopeRef = useRef<HTMLCanvasElement>(null);
  const settings = useStore((s) => s.settings);
  const playing = useStore((s) => s.playing);
  const shuttle = useStore((s) => s.shuttle);
  const showScopes = useStore((s) => s.showScopes);
  const disp = useFit(stageRef, settings.width, settings.height);
  const [guides, setGuides] = useState(false);
  const [glError, setGlError] = useState('');

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(2, Math.min(settings.width, Math.round(disp.w * dpr)));
    c.height = Math.max(2, Math.round((c.width * settings.height) / settings.width));
  }, [disp.w, settings.width, settings.height]);

  useEffect(() => {
    try {
      const e = createEngine(canvasRef.current!, () => (useStore.getState().showScopes ? scopeRef.current : null));
      return () => e.stop();
    } catch (err) {
      setGlError(String((err as Error).message || err));
    }
  }, []);

  return (
    <>
      <div className="viewer-stage" ref={stageRef}>
        <div className="viewer-canvas-wrap" style={{ width: disp.w, height: disp.h }}>
          <canvas ref={canvasRef} />
          {guides && <div className="guides" />}
          <TransformOverlay disp={disp} />
        </div>
        {glError && <div className="empty" style={{ position: 'absolute' }}>Error de GPU: {glError}</div>}
        {showScopes && (
          <div className="scopes">
            <div className="lbl">Histograma · Forma de onda</div>
            <canvas ref={scopeRef} width={240} height={150} />
          </div>
        )}
      </div>
      <div className="transport">
        <Timecode />
        <LoudnessMini />
        <div style={{ flex: 1 }} />
        <button className="icon-btn" title="Inicio (Inicio)" onClick={() => useStore.getState().setTime(0)}>
          <SkipBack size={16} />
        </button>
        <button className="icon-btn" title="Fotograma anterior (←)" onClick={() => stepFrames(-1)}>
          <ChevronLeft size={18} />
        </button>
        <button className="play-btn" title="Reproducir / pausa (Espacio) · J K L para velocidad" onClick={togglePlay}>
          {playing ? <Pause size={16} fill="#000" /> : <Play size={16} fill="#000" style={{ marginLeft: 2 }} />}
        </button>
        <button className="icon-btn" title="Fotograma siguiente (→)" onClick={() => stepFrames(1)}>
          <ChevronRight size={18} />
        </button>
        <button className="icon-btn" title="Final (Fin)" onClick={() => useStore.getState().setTime(totalDuration(useStore.getState().clips))}>
          <SkipForward size={16} />
        </button>
        {playing && shuttle !== 1 && <span className="shuttle">{shuttle > 0 ? '▶' : '◀'} {Math.abs(shuttle)}×</span>}
        <div style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11.5, marginRight: 6 }}>
          {settings.width}×{settings.height} · {settings.fps} fps
        </span>
        <button className={`icon-btn ${guides ? 'on' : ''}`} title="Guías y zona segura" onClick={() => setGuides(!guides)}>
          <Grid3x3 size={15} />
        </button>
        <button className={`icon-btn ${showScopes ? 'on' : ''}`} title="Scopes de vídeo" onClick={() => useStore.setState({ showScopes: !showScopes })}>
          <Activity size={15} />
        </button>
        <button className="icon-btn" title="Pantalla completa" onClick={() => stageRef.current?.requestFullscreen?.()}>
          <Maximize2 size={15} />
        </button>
      </div>
    </>
  );
}

// Monitor de origen: revisar un medio, marcar entrada/salida e insertarlo o sobrescribirlo en la línea de tiempo.
export const sourceCtl = { toggle: () => {}, markIn: () => {}, markOut: () => {} };

function SourceMonitor() {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const source = useStore((s) => s.source);
  const m = useStore((s) => s.media.find((x) => x.id === s.source.mediaId));
  const fps = useStore((s) => s.settings.fps);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const disp = useFit(stageRef, m?.width || 16, m?.height || 9, m?.id);
  const dur = m ? (m.kind === 'image' ? 5 : m.duration) : 0;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const loop = () => {
      setTime(v.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [m?.id]);

  const set = (patch: Partial<typeof source>) => useStore.setState({ source: { ...useStore.getState().source, ...patch } });
  sourceCtl.toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  sourceCtl.markIn = () => set({ in: m?.kind === 'image' ? 0 : time });
  sourceCtl.markOut = () => set({ out: m?.kind === 'image' ? 5 : time });

  if (!m) {
    return (
      <div className="viewer-stage">
        <div className="empty">Haz doble clic en un medio de la biblioteca para abrirlo aquí, marca entrada (I) y salida (O), e insértalo (,) o sobrescríbelo (.) en el cabezal.</div>
      </div>
    );
  }
  const pct = (v: number) => `${(v / Math.max(0.001, dur)) * 100}%`;
  return (
    <>
      <div className="viewer-stage" ref={stageRef}>
        <div className="viewer-canvas-wrap" style={{ width: disp.w, height: disp.h, background: '#000' }}>
          {m.kind === 'image' ? (
            <img src={m.url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <video
              ref={videoRef}
              src={m.url}
              style={{ width: '100%', height: '100%', display: 'block', background: '#000' }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              poster={m.thumb}
            />
          )}
        </div>
      </div>
      <div
        className="source-bar"
        onPointerDown={(e) => {
          const el = e.currentTarget;
          const seek = (x: number) => {
            const r = el.getBoundingClientRect();
            if (videoRef.current) videoRef.current.currentTime = Math.max(0, Math.min(dur, ((x - r.left) / r.width) * dur));
          };
          seek(e.clientX);
          const mv = (ev: PointerEvent) => seek(ev.clientX);
          const up = () => (window.removeEventListener('pointermove', mv), window.removeEventListener('pointerup', up));
          window.addEventListener('pointermove', mv);
          window.addEventListener('pointerup', up);
        }}
      >
        {(source.in !== null || source.out !== null) && <div className="range" style={{ left: pct(source.in ?? 0), right: `calc(100% - ${pct(source.out ?? dur)})` }} />}
        <div className="head" style={{ left: pct(time) }} />
      </div>
      <div className="transport">
        <div className="timecode">
          {formatTime(time, fps)}
          <span className="total"> · E {source.in !== null ? formatTime(source.in, fps) : '—'} · S {source.out !== null ? formatTime(source.out, fps) : '—'}</span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="icon-btn" title="Marcar entrada (I)" onClick={sourceCtl.markIn}>
          <CornerDownRight size={15} />
        </button>
        <button className="play-btn" onClick={sourceCtl.toggle} disabled={m.kind === 'image'}>
          {playing ? <Pause size={16} fill="#000" /> : <Play size={16} fill="#000" style={{ marginLeft: 2 }} />}
        </button>
        <button className="icon-btn" title="Marcar salida (O)" onClick={sourceCtl.markOut}>
          <CornerDownLeft size={15} />
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn" title="Insertar en el cabezal desplazando lo demás (,)" onClick={() => useStore.getState().editFromSource('insert')}>
          <ArrowDownToLine size={14} /> Insertar
        </button>
        <button className="btn" title="Sobrescribir en el cabezal (.)" onClick={() => useStore.getState().editFromSource('overwrite')}>
          <Replace size={14} /> Sobrescribir
        </button>
      </div>
    </>
  );
}

function Timecode() {
  const time = useStore((s) => s.time);
  const fps = useStore((s) => s.settings.fps);
  const total = useStore((s) => totalDuration(s.clips));
  return (
    <div className="timecode">
      {formatTime(time, fps)} <span className="total">/ {formatTime(total, fps)}</span>
    </div>
  );
}

const fmtL = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '−∞');

export function useMeter() {
  const [r, setR] = useState<MeterReading | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last > 66) {
        last = now;
        setR(audioEngine.read(useStore.getState().playing));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return r;
}

function LoudnessMini() {
  const r = useMeter();
  const bar = (dbv: number) => `${Math.max(0, Math.min(100, ((dbv + 60) / 60) * 100))}%`;
  return (
    <div className="lufs-mini" title="Sonoridad EBU R128: momentánea · integrada (LUFS)">
      <div className="bars">
        <div style={{ width: bar(r?.peakL ?? -Infinity) }} />
        <div style={{ width: bar(r?.peakR ?? -Infinity) }} />
      </div>
      <span>M {fmtL(r?.momentary ?? -Infinity)}</span>
      <span>I {fmtL(r?.integrated ?? -Infinity)}</span>
    </div>
  );
}

// Selección y manipulación directa sobre la imagen. Si la propiedad tiene keyframes, se fija uno en el cabezal.
function TransformOverlay({ disp }: { disp: { w: number; h: number } }) {
  const settings = useStore((s) => s.settings);
  const clips = useStore((s) => s.clips);
  const tracks = useStore((s) => s.tracks);
  const media = useStore((s) => s.media);
  const selected = useStore((s) => s.selected);
  const time = useStore((s) => s.time);
  const measure = useRef(document.createElement('canvas').getContext('2d')!);
  const drag = useRef<null | { mode: 'move' | 'scale' | 'rotate'; id: string; px: number; py: number; x: number; y: number; scale: number; rotation: number; d0: number; a0: number }>(null);
  const k = disp.w / settings.width;
  const mediaMap = new Map(media.map((m) => [m.id, m]));
  const visible = layersAt(clips, tracks, time);
  const st = (c: Clip) => {
    const l = time - c.start;
    return { x: valueAt(c, 'x', l), y: valueAt(c, 'y', l), scale: valueAt(c, 'scale', l), rotation: valueAt(c, 'rotation', l) };
  };

  const toProject = (e: React.PointerEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * settings.width - settings.width / 2, y: ((e.clientY - r.top) / r.height) * settings.height - settings.height / 2 };
  };

  const hit = (p: { x: number; y: number }) => {
    for (let i = visible.length - 1; i >= 0; i--) {
      const c = visible[i];
      if (tracks.find((t) => t.id === c.trackId)?.locked) continue;
      const s = st(c);
      const { w, h } = clipBox(measure.current, c, c.mediaId ? mediaMap.get(c.mediaId) : undefined, settings, s.scale);
      const a = (-s.rotation * Math.PI) / 180;
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return c;
    }
    return null;
  };

  const sel = selected.length === 1 ? visible.find((c) => c.id === selected[0]) : undefined;
  const sst = sel ? st(sel) : null;
  const box = sel && sst ? clipBox(measure.current, sel, sel.mediaId ? mediaMap.get(sel.mediaId) : undefined, settings, sst.scale) : null;

  // Aplica un valor: con keyframes crea/actualiza el del cabezal; sin ellos cambia el valor fijo.
  const apply = (id: string, values: Partial<Record<AnimProp, number>>, key: string) => {
    const s = useStore.getState();
    let c = s.clips.find((x) => x.id === id)!;
    let patch: Partial<Clip> = {};
    for (const [p, v] of Object.entries(values) as [AnimProp, number][]) {
      if (hasKeys(c, p)) {
        const kp = setKey(c, p, s.time - c.start, v);
        patch = { ...patch, ...kp };
        c = { ...c, ...kp };
      } else patch[p] = v;
    }
    s.updateClip(id, patch, key);
  };

  const begin = (e: React.PointerEvent, mode: 'move' | 'scale' | 'rotate', c: Clip, root: HTMLElement) => {
    const p = toProject(e, root);
    const s = st(c);
    drag.current = { mode, id: c.id, px: p.x, py: p.y, x: s.x, y: s.y, scale: s.scale, rotation: s.rotation, d0: Math.hypot(p.x - s.x, p.y - s.y) || 1, a0: Math.atan2(p.y - s.y, p.x - s.x) };
    root.setPointerCapture(e.pointerId);
  };

  return (
    <div
      className="viewer-overlay"
      onPointerDown={(e) => {
        const root = e.currentTarget;
        const target = e.target as HTMLElement;
        if (target.dataset.handle && sel) {
          e.stopPropagation();
          return begin(e, target.dataset.handle as 'scale' | 'rotate', sel, root);
        }
        const c = hit(toProject(e, root));
        if (!c) {
          useStore.setState({ selected: [] });
          return;
        }
        useStore.setState({ selected: [c.id] });
        begin(e, 'move', c, root);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const p = toProject(e, e.currentTarget);
        if (d.mode === 'move') {
          let x = d.x + (p.x - d.px);
          let y = d.y + (p.y - d.py);
          const snap = 12 / k;
          if (!e.altKey) {
            if (Math.abs(x) < snap) x = 0;
            if (Math.abs(y) < snap) y = 0;
          }
          if (e.shiftKey) Math.abs(x - d.x) > Math.abs(y - d.y) ? (y = d.y) : (x = d.x);
          apply(d.id, { x: Math.round(x), y: Math.round(y) }, 'canvas-move');
        } else if (d.mode === 'scale') {
          const dist = Math.hypot(p.x - d.x, p.y - d.y);
          apply(d.id, { scale: Math.max(0.05, Math.min(10, (d.scale * dist) / d.d0)) }, 'canvas-scale');
        } else {
          let deg = d.rotation + ((Math.atan2(p.y - d.y, p.x - d.x) - d.a0) * 180) / Math.PI;
          if (e.shiftKey) deg = Math.round(deg / 15) * 15;
          apply(d.id, { rotation: Math.round(((deg + 540) % 360) - 180) }, 'canvas-rotate');
        }
      }}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => sel?.kind === 'text' && document.querySelector<HTMLTextAreaElement>('#text-content')?.focus()}
    >
      {sel && box && sst && (
        <div
          className="selection-box"
          style={{
            left: (settings.width / 2 + sst.x - box.w / 2) * k,
            top: (settings.height / 2 + sst.y - box.h / 2) * k,
            width: box.w * k,
            height: box.h * k,
            transform: `rotate(${sst.rotation}deg)`,
          }}
        >
          {[
            [-5, -5],
            [box.w * k - 5, -5],
            [-5, box.h * k - 5],
            [box.w * k - 5, box.h * k - 5],
          ].map(([l, t], i) => (
            <div key={i} className="h" data-handle="scale" style={{ left: l, top: t, cursor: 'nwse-resize' }} />
          ))}
          <div className="h" data-handle="rotate" style={{ left: (box.w * k) / 2 - 5, top: -28, borderRadius: '50%', cursor: 'grab' }} />
        </div>
      )}
    </div>
  );
}
