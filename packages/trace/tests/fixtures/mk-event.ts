import type { TraceEvent } from "../../src/index.js";

// boundary: the one cast site for partial trace-event fixtures shared by the
// trace tests; the readers under test ignore absent fields.
export const mk = (e: Record<string, unknown>): TraceEvent => e as unknown as TraceEvent;
