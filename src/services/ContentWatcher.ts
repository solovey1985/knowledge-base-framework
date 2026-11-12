import { FSWatcher, watch } from 'fs';

type Listener = (relativePath: string | null) => void;

/**
 * One recursive watcher per content root. It never keeps the process alive and
 * degrades to "not watching" where recursive watching is unavailable; callers
 * must therefore also bound their caches by time.
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
      this.watcher = watch(this.rootPath, { recursive: true, persistent: false }, (_event, filename) => {
        const name = filename ? String(filename).split('\\').join('/') : null;
        // The framework's own cache file must not trigger its own invalidation.
        if (name && /(^|\/)\.kb-search-index\.json$/.test(name)) return;
        this.pending = name;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.emit(), this.debounceMs);
        this.timer.unref();
      });
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
