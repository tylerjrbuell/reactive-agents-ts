/** Server-render pin: the stop card lists what is left as a bulleted list, not a comma run-on. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "./kit/test-render.js";

describe("ContinueStopped", () => {
  test("'Left to do' is a list with trailing periods stripped, capped at 5 plus 'and N more'", async () => {
    const unfinished = ["Check pager settings (on-call).", "Retrieve the rota.", "Draft the summary", "Send it.", "File the ticket.", "Archive.", "Close out."];
    const html = await renderComponent(join(import.meta.dir, "ContinueStopped.svelte"), {
      kind: "user-stopped",
      stop: { kind: "user-stopped", reason: "user", toolsDone: [], unfinished, iteration: 3 },
      onContinue: () => {},
    });
    const items = [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
    expect(items).toEqual(["Check pager settings (on-call)", "Retrieve the rota", "Draft the summary", "Send it", "File the ticket", "and 2 more"]);
    expect(html).not.toContain("., ");
  });
});
