// A failed hub turn shows a human reason in the activity feed: a timeout names its limit in seconds
// (the router's bare `turn_timeout` was the whole line before).
import { describe, expect, it } from "bun:test";
import { HubActivityTracker } from "../services/channel-hub-activity.js";
import { failureReasonText } from "../services/channel-hub-failure.js";

describe("failureReasonText", () => {
  it("names the limit for a timeout, default 120s", () => {
    expect(failureReasonText("turn_timeout", 45_000)).toBe("turn timed out after 45s (the route's turn limit)");
    expect(failureReasonText("turn_timeout")).toBe("turn timed out after 120s (the route's turn limit)");
  });
  it("explains the other router reasons and passes unknown ones through", () => {
    expect(failureReasonText("turn_failed")).toBe("turn failed");
    expect(failureReasonText(undefined)).toBe("turn failed");
    expect(failureReasonText("resolve_failed")).toBe("could not open the agent for this route");
    expect(failureReasonText("something_else")).toBe("something_else");
  });
});

describe("activity feed: failed turns", () => {
  it("a timeout line carries the route's own limit", () => {
    const t = new HubActivityTracker(() => 1, (id) => (id === "r" ? 30_000 : undefined));
    t.observe({ _tag: "ChannelTurnCompleted", routeId: "r", role: "owner", ok: false, reason: "turn_timeout" });
    const [a] = t.snapshot();
    expect(a?.kind).toBe("failed");
    expect(a?.detail).toBe("turn timed out after 30s (the route's turn limit)");
  });
  it("falls back to the default limit and keeps a reported cause", () => {
    const t = new HubActivityTracker(() => 1);
    t.noteCause("x", "model unreachable");
    t.observe({ _tag: "ChannelTurnCompleted", routeId: "x", role: "sender", ok: false, reason: "turn_failed" });
    t.observe({ _tag: "ChannelTurnCompleted", routeId: "y", role: "sender", ok: false, reason: "turn_timeout" });
    const [y, x] = t.snapshot();
    expect(x?.detail).toBe("turn failed: model unreachable");
    expect(y?.detail).toBe("turn timed out after 120s (the route's turn limit)");
  });
});
