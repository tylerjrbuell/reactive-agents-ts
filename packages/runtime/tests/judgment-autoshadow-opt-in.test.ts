// Run: bun test packages/runtime/tests/judgment-autoshadow-opt-in.test.ts --timeout 20000
//
// Wave 7.1 auto-shadow is OPT-IN (2026-11-18). Pins, against a local fake
// Ollama (never the real 11434):
//   1. default build() makes no /api/tags call and wires no JudgmentService;
//   2. opt-in with the shadow model installed wires the service;
//   3. opt-in with the model absent wires nothing.
// Plus the env surface: REACTIVE_AGENTS_AUTO_SHADOW=1 opts in,
// REACTIVE_AGENTS_NO_AUTO_SHADOW=1 and .withJudgment(false) both win over it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { JudgmentService } from "@reactive-agents/judgment";
import { ReactiveAgents } from "../src/index.js";

const ENV_KEYS = [
  "REACTIVE_AGENTS_NO_AUTO_SHADOW",
  "REACTIVE_AGENTS_AUTO_SHADOW",
  "REACTIVE_AGENTS_SHADOW_DB",
  "OLLAMA_ENDPOINT",
  "OLLAMA_HOST",
  "OLLAMA_BASE",
] as const;
const savedEnv: Record<string, string | undefined> = {};

let server: Server;
let endpoint: string;
let tagCalls = 0;
let installed: string[] = [];
let shadowDir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/api/tags") {
      tagCalls++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: installed.map((name) => ({ name, model: name })) }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.OLLAMA_ENDPOINT = endpoint;
  shadowDir = mkdtempSync(join(tmpdir(), "ra-autoshadow-optin-"));
  process.env.REACTIVE_AGENTS_SHADOW_DB = join(shadowDir, "shadow.db");
  tagCalls = 0;
  installed = ["nimble:latest", "qwen3:4b"];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k] as string;
  }
  rmSync(shadowDir, { recursive: true, force: true });
});

const base = () => ReactiveAgents.create().withTestScenario([{ text: "FINAL ANSWER: ok" }]);

type Agent = Awaited<ReturnType<ReturnType<typeof base>["build"]>>;

const hasJudgment = async (agent: Agent): Promise<boolean> => {
  const opt = await agent.runtime.runPromise(Effect.serviceOption(JudgmentService));
  return opt._tag === "Some";
};

const buildAndInspect = async (builder: ReturnType<typeof base>) => {
  const agent = await builder.build();
  try {
    return { wired: await hasJudgment(agent), agent };
  } finally {
    await agent.dispose();
  }
};

describe("auto-shadow is opt-in", () => {
  it("default build: no /api/tags call, no JudgmentService (reachable Ollama, model installed)", async () => {
    const { wired } = await buildAndInspect(base());
    expect(tagCalls).toBe(0);
    expect(wired).toBe(false);
  });

  it("withJudgment({ shadow: true }) with the model installed wires the service", async () => {
    const { wired } = await buildAndInspect(base().withJudgment({ shadow: true }));
    expect(tagCalls).toBe(1);
    expect(wired).toBe(true);
  });

  it("withJudgment({ shadow: true }) with the model absent wires nothing", async () => {
    installed = ["qwen3:4b"];
    const { wired } = await buildAndInspect(base().withJudgment({ shadow: true }));
    expect(tagCalls).toBe(1);
    expect(wired).toBe(false);
  });

  it("a configured shadow model must be the one installed", async () => {
    const present = await buildAndInspect(base().withJudgment({ shadow: true, model: "qwen3:4b" }));
    expect(present.wired).toBe(true);
    const absent = await buildAndInspect(base().withJudgment({ shadow: true, model: "clef" }));
    expect(absent.wired).toBe(false);
  });

  it("auto-shadow keeps agent.judge() unavailable (observation only)", async () => {
    const agent = await base().withJudgment({ shadow: true }).build();
    try {
      expect(await hasJudgment(agent)).toBe(true);
      await expect(
        agent.judge({ state: {}, questions: { q: { type: "noul", instructions: "ok?" } } }),
      ).rejects.toThrow(/withJudgment/);
    } finally {
      await agent.dispose();
    }
  });

  it("REACTIVE_AGENTS_AUTO_SHADOW=1 opts in without code", async () => {
    process.env.REACTIVE_AGENTS_AUTO_SHADOW = "1";
    const { wired } = await buildAndInspect(base());
    expect(tagCalls).toBe(1);
    expect(wired).toBe(true);
  });

  it("REACTIVE_AGENTS_NO_AUTO_SHADOW=1 wins over every opt-in", async () => {
    process.env.REACTIVE_AGENTS_AUTO_SHADOW = "1";
    process.env.REACTIVE_AGENTS_NO_AUTO_SHADOW = "1";
    const { wired } = await buildAndInspect(base().withJudgment({ shadow: true }));
    expect(tagCalls).toBe(0);
    expect(wired).toBe(false);
  });

  it("withJudgment(false) wins over the env opt-in", async () => {
    process.env.REACTIVE_AGENTS_AUTO_SHADOW = "1";
    const { wired } = await buildAndInspect(base().withJudgment(false));
    expect(tagCalls).toBe(0);
    expect(wired).toBe(false);
  });

  it("explicit withJudgment() after shadow wins (last call) and never probes", async () => {
    const { wired } = await buildAndInspect(
      base().withJudgment({ shadow: true }).withJudgment({ backend: "llm" }),
    );
    expect(tagCalls).toBe(0);
    expect(wired).toBe(true);
  });

  it("shadow form rejects explicit-judge fields at compile time", () => {
    // @ts-expect-error — `shadow: true` is observation-only; backend belongs to the explicit form
    base().withJudgment({ shadow: true, backend: "jev" });
    expect(true).toBe(true);
  });
});
