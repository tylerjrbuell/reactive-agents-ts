/** Server-render of the continuation link: nothing for an ordinary run, links both ways for a chain. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "../kit/test-render.js";
import { runLinkOf } from "$lib/run-continuation.js";

const file = join(import.meta.dir, "RunContinuation.svelte");
const markup = (html: string): string => html.replace(/<!--[^]*?-->/g, "");

describe("RunContinuation", () => {
  test("an ordinary or older run draws nothing", async () => {
    expect(markup(await renderComponent(file, {}))).not.toContain("run-continuation");
  });

  test("a continuation names and links the run it continues", async () => {
    const html = markup(await renderComponent(file, { from: runLinkOf("PARENT1234567890") }));
    expect(html).toContain("continued from");
    expect(html).toContain('href="/run/PARENT1234567890"');
    expect(html).toContain("PARENT123456");
  });

  test("a continued run links to its continuations", async () => {
    const html = markup(await renderComponent(file, { into: [runLinkOf("A-cont-11111111"), runLinkOf("A-cont-22222222")] }));
    expect(html).toContain("continued 2 times");
    expect(html).toContain('href="/run/A-cont-11111111"');
    expect(html).toContain('href="/run/A-cont-22222222"');
  });
});
