/**
 * Runs the background server checks: at most `limit` at once, each id once, stops handing out work
 * when the signal aborts (the person left the tab). The check itself and what to do with its result
 * are the caller's (`ServersTab` wires `testServer`); this only schedules.
 */

/** What the runner needs. */
export interface ProbeRunOptions {
  /** Server ids to check, in order. */
  readonly ids: readonly string[];
  /** Checks that may run at once. */
  readonly limit: number;
  readonly signal: AbortSignal;
  /** Called when a check begins. */
  readonly onStart: (serverId: string) => void;
  /** Check one server. Must not throw; a failure is the caller's to record. */
  readonly check: (serverId: string, signal: AbortSignal) => Promise<void>;
  /** Called when a check ends (also after an abort mid-check). */
  readonly onSettle: (serverId: string) => void;
}

/** Check every id with at most `limit` running; resolves when all started checks have settled. */
export async function runProbeQueue(opts: ProbeRunOptions): Promise<void> {
  const queue = [...opts.ids];
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (opts.signal.aborted) return;
      opts.onStart(id);
      try {
        await opts.check(id, opts.signal);
      } catch {
        // check() reports its own failure; a thrown one must not stop the other workers.
      } finally {
        opts.onSettle(id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.limit, queue.length)) }, worker));
}
