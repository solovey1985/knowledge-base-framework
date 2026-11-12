import { performance } from 'node:perf_hooks';

const REFILL_MS = 10_000;
const CAPACITY = 3;

/** A single-process token bucket. Restart discards credit rather than granting attempts. */
export class LoginAttemptLimiter {
  private tokens = 0;
  private updatedAt: number;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.updatedAt = now();
  }

  /** Zero means admitted; otherwise returns the Retry-After delay in whole seconds. */
  consume(): number {
    const current = this.now();
    // Monotonic time avoids extra credit after a wall-clock correction.
    const elapsed = Math.max(0, current - this.updatedAt);
    this.tokens = Math.min(CAPACITY, this.tokens + elapsed / REFILL_MS);
    this.updatedAt = Math.max(this.updatedAt, current);

    if (this.tokens < 1) {
      return Math.ceil(((1 - this.tokens) * REFILL_MS) / 1000);
    }

    this.tokens -= 1;
    return 0;
  }
}
