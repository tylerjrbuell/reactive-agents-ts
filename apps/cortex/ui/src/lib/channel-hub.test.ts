import { describe, expect, it } from "bun:test";
import {
  addSenderChips,
  draftFromRoute,
  draftProblems,
  explainView,
  newDraft,
  routeFromDraft,
  routesToAgent,
  simulateView,
  widenConfirmCopy,
  wideningTokens,
  type HubRouteWire,
} from "./channel-hub.js";

const saved: HubRouteWire = {
  id: "r1",
  match: { channelId: "ch-1" },
  target: { agentId: "gw-1" },
  priority: 40,
  groups: "off",
  deniedReply: "No.",
  owners: ["telegram:1"],
  allow: ["telegram:2"],
  maxCostPerDayUsd: 3,
};

describe("draft <-> route", () => {
  it("keeps the fields the editor does not own", () => {
    const next = routeFromDraft(draftFromRoute(saved), saved);
    expect(next.priority).toBe(40);
    expect(next.groups).toBe("off");
    expect(next.deniedReply).toBe("No.");
    expect(next.owners).toEqual(["telegram:1"]);
    expect(next.maxCostPerDayUsd).toBe(3);
    expect(next.ack).toBe(false);
  });
  it("a cleared cap leaves the route (so a patch can null it)", () => {
    const d = draftFromRoute(saved);
    d.maxCostPerDayUsd = "";
    expect("maxCostPerDayUsd" in routeFromDraft(d, saved)).toBe(false);
  });
  it("writes the acknowledgement fields", () => {
    const d = newDraft("ch-1", "gw-1");
    d.id = "r2";
    d.ackOn = true;
    d.ackAfterMs = "2500";
    d.ackText = "Working on it";
    d.ackSource = "model";
    d.ackModelTimeoutMs = "2000";
    d.ackTyping = false;
    expect(routeFromDraft(d).ack).toEqual({ afterMs: 2500, text: "Working on it", typing: false, source: "model", modelTimeoutMs: 2000 });
    expect(draftFromRoute(routeFromDraft(d)).ackOn).toBe(true);
  });
  it("ack off is the explicit false, several lines rotate", () => {
    const d = newDraft("ch-1", "gw-1");
    d.id = "r2";
    expect(routeFromDraft(d).ack).toBe(false);
    d.ackOn = true;
    d.ackText = "One\nTwo";
    expect(routeFromDraft(d).ack).toMatchObject({ text: ["One", "Two"] });
  });
  it("minGapMs survives a draft round trip, is dropped when blank, and never goes to a webhook route", () => {
    const paced: HubRouteWire = { ...saved, minGapMs: 2500 };
    expect(routeFromDraft(draftFromRoute(paced), paced).minGapMs).toBe(2500);
    expect(routeFromDraft({ ...draftFromRoute(paced), minGapMs: "" }, paced).minGapMs).toBeUndefined();
    expect(routeFromDraft(draftFromRoute(paced), paced, "webhook").minGapMs).toBeUndefined();
    expect(draftProblems({ ...draftFromRoute(paced), minGapMs: "60001" }, false).join(" ")).toContain("Minimum gap");
  });

  it("a webhook route leaves out senderTools and ack (the framework refuses the keys, not only non-defaults)", () => {
    const d = { ...newDraft("ch-w", "gw-1"), id: "hook", ackOn: true };
    const r = routeFromDraft(d, undefined, "webhook");
    expect("senderTools" in r).toBe(false);
    expect("ack" in r).toBe(false);
    expect(r).toMatchObject({ owners: [], allow: [], deny: [], open: false });
    expect("senderTools" in routeFromDraft(d)).toBe(true);
  });
  it("a new route is closed: read-only senders, nobody allowed", () => {
    const r = routeFromDraft({ ...newDraft("ch-1", "gw-1"), id: "x" });
    expect(r).toMatchObject({ open: false, senderTools: { _tag: "ReadOnly" }, owners: [], allow: [] });
  });
});

describe("draftProblems", () => {
  const ok = () => ({ ...newDraft("ch-1", "gw-1"), id: "r2" });
  it("a closed route is savable", () => expect(draftProblems(ok(), true)).toEqual([]));
  it("open needs every cap", () => {
    const d = { ...ok(), open: true };
    expect(draftProblems(d, true).length).toBe(3);
    expect(draftProblems({ ...d, maxCostPerDayUsd: "5", maxTurnsPerHour: "20", maxTurnsPerSenderPerHour: "3" }, true)).toEqual([]);
    expect(draftProblems({ ...d, maxCostPerDayUsd: "0", maxTurnsPerHour: "20", maxTurnsPerSenderPerHour: "3" }, true)).toHaveLength(1);
  });
  it("full agent tools needs an owner", () => {
    expect(draftProblems({ ...ok(), senderTools: "AgentDefault" }, true)).toHaveLength(1);
    expect(draftProblems({ ...ok(), senderTools: "AgentDefault", owners: ["telegram:1"] }, true)).toEqual([]);
  });
  it("sender keys need a platform prefix", () => expect(draftProblems({ ...ok(), allow: ["12345"] }, true)).toHaveLength(1));
  it("the model wait stays inside 1..30000", () => {
    const d = { ...ok(), ackOn: true, ackSource: "model" as const };
    expect(draftProblems({ ...d, ackModelTimeoutMs: "0" }, true)).toHaveLength(1);
    expect(draftProblems({ ...d, ackModelTimeoutMs: "30001" }, true)).toHaveLength(1);
    expect(draftProblems({ ...d, ackModelTimeoutMs: "30000" }, true)).toEqual([]);
  });
  it("an id is needed only when creating", () => {
    expect(draftProblems({ ...ok(), id: "" }, true)).toHaveLength(1);
    expect(draftProblems({ ...ok(), id: "" }, false)).toEqual([]);
  });
});

describe("addSenderChips", () => {
  it("normalises, dedupes, reports the bad ones", () => {
    const r = addSenderChips(["telegram:1"], "Telegram:1, signal:+155 oops");
    expect(r.list).toEqual(["telegram:1", "signal:+155"]);
    expect(r.problems).toHaveLength(1);
  });
});

describe("widening (mirrors the framework's wideningChanges)", () => {
  it("a new route that is closed widens nothing", () => expect(wideningTokens(undefined, { id: "r", match: { channelId: "c" }, target: { agentId: "a" } })).toEqual([]));
  it("an added owner, open and AgentDefault each need a token", () => {
    const next: HubRouteWire = { ...saved, owners: ["telegram:1", "telegram:9"], open: true, senderTools: { _tag: "AgentDefault" } };
    expect(wideningTokens(saved, next)).toEqual(["owners:r1", "open:r1", "agent-default:r1"]);
  });
  it("removing an owner, or keeping open, needs none", () => {
    const wide: HubRouteWire = { ...saved, open: true, senderTools: { _tag: "AgentDefault" } };
    expect(wideningTokens(wide, { ...wide, owners: [] })).toEqual([]);
  });
  it("the confirm copy names each risk", () => {
    const c = widenConfirmCopy("r1", ["open:r1", "owners:r1"]);
    expect(c.title).toContain("r1");
    expect(c.message).toContain("anyone");
    expect(c.message).toContain("Owners");
  });
});

describe("probe views", () => {
  it("explain: route, role, tools and why", () => {
    const v = explainView({ decision: "allowed", routeId: "r1", role: "owner", toolExposure: { _tag: "AgentDefault" }, reason: "listed owner" });
    expect(v.tone).toBe("ok");
    expect(v.lines).toEqual(["Route: r1", "Role: owner", "Tools: the agent's full tools", "Why: listed owner"]);
  });
  it("explain: a denial says why", () => {
    const v = explainView({ decision: "denied", routeId: "r1", reason: "not on the allow list" });
    expect(v.tone).toBe("bad");
    expect(v.lines).toContain("Why: not on the allow list");
  });
  it("simulate outcomes", () => {
    expect(simulateView({ outcome: "answered", text: "hi" }).lines).toEqual(["hi"]);
    expect(simulateView({ outcome: "failed", reason: "turn_failed", detail: "no key" }).tone).toBe("bad");
    expect(simulateView({ outcome: "unrouted" }).tone).toBe("warn");
    expect(simulateView(null).headline).toBe("No answer");
  });
});

describe("routesToAgent", () => {
  it("lists a agent's routes by priority", () => {
    const rs: HubRouteWire[] = [
      { id: "b", match: { channelId: "c" }, target: { agentId: "a" }, priority: 200 },
      { id: "a", match: { channelId: "c" }, target: { agentId: "a" } },
      { id: "z", match: { channelId: "c" }, target: { agentId: "other" } },
    ];
    expect(routesToAgent("a", rs).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("telegram acknowledgement default", () => {
  it("a new Telegram draft starts with a model ack; other channels start off", () => {
    const tg = newDraft("ch-1", "gw-1", "telegram");
    expect([tg.ackOn, tg.ackSource]).toEqual([true, "model"]);
    expect(routeFromDraft({ ...tg, id: "r" }).ack).toMatchObject({ source: "model" });
    const sig = newDraft("ch-1", "gw-1", "signal");
    expect([sig.ackOn, sig.ackSource]).toEqual([false, "canned"]);
  });
});

describe("webhook routes follow the capability table", () => {
  const busy: HubRouteWire = {
    ...saved,
    match: { channelId: "ch-1", conversation: "dm", when: { _tag: "Mention" } },
    maxTurnsPerSenderPerHour: 9,
    maxTurnsPerHour: 30,
    resetCommands: ["/new"],
    failureNotice: false,
    turnTimeoutMs: 45_000,
    batchWindowMs: 500,
  };

  it("drops every conversation-only field but keeps the caps and the run limit", () => {
    const r = routeFromDraft(draftFromRoute(busy), busy, "webhook");
    expect(r.match).toEqual({ channelId: "ch-1" });
    expect(r.maxTurnsPerSenderPerHour).toBeUndefined();
    expect(r.resetCommands).toBeUndefined();
    expect(r.failureNotice).toBeUndefined();
    expect(r.batchWindowMs).toBeUndefined();
    expect([r.owners, r.allow, r.deny, r.open]).toEqual([[], [], [], false]);
    expect(r.maxTurnsPerHour).toBe(30);
    expect(r.turnTimeoutMs).toBe(45_000);
  });

  it("a messaging route keeps them", () => {
    const r = routeFromDraft(draftFromRoute(busy), busy, "telegram");
    expect(r.match).toMatchObject({ conversation: "dm", when: { _tag: "Mention" } });
    expect(r.maxTurnsPerSenderPerHour).toBe(9);
    expect(r.failureNotice).toBe(false);
  });

  it("hidden fields never block a webhook save, and the agent is required without messaging words", () => {
    const d = { ...newDraft("ch-1", "", "webhook"), id: "deploy-hook", when: "command" as const, maxTurnsPerSenderPerHour: "nope" };
    expect(draftProblems(d, true, "webhook")).toEqual(["Pick the agent that runs when the webhook is called."]);
    expect(draftProblems({ ...d, agentId: "a1" }, true, "webhook")).toEqual([]);
    expect(draftProblems({ ...d, agentId: "a1", maxTurnsPerHour: "-1", turnTimeoutSec: "0" }, true, "webhook")).toEqual(["Runs per hour must be a number above zero.", "Run limit must be 1 second or more."]);
  });
});
