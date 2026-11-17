// Chat Continue over HTTP (api/loop-stop-routes.ts): the routes' status codes, and the pin that
// Continue rides the builder's own Durable runs setting (no Cortex default).
import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { getChatSession } from "../db/chat-queries.js";
import { openDatabase } from "../db/schema.js";
import { chatResumeRoute } from "../api/loop-stop-routes.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import type { BuildCortexAgentParams } from "../services/build-cortex-agent.js";
import { rmDbFiles, rmTmpDirs, tmpDbPath, tmpDir } from "./helpers/tmp-db.js";

const path = tmpDbPath("chat-resume-route");
const db = openDatabase(path);
const svc = new ChatSessionService(db);
afterAll(() => {
  db.close();
  rmDbFiles(path);
  rmTmpDirs();
});

const app = new Elysia().use(chatResumeRoute(svc));
const send = (method: string, url: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${url}`, {
      method,
      ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    }),
  );

type ParamsOf = (sessionId: string, cfg: Record<string, unknown>, stable: string | undefined) => BuildCortexAgentParams;
const paramsOf = (sessionId: string): BuildCortexAgentParams => {
  const row = getChatSession(db, sessionId)!;
  return (svc as unknown as { buildChatAgentParams: ParamsOf }).buildChatAgentParams(sessionId, row.agentConfig, row.stableAgentId);
};

describe("chat Continue routes", () => {
  it("answers 404 for an unknown session and an empty list for a session with nothing stopped", async () => {
    expect((await send("GET", "/api/chat/sessions/nope/resumable")).status).toBe(404);
    expect((await send("POST", "/api/chat/sessions/nope/resume/r1", {})).status).toBe(404);
    const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true, durableRuns: { enabled: true, dir: tmpDir("chat-resume-route") } } });
    const res = await send("GET", `/api/chat/sessions/${id}/resumable`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [] });
  });

  it("answers 400 to a bad iteration grant and 409 (plain wording) to a run that is not loop-stopped", async () => {
    const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true, durableRuns: { enabled: true, dir: tmpDir("chat-resume-route2") } } });
    const bad = await send("POST", `/api/chat/sessions/${id}/resume/r1`, { extraIterations: 0 });
    expect(bad.status).toBe(400);
    const notStopped = await send("POST", `/api/chat/sessions/${id}/resume/r1`, { note: "go on" });
    expect(notStopped.status).toBe(409);
    expect(((await notStopped.json()) as { error: string }).error).toContain("Send a new message instead");
  });
});

describe("chat Stop and Pause routes", () => {
  it("answer with the interrupt outcome; a session with nothing running is not-live and stopped:false", async () => {
    const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true, durableRuns: { enabled: true, dir: tmpDir("chat-interrupt-route") } } });
    for (const action of ["stop", "pause"]) {
      const res = await send("POST", `/api/chat/sessions/${id}/chat/${action}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ stopped: false, persisted: false, outcome: "not-live" });
    }
  });
});

describe("Continue follows the builder's Durable runs setting", () => {
  it("chat is not durable unless the setting is on (live rails stay the default), and a set value reaches the build", async () => {
    const plain = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
    expect(paramsOf(plain).durableRuns).toBeUndefined();
    const own = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true, durableRuns: { enabled: true, checkpointEvery: 3 } } });
    expect(paramsOf(own).durableRuns).toEqual({ enabled: true, checkpointEvery: 3 });
  });

  it("a session with no durable store lists nothing to continue", async () => {
    const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
    expect(await (await send("GET", `/api/chat/sessions/${id}/resumable`)).json()).toEqual({ runs: [] });
  });
});
