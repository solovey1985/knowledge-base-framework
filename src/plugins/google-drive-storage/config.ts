export interface GoogleDriveStorageOptions {
  providerId: string;
  workspaceId: string;
  rootFolderId?: string;
  rootFolderName?: string;
  ticketSecretEnv?: string;
  maxDocumentBytes?: number;
  backupKeep?: number;
  auth?: { type: 'oauth'; clientIdEnv?: string; clientSecretEnv?: string; refreshTokenEnv?: string };
}

export interface DriveConfig {
  providerId: string;
  workspaceId: string;
  rootFolderId?: string;
  rootFolderName: string;
  maxDocumentBytes: number;
  backupKeep: number;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  ticketSecret: Buffer;
}

export function resolveDriveConfig(options: GoogleDriveStorageOptions): DriveConfig {
  const invalid = () => { throw new Error('googleDriveStorage: invalid configuration'); };
  const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
  if (!options || !identifier(options.providerId) || !identifier(options.workspaceId)) return invalid();
  if (options.auth && options.auth.type !== 'oauth') return invalid();
  if (options.rootFolderId !== undefined && !identifier(options.rootFolderId)) return invalid();
  const rootFolderName = options.rootFolderName ?? 'Knowledge Base Work Manager';
  if (typeof rootFolderName !== 'string' || !rootFolderName.trim() || rootFolderName.length > 100) return invalid();
  const maxDocumentBytes = options.maxDocumentBytes ?? 1_048_576;
  if (!Number.isInteger(maxDocumentBytes) || maxDocumentBytes < 1024 || maxDocumentBytes > 4_194_304) return invalid();
  const backupKeep = options.backupKeep ?? 10;
  if (!Number.isInteger(backupKeep) || backupKeep < 1 || backupKeep > 100) return invalid();
  const env = (name: string): string => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || !process.env[name]?.trim()) return invalid();
    return process.env[name]!;
  };
  const secret = env(options.ticketSecretEnv ?? 'GOOGLE_DRIVE_TICKET_SECRET');
  const ticketSecret = Buffer.from(secret, 'base64url');
  if (ticketSecret.length !== 32 || ticketSecret.toString('base64url') !== secret) return invalid();
  return {
    providerId: options.providerId, workspaceId: options.workspaceId,
    rootFolderId: options.rootFolderId, rootFolderName, maxDocumentBytes, backupKeep, ticketSecret,
    clientId: env(options.auth?.clientIdEnv ?? 'GOOGLE_DRIVE_CLIENT_ID'),
    clientSecret: env(options.auth?.clientSecretEnv ?? 'GOOGLE_DRIVE_CLIENT_SECRET'),
    refreshToken: env(options.auth?.refreshTokenEnv ?? 'GOOGLE_DRIVE_REFRESH_TOKEN'),
  };
}
