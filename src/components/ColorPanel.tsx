import { useRef, useState } from 'react';
import { RotateCcw, Upload, X } from 'lucide-react';
import { useStore } from '../store';
import { curveTable, defaultGrade, parseCube } from '../lib/color';
import { Section, Segmented, Slider, Toggle } from './ui';
import type { Clip, CurvePoint, Grade, RGBW } from '../types';

// Rueda de color: el punto codifica un desplazamiento de crominancia (r,g,b de media cero).
function Wheel({ label, value, neutral, range, masterMin, masterMax, onChange }: {
  label: string;
  value: RGBW;
  neutral: number;
  range: number;
  masterMin: number;
  masterMax: number;
  onChange: (v: RGBW) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dr = value.r - neutral, dg = value.g - neutral, db = value.b - neutral;
  const px = dr - 0.5 * (dg + db);
  const py = (Math.sqrt(3) / 2) * (dg - db);
  const R = 52;
  const mag = Math.min(1, Math.hypot(px, py) / range);
  const ang = Math.atan2(py, px);
  const set = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    let x = (clientX - r.left - r.width / 2) / R;
    let y = (clientY - r.top - r.height / 2) / R;
    const l = Math.hypot(x, y);
    if (l > 1) (x /= l), (y /= l);
    const a = Math.min(1, Math.hypot(x, y)) * range;
    const th = Math.atan2(y, x);
    const k = (2 / 3) * a;
    onChange({ ...value, r: neutral + k * Math.cos(th), g: neutral + k * Math.cos(th - (2 * Math.PI) / 3), b: neutral + k * Math.cos(th + (2 * Math.PI) / 3) });
  };
  return (
    <div className="wheel-wrap">
      <div className="wheel-label">
        <span>{label}</span>
        <button className="icon-btn sm" title="Restablecer" onClick={() => onChange({ r: neutral, g: neutral, b: neutral, m: neutral === 0 ? 0 : 1 })}>
          <RotateCcw size={11} />
        </button>
      </div>
      <div
        ref={ref}
        className="wheel"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          set(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => e.buttons && set(e.clientX, e.clientY)}
        onDoubleClick={() => onChange({ ...value, r: neutral, g: neutral, b: neutral })}
      >
        <div className="puck" style={{ left: `calc(50% + ${Math.cos(ang) * mag * R}px)`, top: `calc(50% + ${Math.sin(ang) * mag * R}px)` }} />
      </div>
      <input type="range" className="wheel-master" min={masterMin} max={masterMax} step={0.005} value={value.m} style={{ ['--p' as any]: `${((value.m - masterMin) / (masterMax - masterMin)) * 100}%` }} onChange={(e) => onChange({ ...value, m: +e.target.value })} onDoubleClick={() => onChange({ ...value, m: neutral === 0 ? 0 : 1 })} />
    </div>
  );
}

const CH_COLOR: Record<string, string> = { m: '#f5f5f7', r: '#ff453a', g: '#30d158', b: '#0a84ff' };

function Curves({ curves, onChange }: { curves: Grade['curves']; onChange: (c: Grade['curves']) => void }) {
  const [ch, setCh] = useState<'m' | 'r' | 'g' | 'b'>('m');
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const S = 220;
  const pts = curves[ch];
  const tab = curveTable(pts, 128);
  const path = Array.from(tab, (v, i) => `${i ? 'L' : 'M'}${((i / 127) * S).toFixed(1)},${((1 - Math.max(0, Math.min(1, v))) * S).toFixed(1)}`).join(' ');
  const toPt = (e: React.PointerEvent): CurvePoint => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))];
  };
  const setPts = (p: CurvePoint[]) => onChange({ ...curves, [ch]: p });
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <Segmented value={ch} onChange={setCh} options={(['m', 'r', 'g', 'b'] as const).map((k) => ({ value: k, label: <span style={{ color: CH_COLOR[k] }}>{k === 'm' ? 'Luma' : k.toUpperCase()}</span> }))} />
        <button className="icon-btn sm" title="Restablecer curva" onClick={() => setPts([[0, 0], [1, 1]])}>
          <RotateCcw size={12} />
        </button>
      </div>
      <svg
        ref={ref}
        className="curves"
        viewBox={`0 0 ${S} ${S}`}
        onPointerDown={(e) => {
          const p = toPt(e);
          let i = pts.findIndex(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 0.05);
          if (i < 0) {
            const next = [...pts, p].sort((a, b) => a[0] - b[0]);
            i = next.indexOf(p);
            setPts(next);
          }
          drag.current = i;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const p = toPt(e);
          const i = drag.current;
          const next = pts.map((q) => [...q] as CurvePoint);
          const lo = i > 0 ? next[i - 1][0] + 0.01 : 0;
          const hi = i < next.length - 1 ? next[i + 1][0] - 0.01 : 1;
          next[i] = [i === 0 ? 0 : i === next.length - 1 ? 1 : Math.max(lo, Math.min(hi, p[0])), p[1]];
          setPts(next);
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={(e) => {
          const p = toPt(e as any);
          const i = pts.findIndex(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 0.05);
          if (i > 0 && i < pts.length - 1) setPts(pts.filter((_, j) => j !== i));
        }}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} stroke="rgba(255,255,255,0.08)">
            <line x1={g * S} y1={0} x2={g * S} y2={S} />
            <line x1={0} y1={g * S} x2={S} y2={g * S} />
          </g>
        ))}
        <line x1={0} y1={S} x2={S} y2={0} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 4" />
        <path d={path} fill="none" stroke={CH_COLOR[ch]} strokeWidth={2} />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x * S} cy={(1 - y) * S} r={5} fill="#1c1c1e" stroke={CH_COLOR[ch]} strokeWidth={2} />
        ))}
      </svg>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 11 }}>
        Clic para añadir un punto · arrastra · doble clic para quitarlo
      </p>
    </div>
  );
}

export default function ColorPanel({ clip }: { clip: Clip }) {
  const updateGrade = useStore((s) => s.updateGrade);
  const notify = useStore((s) => s.notify);
  const g = clip.grade ?? defaultGrade();
  const upd = (patch: Partial<Grade>, key = Object.keys(patch).join(',')) => updateGrade(clip.id, patch, key);
  const hsl = g.hsl;
  const setHsl = (p: Partial<Grade['hsl']>) => upd({ hsl: { ...hsl, ...p } }, 'hsl');

  return (
    <>
      <Section
        title="Básicos"
        right={
          <button className="icon-btn sm" title="Restablecer toda la gradación" onClick={() => useStore.getState().updateClip(clip.id, { grade: undefined, brightness: 0, contrast: 1, saturation: 1, hue: 0 })}>
            <RotateCcw size={12} />
          </button>
        }
      >
        <Slider label="Exposición" value={g.exposure} min={-3} max={3} step={0.01} def={0} unit=" EV" onChange={(v) => upd({ exposure: v })} />
        <Slider label="Contraste" value={g.contrast} min={-1} max={1} step={0.01} def={0} onChange={(v) => upd({ contrast: v })} />
        <Slider label="Altas luces" value={g.highlights} min={-1} max={1} step={0.01} def={0} onChange={(v) => upd({ highlights: v })} />
        <Slider label="Sombras" value={g.shadows} min={-1} max={1} step={0.01} def={0} onChange={(v) => upd({ shadows: v })} />
        <Slider label="Blancos" value={g.whites} min={-1} max={1} step={0.01} def={0} onChange={(v) => upd({ whites: v })} />
        <Slider label="Negros" value={g.blacks} min={-1} max={1} step={0.01} def={0} onChange={(v) => upd({ blacks: v })} />
        <Slider label="Temperatura" value={g.temperature} min={-1} max={1} step={0.01} def={0} onChange={(v) => upd({ temperature: v })} />
        <Slider label="Matiz" value={g.tint} min={-1} max={1} step={0.01} def={0} onChange={(v) => upd({ tint: v })} />
        <Slider label="Saturación" value={g.saturation} min={0} max={2} step={0.01} def={1} onChange={(v) => upd({ saturation: v })} />
        <Slider label="Intensidad" value={g.vibrance} min={-1} max={1} step={0.01} def={0} onChange={(v) => upd({ vibrance: v })} />
      </Section>
      <Section title="Ruedas de color">
        <div className="wheels">
          <Wheel label="Lift" value={g.lift} neutral={0} range={0.25} masterMin={-0.3} masterMax={0.3} onChange={(v) => upd({ lift: v })} />
          <Wheel label="Gamma" value={g.gamma} neutral={1} range={0.4} masterMin={0.4} masterMax={2.2} onChange={(v) => upd({ gamma: v })} />
          <Wheel label="Gain" value={g.gain} neutral={1} range={0.4} masterMin={0.4} masterMax={2} onChange={(v) => upd({ gain: v })} />
        </div>
      </Section>
      <Section title="Curvas">
        <Curves curves={g.curves} onChange={(c) => upd({ curves: c }, 'curves')} />
      </Section>
      <Section title="Secundaria HSL" right={<Toggle on={hsl.enabled} onChange={(v) => setHsl({ enabled: v })} />}>
        <div className="hue-strip" />
        <Slider label="Tono central" value={hsl.hue} min={0} max={360} step={1} def={0} unit="°" onChange={(v) => setHsl({ hue: v, enabled: true })} />
        <Slider label="Rango" value={hsl.range} min={5} max={180} step={1} def={60} unit="°" onChange={(v) => setHsl({ range: v })} />
        <Slider label="Suavidad" value={hsl.softness} min={1} max={90} step={1} def={30} unit="°" onChange={(v) => setHsl({ softness: v })} />
        <Slider label="Desplazar tono" value={hsl.hueShift} min={-180} max={180} step={1} def={0} unit="°" onChange={(v) => setHsl({ hueShift: v })} />
        <Slider label="Saturación" value={hsl.sat} min={0} max={2} step={0.01} def={1} onChange={(v) => setHsl({ sat: v })} />
        <Slider label="Luminancia" value={hsl.lum} min={-1} max={1} step={0.01} def={0} onChange={(v) => setHsl({ lum: v })} />
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          Ej.: tono 120°, saturación 0 → desatura solo los verdes. Saturación 0 en todo menos un color = efecto «color selectivo».
        </p>
      </Section>
      <Section title="LUT 3D (.cube)">
        {g.lut ? (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.lut.name}</span>
              <button className="icon-btn sm" title="Quitar LUT" onClick={() => upd({ lut: undefined }, 'lut')}>
                <X size={13} />
              </button>
            </div>
            <Slider label="Mezcla" value={g.lutMix * 100} min={0} max={100} step={1} def={100} format={(v) => `${Math.round(v)}%`} onChange={(v) => upd({ lutMix: v / 100 })} />
          </>
        ) : (
          <button
            className="btn"
            onClick={async () => {
              const f = await window.api.readTextFile(['cube']);
              if (!f) return;
              try {
                const lut = parseCube(f.text);
                upd({ lut: { name: f.name, ...lut }, lutMix: 1 }, 'lut');
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <Upload size={14} /> Importar LUT
          </button>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          Ideal para convertir material Log (S-Log, V-Log, LogC, D-Log) a Rec.709 o aplicar looks de cine.
        </p>
      </Section>
    </>
  );
}
