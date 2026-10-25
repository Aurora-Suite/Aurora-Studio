import { useState } from 'react';
import { Film, Image as ImageIcon, Music, Plus, Trash2, Upload, Loader2, Type, Sparkles, FolderOpen, Blend, Wand2 } from 'lucide-react';
import { EFFECTS, TRANSITIONS } from '../lib/effects';
import { useStore, defaultText } from '../store';
import { importMedia } from '../lib/actions';
import { formatTime, LOOKS, cssFilter } from '../lib/render';
import { Segmented } from './ui';
import type { Clip, MediaItem, TextStyle } from '../types';

type Tab = 'media' | 'text' | 'trans' | 'fx' | 'looks';

const KindIcon = ({ kind }: { kind: MediaItem['kind'] }) =>
  kind === 'video' ? <Film size={12} /> : kind === 'audio' ? <Music size={12} /> : <ImageIcon size={12} />;

const TEXT_PRESETS: { name: string; style: Partial<TextStyle>; y?: number }[] = [
  { name: 'Título', style: { size: 140, weight: 800 } },
  { name: 'Subtítulo', style: { size: 64, weight: 600, content: 'Subtítulo' }, y: 380 },
  { name: 'Caja', style: { size: 72, weight: 700, background: 'rgba(0,0,0,0.65)', shadow: false, content: 'Rótulo' } },
  { name: 'Contorno', style: { size: 120, weight: 900, strokeWidth: 6, strokeColor: '#000000', shadow: false, content: 'IMPACTO', font: 'Impact' } },
  { name: 'Amarillo', style: { size: 100, weight: 900, color: '#ffd60a', strokeWidth: 5, content: 'WOW' } },
  { name: 'Elegante', style: { size: 96, weight: 400, italic: true, font: 'Georgia', content: 'Capítulo uno' } },
  { name: 'Cita', style: { size: 56, weight: 500, content: '“Una frase que\nlo cambia todo”' } },
  { name: 'Etiqueta', style: { size: 44, weight: 700, color: '#000000', background: '#ffffff', shadow: false, content: 'NUEVO' } },
];

export default function MediaBin() {
  const [tab, setTab] = useState<Tab>('media');
  const media = useStore((s) => s.media);
  const importing = useStore((s) => s.importing);
  const addClip = useStore((s) => s.addClipFromMedia);
  const removeMedia = useStore((s) => s.removeMedia);
  const selected = useStore((s) => s.selected);
  const clips = useStore((s) => s.clips);
  const selClips = clips.filter((c) => selected.includes(c.id) && c.kind !== 'audio' && c.kind !== 'text');

  const addPresetText = (p: (typeof TEXT_PRESETS)[number]) => {
    const s = useStore.getState();
    s.addText();
    const id = useStore.getState().selected[0];
    useStore.setState((st) => ({
      clips: st.clips.map((c) =>
        c.id === id ? { ...c, name: p.name, y: p.y ? (p.y * st.settings.height) / 1080 : 0, text: { ...defaultText(), ...p.style } } : c
      ),
    }));
  };

  const applyLook = (patch: Partial<Clip>) => {
    const s = useStore.getState();
    s.commit();
    useStore.setState({ clips: s.clips.map((c) => (selected.includes(c.id) && c.kind !== 'audio' ? { ...c, ...patch } : c)) });
  };

  const sampleThumb = selClips.length ? media.find((m) => m.id === selClips[0].mediaId)?.thumb : media.find((m) => m.thumb)?.thumb;

  return (
    <div className="panel">
      <div className="panel-head" style={{ paddingBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'media', label: <span title="Medios"><FolderOpen size={14} /></span> },
              { value: 'text', label: <span title="Texto"><Type size={14} /></span> },
              { value: 'trans', label: <span title="Transiciones"><Blend size={14} /></span> },
              { value: 'fx', label: <span title="Efectos"><Wand2 size={14} /></span> },
              { value: 'looks', label: <span title="Looks de color"><Sparkles size={14} /></span> },
            ]}
          />
        </div>
      </div>
      <div className="panel-body">
        {tab === 'media' && (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <button className="btn" style={{ flex: 1 }} onClick={importMedia}>
                <Upload size={14} /> Importar
              </button>
              {importing > 0 && <Loader2 size={16} className="spin muted" />}
            </div>
            {media.length === 0 ? (
              <div className="dropzone">
                <Upload size={22} />
                <div>
                  Arrastra aquí vídeos, audio o imágenes
                  <br />
                  <span style={{ color: 'var(--text-3)' }}>MP4 · MOV · MKV · WEBM · MP3 · WAV · PNG · JPG</span>
                </div>
              </div>
            ) : (
              <div className="media-grid">
                {media.map((m) => (
                  <div
                    key={m.id}
                    className="media-card"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-media-id', m.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onDoubleClick={() => useStore.getState().openSource(m.id)}
                    title={`${m.name}\n${m.width ? `${m.width}×${m.height} · ` : ''}${m.kind === 'image' ? 'Imagen' : formatTime(m.duration)}`}
                  >
                    <div className="thumb" style={m.thumb ? { backgroundImage: `url("${m.thumb}")` } : undefined}>
                      {!m.thumb && <KindIcon kind={m.kind} />}
                      <span className="kind">
                        <KindIcon kind={m.kind} />
                      </span>
                      {m.kind !== 'image' && <span className="badge">{formatTime(m.duration).slice(0, -3)}</span>}
                      <div className="actions">
                        <button title="Añadir a la línea de tiempo" onClick={() => addClip(m.id)}>
                          <Plus size={13} />
                        </button>
                        <button title="Quitar del proyecto" onClick={() => removeMedia(m.id)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="meta">{m.name}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'text' && (
          <div className="grid-2">
            {TEXT_PRESETS.map((p) => (
              <button key={p.name} className="preset-card" onClick={() => addPresetText(p)}>
                <span
                  style={{
                    fontFamily: `"${p.style.font || 'Inter Variable'}"`,
                    fontWeight: p.style.weight,
                    fontStyle: p.style.italic ? 'italic' : undefined,
                    color: p.style.color || '#fff',
                    background: p.style.background || undefined,
                    padding: p.style.background ? '2px 8px' : undefined,
                    borderRadius: 5,
                    fontSize: 17,
                    WebkitTextStroke: p.style.strokeWidth ? '1px #000' : undefined,
                  }}
                >
                  {p.name}
                </span>
              </button>
            ))}
          </div>
        )}

        {tab === 'trans' && (
          <>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.5 }}>
              Arrastra una transición sobre el segundo de dos clips pegados, o selecciónalo y haz clic.
            </p>
            {Array.from(new Set(TRANSITIONS.map((t) => t.group))).map((g) => (
              <div key={g} style={{ marginBottom: 12 }}>
                <div className="section-title" style={{ marginBottom: 6 }}>{g}</div>
                <div className="grid-2">
                  {TRANSITIONS.filter((t) => t.group === g).map((t) => (
                    <button
                      key={t.type}
                      className="chip-card"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/x-transition', t.type)}
                      onClick={() => {
                        const id = useStore.getState().selected[0];
                        if (id) useStore.getState().setTransition(id, t.type, 1);
                        else useStore.getState().notify('Selecciona el clip que recibe la transición');
                      }}
                    >
                      <span className={`tr-icon tr-${t.type}`} />
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === 'fx' && (
          <>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.5 }}>
              Arrastra un efecto sobre un clip o haz clic para aplicarlo a la selección.
            </p>
            {Array.from(new Set(EFFECTS.map((e) => e.category))).map((c) => (
              <div key={c} style={{ marginBottom: 12 }}>
                <div className="section-title" style={{ marginBottom: 6 }}>{c}</div>
                <div className="grid-2">
                  {EFFECTS.filter((e) => e.category === c).map((e) => (
                    <button key={e.type} className="chip-card" draggable onDragStart={(ev) => ev.dataTransfer.setData('application/x-effect', e.type)} onClick={() => useStore.getState().addEffect(e.type)}>
                      <Wand2 size={12} />
                      {e.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === 'looks' && (
          <>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.5 }}>
              {selClips.length ? `Aplica un filtro a ${selClips.length === 1 ? 'el clip seleccionado' : `${selClips.length} clips`}.` : 'Selecciona un clip de vídeo o imagen para aplicar un filtro.'}
            </p>
            <div className="grid-2">
              {LOOKS.map((l) => (
                <button key={l.name} className="look-card" disabled={!selClips.length} onClick={() => applyLook(l.patch)} style={{ opacity: selClips.length ? 1 : 0.5, padding: 0, textAlign: 'left' }}>
                  <div className="swatch" style={{ backgroundImage: sampleThumb ? `url("${sampleThumb}")` : undefined, filter: cssFilter({ brightness: 0, contrast: 1, saturation: 1, hue: 0, blur: 0, ...l.patch } as Clip, 0.3) }} />
                  <div className="meta">{l.name}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
