import { X, RotateCcw } from 'lucide-react';
import { useStore } from '../store';
import { audioEngine } from '../lib/audio';
import { useMeter } from './Viewer';
import type { Track } from '../types';

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '−∞');
const toDb = (g: number) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
// Fader con respuesta en dB (−60..+12).
const faderToGain = (f: number) => (f <= 0 ? 0 : Math.pow(10, (f * 72 - 60) / 20));
const gainToFader = (g: number) => (g <= 0 ? 0 : Math.max(0, Math.min(1, (toDb(g) + 60) / 72)));
const meterPct = (dbv: number) => `${Math.max(0, Math.min(100, ((dbv + 60) / 66) * 100))}%`;

function Strip({ track, level }: { track: Track; level: number }) {
  const update = useStore((s) => s.updateTrack);
  const set = (patch: Partial<Track>) => {
    useStore.getState().commit(`track-${track.id}`);
    useStore.setState((s) => ({ tracks: s.tracks.map((t) => (t.id === track.id ? { ...t, ...patch } : t)) }));
  };
  const vol = track.volume ?? 1;
  return (
    <div className="strip">
      <div className="strip-name">{track.name}</div>
      <input className="pan" type="range" min={-1} max={1} step={0.01} value={track.pan ?? 0} title={`Pan ${Math.round((track.pan ?? 0) * 100)}`} onChange={(e) => set({ pan: +e.target.value })} onDoubleClick={() => set({ pan: 0 })} />
      <div className="strip-body">
        <div className="meter">
          <div style={{ height: meterPct(level) }} className={level > -1 ? 'clip' : ''} />
        </div>
        <input className="fader" type="range" min={0} max={1} step={0.001} value={gainToFader(vol)} onChange={(e) => set({ volume: faderToGain(+e.target.value) })} onDoubleClick={() => set({ volume: 1 })} />
      </div>
      <div className="strip-db">{fmt(toDb(vol))} dB</div>
      <div className="row" style={{ gap: 3 }}>
        <button className={`ms ${track.muted ? 'm' : ''}`} onClick={() => update(track.id, { muted: !track.muted })}>
          M
        </button>
        <button className={`ms ${track.solo ? 's' : ''}`} onClick={() => update(track.id, { solo: !track.solo })}>
          S
        </button>
      </div>
    </div>
  );
}

export default function Mixer() {
  const tracks = useStore((s) => s.tracks);
  const clips = useStore((s) => s.clips);
  const media = useStore((s) => s.media);
  const r = useMeter();
  const withAudio = tracks.filter((t) => t.kind === 'audio' || clips.some((c) => c.trackId === t.id && c.kind === 'video' && media.find((m) => m.id === c.mediaId)?.hasAudio));
  const target = -14;
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Mezclador</h3>
        <button className="icon-btn sm" title="Cerrar" onClick={() => useStore.setState({ rightPanel: 'inspector' })}>
          <X size={14} />
        </button>
      </div>
      <div className="panel-body">
        <div className="loudness">
          <div className="lu-big">
            <span>{fmt(r?.shortTerm ?? -Infinity)}</span>
            <small>LUFS corto plazo</small>
          </div>
          <div className="lu-grid">
            <span>Momentánea</span>
            <b>{fmt(r?.momentary ?? -Infinity)}</b>
            <span>Integrada</span>
            <b className={r && Number.isFinite(r.integrated) && Math.abs(r.integrated - target) > 2 ? 'warn' : ''}>{fmt(r?.integrated ?? -Infinity)}</b>
            <span>Pico L / R</span>
            <b className={(r?.peakL ?? -99) > -1 || (r?.peakR ?? -99) > -1 ? 'warn' : ''}>
              {fmt(r?.peakL ?? -Infinity)} / {fmt(r?.peakR ?? -Infinity)} dB
            </b>
          </div>
          <button className="btn ghost" style={{ height: 24 }} onClick={() => audioEngine.resetIntegrated()}>
            <RotateCcw size={12} /> Reiniciar integrada
          </button>
          <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
            Referencia: YouTube/Spotify −14 LUFS, Apple −16, TV EBU R128 −23. Al exportar puedes normalizar al objetivo.
          </p>
        </div>
        <div className="mixer">
          {withAudio.map((t) => (
            <Strip key={t.id} track={t} level={r?.tracks[t.id] ?? -Infinity} />
          ))}
          <div className="strip master">
            <div className="strip-name">Máster</div>
            <div className="strip-body" style={{ marginTop: 26 }}>
              <div className="meter">
                <div style={{ height: meterPct(r?.peakL ?? -Infinity) }} />
              </div>
              <div className="meter">
                <div style={{ height: meterPct(r?.peakR ?? -Infinity) }} />
              </div>
            </div>
          </div>
        </div>
        {!withAudio.length && <div className="empty">No hay pistas con audio.</div>}
      </div>
    </div>
  );
}
