import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { KnowledgeBaseOptions } from '../core/interfaces';

const CONFIG_CANDIDATES = ['kb.config.json', 'knowledge-base.config.json', 'config.json'];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export async function loadConfigFile(providedPath?: string): Promise<{ path: string; config: KnowledgeBaseOptions }> {
  const configPath = providedPath || findConfigFile();
  if (!configPath) {
    throw new ConfigError('No configuration file found. Create kb.config.json or run "kb init".');
  }

  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (error) {
    throw new ConfigError(`Cannot read configuration file at ${configPath}`);
  }

  let parsed: KnowledgeBaseOptions;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(`Invalid JSON in ${configPath}: ${(error as Error).message}`);
  }

  if (!parsed.contentRootPath || typeof parsed.contentRootPath !== 'string') {
    throw new ConfigError('Configuration must include a "contentRootPath" string.');
  }

  const absoluteContentPath = path.resolve(path.dirname(configPath), parsed.contentRootPath);
  try {
    await fs.access(absoluteContentPath);
  } catch (error) {
    throw new ConfigError(`Content directory does not exist: ${absoluteContentPath}`);
  }

  return { path: configPath, config: parsed };
}

export function findConfigFile(): string | null {
  for (const candidate of CONFIG_CANDIDATES) {
    const fullPath = path.resolve(candidate);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}
