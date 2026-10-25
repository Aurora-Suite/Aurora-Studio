const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Dentro del paquete los binarios viven en app.asar.unpacked.
const unpacked = (p) => p && p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);

function versionOf(bin) {
  try {
    const r = spawnSync(bin, ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true });
    const m = /version n?(\d+)\.(\d+)/.exec(r.stdout || '');
    return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : -1;
  } catch {
    return -1;
  }
}

function systemBin(name) {
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8', windowsHide: true });
    const first = (r.stdout || '').split(/\r?\n/).find(Boolean);
    return first && fs.existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

// Usa el FFmpeg más reciente entre el incluido en la app y el del sistema (más códecs y mejores codificadores GPU).
function resolveBin(name, staticPath) {
  const forced = process.env[`MONTAJE_${name.toUpperCase()}`];
  if (forced && fs.existsSync(forced)) return forced;
  const bundled = unpacked(staticPath);
  const sys = systemBin(name);
  const cands = [bundled, sys].filter((c) => c && fs.existsSync(c));
  if (!cands.length) return name;
  return cands.map((c) => ({ c, v: versionOf(c) })).sort((a, b) => b.v - a.v)[0].c;
}

let ffmpegStatic = null;
let ffprobeStatic = null;
try { ffmpegStatic = require('ffmpeg-static'); } catch {}
try { ffprobeStatic = require('ffprobe-static').path; } catch {}

const FFMPEG = resolveBin('ffmpeg', ffmpegStatic);
const FFPROBE = resolveBin('ffprobe', ffprobeStatic);

let majorVersion = null;
function ffmpegMajor() {
  if (majorVersion === null) majorVersion = Math.floor(Math.max(0, versionOf(FFMPEG)) / 100) || 6;
  return majorVersion;
}

function run(bin, args, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      const buf = Buffer.concat(out);
      if (code === 0) resolve(binary ? buf : buf.toString('utf8'));
      else reject(new Error(err.split('\n').slice(-6).join('\n') || `exit ${code}`));
    });
  });
}

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];

async function probe(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const json = JSON.parse(await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath]));
  const streams = json.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find((s) => s.codec_type === 'audio');
  let kind = 'video';
  if (IMAGE_EXT.includes(ext)) kind = 'image';
  else if (AUDIO_EXT.includes(ext) || !v) kind = 'audio';

  let width = v ? v.width : 0;
  let height = v ? v.height : 0;
  let rotation = 0;
  if (v) {
    const sd = (v.side_data_list || []).find((d) => d.rotation !== undefined);
    rotation = sd ? Number(sd.rotation) : Number((v.tags && v.tags.rotate) || 0);
    if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  }
  let fps = 30;
  if (v && v.avg_frame_rate && v.avg_frame_rate !== '0/0') {
    const [n, d] = v.avg_frame_rate.split('/').map(Number);
    if (d) fps = n / d;
  }
  const duration = kind === 'image' ? 5 : parseFloat((json.format && json.format.duration) || (v && v.duration) || (a && a.duration) || '0');
  return { kind, width, height, fps, duration, hasAudio: !!a && kind !== 'image', size: Number(json.format?.size || 0), colorSpace: (v && v.color_space) || '', colorRange: (v && v.color_range) || '', colorPrimaries: (v && v.color_primaries) || '' };
}

async function thumbnail(filePath, t, tmpDir) {
  const key = crypto.createHash('md5').update(filePath + ':' + t).digest('hex');
  const out = path.join(tmpDir, `thumb-${key}.jpg`);
  if (!fs.existsSync(out)) {
    await run(FFMPEG, ['-y', '-ss', String(t || 0), '-i', filePath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out]).catch(() =>
      // Vídeos muy cortos: reintenta desde el principio.
      run(FFMPEG, ['-y', '-i', filePath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out])
    );
  }
  return out;
}

// Fotograma exacto a PNG (para "congelar fotograma").
async function frame(filePath, t, tmpDir) {
  const out = path.join(tmpDir, `freeze-${Date.now()}.png`);
  await run(FFMPEG, ['-y', '-v', 'error', '-ss', String(t), '-i', filePath, '-frames:v', '1', out]);
  return out;
}

// Picos de audio: 50 valores por segundo, cuantizados a 0..255.
const PEAKS_PER_SEC = 50;
async function peaks(filePath) {
  const rate = 4000;
  const buf = await run(FFMPEG, ['-v', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { binary: true });
  const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  const per = rate / PEAKS_PER_SEC;
  const outLen = Math.ceil(samples.length / per);
  const result = new Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let max = 0;
    const end = Math.min(samples.length, (i + 1) * per);
    for (let j = i * per; j < end; j++) {
      const s = Math.abs(samples[j]);
      if (s > max) max = s;
    }
    result[i] = Math.round((max / 32768) * 255);
  }
  return { perSec: PEAKS_PER_SEC, data: result };
}

// Detección real de codificadores: se codifica un fotograma de prueba con cada uno.
const ENCODERS = [
  'libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox',
  'libx265', 'hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_videotoolbox',
  'libsvtav1', 'libaom-av1', 'av1_nvenc', 'av1_qsv', 'av1_amf',
  'prores_ks', 'prores_videotoolbox', 'libvpx-vp9',
];
let encoderCache = null;
async function detectEncoders() {
  if (encoderCache) return encoderCache;
  const test = (enc) =>
    run(FFMPEG, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=30:d=0.1', '-frames:v', '2', '-pix_fmt', enc.includes('prores') ? 'yuv422p10le' : 'yuv420p', '-c:v', enc, '-f', 'null', '-'])
      .then(() => true)
      .catch(() => false);
  const results = await Promise.all(ENCODERS.map(async (e) => [e, await test(e)]));
  const hwaccels = (await run(FFMPEG, ['-hide_banner', '-hwaccels']).catch(() => '')).split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean);
  encoderCache = { available: results.filter(([, ok]) => ok).map(([e]) => e), hwaccels, ffmpeg: FFMPEG, version: versionOf(FFMPEG) };
  return encoderCache;
}

module.exports = { FFMPEG, FFPROBE, ffmpegMajor, probe, thumbnail, peaks, run, detectEncoders, frame };
