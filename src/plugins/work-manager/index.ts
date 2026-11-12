import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { KnowledgeBasePlugin } from '../../core/plugins';
import { StorageError } from '../../core/storage';
import { exactObject, WorkManagerError } from './model';
import { WorkManagerService } from './service';
import { parseProjectMetadata, ProjectCatalog, WORK_MANAGER_SUFFIX } from './content-metadata';
import { validateProject } from './model';

export interface WorkManagerOptions {
  storageProviderId: string;
  /** Change when reassigning the provider to another workspace. */
  draftNamespace?: string;
}

const storageStatus: Record<StorageError['code'], number> = {
  invalid_input: 400, invalid_ticket: 400, not_found: 404, conflict: 409,
  access_denied: 503, reconnect_required: 503, quota_exceeded: 503,
  rate_limited: 429, unavailable: 503, unknown_result: 503,
  invalid_document: 422, unsupported_version: 422, too_large: 413,
};

/** Fixed API only: no raw uploads, file IDs, paths to write, or client-selected provider. */
export function workManagerPlugin(options: WorkManagerOptions): KnowledgeBasePlugin {
  if (!options || Object.keys(options).some(key => !['storageProviderId', 'draftNamespace'].includes(key)) ||
    typeof options.storageProviderId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(options.storageProviderId)) {
    throw new Error('Invalid Work Manager configuration.');
  }
  const providerId = options.storageProviderId;
  const draftNamespace = options.draftNamespace ?? providerId;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(draftNamespace)) throw new Error('Invalid Work Manager page configuration.');
  return {
    id: 'work-manager',
    clientEntry: { file: 'kb-plugin-work-manager.js', cssFile: 'kb-icons-work-manager.css', marker: 'data-work-manager' }, requiresAuthentication: true,
    contentRenderers: [{
      id: 'work-manager-page',
      matches: requestPath => requestPath.endsWith(WORK_MANAGER_SUFFIX),
      async render(context) {
        const { metadata, body } = parseProjectMetadata(await context.readFile(context.requestPath));
        const payload = JSON.stringify(metadata).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const introduction = await context.renderMarkdown(body, context.requestPath);
        return context.composeContentResponse(context.requestPath, metadata.title,
          `${introduction.html}<div data-work-manager data-project="${payload}" data-draft-namespace="${draftNamespace}"></div>`,
          metadata.description, { isWorkManager: true });
      },
      renderDirectoryItem({ friendlyHref }) {
        return { href: friendlyHref, meta: 'Проєкти та задачі' };
      },
    }],
    setupServer(app, context) {
      const catalog = new ProjectCatalog(context.contentRootPath);
      const boundProject = async (value: unknown) => {
        const project = validateProject(value);
        const metadata = await catalog.get(project.id);
        if (project.type !== 'project' || project.title !== metadata.title || project.notes !== metadata.description) {
          throw new WorkManagerError('invalid_project');
        }
        return project;
      };
      const service = new WorkManagerService(context.storage.get(providerId), async note => {
        try {
          const root = await fs.realpath(context.contentRootPath);
          const target = await fs.realpath(path.join(root, note));
          const relative = path.relative(root, target);
          return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) && (await fs.stat(target)).isFile();
        } catch { return false; }
      });
      const router = express.Router({ caseSensitive: true, strict: true });
      router.param('id', (_req, _res, next, id) => { void catalog.get(id).then(() => next(), next); });
      let active = 0;
      router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'private, no-store');
        // Defense in depth for hosts that call setupServer directly instead of KnowledgeBase.
        if (!res.locals.authentication) {
          res.status(401).json({ error: { message: 'Не вдалося виконати запит.' } });
          return;
        }
        if (active >= 4) {
          res.setHeader('Retry-After', '1');
          res.status(429).json({ error: { code: 'busy' } });
          return;
        }
        if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) {
          next(new WorkManagerError('invalid_request'));
          return;
        }
        next();
      });
      router.use(express.json({ limit: '300kb', strict: true, inflate: false }));
      const body = (req: Request, keys: string[]) => {
        try { return exactObject(req.body, keys); }
        catch { throw new WorkManagerError('invalid_request'); }
      };
      const ticket = (value: unknown): string => {
        if (typeof value !== 'string' || value.length < 1 || value.length > 8192) throw new WorkManagerError('invalid_request');
        return value;
      };
      const route = (action: (req: Request) => Promise<unknown>, status = 200, query = false) =>
        async (req: Request, res: Response, next: NextFunction) => {
          if (active >= 4) { res.status(429).json({ error: { code: 'busy' } }); return; }
          active++;
          try {
            if (!query && Object.keys(req.query).length) throw new WorkManagerError('invalid_request');
            res.status(status).json(await action(req));
          } catch (error) { next(error); }
          finally { active--; }
        };
      router.get('/projects', route(async req => {
        if (Object.keys(req.query).some(key => !['cursor', 'archived'].includes(key)) ||
          (req.query.archived !== undefined && !['true', 'false'].includes(req.query.archived as string)) ||
          (req.query.cursor !== undefined && (typeof req.query.cursor !== 'string' || req.query.cursor.length > 8192))) {
          throw new WorkManagerError('invalid_request');
        }
        return service.list({ cursor: req.query.cursor as string | undefined, archived: req.query.archived === 'true' });
      }, 200, true));
      router.post('/projects/prepare', route(async req => {
        const b = body(req, ['operationId', 'project']);
        return service.prepare(b.operationId as string, await boundProject(b.project));
      }));
      router.post('/projects', route(async req => {
        const b = body(req, ['ticket', 'project']);
        return service.create(ticket(b.ticket), await boundProject(b.project));
      }, 201));
      router.get('/projects/:id', route(req => service.read(req.params.id)));
      router.put('/projects/:id', route(async req => {
        const b = body(req, ['operationId', 'project']);
        if (validateProject(b.project).id !== req.params.id) throw new WorkManagerError('invalid_project');
        return service.update(req.params.id, b.operationId as string, await boundProject(b.project));
      }));
      for (const action of ['archive', 'unarchive']) {
        router.post(`/projects/:id/${action}`, route(req => {
          const b = body(req, ['operationId']);
          return service.archive(req.params.id, b.operationId as string, action === 'unarchive');
        }));
      }
      router.get('/projects/:id/backups', route(req => service.backups(req.params.id)));
      router.post('/projects/:id/restore-backup', route(req => {
        const b = body(req, ['operationId', 'ticket']);
        return service.restoreBackup(req.params.id, b.operationId as string, ticket(b.ticket));
      }));
      router.post('/projects/:id/reconcile', route(req => {
        const b = body(req, ['operationId', 'project', 'archived']);
        if (typeof b.archived !== 'boolean') throw new WorkManagerError('invalid_request');
        return service.reconcile(req.params.id, b.operationId as string, b.project, b.archived);
      }));
      router.use((_req, res) => { res.status(404).json({ error: { code: 'not_found' } }); });
      router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        let status = 503;
        let code = 'storage_unavailable';
        if (error instanceof WorkManagerError) {
          code = error.code;
          status = code === 'invalid_request' ? 400 : code === 'too_large' ? 413 : 422;
        } else if (error instanceof StorageError) {
          status = storageStatus[error.code];
          // Credentials and provider permission details remain operator-only.
          code = ['access_denied', 'reconnect_required', 'quota_exceeded', 'unavailable'].includes(error.code) ?
            'storage_unavailable' : error.code;
        } else if (error && typeof error === 'object' && 'type' in error) {
          status = error.type === 'entity.too.large' ? 413 : 400;
          code = status === 413 ? 'too_large' : 'invalid_request';
        }
        res.status(status).json({ error: { code } });
      });
      app.use('/api/work-manager', router);
    },
  };
}
