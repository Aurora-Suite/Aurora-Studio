import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import TitleBar from './components/TitleBar';
import MediaBin from './components/MediaBin';
import Viewer from './components/Viewer';
import Inspector from './components/Inspector';
import Timeline from './components/Timeline';
import ExportDialog from './components/ExportDialog';
import Mixer from './components/Mixer';
import Boundary from './components/Boundary';
import { importMedia, openProject, saveProject, shuttle, stepFrames, togglePlay } from './lib/actions';
import { sourceCtl } from './components/Viewer';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const s = useStore.getState();
      if (s.exportOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const handled = () => e.preventDefault();

      if (mod && k === 'z' && !e.shiftKey) return handled(), s.undo();
      if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) return handled(), s.redo();
      if (mod && k === 's') return handled(), saveProject(e.shiftKey);
      if (mod && k === 'o') return handled(), openProject();
      if (mod && k === 'i') return handled(), importMedia();
      if (mod && k === 'e') return handled(), useStore.setState({ exportOpen: true, playing: false });
      if (mod && k === 'd') return handled(), s.duplicateSelected();
      if (mod && k === 'b') return handled(), s.splitAt();
      if (mod && k === 'a') return handled(), useStore.setState({ selected: s.clips.map((c) => c.id) });
      if (mod) return;

      switch (k) {
        case ' ':
          handled();
          togglePlay();
          break;
        case 's':
          s.splitAt();
          break;
        case 'v':
          useStore.setState({ tool: 'select' });
          break;
        case 'b':
          useStore.setState({ tool: 'ripple' });
          break;
        case 'r':
          useStore.setState({ tool: 'roll' });
          break;
        case 'y':
          useStore.setState({ tool: 'slip' });
          break;
        case 'u':
          useStore.setState({ tool: 'slide' });
          break;
        case 'c':
          useStore.setState({ tool: 'razor' });
          break;
        case 'i':
          if (s.monitor === 'source') sourceCtl.markIn();
          else useStore.setState({ markIn: s.time });
          break;
        case 'o':
          if (s.monitor === 'source') sourceCtl.markOut();
          else useStore.setState({ markOut: s.time });
          break;
        case ',':
          s.editFromSource('insert');
          break;
        case '.':
          s.editFromSource('overwrite');
          break;
        case 'delete':
        case 'backspace':
          handled();
          s.deleteSelected(e.shiftKey);
          break;
        case 'arrowleft':
          handled();
          stepFrames(e.shiftKey ? -s.settings.fps : -1);
          break;
        case 'arrowright':
          handled();
          stepFrames(e.shiftKey ? s.settings.fps : 1);
          break;
        case 'home':
          s.setTime(0);
          break;
        case 'end':
          s.setTime(s.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0));
          break;
        case 'j':
          shuttle(-1);
          break;
        case 'k':
          shuttle(0);
          break;
        case 'l':
          shuttle(1);
          break;
        case 't':
          s.addText();
          break;
        case 'n':
          useStore.setState({ snapping: !s.snapping });
          s.notify(`Imán ${!s.snapping ? 'activado' : 'desactivado'}`);
          break;
        case '+':
        case '=':
          useStore.setState({ pps: Math.min(600, s.pps * 1.25) });
          break;
        case '-':
          useStore.setState({ pps: Math.max(2, s.pps / 1.25) });
          break;
        case 'escape':
          useStore.setState({ selected: [], markIn: null, markOut: null, tool: 'select' });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useFileDrop() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      // Si cae sobre la línea de tiempo, Timeline lo gestiona (añade además el clip).
      if ((e.target as HTMLElement).closest?.('.tl-lane')) return;
      const paths = Array.from(e.dataTransfer.files).map((f) => window.api.pathForFile(f)).filter(Boolean);
      if (paths.length) useStore.getState().importPaths(paths);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}

function useAutosave() {
  useEffect(() => {
    let restored = false;
    window.api.restore().then((data) => {
      const s = useStore.getState();
      if (data && data.clips?.length && !s.clips.length && !s.media.length) {
        s.loadProject(data.project ?? data, data.filePath ?? null);
        useStore.setState({ dirty: !!data.dirty });
        s.notify('Sesión anterior restaurada');
      }
      restored = true;
    });
    let lastSaved: unknown = null;
    const id = setInterval(() => {
      const s = useStore.getState();
      if (!restored || (s.clips === lastSaved && !s.dirty)) return;
      lastSaved = s.clips;
      window.api.autosave({ ...s.toData(), filePath: s.filePath, dirty: s.dirty }).catch(() => {});
    }, 4000);
    return () => clearInterval(id);
  }, []);
}

export default function App() {
  const exportOpen = useStore((s) => s.exportOpen);
  const toast = useStore((s) => s.toast);
  const rightPanel = useStore((s) => s.rightPanel);
  const [platform, setPlatform] = useState('win32');
  const [tlHeight, setTlHeight] = useState(330);
  const drag = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    window.api.info().then((i) => {
      setPlatform(i.platform);
      document.documentElement.dataset.platform = i.platform;
    });
  }, []);
  useShortcuts();
  useFileDrop();
  useAutosave();

  return (
    <div className="app">
      <TitleBar platform={platform} />
      <div className="workspace" style={{ ['--tl-h' as any]: `${tlHeight}px` }}>
        <Boundary name="Biblioteca">
          <MediaBin />
        </Boundary>
        <Boundary name="Visor">
          <Viewer />
        </Boundary>
        <Boundary name="Inspector">{rightPanel === 'mixer' ? <Mixer /> : <Inspector platform={platform} />}</Boundary>
        <div
          className="splitter"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, h: tlHeight };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const h = drag.current.h - (e.clientY - drag.current.y);
            setTlHeight(Math.max(180, Math.min(window.innerHeight - 340, h)));
          }}
          onPointerUp={() => (drag.current = null)}
        />
        <Boundary name="Línea de tiempo">
          <Timeline />
        </Boundary>
      </div>
      {exportOpen && (
        <Boundary name="Exportar">
          <ExportDialog />
        </Boundary>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
