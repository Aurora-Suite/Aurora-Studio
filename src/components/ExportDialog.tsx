import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, FolderOpen, Cpu, Zap, Loader2 } from 'lucide-react';
import { useStore, totalDuration } from '../store';
import { buildJob, type ExportOutput } from '../lib/exportJob';
import { formatTime } from '../lib/render';
import { Segmented, Slider, Toggle } from './ui';

type Codec = 'h264' | 'hevc' | 'av1' | 'prores' | 'vp9' | 'gif';
type Container = 'mp4' | 'mov' | 'mkv' | 'webm' | 'gif';

const CODECS: { id: Codec; name: string; hw: string[]; sw: string[]; maxHw: number; crf: [number, number, number] }[] = [
  { id: 'h264', name: 'H.264 / AVC', hw: ['h264_nvenc', 'h264_videotoolbox', 'h264_qsv', 'h264_amf'], sw: ['libx264'], maxHw: 4096, crf: [14, 35, 20] },
  { id: 'hevc', name: 'HEVC / H.265', hw: ['hevc_nvenc', 'hevc_videotoolbox', 'hevc_qsv', 'hevc_amf'], sw: ['libx265'], maxHw: 8192, crf: [14, 38, 23] },
  { id: 'av1', name: 'AV1', hw: ['av1_nvenc', 'av1_qsv', 'av1_amf'], sw: ['libsvtav1', 'libaom-av1'], maxHw: 8192, crf: [18, 50, 30] },
  { id: 'prores', name: 'Apple ProRes 422 HQ / 4444', hw: ['prores_videotoolbox'], sw: ['prores_ks'], maxHw: 8192, crf: [0, 0, 0] },
  { id: 'vp9', name: 'VP9', hw: [], sw: ['libvpx-vp9'], maxHw: 0, crf: [15, 50, 31] },
  { id: 'gif', name: 'GIF animado', hw: [], sw: ['gif'], maxHw: 0, crf: [0, 0, 0] },
];
const CONTAINERS: Record<Container, Codec[]> = { mp4: ['h264', 'hevc', 'av1'], mov: ['h264', 'hevc', 'prores'], mkv: ['h264', 'hevc', 'av1', 'prores', 'vp9'], webm: ['vp9', 'av1'], gif: ['gif'] };
const RES = [
  { label: '720p', short: 720 },
  { label: '1080p', short: 1080 },
  { label: '2K', short: 1440 },
  { label: '4K', short: 2160 },
  { label: '8K', short: 4320 },
];
const HW_NAME: Record<string, string> = { nvenc: 'NVIDIA NVENC', videotoolbox: 'Apple VideoToolbox', qsv: 'Intel Quick Sync', amf: 'AMD AMF' };

interface Settings {
  container: Container;
  codec: Codec;
  gpu: boolean;
  short: number | 'project';
  rateControl: 'quality' | 'vbr' | 'cbr';
  quality: number;
  bitrate: number;
  bitDepth: 8 | 10;
  speed: 'fast' | 'medium' | 'slow';
  hwDecode: boolean;
  audioCodec: ExportOutput['audioCodec'];
  audioBitrate: number;
  loudnorm: number | null;
  alpha: boolean;
}

const PRESETS: { name: string; desc: string; s: Partial<Settings> }[] = [
  { name: 'YouTube 4K', desc: 'HEVC 2160p · GPU · −14 LUFS', s: { container: 'mp4', codec: 'hevc', gpu: true, short: 2160, rateControl: 'quality', quality: 21, bitDepth: 8, audioCodec: 'aac', audioBitrate: 320, loudnorm: -14 } },
  { name: 'YouTube 1080p', desc: 'H.264 1080p · GPU · −14 LUFS', s: { container: 'mp4', codec: 'h264', gpu: true, short: 1080, rateControl: 'quality', quality: 19, audioCodec: 'aac', audioBitrate: 320, loudnorm: -14 } },
  { name: 'Shorts · Reels · TikTok', desc: 'H.264 1080×1920 · 16 Mbps', s: { container: 'mp4', codec: 'h264', gpu: true, short: 1080, rateControl: 'vbr', bitrate: 16, audioCodec: 'aac', audioBitrate: 256, loudnorm: -14 } },
  { name: 'Instagram feed', desc: 'H.264 1080p · 10 Mbps', s: { container: 'mp4', codec: 'h264', gpu: true, short: 1080, rateControl: 'vbr', bitrate: 10, audioCodec: 'aac', audioBitrate: 256, loudnorm: -14 } },
  { name: 'Máster ProRes', desc: 'ProRes 422 HQ · PCM 24 bits', s: { container: 'mov', codec: 'prores', gpu: false, short: 'project', audioCodec: 'pcm', loudnorm: null, alpha: false } },
  { name: 'Archivo 10 bits', desc: 'HEVC 10 bits · máxima calidad', s: { container: 'mkv', codec: 'hevc', gpu: false, short: 'project', rateControl: 'quality', quality: 18, bitDepth: 10, speed: 'slow', audioCodec: 'flac', loudnorm: null } },
  { name: '8K', desc: 'HEVC 4320p 10 bits · GPU', s: { container: 'mp4', codec: 'hevc', gpu: true, short: 4320, rateControl: 'vbr', bitrate: 120, bitDepth: 10, audioCodec: 'aac', audioBitrate: 320 } },
  { name: 'Web ligera', desc: 'AV1 · máxima compresión', s: { container: 'mp4', codec: 'av1', gpu: true, short: 1080, rateControl: 'quality', quality: 32, audioCodec: 'aac', audioBitrate: 160, loudnorm: -14 } },
  { name: 'Superposición con alfa', desc: 'ProRes 4444 transparente', s: { container: 'mov', codec: 'prores', gpu: false, short: 'project', audioCodec: 'pcm', alpha: true } },
  { name: 'GIF', desc: 'Sin audio · 15 fps · 480p', s: { container: 'gif', codec: 'gif', short: 720 } },
];

export default function ExportDialog() {
  const settings = useStore((s) => s.settings);
  const clips = useStore((s) => s.clips);
  const total = totalDuration(clips);
  const [enc, setEnc] = useState<{ available: string[]; hwaccels: string[]; version: number } | null>(null);
  const [o, setO] = useState<Settings>({
    container: 'mp4', codec: 'h264', gpu: true, short: 'project', rateControl: 'quality', quality: 20, bitrate: 20, bitDepth: 8, speed: 'medium',
    hwDecode: true, audioCodec: 'aac', audioBitrate: 320, loudnorm: null, alpha: false,
  });
  const [preset, setPreset] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState({ ratio: 0, eta: null as number | null, speed: 0, fps: 0 });
  const [error, setError] = useState('');
  const [outPath, setOutPath] = useState('');

  useEffect(() => {
    window.api.encoders().then(setEnc);
    return window.api.onExportProgress((p) => setProgress({ ratio: p.ratio, eta: p.eta, speed: p.speed ?? 0, fps: p.fps ?? 0 }));
  }, []);

  const set = (p: Partial<Settings>) => {
    setPreset(null);
    setO((cur) => {
      const next = { ...cur, ...p };
      if (!CONTAINERS[next.container].includes(next.codec)) next.codec = CONTAINERS[next.container][0];
      if (p.codec && p.codec !== cur.codec) next.quality = CODECS.find((c) => c.id === next.codec)!.crf[2] || next.quality;
      return next;
    });
  };

  const shortSide = Math.min(settings.width, settings.height);
  const targetShort = o.short === 'project' ? shortSide : o.short;
  const k = targetShort / shortSide;
  const outW = Math.round((settings.width * k) / 2) * 2;
  const outH = Math.round((settings.height * k) / 2) * 2;
  const codecDef = CODECS.find((c) => c.id === o.codec)!;
  const hwEncoder = enc ? codecDef.hw.find((e) => enc.available.includes(e)) : undefined;
  const swEncoder = enc ? codecDef.sw.find((e) => e === 'gif' || enc.available.includes(e)) : undefined;
  const hwTooBig = !!hwEncoder && Math.max(outW, outH) > codecDef.maxHw;
  const useGpu = o.gpu && !!hwEncoder && !hwTooBig;
  const encoder = useGpu ? hwEncoder! : swEncoder;
  const hwFamily = hwEncoder ? HW_NAME[hwEncoder.split('_').pop()!] : null;
  const ext = o.container;
  const isProres = o.codec === 'prores';
  const isGif = o.codec === 'gif';
  const sizeEstimate = o.rateControl !== 'quality' && !isProres && !isGif ? ((o.bitrate * 1e6 + (o.audioCodec === 'none' ? 0 : o.audioBitrate * 1e3)) * total) / 8 / 1e6 : null;

  const applyPreset = (name: string) => {
    const p = PRESETS.find((x) => x.name === name)!;
    setO((cur) => ({ ...cur, ...p.s }));
    setPreset(name);
  };

  const close = () => status !== 'running' && useStore.setState({ exportOpen: false });

  const start = async () => {
    if (!encoder) return;
    const path = await window.api.pickExportPath(ext);
    if (!path) return;
    setOutPath(path);
    setStatus('running');
    setProgress({ ratio: 0, eta: null, speed: 0, fps: 0 });
    await document.fonts.ready;
    const output: ExportOutput = {
      path,
      encoder,
      rateControl: o.rateControl,
      quality: o.quality,
      bitrate: o.bitrate,
      bitDepth: o.codec === 'hevc' || o.codec === 'av1' ? o.bitDepth : 8,
      speed: o.speed,
      width: isGif ? Math.round((outW * 480) / Math.max(480, Math.min(outW, outH))) & ~1 : outW,
      height: isGif ? Math.round((outH * 480) / Math.max(480, Math.min(outW, outH))) & ~1 : outH,
      hwDecode: o.hwDecode,
      audioCodec: isGif ? 'none' : ext === 'webm' && o.audioCodec === 'aac' ? 'opus' : o.audioCodec,
      audioBitrate: o.audioBitrate,
      loudnorm: o.loudnorm,
      alpha: o.alpha && (isProres || o.codec === 'vp9'),
    };
    const job = buildJob(useStore.getState().toData(), output);
    const r = await window.api.startExport(job);
    if (r.ok) setStatus('done');
    else {
      setError(r.error || 'Error desconocido');
      setStatus('error');
    }
  };

  const codecs = useMemo(() => CODECS.filter((c) => CONTAINERS[o.container].includes(c.id)), [o.container]);

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal export-modal">
        <h2>Exportar</h2>
        <div className="sub">
          {settings.name} · {formatTime(total, settings.fps)} · {settings.fps} fps
        </div>

        {status === 'idle' && (
          <div className="export-grid">
            <div className="presets">
              <div className="section-title">Destino</div>
              {PRESETS.map((p) => (
                <button key={p.name} className={`preset ${preset === p.name ? 'active' : ''}`} onClick={() => applyPreset(p.name)}>
                  <b>{p.name}</b>
                  <span>{p.desc}</span>
                </button>
              ))}
            </div>
            <div className="export-form">
              <div className="grid-2">
                <div className="field">
                  <label>Contenedor</label>
                  <select className="input" value={o.container} onChange={(e) => set({ container: e.target.value as Container })}>
                    <option value="mp4">MP4</option>
                    <option value="mov">QuickTime MOV</option>
                    <option value="mkv">Matroska MKV</option>
                    <option value="webm">WebM</option>
                    <option value="gif">GIF</option>
                  </select>
                </div>
                <div className="field">
                  <label>Códec de vídeo</label>
                  <select className="input" value={o.codec} onChange={(e) => set({ codec: e.target.value as Codec })}>
                    {codecs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Resolución</label>
                <Segmented
                  value={String(o.short)}
                  onChange={(v) => set({ short: v === 'project' ? 'project' : Number(v) })}
                  options={[{ value: 'project', label: 'Proyecto' }, ...RES.map((r) => ({ value: String(r.short), label: r.label }))]}
                />
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {isGif ? 'GIF a 480p' : `${outW} × ${outH}`} · la composición se calcula a esta resolución
                </span>
              </div>

              {!isGif && (
                <div className="field">
                  <label>Codificación</label>
                  <div className="encoder-choice">
                    <button className={`enc ${useGpu ? 'active' : ''}`} disabled={!hwEncoder || hwTooBig} onClick={() => set({ gpu: true })}>
                      <Zap size={14} />
                      <div>
                        <b>GPU · hardware</b>
                        <span>{!enc ? 'Detectando…' : hwEncoder ? (hwTooBig ? `${hwFamily}: máx. ${codecDef.maxHw}px en ${codecDef.name}` : hwFamily) : 'No disponible para este códec'}</span>
                      </div>
                    </button>
                    <button className={`enc ${!useGpu ? 'active' : ''}`} disabled={!swEncoder} onClick={() => set({ gpu: false })}>
                      <Cpu size={14} />
                      <div>
                        <b>CPU · software</b>
                        <span>{swEncoder ?? 'No disponible'} · máxima compatibilidad</span>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {!isProres && !isGif && (
                <>
                  <div className="field">
                    <label>Control de tasa</label>
                    <Segmented
                      value={o.rateControl}
                      onChange={(v) => set({ rateControl: v })}
                      options={[
                        { value: 'quality', label: 'Calidad constante' },
                        { value: 'vbr', label: 'Bitrate variable' },
                        { value: 'cbr', label: 'Bitrate constante' },
                      ]}
                    />
                  </div>
                  {o.rateControl === 'quality' ? (
                    <Slider label={useGpu ? 'CQ (menor = mejor)' : 'CRF (menor = mejor)'} value={o.quality} min={codecDef.crf[0]} max={codecDef.crf[1]} step={1} def={codecDef.crf[2]} onChange={(v) => set({ quality: v })} />
                  ) : (
                    <Slider label="Bitrate" value={o.bitrate} min={2} max={400} step={1} def={20} unit=" Mbps" onChange={(v) => set({ bitrate: v })} />
                  )}
                  <div className="grid-2">
                    <div className="field">
                      <label>Velocidad</label>
                      <Segmented
                        value={o.speed}
                        onChange={(v) => set({ speed: v })}
                        options={[
                          { value: 'fast', label: 'Rápida' },
                          { value: 'medium', label: 'Media' },
                          { value: 'slow', label: 'Calidad' },
                        ]}
                      />
                    </div>
                    {(o.codec === 'hevc' || o.codec === 'av1') && (
                      <div className="field">
                        <label>Profundidad</label>
                        <Segmented value={String(o.bitDepth)} onChange={(v) => set({ bitDepth: Number(v) as 8 | 10 })} options={[{ value: '8', label: '8 bits' }, { value: '10', label: '10 bits' }]} />
                      </div>
                    )}
                  </div>
                </>
              )}

              {(isProres || o.codec === 'vp9') && (
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="label">Fondo transparente (canal alfa{isProres ? ', ProRes 4444' : ''})</span>
                  <Toggle on={o.alpha} onChange={(v) => set({ alpha: v })} />
                </div>
              )}
              {!isGif && (
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="label">Decodificación por hardware de los clips{enc?.hwaccels.length ? ` (${enc.hwaccels.slice(0, 3).join(', ')})` : ''}</span>
                  <Toggle on={o.hwDecode} onChange={(v) => set({ hwDecode: v })} />
                </div>
              )}

              {!isGif && (
                <div className="grid-2">
                  <div className="field">
                    <label>Audio</label>
                    <select className="input" value={o.audioCodec} onChange={(e) => set({ audioCodec: e.target.value as Settings['audioCodec'] })}>
                      <option value="aac">AAC</option>
                      <option value="opus">Opus</option>
                      <option value="pcm">PCM 24 bits (sin pérdida)</option>
                      <option value="flac">FLAC (sin pérdida)</option>
                      <option value="none">Sin audio</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Normalizar sonoridad</label>
                    <select className="input" value={o.loudnorm === null ? 'off' : String(o.loudnorm)} onChange={(e) => set({ loudnorm: e.target.value === 'off' ? null : Number(e.target.value) })}>
                      <option value="off">No</option>
                      <option value="-14">−14 LUFS (YouTube, Spotify)</option>
                      <option value="-16">−16 LUFS (Apple, podcasts)</option>
                      <option value="-23">−23 LUFS (TV, EBU R128)</option>
                    </select>
                  </div>
                </div>
              )}
              {(o.audioCodec === 'aac' || o.audioCodec === 'opus') && !isGif && (
                <Slider label="Bitrate audio" value={o.audioBitrate} min={96} max={512} step={32} def={320} unit=" kbps" onChange={(v) => set({ audioBitrate: v })} />
              )}
              <div className="export-summary">
                <span>{encoder ?? '—'}</span>
                <span>.{ext}</span>
                {sizeEstimate !== null && <span>≈ {sizeEstimate >= 1000 ? `${(sizeEstimate / 1000).toFixed(1)} GB` : `${Math.round(sizeEstimate)} MB`}</span>}
              </div>
            </div>
          </div>
        )}

        {status === 'running' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row">
                <Loader2 size={14} className="spin" /> Renderizando con {encoder}… {Math.round(progress.ratio * 100)} %
              </span>
              <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {progress.fps > 0 && `${Math.round(progress.fps)} fps · `}
                {progress.speed > 0 && `${progress.speed.toFixed(2)}× · `}
                {progress.eta !== null ? `quedan ${Math.ceil(progress.eta)} s` : 'calculando…'}
              </span>
            </div>
            <div className="progress">
              <div style={{ width: `${progress.ratio * 100}%` }} />
            </div>
          </div>
        )}

        {status === 'done' && (
          <div className="row" style={{ gap: 12 }}>
            <CheckCircle2 size={28} color="var(--success)" />
            <div>
              <div style={{ fontWeight: 600 }}>Exportación completada</div>
              <div className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {outPath}
              </div>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <AlertTriangle size={24} color="var(--danger)" style={{ flex: 'none' }} />
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11, maxHeight: 220, overflow: 'auto', color: 'var(--text-2)', userSelect: 'text' }}>{error}</pre>
          </div>
        )}

        <div className="foot">
          {status === 'idle' && (
            <>
              <button className="btn" onClick={close}>
                Cancelar
              </button>
              <button className="btn primary" disabled={total <= 0 || !encoder} onClick={start}>
                {useGpu ? <Zap size={14} /> : <Cpu size={14} />} Exportar {isGif ? 'GIF' : `${outW}×${outH}`}
              </button>
            </>
          )}
          {status === 'running' && (
            <button className="btn danger" onClick={() => window.api.cancelExport()}>
              Cancelar exportación
            </button>
          )}
          {status === 'done' && (
            <>
              <button className="btn" onClick={() => window.api.reveal(outPath)}>
                <FolderOpen size={14} /> Mostrar en carpeta
              </button>
              <button className="btn primary" onClick={close}>
                Listo
              </button>
            </>
          )}
          {status === 'error' && (
            <>
              <button className="btn" onClick={() => setStatus('idle')}>
                Volver
              </button>
              <button className="btn primary" onClick={close}>
                Cerrar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
