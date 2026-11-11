// Run: bun test packages/runtime/tests/server/with-user-interaction.test.ts --timeout 15000
//
// Task 11 — `.withUserInteraction()` builder method. Since 2026-11-11 it no
// longer requires `.withDurableRuns()`: without a durable store a
// request_user_input question waits live (see tests/live-ask-user.test.ts);
// with one it pauses durably.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgentBuilder } from "../../src/builder.js";

describe(".withUserInteraction()", () => {
  test("build() succeeds without durable runs (live questions)", async () => {
    const agent = await new ReactiveAgentBuilder()
      .withName("no-durable")
      .withProvider("test")
      .withUserInteraction()
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
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
