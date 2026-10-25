import { useStore, totalDuration } from '../store';
import { audioEngine } from './audio';
import { sourceCtl } from '../components/Viewer';

export async function importMedia() {
  const paths = await window.api.openMedia();
  if (paths.length) await useStore.getState().importPaths(paths);
}

export async function saveProject(saveAs = false) {
  const s = useStore.getState();
  const target = await window.api.saveProject(s.toData(), saveAs ? null : s.filePath);
  if (target) {
    useStore.setState({ filePath: target, dirty: false });
    s.notify('Proyecto guardado');
  }
}

export async function openProject() {
  const s = useStore.getState();
  if (s.dirty && !confirm('Hay cambios sin guardar. ¿Abrir otro proyecto igualmente?')) return;
  const r = await window.api.openProject();
  if (r) {
    s.loadProject(r.data, r.filePath);
    s.notify('Proyecto abierto');
  }
}

export function newProject() {
  const s = useStore.getState();
  if (s.dirty && !confirm('Hay cambios sin guardar. ¿Crear un proyecto nuevo?')) return;
  s.newProject();
}

export function togglePlay() {
  const s = useStore.getState();
  if (s.monitor === 'source') return sourceCtl.toggle();
  audioEngine.resume();
  const total = totalDuration(s.clips);
  if (!s.playing && total > 0 && s.time >= total - 1e-3) {
    s.setTime(0);
    audioEngine.resetIntegrated();
  }
  useStore.setState({ playing: !s.playing, shuttle: 1 });
}

// J/K/L: cada pulsación de L o J duplica la velocidad en ese sentido; K detiene.
export function shuttle(dir: -1 | 0 | 1) {
  const s = useStore.getState();
  if (s.monitor === 'source') return dir === 0 ? sourceCtl.toggle() : undefined;
  audioEngine.resume();
  if (dir === 0) return useStore.setState({ playing: false, shuttle: 1 });
  const cur = s.playing ? s.shuttle : 0;
  const next = Math.sign(cur) === dir ? Math.max(-16, Math.min(16, cur * 2)) : dir;
  useStore.setState({ playing: true, shuttle: next });
}

export function stepFrames(n: number) {
  const s = useStore.getState();
  useStore.setState({ playing: false });
  s.setTime(Math.round((s.time + n / s.settings.fps) * s.settings.fps) / s.settings.fps);
}
