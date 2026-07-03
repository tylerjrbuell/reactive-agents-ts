// packages/svelte/tests/interactions.test.ts
import { describe, expect, test } from "bun:test";
import type { FetchLike } from "@reactive-agents/ui-core";
import { createInteractions } from "../src/interactions.js";

describe("createInteractions", () => {
  test("respond posts {runId,interactionId,value} and returns success", async () => {
    let body: unknown;
    const fetchImpl: FetchLike = async (_i, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ success: true, output: "done" }), { status: 200 });
    };
    const store = createInteractions({ interactionEndpoint: "/api/interaction", fetchImpl });
    const res = await store.respond("r1", "i1", "blue");
    expect(res.success).toBe(true);
    expect(body).toEqual({ runId: "r1", interactionId: "i1", value: "blue" });
  });
});
