import { Component, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

// Aísla cada panel: si uno falla, el resto del editor sigue funcionando y el proyecto no se pierde.
export default class Boundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.name}]`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel" style={{ alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20, textAlign: 'center' }}>
        <b>El panel «{this.props.name}» ha tenido un error</b>
        <span className="muted" style={{ fontSize: 11.5, maxWidth: 320, userSelect: 'text' }}>
          {this.state.error.message}
        </span>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          <RotateCcw size={13} /> Recargar panel
        </button>
      </div>
    );
  }
}
