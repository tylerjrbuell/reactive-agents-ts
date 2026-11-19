/**
 * Drift pin: `run-started.config.mechanisms` records every key of the
 * reasoning package's `ResolvedHarness` (AGENTS.md pitfall 12 — the trace must
 * name every mechanism a run ran with; rax-diagnose reads it).
 *
 * The key list comes from the resolver, not a hand list: the harness config
 * below sets every `HarnessConfig` field (`Required<>` makes a new field a
 * compile error here) and every env-only switch is turned on, so the resolved
 * object carries every key `resolveHarnessConfig` can emit. A key the resolver
 * gains without a matching snapshot entry fails this test.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { resolveHarnessConfig, type HarnessConfig } from "@reactive-agents/reasoning";
import { buildRunConfigSnapshot } from "../src/engine/execute-run-config";
import type { ReactiveAgentsConfig } from "../src/types";
import { makeRuntimeConfig } from "../src/testing/index";

/** Env-only harness switches (no `HarnessConfig` field yet). */
const ENV_ONLY: Readonly<Record<string, string>> = { RA_TODO_WRAPUP: "1" };

const EVERY_FIELD: Required<HarnessConfig> = {
  lazyDisclosure: true,
  toolDiscovery: true,
  toolIndex: true,
  toolIndexMaxEntries: 7,
  disclosureMode: "hybrid",
  verboseRules: true,
  recencyBudgetChars: 4000,
  toolResultBudgetChars: 3000,
  auditRationale: true,
  treeOfThoughtExploreBudgetMs: 1234,
  assemblyDebug: true,
  promptDumpPathPrefix: "/tmp/ra-drift-dump",
  numCtxPolicy: "demand",
  actOrAnswer: "proactive",
  inputCoverage: true,
  writeCoverage: true,
  stableToolList: true,
  compactCallConstraints: true,
  budgetAnswerTurn: true,
  wrapUpReserve: true,
  leanThinking: true,
  computeOffload: true,
  planToolCatalog: true,
  planBudget: true,
  autoTick: false,
  bookkeepingRefund: false,
  planRecon: true,
  parallelToolHint: "always",
  leanFinalTurn: true,
  llmRecoveryBudget: 3,
  repetitionBackstop: { maxCalls: 12 },
};

const prior: Record<string, string | undefined> = {};
afterEach(() => {
  for (const [k, v] of Object.entries(prior)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("run-started.config harness drift", () => {
  test("every ResolvedHarness key is recorded in mechanisms", () => {
    for (const [k, v] of Object.entries(ENV_ONLY)) {
      prior[k] = process.env[k];
      process.env[k] = v;
    }
    const resolvedKeys = Object.keys(resolveHarnessConfig(EVERY_FIELD));
    // Guard the guard: the env-only switch must have reached the resolver.
    expect(resolvedKeys).toContain("todoWrapUp");

    const config: ReactiveAgentsConfig = makeRuntimeConfig({
      reasoningOptions: { harness: EVERY_FIELD },
    } as Partial<ReactiveAgentsConfig>);
    const snap = buildRunConfigSnapshot({ config, provider: "test", model: "m", lean: false, env: {} });
    const recorded = new Set(Object.keys(snap.mechanisms));
    const missing = resolvedKeys.filter((k) => !recorded.has(k));
    expect(missing).toEqual([]);
  });

  test("todoWrapUp and writeCoverage record their resolved on-state", () => {
    prior.RA_TODO_WRAPUP = process.env.RA_TODO_WRAPUP;
    prior.RA_WRITE_COVERAGE = process.env.RA_WRITE_COVERAGE;
    process.env.RA_TODO_WRAPUP = "1";
    process.env.RA_WRITE_COVERAGE = "1";
    const on = buildRunConfigSnapshot({ config: makeRuntimeConfig(), provider: "test", model: "m", lean: false, env: {} });
    expect(on.mechanisms.todoWrapUp).toBe(true);
    expect(on.mechanisms.writeCoverage).toBe(true);
    delete process.env.RA_TODO_WRAPUP;
    delete process.env.RA_WRITE_COVERAGE;
    const off = buildRunConfigSnapshot({ config: makeRuntimeConfig(), provider: "test", model: "m", lean: false, env: {} });
    expect(off.mechanisms.todoWrapUp).toBe(false);
    expect(off.mechanisms.writeCoverage).toBe(false);
  });
});
