import { FilePlus2, FolderOpen, Save, Share } from 'lucide-react';
import { useStore } from '../store';
import { newProject, openProject, saveProject } from '../lib/actions';
import { BrandMark } from './ui';

export default function TitleBar({ platform }: { platform: string }) {
  const name = useStore((s) => s.settings.name);
  const dirty = useStore((s) => s.dirty);
  const setSettings = useStore((s) => s.setSettings);
  const mod = platform === 'darwin' ? '⌘' : 'Ctrl+';

  return (
    <div className={`titlebar ${platform === 'darwin' ? 'mac' : 'win'}`}>
      <div className="brand" title="Aurora Studio">
        <BrandMark size={24} />
      </div>
      <div className="title-actions">
        <button className="icon-btn" title="Nuevo proyecto" onClick={newProject}>
          <FilePlus2 size={16} />
        </button>
        <button className="icon-btn" title={`Abrir (${mod}O)`} onClick={openProject}>
          <FolderOpen size={16} />
        </button>
        <button className="icon-btn" title={`Guardar (${mod}S)`} onClick={() => saveProject()}>
          <Save size={16} />
        </button>
      </div>
      <div className="title-center">
        <input value={name} onChange={(e) => setSettings({ name: e.target.value })} spellCheck={false} />
        {dirty && <span className="dirty-dot" title="Cambios sin guardar" />}
      </div>
      <div className="title-actions">
        <button className="btn primary" onClick={() => useStore.setState({ exportOpen: true, playing: false })}>
          <Share size={14} /> Exportar
        </button>
      </div>
    </div>
  );
}
