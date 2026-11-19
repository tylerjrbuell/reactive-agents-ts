import { describe, test, expect, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { renderBanner } from "../src/banner.js";
import { DIAGNOSE_SUBCOMMANDS } from "../src/commands/diagnose.js";
import { detectOllama } from "../src/commands/demo.js";

const ENTRY = path.resolve(import.meta.dir, "../src/index.ts");
const ESC = "\x1b[";

function rax(args: readonly string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [ENTRY, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    timeout: 30_000,
  });
}

describe("rax --help", () => {
  // The scaffold AGENTS.md tells users to run `rax diagnose cause|signals|attribute`;
  // top-level help used to list only list|replay|replay-run|grep|diff|debrief.
  test("lists every diagnose subcommand, including signals, cause and attribute", () => {
    const r = rax(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(DIAGNOSE_SUBCOMMANDS.join(" | "));
    for (const sub of ["signals", "cause", "attribute"]) expect(r.stdout).toContain(sub);
  });

  test("every listed subcommand is documented in `rax diagnose --help`", () => {
    const r = rax(["diagnose", "--help"]);
    expect(r.status).toBe(0);
    for (const sub of DIAGNOSE_SUBCOMMANDS) expect(r.stdout).toMatch(new RegExp(`\\n {4}${sub} `));
  });

  test("off a TTY, banner and help carry no ANSI escapes", () => {
    const r = rax(["--help"]);
    expect(r.stdout).toContain("Reactive Agents eXecutable");
    expect(r.stdout).not.toContain(ESC);
    const v = rax(["--version"]);
    expect(v.stdout).toContain("rax v");
    expect(v.stdout).not.toContain(ESC);
  });

  test("the banner follows the shared color decision (FORCE_COLOR turns it on)", () => {
    // spawnSync stdout is a pipe, so this cannot exercise NO_COLOR on a real
    // TTY; it pins that the banner no longer hardcodes ANSI and instead
    // follows chalk's level, which ui.ts zeroes under NO_COLOR.
    expect(rax(["--help"], { FORCE_COLOR: "1" }).stdout).toContain(ESC);
  });
});

describe("renderBanner", () => {
  test("plain when color is off, colored when on", () => {
    expect(renderBanner(false)).not.toContain(ESC);
    expect(renderBanner(false)).toContain("Type-safe AI agents on Effect-TS");
    expect(renderBanner(true)).toContain(ESC);
  });
});

describe("rax demo Ollama detection", () => {
  let server: Server | undefined;
  const saved = { OLLAMA_HOST: process.env.OLLAMA_HOST, OLLAMA_ENDPOINT: process.env.OLLAMA_ENDPOINT };

  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  // The provider resolves OLLAMA_ENDPOINT -> OLLAMA_HOST -> OLLAMA_BASE; demo
  // used to read only OLLAMA_ENDPOINT, so an OLLAMA_HOST setup fell back to
  // the recorded replay even with Ollama up.
  test("reads OLLAMA_HOST (Ollama's own variable, host:port form)", async () => {
    server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(req.url === "/api/tags" ? JSON.stringify({ models: [{ name: "fake-model:1b" }] }) : "{}");
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    delete process.env.OLLAMA_ENDPOINT;
    process.env.OLLAMA_HOST = `127.0.0.1:${port}`;

    const detected = await detectOllama();
    expect(detected?.provider).toBe("ollama");
    expect(detected?.model).toBe("fake-model:1b");
  });
});
