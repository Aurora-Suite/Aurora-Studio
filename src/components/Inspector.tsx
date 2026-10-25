import { Fragment, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, FlipHorizontal2, FlipVertical2, Crosshair, Minimize2, Maximize2, Bold, Italic, ChevronLeft, ChevronRight, Diamond, Trash2, Unlink, Snowflake, Plus } from 'lucide-react';
import { useStore } from '../store';
import { FONTS, formatTime } from '../lib/render';
import { EASINGS, hasKeys, keyAt, removeKey, setKey, valueAt } from '../lib/keyframes';
import { EFFECTS, TRANSITIONS, effectDef } from '../lib/effects';
import { Section, Segmented, Slider, Toggle } from './ui';
import ColorPanel from './ColorPanel';
import type { AnimProp, AudioFx, Clip, Easing, MediaItem } from '../types';

type Tab = 'video' | 'color' | 'fx' | 'text' | 'audio' | 'speed';

const RES_PRESETS = [
  { label: 'Horizontal 1080p (16:9)', w: 1920, h: 1080 },
  { label: 'Horizontal 2K / 1440p (16:9)', w: 2560, h: 1440 },
  { label: 'Horizontal 4K UHD (16:9)', w: 3840, h: 2160 },
  { label: 'Horizontal 8K UHD (16:9)', w: 7680, h: 4320 },
  { label: 'DCI 4K (17:9)', w: 4096, h: 2160 },
  { label: 'Horizontal 720p (16:9)', w: 1280, h: 720 },
  { label: 'Vertical Shorts/Reels/TikTok (9:16)', w: 1080, h: 1920 },
  { label: 'Vertical 4K (9:16)', w: 2160, h: 3840 },
  { label: 'Cuadrado (1:1)', w: 1080, h: 1080 },
  { label: 'Retrato Instagram (4:5)', w: 1080, h: 1350 },
  { label: 'Cine (21:9)', w: 2560, h: 1080 },
];

export default function Inspector({ platform }: { platform: string }) {
  const selected = useStore((s) => s.selected);
  const clip = useStore((s) => (s.selected.length === 1 ? s.clips.find((c) => c.id === s.selected[0]) : undefined));
  const media = useStore((s) => (clip?.mediaId ? s.media.find((m) => m.id === clip.mediaId) : undefined));

  return (
    <div className="panel">
      {clip ? (
        <ClipInspector key={clip.id} clip={clip} media={media} />
      ) : selected.length > 1 ? (
        <>
          <div className="panel-head">
            <h3>{selected.length} clips seleccionados</h3>
          </div>
          <div className="panel-body">
            <p className="muted">Arrástralos juntos, duplícalos con Ctrl/⌘ D o elimínalos con Supr. Desde la biblioteca puedes aplicarles efectos o looks a todos a la vez.</p>
          </div>
        </>
      ) : (
        <ProjectInspector platform={platform} />
      )}
    </div>
  );
}

function ClipInspector({ clip, media }: { clip: Clip; media?: MediaItem }) {
  const tabs: { value: Tab; label: string }[] = [];
  if (clip.kind === 'text') tabs.push({ value: 'text', label: 'Texto' });
  if (clip.kind !== 'audio') tabs.push({ value: 'video', label: clip.kind === 'text' ? 'Ajustes' : 'Vídeo' });
  if (clip.kind === 'video' || clip.kind === 'image') tabs.push({ value: 'color', label: 'Color' });
  if (clip.kind !== 'audio') tabs.push({ value: 'fx', label: 'Efectos' });
  if (clip.kind === 'audio' || (clip.kind === 'video' && media?.hasAudio)) tabs.push({ value: 'audio', label: 'Audio' });
  if (clip.kind === 'video' || clip.kind === 'audio') tabs.push({ value: 'speed', label: 'Vel.' });
  const [tab, setTab] = useState<Tab>(tabs[0].value);
  const fps = useStore((s) => s.settings.fps);

  return (
    <>
      <div className="panel-head" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div>
          <h3 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.kind === 'text' ? 'Texto' : clip.name}</h3>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(clip.start, fps)} → {formatTime(clip.start + clip.duration, fps)} · {clip.duration.toFixed(2)} s
          </div>
        </div>
        {tabs.length > 1 && <Segmented value={tab} onChange={setTab} options={tabs} />}
      </div>
      <div className="panel-body">
        {tab === 'text' && <TextPanel clip={clip} />}
        {tab === 'video' && <VideoPanel clip={clip} media={media} />}
        {tab === 'color' && <ColorPanel clip={clip} />}
        {tab === 'fx' && <EffectsPanel clip={clip} />}
        {tab === 'audio' && <AudioPanel clip={clip} />}
        {tab === 'speed' && <SpeedPanel clip={clip} media={media} />}
      </div>
    </>
  );
}

// Deslizador animable: el rombo crea/quita un keyframe en el cabezal.
function KSlider({ clip, prop, label, min, max, step, def, mult = 1, format }: {
  clip: Clip;
  prop: AnimProp;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  mult?: number;
  format?: (v: number) => string;
}) {
  const time = useStore((s) => s.time);
  const updateClip = useStore((s) => s.updateClip);
  const local = Math.max(0, Math.min(clip.duration, time - clip.start));
  const inside = time >= clip.start && time <= clip.start + clip.duration;
  const animated = hasKeys(clip, prop);
  const k = keyAt(clip, prop, local);
  const value = valueAt(clip, prop, local);
  const keys = clip.keyframes?.[prop] || [];
  const prev = [...keys].reverse().find((x) => x.t < local - 1e-3);
  const next = keys.find((x) => x.t > local + 1e-3);
  const set = (v: number) => {
    if (animated) updateClip(clip.id, setKey(clip, prop, local, v), `kf-${prop}`);
    else updateClip(clip.id, { [prop]: v }, prop);
  };
  return (
    <div className="kslider">
      <Slider label={label} value={value * mult} min={min} max={max} step={step} def={def} format={format} onChange={(v) => set(v / mult)} />
      <div className="kf-ctl">
        {animated && (
          <button className="icon-btn sm" disabled={!prev} title="Keyframe anterior" onClick={() => prev && useStore.getState().setTime(clip.start + prev.t)}>
            <ChevronLeft size={12} />
          </button>
        )}
        <button
          className={`kf-btn ${k ? 'on' : animated ? 'anim' : ''}`}
          disabled={!inside}
          title={k ? 'Quitar keyframe' : 'Añadir keyframe en el cabezal'}
          onClick={() => updateClip(clip.id, k ? removeKey(clip, prop, local) : setKey(clip, prop, local, value))}
        >
          <Diamond size={11} />
        </button>
        {animated && (
          <button className="icon-btn sm" disabled={!next} title="Keyframe siguiente" onClick={() => next && useStore.getState().setTime(clip.start + next.t)}>
            <ChevronRight size={12} />
          </button>
        )}
        {k && (
          <select
            className="ease"
            value={k.ease}
            title="Interpolación hacia el siguiente keyframe"
            onChange={(e) => {
              const list = keys.map((x) => (x === k ? { ...x, ease: e.target.value as Easing } : x));
              updateClip(clip.id, { keyframes: { ...clip.keyframes, [prop]: list } });
            }}
          >
            {EASINGS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function VideoPanel({ clip, media }: { clip: Clip; media?: MediaItem }) {
  const updateClip = useStore((s) => s.updateClip);
  const setTransition = useStore((s) => s.setTransition);
  const settings = useStore((s) => s.settings);
  const upd = (patch: Partial<Clip>, key = Object.keys(patch).join(',')) => updateClip(clip.id, patch, key);
  const fillScale = media ? Math.max(settings.width / media.width, settings.height / media.height) / Math.min(settings.width / media.width, settings.height / media.height) : 1;
  const maxFade = clip.duration / 2;
  return (
    <>
      <Section
        title="Transformación"
        right={
          <div className="row" style={{ gap: 2 }}>
            <button className="icon-btn sm" title="Centrar" onClick={() => upd({ x: 0, y: 0 }, 'center')}>
              <Crosshair size={13} />
            </button>
            {media && (
              <>
                <button className="icon-btn sm" title="Encajar" onClick={() => upd({ scale: 1, x: 0, y: 0 }, 'fit')}>
                  <Minimize2 size={13} />
                </button>
                <button className="icon-btn sm" title="Rellenar" onClick={() => upd({ scale: fillScale, x: 0, y: 0 }, 'fill')}>
                  <Maximize2 size={13} />
                </button>
              </>
            )}
            <button className={`icon-btn sm ${clip.flipH ? 'on' : ''}`} title="Voltear horizontal" onClick={() => upd({ flipH: !clip.flipH })}>
              <FlipHorizontal2 size={13} />
            </button>
            <button className={`icon-btn sm ${clip.flipV ? 'on' : ''}`} title="Voltear vertical" onClick={() => upd({ flipV: !clip.flipV })}>
              <FlipVertical2 size={13} />
            </button>
          </div>
        }
      >
        <KSlider clip={clip} prop="scale" label="Escala" min={5} max={400} step={1} def={100} mult={100} format={(v) => `${Math.round(v)}%`} />
        <KSlider clip={clip} prop="x" label="Posición X" min={-settings.width} max={settings.width} step={1} def={0} />
        <KSlider clip={clip} prop="y" label="Posición Y" min={-settings.height} max={settings.height} step={1} def={0} />
        <KSlider clip={clip} prop="rotation" label="Rotación" min={-360} max={360} step={1} def={0} format={(v) => `${Math.round(v)}°`} />
        <KSlider clip={clip} prop="opacity" label="Opacidad" min={0} max={100} step={1} def={100} mult={100} format={(v) => `${Math.round(v)}%`} />
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          Pulsa ◆ para crear un keyframe en el cabezal; muévete y cambia el valor para animar (efecto Ken Burns, zooms, entradas…).
        </p>
      </Section>
      <Section title="Transición de entrada">
        {clip.transitionIn ? (
          <>
            <div className="row">
              <select className="input" style={{ flex: 1 }} value={clip.transitionIn.type} onChange={(e) => setTransition(clip.id, e.target.value, clip.transitionIn!.duration)}>
                {TRANSITIONS.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button className="icon-btn" title="Quitar transición" onClick={() => setTransition(clip.id, null)}>
                <Trash2 size={14} />
              </button>
            </div>
            <Slider label="Duración" value={clip.transitionIn.duration} min={0.1} max={Math.max(0.2, clip.duration)} step={0.05} def={1} unit=" s" onChange={(v) => setTransition(clip.id, clip.transitionIn!.type, v)} />
          </>
        ) : (
          <button className="btn" onClick={() => setTransition(clip.id, 'fade', 1)}>
            <Plus size={14} /> Fundido cruzado con el clip anterior
          </button>
        )}
      </Section>
      <Section title="Fundidos">
        <Slider label="Entrada" value={clip.fadeIn} min={0} max={Math.max(0.1, maxFade)} step={0.05} def={0} unit=" s" onChange={(v) => upd({ fadeIn: v })} />
        <Slider label="Salida" value={clip.fadeOut} min={0} max={Math.max(0.1, maxFade)} step={0.05} def={0} unit=" s" onChange={(v) => upd({ fadeOut: v })} />
      </Section>
      {clip.kind === 'video' && (
        <Section title="Acciones">
          <div className="grid-2">
            {media?.hasAudio && (
              <button className="btn" onClick={() => useStore.getState().detachAudio(clip.id)}>
                <Unlink size={13} /> Separar audio
              </button>
            )}
            <button className="btn" onClick={() => useStore.getState().freezeFrame(clip.id)}>
              <Snowflake size={13} /> Congelar fotograma
            </button>
          </div>
        </Section>
      )}
    </>
  );
}

function EffectsPanel({ clip }: { clip: Clip }) {
  const { addEffect, updateEffect, removeEffect } = useStore.getState();
  const list = clip.effects || [];
  const cats = Array.from(new Set(EFFECTS.map((e) => e.category)));
  return (
    <>
      <Section title="Añadir efecto">
        <select
          className="input"
          value=""
          onChange={(e) => {
            if (e.target.value) addEffect(e.target.value, [clip.id]);
          }}
        >
          <option value="">Elegir efecto…</option>
          {cats.map((c) => (
            <optgroup key={c} label={c}>
              {EFFECTS.filter((e) => e.category === c).map((e) => (
                <option key={e.type} value={e.type}>
                  {e.name}
                  {e.kind === 'render' ? ' (solo render)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Section>
      {!list.length && <div className="empty">Sin efectos. También puedes arrastrarlos desde la pestaña Efectos de la biblioteca.</div>}
      {list.map((e) => {
        const def = effectDef(e.type);
        if (!def) return null;
        return (
          <Section
            key={e.id}
            title={def.name}
            right={
              <div className="row" style={{ gap: 4 }}>
                {def.kind === 'render' && <span className="badge-soft">Solo render</span>}
                <Toggle on={e.enabled} onChange={(v) => updateEffect(clip.id, e.id, { enabled: v })} />
                <button className="icon-btn sm" title="Quitar" onClick={() => removeEffect(clip.id, e.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            }
          >
            {def.params.map((p) =>
              p.type === 'color' ? (
                <div key={p.key} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="label">{p.label}</span>
                  <input type="color" className="color-input" value={String(e.params[p.key])} onChange={(ev) => updateEffect(clip.id, e.id, { params: { [p.key]: ev.target.value } }, p.key)} />
                </div>
              ) : (
                <Slider key={p.key} label={p.label} value={Number(e.params[p.key])} min={p.min!} max={p.max!} step={p.step} def={Number(p.def)} unit={p.unit} onChange={(v) => updateEffect(clip.id, e.id, { params: { [p.key]: v } }, p.key)} />
              )
            )}
          </Section>
        );
      })}
    </>
  );
}

function AudioPanel({ clip }: { clip: Clip }) {
  const updateClip = useStore((s) => s.updateClip);
  const upd = (patch: Partial<Clip>, key = Object.keys(patch).join(',')) => updateClip(clip.id, patch, key);
  const fx: AudioFx = { pan: 0, eqLow: 0, eqMid: 0, eqHigh: 0, compressor: false, denoise: 0, ...clip.audioFx };
  const setFx = (p: Partial<AudioFx>) => upd({ audioFx: { ...fx, ...p } }, `afx-${Object.keys(p).join(',')}`);
  const maxFade = clip.duration / 2;
  return (
    <>
      <Section title="Volumen" right={<Toggle on={!clip.muted} onChange={(v) => upd({ muted: !v })} />}>
        <KSlider clip={clip} prop="volume" label="Volumen" min={0} max={200} step={1} def={100} mult={100} format={(v) => `${Math.round(v)}%`} />
        <Slider label="Panorama" value={fx.pan * 100} min={-100} max={100} step={1} def={0} format={(v) => (Math.round(v) === 0 ? 'C' : v < 0 ? `I${Math.round(-v)}` : `D${Math.round(v)}`)} onChange={(v) => setFx({ pan: v / 100 })} />
      </Section>
      <Section title="Ecualizador">
        <Slider label="Graves 100 Hz" value={fx.eqLow} min={-12} max={12} step={0.5} def={0} unit=" dB" onChange={(v) => setFx({ eqLow: v })} />
        <Slider label="Medios 1 kHz" value={fx.eqMid} min={-12} max={12} step={0.5} def={0} unit=" dB" onChange={(v) => setFx({ eqMid: v })} />
        <Slider label="Agudos 8 kHz" value={fx.eqHigh} min={-12} max={12} step={0.5} def={0} unit=" dB" onChange={(v) => setFx({ eqHigh: v })} />
      </Section>
      <Section title="Dinámica y limpieza">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">Compresor de voz (−18 dB, 4:1)</span>
          <Toggle on={fx.compressor} onChange={(v) => setFx({ compressor: v })} />
        </div>
        <Slider label="Reducir ruido" value={fx.denoise * 100} min={0} max={100} step={1} def={0} format={(v) => `${Math.round(v)}%`} onChange={(v) => setFx({ denoise: v / 100 })} />
        {fx.denoise > 0 && <span className="badge-soft">La reducción de ruido se aplica al exportar</span>}
      </Section>
      <Section title="Fundidos">
        <Slider label="Entrada" value={clip.fadeIn} min={0} max={Math.max(0.1, maxFade)} step={0.05} def={0} unit=" s" onChange={(v) => upd({ fadeIn: v })} />
        <Slider label="Salida" value={clip.fadeOut} min={0} max={Math.max(0.1, maxFade)} step={0.05} def={0} unit=" s" onChange={(v) => upd({ fadeOut: v })} />
      </Section>
    </>
  );
}

function SpeedPanel({ clip, media }: { clip: Clip; media?: MediaItem }) {
  const clips = useStore((s) => s.clips);
  const updateClip = useStore((s) => s.updateClip);
  const setSpeed = (speed: number) => {
    const span = clip.duration * clip.speed;
    let duration = span / speed;
    const next = Math.min(Infinity, ...clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id && c.start >= clip.start + clip.duration - 1e-6).map((c) => c.start));
    duration = Math.min(duration, next - clip.start);
    if (media) duration = Math.min(duration, (media.duration - clip.in) / speed);
    updateClip(clip.id, { speed, duration: Math.max(1 / 30, duration) }, 'speed');
  };
  return (
    <Section title="Velocidad">
      <Slider label="Velocidad" value={clip.speed} min={0.1} max={8} step={0.05} def={1} format={(v) => `${Number(v.toFixed(2))}×`} onChange={setSpeed} />
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {[0.25, 0.5, 1, 2, 4].map((v) => (
          <button key={v} className={`btn ${clip.speed === v ? 'primary' : ''}`} onClick={() => setSpeed(v)}>
            {v}×
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5 }}>
        El audio mantiene el tono. La duración del clip se ajusta automáticamente.
      </p>
    </Section>
  );
}

function TextPanel({ clip }: { clip: Clip }) {
  const updateText = useStore((s) => s.updateText);
  const t = clip.text!;
  const upd = (p: Partial<typeof t>, key = Object.keys(p).join(',')) => updateText(clip.id, p, key);
  return (
    <>
      <Section title="Contenido">
        <textarea id="text-content" className="input" value={t.content} onChange={(e) => upd({ content: e.target.value })} rows={3} />
      </Section>
      <Section title="Tipografía">
        <select className="input" value={t.font} onChange={(e) => upd({ font: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f === 'Inter Variable' ? 'Inter' : f === 'system-ui' ? 'Sistema' : f}
            </option>
          ))}
        </select>
        <Slider label="Tamaño" value={t.size} min={12} max={400} step={1} def={96} unit=" px" onChange={(v) => upd({ size: v })} />
        <Slider label="Grosor" value={t.weight} min={100} max={900} step={100} def={700} onChange={(v) => upd({ weight: v })} />
        <div className="row">
          <Segmented
            value={t.align}
            onChange={(v) => upd({ align: v })}
            options={[
              { value: 'left', label: <AlignLeft size={14} /> },
              { value: 'center', label: <AlignCenter size={14} /> },
              { value: 'right', label: <AlignRight size={14} /> },
            ]}
          />
          <button className={`icon-btn ${t.weight >= 700 ? 'on' : ''}`} onClick={() => upd({ weight: t.weight >= 700 ? 400 : 700 })}>
            <Bold size={14} />
          </button>
          <button className={`icon-btn ${t.italic ? 'on' : ''}`} onClick={() => upd({ italic: !t.italic })}>
            <Italic size={14} />
          </button>
        </div>
      </Section>
      <Section title="Estilo">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">Color</span>
          <input type="color" className="color-input" value={t.color} onChange={(e) => upd({ color: e.target.value })} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">Contorno</span>
          <input type="color" className="color-input" value={t.strokeColor} onChange={(e) => upd({ strokeColor: e.target.value })} />
        </div>
        <Slider label="Grosor contorno" value={t.strokeWidth} min={0} max={30} step={0.5} def={0} unit=" px" onChange={(v) => upd({ strokeWidth: v })} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">Sombra</span>
          <Toggle on={t.shadow} onChange={(v) => upd({ shadow: v })} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">Fondo</span>
          <div className="row">
            {t.background && <input type="color" className="color-input" value={t.background.startsWith('#') ? t.background : '#000000'} onChange={(e) => upd({ background: e.target.value })} />}
            <Toggle on={!!t.background} onChange={(v) => upd({ background: v ? '#000000' : '' })} />
          </div>
        </div>
      </Section>
    </>
  );
}

const FPS_OPTIONS = ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'];

function ProjectInspector({ platform }: { platform: string }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const preset = RES_PRESETS.findIndex((p) => p.w === settings.width && p.h === settings.height);
  const mod = platform === 'darwin' ? '⌘' : 'Ctrl';
  const shortcuts: [string, string][] = [
    ['Reproducir / pausa', 'Espacio'],
    ['Lanzadera atrás / parar / adelante', 'J K L'],
    ['Marcar entrada / salida', 'I O'],
    ['Insertar / sobrescribir desde origen', ', .'],
    ['Dividir clip', 'S'],
    ['Selección · Rizo · Rodillo', 'V B R'],
    ['Deslizar contenido · Desplazar · Cuchilla', 'Y U C'],
    ['Eliminar / cerrar hueco', 'Supr / ⇧Supr'],
    ['Duplicar', `${mod} D`],
    ['Deshacer / rehacer', `${mod} Z / ${mod} ⇧Z`],
    ['Fotograma ± / segundo ±', '← → / ⇧← →'],
    ['Añadir texto', 'T'],
    ['Imán', 'N'],
    ['Zoom línea de tiempo', `${mod} rueda · + −`],
    ['Importar / Exportar', `${mod} I / ${mod} E`],
  ];
  return (
    <>
      <div className="panel-head">
        <h3>Proyecto</h3>
      </div>
      <div className="panel-body">
        <Section title="Lienzo">
          <select
            className="input"
            value={preset}
            onChange={(e) => {
              const p = RES_PRESETS[parseInt(e.target.value, 10)];
              if (p) setSettings({ width: p.w, height: p.h });
            }}
          >
            {preset === -1 && <option value={-1}>Personalizado</option>}
            {RES_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="grid-2">
            <div className="field">
              <label>Ancho</label>
              <input className="input" type="number" value={settings.width} step={2} onChange={(e) => setSettings({ width: Math.max(16, Math.round(+e.target.value / 2) * 2) })} />
            </div>
            <div className="field">
              <label>Alto</label>
              <input className="input" type="number" value={settings.height} step={2} onChange={(e) => setSettings({ height: Math.max(16, Math.round(+e.target.value / 2) * 2) })} />
            </div>
          </div>
          <div className="field">
            <label>Base de tiempo (fps)</label>
            <select className="input" value={String(settings.fps)} onChange={(e) => setSettings({ fps: parseFloat(e.target.value) })}>
              {FPS_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v} fps{v.includes('.') ? ' (NTSC exacto)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">Color de fondo</span>
            <input type="color" className="color-input" value={settings.background} onChange={(e) => setSettings({ background: e.target.value })} />
          </div>
        </Section>
        <Section title="Atajos de teclado">
          <div className="shortcuts">
            {shortcuts.map(([a, b]) => (
              <Fragment key={a}>
                <span>{a}</span>
                <span className="kbd">{b}</span>
              </Fragment>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
