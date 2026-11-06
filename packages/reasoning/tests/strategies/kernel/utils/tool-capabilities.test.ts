import { describe, expect, it } from "bun:test";
import { Effect, Ref } from "effect";
import { ToolService, createToolsLayer, currentDiscoveredToolsStore } from "@reactive-agents/tools";
import {
  resolveExecutableToolCapabilities,
  taskRelevantToolNames,
} from "../../../../src/kernel/capabilities/act/tool-capabilities.js";
import type { ToolSchema } from "../../../../src/kernel/capabilities/attend/tool-formatting.js";
import { resolveHarnessConfig } from "../../../../src/harness-config.js";

describe("resolveExecutableToolCapabilities", () => {
  it("registers ToolService-backed meta-tools before advertising them", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* resolveExecutableToolCapabilities({
          availableToolSchemas: [
            { name: "file-read", description: "Read a file", parameters: [] },
          ],
          metaTools: { recall: true, find: true },
        });
        const toolService = yield* ToolService;
        const registered = yield* toolService.listTools();
        return {
          snapshotNames: snapshot.availableToolSchemas.map((tool) => tool.name),
          registeredNames: registered.map((tool) => tool.name),
        };
      }).pipe(Effect.provide(createToolsLayer())),
    );

    expect(result.snapshotNames).toContain("recall");
    expect(result.snapshotNames).toContain("find");
    expect(result.registeredNames).toContain("recall");
    expect(result.registeredNames).toContain("find");
  });

  it("keeps inline meta-tools executable without ToolService", async () => {
    const snapshot = await Effect.runPromise(
      resolveExecutableToolCapabilities({
        availableToolSchemas: [
          { name: "file-read", description: "Read a file", parameters: [] },
        ],
        metaTools: { brief: true, pulse: true, recall: true, find: true },
      }),
    );

    const names = snapshot.availableToolSchemas.map((tool) => tool.name);
    expect(names).toContain("brief");
    expect(names).toContain("pulse");
    expect(names).not.toContain("recall");
    expect(names).not.toContain("find");
  });

  it("deduplicates tools by name", async () => {
    const snapshot = await Effect.runPromise(
      resolveExecutableToolCapabilities({
        availableToolSchemas: [
          { name: "brief", description: "existing", parameters: [] },
        ],
        metaTools: { brief: true },
      }),
    );

    expect(snapshot.availableToolSchemas.filter((tool) => tool.name === "brief")).toHaveLength(1);
    expect(snapshot.allToolSchemas.filter((tool) => tool.name === "brief")).toHaveLength(1);
  });
});

// Spike 2026-11-06: discover-tools ranked only the model's query, so a task
// needing two capabilities loaded one. The kernel's one relevance scorer now
// feeds the handler the task-relevant names (synthetic catalog below).
describe("discover-tools gets task-relevant names from the kernel scorer", () => {
  const CATALOG: readonly ToolSchema[] = [
    { name: "crypto-price", description: "Get current crypto prices for a coin symbol", parameters: [] },
    { name: "web-search", description: "Search the web for research on market trends", parameters: [] },
    { name: "calendar-events", description: "List calendar events", parameters: [] },
    { name: "recall", description: "Recall stored research results", parameters: [] },
  ];
  const TASK = "Get the BTC crypto price and search the web for research on market trends";

  const discover = (task: string | undefined) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* resolveExecutableToolCapabilities({
          availableToolSchemas: [],
          allToolSchemas: CATALOG,
          harness: resolveHarnessConfig({ toolDiscovery: true }),
          ...(task === undefined ? {} : { task }),
        });
        const toolService = yield* ToolService;
        const out = yield* toolService.execute({
          toolName: "discover-tools",
          arguments: { query: "crypto prices" },
          agentId: "test-agent",
          sessionId: "test-session",
        });
        const discovered = yield* Ref.get(yield* currentDiscoveredToolsStore);
        return { text: String(out.result), discovered };
      }).pipe(Effect.provide(createToolsLayer())),
    );

  it("a query naming one capability also loads the task's other needed tool", async () => {
    const { text, discovered } = await discover(TASK);
    expect(text).toContain("- web-search(");
    expect(discovered.has("crypto-price")).toBe(true);
    expect(discovered.has("web-search")).toBe(true);
    expect(discovered.has("calendar-events")).toBe(false);
  });

  it("no task: query-only answer, nothing extra discovered", async () => {
    const { text, discovered } = await discover(undefined);
    expect(text).not.toContain("web-search");
    expect(discovered.has("web-search")).toBe(false);
  });

  it("the accessor excludes META tools, keeps scorer order, and scores once", () => {
    const names = taskRelevantToolNames(TASK, CATALOG);
    const first = names();
    expect(first).toContain("crypto-price");
    expect(first).toContain("web-search");
    expect(first).not.toContain("recall");
    expect(names()).toBe(first);
    expect(taskRelevantToolNames("   ", CATALOG)()).toEqual([]);
  });
});