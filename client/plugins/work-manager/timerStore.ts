import { MAX_SPENT_MINUTES } from '../../../src/plugins/work-manager/duration';
import { parseDraft, type ProjectDraft } from '../../../src/plugins/work-manager/draft';
import { applyTimer, parseTimer, TaskTimer, suggestedMinutes } from '../../../src/plugins/work-manager/timer';

/** All interval mutations share a workspace lock; storage events only notify the UI. */
export function createTimerStore(prefix: string, getDraft: () => ProjectDraft | undefined,
  persist: () => boolean, changed: () => void, report: (text: string) => void, notify: () => void) {
  const key = prefix + '$timer';
  let hidden = false;
  const read = (): TaskTimer | undefined => {
    const raw = localStorage.getItem(key);
    return raw ? parseTimer(raw) : undefined;
  };
  const action = async (work: () => void) => {
    if (hidden) return false;
    if (!navigator.locks) { report('Облік часу потребує HTTPS або localhost і Web Locks.'); return false; }
    try {
      await navigator.locks.request(key, () => {
        if (hidden) throw new Error('Session expired');
        work();
      });
      return true;
    } catch {
      report('Час не змінено. Перевірте таймер і відновіть актуальну чернетку.');
      return false;
    } finally {
      notify();
    }
  };
  const storage = (event: StorageEvent) => { if (event.key === key) notify(); };
  return {
    read: () => { try { return hidden ? undefined : read(); } catch { return undefined; } },
    suggestedMinutes,
    active: () => { try { return !!read(); } catch { return true; } },
    hide: () => { hidden = true; notify(); },
    connect: () => window.addEventListener('storage', storage),
    dispose: () => window.removeEventListener('storage', storage),
    start: (taskId: string) => action(() => {
      if (read()) { report('У цьому workspace вже є таймер.'); return; }
      const draft = getDraft();
      const task = draft?.project.tasks.find(item => item.id === taskId);
      if (!draft || !task || draft.pending) throw new Error('Draft unavailable');
      // Do not overwrite a newer tab's snapshot while starting another interval.
      const stored = localStorage.getItem(prefix + draft.project.id);
      if (stored) {
        const previous = parseDraft(stored);
        if ((previous.dirty || previous.pending) && stored !== JSON.stringify(draft)) throw new Error('Stale draft');
      }
      draft.dirty = true;
      if (!persist()) throw new Error('Persistence unavailable');
      const timer: TaskTimer = { version: 1, id: crypto.randomUUID(), taskId, projectId: draft.project.id,
        baseMinutes: task.spentMinutes, startedAt: Date.now() };
      localStorage.setItem(key, JSON.stringify(timer));
    }),
    stop: () => action(() => {
      const timer = read();
      if (timer && timer.stoppedAt === undefined) localStorage.setItem(key, JSON.stringify({ ...timer, stoppedAt: Date.now() }));
    }),
    addManual: (taskId: string, minutes: number) => action(() => {
      const draft = getDraft();
      const task = draft?.project.tasks.find(item => item.id === taskId);
      const timer = read();
      if (!draft || !task || draft.pending || !Number.isSafeInteger(minutes) || minutes <= 0 ||
        (timer?.projectId === draft.project.id && timer.taskId === taskId) || task.spentMinutes + minutes > MAX_SPENT_MINUTES) {
        throw new Error('Invalid manual interval');
      }
      const previous = localStorage.getItem(prefix + draft.project.id);
      if (previous && previous !== JSON.stringify(draft) && parseDraft(previous).dirty) throw new Error('Stale draft');
      const snapshot = structuredClone(draft);
      snapshot.project.tasks.find(item => item.id === taskId)!.spentMinutes += minutes;
      snapshot.dirty = true;
      localStorage.setItem(prefix + draft.project.id, JSON.stringify(snapshot));
      Object.assign(draft, snapshot);
      changed();
      report('Час додано до чернетки. Збережіть у Drive.');
    }),
    apply: (id: string, minutes: number) => action(() => {
      const timer = read(); const draft = getDraft();
      if (!timer || timer.id !== id || !draft || draft.pending ||
        localStorage.getItem(prefix + draft.project.id) !== JSON.stringify(draft)) throw new Error('Restore current draft');
      const snapshot = structuredClone(draft);
      applyTimer(snapshot, timer, minutes);
      localStorage.setItem(prefix + draft.project.id, JSON.stringify(snapshot));
      Object.assign(draft, snapshot);
      localStorage.removeItem(key);
      changed(); report('Час додано до чернетки. Збережіть у Drive.');
    }),
    discard: (id: string) => action(() => {
      if (read()?.id === id) localStorage.removeItem(key);
      report('Інтервал відкинуто.');
    }),
  };
}
