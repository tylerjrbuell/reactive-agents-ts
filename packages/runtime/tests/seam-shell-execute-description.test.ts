// Run: bun test packages/runtime/tests/seam-shell-execute-description.test.ts --timeout 15000
//
// Seam pin: the runtime registers `shell-execute` with the definition built by
// `shellExecuteToolFor(terminalConfig, { runWorkspace: true })`
// (`builder/build-effect/tool-init-layer.ts`), not the static default. The
// description is what the model reads about where commands run; the static text
// said "sandboxed /tmp" while the handler ran in the run's workspace (owner
// Cortex report 2026-11-06).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import type { ReactiveAgent } from "../src/index.js";
import { ToolService } from "@reactive-agents/tools";

/** Read the `shell-execute` description from the SAME ToolService the agent runs. */
async function shellDescription(agent: ReactiveAgent): Promise<string> {
  return agent.runtime.runPromise(
    Effect.gen(function* () {
      const ts = yield* ToolService;
      return yield* ts.getTool("shell-execute").pipe(
        Effect.map((def) => def.description),
        Effect.catchAll(() => Effect.succeed("<not registered>")),
      );
    }),
  );
}

describe("seam: shell-execute registered description follows the terminal config", () => {
  it("terminal + workspace: description names the run's workspace, not a /tmp sandbox", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "ra-shell-desc-pin-"));
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTools({ terminal: true, workspace })
      .build();
    try {
      const description = await shellDescription(agent);
      expect(description).toContain("Runs in the run's workspace directory");
      expect(description).not.toContain("sandboxed /tmp");
    } finally {
      await agent.dispose();
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 15000);

  it("terminal, no workspace: description states the temp-dir fallback truthfully", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTools({ terminal: true })
      .build();
    try {
      const description = await shellDescription(agent);
      expect(description).toContain(
        "with no workspace set, in a private temporary directory under /tmp",
      );
      expect(description).not.toContain("sandboxed /tmp");
    } finally {
      await agent.dispose();
    }
  }, 15000);

  it("terminal config reaches the description (cwd and additionalCommands)", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTools({ terminal: { cwd: "sub", additionalCommands: ["env"] } })
      .build();
    try {
      const description = await shellDescription(agent);
      expect(description).toContain(`Runs in "sub" inside the run's workspace directory`);
      expect(description).toMatch(/Allowed commands: [^.]*\benv\b/);
    } finally {
      await agent.dispose();
    }
  }, 15000);
});
