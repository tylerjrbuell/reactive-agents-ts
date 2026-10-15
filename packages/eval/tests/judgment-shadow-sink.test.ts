// Run: bun test packages/eval/tests/judgment-shadow-sink.test.ts --timeout 15000
//
// Wave 7.1 — the shadow sink records the existing JudgmentShadow events
// durably and answers per-site agreement queries (the automated form of the
// n=30-32 gate methodology). Shadow mode never consumes a decision; this
// sink only stores the judged-vs-current pairing.
//
// RED-ON-CUT: drop the INSERT and samples stay 0; drop the agreement filter
// and null judgments poison the rate.
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJudgmentShadowSink } from "../src/services/judgment-shadow-sink.js";
import type { JudgmentShadow } from "@reactive-agents/core";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ra-shadow-sink-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const event = (overrides: Partial<JudgmentShadow> = {}): JudgmentShadow => ({
  _tag: "JudgmentShadow",
  site: "task-comprehension",
  judged: "research",
  current: "research",
  agreement: true,
  confidence: 0.9,
  ...overrides,
});

describe("7.1 judgment-shadow sink", () => {
  it("records events and reports per-site agreement", async () => {
    const sink = createJudgmentShadowSink(join(dir, "shadow.db"));
    for (let i = 0; i < 4; i++) {
      await Effect.runPromise(sink.record(event()));
    }
    await Effect.runPromise(sink.record(event({ judged: "direct", agreement: false, confidence: 0.85 })));
    await Effect.runPromise(sink.record(event({ judged: null, agreement: null, confidence: null })));
    const agreement = await Effect.runPromise(sink.agreementBySite("task-comprehension"));
    expect(agreement.samples).toBe(6);
    expect(agreement.agreementRate).toBeCloseTo(4 / 5, 5);
    expect(agreement.nullJudgments).toBe(1);
    expect(agreement.highConfidenceDisagreements).toBe(1);
  });

  it("unknown sites report empty (never throw)", async () => {
    const sink = createJudgmentShadowSink(join(dir, "shadow.db"));
    const agreement = await Effect.runPromise(sink.agreementBySite("no-such-site"));
    expect(agreement.samples).toBe(0);
    expect(agreement.agreementRate).toBeNull();
  });

  it("lists recorded sites", async () => {
    const sink = createJudgmentShadowSink(join(dir, "shadow.db"));
    await Effect.runPromise(sink.record(event({ site: "complexity-router" })));
    await Effect.runPromise(sink.record(event({ site: "task-comprehension" })));
    const sites = await Effect.runPromise(sink.sites());
    expect([...sites].sort()).toEqual(["complexity-router", "task-comprehension"]);
  });
});
