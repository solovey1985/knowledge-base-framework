import { ProjectDraft } from './draft';
import { validId } from './model';

export interface TaskTimer {
  version: 1;
  id: string;
  projectId: string;
  taskId: string;
  startedAt: number;
  baseMinutes: number;
  stoppedAt?: number;
}

export function parseTimer(raw: string): TaskTimer {
  if (raw.length > 2048) throw new Error('Invalid timer');
  const value = JSON.parse(raw) as TaskTimer;
  if (value.version !== 1 || !validId(value.id) || !validId(value.projectId) || !validId(value.taskId) ||
    !Number.isSafeInteger(value.startedAt) || value.startedAt < 0 ||
    !Number.isSafeInteger(value.baseMinutes) || value.baseMinutes < 0 || value.baseMinutes > 52560000 ||
    (value.stoppedAt !== undefined && (!Number.isSafeInteger(value.stoppedAt) || value.stoppedAt < 0))) {
    throw new Error('Invalid timer');
  }
  return value;
}

/** Wall-clock elapsed is a suggestion only; sleep/reload/clock changes require review. */
export function suggestedMinutes(timer: TaskTimer): number {
  if (timer.stoppedAt === undefined) throw new Error('Timer still running');
  return Math.max(0, Math.min(52560000, Math.ceil((timer.stoppedAt - timer.startedAt) / 60000)));
}

/** Persist the receipt together with the increment before removing the timer record. */
export function applyTimer(draft: ProjectDraft, timer: TaskTimer, minutes: number): void {
  if (draft.project.id !== timer.projectId || timer.stoppedAt === undefined ||
    !Number.isSafeInteger(minutes) || minutes < 0) throw new Error('Invalid timer result');
  if (draft.lastTimerId === timer.id) return;
  const task = draft.project.tasks.find(item => item.id === timer.taskId);
  // A reload can lose a local receipt while Drive already contains the increment.
  // Never add an old interval to a different total: the user must reconcile/discard it.
  if (!task || task.spentMinutes !== timer.baseMinutes || task.spentMinutes + minutes > 52560000) {
    throw new Error('Timer baseline changed');
  }
  task.spentMinutes += minutes;
  draft.lastTimerId = timer.id;
  draft.dirty = true;
}
