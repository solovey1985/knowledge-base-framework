import type { WorkTask } from '../../../src/plugins/work-manager/model';
import { Field } from '../../shared/controls';

export const taskStatusLabels: Record<WorkTask['status'], string> = {
  todo: 'Очікує',
  in_progress: 'У процесі',
  done: 'Зроблено',
};

/** Dependencies describe readiness; they never restrict the user's status choice. */
export function TaskStatus({ value, disabled, onChange }: {
  value: WorkTask['status'];
  disabled?: boolean;
  onChange: (status: WorkTask['status']) => void;
}) {
  return (
    <Field label="Статус задачі">
      <select value={value} disabled={disabled}
        onChange={event => onChange(event.target.value as WorkTask['status'])}>
        {Object.entries(taskStatusLabels).map(([status, label]) => (
          <option key={status} value={status}>{label}</option>
        ))}
      </select>
    </Field>
  );
}
