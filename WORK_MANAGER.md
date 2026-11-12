# Work Manager API

Optional server-only application plugin. The per-document task editor, local drafts and JSON API are implemented.
Today/dependency planning and the timer remain separate work. This checkout has not been deployed to Render.

## Enable

Configure `passwordAuth`, a dedicated `googleDriveStorage` provider/workspace, then:

```json
{"name":"workManager","options":{"storageProviderId":"drive","draftNamespace":"second-brain-work"}}
```

The provider ID must match the storage configuration. `enabled:false` skips the plugin.
`KnowledgeBase` refuses Work Manager without an authentication plugin; missing storage fails
at server setup. Call `setupSecurity(app)` before any host static routes and
`setupMiddleware(app)` to register API routes. Custom authentication providers must validate
sessions, Origin and CSRF on mutations, and set `res.locals.authentication` after validation.
The supported implementation is [passwordAuth](PASSWORD_AUTH.md).

## One document is one project

Each `*.work-manager.md` file under content opens its own task editor. There is no
project list, New Project button or editable project metadata in the browser.
`pagePath` is no longer an option: the suffix selects the renderer for all project documents.

```yaml
---
id: tech-lead-readiness
title: Tech Lead Readiness
description: |
  Preparation for the Tech Lead role.
---
```

Required YAML front matter: id/title/description. Quoted and multiline YAML strings are
supported. Duplicate keys/IDs, aliases, custom tags and unknown metadata keys are rejected.
The stable id binds to `wm-<id>` in Drive and survives moving/renaming the document.
Do not copy a file with the same id to create another project. IDs are unique in content.
Only files inside content are scanned, symlink directories/files are skipped. Limits:
20,000 entries, depth 32, 1 MiB per marker file, 32 KiB front matter.

Title/description in YAML are authoritative; the legacy JSON title/notes are cached values
updated on Save. The API cannot initialize an undeclared project or change YAML metadata.
The first explicit Save initializes its Drive JSON using the persisted create ticket.
No automatic writes occur merely by opening the page. Task archive is the optional boolean
`archived` field (missing = false); archiving/restoring a task is a draft edit until Save.

Draft keys include origin, configured draftNamespace/provider ID, and project ID. Change
namespace when pointing a provider at another workspace. Restoring drafts is explicit.
A pending create retries its original ticket/payload; a pending update uses read-only
reconcile. A separate confirmed user action can prepare a new Save after uncertainty.
Save acknowledgement compares values independent of object-key order; later edits remain dirty.
Logout offers draft cleanup; session expiry hides the editor. Browser storage failure is
visible and prevents creating a file without a persisted retry ticket.

## Source contract

- `src/plugins/work-manager/model.ts`: `WorkProject`, `WorkTask`, `validateProject`.
- `src/plugins/work-manager/service.ts`: `WorkManagerService`, storage orchestration.
- `src/plugins/work-manager/index.ts`: `workManagerPlugin`, fixed routes and error mapping.
- [Storage](GOOGLE_DRIVE_STORAGE.md): opaque tickets, LWW, recovery and cleanup warnings.

All routes start with `/api/work-manager`. GET needs the session cookie; POST/PUT also need
`Content-Type: application/json`, the configured Origin, and `X-CSRF-Token` from `/auth/session`.
Responses are private/no-store. Unknown body/query fields are rejected.

| Route | Input | Result |
| --- | --- | --- |
| GET `/projects` | optional cursor and archived=true/false | items with id/type/title/revision/archived and optional cursor |
| GET `/projects/:id` | none | SaveResult |
| POST `/projects/prepare` | operationId, project | opaque ticket |
| POST `/projects` | ticket, project | 201 SaveResult |
| PUT `/projects/:id` | operationId, project | SaveResult |
| POST `/projects/:id/archive` or `/unarchive` | operationId | SaveResult |
| GET `/projects/:id/backups` | none | items with ticket/createdAt/operationId/revision |
| POST `/projects/:id/restore-backup` | operationId, ticket | SaveResult |
| POST `/projects/:id/reconcile` | operationId, project, archived | SaveResult; read-only, never replay |

SaveResult contains `project`, `revision`, `operationId`, `archived` and optional
`warnings:["backup_cleanup_pending"]`. Revision is informational, not a precondition.
Persist the create ticket before commit; retries must retain the same payload/ticket.
After an uncertain update, use reconcile; a new explicit Save gets a new operationId.
Do not automatically replay an old PUT. Warnings do not undo a confirmed save.

Project IDs map to server keys `wm-<id>`; clients cannot select Drive IDs, MIME, uploads or
filesystem writes. Project/task IDs are 1–64 alphanumeric/underscore/hyphen characters.
`inbox` is reserved for type=inbox. JSON schemaVersion=1 only, all declared fields required,
max 500 tasks, project JSON 256 KiB, request JSON 300 KiB, no compressed request bodies.
Titles max 200 characters, notes 20000, doneWhen 4000; date-only calendar dates; integer
spentMinutes 0–52560000. Dependencies are unique, local and acyclic. Remove dependencies
in a separate Save before deleting their predecessor if successors remain.

Note paths must be existing `.md` files contained in content (including realpath checks)
on writes. Reading old documents does not require referenced notes still to exist.
Stored JSON and backup business schemas are validated; backup validation runs before the
provider mutates current data. Unknown future schema versions are preserved. The sequence
is not a transaction against concurrent external edits; accepted storage semantics are LWW.
Task text uses DOM textContent/value, never HTML. Markdown outside front matter remains authored Git content.

Errors contain only `{error:{code}}`: 400 invalid_request/invalid_input/invalid_ticket,
404 not_found, 409 conflict, 413 too_large, 422 invalid_project/invalid_document/unsupported_version,
429 busy/rate_limited, 503 storage_unavailable/unknown_result. Authentication 401/403 uses
the existing neutral message body. Provider permission/quota/reconnect details stay private.
At most four active API operations per plugin instance; this is not a distributed limiter.

## Validation

`npm test` includes real HTTP/passwordAuth + contract fake storage tests and
WorkManagerService + GoogleDriveStorageProvider tests with a simulated Drive transport.
They do not replace live Google API, browser UI or Render acceptance.

UI: `client/workManager.ts`, shared state `src/plugins/work-manager/draft.ts`; YAML parser/catalog: `content-metadata.ts`. The legacy API list/project archive routes remain for storage compatibility; the task editor does not use them.

## Planning (WM-03)

Each document has All Tasks, Today, and Archive views. Today means available work in this document: non-archived, not done, and all direct prerequisites done. It includes future and undated tasks. Order: high/normal/low priority, ascending due date (undated last), then stable ID. The sort does not reorder persisted tasks.

The dependency editor uses existing `WorkTask.blockedBy` IDs; self/unknown/cyclic dependencies are rejected by the API and cyclic choices are disabled in the UI. Archiving a prerequisite does not complete it. Reopening it blocks unfinished successors again. Completed successors keep their explicit status; reopening predecessors never silently changes saved statuses.

Progress counts done/non-archived tasks; an empty active set shows no tasks rather than 100%. `src/plugins/work-manager/planning.ts` contains shared derived rules. No new JSON fields or HTTP routes. Existing explicit Save/draft/reconcile rules apply. Inbox and cross-document moves are deferred by user decision (2026-11-04). Task removal remains archive-only in the UI.

## Timer (WM-04)

Start is available for Ready tasks. One durable timer record per origin/draftNamespace is serialized across tabs with Web Locks (HTTPS/localhost required). Start persists the working draft. Stop freezes a wall-clock interval and shows editable integer minutes, rounded up by default; sleep, reload and clock jumps are always reviewed, never silently added. Confirm adds minutes to the draft, then explicit Save writes the existing spentMinutes field. No per-second Drive writes. Save/logout require resolving the active timer first.

Each interval also records baseMinutes; applying it against a changed total is rejected, even if the local receipt was lost. A local lastTimerId receipt is stored atomically with the draft increment before deleting the timer record. Recovery requires the matching current draft; stale tabs must restore it. This does not provide cross-device coordination or change LWW. The timer remains local across auth expiry; a newly opened authenticated page can restore it. Timer-specific browser 401/outage and crash-window acceptance remain pending; unit tests cover receipt replay and pending Save/reconcile.

## React client (rc.8)

The client is now in client/plugins/work-manager with React rendering, an operation controller and timer store. Draft keys, JSON/API and explicit Save semantics are preserved. See CLIENT_PLUGINS.md for enabled-only page entry loading and lifecycle cleanup. Prior client/workManager.ts and workManagerTimer.ts have been replaced.

## Project overview and task dialogs (rc.10)

The overview shows done/total, available work count, progress, a horizontally scrollable prerequisite graph, a task list and selected task details. The reference layout is adapted to the portal theme; no environment/readiness metadata is fabricated. Graph columns follow dependency depth, stable rows follow stored task order; graph selection and list selection share the details panel. Archived prerequisites remain visible when required by active tasks.

Add/Edit opens a native modal dialog with initial focus, focus containment and Escape handling. The dialog owns a working copy. Apply validates it and updates only the browser draft; Cancel/Escape discard unapplied changes. New tasks are not inserted until Apply. Task editing, status/priority/date/criteria/note/dependencies are inside the dialog; archive/restore and timer actions remain available on the overview. Save remains an explicit separate Drive operation. The task time accumulated outside a dialog is preserved on Apply. JSON and API do not change.

The dependency layout is in src/plugins/work-manager/dependency-layout.ts; the graph component is client/plugins/work-manager/DependencyGraph.tsx. Browser acceptance covers cancel add/edit, apply add/edit, dependencies, graph/progress, Drive Save/reload and Escape. Responsive CSS has a single-column breakpoint; mobile viewport acceptance is still separate.

## Overview of all projects (rc.18)

A document named `*.work-overview.md` shows the open work of every project on one page: overdue tasks, tasks in progress, tasks that can start now, and the progress of each project. It stores nothing; optional front matter `title` and `description` and the Markdown body are shown above the lists.

```markdown
---
title: Today
---
Open work across all projects.
```

`GET /api/work-manager/overview` returns, for every YAML-declared project in document-path order, `id`, `title`, `path`, `state` (`ready`, `empty` when never saved, `archived`, `invalid`), `progress` and the open tasks with `readiness`. It needs the session cookie, reads the projects one at a time inside one work slot and never writes. A storage outage fails the whole request with `storage_unavailable`; one damaged project is reported as `invalid` without hiding the others. "Overdue" is decided in the browser from the user's calendar day.
