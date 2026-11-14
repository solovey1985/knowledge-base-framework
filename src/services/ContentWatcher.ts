import { existsSync, FSWatcher, watch } from 'fs';

type Listener = (relativePath: string | null) => void;

/**
 * One recursive watcher per content root. It never keeps the process alive and
 * degrades to "not watching" where recursive watching is unavailable; callers
 * must therefore also bound their caches by time.
 *
 * It also closes itself when its root directory disappears, so callers that
 * delete the root without calling close() (temp roots in tests) still exit.
 * On Windows a recursive watch whose root is deleted fires no 'error' event;
 * libuv instead reports an endless stream of 'rename' events naming the root,
 * and that stream keeps the process alive even though the handle is unref'd
 * (process.getActiveResourcesInfo() does not show it). Every 'rename' event
 * therefore checks that the root still exists. Deleting the root always
 * produces such events, so no periodic existence check is needed.
 */
export class ContentWatcher {
  private watcher?: FSWatcher;
  private readonly listeners = new Set<Listener>();
  private timer?: NodeJS.Timeout;
  private pending: string | null = null;

  constructor(private readonly rootPath: string, private readonly debounceMs: number = 150) {}

  /** True when file changes will be reported. */
  start(): boolean {
    if (this.watcher) return true;
    try {
      this.watcher = watch(this.rootPath, { recursive: true, persistent: false }, (event, filename) => {
        if (event === 'rename' && !existsSync(this.rootPath)) {
          this.close();
          return;
        }
        const name = filename ? String(filename).split('\\').join('/') : null;
        // The framework's own cache file must not trigger its own invalidation.
        if (name && /(^|\/)\.kb-search-index\.json$/.test(name)) return;
        this.pending = name;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.emit(), this.debounceMs);
        this.timer.unref();
      });
      // persistent:false is unreliable for recursive watches on Windows/macOS;
      // unref() guarantees the watcher never keeps the process alive on its own.
      this.watcher.unref();
      this.watcher.on('error', () => this.close());
      return true;
    } catch {
      this.watcher = undefined;
      return false;
    }
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
  }

  private emit(): void {
    const changed = this.pending;
    this.pending = null;
    for (const listener of this.listeners) {
      try { listener(changed); } catch { /* a listener must not stop the others */ }
    }
  }
}
