import { describe, expect, test } from "bun:test";
import {
  AGENT_CONTROL_GROUPS,
  agentControlSummary,
  autoApplyControlGroups,
  enabledControlGroups,
  toggleAutoApplyPatch,
  toggleControlGroupPatch,
} from "./agent-control.js";

describe("agent control switches", () => {
  test("every group defaults off", () => {
    expect(enabledControlGroups({})).toEqual([]);
    expect(autoApplyControlGroups({})).toEqual([]);
    expect(agentControlSummary({})).toBe("Off");
    expect(agentControlSummary({ agentControl: true })).toBe("On");
  });

  test("ignores unknown group ids and counts the real ones", () => {
    const cfg = { agentControl: true, agentControlGroups: ["tools", "bogus", "limits"] };
    expect(enabledControlGroups(cfg)).toEqual(["tools", "limits"]);
    expect(agentControlSummary(cfg)).toBe("On · 2 more");
  });

  test("switching a group off also drops its auto-apply", () => {
    const cfg = { agentControlGroups: ["tools", "limits"], agentControlAutoApply: ["tools", "limits"] };
    expect(toggleControlGroupPatch(cfg, "tools")).toEqual({ agentControlGroups: ["limits"], agentControlAutoApply: ["limits"] });
    expect(toggleControlGroupPatch({}, "tools")).toEqual({ agentControlGroups: ["tools"], agentControlAutoApply: [] });
  });

  test("auto-apply toggles per group", () => {
    expect(toggleAutoApplyPatch({ agentControlAutoApply: [] }, "tools")).toEqual({ agentControlAutoApply: ["tools"] });
    expect(toggleAutoApplyPatch({ agentControlAutoApply: ["tools"] }, "tools")).toEqual({ agentControlAutoApply: [] });
  });

  test("only groups with something to tighten offer auto-apply", () => {
    expect(AGENT_CONTROL_GROUPS.filter((g) => g.canAutoApply).map((g) => g.id)).toEqual(["tools", "limits", "memory", "approvals"]);
  });
});
