/**
 * Streaming assertion helpers for testing agent stream output.
 *
 * Usage:
 * ```typescript
 * await expectStream(agent.runStream("hello")).toEmitTextDeltas();
 * await expectStream(agent.runStream("hello")).toComplete({ within: 5000 });
 * ```
 */

export interface StreamExpectation {
  /** Assert that at least one TextDelta event was emitted. */
  toEmitTextDeltas(): Promise<void>;
  /** Assert that the stream completes within the given timeout (ms). */
  toComplete(options: { within: number }): Promise<void>;
  /** Assert that all specified event tags appear in the stream. */
  toEmitEvents(tags: string[]): Promise<void>;
}

export function expectStream(
  generator: AsyncIterable<{ _tag: string; [key: string]: unknown }>,
): StreamExpectation {
  let collected: Array<{ _tag: string; [key: string]: unknown }> | null = null;

  const collect = async (): Promise<Array<{ _tag: string; [key: string]: unknown }>> => {
    if (collected) return collected;
    collected = [];
    for await (const event of generator) {
      collected.push(event);
    }
    return collected;
  };

  return {
    async toEmitTextDeltas() {
      const events = await collect();
      const hasTextDelta = events.some((e) => e._tag === "TextDelta");
      if (!hasTextDelta) {
        throw new Error("Expected stream to emit at least one TextDelta event, but none were found");
      }
    },

    async toComplete({ within }) {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Stream did not complete within ${within}ms`)), within),
      );
      await Promise.race([collect(), timeout]);
    },

    async toEmitEvents(tags) {
      const events = await collect();
      const emittedTags = new Set(events.map((e) => e._tag));
      const missing = tags.filter((t) => !emittedTags.has(t));
      if (missing.length > 0) {
        throw new Error(`Expected stream to emit events [${missing.join(", ")}] but they were missing`);
      }
    },
  };
}
