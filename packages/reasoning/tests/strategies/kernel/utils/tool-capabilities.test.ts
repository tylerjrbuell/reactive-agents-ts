import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { resolveExecutableToolCapabilities } from "../../../../src/kernel/capabilities/act/tool-capabilities.js";

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