// packages/runtime/tests/server/endpoints-authz.test.ts
//
// GAP-11 regression: interaction/approval/attach endpoints must gate on
// resolved identity == run owner when an `identify` resolver is configured.
// Without an `identify` resolver, behavior stays open (backward-compatible —
// verified by existing endpoints.test.ts cases that call these factories with
// only an `agent` argument).
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ReactiveAgentBuilder } from "../../src/builder.js";
import {
  createAgentEndpoint,
  createApprovalEndpoint,
  createInteractionEndpoint,
} from "../../src/server/endpoints.js";

const asUser = (userId: string) => async () => ({ userId });
const asNone = async () => null;

const sseEvents = async (
  res: Response,
): Promise<Array<{ e: { _tag: string } & Record<string, unknown> }>> => {
  const text = await res.text();
  const out: Array<{ e: { _tag: string } & Record<string, unknown> }> = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) out.push({ e: JSON.parse(line.slice(6)) });
  }
  return out;
};

const postJson = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function riskyToolDef() {
  return {
    name: "risky-tool",
    description: "A tool that requires approval",
    parameters: [
      { name: "input", type: "string" as const, description: "Input", required: true },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

describe("endpoint owner-authorization (GAP-11)", () => {
  test("interaction endpoint: wrong identity gets 403 and interaction stays pending; owner succeeds; unauthenticated gets 403", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-authz-"));
    const agent = await new ReactiveAgentBuilder()
      .withName("endpoint-interaction-authz")
      .withProvider("test")
      .withReasoning()
      .withTestScenario([
        {
          toolCall: {
            name: "request_user_input",
            args: { kind: "confirmation", prompt: "Proceed?", schema: {} },
          },
        },
        { match: "yes", text: "Confirmed. Done." },
        { text: "fallback" },
      ])
      .withDurableRuns({ dir })
      .withUserInteraction()
      .build();

    // Start the run AS u1 so the durable row is owned by u1.
    const run = await createAgentEndpoint(agent, { limits: false, identify: asUser("u1") })(
      postJson("http://x/api/agent", { prompt: "do the thing" }),
    );
    const events = await sseEvents(run);
    const ir = events.find((x) => x.e._tag === "InteractionRequested");
    expect(ir).toBeDefined();
    const { runId, interactionId } = ir!.e as unknown as { runId: string; interactionId: string };

    // u2 (wrong owner) attempts to answer → 403, interaction stays pending.
    const asU2 = createInteractionEndpoint(agent, { identify: asUser("u2") });
    const forbidden = await asU2(postJson("http://x/api/interaction", { runId, interactionId, value: "yes" }));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
    const stillPending = await agent.listPendingInteractions();
    expect(stillPending.length).toBe(1);

    // Unauthenticated (identify resolves null) → 403 unauthorized.
    const asAnon = createInteractionEndpoint(agent, { identify: asNone });
    const unauthorized = await asAnon(
      postJson("http://x/api/interaction", { runId, interactionId, value: "yes" }),
    );
    expect(unauthorized.status).toBe(403);
    expect(await unauthorized.json()).toEqual({ error: "unauthorized" });
    const stillPending2 = await agent.listPendingInteractions();
    expect(stillPending2.length).toBe(1);

    // u1 (owner) succeeds.
    const asU1 = createInteractionEndpoint(agent, { identify: asUser("u1") });
    const ok = await asU1(postJson("http://x/api/interaction", { runId, interactionId, value: "yes" }));
    expect(ok.status).toBe(200);
    const result = (await ok.json()) as { success: boolean; output: string };
    expect(result.success).toBe(true);
    expect(result.output).toContain("Confirmed");
    const cleared = await agent.listPendingInteractions();
    expect(cleared.length).toBe(0);
  }, 30000);

  test("approval endpoint: wrong identity gets 403 and run stays paused; owner approve succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-authz-approval-"));
    const agent = await new ReactiveAgentBuilder()
      .withName("endpoint-approval-authz")
      .withProvider("test")
      .withSystemPrompt("You are precise.")
      .withTestScenario([
        { toolCall: { name: "risky-tool", args: { input: "go" } } },
        { text: "APPROVED FINAL: done" },
      ])
      .withTools({
        tools: [{ definition: riskyToolDef(), handler: () => Effect.succeed("ran") }],
      })
      .withReasoning()
      .withRequiredTools({ adaptive: false })
      .withMaxIterations(6)
      .withDurableRuns({ dir })
      .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
      .build();

    // Start the run AS u1 so the durable row is owned by u1.
    const run = await createAgentEndpoint(agent, { limits: false, identify: asUser("u1") })(
      postJson("http://x/api/agent", { prompt: "compute the answer" }),
    );
    const events = await sseEvents(run);
    const ar = events.find((x) => x.e._tag === "ApprovalRequested");
    expect(ar).toBeDefined();
    const { runId } = ar!.e as unknown as { runId: string };

    // u2 (wrong owner) attempts to approve → 403, run stays paused.
    const asU2 = createApprovalEndpoint(agent, { identify: asUser("u2") });
    const forbidden = await asU2(postJson("http://x/api/approval", { runId, decision: "approve" }));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
    const stillPending = await agent.listPendingApprovals();
    expect(stillPending.map((p) => p.runId)).toContain(runId);

    // u1 (owner) approves successfully.
    const asU1 = createApprovalEndpoint(agent, { identify: asUser("u1") });
    const ok = await asU1(postJson("http://x/api/approval", { runId, decision: "approve" }));
    expect(ok.status).toBe(200);
    const result = (await ok.json()) as { success: boolean; output: string };
    expect(result.success).toBe(true);
    expect(result.output).toContain("APPROVED FINAL: done");
    const after = await agent.listPendingApprovals();
    expect(after.map((p) => p.runId)).not.toContain(runId);
  }, 30000);
});
