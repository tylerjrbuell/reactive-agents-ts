// Run: bun test packages/runtime/tests/server/with-user-interaction.test.ts --timeout 15000
//
// Task 11 — `.withUserInteraction()` builder method + validation. Mirrors the
// approval-detach validation (builder.ts): the method requires .withDurableRuns()
// because interaction pauses persist to the durable store.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgentBuilder } from "../../src/builder.js";

describe(".withUserInteraction()", () => {
  test("build() fails without durable runs", async () => {
    await expect(
      new ReactiveAgentBuilder().withName("no-durable").withProvider("test").withUserInteraction().build(),
    ).rejects.toThrow(/durable/i);
  });

  test("build() succeeds with durable runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-wui-"));
    const agent = await new ReactiveAgentBuilder()
      .withName("with-durable")
      .withProvider("test")
      .withDurableRuns({ dir })
      .withUserInteraction()
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });
});
