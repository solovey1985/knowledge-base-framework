import { useEffect, useRef, useState } from 'react';
import { Button, Field } from '../../shared/controls';
import { formatDuration, manualMinutes, MAX_SPENT_MINUTES } from '../../../src/plugins/work-manager/duration';

interface TimeDialogProps {
  title: string;
  taskName: string;
  spentMinutes: number;
  initialMinutes?: number;
  onConfirm: (minutes: number) => Promise<boolean>;
  onClose: () => void;
}

export function TimeDialog({ title, taskName, spentMinutes, initialMinutes = 0, onConfirm, onClose }: TimeDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [parts, setParts] = useState({
    days: String(Math.floor(initialMinutes / 1440) || ''),
    hours: String(Math.floor(initialMinutes % 1440 / 60) || ''),
    minutes: String(initialMinutes % 60 || ''),
  });
  const amount = manualMinutes(parts.days, parts.hours, parts.minutes);
  const total = spentMinutes + amount;
  const valid = Number.isSafeInteger(total) && total <= MAX_SPENT_MINUTES;

  useEffect(() => {
    const host = dialog.current!;
    host.showModal();
    return () => host.close();
  }, []);

  async function submit() {
    if (!valid || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      if (await onConfirm(amount)) onClose();
      else setError('Не вдалося додати час. Перевірте стан таймера й актуальність чернетки.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className="wm-dialog" aria-labelledby="wm-time-heading"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h2 id="wm-time-heading">{title}</h2>
      <p className="mb-4 font-medium">{taskName}</p>
      <div className="grid grid-cols-3 gap-3">
        {([['days', 'Дні'], ['hours', 'Години'], ['minutes', 'Хвилини']] as const).map(([key, label]) =>
          <Field key={key} label={label}>
            <input type="number" min="0" step="1" placeholder="0" value={parts[key]}
              onChange={event => setParts(previous => ({ ...previous, [key]: event.target.value }))} />
          </Field>)}
      </div>
      <p aria-live="polite">{valid ? `Разом із раніше витраченим: ${formatDuration(total)}` : 'Перевірте тривалість.'}</p>
      {error && <p role="alert">{error}</p>}
      <div className="wm-toolbar">
        <Button icon="icon-[lucide--check]" type="submit" variant="primary" loading={busy} disabled={!valid}>Додати до чернетки</Button>
        <Button icon="icon-[lucide--x]" disabled={busy} onClick={onClose}>Скасувати</Button>
      </div>
    </form>
  </dialog>;
}
