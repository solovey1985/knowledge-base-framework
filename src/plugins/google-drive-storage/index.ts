import { KnowledgeBasePlugin } from '../../core/plugins';
import { GoogleDriveStorageOptions, resolveDriveConfig } from './config';
import { GoogleDriveStorageProvider } from './provider';

export function googleDriveStoragePlugin(options: GoogleDriveStorageOptions): KnowledgeBasePlugin {
  const provider = new GoogleDriveStorageProvider(resolveDriveConfig(options));
  // No public routes, credentials, or browser assets; applications use the server registry.
  return { id: `google-drive-storage:${provider.id}`, storageProviders: [provider] };
}

export type { GoogleDriveStorageOptions } from './config';
