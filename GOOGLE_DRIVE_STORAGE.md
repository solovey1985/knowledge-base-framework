# Google Drive storage plugin

Server-only optional storage for a personal Google Drive. STO-02/03 implement the provider, verified backups, retention and backup restore.
Work Manager HTTP/UI and production acceptance are separate work.
The plugin adds no public routes, browser assets, or Google sign-in to the website.

## Configuration

Add to the existing plugins array. Disabled entries do not require credentials.

```json
{
  "name": "googleDriveStorage",
  "enabled": true,
  "options": {
    "providerId": "second-brain-drive",
    "workspaceId": "second-brain",
    "rootFolderName": "Second Brain Work Manager",
    "maxDocumentBytes": 1048576,
    "backupKeep": 10,
    "ticketSecretEnv": "GOOGLE_DRIVE_TICKET_SECRET",
    "auth": {
      "type": "oauth",
      "clientIdEnv": "GOOGLE_DRIVE_CLIENT_ID",
      "clientSecretEnv": "GOOGLE_DRIVE_CLIENT_SECRET",
      "refreshTokenEnv": "GOOGLE_DRIVE_REFRESH_TOKEN"
    }
  }
}
```

Set credentials only in server secrets. `GOOGLE_DRIVE_TICKET_SECRET` is a persistent, independently
generated random 32-byte key encoded as canonical base64url. Keep it stable across restarts; rotating
it invalidates pending create tickets/cursors. It is independent of the password-auth signing key.
Each application must use a unique `workspaceId`; registry provider IDs are local to a KnowledgeBase instance.

`rootFolderId` is optional. First initialization discovers a folder with this workspace/provider marker,
or creates one; pin its ID in configuration after operator setup. A supplied ID must refer to an accessible,
non-trashed personal-Drive folder carrying the matching application marker. Failure never creates a replacement.
Folder names alone are not identity. Multiple matching roots fail with `conflict`; initialize once during
operator setup, before overlapping application starts. Initialization is lazy/explicit, so a Drive outage
does not make the password-protected read-only site unavailable.

## Server API

Public symbols: `StorageProvider`, `StorageDocument`, `StorageBackup`, `StorageRegistry`, `StorageError`,
`googleDriveStoragePlugin`, `GoogleDriveStorageOptions`. `KnowledgeBase.storage.get(providerId)` resolves
a provider. Protected plugin hooks receive `setupServer(app, { storage, contentRootPath })`; no global singleton is used.

```js
const { KnowledgeBase, loadPluginsFromFile } = require('@solovey1985/knowledge-base-framework');
const kb = new KnowledgeBase({
  contentRootPath: './content',
  plugins: loadPluginsFromFile('./kb.plugins.json'),
});
const storage = kb.storage.get('second-brain-drive');

async function createProject() {
  const content = { title: 'Example', tasks: [] };
  const ticket = await storage.prepareCreate('example', 'operation-0001', content);
  // An application must persist this opaque ticket with the draft BEFORE create.
  return storage.create(ticket, content);
}
```

| Method | Behavior |
| --- | --- |
| `initialize()` | Discover/create and validate workspace root |
| `prepareCreate(key, operationId, content)` | Reserve Drive ID; issue encrypted ticket bound to root, key, operation and payload hash |
| `create(ticket, content)` | Multipart create, same-ID reconciliation; never blindly select a duplicate |
| `read(key)` | Validate root, direct parent, marker, MIME, size and envelope; return content and revision |
| `list({cursor?, archived?})` | Pages of at most 25 files, opaque cursor; default excludes archived documents |
| `update(key, operationId, content)` | Replace complete active document; last-write-wins, no If-Match |
| `archive(key, operationId)` | Mark current envelope archived, without trash/delete |
| `restore(key, operationId)` | Unarchive current document; this is NOT backup restoration |
| `listBackups(key)` | Verified backup descriptors with opaque restore tickets |
| `restoreBackup(key, ticket, operationId, validate?)` | Restore a validated snapshot, including over corrupt current JSON |
| `pruneBackups(key)` | Retry bounded cleanup of verified old copies; trash only |
| `reconcile(key, operationId, content, archived?)` | Read-only confirmation after timeout/restart; never replays old content |

Pages may contain fewer than 25 items after archive filtering; follow `cursor` even for empty pages.
Logical keys match `[a-zA-Z0-9_-]{1,80}`; operation IDs match `[a-zA-Z0-9_-]{8,100}`.
There is no raw file ID, path, MIME, upstream URL or permissions parameter in this contract.

Stored envelope (defined by `src/plugins/google-drive-storage/provider.ts`):

```json
{
  "storageVersion": 1,
  "key": "example",
  "operationId": "operation-0001",
  "archived": false,
  "content": { "title": "Example", "tasks": [] }
}
```

`StorageDocument` returns these logical fields plus `revision`, a SHA-256 of canonical envelope JSON.
Revision is informational; it is not a Drive version/CAS token. Content must be JSON, depth <=32,
with no nonfinite numbers or prototype-related keys. Envelope size defaults to 1 MiB, configurable
from 1 KiB to 4 MiB. Unknown storage versions and malformed documents are not overwritten.
Work Manager must additionally validate its own business schema before calling this provider.

## Retry, isolation and limitations

Create tickets use AES-256-GCM and expire after 14 days; pagination cursors expire after one hour.
They survive restart with the same workspace/root/key and are not authentication credentials: future
HTTP routes must still require the website session and CSRF. Content edits require a new ticket.
If the response to prepareCreate is lost before the ticket is saved, only an unused ID is abandoned.
After create is sent, keep and reuse that ticket instead of preparing another one.

Successful mutations are read back. A lost response/409 is accepted only when the complete expected
envelope matches; otherwise `unknown_result` preserves the draft. Mutations have no automatic retry.
The provider does not persist drafts or retry old update payloads after restart. Callers must reconcile
before an explicit retry; repeated create after a later update cannot roll the document back.

Root and direct-parent checks reject shortcuts, shared-drive objects, moved/trashed files and wrong markers.
These checks are not an atomic fence against an owner moving files concurrently through Drive itself.
Do not move managed files while the app writes. Duplicate roots/keys fail closed; parallel preparation
of different tickets for the same new key is not an atomic uniqueness constraint. Keep one pending create
ticket per project in the application. The provider does not claim distributed locks or merged edits.

Safe error codes include `invalid_input`, `invalid_ticket`, `not_found`, `conflict`, `access_denied`,
`reconnect_required`, `quota_exceeded`, `rate_limited`, `unavailable`, `unknown_result`, `invalid_document`,
`unsupported_version`, and `too_large`. No SDK error/cause is attached. Reads retry transient failures at most three times with
backoff/jitter and numeric Retry-After (up to 30 seconds). Permission/quota/reconnect errors stop immediately.
The OAuth library refreshes tokens; a revoked grant requires operator reconnection.

## Backups and recovery

Every replacement (update, archive, unarchive, backup restore over a valid document) first uploads a JSON
snapshot of the current envelope and reads it back to verify its SHA-256. A failed backup blocks the main
write. Copies use a separate private-property namespace in the same root; normal list/read/update cannot
address them. They carry a source file ID and digest and are never exposed as raw IDs to the UI.

`backupKeep` defaults to 10 and must be an integer from 1 to 100. After confirmed Save, verified copies are
ordered by Drive createdTime descending, then ID for ties. Copies beyond keep are moved to trash, never
permanently deleted. All listed copies must validate before pruning begins. Corrupt, foreign, moved, or
unknown-version copies are not deleted. Cleanup is bounded to 500 copies/20 pages per project; excessive
backlog requires operator inspection instead of unbounded work.

A cleanup failure cannot undo the confirmed write: the returned StorageDocument includes
`warnings: ['backup_cleanup_pending']`. The application must retain this maintenance signal and may call
`pruneBackups(key)` later. No background worker or distributed queue is created by the plugin.

Backup descriptors are `{ticket, createdAt, operationId, revision}`. Restore tickets expire after 14 days
and bind the workspace, root, source file, key and backup digest. `restoreBackup` validates them again,
backs up a valid current document, and writes the chosen content/archive state with a new operation ID.
Malformed/oversized current JSON may be replaced explicitly without creating a bogus backup of it.
Unknown future storageVersion is rejected as `unsupported_version`, including on restore. Domain-schema
validation beyond the storage envelope belongs to the application; it must validate project content before
presenting or accepting it after recovery.

A repeated update of the current operation with identical content returns its confirmed result without
creating another backup; reuse of that operation ID with changed content returns conflict. After an uncertain
response, call `reconcile` with the saved draft, not update: a newer operation yields unknown_result and is
not overwritten. Calling update again is an explicit new mutation under last-write-wins, not a replay-safe
journal lookup. The application must not auto-replay old updates after timeout/restart.

Backups + replacement + pruning are separate Drive calls, not a transaction. LWW still applies to overlapping
writers. Mid-flight external edits/moves and multi-instance cleanup are outside the single-operator guarantee.
Failed/unconfirmed writes can leave extra snapshots, cleaned after a later confirmed Save. Drive's trash is
not permanent backup storage, and same-account copies are not disaster recovery for account loss.

The provider is ready for application integration; browser/Render acceptance is still required.
The existing Git-backed FileService remains separate.

## Verification and operator commands

```powershell
npm run test:storage
node scripts/setup-google-drive.mjs <private-client.json> <private-output.json>
# From the source checkout; creates and trashes disposable test workspaces:
node scripts/smoke-drive-storage.cjs <private-output.json>
```

Contract tests cover configuration, registry isolation, ticket tampering/restart/expiry, root and MIME
boundaries, duplicates, malformed documents, pagination, last-write-wins and safe error mapping.
Live smoke uses the compiled/configured plugin and a new OS process. It does not verify Render or browser UI.

Google references: [file properties](https://developers.google.com/workspace/drive/api/guides/properties),
[uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads),
[error handling](https://developers.google.com/workspace/drive/api/guides/handle-errors).

The optional async `validate(content)` callback checks the exact ticket-bound backup before any mutation. Work Manager uses it for business schema validation; callback rejection leaves the current document untouched.
