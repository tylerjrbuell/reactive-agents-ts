import { describe, expect, test } from "bun:test";
import {
  PROTOCOL_VERSION,
  parseUiStreamEvent,
  isTerminalEvent,
  type UiStreamEvent,
} from "../src/protocol/events.js";

describe("ui-core protocol", () => {
  test("version constant", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  test("parses a TextDelta wire line", () => {
    const e = parseUiStreamEvent('{"_tag":"TextDelta","text":"hi"}');
    expect(e).toEqual({ _tag: "TextDelta", text: "hi" });
  });

  test("parses new-tag events", () => {
    const attach = parseUiStreamEvent(
      '{"_tag":"RunAttached","runId":"r1","status":"awaiting-interaction","resumeCursor":7,"protocolVersion":1}',
    );
    expect(attach?._tag).toBe("RunAttached");
    const ir = parseUiStreamEvent(
      '{"_tag":"InteractionRequested","runId":"r1","interactionId":"i1","kind":"choice","prompt":"pick one","schema":{"options":["a","b"]}}',
    );
    expect(ir?._tag).toBe("InteractionRequested");
  });

  test("rejects garbage and untagged JSON", () => {
    expect(parseUiStreamEvent("not json")).toBeNull();
    expect(parseUiStreamEvent('{"text":"no tag"}')).toBeNull();
    expect(parseUiStreamEvent('{"_tag":42}')).toBeNull();
  });

  test("terminal classification", () => {
    const done = { _tag: "StreamCompleted", output: "x", metadata: {} } as UiStreamEvent;
    const delta = { _tag: "TextDelta", text: "x" } as UiStreamEvent;
    const limited = {
      _tag: "LimitExceeded",
      kind: "rateLimit",
      retryAfterMs: 1000,
    } as UiStreamEvent;
    expect(isTerminalEvent(done)).toBe(true);
    expect(isTerminalEvent(limited)).toBe(true);
    expect(isTerminalEvent(delta)).toBe(false);
  });
});
