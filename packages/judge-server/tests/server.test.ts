// Run: bun test packages/judge-server/tests/server.test.ts --timeout 15000
import { describe, it, expect, afterAll } from "bun:test";

let server: { stop: (force?: boolean) => void; port: number } | undefined;

afterAll(async () => {
  // Mandatory per .agents/skills/agent-tdd/SKILL.md — dangling Bun.serve hangs the process forever.
  await server?.stop(true);
});

describe("judge HTTP server", () => {
  it("starts on an OS-assigned port and exposes /version", async () => {
    const { startServer } = await import("../src/index.js");
    server = await startServer({
      port: 0,
      judgeModelSha: "test-judge-sha",
      judgeCodeSha: "test-code-sha",
      judgeLayer: "stub",
    });
    expect(server.port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/version`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { judgeModelSha: string; judgeCodeSha: string };
    expect(body.judgeModelSha).toBe("test-judge-sha");
    expect(body.judgeCodeSha).toBe("test-code-sha");
  }, 15000);

  it("returns 200 + JudgeResponse on POST /judge with a valid request", async () => {
    if (!server) throw new Error("server not started");
    const res = await fetch(`http://127.0.0.1:${server.port}/judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "t-001",
        sutResponse: "Paris is the capital of France.",
        taskInput: { question: "Capital of France?" },
        sutModel: "claude-sonnet-4-6",
        runId: "r-1",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      taskId: string;
      reproducibility: { judgeModelSha: string; judgeCodeSha: string };
    };
    expect(body.taskId).toBe("t-001");
    expect(body.reproducibility.judgeModelSha).toBe("test-judge-sha");
    expect(body.reproducibility.judgeCodeSha).toBe("test-code-sha");
  }, 15000);

  it("returns 400 on POST /judge with an invalid request shape", async () => {
    if (!server) throw new Error("server not started");
    const res = await fetch(`http://127.0.0.1:${server.port}/judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ broken: true }),
    });
    expect(res.status).toBe(400);
  }, 15000);

  it("returns 405 on GET /judge (POST only)", async () => {
    if (!server) throw new Error("server not started");
    const res = await fetch(`http://127.0.0.1:${server.port}/judge`);
    expect(res.status).toBe(405);
  }, 15000);

  it("returns 404 on GET /unknown-route", async () => {
    if (!server) throw new Error("server not started");
    const res = await fetch(`http://127.0.0.1:${server.port}/unknown-route`);
    expect(res.status).toBe(404);
  }, 15000);
});
