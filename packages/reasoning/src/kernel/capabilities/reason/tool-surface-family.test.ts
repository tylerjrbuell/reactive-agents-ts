// Run: bun test packages/reasoning/src/kernel/capabilities/reason/tool-surface-family.test.ts
//
// Turn-0 lazy disclosure ships keyword matches only, never a whole tool family.
//
// Ablation 2026-11-10 (family-disclosure-compact-facts, ledger 41/42): a
// family disclosure (every `umami_*` tool the task named, capped at 12) was
// REJECTED. grok-4 scored -30pp: with 13 tools on turn 0 it listed the tools
// back and asked the user what to do in 10 of 10 runs. The mechanism was
// deleted (wire-or-delete). This pins the restored behavior: the unclassified
// umami task sees the keyword match (`umami_get_websites`) and
// `discover-tools`, and the rest stays behind disclosure.
//
// RED-ON-CUT: union every task-named `umami_*` tool into `heuristicRelevant`
// in `resolveToolSurface` and the first cell fails.
import { describe, it, expect } from "bun:test";
import { resolveToolSurface } from "./tool-surface.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { resolveHarnessConfig } from "../../../harness-config.js";

const mk = (name: string, description: string): ToolSchema => ({ name, description, parameters: [] });

const UMAMI: readonly ToolSchema[] = [
  ["get_websites", "List websites tracked in Umami."],
  ["get_website", "Get one website's settings by websiteId."],
  ["get_website_stats", "Get summary stats (pageviews, visitors, visits, bounces, totaltime) for a website."],
  ["get_pageviews", "Get pageviews and sessions time series for a website."],
  ["get_metrics", "Get ranked metrics for a website."],
  ["get_active", "Get the number of active visitors right now."],
  ["get_events", "List custom events for a website."],
  ["get_sessions", "List recent sessions for a website."],
  ["get_realtime", "Realtime pageview stream for the last 30 minutes."],
  ["get_reports", "List saved reports."],
  ["create_report", "Create a saved report."],
  ["get_teams", "List teams."],
  ["get_users", "List users."],
  ["create_website", "Add a website to track."],
  ["update_website", "Update website settings."],
  ["delete_website", "Delete a website."],
  ["reset_website", "Reset a website's data."],
  ["get_share_url", "Get a public share URL for a website."],
  ["get_event_data", "Get properties of a custom event."],
  ["get_utm", "UTM campaign breakdown."],
].map(([n, d]) => mk(`umami_${n}`, d ?? ""));

const OTHERS: readonly ToolSchema[] = [
  mk("slack_post_message", "Post a message to a Slack channel."),
  mk("slack_list_channels", "List Slack channels in the workspace."),
  mk("get_time", "Get the current time."),
  mk("discover-tools", "List tools available beyond the current surface"),
];

const base = {
  augmented: [...UMAMI, ...OTHERS],
  finalAnswerSchema: mk("final-answer", "Emit the final answer"),
  lazyMode: true,
  pressureCritical: false,
  hasClassification: false,
  requiredTools: [] as readonly string[],
  relevantTools: [] as readonly string[],
  allowedTools: [] as readonly string[],
  toolsUsed: [] as readonly string[],
  discovered: [] as readonly string[],
  gateBlockedTools: [] as readonly string[],
  missingRequiredTools: [] as readonly string[],
  pruneMinTools: 15,
  harness: resolveHarnessConfig(),
};

const visible = (r: { visible: readonly ToolSchema[] }) => r.visible.map((t) => t.name);
const TASK = "Help me explore analytics for my docs site in umami.";

describe("turn-0 lazy disclosure does not widen to a named tool family", () => {
  it("the umami task sees the keyword match and discover-tools, not the family", () => {
    const r = resolveToolSurface({ ...base, taskText: TASK });
    const umami = visible(r).filter((n) => n.startsWith("umami_"));
    expect(umami).toEqual(["umami_get_websites"]);
    expect(visible(r)).toContain("discover-tools");
    expect(r.reasons.get("umami_get_websites")).toBe("visible: heuristic-relevant (unclassified run)");
    expect(r.reasons.get("umami_get_metrics")).toContain("hidden: lazy-undisclosed");
  });

  it("no reason ever names a tool family", () => {
    const r = resolveToolSurface({ ...base, taskText: TASK });
    for (const why of r.reasons.values()) expect(why).not.toContain("family");
  });

  it("a classified run shows only its classified tools", () => {
    const r = resolveToolSurface({
      ...base,
      taskText: TASK,
      hasClassification: true,
      relevantTools: ["umami_get_website_stats"],
    });
    expect(visible(r).filter((n) => n.startsWith("umami_"))).toEqual(["umami_get_website_stats"]);
  });
});
