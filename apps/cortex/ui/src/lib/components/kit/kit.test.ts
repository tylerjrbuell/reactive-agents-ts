/**
 * Rendering tests for the Bench kit (spec section 7): each component is
 * server-rendered and its accessible structure and token use are checked.
 * Pure logic lives in sibling `lib/*.ts` helpers with their own tests.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { htmlSnippet, renderComponent } from "./test-render.js";

const kit = (name: string): string => join(import.meta.dir, `${name}.svelte`);
/** HTML without Svelte's hydration comment markers. */
const markup = (html: string): string => html.replace(/<!--[^]*?-->/g, "");
const text = (html: string): string => markup(html).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const kids = (label: string) => htmlSnippet(`<span>${label}</span>`);

describe("Button", () => {
  test("a typed button with variant and leading icon", async () => {
    const html = await renderComponent(kit("Button"), { variant: "primary", icon: "send", children: kids("Send") });
    expect(html).toContain('<button type="button"');
    expect(html).toContain("cx-btn-primary");
    expect(html).toContain('data-icon="send"');
    expect(text(html)).toBe("Send");
  });

  test("href renders a link; extra attributes pass through", async () => {
    const link = await renderComponent(kit("Button"), { href: "/chat", children: kids("Open a chat") });
    expect(markup(link)).toMatch(/^<a href="\/chat"/);
    const disabled = await renderComponent(kit("Button"), { disabled: true, "aria-describedby": "x", children: kids("Go") });
    expect(disabled).toContain("disabled");
    expect(disabled).toContain('aria-describedby="x"');
  });
});

describe("IconButton", () => {
  test("label is the accessible name; the Cortex tooltip, never a native title; no ligature text", async () => {
    const html = await renderComponent(kit("IconButton"), { icon: "settings", label: "Settings" });
    expect(html).toContain('aria-label="Settings"');
    expect(html).not.toContain("title=");
    expect(text(html)).toBe("");
  });

  test("pressed makes a toggle", async () => {
    expect(await renderComponent(kit("IconButton"), { icon: "trace", label: "Trace", pressed: true })).toContain('aria-pressed="true"');
  });
});

describe("Chip", () => {
  test("a label without onclick, a pressed button with it", async () => {
    const plain = await renderComponent(kit("Chip"), { data: true, children: kids("qwen3:4b") });
    expect(markup(plain)).toMatch(/^<span/);
    expect(plain).toContain("cx-chip-data");
    const button = await renderComponent(kit("Chip"), { on: true, onclick: () => {}, children: kids("ReAct") });
    expect(button).toContain('<button type="button"');
    expect(button).toContain('aria-pressed="true"');
  });
});

describe("Badge", () => {
  test("tone class and data attribute", async () => {
    const html = await renderComponent(kit("Badge"), { tone: "bad", children: kids("2 failed") });
    expect(html).toContain("cx-badge-bad");
    expect(html).toContain('data-tone="bad"');
    expect(text(html)).toBe("2 failed");
  });
});

describe("Status", () => {
  test("dot plus label for a ui-core tone", async () => {
    const html = await renderComponent(kit("Status"), { tone: "running", label: "Running" });
    expect(html).toContain("cx-tone-running");
    expect(html).toContain('aria-hidden="true"');
    expect(text(html)).toBe("Running");
  });

  test("dotOnly keeps the label for screen readers", async () => {
    const html = await renderComponent(kit("Status"), { tone: "failed", label: "Failed", dotOnly: true });
    expect(html).toContain("cx-sr-only");
    expect(text(html)).toBe("Failed");
  });
});

describe("Panel", () => {
  test("header with title and actions; live adds the glow", async () => {
    const html = await renderComponent(kit("Panel"), {
      title: "Answer",
      live: true,
      actions: htmlSnippet("<button>Copy</button>"),
      children: kids("body"),
    });
    expect(html).toContain("<h2");
    expect(html).toContain("glow-live");
    expect(html).toContain('data-live="true"');
    expect(text(html)).toBe("Answer Copy body");
  });

  test("no live glow at rest", async () => {
    expect(await renderComponent(kit("Panel"), { children: kids("x") })).not.toContain("glow-live");
  });
});

describe("PageHeader", () => {
  test("h1, description and the header band by default", async () => {
    const html = await renderComponent(kit("PageHeader"), { title: "Runs", description: "Every run, newest first." });
    expect(html).toContain("<h1");
    expect(html).toContain("band");
    expect(text(html)).toBe("Runs Every run, newest first.");
  });

  test("band can be turned off", async () => {
    const html = await renderComponent(kit("PageHeader"), { title: "Settings", band: false });
    expect(html).not.toMatch(/class="[^"]*\bband\b/);
  });
});

describe("Tabs", () => {
  test("a tablist with one selected, roving tabindex, counts and panel ids", async () => {
    const html = await renderComponent(kit("Tabs"), {
      items: [
        { id: "summary", label: "Summary" },
        { id: "events", label: "Events", count: 4 },
      ],
      value: "events",
      label: "Run inspector",
      idBase: "run",
    });
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Run inspector"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toMatch(/id="run-tab-events"[^>]*aria-selected="true"[^>]*aria-controls="run-panel-events"[^>]*tabindex="0"/);
    expect(html).toMatch(/id="run-tab-summary"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(text(html)).toBe("Summary Events 4");
  });
});

describe("Field family", () => {
  test("Field labels its control and shows the hint", async () => {
    const html = await renderComponent(kit("Field"), { id: "ws", label: "Workspace", hint: "An absolute path.", children: kids("ctl") });
    expect(html).toMatch(/<label for="ws"[^>]*>Workspace<\/label>/);
    expect(html).toContain('id="ws-hint"');
  });

  test("Field shows an error in place of the hint", async () => {
    const html = await renderComponent(kit("Field"), { id: "ws", label: "Workspace", hint: "h", error: "Not a directory", children: kids("ctl") });
    expect(html).toContain('id="ws-error"');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("ws-hint");
  });

  test("Input, Select and Textarea share the control look", async () => {
    const input = await renderComponent(kit("Input"), { id: "a", value: "x", mono: true, invalid: true, describedBy: "a-error" });
    expect(input).toContain("cx-control");
    expect(input).toContain("cx-mono");
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="a-error"');
    const select = await renderComponent(kit("Select"), { id: "b", value: "2", options: [{ value: "1", label: "One" }, { value: "2", label: "Two" }] });
    expect(select).toContain("cx-control");
    expect(select.match(/<option/g)).toHaveLength(2);
    const area = await renderComponent(kit("Textarea"), { id: "c", value: "hi", rows: 3 });
    expect(area).toContain('rows="3"');
    expect(area).toContain("cx-control");
  });

  test("Switch is a labelled role=switch", async () => {
    const html = await renderComponent(kit("Switch"), { id: "motion", label: "Reduce motion", checked: true, hint: "Stops the drift." });
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-labelledby="motion-label"');
    expect(html).toContain('aria-describedby="motion-hint"');
  });
});

describe("EmptyState", () => {
  test("hero brandWord: only the brand word takes the gradient; body replaces description", async () => {
    const html = await renderComponent(kit("EmptyState"), {
      hero: true,
      title: "Welcome to",
      brandWord: "Cortex",
      description: "unused",
      body: htmlSnippet("<span>Point an app at Cortex.</span>"),
    });
    expect(markup(html)).toMatch(/<h2[^>]*>Welcome to <span class="brand-grad[^"]*">Cortex<\/span><\/h2>/);
    expect(text(html)).toContain("Point an app at Cortex.");
    expect(text(html)).not.toContain("unused");
  });

  test("plain: icon, h3 and copy, no mark", async () => {
    const html = await renderComponent(kit("EmptyState"), { title: "No events yet", description: "They appear as the run works.", icon: "steps" });
    expect(html).toContain("<h3");
    expect(html).not.toContain("cx-mark");
  });

  test("hero: the neural mark, a gradient headline and actions", async () => {
    const html = await renderComponent(kit("EmptyState"), {
      hero: true,
      brand: true,
      title: "Welcome to Cortex",
      actions: htmlSnippet("<a href='/chat'>Open a chat</a>"),
    });
    expect(html).toContain("cx-mark-hero");
    expect(html).toContain("<h2");
    expect(html).toContain("brand-grad");
    expect(text(html)).toBe("Welcome to Cortex Open a chat");
  });
});

describe("Overlay", () => {
  test("renders nothing when closed", async () => {
    expect(text(await renderComponent(kit("Overlay"), { open: false, title: "Rename", onclose: () => {}, children: kids("x") }))).toBe("");
  });

  test("an open modal is a labelled dialog with a close button and a scrim", async () => {
    const html = await renderComponent(kit("Overlay"), { open: true, title: "Rename session", onclose: () => {}, children: kids("form") });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${labelledBy}"`);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('aria-label="Close Rename session"');
    expect(html).toContain('data-kind="modal"');
  });

  test("drawer kind", async () => {
    expect(await renderComponent(kit("Overlay"), { open: true, kind: "drawer", title: "Sub-agent", onclose: () => {}, children: kids("x") })).toContain(
      'data-kind="drawer"',
    );
  });
});

describe("Meter", () => {
  test("role=meter with value; signal only while live", async () => {
    const html = await renderComponent(kit("Meter"), { value: 3, max: 4, label: "Context used" });
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="75"');
    expect(html).toContain("width: 75%");
    expect(html).not.toContain("cx-meter-live");
    expect(await renderComponent(kit("Meter"), { value: 0.5, label: "Progress", live: true })).toContain("cx-meter-live");
  });
});

describe("EntropyLine", () => {
  test("a labelled image with the value printed beside it", async () => {
    const html = await renderComponent(kit("EntropyLine"), { values: [0.2, 0.6, 0.3], width: 64, height: 20 });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Entropy per step: η 0.30"');
    expect(html).toContain("<polyline");
    expect(text(html)).toBe("η 0.30");
  });

  test("a flat line (a steady signal) still paints: the gradient is in user space, not the zero-height bounding box", async () => {
    const html = await renderComponent(kit("EntropyLine"), { values: [0.25, 0.25], width: 64, height: 22 });
    expect(html).toContain('gradientUnits="userSpaceOnUse"');
    expect(html).toContain('x2="64"');
    expect(html).toContain("<polyline");
  });

  test("one sample is a dot and its value, not a band (no area, no line)", async () => {
    const html = await renderComponent(kit("EntropyLine"), { values: [0.25], width: 220, height: 48 });
    expect(html).not.toContain("<polygon");
    expect(html).not.toContain("<polyline");
    expect(html).toContain("<circle");
    expect(html).toContain('width="8"');
    expect(text(html)).toBe("η 0.25");
  });

  test("no data draws no line", async () => {
    const html = await renderComponent(kit("EntropyLine"), { values: [] });
    expect(html).not.toContain("<polyline");
    expect(text(html)).toBe("η —");
  });
});

describe("CortexDeskShell", () => {
  const shell = join(import.meta.dir, "..", "CortexDeskShell.svelte");
  test("ambient layer only when asked", async () => {
    expect(await renderComponent(shell, { children: kids("page") })).not.toContain("cortex-ambient");
    const on = await renderComponent(shell, { ambient: true, children: kids("page") });
    expect(on).toContain('data-testid="cortex-ambient"');
    expect(on).toContain('aria-hidden="true"');
  });
});
