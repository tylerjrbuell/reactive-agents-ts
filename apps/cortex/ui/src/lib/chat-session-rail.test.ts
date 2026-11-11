import { describe, expect, test } from "bun:test";
import { railMatches, sessionRailGroups, type RailSession } from "./chat-session-rail.js";

const NOW = new Date(2026, 10, 11, 15, 0, 0).getTime();
const HOUR = 3_600_000;
const s = (id: string, name: string, at: number, model?: string): RailSession => ({
  sessionId: id,
  name,
  lastUsedAt: at,
  agentConfig: model ? { model } : {},
});

describe("sessionRailGroups", () => {
  const list = [
    s("a", "Old plan", NOW - 50 * HOUR, "gpt-5"),
    s("b", "Crypto market report", NOW - 2 * 60_000, "qwen3:14b"),
    s("c", "Hash explainer", NOW - 3 * HOUR, "mimo-v2.6"),
  ];

  test("Today first, newest first, then Earlier; model and relative time per row", () => {
    const groups = sessionRailGroups(list, NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Earlier"]);
    expect(groups[0]!.rows.map((r) => r.sessionId)).toEqual(["b", "c"]);
    expect(groups[0]!.rows[0]).toMatchObject({ name: "Crypto market report", model: "qwen3:14b", when: "2 minutes ago" });
    expect(groups[1]!.rows.map((r) => r.sessionId)).toEqual(["a"]);
  });

  test("search filters by name or model and drops empty groups", () => {
    const groups = sessionRailGroups(list, NOW, "GPT");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Earlier");
    expect(sessionRailGroups(list, NOW, "nothing here")).toEqual([]);
  });

  test("a session with no model reads an empty model, not undefined", () => {
    expect(sessionRailGroups([s("x", "New chat", NOW)], NOW)[0]!.rows[0]!.model).toBe("");
  });
});

describe("railMatches", () => {
  test("blank search matches everything", () => {
    expect(railMatches(s("x", "Anything", NOW), "   ")).toBe(true);
  });
});
