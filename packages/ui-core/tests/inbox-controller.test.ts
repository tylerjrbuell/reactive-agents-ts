import { describe, expect, test } from "bun:test";
import { fetchInbox, type InboxRun } from "../src/inbox/controller.js";
import type { FetchLike } from "../src/stream/connect.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("fetchInbox", () => {
  test("GETs the endpoint and returns the run array", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const rows: InboxRun[] = [{ runId: "r1", task: "t", status: "completed", updatedAt: 5 }];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return jsonResponse(rows);
    };
    const out = await fetchInbox({ endpoint: "/api/inbox", fetchImpl });
    expect(out).toEqual(rows);
    expect(calls[0]).toEqual({ url: "/api/inbox", method: "GET" });
  });

  test("throws on non-ok status", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: "nope" }, 500);
    await expect(fetchInbox({ endpoint: "/api/inbox", fetchImpl })).rejects.toThrow("HTTP 500");
  });
});
