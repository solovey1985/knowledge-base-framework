import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountPlugin } from '../../core/mount';
import { ApiError, createHttpClient } from '../../core/httpClient';
import { Button, Icon } from '../../shared/controls';
import { formatDuration } from '../../../src/plugins/work-manager/duration';
import type { WorkTask } from '../../../src/plugins/work-manager/model';

type OverviewTask = Pick<WorkTask, 'id' | 'title' | 'status' | 'priority' | 'dueDate' | 'spentMinutes'> & {
  readiness: 'ready' | 'blocked' | 'done';
};
interface OverviewProject {
  id: string; title: string; path: string;
  state: 'ready' | 'empty' | 'archived' | 'invalid';
  progress: { done: number; total: number; percent: number | null };
  tasks: OverviewTask[];
}
type Row = OverviewTask & { project: OverviewProject };

const PRIORITY = { high: 0, normal: 1, low: 2 };
const PRIORITY_LABEL = { high: 'Високий', normal: 'Звичайний', low: 'Низький' };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const byUrgency = (a: Row, b: Row) => PRIORITY[a.priority] - PRIORITY[b.priority] ||
  compare(a.dueDate || '9999-99-99', b.dueDate || '9999-99-99') || compare(a.project.title, b.project.title) || compare(a.id, b.id);
const projectHref = (project: OverviewProject) => '/' + project.path.split('/').map(encodeURIComponent).join('/');
/** The user's calendar day, not UTC: a task due today is not overdue in the evening. */
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function TaskList({ title, icon, rows, empty, today }: { title: string; icon: string; rows: Row[]; empty: string; today: string }) {
  return <section className="mt-8">
    <h2 className="flex items-center gap-2 text-xl font-semibold"><Icon name={icon} />{title}
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-sm font-normal text-slate-600">{rows.length}</span></h2>
    {rows.length === 0 ? <p className="mt-2 text-sm text-slate-500">{empty}</p> :
      <div role="list" className="mt-3 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
        {rows.map(row => <div role="listitem" key={`${row.project.id}/${row.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <span className={`w-24 shrink-0 text-xs font-medium ${row.priority === 'high' ? 'text-red-700' : 'text-slate-500'}`}>
            {PRIORITY_LABEL[row.priority]}</span>
          <span className="min-w-0 flex-1 font-medium text-slate-900">{row.title || 'Без назви'}</span>
          <a className="text-sm text-sky-700 hover:underline" href={projectHref(row.project)}>{row.project.title}</a>
          <span className={`w-28 shrink-0 text-right text-sm ${row.dueDate && row.dueDate < today ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
            {row.dueDate || 'без дати'}</span>
          <span className="w-20 shrink-0 text-right text-sm text-slate-500">{formatDuration(row.spentMinutes)}</span>
        </div>)}
      </div>}
  </section>;
}

function WorkOverview() {
  const [http] = useState(createHttpClient);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'expired' | 'error'; projects: OverviewProject[] }>(
    { status: 'loading', projects: [] });
  const load = useCallback(() => {
    setState(previous => ({ ...previous, status: 'loading' }));
    http.request<{ projects: OverviewProject[] }>('/api/work-manager/overview').then(
      result => setState({ status: 'ready', projects: result.projects }),
      error => setState(previous => ({ ...previous,
        status: error instanceof ApiError && error.status === 401 ? 'expired' : 'error' })));
  }, [http]);
  useEffect(() => { load(); return () => http.dispose(); }, [http, load]);

  const today = localToday();
  const projects = state.projects.filter(project => project.state !== 'archived');
  const rows: Row[] = projects.flatMap(project => project.tasks.map(task => ({ ...task, project })));
  const overdue = rows.filter(row => row.dueDate !== null && row.dueDate < today)
    .sort((a, b) => compare(a.dueDate!, b.dueDate!) || byUrgency(a, b));
  const current = rows.filter(row => !overdue.includes(row));
  const inProgress = current.filter(row => row.status === 'in_progress').sort(byUrgency);
  const available = current.filter(row => row.status === 'todo' && row.readiness === 'ready').sort(byUrgency);
  const blocked = current.filter(row => row.status === 'todo' && row.readiness === 'blocked').length;

  return <div className="wm-overview">
    <div className="flex flex-wrap items-center gap-3">
      <Button icon="icon-[lucide--refresh-cw]" loading={state.status === 'loading'} onClick={load}>Оновити</Button>
      {state.status === 'expired' && <p role="alert" className="text-sm text-red-700">Сесія завершилась. <a className="underline" href="/login">Увійдіть знову</a>.</p>}
      {state.status === 'error' && <p role="alert" className="text-sm text-red-700">Не вдалося завантажити задачі. Сховище тимчасово недоступне.</p>}
      {state.status === 'ready' && <p className="text-sm text-slate-500">Відкритих задач: {rows.length} · заблокованих: {blocked}</p>}
    </div>

    {state.status !== 'loading' || state.projects.length > 0 ? <>
      <TaskList title="Прострочені" icon="icon-[lucide--triangle-alert]" rows={overdue} today={today} empty="Прострочених задач немає." />
      <TaskList title="В роботі" icon="icon-[lucide--play]" rows={inProgress} today={today} empty="Жодна задача не в роботі." />
      <TaskList title="Доступні зараз" icon="icon-[lucide--calendar-days]" rows={available} today={today} empty="Немає задач, готових до початку." />

      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-xl font-semibold"><Icon name="icon-[lucide--folder-kanban]" />Проєкти</h2>
        <div role="list" className="mt-3 grid gap-3 sm:grid-cols-2">
          {projects.map(project => <div role="listitem" key={project.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <a className="font-medium text-sky-700 hover:underline" href={projectHref(project)}>{project.title}</a>
            {project.state === 'empty' && <p className="mt-1 text-sm text-slate-500">Ще не збережено у сховищі.</p>}
            {project.state === 'invalid' && <p role="alert" className="mt-1 text-sm text-red-700">Дані проєкту пошкоджені; відкрийте проєкт для відновлення.</p>}
            {project.state === 'ready' && <>
              <p className="mt-1 text-sm text-slate-500">
                {project.progress.percent === null ? 'Задач немає' : `Виконано ${project.progress.done} з ${project.progress.total} (${project.progress.percent}%)`}
                {' · '}відкритих: {project.tasks.length}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`Прогрес: ${project.title}`}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progress.percent ?? 0}>
                <div className="h-full bg-sky-600" style={{ width: `${project.progress.percent ?? 0}%` }} /></div>
            </>}
          </div>)}
        </div>
        {state.status === 'ready' && projects.length === 0 && <p className="mt-2 text-sm text-slate-500">Проєктів ще немає. Створіть документ <code>*.work-manager.md</code>.</p>}
      </section>
    </> : null}
  </div>;
}

mountPlugin('[data-work-overview]', host => {
  const root = createRoot(host);
  root.render(<WorkOverview />);
  return () => root.unmount();
});
