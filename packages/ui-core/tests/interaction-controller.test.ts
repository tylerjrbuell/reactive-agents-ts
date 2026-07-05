import { describe, expect, test } from "bun:test";
import { respondToInteraction, decideApproval } from "../src/interaction/controller.js";
import type { FetchLike } from "../src/stream/connect.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("respondToInteraction", () => {
  test("POSTs the interaction payload and returns the server result", async () => {
    let captured: { url: string; body: unknown; method: string } | null = null;
    const fetchImpl: FetchLike = async (input, init) => {
      captured = { url: String(input), method: init?.method ?? "GET", body: JSON.parse(String(init?.body)) };
      return jsonResponse({ success: true, output: "resumed" });
    };
    const out = await respondToInteraction({
      endpoint: "/api/interaction",
      runId: "r1",
      interactionId: "i1",
      value: { choice: "a" },
      fetchImpl,
    });
    expect(out).toEqual({ success: true, output: "resumed" });
    expect(captured).toEqual({
      url: "/api/interaction",
      method: "POST",
      body: { runId: "r1", interactionId: "i1", value: { choice: "a" } },
    });
  });

  test("returns an error result (never throws) on non-ok", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({}, 409);
    const out = await respondToInteraction({
      endpoint: "/api/interaction",
      runId: "r1",
      interactionId: "i1",
      value: 1,
      fetchImpl,
    });
    expect(out.success).toBe(false);
    expect(out.output).toBe("");
    expect(out.error).toContain("409");
  });
});

describe("decideApproval", () => {
  test("POSTs the approval decision payload", async () => {
    let captured: unknown = null;
    const fetchImpl: FetchLike = async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ success: true, output: "approved" });
    };
    const out = await decideApproval({
      endpoint: "/api/approval",
      runId: "r1",
      gateId: "g1",
      decision: "approve",
      fetchImpl,
    });
    expect(out).toEqual({ success: true, output: "approved" });
    expect(captured).toEqual({ runId: "r1", gateId: "g1", decision: "approve", reason: undefined });
  });

  test("carries a deny reason and returns an error result on network failure", async () => {
    const denyImpl: FetchLike = async (_input, init) => {
      expect(JSON.parse(String(init?.body)).reason).toBe("too risky");
      return jsonResponse({ success: true, output: "denied" });
    };
    const denied = await decideApproval({
      endpoint: "/api/approval",
      runId: "r1",
      gateId: "g1",
      decision: "deny",
      reason: "too risky",
      fetchImpl: denyImpl,
    });
    expect(denied.output).toBe("denied");

    const throwImpl: FetchLike = async () => {
      throw new Error("refused");
    };
    const failed = await decideApproval({
      endpoint: "/api/approval",
      runId: "r1",
      gateId: "g1",
      decision: "approve",
      fetchImpl: throwImpl,
    });
    expect(failed.success).toBe(false);
    expect(failed.error).toBe("refused");
  });
});
