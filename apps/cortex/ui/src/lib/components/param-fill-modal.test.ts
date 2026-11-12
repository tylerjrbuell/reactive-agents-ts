/**
 * ParamFillModal renders on the kit (Overlay, Field, Input/Select/Textarea,
 * Button). Server rendering runs no effects, so this is the first paint
 * before the seeding effect: every field must render with an empty value
 * (a bound `undefined` throws `props_invalid_value` in the kit inputs).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "./kit/test-render.js";
import type { VariableDef } from "../types/agent-config.js";

const modal = join(import.meta.dir, "ParamFillModal.svelte");
const vars: VariableDef[] = [
  { name: "topic", type: "string", required: true, description: "What to write about" },
  { name: "tone", type: "enum", required: false, enumValues: ["plain", "formal"] },
  { name: "notes", type: "multiline", required: false },
];
const noop = () => {};

describe("ParamFillModal", () => {
  test("renders every variable as a labelled kit field before seeding", async () => {
    const html = await renderComponent(modal, { open: true, variables: vars, previewPayload: {}, onConfirm: noop, onCancel: noop });
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Fill run variables");
    expect(html).toMatch(/<label for="param-fill-0"[^>]*>topic<\/label>/);
    expect(html).toMatch(/<label for="param-fill-1"[^>]*>tone \(optional\)<\/label>/);
    expect(html).toMatch(/<input id="param-fill-0" type="text" value=""/);
    expect(html).toContain("What to write about");
    expect(html).toContain("cx-control");
    expect(html).toContain("<textarea");
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain("<select");
  });

  test("labels are sentence case, never uppercase or under 11px", async () => {
    const html = await renderComponent(modal, { open: true, variables: vars, previewPayload: {}, onConfirm: noop, onCancel: noop });
    expect(html).not.toMatch(/\buppercase\b/);
    expect(html).not.toMatch(/text-\[(?:[0-9]|10)px\]/);
  });

  test("closed: renders nothing", async () => {
    const html = await renderComponent(modal, { open: false, variables: vars, previewPayload: {}, onConfirm: noop, onCancel: noop });
    expect(html).not.toContain('role="dialog"');
  });
});
