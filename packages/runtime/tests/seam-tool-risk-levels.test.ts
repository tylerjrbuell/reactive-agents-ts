// Run: bun test packages/runtime/tests/seam-tool-risk-levels.test.ts --timeout 20000
//
// Seam pin: `tool-risk-levels.ts` — the single application point for
// `.withTools({ riskLevels })`. The runtime's ToolService view must hand out
// overridden definitions from `listTools` and `getTool`, filter `listTools` by
// the OVERRIDDEN level, and leave the default path undecorated.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { ToolService, ToolServiceLive, type ToolDefinition } from "@reactive-agents/tools";
import {
  applyRiskLevelOverride,
  riskLevelOverrideWarning,
  unknownRiskLevelToolNames,
  withRiskLevelOverrides,
} from "../src/tool-risk-levels.js";
import { buildToolsLayer } from "../src/runtime-tools-layer.js";
import {
  agentConfigToBuilder,
  agentConfigToJSON,
  agentConfigFromJSON,
} from "../src/agent-config.js";
import { ReactiveAgents } from "../src/index.js";

const def = (name: string, riskLevel: ToolDefinition["riskLevel"]): ToolDefinition => ({
  name,
  description: `Tool ${name}`,
  parameters: [],
  riskLevel,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
});

const withService = <A>(
  f: (ts: ToolService["Type"]) => Effect.Effect<A, unknown>,
): Promise<A> =>
  Effect.runPromise(
    ToolService.pipe(
      Effect.flatMap(f),
      Effect.provide(ToolServiceLive.pipe(Layer.provide(EventBusLive))),
    ) as Effect.Effect<A, unknown>,
  );

describe("applyRiskLevelOverride", () => {
  it("replaces the level of a named tool and leaves others untouched", () => {
    const d = def("probe", "medium");
    expect(applyRiskLevelOverride(d, { probe: "low" }).riskLevel).toBe("low");
    expect(applyRiskLevelOverride(d, { other: "low" })).toBe(d);
  });

  it("does not read inherited keys as overrides", () => {
    const d = def("toString", "high");
    expect(applyRiskLevelOverride(d, {})).toBe(d);
  });
});

describe("withRiskLevelOverrides", () => {
  it("returns the base service when there are no overrides", async () => {
    await withService((ts) =>
      Effect.sync(() => {
        expect(withRiskLevelOverrides(ts, undefined)).toBe(ts);
        expect(withRiskLevelOverrides(ts, {})).toBe(ts);
      }),
    );
  });

  it("listTools, getTool and the riskLevel filter all see the override", async () => {
    const out = await withService((ts) =>
      Effect.gen(function* () {
        yield* ts.register(def("probe", "medium"), () => Effect.succeed("ok"));
        const view = withRiskLevelOverrides(ts, { probe: "low", "file-read": "low" });
        const listed = (yield* view.listTools()).find((t) => t.name === "probe");
        const got = yield* view.getTool("probe");
        const lowNames = (yield* view.listTools({ riskLevel: "low" })).map((t) => t.name);
        const mediumNames = (yield* view.listTools({ riskLevel: "medium" })).map((t) => t.name);
        const builtin = yield* view.getTool("file-read");
        const raw = yield* ts.getTool("probe");
        return { listed, got, lowNames, mediumNames, builtin, raw };
      }),
    );
    expect(out.listed?.riskLevel).toBe("low");
    expect(out.got.riskLevel).toBe("low");
    expect(out.lowNames).toContain("probe");
    expect(out.lowNames).toContain("file-read");
    expect(out.mediumNames).not.toContain("probe");
    expect(out.builtin.riskLevel).toBe("low");
    // The registry itself is not mutated — the override is a view.
    expect(out.raw.riskLevel).toBe("medium");
  });
});

describe("buildToolsLayer applies riskLevels", () => {
  const levelOf = (layer: Layer.Layer<ToolService> | null, name: string) =>
    Effect.runPromise(
      ToolService.pipe(
        Effect.flatMap((ts) => ts.getTool(name)),
        Effect.map((d) => d.riskLevel),
        Effect.provide(layer!),
      ),
    );

  it("with and without allowedTools", async () => {
    const bus = EventBusLive;
    expect(await levelOf(buildToolsLayer({ enableTools: true }, bus), "file-read")).toBe("medium");
    expect(
      await levelOf(
        buildToolsLayer({ enableTools: true, riskLevels: { "file-read": "low" } }, bus),
        "file-read",
      ),
    ).toBe("low");
    expect(
      await levelOf(
        buildToolsLayer(
          { enableTools: true, allowedTools: ["file-read"], riskLevels: { "file-read": "low" } },
          bus,
        ),
        "file-read",
      ),
    ).toBe("low");
  });
});

describe("unknown names", () => {
  it("names only overrides that match no statically known tool", () => {
    expect(
      unknownRiskLevelToolNames({
        riskLevels: { "file-read": "low", recall: "low", mine: "high", helper: "low", "shell-execute": "high", nope: "low" },
        customToolNames: ["mine"],
        agentToolNames: ["helper"],
        terminal: true,
      }),
    ).toEqual(["nope"]);
    expect(
      unknownRiskLevelToolNames({ riskLevels: undefined, customToolNames: [], agentToolNames: [], terminal: false }),
    ).toEqual([]);
  });

  it("warning text is undefined when nothing is unknown and mentions MCP when configured", () => {
    expect(riskLevelOverrideWarning([], false)).toBeUndefined();
    expect(riskLevelOverrideWarning(["nope"], false)).toContain('"nope"');
    expect(riskLevelOverrideWarning(["srv/x"], true)).toContain("MCP");
  });
});

describe("builder surface", () => {
  it("toConfig round-trips riskLevels", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withTools({ riskLevels: { "file-read": "low" } });
    const config = builder.toConfig();
    expect(config.tools?.riskLevels).toEqual({ "file-read": "low" });
    const back = agentConfigFromJSON(agentConfigToJSON(config));
    expect(back.tools?.riskLevels).toEqual({ "file-read": "low" });
  });

  it("the declarative config reaches the builder", async () => {
    const builder = await agentConfigToBuilder({
      name: "risk-config",
      provider: "test",
      tools: { riskLevels: { "file-read": "low" } },
    });
    expect(builder.toConfig().tools?.riskLevels).toEqual({ "file-read": "low" });
  });

  it("an unknown tool name warns at build and does not throw", async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const agent = await ReactiveAgents.create()
        .withProvider("test")
        .withTools({ riskLevels: { "no-such-tool": "low" } })
        .build();
      await agent.dispose();
    } finally {
      console.warn = original;
    }
    expect(warnings.some((w) => w.includes('"no-such-tool"'))).toBe(true);
  }, 20000);
});
