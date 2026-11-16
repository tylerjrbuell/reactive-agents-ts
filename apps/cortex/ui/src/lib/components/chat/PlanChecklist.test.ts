/** Server-render of the plan checklist: read-only shows status and tool hints, editable adds the controls. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "../kit/test-render.js";
import type { DraftStep } from "$lib/plan-edit.js";

const file = join(import.meta.dir, "PlanChecklist.svelte");
const steps: DraftStep[] = [
  { id: "1", title: "Read config", status: "done" },
  { id: "2", title: "Write the fix", status: "in-progress", tool: "file-write" },
];
const markup = (html: string): string => html.replace(/<!--[^]*?-->/g, "");

describe("PlanChecklist", () => {
  test("read-only: each step with its status label and tool hint, no controls", async () => {
    const html = markup(await renderComponent(file, { steps, idBase: "t" }));
    expect(html).toContain("Read config");
    expect(html).toContain('aria-label="done"');
    expect(html).toContain('aria-label="in progress"');
    expect(html).toContain("file-write");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Remove step");
  });

  test("editable: a title and tool input, move and remove buttons per step, and an add form", async () => {
    const html = markup(await renderComponent(file, { steps, idBase: "t", editable: true }));
    expect(html).toContain('aria-label="Step 1 title"');
    expect(html).toContain('aria-label="Step 2 tool"');
    expect(html).toContain('aria-label="Move step 1 up"');
    expect(html).toMatch(/aria-label="Move step 1 up"[^>]*disabled/);
    expect(html).toContain('aria-label="Remove step 2"');
    expect(html).toContain('data-testid="plan-add-step"');
    expect(html).toContain('value="Read config"');
  });
});
