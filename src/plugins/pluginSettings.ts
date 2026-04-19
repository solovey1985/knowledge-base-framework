import fs from 'fs';
import path from 'path';
import { KnowledgeBasePlugin } from '../core/plugins';
import { InterviewPrepPluginOptions, interviewPrepPlugin } from './interviewPrepPlugin';
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
    if (name === 'three-d-viewer') {
      plugins.push(threeDViewerPlugin((entry.options || {}) as ThreeDViewerPluginOptions));
      continue;
    }

    if (name === 'interview-prep') {
      plugins.push(interviewPrepPlugin((entry.options || {}) as InterviewPrepPluginOptions));
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
    .replace(/interviewprep/g, 'interview-prep');
}
