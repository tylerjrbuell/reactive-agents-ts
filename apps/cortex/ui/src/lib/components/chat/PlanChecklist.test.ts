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

  test("read-only: dependsOn and args show as chips by step position", async () => {
    const html = markup(await renderComponent(file, { steps, idBase: "t", extras: { "2": { dependsOn: ["1"], args: { path: "a" } } } }));
    expect(html).toContain("after 1");
    expect(html).toContain('data-testid="plan-step-args"');
  });

  test("editable: each step has a hidden dependencies-and-args editor with the other steps to tick and a JSON field", async () => {
    const html = markup(await renderComponent(file, { steps, idBase: "t", editable: true, extras: { "2": { dependsOn: ["1"], args: { path: "a" } } } }));
    expect(html).toContain('data-testid="plan-step-extras"');
    // Closed until its chip is clicked: no vertical space.
    expect(html.match(/<div class="extras[^"]*"[^>]*>/g)?.every((d) => /\shidden/.test(d))).toBe(true);
    expect(html).toContain("Step 2 waits for");
    expect(html).toMatch(/<input type="checkbox"[^>]*checked[^>]*>\s*<span>1\. Read config/);
    expect(html).toContain('"path": "a"');
  });

  test("editable: the tool is a dropdown (not free text) that keeps a hinted name visible", async () => {
    const html = markup(await renderComponent(file, { steps, idBase: "t", editable: true }));
    expect(html).toMatch(/<button[^>]*role="combobox"[^>]*aria-label="Step 2 tool"[^]*?file-write/);
    expect(html).not.toMatch(/<input[^>]*aria-label="Step 2 tool"/);
  });

  test("editable: a step with no tool shows a quiet '+ tool' instead of a full select", async () => {
    const html = markup(await renderComponent(file, { steps, idBase: "t", editable: true }));
    expect(html).not.toContain('aria-label="Step 1 tool"');
    // Only step 1 (no tool) gets the add chip; step 2 has its pick list.
    expect(html.match(/add-tool/g)).toHaveLength(1);
  });

  test("editable: the dependencies/args chip is one inline control per step: its words by position, collapsed", async () => {
    const html = markup(await renderComponent(file, { steps, idBase: "t", editable: true, extras: { "2": { dependsOn: ["1"], args: { path: "a" } } } }));
    expect(html.match(/data-testid="plan-step-extras-toggle"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-controls="t-x-2"[^>]*>after 1 · args</);
    expect(html).toMatch(/aria-controls="t-x-1"[^>]*>deps \/ args</);
    expect(html).not.toContain('aria-expanded="true"');
  });

  test("each step is one line; the editor is a sibling below it, never inside it", async () => {
    const html = markup(await renderComponent(file, { steps, idBase: "t", editable: true }));
    expect(html.match(/<div class="line[ "]/g)).toHaveLength(2);
    expect(html).not.toMatch(/<details/);
  });

  test("read-only is a plain dense row: no chip button, no editor", async () => {
    const html = markup(await renderComponent(file, { steps, idBase: "t", extras: { "2": { dependsOn: ["1"] } } }));
    expect(html).not.toContain("plan-step-extras");
    expect(html).not.toContain("<button");
    expect(html).toMatch(/class="step[^"]*\bro\b/);
  });
});
