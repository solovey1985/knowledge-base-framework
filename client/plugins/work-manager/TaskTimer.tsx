import { useEffect, useState } from 'react';
import type { createEditor } from './editor';
import { Button } from '../../shared/controls';
import { TimeDialog } from './TimeDialog';

export function TaskTimer({ editor, busy }: { editor: ReturnType<typeof createEditor>; busy: boolean }) {
  const timer = editor.timer.read();
  const [now, setNow] = useState(Date.now);
  const [reviewId, setReviewId] = useState('');
  const running = timer !== undefined && timer.stoppedAt === undefined;

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [timer?.id, running]);

  if (!timer) return null;
  const project = editor.state().draft?.project;
  const task = project?.id === timer.projectId ? project.tasks.find(item => item.id === timer.taskId) : undefined;
  const seconds = Math.max(0, Math.floor(((timer.stoppedAt ?? now) - timer.startedAt) / 1000));
  const days = Math.floor(seconds / 86400);
  const clock = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
    .map(part => String(part).padStart(2, '0')).join(':');

  return <section aria-label="Таймер задачі" className="my-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
    <div>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span aria-hidden="true" className={running ? 'size-2 rounded-full bg-blue-600' : 'size-2 rounded-full bg-amber-500'} />
        {running ? 'Таймер працює' : 'Інтервал зупинено'}
      </div>
      <strong>{task?.title || `Проєкт ${timer.projectId}`}</strong>
    </div>
    <output role="timer" aria-live="off" className="font-mono text-3xl font-semibold tabular-nums">
      {days > 0 && `${days} дн `}{clock}
    </output>
    <div className="flex flex-wrap gap-2">
      {running ? <Button icon="icon-[lucide--square]" disabled={busy} onClick={() => void editor.timer.stop()}>Зупинити</Button> : <>
        <Button icon="icon-[lucide--check]" variant="primary" disabled={busy || !task} onClick={() => setReviewId(timer.id)}>Підтвердити час</Button>
        <Button icon="icon-[lucide--trash-2]" variant="danger" disabled={busy} onClick={() => void editor.timer.discard(timer.id)}>Відкинути інтервал</Button>
      </>}
    </div>
    {!running && reviewId === timer.id && task && <TimeDialog title="Підтвердити час таймера" taskName={task.title}
      spentMinutes={task.spentMinutes} initialMinutes={editor.timer.suggestedMinutes(timer)}
      onConfirm={minutes => editor.timer.apply(timer.id, minutes)} onClose={() => setReviewId('')} />}
  </section>;
}
