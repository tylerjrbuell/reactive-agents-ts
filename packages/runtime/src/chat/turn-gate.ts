import { Effect } from "effect";

/**
 * Per-engine FIFO turn gate (one Effect semaphore, one permit). A chat turn
 * reads history, awaits a model call, then appends its user+assistant pair;
 * without serialization two concurrent turns read the same history and
 * interleave their appends. The permit spans the whole read-to-record window.
 *
 * Failure-transparent: `run` rethrows the work's own rejection unchanged (no
 * fiber wrapper) and always releases, so a failed turn never wedges the queue.
 */
export class TurnGate {
  readonly #permit = Effect.runSync(Effect.makeSemaphore(1));

  /** Wait for the permit; the caller MUST pair this with {@link release}. */
  acquire(): Promise<void> {
    return Effect.runPromise(this.#permit.take(1)).then(() => undefined);
  }

  /** Return the permit taken by {@link acquire}. */
  release(): void {
    Effect.runSync(this.#permit.release(1));
  }

  /** Run `work` while holding the permit; releases on success, rejection or throw. */
  async run<A>(work: () => Promise<A>): Promise<A> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }
}
