import type { WorkProject, WorkTask } from '../../../src/plugins/work-manager/model';
import { validateProject } from '../../../src/plugins/work-manager/model';
import { confirmDraft, parseDraft, ProjectDraft } from '../../../src/plugins/work-manager/draft';
import { createTimerStore } from './timerStore';
interface Saved { project: WorkProject; revision: string; archived: boolean; warnings?: string[] }
import { ApiError, createHttpClient } from '../../core/httpClient';
export interface ProjectMetadata { id: string; title: string; description: string }

/** Mutable operation controller keeps pending snapshots stable while React edits newer data. */
export function createEditor(metadata: ProjectMetadata, namespace: string, onChange: () => void) {
  let disposed = false;
  const notify = () => { if (!disposed) onChange(); };
  const http = createHttpClient();
  const prefix = `kb.wm.v1:${location.origin}:${namespace}:`;
  const apiRoot = '/api/work-manager';
  let draft: ProjectDraft | undefined;
  let busy = false;
  let expired = false;
  let csrf = '';
  let status = 'Завантаження задач…';
  let persistenceOK = true;
  const timer = createTimerStore(prefix, () => draft, persist, changed, message, notify);
  function message(text: string) { status = text; notify(); }
  function persist(): boolean {
    if (!draft) return true;
    try {
      localStorage.setItem(prefix + draft.project.id, JSON.stringify(draft));
      persistenceOK = true;
      return true;
    } catch {
      persistenceOK = false;
      message('Не вдалося зберегти чернетку в браузері. Не закривайте сторінку.');
      return false;
    }
  }
  function changed() {
    if (!draft) return;
    draft.dirty = true;
    if (persist()) message('Чернетка · зміни ще не збережені у Drive');
    updateButtons();
  }
  function error(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      expired = true;
      timer.hide();
      message('Сесію завершено. Чернетки залишилися в цьому браузері.');
      updateButtons();
      return;
    }
    const code = error instanceof ApiError ? error.code : '';
    message(code === 'invalid_project' || code === 'invalid_request' ? 'Перевірте назви, дати, посилання й залежності задач.' :
      code === 'conflict' ? 'Операцію відхилено. Оновіть список і перевірте стан проєкту.' :
      code === 'unsupported_version' ? 'Версія даних не підтримується. Зміни не збережено.' :
      code === 'unknown_result' ? 'Результат запису невідомий. Чернетку збережено; перевірте результат.' :
      code === 'too_large' ? 'Дані задач перевищують дозволений розмір.' :
      'Сховище недоступне або дані не пройшли перевірку. Чернетку збережено.');
  }
  const api = (path: string, method = 'GET', body?: unknown) => http.request(path, method, body, csrf);
  async function session() { const value = await api('/auth/session'); csrf = value.csrfToken; }
  async function run(action: () => Promise<void>) {
    if (busy || expired) return;
    busy = true; updateButtons();
    try { await action(); } catch (e) { error(e); }
    finally { busy = false; updateButtons(); }
  }
  function updateButtons() { notify(); }
  function canSwitch() { return !draft?.dirty || confirm('Залишити поточну чернетку в браузері?'); }
  function renderEditor() { notify(); }
  function renderDrafts() { notify(); }
  async function loadProject() {
    if (!canSwitch()) return;
    try {
      const saved: Saved = await api(`${apiRoot}/projects/${encodeURIComponent(metadata.id)}`);
      validateProject(saved.project);
      draft = { version: 1, project: { ...saved.project, title: metadata.title, notes: metadata.description },
        created: true, dirty: false, revision: saved.revision };
      message('Завантажено з Drive');
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      // The document defines the project; its Drive JSON is initialized only on the first explicit Save.
      draft = { version: 1, created: false, dirty: false, project: {
        schemaVersion: 1, id: metadata.id, type: 'project', title: metadata.title, notes: metadata.description, tasks: [],
      } };
      message('Задач поки немає. Додайте першу задачу.');
    }
    renderEditor(); renderDrafts();
  }
  const save = () => run(async () => {
    if (timer.active()) { message('Спочатку зупиніть таймер і підтвердьте або відкиньте інтервал.'); return; }
    if (!draft || draft.pending) return;
    const snapshot = { ...structuredClone(draft.project), title: metadata.title, notes: metadata.description };
    const empty = snapshot.tasks.findIndex(task => !task.title.trim());
    if (empty >= 0) { message(`Задача ${empty + 1}: заповніть назву.`); return; }
    try { validateProject(snapshot); } catch { throw new ApiError(422, 'invalid_project'); }
    draft.pending = { kind: draft.created ? 'update' : 'create', operationId: crypto.randomUUID(), project: snapshot };
    if (!persist()) { delete draft.pending; return; }
    await sendPending(false);
  });
  const check = () => run(() => sendPending(true));
  async function sendPending(reconcile: boolean) {
    const current = draft;
    const pending = current?.pending;
    if (!current || !pending) return;
    message(reconcile ? 'Перевірка запису…' : 'Збереження…');
    await session();
    let saved: Saved;
    if (pending.kind === 'create') {
      if (!pending.ticket) {
        let prepared;
        try { prepared = await api(`${apiRoot}/projects/prepare`, 'POST', { operationId: pending.operationId, project: pending.project }); }
        catch (e) {
          if (e instanceof ApiError && [400, 413, 422].includes(e.status)) { delete current.pending; persist(); }
          throw e;
        }
        pending.ticket = prepared.ticket;
        if (!persist()) return; // Never commit a create whose retry ticket was not persisted.
      }
      saved = await api(`${apiRoot}/projects`, 'POST', { ticket: pending.ticket, project: pending.project });
    } else {
      saved = await api(`${apiRoot}/projects/${pending.project.id}${reconcile ? '/reconcile' : ''}`, reconcile ? 'POST' : 'PUT',
        { operationId: pending.operationId, project: pending.project, ...(reconcile ? { archived: false } : {}) });
    }
    validateProject(saved.project);
    confirmDraft(current, saved.project, saved.revision);
    persist(); renderDrafts();
    message(current.dirty ? 'Збережено попередню версію. Нові правки залишаються чернеткою.' : 'Збережено у Drive');
    if (saved.warnings?.includes('backup_cleanup_pending')) message('Збережено у Drive. Очищення резервних копій потребує повторної перевірки.');
    if (!persistenceOK) message('Збережено у Drive, але локальну чернетку не вдалося оновити.');

  }
  const freshSave = () => {
    if (!draft?.pending || draft.pending.kind !== 'update') return;
    if (!confirm('Попередній запис міг відбутися. Новий явний Save замінить поточні дані Drive цією чернеткою. Продовжити?')) return;
    delete draft.pending; changed(); updateButtons();
  };
  const logout = () => run(async () => {
    if (timer.active()) { message('Перед виходом завершіть таймер.'); return; }
    if (draft?.dirty && !confirm('Є незбережені зміни. Залишити чернетку й вийти?')) return;
    const clear = confirm('Очистити локальні чернетки Work Manager у цьому браузері?');
    await session();
    const response = await fetch('/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf } });
    if (!response.ok) throw new ApiError(response.status, 'request_failed');
    if (clear) for (const key of Object.keys(localStorage).filter(key => key.startsWith(prefix))) localStorage.removeItem(key);
    draft = undefined;
    location.assign('/login');
  });

  const restore = () => {
    if (busy || expired || !canSwitch()) return;
    try {
      const restored = parseDraft(localStorage.getItem(prefix + metadata.id) || '');
      if (restored.project.id !== metadata.id) throw new Error('Wrong project');
      draft = restored;
      draft.project.title = metadata.title; draft.project.notes = metadata.description;
      message('Чернетку відновлено. Save виконується лише за вашою дією.');
    } catch { message('Чернетку не вдалося відкрити.'); }
  };
  const hasDraft = () => {
    try { const value = parseDraft(localStorage.getItem(prefix + metadata.id) || ''); return value.dirty || !!value.pending; }
    catch { return false; }
  };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (draft?.dirty || draft?.pending || timer.active()) { event.preventDefault(); event.returnValue = ''; }
  };
  let interval: ReturnType<typeof setInterval> | undefined;
  return {
    state: () => ({ draft, busy, expired, status, hasDraft: hasDraft() }), timer,
    save, check, freshSave, logout, restore,
    reload: () => run(loadProject),
    edit: (id: string, patch: Partial<WorkTask>) => {
      if (expired) return;
      const task = draft?.project.tasks.find(item => item.id === id);
      if (task) { Object.assign(task, patch); changed(); }
    },
    add: (task: WorkTask) => {
      if (!draft || expired || draft.project.tasks.length >= 500 || draft.project.tasks.some(item => item.id === task.id)) return false;
      draft.project.tasks.push(structuredClone(task));
      changed();
      return true;
    },
    start: () => {
      window.addEventListener('beforeunload', beforeUnload);
      timer.connect();
      interval = setInterval(() => { if (!busy && !expired) void session().catch(error); }, 60000);
      void run(async () => { await session(); await loadProject(); });
    },
    dispose: () => { disposed = true; http.dispose(); clearInterval(interval); window.removeEventListener('beforeunload', beforeUnload); timer.dispose(); },
  };
}
