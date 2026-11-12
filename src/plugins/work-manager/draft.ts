import { WorkProject, validateProject } from './model';

export interface PendingSave {
  kind: 'create' | 'update';
  operationId: string;
  project: WorkProject;
  ticket?: string;
}

export interface ProjectDraft {
  version: 1;
  project: WorkProject;
  created: boolean;
  dirty: boolean;
  pending?: PendingSave;
  revision?: string;
  lastTimerId?: string;
}

/** Parse untrusted browser storage without rendering HTML or automatically replaying requests. */
export function parseDraft(raw: string): ProjectDraft {
  if (raw.length > 1024 * 1024) throw new Error('Draft too large');
  const draft = JSON.parse(raw) as ProjectDraft;
  if (draft.version !== 1 || typeof draft.created !== 'boolean' || typeof draft.dirty !== 'boolean') {
    throw new Error('Invalid draft');
  }
  if (draft.lastTimerId !== undefined && !/^[a-zA-Z0-9_-]{1,64}$/.test(draft.lastTimerId)) throw new Error('Invalid timer receipt');
  // Drafts may have empty titles while editing. Validate their structure with placeholders.
  const structural = structuredClone(draft.project);
  if (typeof structural.title !== 'string' || typeof structural.notes !== 'string') throw new Error('Invalid draft');
  structural.title = structural.title.slice(0, 200) || 'Draft';
  structural.notes = structural.notes.slice(0, 20000);
  for (const task of structural.tasks) {
    if (typeof task.title !== 'string' || typeof task.doneWhen !== 'string' ||
      (task.docPath !== null && typeof task.docPath !== 'string') ||
      (task.dueDate !== null && typeof task.dueDate !== 'string')) throw new Error('Invalid draft');
    task.title = task.title.slice(0, 200) || 'Draft';
    task.doneWhen = task.doneWhen.slice(0, 4000);
    // Incomplete path/date edits are recoverable drafts, not valid server payloads yet.
    task.docPath = null;
    task.dueDate = null;
  }
  validateProject(structural);
  if (draft.pending) {
    validateProject(draft.pending.project);
    if (draft.pending.project.id !== draft.project.id ||
      !['create', 'update'].includes(draft.pending.kind) ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(draft.pending.operationId) ||
      (draft.pending.ticket !== undefined && (typeof draft.pending.ticket !== 'string' || draft.pending.ticket.length > 8192))) {
      throw new Error('Invalid pending operation');
    }
  }
  return draft;
}

/** An old response confirms only its own snapshot; newer edits stay dirty. */
export function confirmDraft(draft: ProjectDraft, saved: WorkProject, revision: string): void {
  draft.created = true;
  draft.revision = revision;
  draft.dirty = stableJson(draft.project) !== stableJson(saved);
  delete draft.pending;
}

// Drive canonicalizes object keys; array order remains meaningful for tasks/dependencies.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
