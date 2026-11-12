import type { WorkTask } from './model';

/** Stable columns follow prerequisites; row order follows the authored task order. */
export function dependencyLayout(tasks: readonly WorkTask[]) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  function level(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) throw new Error('Cyclic dependency graph');
    visiting.add(id);
    const predecessors = (byId.get(id)?.blockedBy || []).filter(key => byId.has(key));
    const value = predecessors.length ? Math.max(...predecessors.map(level)) + 1 : 0;
    visiting.delete(id);
    levels.set(id, value);
    return value;
  }
  const rows = new Map<number, number>();
  return tasks.map(task => {
    const column = level(task.id);
    const row = rows.get(column) || 0;
    rows.set(column, row + 1);
    return { id: task.id, x: 16 + column * 224, y: 16 + row * 78 };
  });
}
