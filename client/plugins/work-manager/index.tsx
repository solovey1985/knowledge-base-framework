import { useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountPlugin } from '../../core/mount';
import { Button, Field, Icon } from '../../shared/controls';
import { createEditor, ProjectMetadata } from './editor';
import type { WorkTask } from '../../../src/plugins/work-manager/model';
import { DependencyGraph, TaskState } from './DependencyGraph';
import { formatDuration } from '../../../src/plugins/work-manager/duration';
import { validateProject } from '../../../src/plugins/work-manager/model';
import { canAddDependency, projectProgress, taskReadiness, todayTasks } from '../../../src/plugins/work-manager/planning';

import { TaskTimer } from './TaskTimer';
import { TimeDialog } from './TimeDialog';
import { TaskStatus } from './TaskStatus';
function TaskFields({ task, tasks, set }: { task: WorkTask; tasks: WorkTask[]; set: (patch: Partial<WorkTask>) => void }) {
  const readiness = taskReadiness(task, tasks);
  return <fieldset className="wm-task"><legend>Задача</legend>
    <Field label="Назва задачі"><input aria-label="Назва задачі" value={task.title} aria-invalid={!task.title.trim()}
      onChange={event => set({ title: event.target.value })} />
      {!task.title.trim() && <small role="alert">Вкажіть назву задачі.</small>}</Field>
    <TaskStatus value={task.status} onChange={status => set({ status })} />
    <Field label="Пріоритет"><select value={task.priority} onChange={event => set({ priority: event.target.value as WorkTask['priority'] })}>
      <option value="high">Високий</option><option value="normal">Звичайний</option><option value="low">Низький</option>
    </select></Field>
    <Field label="Дата виконання"><input type="date" value={task.dueDate || ''} onChange={event => set({ dueDate: event.target.value || null })} /></Field>
    <Field label="Критерій готовності"><textarea value={task.doneWhen} onChange={event => set({ doneWhen: event.target.value })} /></Field>
    <Field label="Нотатка (.md, відносно content)"><input value={task.docPath || ''} onChange={event => set({ docPath: event.target.value || null })} /></Field>
    <small>Витрачено: {formatDuration(task.spentMinutes)} · Залежностей: {task.blockedBy.length}</small>
    <p>{{ ready: 'Ready · доступна', blocked: 'Blocked · очікує попередників', done: 'Виконано' }[readiness]}</p>
    <details><summary>Залежності</summary>{tasks.filter(item => item.id !== task.id).map(item => {
      const checked = task.blockedBy.includes(item.id);
      return <label key={item.id}><input type="checkbox" checked={checked}
        disabled={!checked && !canAddDependency(tasks, task.id, item.id)}
        onChange={event => set({ blockedBy: event.target.checked ? [...task.blockedBy, item.id] : task.blockedBy.filter(id => id !== item.id) })} />
        <span>{item.title || 'Без назви'}{item.archived ? ' (архів)' : ''}</span></label>;
    })}{tasks.length < 2 && <p>Інших задач немає.</p>}</details>
  </fieldset>;
}

/** The dialog owns a copy; Cancel/Escape never mutates the persisted browser draft. */
function TaskDialog({ task, tasks, onApply, onClose }: {
  task: WorkTask; tasks: WorkTask[]; onApply: (task: WorkTask) => boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [working, setWorking] = useState(() => structuredClone(task));
  const [error, setError] = useState('');
  const graph = [...tasks.filter(item => item.id !== working.id), working];
  useEffect(() => {
    const host = dialog.current!;
    host.showModal();
    host.querySelector<HTMLInputElement>('input')?.focus();
    return () => host.close();
  }, []);
  const close = () => onClose();
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(working) !== JSON.stringify(task)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [working, task]);
  return <dialog ref={dialog} className="wm-dialog" aria-labelledby="wm-dialog-title"
    onCancel={event => { event.preventDefault(); close(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      if (!working.title.trim()) { setError('Вкажіть назву задачі.'); return; }
      try {
        validateProject({ schemaVersion: 1, id: 'dialog', type: 'project', title: 'Dialog', notes: '', tasks: graph });
      } catch { setError('Перевірте поля задач і залежності. Назва — до 200 символів, критерій — до 4000.'); return; }
      if (onApply(working)) onClose();
      else setError('Задача змінилася в іншій операції. Закрийте діалог і відкрийте актуальну версію.');
    }}>
      <h2 id="wm-dialog-title">{tasks.some(item => item.id === task.id) ? 'Редагувати задачу' : 'Нова задача'}</h2>
      <TaskFields task={working} tasks={graph} set={patch => { setWorking(value => ({ ...value, ...patch })); setError(''); }} />
      {error && <p role="alert">{error}</p>}
      <p>Застосування оновлює чернетку. Для запису у Drive натисніть «Зберегти у Drive».</p>
      <div className="wm-toolbar"><Button icon="icon-[lucide--check]" type="submit" variant="primary">Застосувати</Button>
        <Button icon="icon-[lucide--x]" onClick={close}>Скасувати</Button></div>
    </form>
  </dialog>;
}

function WorkManagerApp({ metadata, namespace }: { metadata: ProjectMetadata; namespace: string }) {
  const [, refresh] = useReducer(value => value + 1, 0);
  const [editor] = useState(() => createEditor(metadata, namespace, refresh));
  const [timeTaskId, setTimeTaskId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<WorkTask>();
  const [view, setView] = useState<'all' | 'today' | 'archive'>('all');
  useEffect(() => { editor.start(); return () => editor.dispose(); }, [editor]);
  const { draft, busy, expired, status, hasDraft } = editor.state();
  const tasks = draft?.project.tasks || [];
  const progress = projectProgress(tasks);
  const ready = tasks.filter(task => !task.archived && taskReadiness(task, tasks) === 'ready').length;
  const visible = view === 'today' ? todayTasks(tasks) : tasks.filter(task => !!task.archived === (view === 'archive'));
  const timeTask = tasks.find(task => task.id === timeTaskId);
  const selected = visible.find(task => task.id === selectedId) || visible[0];
  const choose = (id: string) => setSelectedId(id);
  const openNew = () => setEditing({ id: crypto.randomUUID(), title: '', status: 'todo', priority: 'normal', dueDate: null, blockedBy: [], doneWhen: '', docPath: null, spentMinutes: 0 });
  return <div className="wm wm-overview"><h1>{metadata.title}</h1><p>{metadata.description}</p>
    <div className="wm-toolbar">
      <Button icon="icon-[lucide--refresh-cw]" disabled={busy || expired} onClick={() => void editor.reload()}>Оновити задачі</Button>
      <Button icon="icon-[lucide--list-todo]" disabled={expired} onClick={() => setView('all')}>Усі задачі</Button>
      <Button icon="icon-[lucide--calendar-days]" disabled={expired} onClick={() => setView('today')}>Today</Button>
      <Button icon="icon-[lucide--archive]" disabled={expired} onClick={() => setView(view === 'archive' ? 'all' : 'archive')}>Активні / Архів задач</Button>
      <Button icon="icon-[lucide--log-out]" disabled={busy || expired} onClick={() => void editor.logout()}>Вийти</Button>
    </div>
    <p role="status" aria-live="polite">{status}</p>
    {expired ? <a href="/login">Увійти знову</a> : <>
      {hasDraft && <Button disabled={busy} onClick={editor.restore}>Відновити чернетку: {metadata.title}</Button>}
      {!draft ? <p>Завантаження задач…</p> : <>
        <div className="wm-summary">
          <div><strong>{progress.done} / {progress.total}</strong><span>виконано задач</span></div>
          <div><strong>{ready}</strong><span>готові до роботи</span></div>
          <div className="wm-summary-progress"><strong>{progress.percent === null ? 'Немає задач' : `${progress.percent}%`}</strong>
            <progress max="100" value={progress.percent || 0} aria-label="Прогрес проєкту" /></div>
        </div>
        <TaskTimer editor={editor} busy={busy} />
        <DependencyGraph tasks={tasks} selectedId={selected?.id} onSelect={id => { setView(tasks.find(task => task.id === id)?.archived ? 'archive' : 'all'); choose(id); }} />
        <section className="wm-project-grid">
          <aside className="wm-panel"><h2>{view === 'archive' ? 'Архів задач' : view === 'today' ? 'Today' : 'Задачі'}</h2>
            <div className="wm-step-list">{visible.map(task => <Button key={task.id} className={task.id === selected?.id ? 'wm-selected' : ''}
              aria-pressed={task.id === selected?.id} onClick={() => choose(task.id)}>
              <span>{task.title || 'Без назви'}</span><small><TaskState task={task} tasks={tasks} /></small>
            </Button>)}</div>
            {!visible.length && <p>{view === 'archive' ? 'Архів порожній.' : 'Немає задач у цьому поданні.'}</p>}
            {view === 'all' && <Button icon="icon-[lucide--plus]" variant="primary" disabled={busy || tasks.length >= 500} onClick={openNew}>Додати задачу</Button>}
          </aside>
          <section className="wm-panel wm-task-detail">
            <header className="wm-task-content">
              <h2>{selected?.title || 'Оберіть задачу'}</h2>
              {selected && <>
                <h3>Критерій готовності</h3>
                <p className="wm-preserve-lines">{selected.doneWhen || 'Критерій готовності ще не заданий.'}</p>
              </>}
            </header>
            {selected && <>
              <section className="wm-task-metadata" aria-label="Метадані задачі">
                <h3>Метадані</h3>
                <TaskStatus value={selected.status} disabled={busy || !!draft.pending}
                  onChange={status => editor.edit(selected.id, { status })} />
                <p className="wm-badge"><TaskState task={selected} tasks={tasks} /></p>
                <dl>
                  <dt><Icon name="icon-[lucide--flag]" /> Пріоритет</dt>
                  <dd>{{ high: 'Високий', normal: 'Звичайний', low: 'Низький' }[selected.priority]}</dd>
                  <dt><Icon name="icon-[lucide--calendar-days]" /> Дата виконання</dt><dd>{selected.dueDate || 'Не задано'}</dd>
                  <dt><Icon name="icon-[lucide--clock]" /> Витрачено</dt><dd>{formatDuration(selected.spentMinutes)}</dd>
                  {selected.docPath && <><dt>Нотатка</dt><dd>{selected.docPath}</dd></>}
                </dl>
              </section>
              <h3>Залежить від</h3><div className="wm-relations">{selected.blockedBy.length ? selected.blockedBy.map(id => {
                const predecessor = tasks.find(task => task.id === id);
                return <Button key={id} onClick={() => { setView(predecessor?.archived ? 'archive' : 'all'); choose(id); }}>{predecessor?.title || id}</Button>;
              }) : <p>Немає попередників.</p>}</div>
              <h3>Потрібна для</h3><div className="wm-relations">{tasks.filter(task => task.blockedBy.includes(selected.id)).map(task =>
                <Button key={task.id} onClick={() => { setView(task.archived ? 'archive' : 'all'); choose(task.id); }}>{task.title}</Button>)}</div>
              <div className="wm-toolbar"><Button icon="icon-[lucide--pencil]" disabled={busy} onClick={() => setEditing(structuredClone(selected))}>Редагувати задачу</Button>
                <Button icon="icon-[lucide--clock-plus]" disabled={busy || !!draft.pending || editor.timer.read()?.taskId === selected.id} onClick={() => setTimeTaskId(selected.id)}>Додати час</Button>
                {/* Dependencies inform planning but do not prevent tracking actual work. */}
                {!selected.archived && selected.status !== 'done' && (
                  <Button icon="icon-[lucide--play]" disabled={busy || !!draft.pending || editor.timer.active()}
                    onClick={() => void editor.timer.start(selected.id)}>
                    Запустити таймер
                  </Button>
                )}
                <Button icon={selected.archived ? "icon-[lucide--archive-restore]" : "icon-[lucide--archive]"} variant={selected.archived ? 'secondary' : 'danger'} disabled={busy} onClick={() => editor.edit(selected.id, { archived: !selected.archived })}>{selected.archived ? 'Повернути задачу з архіву' : 'Архівувати задачу'}</Button>
              </div>
            </>}
          </section>
        </section>
        <div className="wm-toolbar wm-save-controls">
          <Button icon="icon-[lucide--save]" variant="primary" disabled={busy || !!draft.pending || !draft.dirty} onClick={() => void editor.save()}>Зберегти у Drive</Button>
          <Button icon="icon-[lucide--refresh-cw]" disabled={busy || !draft.pending} onClick={() => void editor.check()}>Перевірити запис</Button>
          {draft.pending?.kind === 'update' && <Button icon="icon-[lucide--save]" disabled={busy} onClick={editor.freshSave}>Підготувати новий Save</Button>}
        </div>
        {timeTask && <TimeDialog title="Додати витрачений час" taskName={timeTask.title} spentMinutes={timeTask.spentMinutes}
          onConfirm={minutes => editor.timer.addManual(timeTask.id, minutes)} onClose={() => setTimeTaskId(undefined)} />}
        {editing && <TaskDialog key={editing.id} task={editing} tasks={tasks} onClose={() => setEditing(undefined)}
          onApply={task => {
            const current = editor.state();
            if (current.expired || current.busy || !current.draft) return false;
            const existing = current.draft.project.tasks.find(item => item.id === task.id);
            // Preserve time accumulated while the dialog was open.
            const spentMinutes = existing?.spentMinutes ?? 0;
            const updated = { ...task, spentMinutes };
            if (existing) editor.edit(task.id, updated);
            else if (!editor.add(updated)) return false;
            choose(task.id);
            return true;
          }} />}
      </>}
    </>}
  </div>;
}

mountPlugin('[data-work-manager]', host => {
  const metadata = JSON.parse(host.dataset.project || '{}') as ProjectMetadata;
  const root = createRoot(host);
  root.render(<WorkManagerApp metadata={metadata} namespace={host.dataset.draftNamespace || ''} />);
  return () => root.unmount();
});
