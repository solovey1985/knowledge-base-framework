import type { WorkTask } from './model';

/** Archive changes visibility, never the completion of a prerequisite. */
export function taskReadiness(task: WorkTask, tasks: readonly WorkTask[]): 'done' | 'ready' | 'blocked' {
  if (task.status === 'done') return 'done';
  const byId = new Map(tasks.map(item => [item.id, item]));
  return task.blockedBy.every(id => byId.get(id)?.status === 'done') ? 'ready' : 'blocked';
}

export function projectProgress(tasks: readonly WorkTask[]) {
  const active = tasks.filter(task => !task.archived);
  const done = active.filter(task => task.status === 'done').length;
  return { done, total: active.length, percent: active.length ? Math.round(done * 100 / active.length) : null };
}

/** Today is available work, including future/undated tasks, not a due-date filter. */
export function todayTasks(tasks: readonly WorkTask[]): WorkTask[] {
  const priority = { high: 0, normal: 1, low: 2 };
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return tasks.filter(task => !task.archived && taskReadiness(task, tasks) === 'ready')
    .sort((a, b) => priority[a.priority] - priority[b.priority] ||
      compare(a.dueDate || '9999-99-99', b.dueDate || '9999-99-99') || compare(a.id, b.id));
}

/** Check only the graph so incomplete text fields remain editable in a draft. */
export function canAddDependency(tasks: readonly WorkTask[], taskId: string, dependencyId: string): boolean {
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (taskId === dependencyId || !byId.has(taskId) || !byId.has(dependencyId)) return false;
  const visited = new Set<string>();
  const reachesTask = (id: string): boolean => {
    if (id === taskId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return (byId.get(id)?.blockedBy || []).some(reachesTask);
  };
  return !reachesTask(dependencyId);
}
