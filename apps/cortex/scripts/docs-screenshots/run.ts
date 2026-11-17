/**
 * Cortex docs screenshots: starts a hermetic demo Cortex (`demo-server.ts`), seeds it
 * (`seed.ts`, `seed-http.ts`), drives the built UI with Playwright and writes optimized images plus
 * `manifest.json` to `apps/docs/public/screens/cortex/`.
 *
 *   bun run --cwd apps/cortex screenshots:docs [--only a,b] [--out DIR] [--compare DIR] [--include-pending]
 *
 * Details: ./README.md.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { MASKS, SHOTS, VIEWPORT, type CropBox, type Dataset, type Shot, type ShotContext } from "./shots.js";

const here = new URL(".", import.meta.url).pathname;
const cortexRoot = resolve(here, "../..");
const repoRoot = resolve(cortexRoot, "../..");

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const outDir = resolve(flag("--out") ?? join(repoRoot, "apps/docs/public/screens/cortex"));
const includePending = args.includes("--include-pending");
const port = Number(process.env.DEMO_PORT ?? "4399");
const demoDir = resolve(process.env.DEMO_DIR ?? join(tmpdir(), "cortex-docs-demo"));
const base = `http://127.0.0.1:${port}`;
const BUDGET_BYTES = 200 * 1024;

/**
 * Environment for every process this script spawns. HOME is the demo dir AT SPAWN: Bun reads it for
 * `os.homedir()` once, at start, so the demo never reads or writes the real `~/.reactive-agents`
 * (calibration.db, durable stores, skills). `demo-server.ts` and `seed.ts` refuse to run otherwise.
 */
const demoEnv = (): Record<string, string> => ({
  ...(process.env as Record<string, string>),
  HOME: demoDir,
  USERPROFILE: demoDir,
  XDG_CONFIG_HOME: join(demoDir, ".config"),
  XDG_DATA_HOME: join(demoDir, ".local", "share"),
  DEMO_DIR: demoDir,
  DEMO_PORT: String(port),
});

/** playwright-core: the repo's own install when there is one, else the bun cache copy (see README). */
function loadPlaywright(): typeof import("playwright-core") {
  const req = createRequire(import.meta.url);
  const cache = join(homedir(), ".bun/install/cache/playwright-core");
  const candidates = ["playwright-core", ...(existsSync(cache) ? readdirSync(cache).map((d) => join(cache, d)) : [])];
  for (const c of candidates) {
    try {
      return req(c) as typeof import("playwright-core");
    } catch {
      /* next */
    }
  }
  throw new Error("playwright-core not found. Install it once (`bun add -d playwright-core` at the repo root) and a browser (`bunx playwright-core install chromium`).");
}

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`${base}/api/health`)).ok;
  } catch {
    return false;
  }
}

async function sh(script: string, label: string): Promise<void> {
  const p = Bun.spawn(["bun", "run", join(here, script)], { cwd: cortexRoot, env: demoEnv(), stdout: "pipe", stderr: "pipe" });
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text(), new Response(p.stdout).text()]);
  if (code !== 0) throw new Error(`${label} failed (exit ${code}):\n${err.slice(-1500)}`);
}

/** Start the demo server; retries (a dist rebuild by another session can briefly break imports). */
async function startServer(): Promise<ReturnType<typeof Bun.spawn>> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const proc = Bun.spawn(["bun", "run", join(here, "demo-server.ts")], { cwd: cortexRoot, env: demoEnv(), stdout: "ignore", stderr: "ignore" });
    for (let i = 0; i < 60; i++) {
      if (await healthy()) return proc;
      if (proc.exitCode !== null) break;
      await Bun.sleep(250);
    }
    try { proc.kill(); } catch { /* gone */ }
    await Bun.sleep(5000);
  }
  throw new Error("demo Cortex did not start (3 attempts)");
}

const selected = SHOTS.filter((s) => (only ? only.includes(s.id) : includePending || s.status === "stable"));
if (selected.length === 0) {
  console.error(`no shots selected (known: ${SHOTS.map((s) => `${s.id}${s.status === "pending" ? " (pending)" : ""}`).join(", ")})`);
  process.exit(2);
}

type Result = { shot: Shot; png: Buffer; file: string; bytes: number; crop?: CropBox };
const results: Result[] = [];
const pw = loadPlaywright();
const browser = await pw.chromium.launch({ headless: true });

/** Capture one shot in a fresh browser context. */
async function capture(shot: Shot, ctxInfo: Pick<ShotContext, "sessionId" | "runId">): Promise<void> {
  const full = shot.motion === "full";
  const ctx = await browser.newContext({
    viewport: { width: shot.width ?? VIEWPORT.width, height: shot.height ?? VIEWPORT.height },
    deviceScaleFactor: 2,
    colorScheme: shot.scheme ?? "dark",
    reducedMotion: full ? "no-preference" : "reduce",
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await ctx.newPage();
  // One clock for every relative time ("just now"), frozen.
  await page.clock.setFixedTime(new Date(Date.now()));
  try {
    await shot.capture({ page, base, ...ctxInfo });
  } catch (e) {
    // Leave evidence for debugging in the (temp) demo dir, never in the output dir.
    const evidence = join(demoDir, `failed-${shot.id}`);
    await page.screenshot({ path: `${evidence}.png` }).catch(() => undefined);
    writeFileSync(`${evidence}.txt`, await page.evaluate(() => document.body.innerText).catch(() => ""));
    console.error(`shot ${shot.id} failed; evidence: ${evidence}.png/.txt (demo dir is wiped on the next run)`);
    throw e;
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  // No toasts (they carry run ids), no caret. Dynamic text is replaced with fixed values (shots.ts MASKS).
  // No chat speed readout either (tok/s, TTFT): it exists only when timing resolved, so it differs run to run.
  await page.addStyleTag({ content: "*{caret-color:transparent!important}.z-toast{display:none!important}[data-testid=turn-speed]{display:none!important}" });
  await page.evaluate((masks) => {
    const rules = masks.map(([src, to]) => [new RegExp(src, "g"), to] as const);
    const fix = (s: string): string => rules.reduce((acc, [re, to]) => acc.replace(re, to), s);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const next = fix(n.nodeValue ?? "");
      if (next !== n.nodeValue) n.nodeValue = next;
    }
    for (const el of document.querySelectorAll("input, textarea")) {
      const input = el as HTMLInputElement;
      const next = fix(input.value);
      if (next !== input.value) input.value = next;
    }
  }, MASKS.map(([re, to]) => [re.source, to] as [string, string]));
  if (shot.hideText) {
    await page.evaluate((src) => {
      const re = new RegExp(src);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (re.test(n.nodeValue ?? "")) (n.parentElement as HTMLElement | null)?.style.setProperty("display", "none");
      }
    }, shot.hideText.source);
  }
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: "png", animations: full ? "allow" : "disabled", caret: "hide" });
  const webp = await sharp(png)
    .resize({ width: shot.width ?? VIEWPORT.width })
    .webp({ quality: 82, effort: 6 })
    .toBuffer();
  results.push({ shot, png: webp, file: `${shot.id}.webp`, bytes: webp.length });
  if (shot.crop) {
    // Readability crop: cut from the 2x capture (CSS px x 2), output at the crop's CSS width (about 960) so text stays legible.
    const c = shot.crop;
    const cropped = await sharp(png)
      .extract({ left: c.x * 2, top: c.y * 2, width: c.width * 2, height: c.height * 2 })
      .resize({ width: c.width })
      .webp({ quality: 82, effort: 6 })
      .toBuffer();
    results.push({ shot, png: cropped, file: `${shot.id}--crop.webp`, bytes: cropped.length, crop: c });
  }
  await ctx.close();
}

/** One demo Cortex, wiped and seeded for `dataset`, with the shots that need it. */
async function runDataset(dataset: Dataset, shots: readonly Shot[]): Promise<void> {
  if (shots.length === 0) return;
  rmSync(demoDir, { recursive: true, force: true });
  mkdirSync(demoDir, { recursive: true });
  // Chats first (a pending approval is restored when the server boots), then the server, then the HTTP seeds.
  const seeded = dataset === "demo" || dataset === "board";
  if (seeded) await sh("seed.ts", "seed");
  if (dataset === "chat") await sh("seed-chat.ts", "seed-chat");
  const server = await startServer();
  try {
    const ids = new Map<string, string>();
    let failedRunId = "";
    if (dataset === "chat") {
      const list = (await (await fetch(`${base}/api/chat/sessions`)).json()) as Array<{ sessionId: string; name: string }>;
      for (const s of list) ids.set(s.name, s.sessionId);
    }
    if (seeded) {
      await sh("seed-http.ts", "seed-http");
      const list = (await (await fetch(`${base}/api/chat/sessions`)).json()) as Array<{ sessionId: string; name: string }>;
      for (const s of list) ids.set(s.name, s.sessionId);
      const runs = (await (await fetch(`${base}/api/runs`)).json()) as { runs?: Array<{ runId: string; status: string }> } | Array<{ runId: string; status: string }>;
      const failed = (Array.isArray(runs) ? runs : (runs.runs ?? [])).find((r) => r.status === "failed");
      failedRunId = failed?.runId ?? "";
    }
    const info = {
      sessionId: (name: string): string => {
        const id = ids.get(name);
        if (!id) throw new Error(`seeded chat "${name}" not found`);
        return id;
      },
      runId: (): string => {
        if (!failedRunId) throw new Error("no failed run was seeded");
        return failedRunId;
      },
    };
    for (const shot of shots) await capture(shot, info);
  } finally {
    try { server.kill(); } catch { /* gone */ }
  }
}

try {
  await runDataset("empty", selected.filter((s) => s.dataset === "empty"));
  await runDataset("demo", selected.filter((s) => s.dataset === undefined || s.dataset === "demo"));
  await runDataset("board", selected.filter((s) => s.dataset === "board"));
  await runDataset("chat", selected.filter((s) => s.dataset === "chat"));
} finally {
  await browser.close();
}

mkdirSync(outDir, { recursive: true });
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex").slice(0, 16);
for (const r of results) {
  writeFileSync(join(outDir, r.file), r.png);
  const flagged = r.bytes > BUDGET_BYTES ? "  OVER BUDGET" : "";
  console.log(`${r.file}  ${(r.bytes / 1024).toFixed(0)} KB  sha ${sha(r.png)}${flagged}`);
}

const manifestPath = join(outDir, "manifest.json");
type Entry = { id: string; file: string | null; status: string; route: string; caption: string; alt: string; width: number; height: number; bytes: number | null; sha256: string | null; note?: string; variantOf?: string; crop?: CropBox };
const prior: Entry[] = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { shots: Entry[] }).shots : [];
const byId = new Map(prior.map((e) => [e.id, e] as const));
// Workspace package.json files stay at a baseline version; the repo VERSION file is the real one (what /api/health reports).
const versionFile = join(repoRoot, "VERSION");
const cortexVersion = existsSync(versionFile)
  ? readFileSync(versionFile, "utf8").trim()
  : (JSON.parse(readFileSync(join(cortexRoot, "package.json"), "utf8")) as { version: string }).version;
for (const shot of SHOTS) {
  const r = results.find((x) => x.shot.id === shot.id && !x.crop);
  const cur = byId.get(shot.id);
  byId.set(shot.id, {
    id: shot.id,
    file: r ? r.file : cur?.file ?? null,
    status: shot.status,
    route: shot.route,
    caption: shot.caption,
    alt: shot.alt,
    width: shot.width ?? VIEWPORT.width,
    height: shot.height ?? VIEWPORT.height,
    bytes: r ? r.bytes : cur?.bytes ?? null,
    sha256: r ? createHash("sha256").update(r.png).digest("hex") : cur?.sha256 ?? null,
    ...(shot.note ? { note: shot.note } : {}),
  });
  if (shot.crop) {
    const cid = `${shot.id}--crop`;
    const rc = results.find((x) => x.shot.id === shot.id && x.crop);
    const curc = byId.get(cid);
    byId.set(cid, {
      id: cid,
      file: rc ? rc.file : curc?.file ?? null,
      status: shot.status,
      route: shot.route,
      caption: `${shot.caption} ${shot.crop.shows}`,
      alt: `${shot.alt} Cropped to show: ${shot.crop.shows}`,
      width: shot.crop.width,
      height: shot.crop.height,
      bytes: rc ? rc.bytes : curc?.bytes ?? null,
      sha256: rc ? createHash("sha256").update(rc.png).digest("hex") : curc?.sha256 ?? null,
      variantOf: shot.id,
      crop: shot.crop,
      note: `Readability crop of ${shot.id}: ${shot.crop.width}x${shot.crop.height} CSS px from (${shot.crop.x}, ${shot.crop.y}) of the full capture, for display at 480 to 820 px wide.`,
    });
  }
}
const manifest = {
  generatedBy: "bun run --cwd apps/cortex screenshots:docs",
  cortexVersion,
  capturedOn: new Date().toISOString().slice(0, 10),
  viewport: `${VIEWPORT.width}x${VIEWPORT.height} @2x, downscaled to ${VIEWPORT.width} wide`,
  data: "seeded demo data, scripted `test` provider, no keys, no network, HOME and data dir under a temp folder",
  shots: SHOTS.flatMap((s) => [byId.get(s.id)!, ...(s.crop ? [byId.get(`${s.id}--crop`)!] : [])]),
};
// Atomic: write beside it, then rename, so an interrupted run never leaves half a manifest.
writeFileSync(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
renameSync(`${manifestPath}.tmp`, manifestPath);
console.log(`manifest: ${manifestPath}`);

// `--compare DIR`: byte-compare every image this run wrote with the same file in DIR (a previous run).
const compareDir = flag("--compare");
if (compareDir) {
  let same = 0;
  for (const r of results) {
    const prev = join(resolve(compareDir), r.file);
    if (existsSync(prev) && sha(readFileSync(prev)) === sha(r.png)) same++;
    else console.error(`NOT identical: ${r.file}`);
  }
  console.log(`determinism: ${same}/${results.length} images byte-identical to ${compareDir}`);
  if (same !== results.length) process.exitCode = 1;
}
