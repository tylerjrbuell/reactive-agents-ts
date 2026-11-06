// File: src/run-internal.ts
/**
 * Single-cell execution for the benchmark runner: build a ReactiveAgents agent
 * for one (task, model, harness-config) cell, run it, and dispatch between
 * competitor runners and the internal runner. Extracted verbatim from
 * runner.ts (GH #268); runner.ts re-exports the public symbols.
 */
import type { BenchmarkTask } from "./types.js";
import { toolsToExpose } from "@reactive-agents/core";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { serve } from "@reactive-agents/runtime-shim"
import type {
  HarnessVariant, ModelVariant, HarnessConfig, TaskRunResult,
} from "./types.js"
import { COMPETITOR_RUNNERS } from "./competitors/index.js"
import { mergeConfigs } from "./session.js"

/**
 * Apply env vars for the duration of a variant's run, return a restore fn.
 * Generalises the VERIFIER_ENV pattern so a future env-gated ablation arm can
 * run as `HarnessConfig.env` on a normal InternalVariant.
 */
export function withConfigEnv(env: Readonly<Record<string, string>> | undefined): () => void {
  if (!env) return () => {};
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) { prev[k] = process.env[k]; process.env[k] = v; }
  return () => {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  };
}

export const matchesExpected = (output: string, expected?: string): boolean => {
  if (!expected) return true;
  const patterns = expected.split("|");
  return patterns.some((p) => {
    try {
      return new RegExp(p, "i").test(output);
    } catch {
      return output.toLowerCase().includes(p.toLowerCase());
    }
  });
};

/**
 * A4 — decide whether a task should run under the long-horizon guard profile.
 * lh-* long-horizon instruments carry the `horizon:long` tag; every other task
 * is left on the default absolute-count guards. Kept as a pure predicate so the
 * per-build-path decision is unit-testable without a real agent build.
 */
export const shouldUseLongHorizon = (task: {
  readonly tags?: ReadonlyArray<string>;
}): boolean => task.tags?.includes("horizon:long") ?? false;

/**
 * Billed/cache-read fields for a `TaskResult`, gated on whether the
 * `LLMRequestCompleted` subscriber ever actually fired for this run.
 *
 * A subscribe race or a dropped event must not report a defined-but-wrong `0`
 * for `billedTokens` — `aggregateRuns`'s `r.billedTokens ?? r.tokensUsed`
 * fallback only engages on `undefined`, so a defined `0` would silently read
 * as "genuinely billed nothing" and violate the never-default-to-0 guarantee.
 * Omitting the fields entirely when the subscriber never fired lets that
 * fallback correctly engage and use the run's raw `tokensUsed` instead.
 */
export const billedTokenFields = (
  sawLLMRequestCompleted: boolean,
  cumulativeBilledTokens: number,
  cumulativeCacheReadTokens: number,
): { billedTokens?: number; cacheReadTokens?: number } =>
  sawLLMRequestCompleted
    ? { billedTokens: cumulativeBilledTokens, cacheReadTokens: cumulativeCacheReadTokens }
    : {};

/**
 * Materialize the agent-VISIBLE fixtures before the run. Deliberately does
 * NOT write `task.hiddenFixtures` — those are scoring apparatus written by
 * `scoreTask` (judge.ts `writeHiddenFixtures`) after the run completes, and
 * must never be observable by the agent. Exported for the seam test.
 */
export function writeFixtures(task: BenchmarkTask, dir: string): void {
  for (const fixture of task.fixtures ?? []) {
    const dest = join(dir, fixture.path)
    mkdirSync(join(dir, fixture.path.split("/").slice(0, -1).join("/")), { recursive: true })
    writeFileSync(dest, fixture.content, "utf8")
  }
}

/**
 * The ALL-OF grounding set fed to `.withRequiredTools()` for a task.
 *
 * requiredTools is an ALL-OF contract (llmEndTurnEvaluator refuses terminal
 * end_turn answers while ANY listed tool is unused), so the set must stay
 * MINIMAL — see the rw-2 lesson at the callsite. When the task declares an
 * explicit TaskContract `tools` list, only its `kind: "required"` entries
 * ground the terminal gate; `available` tools are exposed but must NOT enter
 * the gate (an exposed-but-optional code-execute would otherwise refuse the
 * terminal of a model that legitimately never executed). Legacy tasks
 * (no `tools` field) keep the fixtures-heuristic. Pure; exported for tests.
 */
export function computeGroundingSet(
  task: BenchmarkTask,
  declared: readonly string[] | undefined,
  builtins: readonly string[],
): readonly string[] {
  if (task.tools) {
    return task.tools.filter((t) => t.kind === "required").map((t) => t.name)
  }
  return declared ?? (task.fixtures?.length ? ["file-read"] : builtins)
}

async function runInternal(
  task: BenchmarkTask,
  model: ModelVariant,
  config: HarnessConfig,
  tmpDir: string,
  timeoutMs: number,
  traceDir?: string,
): Promise<TaskRunResult> {
  const start = performance.now()
  try {
    const maxIter = task.maxIterations ?? (config.reasoning ? 20 : config.tools ? 15 : 1)
    const builder = ReactiveAgents.create()
      .withName(`bench-${task.id}`)
      .withProvider(model.provider)
      .withModel(model.model)
      .withMaxIterations(maxIter)

    // T0a scripting seam: hand the deterministic provider its per-task turn
    // script. `withTestScenario` is the runtime's existing wither (it swaps in
    // TestLLMServiceLayer); this is just the bench-side hookup. Guarded on the
    // provider so live cells never read the field, and a "test" cell without a
    // script keeps the provider default ({text: ""}).
    if (model.provider === "test") {
      const turns = model.scenarios?.[task.id]
      if (turns?.length) builder.withTestScenario([...turns])
    }

    if (config.tools) {
      // Sprint-1 TaskContract bridge: prefer explicit task.tools when present
      // (toolsToExpose returns required+available names + auto-adds file-read
      // for fixture-bearing tasks). Falls back to legacy fixtures-heuristic for
      // tasks not yet migrated to the contract.
      const declared = task.tools
        ? toolsToExpose({
            prompt: task.prompt,
            tools: task.tools,
            fixtures: task.fixtures,
            success: { type: "regex", pattern: "" }, // unused by toolsToExpose
          })
        : undefined
      // Always include file-write alongside file-read so write-flow tasks
      // (e.g. summary-to-file) work whenever fixtures exist.
      const builtins = declared
        ? [...new Set([...declared, ...(task.fixtures?.length ? ["file-write"] : [])])]
        : task.fixtures && task.fixtures.length > 0
          ? ["file-read", "file-write"]
          : undefined
      // Opt-in run workspace (long-horizon arms): no key at all when unset.
      const workspace = config.workspace ? { workspace: tmpDir } : {}
      if (builtins && builtins.length > 0) {
        builder.withTools({ builtins, ...workspace })
        // F1 grounded-terminal invariant needs KernelInput.requiredTools
        // populated (wiki/Research/Harness-Reports/2026-07-02-cogito8b-
        // competitor-bench-root-cause.md). The default adaptive-classifier
        // path (config.requiredTools ?? {adaptive:true} when
        // reasoning+tools are both on) resolves via an LLM classifier
        // gated by model-tier reliability, falling back to literal
        // tool-name mentions in the prompt for untrusted tiers — neither
        // fires reliably for weak local models on these prompts, leaving
        // requiredTools empty and the F1 gate structurally inert. These
        // are exactly the fixture-bearing tasks (rw-8, rw-9) the
        // root-cause report traced by hand; the concrete builtins list
        // computed above IS the grounding requirement for them.
        if (task.requiresTools) {
          // requiredTools is an ALL-OF contract (llmEndTurnEvaluator refuses
          // terminal end_turn answers while ANY listed tool is unused). Wire
          // the MINIMAL grounding set — the contract's `required` tools when
          // declared, else file-read for fixture tasks — NOT the whole
          // exposed toolbox. Passing the convenience file-write add-on here
          // killed rw-2 on qwen3:14b (2026-07-07): the model read the CSV,
          // produced the correct answer, and the kernel silently refused
          // every terminal because file-write was never used by a task that
          // never needed to write. Same reasoning excludes `available`
          // contract tools (e.g. rw-7's code-execute) from the gate — see
          // computeGroundingSet.
          const groundingSet = computeGroundingSet(task, declared, builtins)
          if (groundingSet.length > 0) builder.withRequiredTools({ tools: [...groundingSet] })
        }
      } else {
        if (config.workspace) builder.withTools({ workspace: tmpDir })
        else builder.withTools()
      }
    }
    if (config.guardrails || task.requiresGuardrails) builder.withGuardrails()

    if (config.reasoning) {
      const strategyMap = {
        "react": "reactive" as const,
        "plan-execute": "plan-execute-reflect" as const,
        "tree-of-thought": "tree-of-thought" as const,
        "adaptive": "adaptive" as const,
        "blueprint": "blueprint" as const,
      }
      type StrategyKey = keyof typeof strategyMap
      const taskStrategy = task.strategy as StrategyKey | undefined
      const strategy = config.strategy
        ? strategyMap[config.strategy]
        : (taskStrategy && taskStrategy in strategyMap ? strategyMap[taskStrategy] : "reactive")
      builder.withReasoning({
        defaultStrategy: strategy,
        // Unset keeps the framework default (byte-identical existing arms).
        ...(config.strategySwitching !== undefined ? { enableStrategySwitching: config.strategySwitching } : {}),
      })
    }

    if (config.reactiveIntelligence) builder.withReactiveIntelligence()

    // `withMemory` used to be invoked through a stringly-typed
    // `as unknown as Record<string, unknown>` lookup, which (a) violates the
    // no-`any` rule and (b) made the call invisible to the feature-coverage
    // audit's `builder.withX(` scan. Call it directly.
    if (config.memory) builder.withMemory()

    // ── Harness capability toggles (feature-coverage audit, 2026-07-09) ───────
    // Each is additive and opt-in: a variant that does not set the key never
    // calls the wither, so existing arms build byte-identically.
    if (config.grounding) builder.withGrounding({ mode: config.grounding })
    if (config.fabricationGuard) builder.withFabricationGuard(config.fabricationGuard)
    if (config.stallPolicy) builder.withStallPolicy(config.stallPolicy)
    if (config.leanHarness) builder.withLeanHarness()
    if (config.metaTools) builder.withMetaTools()
    if (config.verification) builder.withVerification()

    // G3 adaptive-harness ablation: opt into the policy compiler (compileHarnessPlan
    // at run-start + recompileOnAssessment mid-run). Additive — variants WITHOUT
    // config.adaptiveHarness never call the wither, so their build is byte-identical
    // to today (the `ra-adaptive ≥ max(ra-minimal, ra-full)` gate depends on this).
    //
    // G2 purpose→tier routing (.withModelRouting()) is deliberately NOT wired here:
    // the bench builder has never wired it, and the adaptive-ablation runs ONE
    // resident model per cell (local qwen3:14b / cogito:8b), so there is no model
    // pool for the plan to route across — routing would be structurally inert.
    // Threading `.withModelRouting()` is deferred to a future multi-model routing
    // ablation (it would add a `config.modelRouting` passthrough at this same site).
    if (config.adaptiveHarness) builder.withAdaptiveHarness()

    // Typed harness switches (e.g. the Plan 9 2f `loopProgressAware` opt-in for
    // the H3 long-horizon A1 arm). Unset → never called (byte-identical arms).
    if (config.harness) builder.withHarness(config.harness)

    // Cross-tier thinking ablation: explicit enable/disable when set in config.
    if (config.thinking !== undefined) builder.withThinking(config.thinking)

    if (traceDir) builder.withTracing({ dir: traceDir })

    // A4: long-horizon tasks (tagged `horizon:long`, e.g. lh-1) run under the
    // scaled guard profile so ≥40-iteration work is not tripped by short-run guards.
    //
    // `config.longHorizon` (2026-07-09) makes the profile a VARIANT knob too, so
    // the same task can be run with it on and off. Without this the profile could
    // never be ablated — only `lh-1` carries the tag — and every mechanism gated
    // behind it was unmeasurable no matter how many runs we bought.
    if (shouldUseLongHorizon(task) || config.longHorizon) builder.withLongHorizon()

    const _log = console.log; console.log = () => {}
    const agent = await builder.build()
    console.log = _log

    // Billed-token instrument (2026-08-24 amendment §4). This is the SAME
    // mechanism `runTask` uses (see the subscription there): the per-call
    // `LLMRequestCompleted` event is the only live source of the cache split.
    // Without this subscription the gate/ablation path — which flows through
    // runInternal, NOT runTask — reported meanBilledTokens === meanTokens and
    // cacheHitRate === 0 on every real measurement, leaving the ratified
    // billed-token rule inert on the exact path it was ratified for.
    let cumulativeBilledTokens = 0
    let cumulativeCacheReadTokens = 0
    // Never report a defined-but-wrong 0: see `billedTokenFields`.
    let sawLLMRequestCompleted = false
    const unsubBilled = await agent.subscribe((event) => {
      if (event._tag === "LLMRequestCompleted") {
        cumulativeBilledTokens += event.billedTokens ?? event.tokensUsed
        cumulativeCacheReadTokens += event.cacheReadTokensIn ?? 0
        sawLLMRequestCompleted = true
      }
    })

    // M3 ablation: when the variant config requests the noop verifier, set the
    // env-var signal consumed by strategies/reactive.ts. The strategy swaps
    // `defaultVerifier` for `noopVerifier` only when no explicit verifier was
    // already supplied on its input. Restore the prior value on exit so
    // concurrent dispatches (and Bun test pools) aren't polluted.
    const VERIFIER_ENV = "REACTIVE_AGENTS_NOOP_VERIFIER";
    const prevVerifierEnv = process.env[VERIFIER_ENV];
    if (config.verifier === "noop") {
      process.env[VERIFIER_ENV] = "1";
    }
    // Generalised env-arm passthrough: a variant may set `config.env` to flip
    // framework env-gated paths for the duration of this cell (no arm currently
    // uses it; kept as a seam). Same try/finally discipline as VERIFIER_ENV.
    const restoreConfigEnv = withConfigEnv(config.env);

    try {
      // Path-resilient prompt construction (2026-06-02 sprint-1 U2 fix).
      // Previously prepended "Working directory: <tmpDir>. Use full path..."
      // as an advisory. Frontier models (sonnet) and weak local models both
      // dropped the working-dir prefix and emitted file-read("report.md")
      // relative → ENOENT → N=3 measurement noise that masked the real
      // arm-level signal on cs-overflow-* cells. The fix: substitute each
      // declared fixture's relative path with its absolute path INSIDE the
      // task prompt itself, so the model has nothing relative to drop.
      let resolvedPrompt = task.prompt
      for (const fixture of task.fixtures ?? []) {
        const absPath = join(tmpDir, fixture.path)
        // Word-boundary replacement so "report.md" inside "my-report.md"
        // doesn't get corrupted; preserves the original task prose otherwise.
        const re = new RegExp(`\\b${fixture.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")
        resolvedPrompt = resolvedPrompt.replace(re, absPath)
      }
      const prompt = task.fixtures?.length
        ? `Working directory for this task: ${tmpDir}\n\n${resolvedPrompt}`
        : task.prompt
      // Hard-kill on timeout (feedback-loop amplification, 2026-07-07): the old
      // Promise.race abandoned the agent fiber, which kept consuming the GPU
      // and degraded every later cell (qwen3:14b session: successful cell
      // durations climbed 248s → 380s → cap as zombies accumulated). runStream
      // carries an AbortSignal down to the kernel fiber, so a timed-out cell
      // now actually frees the model.
      const abort = new AbortController()
      const killTimer = setTimeout(() => abort.abort(new Error("timeout")), timeoutMs)
      try {
        const handle = agent.runStream(prompt, { signal: abort.signal, density: "tokens" })
        let completed:
          | Extract<import("@reactive-agents/runtime").AgentStreamEvent, { _tag: "StreamCompleted" }>
          | undefined
        let streamError: string | undefined
        for await (const ev of handle) {
          if (ev._tag === "StreamCompleted") completed = ev
          else if (ev._tag === "StreamError") streamError = ev.cause
        }
        if (!completed) throw new Error(streamError ?? "timeout")
        const meta = completed.metadata as {
          tokensUsed?: number
          stepsCount?: number
          terminatedBy?: string
          billedTokens?: number
          cacheReadTokens?: number
        }
        const terminatedBy = completed.abstention ? "abstained" : meta.terminatedBy
        // PRIMARY: the live LLMRequestCompleted subscription above.
        // SECONDARY: AgentResult.metadata, which does not carry these fields
        // yet (that wiring lives in packages/runtime/src/execution-engine.ts
        // and is a deferred fast-follow) — it reads through for free the
        // moment it does, and is only consulted when the event never fired.
        const billed = sawLLMRequestCompleted
          ? billedTokenFields(true, cumulativeBilledTokens, cumulativeCacheReadTokens)
          : {
              ...(meta.billedTokens != null ? { billedTokens: meta.billedTokens } : {}),
              ...(meta.cacheReadTokens != null ? { cacheReadTokens: meta.cacheReadTokens } : {}),
            }
        return {
          output: completed.output,
          tokensUsed: meta.tokensUsed ?? 0,
          durationMs: performance.now() - start,
          iterations: meta.stepsCount ?? 0,
          status: "pass",
          ...(traceDir && completed.taskId ? { traceId: completed.taskId } : {}),
          ...(terminatedBy != null ? { terminatedBy } : {}),
          ...billed,
        }
      } finally {
        clearTimeout(killTimer)
        if (abort.signal.aborted) {
          // Belt-and-braces: ensure the fiber is gone before the next cell.
          // terminate() is async, so a sync try/catch cannot contain it — a
          // rejection here escaped as an UNHANDLED rejection and killed the whole
          // run (it did: the manual-react arm crashed to a 0-byte report, because
          // that variant builds without .withKillSwitch()). Swallow on the promise.
          void (agent as { terminate?: () => Promise<void> })
            .terminate?.()
            ?.catch(() => { /* no kill switch on this variant; disposed below */ })
        }
      }
    } finally {
      unsubBilled()
      await agent.dispose()
      if (config.verifier === "noop") {
        if (prevVerifierEnv === undefined) delete process.env[VERIFIER_ENV];
        else process.env[VERIFIER_ENV] = prevVerifierEnv;
      }
      restoreConfigEnv();
    }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    const isExpectedError = task.expected && matchesExpected(errorMessage, task.expected)
    return {
      output: isExpectedError ? errorMessage : "",
      tokensUsed: 0,
      durationMs: performance.now() - start,
      iterations: 0,
      status: isExpectedError ? "pass" : "error",
      error: isExpectedError ? undefined : errorMessage,
    }
  }
}

async function startFlakyPriceServer(): Promise<{ url: string; stop: () => void }> {
  const fallbackData = {
    bitcoin:  { usd: 68450.21, usd_24h_change: 2.34,  usd_market_cap: 1_347_000_000_000 },
    ethereum: { usd: 3512.88,  usd_24h_change: -0.87, usd_market_cap: 422_000_000_000 },
    solana:   { usd: 172.44,   usd_24h_change: 4.12,  usd_market_cap: 79_000_000_000 },
  }
  let callCount = 0
  const server = await serve({
    port: 0,
    fetch() {
      callCount++
      if (callCount <= 2) return new Response("Service Unavailable", { status: 503 })
      return new Response(JSON.stringify(fallbackData), { status: 200,
        headers: { "Content-Type": "application/json" } })
    },
  })
  return { url: `http://localhost:${server.port}`, stop: () => server.stop() }
}

export async function dispatch(
  task: BenchmarkTask,
  model: ModelVariant,
  variant: HarnessVariant,
  tmpDir: string,
  timeoutMs: number,
  traceDir?: string,
): Promise<TaskRunResult> {
  if (variant.type === "competitor") {
    const runner = COMPETITOR_RUNNERS[variant.framework]
    if (!runner) return { output: "", tokensUsed: 0, durationMs: 0, iterations: 0, status: "error", error: `No runner for ${variant.framework}` }
    return runner.run(task, model, tmpDir, timeoutMs)
  }

  const effectiveConfig = variant.id === "ra-full" && task.optimalHarnessConfig
    ? mergeConfigs(variant.config, task.optimalHarnessConfig)
    : variant.config

  if (task.id === "rw-9") {
    const { url, stop } = await startFlakyPriceServer()
    const modifiedTask = { ...task, prompt: task.prompt.replace("INJECT_MOCK_URL", url) }
    try { return await runInternal(modifiedTask, model, effectiveConfig, tmpDir, timeoutMs, traceDir) }
    finally { stop() }
  }

  return runInternal(task, model, effectiveConfig, tmpDir, timeoutMs, traceDir)
}
