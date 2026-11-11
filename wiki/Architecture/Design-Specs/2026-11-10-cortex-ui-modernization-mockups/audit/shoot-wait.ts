// Headless Chromium screenshots over raw CDP. Usage:
//   bun shoot.ts <outDir> <name>=<url>[|<js-to-run-after-load>] ...
// Each page is captured in dark + light at 1280x800 and 1920x1080 (1920 dark only).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const outDir = process.argv[2]!;
mkdirSync(outDir, { recursive: true });
const port = 9333;
const proc = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, "--no-first-run",
  "--user-data-dir=" + join(outDir, ".profile"), "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let wsUrl = "";
for (let i = 0; i < 50 && !wsUrl; i++) {
  try {
    const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
  } catch { /* not up yet */ }
  if (!wsUrl) await sleep(200);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map<number, (v: unknown) => void>();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown };
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result); pending.delete(m.id); }
});
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Page.enable");
await send("Runtime.enable");
const evalJs = (expression: string) => send("Runtime.evaluate", { expression, awaitPromise: true });

async function capture(name: string, url: string, after: string | undefined, theme: string, w: number, h: number) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  if (url.startsWith("file:")) {
    await send("Page.navigate", { url: `${url}?theme=${theme}` });
    await sleep(900);
  } else {
    await send("Page.navigate", { url: "http://localhost:5217/settings" });
    await sleep(600);
    await evalJs(`(()=>{const k='cortex-settings';const s=JSON.parse(localStorage.getItem(k)||'{}');s.theme='${theme}';localStorage.setItem(k,JSON.stringify(s));})()`);
    await send("Page.navigate", { url });
    // Wait for the composer (the chat finished loading), not a fixed delay; report how long it took.
    const t0 = Date.now();
    let ready = false;
    while (!ready && Date.now() - t0 < 20000) {
      const r = await evalJs(`!!document.querySelector('textarea[aria-label="Message"]') && !document.querySelector('[aria-label="Loading chat"]')`);
      ready = r?.result?.value === true;
      if (!ready) await sleep(100);
    }
    console.log(`  ${url} ready=${ready} after ${Date.now() - t0}ms`);
    await sleep(800); // markdown render + scroll settle
  }
  if (after) { await evalJs(after); await sleep(1500); }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = join(outDir, `${name}-${theme}-${w}.png`);
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log(file);
}

for (const arg of process.argv.slice(3)) {
  const eq = arg.indexOf("=");
  const name = arg.slice(0, eq);
  const [url, after] = arg.slice(eq + 1).split("|");
  await capture(name, url!, after, "dark", 1280, 800);
  await capture(name, url!, after, "light", 1280, 800);
  await capture(name, url!, after, "dark", 1920, 1080);
}
ws.close();
proc.kill();
process.exit(0);
