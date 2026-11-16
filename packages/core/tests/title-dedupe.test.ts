import { describe, test, expect } from "bun:test";
import { isNearDuplicateTitle, normalizeTitle } from "../src/types/checklist.js";
import type { AgentEvent } from "../src/types/agent-event.js";

describe("normalizeTitle", () => {
  test("drops case, punctuation, articles and tool hints", () => {
    expect([...normalizeTitle("Read the File (tool: file-read)")]).toEqual(["read", "file"]);
    expect([...normalizeTitle("Fetch data tools: web-search, http-get")]).toEqual(["fetch", "data"]);
  });
  test("hostile input yields an empty set", () => {
    // @ts-expect-error hostile non-string input
    expect(normalizeTitle(undefined).size).toBe(0);
    // @ts-expect-error hostile non-string input
    expect(normalizeTitle(42).size).toBe(0);
    expect(normalizeTitle("").size).toBe(0);
    expect(normalizeTitle("!!! ... ???").size).toBe(0);
  });
});

describe("isNearDuplicateTitle", () => {
  test("padded restatement", () => {
    expect(isNearDuplicateTitle("Verify report", "Verify the report file content")).toBe(true);
    expect(isNearDuplicateTitle("Verify the report file content", "Verify report")).toBe(true);
  });
  test("hinted vs plain titles", () => {
    expect(isNearDuplicateTitle("Flip four coins (tool: code-execute)", "Flip four coins")).toBe(true);
    expect(isNearDuplicateTitle("Flip 4 coins tool: code-execute", "flip 4 coins.")).toBe(true);
  });
  test("high overlap and exact", () => {
    expect(isNearDuplicateTitle("Write summary of results to file now", "Write summary of results to file")).toBe(true);
  });
  test("distinct steps are not duplicates", () => {
    expect(isNearDuplicateTitle("Read the config", "Write the report")).toBe(false);
    expect(isNearDuplicateTitle("Search", "Search web for umami recipes")).toBe(false);
  });
  test("hostile input never throws and is not a duplicate", () => {
    expect(isNearDuplicateTitle("", "")).toBe(false);
    // @ts-expect-error hostile non-string input
    expect(isNearDuplicateTitle(undefined, "x y")).toBe(false);
    expect(isNearDuplicateTitle("\u0000\uD800 ", "a")).toBe(false);
  });
});

describe("channel inbox event members", () => {
  test("compile with their payloads", () => {
    const events: AgentEvent[] = [
      { _tag: "ChannelInboxRetried", adapterId: "a", attempts: 2 },
      { _tag: "ChannelInboxFailed", adapterId: "a", attempts: 3, reason: "max_attempts" },
      { _tag: "ChannelInboxBatched", routeId: "r", size: 2, sourceIds: ["1", "2"] },
      { _tag: "ChannelInboxFolded", routeId: "r", sourceId: "1" },
      { _tag: "ChannelInboxInterrupted", routeId: "r", sourceId: "1" },
    ];
    expect(events.map((e) => e._tag)).toHaveLength(5);
  });
});
