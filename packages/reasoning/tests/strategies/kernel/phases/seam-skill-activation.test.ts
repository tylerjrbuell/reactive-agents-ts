// Run: bun test packages/reasoning/tests/strategies/kernel/phases/seam-skill-activation.test.ts --timeout 20000
//
// Seam pin for kernel/capabilities/act/skill-activation.ts and the skills
// step-4 wiring (skills spec step 4,
// wiki/Architecture/Design-Specs/2026-11-06-skills-and-extension-model.md §5,
// §8 row 4, §11 items 1, 2, 4, 5, 7). A scripted native-FC LLM drives the real
// kernel (runPass + reactKernel) over a fake skill catalog and records every
// request, so each gate reads what the provider would have received.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Option, Stream } from "effect";
import {
  LLMService,
  type CompletionRequest,
  type CompletionResponse,
  type StreamEvent,
  type StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { EventBusLive } from "@reactive-agents/core";
import { NativeFCDriver, type ResolvedSkill } from "@reactive-agents/tools";
import { mockToolServiceLayer } from "../../../../src/testing/tool-service-mock.js";
import { prepareReActPass, reactKernel, type ReActKernelInput } from "../../../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../../../src/kernel/loop/run-pass.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelRunOptions,
  type KernelState,
} from "../../../../src/kernel/state/kernel-state.js";
import { handleActing } from "../../../../src/kernel/capabilities/act/act.js";
import { CONTEXT_PROFILES } from "../../../../src/context/context-profile.js";
import type { SkillsContext } from "../../../../src/kernel/state/skills-context.js";
import { hasActivatableSkills } from "../../../../src/kernel/state/skills-context.js";
import {
  estimateSkillTokens,
  loadedSkills,
  skillBudget,
} from "../../../../src/kernel/capabilities/act/skill-activation.js";
import { commitRound, startRound } from "../../../../src/kernel/capabilities/act/checklist-round.js";
import { appendEntry, type LedgerEntry } from "../../../../src/kernel/ledger/run-ledger.js";
import { project } from "../../../../src/assembly/project.js";
import { EventLog } from "../../../../src/assembly/event-log.js";
import { ResultStore } from "../../../../src/assembly/result-store.js";
import { resolveCapability } from "../../../../src/assembly/capability.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const BODY_MARKER = "RELEASE-NOTES-PROCEDURE-7f3a";
const GATHER_MARKER = (i: number): string => `GATHER-RESULT-${i}-c91d`;

let skillDir = "";
beforeAll(() => {
  skillDir = mkdtempSync(join(tmpdir(), "seam-skill-activation-"));
  writeFileSync(join(skillDir, "SKILL.md"), "# release-notes\nsee references/format.md");
  writeFileSync(join(skillDir, "format.md"), `FORMAT-FILE ${"x".repeat(4000)}`);
});
afterAll(() => {
  if (skillDir) rmSync(skillDir, { recursive: true, force: true });
});

/** A body of roughly `tokens` tokens (4 chars per token) that starts with `marker`. */
const body = (marker: string, tokens: number): string =>
  `${marker}\n1. Read the changelog.\n2. Write notes.\n${"step detail ".repeat(Math.max(0, Math.floor((tokens * 4) / 12)))}`;

const skill = (marker: string, tokens: number): ResolvedSkill => ({
  body: body(marker, tokens),
  dir: skillDir,
  sha256: `sha-${marker}`,
});

const skillsContext = (skills: Record<string, ResolvedSkill>, extra: Partial<SkillsContext> = {}): SkillsContext => ({
  catalogXml: `<available_skills>${Object.keys(skills)
    .map((n) => `<skill><name>${n}</name><description>${n} procedure</description></skill>`)
    .join("")}</available_skills>`,
  skills: new Map(Object.entries(skills)),
  ...extra,
});

const GATHER_PARAMS = [{ name: "q", type: "string", required: true }];
/**
 * Distinct gather tools, so the repeated-tool guard stays quiet across the
 * script. The projection previews older results (~1.3k chars per round), so
 * 24 rounds are what it takes to pass the num_ctx 8192 message budget.
 */
const GATHER_TOOLS = Array.from({ length: 24 }, (_, i) => ({
  name: `gather${i + 1}`,
  description: `Gather data set ${i + 1}.`,
  parameters: GATHER_PARAMS,
}));

/** Each gather result is ~6,000 chars (≈1,500 tokens), uncompressed (see `resultCompression`). */
const toolLayer = mockToolServiceLayer({
  execute: (req: { toolName: string; args?: unknown }) =>
    Effect.sync(() => {
      const i = Number(req.toolName.replace(/\D/g, "")) || 0;
      return { success: true, result: `${GATHER_MARKER(i)} ${"data ".repeat(1200)}` };
    }),
  getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: GATHER_PARAMS }),
});

// ─── Scripted native-FC LLM that records requests ─────────────────────────────

type Turn =
  | { readonly calls: readonly { readonly name: string; readonly args: Record<string, unknown> }[] }
  | { readonly text: string };

// Per-turn usage above the token-delta guard's floor (<500 tokens per iteration
// exits early), so a scripted run is not cut short.
const usage = { inputTokens: 900, outputTokens: 200, totalTokens: 1100, estimatedCost: 0 };

const eventsFor = (turn: Turn, n: number): readonly StreamEvent[] => {
  if ("text" in turn) {
    return [
      { type: "text_delta", text: turn.text },
      { type: "content_complete", content: turn.text, stopReason: "end_turn" },
      { type: "usage", usage },
    ];
  }
  return [
    ...turn.calls.flatMap((c, j): StreamEvent[] => [
      { type: "tool_use_start", id: `call-${n}-${j}`, name: c.name },
      { type: "tool_use_delta", input: JSON.stringify(c.args) },
    ]),
    { type: "content_complete", content: "", stopReason: "tool_use" },
    { type: "usage", usage },
  ];
};

function scriptedLLM(turns: readonly Turn[], captured: CompletionRequest[]) {
  return Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_r: CompletionRequest) =>
        Effect.succeed<CompletionResponse>({ content: "Done.", stopReason: "end_turn", usage, model: "test" }),
      stream: (request: CompletionRequest) => {
        captured.push(request);
        const n = captured.length - 1;
        const turn = turns[n] ?? { text: "Done." };
        return Effect.succeed(Stream.fromIterable(eventsFor(turn, n)));
      },
      completeStructured: <A>(_r: StructuredCompletionRequest<A>) => Effect.die("unused"),
      embed: (t: readonly string[]) => Effect.succeed(t.map(() => [0])),
      countTokens: (m: readonly unknown[]) => Effect.succeed(m.length),
      getModelConfig: () => Effect.succeed({ provider: "anthropic", model: "test-model" }),
      getStructuredOutputCapabilities: () =>
        Effect.succeed({ nativeJsonMode: false, jsonSchemaEnforcement: false, prefillSupport: false, grammarConstraints: false }),
      capabilities: () =>
        Effect.succeed({
          supportsToolCalling: true,
          supportsStreaming: true,
          supportsSystemPrompt: true,
          supportsLogprobs: false,
          supportsNativeStreaming: true,
          supportsPromptCaching: false,
        }),
    }),
  );
}

const input = (overrides: Partial<ReActKernelInput> = {}): ReActKernelInput =>
  ({
    task: "Write the release notes for this repo.",
    availableToolSchemas: GATHER_TOOLS,
    providerName: "anthropic",
    modelId: "test-model",
    // num_ctx 8192: the projection window the budget and compaction both read.
    contextProfile: { tier: "mid", maxTokens: 8192, explicitNumCtx: 8192 },
    resultCompression: { budget: 20_000, previewItems: 5, autoStore: true, codeTransform: false },
    ...overrides,
  }) as ReActKernelInput;

const opts: KernelRunOptions = {
  maxIterations: 30,
  strategy: "reactive",
  kernelType: "react",
  taskId: "seam-skill-activation",
  modelId: "test-model",
};

/**
 * Prepare the pass the way every kernel strategy does (prepareReActPass runs
 * resolveExecutableToolCapabilities, which offers activate-skill), then run it.
 */
async function run(turns: readonly Turn[], inp: ReActKernelInput) {
  const captured: CompletionRequest[] = [];
  const pass = await Effect.runPromise(
    prepareReActPass(inp).pipe(
      Effect.flatMap(({ kernelInput }) => runPass(reactKernel, kernelInput, opts)),
      Effect.provide(Layer.mergeAll(scriptedLLM(turns, captured), toolLayer, EventBusLive)),
    ),
  );
  return { state: pass.state, requests: captured };
}

const activate = (name: string, file?: string): Turn => ({
  calls: [{ name: "activate-skill", args: file === undefined ? { name } : { name, file } }],
});
const gather = (i: number): Turn => ({ calls: [{ name: `gather${i}`, args: { q: `q${i}` } }] });

const toolNames = (r: CompletionRequest): string[] => (r.tools ?? []).map((t) => t.name);
const requestText = (r: CompletionRequest): string =>
  r.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
const skillFacts = (state: KernelState) =>
  (state.ledger ?? []).flatMap((e) => (e.kind === "skill-activated" ? [e] : []));
const skillObservations = (state: KernelState) =>
  state.steps.filter((s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "activate-skill");

// ─── Gates ─────────────────────────────────────────────────────────────────────

describe("activate-skill on a run with a skill catalog (skills step 4)", () => {
  it("offers activate-skill on the wire and delivers a body that survives a forced compaction at num_ctx 8192", async () => {
    const { state, requests } = await run(
      [activate("release-notes"), ...Array.from({ length: 24 }, (_, i) => gather(i + 1)), { text: "Done." }],
      input({ skillsContext: skillsContext({ "release-notes": skill(BODY_MARKER, 600) }) }),
    );

    // Tool on the wire, before and after activation.
    expect(toolNames(requests[0]!)).toContain("activate-skill");

    // The skill-activated fact, derived for dedupe and budget.
    const facts = skillFacts(state);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ name: "release-notes", sha256: `sha-${BODY_MARKER}`, source: "installed", via: "agent" });
    expect(facts[0]!.tokens).toBeGreaterThanOrEqual(600);

    // Body marker in EVERY request after the activation turn.
    const after = requests.slice(1);
    expect(after.length).toBeGreaterThanOrEqual(5);
    for (const r of after) expect(requestText(r)).toContain(BODY_MARKER);

    // Compaction ran and shrank the request: an early gather result is gone.
    const markers = (state.ledger ?? []).filter((e: LedgerEntry) => e.kind === "compaction-marker");
    expect(markers.length).toBeGreaterThan(0);
    const sizes = requests.map((r) => requestText(r).length);
    expect(sizes.some((size, i) => i > 0 && size < sizes[i - 1]!)).toBe(true);
    const last = requests.at(-1)!;
    expect(requestText(last)).not.toContain(GATHER_MARKER(1));
    expect(requestText(last)).toContain(BODY_MARKER);

    // System-prompt bytes and the wire tools array are identical before and after activation.
    expect(requests[1]!.systemPrompt).toBe(requests[0]!.systemPrompt);
    expect(JSON.stringify(requests[1]!.tools)).toBe(JSON.stringify(requests[0]!.tools));
    expect(requests[0]!.systemPrompt).toContain("Skills: call `activate-skill` to load one before you start that kind of work.");
    expect(requests[0]!.systemPrompt).not.toContain(BODY_MARKER);
    expect(skillObservations(state)[0]!.metadata?.observationResult?.preserveOnCompaction).toBe(true);
  });

  it("a duplicate activation returns already-loaded and records no second fact", async () => {
    const { state } = await run(
      [activate("release-notes"), activate("release-notes"), gather(1), { text: "Done." }],
      input({ skillsContext: skillsContext({ "release-notes": skill(BODY_MARKER, 300) }) }),
    );
    expect(skillFacts(state)).toHaveLength(1);
    const obs = skillObservations(state);
    expect(obs[1]!.content).toContain('Skill "release-notes" is already loaded');
    expect(obs[1]!.metadata?.observationResult?.preserveOnCompaction).toBe(false);
  });

  it("a pinned skill (already in the system prompt) answers already-loaded", async () => {
    const { state } = await run(
      [activate("release-notes"), gather(1), { text: "Done." }],
      input({
        skillsContext: skillsContext({ "release-notes": skill(BODY_MARKER, 300) }, { pinned: ["release-notes"] }),
      }),
    );
    expect(skillFacts(state)).toHaveLength(0);
    expect(skillObservations(state)[0]!.content).toContain("already loaded");
  });

  it("a body over min(5k, 10% of the window) is refused with a message naming activate-skill({ name, file })", async () => {
    const { state } = await run(
      [activate("big"), gather(1), { text: "Done." }],
      input({ skillsContext: skillsContext({ big: skill("BIG", 1200) }) }),
    );
    expect(skillFacts(state)).toHaveLength(0);
    const text = skillObservations(state)[0]!.content;
    expect(text).toContain("was not loaded");
    expect(text).toContain("over the 819-token limit for one skill");
    expect(text).toContain('activate-skill({ name: "big", file: "<path>" })');
  });

  it("activations past 20% of the window are refused; the budget is a fold of skill-activated facts", async () => {
    const { state } = await run(
      [activate("a"), activate("b"), activate("c"), gather(1), { text: "Done." }],
      input({ skillsContext: skillsContext({ a: skill("AAA", 700), b: skill("BBB", 700), c: skill("CCC", 700) }) }),
    );
    expect(skillFacts(state).map((f) => f.name)).toEqual(["a", "b"]);
    const text = skillObservations(state)[2]!.content;
    expect(text).toContain("remain in this run's skill budget");
    expect(text).toContain('activate-skill({ name: "c", file: "<path>" })');
  });

  it("{ name, file } is an ordinary compressed result: not preserved, no fact", async () => {
    const { state } = await run(
      [activate("release-notes", "format.md"), gather(1), { text: "Done." }],
      input({
        skillsContext: skillsContext({ "release-notes": skill(BODY_MARKER, 300) }),
        resultCompression: { budget: 800, previewItems: 3, autoStore: true, codeTransform: false },
      }),
    );
    expect(skillFacts(state)).toHaveLength(0);
    const obs = skillObservations(state)[0]!;
    expect(obs.content).toContain("FORMAT-FILE");
    expect(obs.content.length).toBeLessThan(4000);
    expect(obs.metadata?.observationResult?.preserveOnCompaction).toBe(false);
  });
});

describe("a run without skills is unchanged", () => {
  it("does not offer activate-skill, does not intercept a call to it, and renders no skills header", async () => {
    const { state, requests } = await run([activate("release-notes"), { text: "Done." }], input());
    expect(toolNames(requests[0]!)).not.toContain("activate-skill");
    expect(skillFacts(state)).toHaveLength(0);
    // Not intercepted: the kernel handler's no-skills reply never appears.
    expect(state.steps.every((s) => !s.content.includes("this run has no skills"))).toBe(true);
    expect(requests[0]!.systemPrompt ?? "").not.toContain("activate-skill");
    expect(requests[0]!.systemPrompt ?? "").not.toContain("Skills");
  });

  it("act intercepts activate-skill only when the run has skills (advisor item 7)", async () => {
    // Think's tool gate already refuses a call to a tool that is not on the
    // surface, so this drives act directly with the call pending.
    const act = (skillsCtx: SkillsContext | undefined) => {
      const base = initialKernelState({ strategy: "reactive", kernelType: "react", maxIterations: 5 });
      const state: KernelState = {
        ...base,
        meta: {
          ...base.meta,
          pendingNativeToolCalls: [{ id: "c1", name: "activate-skill", arguments: { name: "release-notes" } }],
        },
      };
      const context: KernelContext = {
        input: { task: "t", availableToolSchemas: GATHER_TOOLS, ...(skillsCtx ? { skillsContext: skillsCtx } : {}) },
        profile: CONTEXT_PROFILES.mid,
        compression: { budget: 800, previewItems: 3, autoStore: true, codeTransform: false },
        toolService: Option.none(),
        hooks: noopHooks,
        toolCallingDriver: new NativeFCDriver(),
        memoryService: Option.none(),
      };
      return Effect.runPromise(handleActing(state, context).pipe(Effect.provide(scriptedLLM([], []))));
    };
    const without = await act(undefined);
    expect(without.steps.some((s) => s.content.includes("<skill_content"))).toBe(false);
    expect(without.steps.some((s) => s.content.includes("this run has no skills"))).toBe(false);
    const withSkills = await act(skillsContext({ "release-notes": skill(BODY_MARKER, 100) }));
    expect(withSkills.steps.some((s) => s.content.includes(BODY_MARKER))).toBe(true);
  });

  it("a catalog without loadable skills keeps the procedural header and drops the 'do NOT call them as tools' line", () => {
    const prompt = systemPromptFor({ activatedXml: '<skill_content name="pinned">x</skill_content>' });
    expect(prompt).toContain("## Skills (procedural instructions — follow these)");
    expect(prompt).not.toContain("do NOT call them as tools");
    expect(prompt).not.toContain("activate-skill");
    const withSkills = systemPromptFor(skillsContext({ a: skill("A", 10) }));
    expect(withSkills).toContain("Skills: call `activate-skill` to load one before you start that kind of work.");
    expect(withSkills).not.toContain("do NOT call them as tools");
  });
});

// ─── Pure seams ────────────────────────────────────────────────────────────────

describe("skill budget and loaded-set derivation", () => {
  it("budget: per body min(5k, 10% of window); total 20% of window", () => {
    expect(skillBudget(8192)).toEqual({ maxBodyTokens: 819, totalTokens: 1638 });
    expect(skillBudget(200_000)).toEqual({ maxBodyTokens: 5_000, totalTokens: 40_000 });
  });

  it("loaded set folds own-run facts, staged activations and pins; a child pass's facts do not count", () => {
    let ledger = appendEntry(undefined, {
      kind: "skill-activated", iteration: 1, name: "a", sha256: "s", source: "installed", via: "agent", tokens: 100,
    });
    ledger = appendEntry(ledger, {
      kind: "skill-activated", iteration: 1, name: "child", sha256: "s", source: "installed", via: "agent", tokens: 900,
      pass: "sub-agent:x" as never,
    });
    const round = startRound();
    round.skills.push({ name: "b", sha256: "s", source: "installed", via: "agent", tokens: 50 });
    const loaded = loadedSkills(ledger, round, ["pinned"]);
    expect([...loaded.names].sort()).toEqual(["a", "b", "pinned"]);
    expect(loaded.spentTokens).toBe(150);
  });

  it("commitRound charges the round's whole preserved block to its first activation", () => {
    const round = startRound();
    round.skills.push({ name: "a", sha256: "s", source: "installed", via: "agent", tokens: 100, toolCallId: "c1" });
    round.skills.push({ name: "b", sha256: "s", source: "installed", via: "agent", tokens: 40, toolCallId: "c2" });
    const ledger = commitRound(round, undefined, 3, 500);
    const facts = ledger.flatMap((e) => (e.kind === "skill-activated" ? [e] : []));
    expect(facts.map((f) => [f.name, f.tokens, f.iteration])).toEqual([["a", 460, 3], ["b", 40, 3]]);
    expect(commitRound(startRound(), undefined, 3, 500)).toEqual([]);
  });

  it("hasActivatableSkills needs a non-empty skills map", () => {
    expect(hasActivatableSkills(undefined)).toBe(false);
    expect(hasActivatableSkills({ catalogXml: "<available_skills/>" })).toBe(false);
    expect(hasActivatableSkills({ skills: new Map() })).toBe(false);
    expect(hasActivatableSkills(skillsContext({ a: skill("A", 10) }))).toBe(true);
    expect(estimateSkillTokens("abcdefgh")).toBe(2);
  });
});

/** The system prompt `project()` assembles for a one-goal log and `ctx`. */
function systemPromptFor(ctx: SkillsContext): string {
  const { request } = project({
    log: new EventLog().append({ kind: "goal", text: "write release notes" }),
    capability: resolveCapability({ window: 8192, outputBudget: 2000, dialect: "native-fc", tier: "mid" }),
    store: new ResultStore(),
    persona: { system: "You are a test agent." },
    skillsContext: ctx,
    tools: { schemas: [] },
  });
  return request.systemPrompt;
}
