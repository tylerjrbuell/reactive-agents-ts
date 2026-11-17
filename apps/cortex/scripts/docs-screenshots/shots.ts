/**
 * Shot definitions. A shot = id, where it goes, honest caption and alt text, and a
 * `capture` that drives the page into the state to photograph. Add one here, run
 * `screenshots:docs --only <id>`. Rules: README.md.
 */
import type { Page } from "playwright-core";

export const VIEWPORT = { width: 1440, height: 900 } as const;

/**
 * Text that differs between runs (random ids, pids, secret tails, measured timings) is replaced with a
 * fixed value just before the screenshot. Add a rule when `--check-determinism` reports a changed shot.
 */
export const MASKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/pid \d+/, "pid 4242"],
  [/••••[0-9a-f]{4}/, "••••0000"],
  [/\b\d+ms\b/, "9ms"],
  [/\b\d+ ms\b/, "9 ms"],
  [/\b(guard-fired|llm-exchange)#\d+/, "$1#100"],
  [/\bRan \d+s\b/, "Ran 1s"],
  [/\bch-[0-9a-f]{8}\b/, "ch-0a1b2c3d"],
  [/\b0[0-9A-Z]{25}\b/, "01HZZZZZZZZZZZZZZZZZZZZZZZ"],
  [/\bchat-0[0-9A-Z]{7}\b/, "chat-01HZZZZZ"],
  [/\b01[0-9A-Z]{10}\b/, "01HZZZZZZZZZ"],
  [/TTFT \d+ms/, "TTFT 12ms"],
  [/\b\d+(\.\d+)? tok\/s/, "0 tok/s"],
];

export interface ShotContext {
  readonly page: Page;
  readonly base: string;
  /** Id of a seeded chat by its name (see seed.ts). */
  sessionId(name: string): string;
  /** Id of the seeded run that ended failed (the step-budget run). */
  runId(): string;
}

/** A readability crop: a box in CSS px at 1x of the full capture, about 960x600, around the part that carries the story. */
export interface CropBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** One sentence for the manifest: what the crop shows (starts with a capital, ends with a period). */
  readonly shows: string;
}

export interface Shot {
  readonly id: string;
  /** `stable`: UI is final, captured by default. `pending`: UI still moving; only with `--only` or `--include-pending`. */
  readonly status: "stable" | "pending";
  readonly route: string;
  readonly caption: string;
  readonly alt: string;
  readonly width?: number;
  readonly height?: number;
  readonly scheme?: "dark" | "light";
  /** `empty`: a Cortex with no data (first-run views). Default `demo`: the seeded one. */
  readonly dataset?: "empty" | "demo";
  /** `full`: motion on (the capture must then freeze the animation at a fixed frame). Default `reduced`. */
  readonly motion?: "reduced" | "full";
  /**
   * Text nodes matching this are hidden (display none). For a readout that appears only some of the time
   * (a speed shown once a timer resolved), which would change the layout between runs.
   */
  readonly hideText?: RegExp;
  /** Also write `<id>--crop.webp`, a legible crop for small displays (the gallery). */
  readonly crop?: CropBox;
  /** Written to the manifest: how the shot was made, when that is not obvious. */
  readonly note?: string;
  capture(ctx: ShotContext): Promise<void>;
}

const settle = async (page: Page): Promise<void> => {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(400);
};

/** Select the connected `docs` server so its tools show (the failed one stays visible in the list). */
const openDocsServer = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: /^docs\b/ }).first().waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /^docs\b/ }).first().click();
  await page.getByText("search_docs").first().waitFor({ timeout: 20_000 });
};

export const SHOTS: readonly Shot[] = [
  {
    id: "chat-plan-card",
    status: "stable",
    route: "/chat",
    caption: "Plan mode: the agent proposes a plan, one line per step with the tool it will use. Edit it, then Execute.",
    alt: "Cortex chat in Plan mode showing an editable three-step plan with tool chips for file-read, before it is executed.",
    crop: { x: 380, y: 225, width: 960, height: 600, shows: "The editable plan card with its three steps, tool chips and the Execute button." },
    async capture({ page, base, sessionId }) {
      await page.goto(`${base}/chat?session=${sessionId("Prepare the 0.5.0 release notes")}`);
      await page.getByText("Reasoning only: nothing has run").waitFor();
      await settle(page);
    },
  },
  {
    id: "chat-plan-executed",
    status: "stable",
    route: "/chat",
    caption: "After Execute, each plan step runs and the to-do list ticks off as it finishes.",
    alt: "Cortex chat after a plan was executed: the agent's reply above and the to-do list below showing all three steps checked off.",
    async capture({ page, base, sessionId }) {
      await page.goto(`${base}/chat?session=${sessionId("Prepare the 0.5.0 release notes")}`);
      await page.getByText("Reasoning only: nothing has run").waitFor();
      // Plan-execute-reflect runs each step in its own (scripted) loop, so every step ends done. (Blueprint
      // needs a real model-free tool graph; Auto ran as a plain Execute turn with the scripted provider.)
      await page.getByRole("combobox", { name: "Execute strategy" }).click();
      await page.getByRole("option", { name: /Plan-execute-reflect/ }).click();
      await page.getByRole("button", { name: "Execute", exact: true }).first().click();
      const todo = page.getByRole("button", { name: /To-do 3\/3/ });
      await todo.waitFor({ timeout: 30_000 });
      await todo.click();
      await settle(page);
    },
  },
  {
    id: "chat-stopped-continue",
    status: "stable",
    route: "/chat",
    caption: "A durable run you stopped keeps its place. Continue resumes the same run without repeating finished work.",
    alt: "Cortex chat showing 'Stopped by you' with the tool already done, an optional note for the agent, and a Continue button.",
    crop: { x: 380, y: 190, width: 960, height: 600, shows: "The Stopped by you card with the finished tool, the note field and the Continue button." },
    async capture({ page, base, sessionId }) {
      await page.goto(`${base}/chat?session=${sessionId("Audit the docs folder")}`);
      await page.getByRole("button", { name: "Continue" }).waitFor();
      await settle(page);
    },
  },
  {
    id: "tools-lab",
    status: "stable",
    route: "/lab#tools",
    caption: "Tools Lab: MCP servers with live connection status and each tool's input schema.",
    alt: "Cortex Tools Lab listing three MCP servers: two connected with their tools, one failed with its error.",
    crop: { x: 24, y: 180, width: 860, height: 420, shows: "The server list with each server's connection status, and the connected docs server's tools." },
    async capture({ page, base }) {
      await page.goto(`${base}/lab#tools`);
      await openDocsServer(page);
      await settle(page);
    },
  },
  {
    id: "tools-lab-narrow",
    status: "stable",
    route: "/lab#tools",
    width: 600,
    height: 900,
    caption: "The same Tools Lab at a narrow width.",
    alt: "Cortex Tools Lab at 600 pixels wide, MCP servers stacked in one column.",
    async capture({ page, base }) {
      await page.goto(`${base}/lab#tools`);
      await openDocsServer(page);
      await settle(page);
    },
  },
  {
    id: "channels-hub",
    status: "stable",
    route: "/lab#channels",
    height: 1500,
    caption: "Channels hub: Telegram, Signal and webhook channels, the agent each one routes to, and who may talk to it.",
    alt: "Cortex channels hub with three channels, their routes to a saved agent, and access settings.",
    crop: { x: 20, y: 335, width: 960, height: 600, shows: "The channel list with its add buttons and the first channel's settings." },
    async capture({ page, base }) {
      await page.goto(`${base}/lab#channels`);
      await page.getByText("Support (Telegram)").first().waitFor({ timeout: 20_000 });
      await settle(page);
    },
  },
  {
    id: "beacon",
    status: "stable",
    dataset: "empty",
    motion: "full",
    route: "/",
    caption: "Beacon, the first view of a new Cortex: the neural mark with calm sonar rings while it waits for your first agent.",
    alt: "Cortex Beacon first-run view: the neural mark in the middle of the page, 'Welcome to Cortex', and buttons to open a chat, build an agent or connect an app.",
    note: "Motion on; every CSS animation is paused at 2.0 s so the frame is the same on every run. beacon-still is the reduced-motion version.",
    async capture({ page, base }) {
      await page.goto(`${base}/`);
      await page.getByText("Waiting for your first agent").waitFor();
      await settle(page);
      await freezeAnimations(page, 2000);
    },
  },
  {
    id: "beacon-still",
    status: "stable",
    dataset: "empty",
    motion: "reduced",
    route: "/",
    caption: "The same Beacon view with reduced motion: the neural mark at rest.",
    alt: "Cortex Beacon first-run view with the neural mark at rest and no animation.",
    note: "prefers-reduced-motion emulation; animations disabled at capture.",
    async capture({ page, base }) {
      await page.goto(`${base}/`);
      await page.getByText("Waiting for your first agent").waitFor();
      await settle(page);
    },
  },
  {
    id: "lab-run-panel",
    status: "stable",
    route: "/lab",
    caption: "Lab builder: set the model and tools on the left, name the agent and run it from the panel on the right.",
    alt: "Cortex Lab builder with the Model section open and the Run this agent panel showing the name, task, a summary, and the Save and run and Save buttons fully visible.",
    async capture({ page, base }) {
      await page.goto(`${base}/lab`);
      await page.getByRole("heading", { name: "Run this agent" }).waitFor();
      await page.locator("#builder-persistent-name").fill("release-notes-agent");
      await page.getByPlaceholder("Describe what the agent should do").fill("Read CHANGELOG.md and draft short release notes.");
      // Clipping check (reported, not fatal): the primary button must sit fully inside the page.
      const box = await page.getByRole("button", { name: /Save and run/ }).boundingBox();
      const vw = page.viewportSize()?.width ?? 0;
      if (!box || box.x < 0 || box.x + box.width > vw) console.warn(`CHECK lab-run-panel: Save and run is clipped (box ${JSON.stringify(box)}, viewport ${vw})`);
      else console.log(`CHECK lab-run-panel: Save and run fully visible (x ${Math.round(box.x)}..${Math.round(box.x + box.width)} of ${vw})`);
      await settle(page);
    },
  },
  {
    id: "lab-calibration",
    status: "stable",
    route: "/lab",
    caption: "Lab, Reliability: learned and community calibration are two switches, both off until you turn them on.",
    alt: "Cortex Lab builder Reliability section with the Learned calibration and Community calibration checkboxes both unchecked and a note that they are off by default.",
    async capture({ page, base }) {
      await page.goto(`${base}/lab`);
      await page.getByText("Reliability", { exact: true }).first().click();
      await page.getByText("Learned calibration").waitFor();
      await settle(page);
    },
  },
  {
    id: "lab-durable-runs",
    status: "stable",
    route: "/lab",
    caption: "Lab, Execution: durable runs are on by default in Cortex, so a Stop or a crash leaves a run you can continue.",
    alt: "Cortex Lab builder Execution section with the Durable execution switch on and its hint, 'On by default'.",
    async capture({ page, base }) {
      await page.goto(`${base}/lab`);
      await page.getByText("Execution", { exact: true }).first().click();
      await page.getByText("Durable execution").first().waitFor();
      await settle(page);
    },
  },
  {
    id: "model-calibration",
    // The page labels learned values "applied only when learned calibration is on" only when it HAS learned values.
    // seed.ts writes synthetic observations and a calibration.db row for qwen3:14b (a model with a shipped calibration)
    // into the demo HOME, so the label shows.
    status: "stable",
    route: "/models/ollama/qwen3:14b",
    height: 1500,
    caption: "A model's page: capabilities, measured speed and spend, and how the harness adapts to it. Learned values are marked as applied only when learned calibration is on.",
    alt: "Cortex model page for qwen3:14b showing capabilities and the Calibration section, where values learned from recorded runs are labelled as applied only when learned calibration is on, next to the shipped values.",
    crop: { x: 240, y: 850, width: 960, height: 600, shows: "The Calibration section, each setting marked Shipped or Learned, with the note that learned values apply only when learned calibration is on." },
    note: "Synthetic calibration data seeded into the demo home: a shipped calibration plus 8 recorded run observations (seed.ts).",
    async capture({ page, base }) {
      await page.goto(`${base}/models/ollama/${encodeURIComponent("qwen3:14b")}`);
      await page.getByText("How the harness adapts to this model").waitFor();
      await settle(page);
    },
  },
  {
    id: "chat-approval-card",
    status: "stable",
    route: "/chat",
    caption: "A tool that needs approval pauses the run and shows exactly what it will do. Nothing runs until you approve.",
    alt: "Cortex chat with a Waiting on you card for a file-write call showing its path and content parameters, with Approve, Deny and Dismiss buttons.",
    async capture({ page, base, sessionId }) {
      await page.goto(`${base}/chat?session=${sessionId("Publish the release notes")}`);
      await page.getByText("Waiting on you").first().waitFor();
      await page.getByText("Show full parameters").click();
      await settle(page);
    },
  },
  {
    id: "chat-stop-cause",
    status: "stable",
    route: "/chat",
    caption: "When a run ends early, the chat says why in plain words and offers Continue with more steps.",
    alt: "Cortex chat showing a run that stopped at its step limit: a 'Ran out of budget' card with the work already done, a note field, a More steps field and a Continue button.",
    async capture({ page, base, sessionId }) {
      await page.goto(`${base}/chat?session=${sessionId("Summarise every open issue")}`);
      await page.getByText("Ran out of budget").waitFor();
      await settle(page);
    },
  },
  {
    id: "run-cause",
    status: "stable",
    route: "/run/:runId",
    caption: "The run view's Why it ended card: the cause, who is at fault, what to try, and the steps that decided it.",
    alt: "Cortex run view for a run that hit its iteration limit, with the Why it ended card open: cause, what to try, decisive steps, and the trace below.",
    crop: { x: 16, y: 360, width: 984, height: 540, shows: "The Why it ended card: the cause, what to try and the decisive steps." },
    note: "Diagnosis is the framework's (same engine as rax-diagnose cause) on a scripted run that was cut at its step limit. The per-loop speed readout (tok/s, first-token time) appears only when timing resolved, so it is hidden in the trace rows to keep the layout identical between runs.",
    hideText: /tok\/s · TTFT/,
    async capture({ page, base, runId }) {
      await page.goto(`${base}/run/${runId()}`);
      await page.getByText("Why it ended").waitFor({ timeout: 20_000 });
      await page.getByText("Decisive steps").waitFor();
      await settle(page);
      // The header's Speed tile exists only when timing resolved: hide the whole tile (label and value) so the header
      // lays out the same on every run. Masks and hideText run after capture, so this is done here.
      // A MutationObserver keeps it hidden if the tile renders after this point.
      await page.evaluate(() => {
        const hide = (): void => {
          for (const el of Array.from(document.querySelectorAll("*"))) {
            if (el.children.length === 0 && el.textContent?.trim() === "Speed" && el.parentElement) el.parentElement.style.setProperty("display", "none");
          }
        };
        hide();
        new MutationObserver(hide).observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    },
  },
];

/** Pause every CSS animation at a fixed time (JS-driven motion is not covered; compare runs to confirm). */
async function freezeAnimations(page: Page, atMs: number): Promise<void> {
  await page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t;
    }
  }, atMs);
  await page.waitForTimeout(100);
}
