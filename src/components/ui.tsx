import { useEffect, useState, type ReactNode } from 'react';
import logo from '../assets/logo.svg';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  def?: number;
  unit?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export function Slider({ label, value, min, max, step = 0.01, def, unit = '', format, onChange }: SliderProps) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  const p = ((value - min) / (max - min)) * 100;
  const shown = format ? format(value) : `${Number(value.toFixed(2))}${unit}`;
  return (
    <div className="slider-row">
      <span className="label" title="Doble clic para restablecer" onDoubleClick={() => def !== undefined && onChange(def)}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--p' as any]: `${Math.max(0, Math.min(100, p))}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => def !== undefined && onChange(def)}
      />
      <input
        className="num"
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = parseFloat(draft ?? '');
          if (!Number.isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function BrandMark({ size = 22 }: { size?: number }) {
  return <img src={logo} width={size} height={size} alt="Aurora Studio" draggable={false} style={{ display: 'block', filter: 'drop-shadow(0 2px 6px rgba(47,107,255,0.35))' }} />;
}
