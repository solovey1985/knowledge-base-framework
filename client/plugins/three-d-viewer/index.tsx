import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountPlugin } from '../../core/mount';
import { Button } from '../../shared/controls';
import { bootViewer, type ViewerControls } from './client';

function Viewer({ source }: { source: HTMLElement }) {
  const viewport = useRef<HTMLDivElement>(null);
  const controls = useRef<ViewerControls | undefined>(undefined);
  const [status, setStatus] = useState('Loading 3D preview…');
  const [wireframe, setWireframe] = useState(false);

  useEffect(() => {
    const lifetime = new AbortController();
    bootViewer(viewport.current!, source, lifetime.signal).then(viewer => {
      if (lifetime.signal.aborted) return;
      controls.current = viewer;
      setStatus('');
    }).catch(() => {
      if (!lifetime.signal.aborted) setStatus('Failed to load 3D preview.');
    });
    return () => lifetime.abort();
  }, [source]);

  function toggleMaterial() {
    const enabled = !wireframe;
    controls.current?.wireframe(enabled);
    setWireframe(enabled);
  }
  return <>
    <div ref={viewport} className="absolute inset-0" />
    {status && <p role="status" className="absolute inset-0 grid place-items-center">{status}</p>}
    <div className="absolute right-3 top-3 flex gap-2">
      <Button icon="icon-[lucide--rotate-ccw]" disabled={!controls.current} onClick={() => controls.current?.reset()}>Reset</Button>
      <Button icon="icon-[lucide--box]" disabled={!controls.current} aria-pressed={wireframe} onClick={toggleMaterial}>{wireframe ? 'Solid' : 'Wireframe'}</Button>
    </div>
  </>;
}

mountPlugin('[data-kb-3d-viewer]', host => {
  const root = createRoot(host);
  root.render(<Viewer source={host} />);
  return () => root.unmount();
});

