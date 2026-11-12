import type { WorkTask } from '../../../src/plugins/work-manager/model';
import { dependencyLayout } from '../../../src/plugins/work-manager/dependency-layout';
import { taskReadiness } from '../../../src/plugins/work-manager/planning';
import { Button, Icon } from '../../shared/controls';
import { taskStatusLabels } from './TaskStatus';

export function readinessLabel(task: WorkTask, tasks: WorkTask[]) {
  const state = taskReadiness(task, tasks);
  const status = taskStatusLabels[task.status];
  if (task.archived) return `${status} · Архів`;
  if (state === 'done') return status;
  return `${status} · ${state === 'blocked' ? 'очікує попередників' : 'доступна'}`;
}

export function TaskState({ task, tasks }: { task: WorkTask; tasks: WorkTask[] }) {
  const icon = task.archived ? 'icon-[lucide--archive]' : task.status === 'done'
    ? 'icon-[lucide--circle-check]' : task.status === 'in_progress'
      ? 'icon-[lucide--circle-dot]' : 'icon-[lucide--circle]';
  return <><Icon name={icon} /> {readinessLabel(task, tasks)}</>;
}

export function DependencyGraph({ tasks, selectedId, onSelect }: {
  tasks: WorkTask[]; selectedId?: string; onSelect: (id: string) => void;
}) {
  const active = tasks.filter(task => !task.archived);
  // Include archived direct/indirect prerequisites so edges are never silently disconnected.
  const included = new Set(active.map(task => task.id));
  const include = (id: string) => {
    const task = tasks.find(item => item.id === id);
    for (const dependency of task?.blockedBy || []) {
      if (!included.has(dependency)) { included.add(dependency); include(dependency); }
    }
  };
  active.forEach(task => include(task.id));
  const graphTasks = tasks.filter(task => included.has(task.id));
  const positions = dependencyLayout(graphTasks);
  const byId = new Map(positions.map(position => [position.id, position]));
  const width = Math.max(500, ...positions.map(position => position.x + 216));
  const height = Math.max(140, ...positions.map(position => position.y + 76));
  return <section className="wm-panel wm-graph"><h2>Залежності</h2>
    {!positions.length ? <p>Додайте задачі, щоб побачити граф залежностей.</p> : <>
      <p className="wm-graph-hint">Зв’язки йдуть від попередника до залежної задачі. Оберіть задачу для деталей.</p>
      <div className="wm-graph-scroll" tabIndex={0} aria-label="Граф залежностей — прокручуйте горизонтально">
        <div className="wm-graph-canvas" style={{ width, height }}>
          <svg width={width} height={height} aria-hidden="true"><defs><marker id="wm-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" /></marker></defs>
            {graphTasks.flatMap(task => task.blockedBy.map(id => {
              const from = byId.get(id); const to = byId.get(task.id);
              if (!from || !to) return null;
              const x = from.x + 196; const y = from.y + 28;
              return <path key={`${id}-${task.id}`} d={`M${x},${y} C${x + 14},${y} ${to.x - 14},${to.y + 28} ${to.x},${to.y + 28}`} markerEnd="url(#wm-arrow)" />;
            }))}
          </svg>
          {graphTasks.map(task => {
            const position = byId.get(task.id)!;
            return <Button key={task.id} className={`wm-graph-node wm-state-${taskReadiness(task, tasks)} ${selectedId === task.id ? 'wm-selected' : ''}`}
              style={{ left: position.x, top: position.y }} aria-pressed={selectedId === task.id}
              title={task.title} onClick={() => onSelect(task.id)}>
              <span>{task.title || 'Без назви'}</span><small><TaskState task={task} tasks={tasks} /></small>
            </Button>;
          })}
        </div>
      </div>
    </>}
  </section>;
}
