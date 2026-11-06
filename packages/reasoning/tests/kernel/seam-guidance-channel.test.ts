// Run: bun test packages/reasoning/tests/kernel/seam-guidance-channel.test.ts --timeout 15000
//
// Seam pin for kernel/state/guidance-channel.ts — the ONE guidance channel
// (Plan 9 Phase 4 stage 3). Pins:
//  1. Byte equivalence: renderGuidance reproduces the three pre-channel
//     builders (buildGuidanceText + appendEnvironmentUpdate +
//     appendChecklistReminder, frozen verbatim below as the oracle) over every
//     single kind, every pair, and a deterministic sample of mixed records.
//  2. One renderer: the `Guidance:` block format and the PendingGuidance
//     declaration exist only in the channel; think.ts renders through it.
//  3. One producer interface: raw `pendingGuidance:` record writes outside the
//     channel are a shrink-only census (target: zero).
//  4. Accounting: think records the per-turn guidance token estimate on
//     `meta.guidanceCost` (measured, not enforced).
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Effect, Layer, Option, Stream } from "effect";
import { LLMService, estimateTokenCount, type StreamEvent } from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import { contentText } from "@reactive-agents/core";
import {
  GUIDANCE_RENDER_ORDER,
  LOOP_DETECTED_DEFAULT,
  appendGuidanceText,
  contributeGuidance,
  guidanceFieldHasText,
  guidanceOf,
  guidanceTurnCost,
  renderGuidance,
  textSignal,
  type GuidanceKind,
  type PendingGuidance,
} from "../../src/kernel/state/guidance-channel.js";
import { handleThinking } from "../../src/kernel/capabilities/reason/think.js";
import { initialKernelState, noopHooks, type KernelContext, type KernelState } from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

// ── 1. Frozen legacy oracle (verbatim pre-channel code, 2026-11-06) ──────────

interface LegacyGuidanceContext {
  readonly requiredToolsPending: readonly string[];
  readonly loopDetected: boolean;
  readonly loopDetectedMessage?: string;
  readonly icsGuidance?: string;
  readonly oracleGuidance?: string;
  readonly errorRecovery?: string;
  readonly actReminder?: string;
  readonly qualityGateHint?: string;
  readonly evidenceGap?: string;
  readonly gatherDedup?: string;
  readonly triageSteer?: string;
}
function legacyBuildGuidanceText(guidance: LegacyGuidanceContext): string | null {
  const signals: string[] = [];
  if (guidance.requiredToolsPending.length > 0) {
    signals.push(
      `REQUIRED tools not yet called: ${guidance.requiredToolsPending.join(", ")}. Call these before giving a final answer.`,
    );
  }
  if (guidance.loopDetected) {
    signals.push(
      guidance.loopDetectedMessage ??
        "Loop detected: you are repeating the same tool calls. Try a different approach or synthesize what you have.",
    );
  }
  if (guidance.icsGuidance) signals.push(guidance.icsGuidance);
  if (guidance.oracleGuidance) signals.push(guidance.oracleGuidance);
  if (guidance.triageSteer) signals.push(guidance.triageSteer);
  if (guidance.errorRecovery) signals.push(guidance.errorRecovery);
  if (guidance.actReminder) signals.push(guidance.actReminder);
  if (guidance.qualityGateHint) signals.push(guidance.qualityGateHint);
  if (guidance.gatherDedup) signals.push(guidance.gatherDedup);
  if (guidance.evidenceGap) {
    signals.push(
      `Your answer contains claims not supported by tool results: ${guidance.evidenceGap}. Revise using only data from the Observations above.`,
    );
  }
  if (signals.length === 0) return null;
  return `Guidance:\n${signals.map((s) => `- ${s}`).join("\n")}`;
}
function legacyAppend(guidanceText: string | null, line: string | undefined): string | null {
  if (!line) return guidanceText;
  return guidanceText ? `${guidanceText}\n- ${line}` : `Guidance:\n- ${line}`;
}
/** The pre-channel think.ts composition (field copy + both appends). */
function legacyRender(pending: PendingGuidance, loopDetectedMessage?: string): string | null {
  const guidance: LegacyGuidanceContext = {
    requiredToolsPending: pending.requiredToolsPending ?? [],
    loopDetected: pending.loopDetected ?? false,
    icsGuidance: pending.icsGuidance,
    oracleGuidance: pending.oracleGuidance,
    triageSteer: pending.triageSteer,
    errorRecovery: pending.errorRecovery,
    actReminder: pending.actReminder,
    qualityGateHint: pending.qualityGateHint,
    evidenceGap: pending.evidenceGap,
    gatherDedup: pending.gatherDedup,
    ...(loopDetectedMessage !== undefined ? { loopDetectedMessage } : {}),
  };
  return legacyAppend(legacyAppend(legacyBuildGuidanceText(guidance), pending.environmentUpdate), pending.checklistReminder);
}

const TEXT_KINDS = GUIDANCE_RENDER_ORDER.filter(
  (k): k is Exclude<GuidanceKind, "requiredToolsPending" | "loopDetected"> =>
    k !== "requiredToolsPending" && k !== "loopDetected",
);
/** Values each kind takes in the sweep (absent, blank, whitespace, text). */
function valuesFor(kind: GuidanceKind): readonly PendingGuidance[] {
  if (kind === "requiredToolsPending") return [{}, { requiredToolsPending: [] }, { requiredToolsPending: ["a"] }, { requiredToolsPending: ["a", "b"] }];
  if (kind === "loopDetected") return [{}, { loopDetected: false }, { loopDetected: true }];
  return [{}, { [kind]: "" }, { [kind]: "  " }, { [kind]: `${kind} line` }, { [kind]: `${kind}\nmulti` }];
}

/** Join the rendered parts as think.ts does (stage D2: renderGuidance returns text parts). */
const renderedText = (g: PendingGuidance, o?: { loopDetectedMessage?: string }): string | null => {
  const parts = renderGuidance(g, o).parts;
  return parts.length > 0 ? contentText(parts) : null;
};

describe("guidance channel — byte equivalence with the pre-channel renderers", () => {
  const check = (g: PendingGuidance) => {
    expect(renderedText(g)).toBe(legacyRender(g));
    expect(renderedText(g, { loopDetectedMessage: "custom loop" })).toBe(legacyRender(g, "custom loop"));
  };

  it("every value of every single kind", () => {
    for (const kind of GUIDANCE_RENDER_ORDER) for (const v of valuesFor(kind)) check(v);
  });

  it("every pair of kinds", () => {
    for (let i = 0; i < GUIDANCE_RENDER_ORDER.length; i++)
      for (let j = i + 1; j < GUIDANCE_RENDER_ORDER.length; j++)
        for (const a of valuesFor(GUIDANCE_RENDER_ORDER[i]!)) for (const b of valuesFor(GUIDANCE_RENDER_ORDER[j]!)) check({ ...a, ...b });
  });

  it("2,000 deterministic mixed records (seeded LCG) incl. pendingSignals", () => {
    let seed = 20261106;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      let g: PendingGuidance = rnd(2) === 0 ? { pendingSignals: [{ signalId: "s1", field: "errorRecovery" }] } : {};
      for (const kind of GUIDANCE_RENDER_ORDER) {
        const vs = valuesFor(kind);
        g = { ...g, ...vs[rnd(vs.length)] };
      }
      check(g);
    }
  });

  it("render order covers every kind exactly once; loop default is the legacy text", () => {
    expect(new Set(GUIDANCE_RENDER_ORDER).size).toBe(GUIDANCE_RENDER_ORDER.length);
    expect(GUIDANCE_RENDER_ORDER.length).toBe(TEXT_KINDS.length + 2);
    expect(renderedText({ loopDetected: true })).toBe(`Guidance:\n- ${LOOP_DETECTED_DEFAULT}`);
    expect(renderGuidance({}).parts).toEqual([]);
    expect(renderGuidance({ errorRecovery: "e", requiredToolsPending: ["t"] }).parts.every((p) => p.type === "text")).toBe(true);
    expect(renderGuidance({ errorRecovery: "e", requiredToolsPending: ["t"] }).lines.map((l) => l.kind)).toEqual([
      "requiredToolsPending",
      "errorRecovery",
    ]);
  });
});

// ── Producer API ─────────────────────────────────────────────────────────────

describe("guidance channel — producers", () => {
  const ref = { signalId: "sig-1-1", field: "errorRecovery" as const };

  it("guidanceOf builds a fresh record (later signal of a kind wins); refs become pendingSignals", () => {
    expect(guidanceOf([{ kind: "errorRecovery", text: "a" }, { kind: "errorRecovery", text: "b" }])).toEqual({ errorRecovery: "b" });
    expect(guidanceOf([{ kind: "requiredToolsPending", tools: ["x"] }, { kind: "loopDetected", detected: true }], [ref])).toEqual({
      requiredToolsPending: ["x"],
      loopDetected: true,
      pendingSignals: [ref],
    });
  });

  it("contributeGuidance keeps other kinds and prior refs unless refs are given (then replaces them)", () => {
    const prior: PendingGuidance = { oracleGuidance: "o", pendingSignals: [ref] };
    expect(contributeGuidance(prior, [{ kind: "errorRecovery", text: "e" }])).toEqual({ oracleGuidance: "o", errorRecovery: "e", pendingSignals: [ref] });
    const ref2 = { signalId: "sig-1-2", field: "triageSteer" as const };
    expect(contributeGuidance(prior, [{ kind: "triageSteer", text: "t" }], [ref, ref2]).pendingSignals).toEqual([ref, ref2]);
    expect(contributeGuidance(undefined, [])).toEqual({});
  });

  it("appendGuidanceText newline-joins onto an existing line, else sets it", () => {
    expect(appendGuidanceText(undefined, "errorRecovery", "x")).toEqual({ errorRecovery: "x" });
    expect(appendGuidanceText({ errorRecovery: "a", actReminder: "r" }, "errorRecovery", "b")).toEqual({ errorRecovery: "a\nb", actReminder: "r" });
  });

  it("textSignal drops absent/empty text", () => {
    expect(textSignal("actReminder", undefined)).toEqual([]);
    expect(textSignal("actReminder", "")).toEqual([]);
    expect(textSignal("actReminder", "go")).toEqual([{ kind: "actReminder", text: "go" }]);
  });

  it("render stamp rule: only non-blank text fields stamp", () => {
    expect(guidanceFieldHasText({ errorRecovery: "e" }, "errorRecovery")).toBe(true);
    expect(guidanceFieldHasText({ errorRecovery: "  " }, "errorRecovery")).toBe(false);
    expect(guidanceFieldHasText({ requiredToolsPending: ["a"] }, "requiredToolsPending")).toBe(false);
    expect(guidanceFieldHasText(undefined, "errorRecovery")).toBe(false);
  });
});

// ── 2 + 3. One renderer, one producer interface (source scans) ───────────────

const SRC = join(import.meta.dir, "..", "..", "src");
const CHANNEL = "kernel/state/guidance-channel.ts";
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}
const files = sourceFiles(SRC).map((p) => ({ rel: relative(SRC, p), text: readFileSync(p, "utf8") }));
const codeLines = (text: string) =>
  text.split("\n").filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  });

/**
 * Raw `pendingGuidance:` record writes outside the channel (anything but
 * `undefined` or a channel producer call). SHRINK-ONLY: migrate a site to
 * guidanceOf / contributeGuidance / appendGuidanceText, then lower its count.
 */
const RAW_GUIDANCE_WRITE_CENSUS: Readonly<Record<string, number>> = {};

describe("guidance channel — one renderer, one producer interface", () => {
  it("the `Guidance:` block format lives only in the channel", () => {
    const owners = files.filter((f) => codeLines(f.text).some((l) => l.includes("Guidance:\\n"))).map((f) => f.rel);
    expect(owners).toEqual([CHANNEL]);
  });

  it("PendingGuidance is declared (and augmented) only in the channel", () => {
    const owners = files.filter((f) => /interface PendingGuidance\b/.test(f.text)).map((f) => f.rel);
    expect(owners).toEqual([CHANNEL]);
  });

  it("think.ts renders guidance through renderGuidance and nothing else", () => {
    const think = files.find((f) => f.rel === "kernel/capabilities/reason/think.ts")!.text;
    expect(think).toContain("renderGuidance(guidance");
    expect(think).not.toMatch(/buildGuidanceText|appendEnvironmentUpdate|appendChecklistReminder/);
  });

  it("think.ts is the one join of the rendered guidance parts (stage D2)", () => {
    const callers = files
      .filter((f) => f.rel !== CHANNEL && codeLines(f.text).some((l) => /renderGuidance\(|guidanceBlockParts\(|planPostureGuidanceParts\(/.test(l)))
      .map((f) => f.rel)
      .sort();
    expect(callers).toEqual(["kernel/capabilities/reason/think.ts", "kernel/policy/run-posture.ts"]);
    const think = files.find((f) => f.rel === "kernel/capabilities/reason/think.ts")!.text;
    expect(think).toContain("contentText(guidanceParts)");
  });

  it("raw pendingGuidance record writes outside the channel match the shrink-only census", () => {
    // A `pendingGuidance:` write is sanctioned when its expression (the line
    // plus the next two, for wrapped ternaries) goes through a channel
    // producer, clears to `undefined`, or passes an existing record through.
    const producer = /guidanceOf\(|contributeGuidance\(|appendGuidanceText\(/;
    const sanctioned = /pendingGuidance:\s*undefined\b|pendingGuidance:\s*[\w.]+\.pendingGuidance\b/;
    const found: Record<string, number> = {};
    for (const f of files) {
      if (f.rel === CHANNEL) continue;
      const lines = codeLines(f.text);
      let n = 0;
      lines.forEach((l, i) => {
        if (!/pendingGuidance:/.test(l)) return;
        const expr = lines.slice(i, i + 3).join("\n");
        if (!producer.test(expr) && !sanctioned.test(l)) n++;
      });
      if (n > 0) found[f.rel] = n;
    }
    expect(found).toEqual(RAW_GUIDANCE_WRITE_CENSUS);
  });
});

// ── 4. Accounting wired in think (measured, not enforced) ────────────────────

const streamEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: "Considering." },
  { type: "content_complete", content: "Considering." },
  { type: "usage", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 } },
];
const makeLLM = (sink: { req?: { messages: readonly { role: string; content: unknown }[] } }) =>
  Layer.succeed(LLMService, {
    complete: () => Effect.succeed({ content: "ok", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0 }, model: "m" }) as never,
    stream: (req: never) => {
      sink.req = req;
      return Effect.succeed(Stream.fromIterable(streamEvents) as never);
    },
    completeStructured: () => Effect.succeed({ ok: true }) as never,
    embed: () => Effect.succeed([]),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({} as never),
    getStructuredOutputCapabilities: () => Effect.succeed({} as never),
    capabilities: () => Effect.succeed({} as never),
  } as never);
const ctx: KernelContext = {
  input: { task: "Do the work." },
  profile: CONTEXT_PROFILES.local,
  compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
  toolService: Option.none(),
  hooks: noopHooks,
  toolCallingDriver: new NativeFCDriver(),
  memoryService: Option.none(),
};
const state0 = (pendingGuidance?: PendingGuidance): KernelState => ({
  ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 }),
  iteration: 1,
  messages: [{ role: "user", content: "Do the work." }],
  ...(pendingGuidance ? { pendingGuidance } : {}),
});
const runThink = async (s: KernelState) => {
  const sink: { req?: { messages: readonly { role: string; content: unknown }[] } } = {};
  const out = await Effect.runPromise(handleThinking(s, ctx).pipe(Effect.provide(makeLLM(sink))));
  return { out, last: sink.req?.messages.at(-1) };
};

describe("guidance channel — per-turn accounting in think", () => {
  it("records the sent Guidance: message's deterministic token estimate and kinds", async () => {
    const pending: PendingGuidance = { requiredToolsPending: ["web-search"], errorRecovery: "Try another query." };
    const { out, last } = await runThink(state0(pending));
    const expectedText = renderedText(pending)!;
    expect(last).toEqual({ role: "user", content: expectedText });
    const expectedTokens = Effect.runSync(estimateTokenCount([{ role: "user", content: expectedText }]));
    expect(out.meta.guidanceCost).toEqual([
      { iteration: 1, kinds: ["requiredToolsPending", "errorRecovery"], chars: expectedText.length, tokens: expectedTokens },
    ]);
    expect(out.pendingGuidance).toBeUndefined();
  });

  it("no guidance → nothing sent, nothing recorded", async () => {
    const { out, last } = await runThink(state0());
    expect(typeof last?.content === "string" && last.content.startsWith("Guidance:")).toBe(false);
    expect(out.meta.guidanceCost).toBeUndefined();
    expect(Effect.runSync(guidanceTurnCost(3, null, []))).toBeUndefined();
  });
});
