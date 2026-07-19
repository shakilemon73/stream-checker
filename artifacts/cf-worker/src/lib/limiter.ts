/**
 * Simple concurrent limiter — replaces p-limit for CF Workers.
 * p-limit depends on async_hooks which is not available in the Workers runtime.
 */
export function createLimiter(concurrency: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    running++;
    try {
      return await fn();
    } finally {
      running--;
      queue.shift()?.();
    }
  };
}
