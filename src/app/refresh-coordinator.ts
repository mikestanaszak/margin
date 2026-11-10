export type RefreshRequest = { path: string; force: boolean };

/**
 * Coalesce library refreshes without losing a forced refresh behind a normal
 * poll. Every caller resolves only after the queue is drained, so a mutation
 * can immediately observe its own note/folder changes even before the native
 * filesystem watcher delivers an event.
 */
export function createRefreshCoordinator(
  run: (request: RefreshRequest) => Promise<void>,
) {
  let inFlight: Promise<void> | null = null;
  let pending: RefreshRequest | null = null;
  return (request: RefreshRequest) => {
    if (pending?.path === request.path)
      pending = { ...pending, force: pending.force || request.force };
    else pending = request;
    if (!inFlight) {
      inFlight = (async () => {
        while (pending) {
          const next = pending;
          pending = null;
          await run(next);
        }
      })().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}
