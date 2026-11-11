import { describe, expect, it } from "bun:test";
import { absoluteTime, relativeTime, strategyChip, turnTiming, type StrategyTurn } from "./chat-turn-meta.js";

const NOW = Date.UTC(2026, 10, 10, 19, 21);
const utc = { locale: "en-US", timeZone: "UTC" };

describe("relativeTime", () => {
  it("reads like a chat", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 60_000, NOW)).toBe("1 minute ago");
    expect(relativeTime(NOW - 14 * 60_000, NOW)).toBe("14 minutes ago");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3 hours ago");
    expect(relativeTime(NOW - 30 * 3_600_000, NOW)).toBe("yesterday");
    expect(relativeTime(NOW - 4 * 86_400_000, NOW)).toBe("4 days ago");
  });

  it("old or future timestamps read as a date", () => {
    expect(relativeTime(NOW - 10 * 86_400_000, NOW, utc)).toBe("Oct 31");
    expect(relativeTime(NOW + 5 * 60_000, NOW, utc)).toBe("Nov 10");
  });
});

describe("absoluteTime", () => {
  it("full date and time for the hover", () => {
    expect(absoluteTime(NOW, utc)).toBe("Nov 10, 2026, 7:21 PM");
  });
});

describe("strategyChip", () => {
  const label = (id: string) => ({ reactive: "ReAct", "plan-execute-reflect": "Plan-Execute" })[id] ?? id;

  it("nothing reported: no chip (never inferred)", () => {
    expect(strategyChip({})).toBeUndefined();
  });

  it("the reported strategy, with the catalog's name", () => {
    expect(strategyChip({ strategy: "reactive" }, label)).toEqual({ label: "ReAct", title: "Strategy this run reported: ReAct" });
  });

  it("sub-agents that ran other strategies are added once", () => {
    const sub = (strategy?: string, kids: StrategyTurn["subAgents"] = []): { turn: StrategyTurn } => ({ turn: { ...(strategy ? { strategy } : {}), subAgents: kids } });
    const turn: StrategyTurn = { strategy: "reactive", subAgents: [sub("reactive"), sub("plan-execute-reflect", [sub("reflexion")]), sub("plan-execute-reflect")] };
    expect(strategyChip(turn, label)).toEqual({
      label: "ReAct + Plan-Execute + reflexion",
      title: "Strategy this run reported: ReAct. Sub-agents ran: Plan-Execute, reflexion",
    });
  });
});

describe("turnTiming", () => {
  it("finished: reported duration and the finish time", () => {
    const t = turnTiming({ ts: NOW - 125_000, durationMs: 125_000, finishedAt: NOW }, NOW + 3 * 60_000, utc);
    expect(t.ran).toBe("Ran 2m 05s");
    expect(t.finished).toEqual({ relative: "3 minutes ago", absolute: "Nov 10, 2026, 7:21 PM", at: NOW });
  });

  it("running: a live elapsed counter, no finish time", () => {
    expect(turnTiming({ ts: NOW - 12_000, streaming: true }, NOW)).toEqual({ ran: "Running 12s" });
  });

  it("no reported duration: only the finish time (never a guessed duration)", () => {
    const t = turnTiming({ ts: NOW }, NOW, utc);
    expect(t.ran).toBeUndefined();
    expect(t.finished?.relative).toBe("just now");
  });
});
