/** Server-render of the approval card's parameters: rows always, the full-text expander only when a row loses something. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "../kit/test-render.js";

const file = join(import.meta.dir, "ApprovalParams.svelte");
const markup = (html: string): string => html.replace(/<!--[^]*?-->/g, "");

describe("ApprovalParams", () => {
  test("a short command shows its row and no expander", async () => {
    const html = markup(await renderComponent(file, { args: { command: "which gh; gh --version" } }));
    expect(html).toMatch(/<dt[^>]*>command<\/dt>/);
    expect(html).toContain("which gh; gh --version");
    expect(html).not.toContain("approval-params-toggle");
  });

  test("a long or structured value shows the summary rows and a toggle, not the full text", async () => {
    const html = markup(await renderComponent(file, { args: { content: `${"z".repeat(220)}\nline2`, token: "Bearer sk-abcdefghijklmnop12345" } }));
    expect(html).toContain('data-testid="approval-params"');
    expect(html).toContain("Show full parameters");
    expect(html).not.toContain('data-testid="approval-params-full"');
    expect(html).not.toContain("z".repeat(220));
    expect(html).not.toContain("sk-abcdefghijklmnop12345");
  });

  test("expanded: the full text replaces the summary rows (never both), every character, no secret", async () => {
    const html = markup(await renderComponent(file, { args: { content: `${"z".repeat(220)}\nline2`, token: "Bearer sk-abcdefghijklmnop12345" }, open: true }));
    expect(html).toContain('data-testid="approval-params-full"');
    expect(html).not.toContain('data-testid="approval-params"');
    expect(html).toContain("Show summary");
    expect(html).toContain("z".repeat(220));
    expect(html).not.toContain("sk-abcdefghijklmnop12345");
  });

  test("no parameters draw nothing", async () => {
    expect(markup(await renderComponent(file, { args: null })).trim()).toBe("");
  });
});
