import { passwordAuthPlugin, PasswordAuthOptions } from './password-auth';
import { workManagerPlugin, WorkManagerOptions } from './work-manager';
import { googleDriveStoragePlugin, GoogleDriveStorageOptions } from './google-drive-storage';
import fs from 'fs';
import path from 'path';
import { KnowledgeBasePlugin } from '../core/plugins';
import { InterviewPrepPluginOptions, interviewPrepPlugin } from './interviewPrepPlugin';
import { TechMemoryPluginOptions, techMemoryPlugin } from './techMemoryPlugin';
import { ThreeDViewerPluginOptions, threeDViewerPlugin } from './threeDViewerPlugin';

export interface PluginSettingsEntry {
  name: string;
  enabled?: boolean;
  options?: Record<string, unknown>;
}

export interface PluginSettingsFile {
  plugins?: PluginSettingsEntry[];
}

export function loadPluginsFromFile(settingsPath: string): KnowledgeBasePlugin[] {
  const absolutePath = path.resolve(settingsPath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const raw = fs.readFileSync(absolutePath, 'utf-8');
  const parsed = JSON.parse(raw) as PluginSettingsFile;
  return resolvePluginsFromSettings(parsed);
}

export function resolvePluginsFromSettings(settings: PluginSettingsFile): KnowledgeBasePlugin[] {
  const plugins: KnowledgeBasePlugin[] = [];
  for (const entry of settings.plugins || []) {
    if (entry.enabled === false) {
      continue;
    }

    const name = normalizePluginName(entry.name);
    if (name === 'work-manager') {
      plugins.push(workManagerPlugin((entry.options || {}) as unknown as WorkManagerOptions));
      continue;
    }
    if (name === 'google-drive-storage') {
      plugins.push(googleDriveStoragePlugin((entry.options || {}) as unknown as GoogleDriveStorageOptions));
      continue;
    }
    if (name === 'password-auth') {
      plugins.push(passwordAuthPlugin((entry.options || {}) as PasswordAuthOptions));
      continue;
    }

    if (name === 'three-d-viewer') {
      plugins.push(threeDViewerPlugin((entry.options || {}) as ThreeDViewerPluginOptions));
      continue;
    }

    if (name === 'interview-prep') {
      plugins.push(interviewPrepPlugin((entry.options || {}) as InterviewPrepPluginOptions));
      continue;
    }

    if (name === 'tech-memory') {
      plugins.push(techMemoryPlugin((entry.options || {}) as TechMemoryPluginOptions));
      continue;
    }

    throw new Error(`Unknown plugin "${entry.name}" in plugin settings.`);
  }

  return plugins;
}

function normalizePluginName(name: string): string {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/plugin$/g, '')
    .replace(/three[d]?viewer/g, 'three-d-viewer')
    .replace(/interviewprep/g, 'interview-prep')
    .replace(/techmemory/g, 'tech-memory')
    .replace(/passwordauth/g, 'password-auth')
    .replace(/googledrivestorage/g, 'google-drive-storage')
    .replace(/workmanager/g, 'work-manager');
}
