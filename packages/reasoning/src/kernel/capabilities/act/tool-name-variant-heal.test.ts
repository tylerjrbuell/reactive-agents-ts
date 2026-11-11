// Run: bun test packages/reasoning/src/kernel/capabilities/act/tool-name-variant-heal.test.ts --timeout 20000
//
// Separator-variant tool names (2026-11-10 census): a model that calls
// `umami_get_website_stats` (providers forbid `/`, so `_` is often the only
// form it can emit) or `web_search` must run the real tool
// (`umami/get_website_stats`, `web-search`), and the kernel records the real
// name. The act phase heals the name with the full registry
// (`runHealingPipeline` → `healToolName` → `resolveToolNameStrict`) BEFORE
// the guard chain, so `availableToolGuard` sees the resolved name.
//
// The census refusals ("Tool \"umami_get_website_stats\" is not available in
// this run. Available tools include: .") came from sub-agents whose tool
// surface was EMPTY: spawn-agent passed the parent's `_` names as the child's
// allowlist, which matched no registered tool. That site is runtime's
// sub-agent executor, not this guard.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../../testing/tool-service-mock.js";
import { reactKernel } from "../../loop/react-kernel.js";
import { runPass } from "../../loop/run-pass.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
  type ToolServiceInstance,
} from "../../state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";
import { NativeFCDriver, runHealingPipeline } from "@reactive-agents/tools";
import { availableToolGuard } from "./guard.js";
import { handleActing } from "./act.js";

const SCHEMAS = [
  {
    name: "umami/get_website_stats",
    description: "website stats",
    parameters: [{ name: "websiteId", type: "string", required: true }],
  },
  {
    name: "web-search",
    description: "search the web",
    parameters: [{ name: "query", type: "string", required: true }],
  },
];

const input = (schemas: typeof SCHEMAS): KernelInput =>
  ({
    task: "Get the website stats and search the web, then answer.",
    availableToolSchemas: schemas,
    allToolSchemas: schemas,
  }) as KernelInput;

const opts: KernelRunOptions = {
  maxIterations: 4,
  strategy: "reactive",
  kernelType: "react",
  taskId: "tool-name-variant-heal-test",
};

const runWith = async (schemas: typeof SCHEMAS, calls: readonly { name: string; args: Record<string, unknown> }[]) => {
  const executed: string[] = [];
  const toolLayer = mockToolServiceLayer({
    execute: (req: { toolName: string; args?: unknown }) =>
      Effect.sync(() => {
        executed.push(req.toolName);
        return { success: true, result: { ok: true } };
      }),
  });
  const scenario = TestLLMServiceLayer([
    { toolCalls: calls.map((c) => ({ name: c.name, args: c.args })) },
    { text: "Done: stats and search results gathered." },
  ]);
  const pass = await Effect.runPromise(
    runPass(reactKernel, input(schemas), opts).pipe(Effect.provide(Layer.mergeAll(scenario, toolLayer))),
  );
  return { pass, executed };
};

describe("separator-variant tool names run as the real tool", () => {
  it("umami_get_website_stats and web_search execute as umami/get_website_stats and web-search", async () => {
    const { pass, executed } = await runWith(SCHEMAS, [
      { name: "umami_get_website_stats", args: { websiteId: "w1" } },
      { name: "web_search", args: { query: "reactive agents" } },
    ]);
    expect(executed).toContain("umami/get_website_stats");
    expect(executed).toContain("web-search");
    expect(executed).not.toContain("umami_get_website_stats");
    expect(executed).not.toContain("web_search");
    // The kernel's records carry the real names, and no call was refused.
    const actionNames = pass.steps
      .filter((s) => s.type === "action")
      .map((s) => (s.metadata?.toolCall as { name?: string } | undefined)?.name);
    expect(actionNames).toContain("umami/get_website_stats");
    expect(actionNames).toContain("web-search");
    const refused = pass.steps.filter((s) => String(s.content ?? "").includes("is not available in this run"));
    expect(refused).toHaveLength(0);
  });

  it("handleActing heals a raw separator-variant call (no think-phase resolver) and runs the real tool", async () => {
    // Drives act directly with the UNRESOLVED name on pendingNativeToolCalls,
    // so the end-to-end case above cannot pass on the think-phase resolver
    // alone: this pins act's own heal-before-guard ordering.
    const executed: string[] = [];
    const toolService: Option.Option<ToolServiceInstance> = Option.some({
      execute: (req) => Effect.sync(() => {
        executed.push(req.toolName);
        return { success: true, result: { ok: true } };
      }),
      getTool: () => Effect.fail("no schema"),
      listTools: () => Effect.succeed([]),
    });
    const base = initialKernelState(opts);
    const state: KernelState = {
      ...base,
      status: "acting",
      meta: {
        ...base.meta,
        pendingNativeToolCalls: [{ id: "tc-1", name: "umami_get_website_stats", arguments: { websiteId: "w1" } }],
        lastThought: "Fetch the stats.",
      },
    };
    const profile = CONTEXT_PROFILES["mid"];
    const context: KernelContext = {
      input: input(SCHEMAS),
      profile,
      compression: { budget: profile.toolResultMaxChars ?? 800, previewItems: 3, autoStore: true, codeTransform: true },
      toolService,
      memoryService: Option.none(),
      hooks: noopHooks,
      toolCallingDriver: new NativeFCDriver(),
    };
    const next = await Effect.runPromise(handleActing(state, context).pipe(Effect.provide(TestLLMServiceLayer())));
    expect(executed).toEqual(["umami/get_website_stats"]);
    const action = next.steps.find((s) => s.type === "action");
    expect((action?.metadata?.toolCall as { name?: string } | undefined)?.name).toBe("umami/get_website_stats");
    expect(next.steps.some((s) => String(s.content ?? "").includes("is not available in this run"))).toBe(false);
  });

  it("act's heal stage hands availableToolGuard the resolved name (the guard itself stays exact)", () => {
    const kernelInput = input(SCHEMAS);
    const state = initialKernelState(opts);
    for (const [called, real] of [["umami_get_website_stats", "umami/get_website_stats"], ["web_search", "web-search"]] as const) {
      const raw = { id: "c1", name: called, arguments: {} };
      const healed = runHealingPipeline(raw, SCHEMAS, new Set<string>(), "/tmp", {}, {});
      expect(healed.succeeded).toBe(true);
      expect(healed.call.name).toBe(real);
      expect(availableToolGuard(healed.call, state, kernelInput)).toEqual({ pass: true });
    }
  });

  it("a genuinely unknown name is not healed, never runs, and the guard refuses it with the existing message", async () => {
    const { executed } = await runWith(SCHEMAS, [{ name: "fetch_weather_report", args: {} }]);
    expect(executed).toHaveLength(0);
    const raw = { id: "c1", name: "fetch_weather_report", arguments: {} };
    expect(runHealingPipeline(raw, SCHEMAS, new Set<string>(), "/tmp", {}, {}).succeeded).toBe(false);
    const outcome = availableToolGuard(raw, initialKernelState(opts), input(SCHEMAS));
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.observation).toContain('Tool "fetch_weather_report" is not available in this run.');
  });
});
