import fs from 'fs/promises';
import path from 'path';
import { parseDocument } from 'yaml';
import { StorageError } from '../../core/storage';
import { exactObject, validId, WorkManagerError } from './model';

export interface ProjectMetadata { id: string; title: string; description: string }
export const WORK_MANAGER_SUFFIX = '.work-manager.md';

/** YAML is configuration/data only: no custom tags, aliases, duplicate keys or executable types. */
export function parseProjectMetadata(raw: string): { metadata: ProjectMetadata; body: string } {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match || match[1].length > 32768) throw new WorkManagerError('invalid_project');
  try {
    const document = parseDocument(match[1], { schema: 'failsafe', uniqueKeys: true, stringKeys: true, prettyErrors: false });
    if (document.errors.length || document.warnings.length) throw new Error('Invalid YAML');
    const value = exactObject(document.toJS({ maxAliasCount: 0 }), ['id', 'title', 'description']);
    if (!validId(value.id) || value.id === 'inbox' || typeof value.title !== 'string' ||
      !value.title.trim() || value.title.length > 200 || typeof value.description !== 'string' ||
      value.description.length > 20000) throw new Error('Invalid metadata');
    return { metadata: value as unknown as ProjectMetadata, body: raw.slice(match[0].length) };
  } catch { throw new WorkManagerError('invalid_project'); }
}

/** Resolve IDs from actual authored documents, never from client-provided filesystem paths. */
export class ProjectCatalog {
  constructor(private readonly root: string) {}

  async get(id: string): Promise<ProjectMetadata> {
    if (!validId(id)) throw new WorkManagerError('invalid_request');
    const entries = new Map<string, ProjectMetadata>();
    let count = 0;
    const scan = async (directory: string, depth: number): Promise<void> => {
      if (depth > 32) throw new WorkManagerError('invalid_project');
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        if (++count > 20000) throw new WorkManagerError('too_large');
        if (item.name.startsWith('.') || item.isSymbolicLink()) continue;
        const file = path.join(directory, item.name);
        if (item.isDirectory()) await scan(file, depth + 1);
        else if (item.isFile() && item.name.endsWith(WORK_MANAGER_SUFFIX)) {
          if ((await fs.stat(file)).size > 1024 * 1024) throw new WorkManagerError('too_large');
          const { metadata } = parseProjectMetadata(await fs.readFile(file, 'utf8'));
          if (entries.has(metadata.id)) throw new StorageError('conflict');
          entries.set(metadata.id, metadata);
        }
      }
    };
    await scan(this.root, 0);
    const metadata = entries.get(id);
    if (!metadata) throw new StorageError('not_found');
    return metadata;
  }
}
