const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { FFMPEG, ffmpegMajor } = require('./ffmpeg.cjs');

const n = (v, d = 4) => Number(Number(v).toFixed(d));
const even = (v) => Math.max(2, Math.round(v / 2) * 2);

// Timebases NTSC exactos.
function fpsRational(fps) {
  const ntsc = { 23.976: '24000/1001', 29.97: '30000/1001', 59.94: '60000/1001', 47.952: '48000/1001', 119.88: '120000/1001' };
  for (const [k, v] of Object.entries(ntsc)) if (Math.abs(fps - Number(k)) < 0.01) {
      const [a, b] = v.split('/').map(Number);
      return { str: v, num: a / b };
    }
  return { str: String(fps), num: fps };
}

const SPEED = {
  x264: { fast: 'veryfast', medium: 'medium', slow: 'slow' },
  nvenc: { fast: 'p3', medium: 'p5', slow: 'p7' },
  svt: { fast: '10', medium: '7', slow: '4' },
  qsv: { fast: 'veryfast', medium: 'medium', slow: 'veryslow' },
  amf: { fast: 'speed', medium: 'balanced', slow: 'quality' },
};

function encoderArgs(o) {
  const enc = o.encoder;
  const q = String(o.quality);
  const ten = o.bitDepth === 10;
  const mbps = `${o.bitrate}M`;
  const rate = (vbrArgs, cbrArgs) => (o.rateControl === 'cbr' ? cbrArgs : vbrArgs);
  const bitrateGeneric = rate(['-b:v', mbps, '-maxrate', `${o.bitrate * 1.5}M`, '-bufsize', `${o.bitrate * 2}M`], ['-b:v', mbps, '-minrate', mbps, '-maxrate', mbps, '-bufsize', mbps]);
  const sp = o.speed || 'medium';
  let v = [];
  let pix = ten ? 'yuv420p10le' : 'yuv420p';
  if (enc === 'libx264' || enc === 'libx265') {
    pix = enc === 'libx265' && ten ? 'yuv420p10le' : 'yuv420p';
    v = ['-c:v', enc, '-preset', SPEED.x264[sp], ...(o.rateControl === 'quality' ? ['-crf', q] : bitrateGeneric)];
    if (enc === 'libx265') v.push('-tag:v', 'hvc1');
  } else if (enc.endsWith('_nvenc')) {
    pix = ten && !enc.startsWith('h264') ? 'p010le' : 'yuv420p';
    v = ['-c:v', enc, '-preset', SPEED.nvenc[sp], '-tune', 'hq', ...(o.rateControl === 'quality' ? ['-rc', 'vbr', '-cq', q, '-b:v', '0'] : ['-rc', o.rateControl, ...bitrateGeneric]), '-spatial-aq', '1', '-bf', '3'];
    if (enc === 'hevc_nvenc') v.push('-tag:v', 'hvc1');
  } else if (enc.endsWith('_qsv')) {
    pix = ten && !enc.startsWith('h264') ? 'p010le' : 'nv12';
    v = ['-c:v', enc, '-preset', SPEED.qsv[sp], ...(o.rateControl === 'quality' ? ['-global_quality', q] : bitrateGeneric)];
    if (enc === 'hevc_qsv') v.push('-tag:v', 'hvc1');
  } else if (enc.endsWith('_amf')) {
    pix = ten && !enc.startsWith('h264') ? 'p010le' : 'nv12';
    v = ['-c:v', enc, '-quality', SPEED.amf[sp], ...(o.rateControl === 'quality' ? ['-rc', 'cqp', '-qp_i', q, '-qp_p', q, '-qp_b', q] : ['-rc', o.rateControl === 'cbr' ? 'cbr' : 'vbr_peak', ...bitrateGeneric])];
    if (enc === 'hevc_amf') v.push('-tag:v', 'hvc1');
  } else if (enc.endsWith('_videotoolbox') && !enc.startsWith('prores')) {
    pix = ten && enc.startsWith('hevc') ? 'p010le' : 'yuv420p';
    v = ['-c:v', enc, ...(o.rateControl === 'quality' ? ['-q:v', String(Math.max(1, Math.min(100, 100 - Number(q) * 2)))] : ['-b:v', mbps]), '-allow_sw', '1'];
    if (enc === 'hevc_videotoolbox') v.push('-tag:v', 'hvc1');
  } else if (enc === 'libsvtav1') {
    v = ['-c:v', enc, '-preset', SPEED.svt[sp], ...(o.rateControl === 'quality' ? ['-crf', q] : ['-b:v', mbps])];
  } else if (enc === 'libaom-av1') {
    v = ['-c:v', enc, '-cpu-used', sp === 'fast' ? '6' : sp === 'medium' ? '4' : '2', '-row-mt', '1', ...(o.rateControl === 'quality' ? ['-crf', q, '-b:v', '0'] : ['-b:v', mbps])];
  } else if (enc === 'prores_ks' || enc === 'prores_videotoolbox') {
    pix = o.alpha ? 'yuva444p10le' : 'yuv422p10le';
    v = ['-c:v', enc, '-profile:v', o.alpha ? '4' : '3'];
    if (enc === 'prores_ks') v.push('-vendor', 'apl0');
  } else if (enc === 'libvpx-vp9') {
    pix = o.alpha ? 'yuva420p' : 'yuv420p';
    v = ['-c:v', enc, '-deadline', 'good', '-cpu-used', sp === 'fast' ? '4' : '2', '-row-mt', '1', ...(o.rateControl === 'quality' ? ['-crf', q, '-b:v', '0'] : ['-b:v', mbps])];
  } else if (enc === 'gif') {
    return { v: [], pix: null };
  }
  return { v, pix };
}

function audioArgs(o) {
  const br = `${o.audioBitrate || 256}k`;
  const sr = ['-ar', String(o.sampleRate || 48000)];
  switch (o.audioCodec) {
    case 'none':
      return null;
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', br, '-ar', '48000'];
    case 'pcm':
      return ['-c:a', 'pcm_s24le', ...sr];
    case 'flac':
      return ['-c:a', 'flac', ...sr];
    default:
      return ['-c:a', 'aac', '-b:a', br, ...sr];
  }
}

function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-3) parts.push(`atempo=${n(s)}`);
  return parts;
}

function audioChain(input, a, outLabel) {
  const f = ['asetpts=PTS-STARTPTS', ...atempoChain(a.speed || 1), 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'];
  if (a.denoise > 0) f.push(`afftdn=nr=${n(Math.max(1, a.denoise * 40), 2)}`);
  if (a.eqLow) f.push(`bass=g=${n(a.eqLow, 2)}:f=100`);
  if (a.eqMid) f.push(`equalizer=f=1000:t=q:w=0.7:g=${n(a.eqMid, 2)}`);
  if (a.eqHigh) f.push(`treble=g=${n(a.eqHigh, 2)}:f=8000`);
  if (a.compressor) f.push('acompressor=threshold=0.125:ratio=4:attack=10:release=150:makeup=2');
  const tv = a.trackVolume ?? 1;
  if (a.volumeExpr) f.push(`volume='(${a.volumeExpr.replace(/TL/g, 't')})*${n(tv)}':eval=frame`);
  else if (a.volume * tv !== 1) f.push(`volume=${n(a.volume * tv)}`);
  const pan = Math.max(-1, Math.min(1, a.pan || 0));
  if (pan) f.push(`pan=stereo|c0=${n(Math.min(1, 1 - pan))}*c0|c1=${n(Math.min(1, 1 + pan))}*c1`);
  if (a.fadeIn > 0) f.push(`afade=t=in:st=0:d=${n(a.fadeIn)}`);
  if (a.fadeOut > 0) f.push(`afade=t=out:st=${n(Math.max(0, a.duration - a.fadeOut))}:d=${n(a.fadeOut)}`);
  f.push(`adelay=delays=${Math.round(a.start * 1000)}:all=1`);
  return `[${input}]${f.join(',')}[${outLabel}]`;
}

function buildGraph(job, tmpDir) {
  const { width: W, height: H, background } = job.settings;
  const fr = fpsRational(job.settings.fps);
  const out = job.output;
  const total = job.duration;
  const codec = encoderArgs(out);
  const aArgs = out.encoder === 'gif' ? null : audioArgs(out);
  const stamp = Date.now();
  const files = [];
  const args = [];
  const graph = [];
  const audioLabels = [];
  let idx = 0;

  const hex = String(background || '#000000').replace('#', '');
  const bg = out.alpha ? 'black@0' : `0x${hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6)}`;
  graph.push(`color=c=${bg}:s=${W}x${H}:r=${fr.str}:d=${n(total)},format=rgba[base]`);
  let last = 'base';

  // Agrupa en "tiras" los clips unidos por transiciones dentro de la misma pista.
  const byTrack = new Map();
  job.visuals.forEach((v) => {
    if (!byTrack.has(v.track)) byTrack.set(v.track, []);
    byTrack.get(v.track).push(v);
  });
  const units = []; // { clips: [...], start } en orden de capas
  for (const track of [...byTrack.keys()].sort((a, b) => a - b)) {
    const list = byTrack.get(track).sort((a, b) => a.start - b.start);
    let run = [];
    for (const v of list) {
      v.pre = 0;
      v.post = 0;
      const prev = run[run.length - 1];
      if (prev && v.transitionIn && Math.abs(prev.start + prev.duration - v.start) < 1e-3) {
        const d = Math.min(v.transitionIn.duration, prev.duration, v.duration);
        prev.post = d / 2;
        v.pre = d / 2;
        v.transitionIn = { ...v.transitionIn, duration: d };
        run.push(v);
      } else {
        if (run.length) units.push(run);
        run = [v];
      }
    }
    if (run.length) units.push(run);
  }

  const visualChain = (v, k) => {
    const speed = v.speed || 1;
    const ext = v.pre + v.duration + v.post;
    const inRun = v.pre > 0 || v.post > 0;
    let padStart = 0;
    if (v.type === 'video') {
      const srcPre = Math.min(v.in, v.pre * speed);
      padStart = v.pre - srcPre / speed;
      if (out.hwDecode) args.push('-hwaccel', 'auto');
      args.push('-ss', String(n(v.in - srcPre)), '-t', String(n((ext - padStart) * speed + 0.1)), '-i', v.path);
    } else {
      let file = v.path;
      if (v.type === 'raster') {
        file = `layer-${stamp}-${k}.png`;
        fs.writeFileSync(path.join(tmpDir, file), Buffer.from(v.png, 'base64'));
        files.push(file);
      }
      const gif = file.toLowerCase().endsWith('.gif');
      args.push(...(gif ? ['-ignore_loop', '0'] : ['-loop', '1', '-framerate', fr.str]), '-t', String(n(ext)), '-i', file);
    }
    const i = idx++;
    const f = [v.type === 'video' ? `setpts=(PTS-STARTPTS)/${n(speed)}` : 'setpts=PTS-STARTPTS', `fps=${fr.str}`];
    if (v.type === 'video' && inRun) {
      f.push(`tpad=start_duration=${n(padStart)}:start_mode=clone:stop_mode=clone:stop_duration=${n(ext)}`, `trim=duration=${n(ext)}`, 'setpts=PTS-STARTPTS');
    }
    const fx = v.fx || {};
    // Filtros en YUV a resolución de origen (antes de pasar a RGB).
    if (fx.stabilize) f.push(`deshake=rx=${Math.round(fx.stabilize.range)}:ry=${Math.round(fx.stabilize.range)}`);
    if (fx.denoise) f.push(`hqdn3d=${n(fx.denoise.strength, 2)}`);
    if (fx.grain) f.push(`noise=c0s=${Math.round(fx.grain.amount)}:c0f=t+u`);
    if (fx.lens) f.push(`lenscorrection=k1=${n(fx.lens.k1)}:k2=${n(fx.lens.k2)}:i=bilinear`);

    const kf = v.kf || {};
    const animTransform = !!(kf.scale || kf.rotation);
    const fit = v.fit === 'none' ? 1 : Math.min(W / v.srcW, H / v.srcH);
    const procScale = v.procScale;
    const SW = even(v.srcW * fit * procScale);
    const SH = even(v.srcH * fit * procScale);
    // YUV→RGB con la misma regla que Chromium en la vista previa: la matriz etiquetada solo
    // cuenta si también lo están los primarios; si no, BT.709.
    const tagged = v.colorPrimaries && v.colorPrimaries !== 'unknown';
    const mat = tagged && /470|601|170m/.test(String(v.colorSpace || '')) ? 'bt601' : 'bt709';
    const rng = v.colorRange === 'pc' ? 'full' : 'tv';
    f.push(`scale=${SW}:${SH}:flags=bicubic${v.type === 'video' ? `:in_color_matrix=${mat}:in_range=${rng}` : ''}`, 'format=rgba');
    if (v.flipH) f.push('hflip');
    if (v.flipV) f.push('vflip');
    if (fx.vignette) f.push(`vignette=angle=${n(fx.vignette.angle)}`, 'format=rgba');
    if (fx.chromakey) f.push(`colorkey=0x${String(fx.chromakey.color).replace('#', '')}:${n(fx.chromakey.similarity)}:${n(fx.chromakey.blend)}`);
    if (v.cube) {
      const name = `lut-${stamp}-${k}.cube`;
      fs.writeFileSync(path.join(tmpDir, name), v.cube);
      files.push(name);
      f.push(`lut3d=file=${name}:interp=trilinear`);
    }
    if (fx.pixelate || fx.rgbsplit || v.conv) {
      f.push('format=gbrap');
      if (fx.pixelate) f.push(`pixelize=w=${Math.round(fx.pixelate.size * procScale)}:h=${Math.round(fx.pixelate.size * procScale)}:m=avg`);
      if (fx.rgbsplit) {
        const a = Math.round(fx.rgbsplit.amount * procScale);
        f.push(`rgbashift=rh=${a}:bh=${-a}`);
      }
      if (v.conv) {
        const m = v.conv.m.join(' ');
        const id = '0 0 0 0 1 0 0 0 0';
        f.push(`convolution='${m}':'${m}':'${m}':'${id}':0rdiv=${n(1 / v.conv.div, 6)}:1rdiv=${n(1 / v.conv.div, 6)}:2rdiv=${n(1 / v.conv.div, 6)}`);
      }
      f.push('format=rgba');
    }
    if (fx.crop) {
      const c = fx.crop;
      const cw = Math.max(2, Math.round(SW * (1 - c.l - c.r)));
      const ch = Math.max(2, Math.round(SH * (1 - c.t - c.b)));
      const cx = Math.round(SW * c.l);
      const cy = Math.round(SH * c.t);
      f.push(`crop=${cw}:${ch}:${cx}:${cy}`, `pad=${SW}:${SH}:${cx}:${cy}:color=black@0`);
    }
    if (fx.blur) f.push(`gblur=sigma=${n(fx.blur.sigma * procScale)}`);

    // Transformación: animada con perspective (lienzo fijo) o estática con rotate.
    const TL = `(in/${n(fr.num, 6)}-${n(v.pre)})`;
    if (animTransform) {
      const D = even(Math.ceil(Math.hypot(SW, SH)) + 4);
      const h = D / 2;
      const k1 = kf.scale ? `((${kf.scale.replace(/TL/g, TL)})/${n(procScale)})` : n(v.scale / procScale);
      const ang = kf.rotation ? `((${kf.rotation.replace(/TL/g, TL)})*PI/180)` : n((v.rotation * Math.PI) / 180, 6);
      const px = (dx, dy) => `${h}+((${dx})*cos(${ang})-(${dy})*sin(${ang}))*${k1}`;
      const py = (dx, dy) => `${h}+((${dx})*sin(${ang})+(${dy})*cos(${ang}))*${k1}`;
      const c = [[-h, -h], [h, -h], [-h, h], [h, h]];
      const coords = c.map(([dx, dy], j) => `x${j}='${px(dx, dy)}':y${j}='${py(dx, dy)}'`).join(':');
      f.push(`pad=${D}:${D}:${(D - SW) / 2}:${(D - SH) / 2}:color=black@0`, 'format=yuva444p', `perspective=${coords}:sense=destination:eval=frame:interpolation=linear`, 'format=rgba');
    } else if (v.rotation) {
      const r = n((v.rotation * Math.PI) / 180, 6);
      f.push(`rotate=a=${r}:ow=rotw(${r}):oh=roth(${r}):c=none`);
    }
    if (v.fadeIn > 0) f.push(`fade=t=in:st=${n(v.pre)}:d=${n(v.fadeIn)}:alpha=1`);
    if (v.fadeOut > 0) f.push(`fade=t=out:st=${n(v.pre + v.duration - v.fadeOut)}:d=${n(v.fadeOut)}:alpha=1`);
    if (v.opacitySamples) {
      const cmds = v.opacitySamples
        .filter(([t]) => t + v.pre >= 0 && t <= v.duration + v.post + 0.1)
        .map(([t, val]) => `${n(t + v.pre, 4)} colorchannelmixer@op${k} aa ${n(val, 4)}`)
        .join(';');
      f.push(`sendcmd=c='${cmds}'`, `colorchannelmixer@op${k}=aa=${n(v.opacitySamples[0][1])}`);
    } else if (v.opacity < 1) f.push(`colorchannelmixer=aa=${n(v.opacity)}`);
    graph.push(`[${i}:v]${f.join(',')}[v${k}]`);

    if (v.audio && aArgs) {
      const lbl = `a${audioLabels.length}`;
      graph.push(audioChain(`${i}:a`, { ...v.audio, speed, start: v.start, duration: v.duration }, lbl));
      audioLabels.push(lbl);
    }
    return { ext };
  };

  const posExpr = (v, tLocal) => {
    const X = v.kf?.x ? `(${v.kf.x.replace(/TL/g, tLocal)})` : `(${n(v.x)})`;
    const Y = v.kf?.y ? `(${v.kf.y.replace(/TL/g, tLocal)})` : `(${n(v.y)})`;
    return `x='(main_w/2)+${X}-(overlay_w/2)':y='(main_h/2)+${Y}-(overlay_h/2)'`;
  };

  let k = 0;
  units.forEach((run, u) => {
    if (run.length === 1) {
      const v = run[0];
      const kk = k++;
      visualChain(v, kk);
      graph.push(`[v${kk}]setpts=PTS+${n(v.start)}/TB[s${kk}]`);
      graph.push(
        `[${last}][s${kk}]overlay=${posExpr(v, `(t-${n(v.start)})`)}:eof_action=pass:format=auto:enable='between(t,${n(v.start)},${n(v.start + v.duration)})'[o${kk}]`
      );
      last = `o${kk}`;
      return;
    }
    // Tira con transiciones: cada clip va a un lienzo transparente completo y se encadenan con xfade.
    const r0 = run[0].start - run[0].pre;
    let acc = null;
    run.forEach((v, j) => {
      const kk = k++;
      const { ext } = visualChain(v, kk);
      graph.push(`color=c=black@0:s=${W}x${H}:r=${fr.str}:d=${n(ext)},format=rgba[c${kk}]`);
      graph.push(`[c${kk}][v${kk}]overlay=${posExpr(v, `(t-${n(v.pre)})`)}:eof_action=pass:format=auto,format=gbrap[f${kk}]`);
      if (!acc) acc = `f${kk}`;
      else {
        const off = v.start - v.pre - r0;
        graph.push(`[${acc}][f${kk}]xfade=transition=${v.transitionIn.type}:duration=${n(v.transitionIn.duration)}:offset=${n(off)}[x${kk}]`);
        acc = `x${kk}`;
      }
    });
    const endT = run[run.length - 1].start + run[run.length - 1].duration;
    graph.push(`[${acc}]format=rgba,setpts=PTS+${n(r0)}/TB[r${u}]`);
    graph.push(`[${last}][r${u}]overlay=0:0:eof_action=pass:format=auto:enable='between(t,${n(r0)},${n(endT)})'[ro${u}]`);
    last = `ro${u}`;
  });

  if (aArgs) {
    job.audios.forEach((a) => {
      args.push('-ss', String(n(a.in)), '-t', String(n(a.duration * (a.speed || 1))), '-i', a.path);
      const i = idx++;
      const lbl = `a${audioLabels.length}`;
      graph.push(audioChain(`${i}:a`, a, lbl));
      audioLabels.push(lbl);
    });
  }

  const tail = [];
  if (out.width !== W || out.height !== H) tail.push(`scale=${out.width}:${out.height}:flags=lanczos`);
  if (out.encoder === 'gif') {
    tail.push(`fps=${Math.min(fr.num, 15)}`, 'split[g1][g2];[g1]palettegen=stats_mode=diff[p];[g2][p]paletteuse=dither=bayer');
  } else {
    tail.push(`scale=out_color_matrix=bt709:out_range=tv`, `format=${codec.pix}`);
  }
  graph.push(`[${last}]${tail.join(',')}[vout]`);

  let hasAudio = false;
  if (audioLabels.length && aArgs) {
    const post = out.loudnorm ? `,loudnorm=I=${n(out.loudnorm, 1)}:TP=-1:LRA=11,aresample=48000` : '';
    graph.push(`${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest,atrim=0:${n(total)}${post}[aout]`);
    hasAudio = true;
  }

  const scriptName = `graph-${stamp}.txt`;
  fs.writeFileSync(path.join(tmpDir, scriptName), graph.join(';\n'));
  files.push(scriptName);
  const graphFlag = ffmpegMajor() >= 7 ? ['-/filter_complex', scriptName] : ['-filter_complex_script', scriptName];
  const outFps = out.encoder === 'gif' ? String(Math.min(fr.num, 15)) : fr.str;

  const final = [
    '-y', '-hide_banner', '-nostats', '-progress', 'pipe:1',
    ...args,
    ...graphFlag,
    '-map', '[vout]',
    ...(hasAudio ? ['-map', '[aout]', ...aArgs] : ['-an']),
    ...codec.v,
    ...(out.encoder === 'gif' ? [] : ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']),
    '-r', outFps,
    '-t', String(n(total)),
    out.path,
  ];
  return { args: final, files };
}

function runExport(job, tmpDir, onProgress) {
  const { args, files } = buildGraph(job, tmpDir);
  const proc = spawn(FFMPEG, args, { windowsHide: true, cwd: tmpDir });
  let cancelled = false;
  let errTail = '';
  const startedAt = Date.now();

  const done = new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => {
      const s = d.toString();
      const all = [...s.matchAll(/out_time_us=(\d+)/g)];
      const fpsM = [...s.matchAll(/^fps=([\d.]+)/gm)];
      if (all.length) {
        const t = parseInt(all[all.length - 1][1], 10) / 1e6;
        const ratio = Math.max(0, Math.min(1, t / job.duration));
        const elapsed = (Date.now() - startedAt) / 1000;
        onProgress({ ratio, eta: ratio > 0.01 ? (elapsed / ratio) * (1 - ratio) : null, speed: elapsed > 0 ? t / elapsed : 0, fps: fpsM.length ? Number(fpsM[fpsM.length - 1][1]) : 0 });
      }
    });
    proc.stderr.on('data', (d) => {
      errTail = (errTail + d.toString()).slice(-6000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      for (const f of files) fs.rm(path.join(tmpDir, f), { force: true }, () => {});
      if (cancelled) {
        fs.rm(job.output.path, { force: true }, () => {});
        reject(new Error('Exportación cancelada'));
      } else if (code === 0) {
        onProgress({ ratio: 1, eta: 0 });
        resolve();
      } else {
        reject(new Error(errTail.split('\n').filter(Boolean).slice(-10).join('\n')));
      }
    });
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      proc.kill('SIGKILL');
    },
  };
}

module.exports = { runExport, buildGraph };
