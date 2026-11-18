// Run: bun test packages/runtime/tests/judgment-autoshadow-opt-out.test.ts --timeout 20000
//
// `.withJudgment(false)` is the in-code off switch for the Wave 7.1
// auto-shadow probe. Pins: opt-out never touches the network (no Ollama
// /api/tags probe) and never wires a judgment service; the default never
// probes either (opt-in since 2026-11-18); the opt-out env var wins.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/index.js";

const ENV_KEYS = ["REACTIVE_AGENTS_NO_AUTO_SHADOW", "REACTIVE_AGENTS_SHADOW_DB", "OLLAMA_ENDPOINT"] as const;
const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let probed: string[] = [];
let shadowDb: string;

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  delete process.env.REACTIVE_AGENTS_NO_AUTO_SHADOW;
  process.env.OLLAMA_ENDPOINT = "http://ollama.invalid:11434";
  shadowDb = join(mkdtempSync(join(tmpdir(), "ra-autoshadow-")), "shadow.db");
  process.env.REACTIVE_AGENTS_SHADOW_DB = shadowDb;
  probed = [];
  // Stub: Ollama "answers" /api/tags; record every probe.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/tags")) {
      probed.push(url);
      return new Response("{}", { status: 200 });
    }
    return realFetch(input);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k] as string;
  }
});

const base = () => ReactiveAgents.create().withTestScenario([{ text: "FINAL ANSWER: ok" }]);

describe("withJudgment(false) opts out of auto-shadow", () => {
  it("opt-out: build() never probes Ollama", async () => {
    const agent = await base().withJudgment(false).build();
    await agent.dispose();
    expect(probed).toEqual([]);
  });

  it("opt-out: no JudgmentService is wired (judge() rejects) - false means off, not on", async () => {
    const agent = await base().withJudgment(false).build();
    await expect(
      agent.judge({ state: {}, questions: { q: { type: "noul", instructions: "ok?" } } }),
    ).rejects.toThrow(/requires \.withJudgment\(\)/);
    await agent.dispose();
  });

  it("default (never called): no probe - auto-shadow is opt-in since 2026-11-18", async () => {
    const agent = await base().build();
    await agent.dispose();
    expect(probed).toEqual([]);
  });

  it("withJudgment(false) after shadow opt-in: last call wins, no probe", async () => {
    const agent = await base().withJudgment({ shadow: true }).withJudgment(false).build();
    await agent.dispose();
    expect(probed).toEqual([]);
  });

  it("explicit withJudgment() does not probe either (unchanged)", async () => {
    const agent = await base().withJudgment({ backend: "llm" }).build();
    await agent.dispose();
    expect(probed).toEqual([]);
  });

  it("opt-out env var wins over the shadow opt-in", async () => {
    process.env.REACTIVE_AGENTS_NO_AUTO_SHADOW = "1";
    const agent = await base().withJudgment({ shadow: true }).build();
    await agent.dispose();
    expect(probed).toEqual([]);
  });

});
