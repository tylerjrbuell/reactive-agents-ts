/** Server-render of the quiet run notes: the to-do outcome with provenance, the unread-results note, the accepted finish. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runNotesOf } from "@reactive-agents/ui-core";
import { renderComponent } from "../kit/test-render.js";

const file = join(import.meta.dir, "RunNotes.svelte");
const markup = (html: string): string => html.replace(/<!--[^]*?-->/g, "");

const notes = runNotesOf({
  metadata: {
    extensions: {
      terminalOutcome: { authority: "strategy-accepted" },
      checklist: {
        total: 4,
        done: 2,
        closedByHarness: [
          { id: "1", title: "Search the web", provenance: "harness:evidence" },
          { id: "3", title: "Write the summary", provenance: "harness:answer" },
        ],
        unresolved: [{ id: "2", title: "Open the pricing page", status: "pending", reason: "no evidence" }],
      },
    },
  },
  receipt: { interventions: [{ actor: "unread-results-synthesis", evidence: "unread: web-search", whatChanged: "unread-results-synthesis: answer synthesized over x" }] },
});

describe("RunNotes", () => {
  test("renders the accepted finish, the unread note, harness closures with provenance and the unresolved list", async () => {
    const html = markup(await renderComponent(file, { notes }));
    expect(html).toContain('data-testid="run-note-accepted"');
    expect(html).toContain("Accepted by the strategy");
    expect(html).toContain('data-testid="run-note-unread"');
    expect(html).toContain("written from tool results the model had not read");
    expect(html).toContain("To-do 2/4");
    expect(html).toContain("1 of 4 to-do rows ended with no evidence");
    expect(html).toContain("closed by the harness from a tool result");
    expect(html).toContain("closed by the harness: the answer delivered it");
    expect(html).toContain('data-testid="run-note-unresolved"');
    expect(html).toContain("Open the pricing page");
    expect(html).toContain("no evidence recorded");
  });

  test("it is a note, not an alert: no error role or failure styling", async () => {
    const html = markup(await renderComponent(file, { notes }));
    expect(html).toContain('role="note"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("data-ending=\"failed\"");
  });

  test("renders nothing for a run with no notes, a plain authority, or an unknown one", async () => {
    expect(markup(await renderComponent(file, { notes: undefined }))).not.toContain("run-notes");
    expect(markup(await renderComponent(file, { notes: { authority: "model-final" } }))).not.toContain("run-notes");
    expect(markup(await renderComponent(file, { notes: { authority: "from-the-future" } }))).not.toContain("run-notes");
  });

  test("unresolved rows alone (a desk run's guard event) render without a closed list", async () => {
    const guardOnly = runNotesOf({ metadata: { extensions: { checklist: { total: 2, done: 1, closedByHarness: [], unresolved: [{ id: "2", title: "B", status: "pending", reason: "no evidence" }] } } } });
    const html = markup(await renderComponent(file, { notes: guardOnly }));
    expect(html).toContain("Unresolved");
    expect(html).not.toContain('data-testid="run-note-closed"');
  });
});
