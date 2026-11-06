import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { chatRouter, parsePosture } from "../api/chat.js";
import type { ChatSessionService } from "../services/chat-session-service.js";

type Posture = "execute" | "plan" | undefined;

describe("chat route posture pass-through", () => {
  const seen: { chat: Posture[]; stream: Posture[] } = { chat: [], stream: [] };
  let paused = false;
  const stub = {
    approvals: { hasPending: () => paused },
    chat: async (_id: string, _m: string, opts?: { posture?: "execute" | "plan" }) => {
      seen.chat.push(opts?.posture);
      return { reply: "ok", tokensUsed: 1 };
    },
    chatStream: async function* (_id: string, _m: string, _s: AbortSignal | undefined, posture?: "execute" | "plan") {
      seen.stream.push(posture);
      yield { _tag: "StreamCompleted" as const, output: "ok", metadata: { tokensUsed: 0, cost: 0, stepsCount: 0, duration: 0 } };
    },
  } as unknown as ChatSessionService;
  const post = (path: string, body: unknown) =>
    new Elysia().use(chatRouter(stub)).handle(
      new Request(`http://localhost/api/chat/sessions/s1/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("parsePosture accepts execute|plan|absent and rejects the rest", () => {
    expect(parsePosture(undefined)).toBeUndefined();
    expect(parsePosture("plan")).toBe("plan");
    expect(parsePosture("execute")).toBe("execute");
    expect(parsePosture("PLAN")).toBeNull();
    expect(parsePosture("")).toBeNull();
  });

  it("passes posture 'plan' to svc.chat and svc.chatStream", async () => {
    seen.chat.length = 0;
    seen.stream.length = 0;
    expect((await post("chat", { message: "x", posture: "plan" })).status).toBe(200);
    await (await post("chat/stream", { message: "x", posture: "plan" })).text();
    expect(seen.chat).toEqual(["plan"]);
    expect(seen.stream).toEqual(["plan"]);
  });

  it("omits posture when absent", async () => {
    seen.chat.length = 0;
    seen.stream.length = 0;
    await post("chat", { message: "x" });
    await (await post("chat/stream", { message: "x" })).text();
    expect(seen.chat).toEqual([undefined]);
    expect(seen.stream).toEqual([undefined]);
  });

  it("a turn awaiting approval makes the stream route answer 409 before opening a stream", async () => {
    seen.stream.length = 0;
    paused = true;
    try {
      const res = await post("chat/stream", { message: "x" });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain("awaiting approval");
      expect(seen.stream).toEqual([]);
    } finally {
      paused = false;
    }
  });

  it("the interaction route forwards the answer to approvals.respond and maps outcomes", async () => {
    const responded: Array<[string, string, unknown]> = [];
    const svc = {
      approvals: {
        respond: async (sessionId: string, runId: string, value: unknown) => {
          responded.push([sessionId, runId, value]);
          return runId === "missing"
            ? { ok: false, code: "not-found", message: "gone" }
            : { ok: true, status: "completed", reply: "done", success: true };
        },
        dismiss: async () => true,
      },
    } as unknown as ChatSessionService;
    const hit = (path: string, body: unknown) =>
      new Elysia().use(chatRouter(svc)).handle(
        new Request(`http://localhost/api/chat/sessions/s1/interactions/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const ok = await hit("r1/respond", { value: { colour: "blue" } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, status: "completed", reply: "done" });
    expect(responded).toEqual([["s1", "r1", { colour: "blue" }]]);
    expect((await hit("missing/respond", { value: "x" })).status).toBe(404);
    expect((await hit("r1/respond", {})).status).toBe(400);
    expect((await hit("r1/shrug", { value: 1 })).status).toBe(400);
    expect((await hit("r1/dismiss", {})).status).toBe(200);
    expect(responded).toHaveLength(2);
  });

  it("rejects unknown posture with 400 and never reaches the service", async () => {
    seen.chat.length = 0;
    seen.stream.length = 0;
    expect((await post("chat", { message: "x", posture: "yolo" })).status).toBe(400);
    expect((await post("chat/stream", { message: "x", posture: "yolo" })).status).toBe(400);
    expect(seen.chat).toEqual([]);
    expect(seen.stream).toEqual([]);
  });
});
