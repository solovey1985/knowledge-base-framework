import { MAX_SPENT_MINUTES } from './duration';
import { JsonValue } from '../../core/storage';

export class WorkManagerError extends Error {
  constructor(public readonly code: 'invalid_request' | 'invalid_project' | 'unsupported_version' | 'too_large') {
    super(code);
  }
}

export interface WorkTask {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'high' | 'normal' | 'low';
  dueDate: string | null;
  blockedBy: string[];
  doneWhen: string;
  docPath: string | null;
  spentMinutes: number;
  /** Missing means active, for documents written before task archives were introduced. */
  archived?: boolean;
}

export interface WorkProject {
  schemaVersion: 1;
  id: string;
  type: 'project' | 'inbox';
  title: string;
  notes: string;
  tasks: WorkTask[];
}

export const MAX_PROJECT_BYTES = 256 * 1024;
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const invalid = (): never => { throw new WorkManagerError('invalid_project'); };

export function validId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

/** Exact keys keep transport metadata and arbitrary Drive parameters out of documents. */
export function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, limit: number, required = false): value is string {
  return typeof value === 'string' && value.length <= limit &&
    (!required || value.trim().length > 0) &&
    [...value].every(char => char.charCodeAt(0) >= 32 || ['\t', '\n', '\r'].includes(char));
}

function dateOnly(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validDocPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 && value.endsWith('.md') &&
    !/[\\:%?#]/.test(value) && [...value].every(char => char.charCodeAt(0) >= 32) &&
    value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !part.startsWith('.'));
}

/** Plain data only. Text is never interpreted as HTML/Markdown by this API. */
export function validateProject(value: unknown): WorkProject {
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion !== 1) {
    throw new WorkManagerError('unsupported_version');
  }
  const project = exactObject(value, ['schemaVersion', 'id', 'type', 'title', 'notes', 'tasks']);
  if (project.schemaVersion !== 1 || !validId(project.id) ||
    !['project', 'inbox'].includes(project.type as string) ||
    (project.type === 'inbox') !== (project.id === 'inbox') ||
    !text(project.title, 200, true) || !text(project.notes, 20000) ||
    !Array.isArray(project.tasks) || project.tasks.length > 500) invalid();
  const tasks = project.tasks as unknown[];
  const graph = new Map<string, string[]>();
  for (const raw of tasks) {
    const hasArchive = !!raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'archived');
    const task = exactObject(raw, ['id', 'title', 'status', 'priority', 'dueDate', 'blockedBy', 'doneWhen', 'docPath', 'spentMinutes', ...(hasArchive ? ['archived'] : [])]);
    if (hasArchive && typeof task.archived !== 'boolean') invalid();
    if (!validId(task.id) || graph.has(task.id) || !text(task.title, 200, true) ||
      !['todo', 'in_progress', 'done'].includes(task.status as string) ||
      !['high', 'normal', 'low'].includes(task.priority as string) || !dateOnly(task.dueDate) ||
      !text(task.doneWhen, 4000) || (task.docPath !== null && !validDocPath(task.docPath)) ||
      !Number.isSafeInteger(task.spentMinutes) || (task.spentMinutes as number) < 0 ||
      (task.spentMinutes as number) > MAX_SPENT_MINUTES || !Array.isArray(task.blockedBy) ||
      task.blockedBy.length > 500 || task.blockedBy.some(id => !validId(id)) ||
      new Set(task.blockedBy).size !== task.blockedBy.length) invalid();
    graph.set(task.id as string, task.blockedBy as string[]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (!graph.has(id) || visiting.has(id)) invalid();
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id)!) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) visit(id);
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_PROJECT_BYTES) throw new WorkManagerError('too_large');
  return value as WorkProject;
}

export function projectJson(project: WorkProject): JsonValue {
  // A snapshot prevents callers changing the payload across asynchronous validation/storage calls.
  return JSON.parse(JSON.stringify(project)) as JsonValue;
}
