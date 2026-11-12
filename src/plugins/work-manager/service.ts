import { StorageDocument, StorageProvider } from '../../core/storage';
import { projectJson, validateProject, validId, WorkManagerError, WorkProject } from './model';

export class WorkManagerService {
  constructor(private readonly storage: StorageProvider,
    private readonly noteExists: (path: string) => Promise<boolean>) {}

  private key(id: string): string {
    if (!validId(id)) throw new WorkManagerError('invalid_request');
    return `wm-${id}`;
  }

  private operation(id: string): void {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new WorkManagerError('invalid_request');
  }

  private async input(value: unknown, id?: string): Promise<WorkProject> {
    const project = validateProject(value);
    if (id !== undefined && project.id !== id) throw new WorkManagerError('invalid_project');
    const snapshot = validateProject(projectJson(project));
    for (const note of new Set(snapshot.tasks.map(task => task.docPath).filter((p): p is string => p !== null))) {
      if (!await this.noteExists(note)) throw new WorkManagerError('invalid_project');
    }
    return snapshot;
  }

  private output(document: StorageDocument) {
    const project = validateProject(document.content);
    if (document.key !== this.key(project.id)) throw new WorkManagerError('invalid_project');
    return { project, revision: document.revision, operationId: document.operationId,
      archived: document.archived, ...(document.warnings ? { warnings: document.warnings } : {}) };
  }

  async list(options: { cursor?: string; archived?: boolean }) {
    const page = await this.storage.list(options);
    return { items: page.items.map(document => {
      const { project, revision, archived } = this.output(document);
      return { id: project.id, type: project.type, title: project.title, revision, archived };
    }), ...(page.cursor ? { cursor: page.cursor } : {}) };
  }

  async read(id: string) { return this.output(await this.storage.read(this.key(id))); }

  async prepare(operationId: string, value: unknown) {
    this.operation(operationId);
    const project = await this.input(value);
    return { ticket: await this.storage.prepareCreate(this.key(project.id), operationId, projectJson(project)) };
  }

  async create(ticket: string, value: unknown) {
    const project = await this.input(value);
    return this.output(await this.storage.create(ticket, projectJson(project)));
  }

  async update(id: string, operationId: string, value: unknown) {
    this.operation(operationId);
    const project = await this.input(value, id);
    // Reject future/corrupt business schemas before replacing a structurally valid storage envelope.
    const current = await this.read(id);
    const remaining = new Set(project.tasks.map(task => task.id));
    for (const task of current.project.tasks) {
      if (remaining.has(task.id) && task.blockedBy.some(dependency => !remaining.has(dependency))) {
        throw new WorkManagerError('invalid_project');
      }
    }
    return this.output(await this.storage.update(this.key(id), operationId, projectJson(project)));
  }

  async archive(id: string, operationId: string, restore = false) {
    this.operation(operationId);
    await this.read(id);
    const document = restore ? await this.storage.restore(this.key(id), operationId) :
      await this.storage.archive(this.key(id), operationId);
    return this.output(document);
  }

  async backups(id: string) { return { items: await this.storage.listBackups(this.key(id)) }; }

  async restoreBackup(id: string, operationId: string, ticket: string) {
    this.operation(operationId);
    // A damaged current document can be recovered, but a future business version must be preserved.
    try { await this.read(id); }
    catch (error) {
      if (!(error instanceof WorkManagerError && error.code === 'invalid_project') &&
        !(error instanceof Error && 'code' in error && ['invalid_document', 'too_large'].includes(String(error.code)))) throw error;
    }
    return this.output(await this.storage.restoreBackup(this.key(id), ticket, operationId,
      async content => { await this.input(content, id); }));
  }

  async reconcile(id: string, operationId: string, value: unknown, archived: boolean) {
    this.operation(operationId);
    const project = validateProject(value);
    if (project.id !== id) throw new WorkManagerError('invalid_project');
    return this.output(await this.storage.reconcile(this.key(id), operationId, projectJson(project), archived));
  }
}
