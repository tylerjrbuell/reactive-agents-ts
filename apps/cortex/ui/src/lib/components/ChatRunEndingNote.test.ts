/** One card per stop: a reply that hit its step limit shows the generic run-error note only when no Continue card replaces it. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "./kit/test-render.js";

const file = join(import.meta.dir, "ChatRunEndingNote.svelte");
const outcome = { ending: "failed" as const, terminatedBy: "max_iterations", error: "max_iterations" };

describe("ChatRunEndingNote vs the Continue card", () => {
  test("a step-limit failure shows the run-error note when no Continue card is offered", async () => {
    const html = await renderComponent(file, { outcome });
    expect(html).toContain('data-testid="chat-run-ending"');
  });

  test("the same stop draws no note when the Continue card (budget) is offered", async () => {
    const html = await renderComponent(file, { outcome, continueOffered: "budget" });
    expect(html).not.toContain('data-testid="chat-run-ending"');
  });

  test("a stop by the person: the Continue card replaces the inline note; without it the note and Retry stay", async () => {
    const stopped = { ending: "partial" as const, interruptedBy: "user" as const, unfinished: [] };
    const kept = await renderComponent(file, { outcome: stopped, onRetry: () => {} });
    expect(kept).toContain("Stopped by you");
    expect(kept).toContain("Retry");
    const dropped = await renderComponent(file, { outcome: stopped, continueOffered: "user-stopped" });
    expect(dropped).not.toContain('data-testid="chat-run-ending"');
  });

  test("a different stop kind keeps its note", async () => {
    const html = await renderComponent(file, { outcome, continueOffered: "error" });
    expect(html).toContain('data-testid="chat-run-ending"');
  });
});
