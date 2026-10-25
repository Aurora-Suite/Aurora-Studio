// Motor de audio de la vista previa: buses por pista, efectos por clip y medición EBU R128.
import type { AudioFx } from '../types';

interface ClipNodes {
  el: HTMLMediaElement;
  src: MediaElementAudioSourceNode;
  gain: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  makeup: GainNode;
  pan: StereoPannerNode;
  bus: string | null;
  compOn: boolean;
}

interface Bus {
  gain: GainNode;
  pan: StereoPannerNode;
  analyser: AnalyserNode;
}

export interface MeterReading {
  momentary: number;
  shortTerm: number;
  integrated: number;
  peakL: number;
  peakR: number;
  tracks: Record<string, number>;
}

const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private kL!: AnalyserNode;
  private kR!: AnalyserNode;
  private rawL!: AnalyserNode;
  private rawR!: AnalyserNode;
  private buses = new Map<string, Bus>();
  private nodes = new Map<string, ClipNodes>();
  private blocks: number[] = []; // energía de bloques de 400 ms cada 100 ms
  private lastBlockAt = 0;
  private buf = new Float32Array(32768);

  private ensure() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    // Ponderación K (ITU-R BS.1770): estante agudo +4 dB @1681 Hz y paso alto @38 Hz.
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 1681.97;
    shelf.gain.value = 4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 38.13;
    hp.Q.value = 0.5;
    this.master.connect(shelf);
    shelf.connect(hp);
    const split = ctx.createChannelSplitter(2);
    hp.connect(split);
    const rawSplit = ctx.createChannelSplitter(2);
    this.master.connect(rawSplit);
    const mk = () => {
      const a = ctx.createAnalyser();
      a.fftSize = 32768;
      a.smoothingTimeConstant = 0;
      return a;
    };
    this.kL = mk();
    this.kR = mk();
    this.rawL = mk();
    this.rawR = mk();
    split.connect(this.kL, 0);
    split.connect(this.kR, 1);
    rawSplit.connect(this.rawL, 0);
    rawSplit.connect(this.rawR, 1);
    return ctx;
  }

  resume() {
    const ctx = this.ensure();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  private bus(trackId: string) {
    const ctx = this.ensure();
    let b = this.buses.get(trackId);
    if (!b) {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      gain.connect(pan);
      pan.connect(this.master);
      pan.connect(analyser);
      b = { gain, pan, analyser };
      this.buses.set(trackId, b);
    }
    return b;
  }

  setTrack(trackId: string, volume: number, pan: number, audible: boolean) {
    const b = this.bus(trackId);
    const t = this.ctx!.currentTime;
    b.gain.gain.setTargetAtTime(audible ? volume : 0, t, 0.01);
    b.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.01);
  }

  attach(clipId: string, el: HTMLMediaElement) {
    const ctx = this.ensure();
    let n = this.nodes.get(clipId);
    if (n && n.el === el) return n;
    if (n) this.detach(clipId);
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 100;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1000;
    mid.Q.value = 0.7;
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 8000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.15;
    comp.knee.value = 0;
    const makeup = ctx.createGain();
    const pan = ctx.createStereoPanner();
    src.connect(gain);
    gain.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(pan);
    n = { el, src, gain, low, mid, high, comp, makeup, pan, bus: null, compOn: false };
    this.nodes.set(clipId, n);
    return n;
  }

  update(clipId: string, trackId: string, gain: number, fx?: AudioFx) {
    const n = this.nodes.get(clipId);
    if (!n || !this.ctx) return;
    const t = this.ctx.currentTime;
    n.gain.gain.setTargetAtTime(gain, t, 0.008);
    n.low.gain.value = fx?.eqLow ?? 0;
    n.mid.gain.value = fx?.eqMid ?? 0;
    n.high.gain.value = fx?.eqHigh ?? 0;
    n.pan.pan.value = Math.max(-1, Math.min(1, fx?.pan ?? 0));
    const compOn = !!fx?.compressor;
    if (compOn !== n.compOn) {
      n.high.disconnect();
      if (compOn) {
        n.high.connect(n.comp);
        n.comp.connect(n.makeup);
        n.makeup.gain.value = 2;
        n.makeup.connect(n.pan);
      } else {
        n.comp.disconnect();
        n.makeup.disconnect();
        n.high.connect(n.pan);
      }
      n.compOn = compOn;
    }
    if (n.bus !== trackId) {
      n.pan.disconnect();
      n.pan.connect(this.bus(trackId).gain);
      n.bus = trackId;
    }
  }

  detach(clipId: string) {
    const n = this.nodes.get(clipId);
    if (!n) return;
    for (const node of [n.src, n.gain, n.low, n.mid, n.high, n.comp, n.makeup, n.pan]) node.disconnect();
    this.nodes.delete(clipId);
  }

  resetIntegrated() {
    this.blocks = [];
  }

  private meanSquare(a: AnalyserNode, samples: number) {
    a.getFloatTimeDomainData(this.buf);
    let s = 0;
    const from = this.buf.length - samples;
    for (let i = from; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    return s / samples;
  }
  private peak(a: AnalyserNode, samples: number) {
    a.getFloatTimeDomainData(this.buf);
    let p = 0;
    for (let i = this.buf.length - samples; i < this.buf.length; i++) p = Math.max(p, Math.abs(this.buf[i]));
    return p;
  }

  read(playing: boolean): MeterReading | null {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const n400 = Math.round(this.ctx.sampleRate * 0.4);
    const e = this.meanSquare(this.kL, n400) + this.meanSquare(this.kR, n400);
    const lufs = (x: number) => (x > 0 ? -0.691 + 10 * Math.log10(x) : -Infinity);
    const now = performance.now();
    if (playing && now - this.lastBlockAt >= 100) {
      this.blocks.push(e);
      this.lastBlockAt = now;
      if (this.blocks.length > 36000) this.blocks.shift();
    }
    const last30 = this.blocks.slice(-30);
    const short = last30.length ? last30.reduce((a, b) => a + b, 0) / last30.length : 0;
    // Integrada con gating absoluto (-70 LUFS) y relativo (-10 LU).
    const abs = this.blocks.filter((b) => lufs(b) > -70);
    let integrated = -Infinity;
    if (abs.length) {
      const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
      const gated = abs.filter((b) => lufs(b) > rel);
      if (gated.length) integrated = lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
    }
    const n50 = Math.round(this.ctx.sampleRate * 0.05);
    const tracks: Record<string, number> = {};
    const tb = new Float32Array(2048);
    for (const [id, b] of this.buses) {
      b.analyser.getFloatTimeDomainData(tb);
      let p = 0;
      for (let i = 0; i < tb.length; i++) p = Math.max(p, Math.abs(tb[i]));
      tracks[id] = db(p);
    }
    return { momentary: lufs(e), shortTerm: lufs(short), integrated, peakL: db(this.peak(this.rawL, n50)), peakR: db(this.peak(this.rawR, n50)), tracks };
  }
}

export const audioEngine = new AudioEngine();
