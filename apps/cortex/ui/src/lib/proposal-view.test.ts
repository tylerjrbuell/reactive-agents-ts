import { describe, expect, test } from "bun:test";
import { agentControlEnabled, argChips, effectsOf, proposalView, shouldPollProposals, toggleAgentControlPatch, type ProposalWire } from "./proposal-view.js";

const P: ProposalWire = { id: "p1", action: "start-loop", args: { spec: "1h", prompt: "check X" }, summary: "Run 'check X' every hour", status: "proposed", createdAt: 1 };

describe("proposal view", () => {
  test("proposed is pending with chips", () => {
    const v = proposalView(P);
    expect(v.pending).toBe(true);
    expect(v.tone).toBe("pending");
    expect(v.chips).toEqual([{ key: "spec", value: "1h" }, { key: "prompt", value: "check X" }]);
  });
  test("applied / dismissed are resolved", () => {
    expect(proposalView({ ...P, status: "applied" })).toMatchObject({ pending: false, statusLabel: "Applied", tone: "ok" });
    expect(proposalView({ ...P, status: "dismissed" })).toMatchObject({ pending: false, statusLabel: "Dismissed", tone: "muted" });
  });
  test("failed apply stays pending and shows the error", () => {
    expect(proposalView({ ...P, error: "bad cron" })).toMatchObject({ pending: true, tone: "error", error: "bad cron" });
    expect(proposalView({ ...P, status: "applied", error: "stale" }).error).toBeNull();
  });
  test("chips skip empty values and clip long ones", () => {
    const chips = argChips({ a: "", b: null, c: 5, d: "x".repeat(100), e: { k: 1 } });
    expect(chips.map((c) => c.key)).toEqual(["c", "d", "e"]);
    expect(chips[1]!.value.length).toBe(40);
    expect(chips[2]!.value).toBe('{"k":1}');
  });
  test("poll gate", () => {
    expect(shouldPollProposals([], false)).toBe(false);
    expect(shouldPollProposals([], true)).toBe(true);
    expect(shouldPollProposals([P], false)).toBe(true);
    expect(shouldPollProposals([{ ...P, status: "applied" }, { ...P, id: "2", status: "dismissed" }], false)).toBe(false);
  });
  test("effects by action", () => {
    expect(effectsOf("start-goal")).toEqual(["goal"]);
    expect(effectsOf("start-loop")).toEqual(["schedules"]);
    for (const a of ["set-loop", "stop-loop", "set-schedule"]) expect(effectsOf(a)).toEqual(["schedules"]);
    for (const a of ["set-model", "set-provider", "set-thinking", "pin-skill", "add-doc"]) expect(effectsOf(a)).toEqual(["config"]);
    expect(effectsOf("cancel-goal")).toEqual(["goal"]);
    expect(effectsOf("set-model")).toEqual(["config"]);
    expect(effectsOf("mystery")).toEqual(["goal", "schedules", "config"]);
  });
  test("agentControl flag defaults off and toggles", () => {
    expect(agentControlEnabled({})).toBe(false);
    expect(agentControlEnabled({ agentControl: "yes" })).toBe(false);
    expect(toggleAgentControlPatch({})).toEqual({ agentControl: true });
    expect(toggleAgentControlPatch({ agentControl: true })).toEqual({ agentControl: false });
  });
});
