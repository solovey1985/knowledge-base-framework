import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountPlugin } from '../../core/mount';
import { Button } from '../../shared/controls';
import { bootViewer, type ViewerControls, type ViewOptions } from './client';

function Viewer({ source }: { source: HTMLElement }) {
  const viewport = useRef<HTMLDivElement>(null);
  const controls = useRef<ViewerControls | undefined>(undefined);
  const [status, setStatus] = useState('Loading 3D preview…');
  const [walking, setWalking] = useState(false);
  const [view, setView] = useState<ViewOptions>({
    lighting: 'standard', materials: true, shading: true, lines: false, wireframe: false
  });

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

  function updateView(changes: Partial<ViewOptions>) {
    const next = { ...view, ...changes };
    controls.current?.appearance(next);
    setView(next);
  }
  return <>
    <div ref={viewport} className="absolute inset-0" />
    {status && <p role="status" className="absolute inset-0 grid place-items-center">{status}</p>}
    {walking && <>
      <div className="absolute right-3 top-3">
        <Button onClick={() => controls.current?.stopWalking()}>Вийти з ходьби</Button>
      </div>
      <div className="absolute bottom-3 left-3 space-y-2">
        <p role="status" className="pointer-events-none rounded bg-white px-3 py-2 text-sm text-slate-900">
          WASD — рух · E/Q — висота · перетягни для огляду · Esc — вихід
        </p>
        <div className="grid w-fit grid-cols-3 gap-1" role="group" aria-label="Рух">
          {([
            ['KeyW', '↑', 'Вперед', 'col-start-2'],
            ['KeyA', '←', 'Ліворуч', 'col-start-1'],
            ['KeyS', '↓', 'Назад', 'col-start-2'],
            ['KeyD', '→', 'Праворуч', 'col-start-3'],
            ['KeyE', '+', 'Піднятися', 'col-start-1'],
            ['KeyQ', '−', 'Опуститися', 'col-start-3']
          ] as const).map(([key, symbol, label, column]) =>
            <button key={key} type="button" aria-label={label}
              className={`${column} touch-none select-none rounded border border-slate-300 bg-white size-12 text-slate-900 active:bg-sky-100`}
              onPointerDown={event => {
                if (event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                controls.current?.move(key, true);
              }}
              onLostPointerCapture={() => controls.current?.move(key, false)}>
              {symbol}
            </button>
          )}
        </div>
      </div>
    </>}
    <div hidden={walking} className={walking ? 'hidden' : 'absolute right-3 top-3 flex flex-wrap items-start justify-end gap-2'}>
      <Button disabled={!controls.current} onClick={() => controls.current?.walk(setWalking)}>Ходьба</Button>
      <Button icon="icon-[lucide--rotate-ccw]" disabled={!controls.current} onClick={() => controls.current?.reset()}>Reset</Button>
      <Button icon="icon-[lucide--box]" disabled={!controls.current} aria-pressed={view.wireframe}
        onClick={() => updateView({ wireframe: !view.wireframe })}>Wireframe</Button>
      {controls.current && <details className="rounded-lg border border-slate-300 bg-white text-slate-900">
        <summary className="cursor-pointer px-3 py-2">Вигляд</summary>
        <div className="grid gap-2 px-3 pb-3">
          <label className="grid gap-1">
            Освітлення
            <select className="rounded border border-slate-300 px-2 py-1" value={view.lighting}
              disabled={!view.shading}
              onChange={event => updateView({ lighting: event.currentTarget.value as ViewOptions['lighting'] })}>
              <option value="standard">Стандартне</option>
              <option value="soft">М’яке</option>
              <option value="camera">З боку камери</option>
            </select>
          </label>
          <label><input type="checkbox" checked={!view.materials}
            onChange={event => updateView({ materials: !event.currentTarget.checked })} /> Без матеріалів</label>
          <label><input type="checkbox" checked={!view.shading}
            onChange={event => updateView({ shading: !event.currentTarget.checked })} /> No shading</label>
          <label><input type="checkbox" checked={view.lines} disabled={view.wireframe}
            onChange={event => updateView({ lines: event.currentTarget.checked })} /> Show lines</label>
        </div>
      </details>}
    </div>
  </>;
}

mountPlugin('[data-kb-3d-viewer]', host => {
  const root = createRoot(host);
  root.render(<Viewer source={host} />);
  return () => root.unmount();
});

