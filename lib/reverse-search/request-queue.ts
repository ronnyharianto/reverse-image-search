/**
 * Sequential request queue with minimum start-to-start pacing.
 *
 * A plain "record the last request time, sleep if too soon" limiter is racy
 * under concurrency: several callers read the same stale timestamp, sleep for
 * the same duration, and fire simultaneously (see
 * docs/issues/2026-09-15-codebase-review.md §1). This queue chains every task
 * off a shared promise tail so that:
 *
 * - exactly one task is in flight at a time, and
 * - consecutive task *starts* are at least `minIntervalMs` apart.
 *
 * Together these bound the request rate to `1000 / minIntervalMs` requests
 * per second no matter how many callers enqueue work concurrently.
 *
 * Note: tasks must not enqueue further work on the same queue — a nested
 * `run()` waits on the tail, which is waiting on the calling task (deadlock).
 */
export class SequentialRequestQueue {
  /** Tail of the execution chain. Always fulfills (never rejects). */
  private tail: Promise<unknown> = Promise.resolve();
  /** Timestamp of the most recent task start (0 = nothing ran yet). */
  private lastStartAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  /**
   * Enqueue `task` and resolve with its result. A rejected task does not
   * break the queue — later tasks still run; the returned promise rejects
   * only for the caller of the failing task.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    const execution = this.tail.then(() => this.runExclusive(task));
    this.tail = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }

  private async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const wait = this.lastStartAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastStartAt = Date.now();
    return task();
  }
}
