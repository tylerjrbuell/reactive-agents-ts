/**
 * Rendering tests for Beacon's Board pieces (Bench step 5): live cards carry
 * the live glow, gradient edge and entropy line; at-rest cards never glow; a
 * waiting agent says "Waiting on you"; the view switch is a pressed-state toggle.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "../kit/test-render.js";
import type { AgentRow, BoardModel, LiveCard } from "../../beacon-board.js";

const at = (name: string): string => join(import.meta.dir, `${name}.svelte`);
const markup = (html: string): string => html.replace(/<!--[^]*?-->/g, "");
const text = (html: string): string => markup(html).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const NOW = 1_700_000_000_000;

const card: LiveCard = {
  runId: "run-1",
  name: "Crypto market report",
  source: "chat",
  elapsedMs: 42_000,
  goal: "Retry SOL with a different source",
  activity: { verb: "Calling", tool: "http-get" },
  entropy: [0.2, 0.35, 0.62],
  loop: 3,
  max: 6,
  foot: "step 3 of 6 · 2.1k tok",
};

const row = (over: Partial<AgentRow>): AgentRow => ({
  runId: "run-2",
  name: "Hash function explainer",
  status: { tone: "done", label: "Finished" },
  source: "chat",
  last: "Explain hash functions",
  model: "mimo-v2.6",
  tokens: "2.5k tok",
  at: NOW - 7_200_000,
  ...over,
});

describe("BeaconLiveCard", () => {
  test("is live: glow, flowing rail, entropy line with η, live meter, Open link", async () => {
    const html = await renderComponent(at("BeaconLiveCard"), { card });
    expect(html).toContain("glow-live");
    expect(html).toContain("rail-live");
    expect(html).toContain("cx-meter-live");
    expect(html).toContain('href="/run/run-1"');
    expect(html).toMatch(/aria-label="Entropy per step: η 0\.62"/);
    const t = text(html);
    expect(t).toContain("Crypto market report");
    expect(t).toContain("42s");
    expect(t).toContain("Calling http-get");
    expect(t).toContain("step 3 of 6 · 2.1k tok");
    expect(t).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);
  });

  test("leaves out the meter and the entropy line when there is no data", async () => {
    const html = await renderComponent(at("BeaconLiveCard"), { card: { ...card, max: 0, entropy: [], foot: "" } });
    expect(html).not.toContain("cx-meter");
    expect(html).not.toContain("cx-entropy");
  });
});

describe("BeaconAgentCard", () => {
  test("an agent at rest never glows and shows source, last line and model", async () => {
    const html = await renderComponent(at("BeaconAgentCard"), { row: row({}), now: NOW });
    expect(html).not.toContain("glow-live");
    expect(html).toContain('data-tone="done"');
    const t = text(html);
    expect(t).toContain("Hash function explainer");
    expect(t).toContain("chat");
    expect(t).toContain("Explain hash functions");
    expect(t).toContain("mimo-v2.6");
    expect(t).toContain("2 hours ago");
  });

  test("a waiting agent shows its Waiting on you status instead of its source", async () => {
    const html = await renderComponent(at("BeaconAgentCard"), {
      row: row({ status: { tone: "attention", label: "Waiting on you" }, last: "Asked: which branch?" }),
      now: NOW,
    });
    expect(html).toContain('data-tone="warn"');
    expect(text(html)).toContain("Waiting on you");
    expect(text(html)).toContain("Asked: which branch?");
  });
});

describe("BeaconBoard", () => {
  const board: BoardModel = {
    live: [card],
    agents: [row({})],
    counts: { all: 1, "needs-you": 0, failed: 0, idle: 1 },
    total: 1,
  };

  test("renders Running now and Agents with the four filters", async () => {
    const html = await renderComponent(at("BeaconBoard"), { board, filter: "all", now: NOW, onfilter: () => {} });
    const t = text(html);
    expect(t).toContain("Running now");
    expect(t).toContain("Agents");
    for (const label of ["All", "Needs you", "Failed", "Idle"]) expect(t).toContain(label);
    expect(markup(html)).toMatch(/aria-pressed="true"[^>]*>\s*All/);
  });

  test("hides Running now when nothing runs, and says so when a filter matches nothing", async () => {
    const html = await renderComponent(at("BeaconBoard"), {
      board: { ...board, live: [], agents: [] },
      filter: "failed",
      now: NOW,
      onfilter: () => {},
    });
    expect(text(html)).not.toContain("Running now");
    expect(text(html)).toContain("No agents match");
  });
});

describe("BeaconViewSwitch", () => {
  test("marks the current view pressed", async () => {
    const html = markup(await renderComponent(at("BeaconViewSwitch"), { view: "field", onchange: () => {} }));
    expect(html).toMatch(/aria-pressed="false"[^>]*>Board/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Field/);
  });
});
