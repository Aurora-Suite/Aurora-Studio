import type { MediaKind } from './types';

interface ProbeInfo {
  kind: MediaKind;
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
  colorSpace?: string;
  colorRange?: string;
  colorPrimaries?: string;
}

declare global {
  interface Window {
    api: {
      info(): Promise<{ platform: string; version: string }>;
      openMedia(): Promise<string[]>;
      probe(p: string): Promise<ProbeInfo>;
      thumb(p: string, t: number): Promise<string>;
      peaks(p: string): Promise<{ perSec: number; data: number[] }>;
      encoders(): Promise<{ available: string[]; hwaccels: string[]; ffmpeg: string; version: number }>;
      frame(p: string, t: number): Promise<string>;
      readTextFile(exts: string[]): Promise<{ name: string; text: string } | null>;
      pathForFile(f: File): string;
      saveProject(data: unknown, filePath?: string | null): Promise<string | null>;
      openProject(): Promise<{ filePath: string; data: any } | null>;
      autosave(data: unknown): Promise<void>;
      restore(): Promise<any>;
      pickExportPath(ext: string): Promise<string | null>;
      startExport(job: unknown): Promise<{ ok: boolean; error?: string }>;
      cancelExport(): Promise<boolean>;
      onExportProgress(cb: (p: { ratio: number; eta: number | null; speed?: number; fps?: number }) => void): () => void;
      reveal(p: string): Promise<void>;
    };
  }
}
export {};
