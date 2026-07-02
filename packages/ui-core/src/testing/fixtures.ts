import {
  PROTOCOL_VERSION,
  type SeqStamped,
  type UiStreamEvent,
} from "../protocol/events.js";

export interface RunFixture {
  readonly protocolVersion: number;
  readonly events: readonly SeqStamped<UiStreamEvent>[];
}

/** Capture every event of a run stream into a serializable fixture. */
export const recordRunFixture = async (
  stream: AsyncIterable<SeqStamped<UiStreamEvent>>,
): Promise<RunFixture> => {
  const events: SeqStamped<UiStreamEvent>[] = [];
  for await (const e of stream) events.push(e);
  return { protocolVersion: PROTOCOL_VERSION, events };
};

/** Serialize a fixture back to the exact SSE wire format. */
export const fixtureToSSE = (fixture: RunFixture): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of fixture.events) {
        const { seq, ...rest } = event;
        if (seq !== undefined) controller.enqueue(encoder.encode(`id: ${seq}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(rest)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
};

/**
 * Fetch-compatible handler that replays a recorded fixture for ANY request.
 * Zero tokens, zero network, zero flake — drop into Vitest/Playwright/Storybook.
 */
export const mockAgentEndpoint =
  (fixture: RunFixture) =>
  async (_req: Request): Promise<Response> =>
    fixtureToSSE(fixture);
