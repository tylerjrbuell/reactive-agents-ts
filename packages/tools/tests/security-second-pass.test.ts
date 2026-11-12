// Run: bun test packages/tools/tests/security-second-pass.test.ts --timeout 20000
//
// 2026-11-12 security audit, second pass (M3, M5, M6, spill modes, L1, secret
// paths). Each case failed before its fix; cutting the fix turns it red.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { grepHandler } from "../src/skills/grep.js";
import { confinePath, withFileRoot } from "../src/skills/file-operations.js";
import { isSecretPath, withSecretPathAccess } from "../src/skills/file-root.js";
import { commandMatchesRules } from "../src/skills/shell-command-rules.js";
import { buildHostShellEnv } from "../src/skills/shell-host-process.js";
import { shellExecuteHandler } from "../src/skills/shell-execution.js";
import { httpGetHandler, readCappedText, withoutCredentialHeaders } from "../src/skills/http-client.js";
import { setScratchpadBounded } from "../src/scratchpad-spill.js";
import { mockFetch } from "./helpers/fetch-stub.js";

describe("M3 — approval command rules see through wrappers and git global options", () => {
  const rules = ["git push"];
  for (const cmd of [
    "git push origin main",
    "git -C . push",
    "git --no-pager push",
    "git -c core.pager=cat push",
    "git --git-dir=.git --work-tree . push",
    "env -i git push",
    "xargs git push",
    "xargs -n1 git push",
    "timeout 5 git push",
    "sudo -u root git push",
    "/usr/bin/git -C /x push",
  ]) {
    it(`requires approval: ${cmd}`, () => expect(commandMatchesRules(cmd, rules)).toBe(true));
  }
  for (const cmd of ["git status", "git -C . status", "env -i git status", "xargs echo hi"]) {
    it(`does not over-match: ${cmd}`, () => expect(commandMatchesRules(cmd, rules)).toBe(false));
  }
});

describe("M6 — host tokens reach only a shell granted the matching tool", () => {
  const withEnv = (vars: Record<string, string>, fn: () => void): void => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, vars);
      fn();
    } finally {
      process.env = saved;
    }
  };
  it("withholds gh and gws credentials when not granted", () =>
    withEnv({ GH_TOKEN: "ghp_x", GITHUB_TOKEN: "ghp_y", GOOGLE_WORKSPACE_CLI_TOKEN: "g_x" }, () => {
      const env = buildHostShellEnv("/usr/bin", "/tmp/s", undefined, ["jq", "awk", "git"]);
      expect(Object.keys(env).filter((k) => /TOKEN|GH_|GOOGLE/.test(k))).toEqual([]);
    }));
  it("forwards gh credentials only to gh, gws only to gws", () =>
    withEnv({ GH_TOKEN: "ghp_x", GOOGLE_WORKSPACE_CLI_TOKEN: "g_x" }, () => {
      const gh = buildHostShellEnv("/usr/bin", "/tmp/s", undefined, ["gh"]);
      expect(gh.GH_TOKEN).toBe("ghp_x");
      expect(gh.GOOGLE_WORKSPACE_CLI_TOKEN).toBeUndefined();
      const gws = buildHostShellEnv("/usr/bin", "/tmp/s", undefined, ["gws"]);
      expect(gws.GOOGLE_WORKSPACE_CLI_TOKEN).toBe("g_x");
      expect(gws.GH_TOKEN).toBeUndefined();
    }));
  it("awk ENVIRON in a real default shell prints no token", async () => {
    const saved = { ...process.env };
    process.env.GH_TOKEN = "ghp_leak_canary";
    process.env.GOOGLE_WORKSPACE_CLI_TOKEN = "gws_leak_canary";
    try {
      const r = (await Effect.runPromise(
        shellExecuteHandler()({
          command: `awk 'BEGIN{print "[" ENVIRON["GH_TOKEN"] ENVIRON["GOOGLE_WORKSPACE_CLI_TOKEN"] "]"}'`,
        }),
      )) as { executed: boolean; output: string };
      expect(r.executed).toBe(true);
      expect(r.output.trim()).toBe("[]");
    } finally {
      process.env = saved;
    }
  });
});

describe("spill files are owner-only", () => {
  it("creates the spill dir 0700 and file 0600", () => {
    const ns = `sec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pad = new Map<string, string>();
    setScratchpadBounded(pad, "_tool_result_1", "x".repeat(50), ns, 1);
    const marker = pad.get("_tool_result_1")!;
    const file = /^\[SPILLED_TO_DISK:(.+)\]$/.exec(marker)![1]!;
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });
});

describe("L1 — http-get credentials and body size", () => {
  const redirectingFetch = (seen: Array<Record<string, string>>) =>
    mockFetch(async (input, init) => {
      seen.push({ ...(init?.headers as Record<string, string>) });
      const url = String(input);
      return url.includes(":1/")
        ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1:2/next" } })
        : new Response("done", { status: 200 });
    });
  const original = global.fetch;
  it("strips Authorization/Cookie on a cross-origin redirect", async () => {
    const seen: Array<Record<string, string>> = [];
    global.fetch = redirectingFetch(seen);
    try {
      await Effect.runPromise(
        httpGetHandler({ allowPrivate: true })({
          url: "http://127.0.0.1:1/start",
          headers: { Authorization: "Bearer s", Cookie: "a=b", Accept: "text/plain" },
        }),
      );
    } finally {
      global.fetch = original;
    }
    expect(seen[0]).toMatchObject({ Authorization: "Bearer s", Cookie: "a=b" });
    expect(seen[1]).toEqual({ Accept: "text/plain" });
  });
  it("keeps headers on a same-origin redirect", async () => {
    const seen: Array<Record<string, string>> = [];
    global.fetch = mockFetch(async (_i, init) => {
      seen.push({ ...(init?.headers as Record<string, string>) });
      return seen.length === 1
        ? new Response(null, { status: 302, headers: { location: "/next" } })
        : new Response("ok", { status: 200 });
    });
    try {
      await Effect.runPromise(
        httpGetHandler({ allowPrivate: true })({ url: "http://127.0.0.1:1/a", headers: { Authorization: "Bearer s" } }),
      );
    } finally {
      global.fetch = original;
    }
    expect(seen[1]).toEqual({ Authorization: "Bearer s" });
  });
  it("withoutCredentialHeaders drops auth-like names only", () => {
    expect(withoutCredentialHeaders({ "X-Api-Key": "k", "x-auth-token": "t", Accept: "a" })).toEqual({ Accept: "a" });
  });
  it("stops reading an endless body at the cap instead of buffering it", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls > 10_000) controller.close(); // would be 10 GB-class if never capped
        else controller.enqueue(new TextEncoder().encode("x".repeat(100_000)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { text, truncated } = await readCappedText(new Response(body), 1_000);
    expect(truncated).toBe(true);
    expect(text.length).toBe(1_000);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(100);
  });
});

describe("secret paths are refused by file tools", () => {
  let root: string;
  beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "secret-paths-")));
    await fs.mkdir(path.join(root, ".cortex"), { recursive: true });
    await fs.writeFile(path.join(root, ".cortex", "secret.key"), "KEYMATERIAL\n");
    await fs.writeFile(path.join(root, "provider-keys.json"), "KEYMATERIAL\n");
    await fs.writeFile(path.join(root, ".env"), "KEYMATERIAL=1\n");
    await fs.writeFile(path.join(root, ".env.local"), "KEYMATERIAL=1\n");
    await fs.writeFile(path.join(root, ".env.example"), "KEYMATERIAL=\n");
    await fs.writeFile(path.join(root, "ok.txt"), "KEYMATERIAL ok\n");
    await fs.symlink(path.join(root, "provider-keys.json"), path.join(root, "innocent.txt"));
  });
  afterAll(() => fs.rm(root, { recursive: true, force: true }).catch(() => {}));

  for (const p of [".cortex/secret.key", "provider-keys.json", ".env", ".env.local", "innocent.txt", ".cortex/new.txt"]) {
    it(`confinePath refuses ${p}`, async () => {
      await expect(withFileRoot(root, () => confinePath(p))).rejects.toThrow(/credential path/);
    });
  }
  it("allows ordinary files and .env.example", async () => {
    await expect(withFileRoot(root, () => confinePath("ok.txt"))).resolves.toBe(path.join(root, "ok.txt"));
    await expect(withFileRoot(root, () => confinePath(".env.example"))).resolves.toBeTruthy();
  });
  it("grep never returns credential files and refuses a credential scope", async () => {
    const r = (await withFileRoot(root, () =>
      Effect.runPromise(grepHandler({ pattern: "KEYMATERIAL", path: "." })),
    )) as { matches: { file: string }[] };
    expect(r.matches.map((m) => m.file)).toEqual(["ok.txt"]);
    await expect(
      withFileRoot(root, () => Effect.runPromise(grepHandler({ pattern: "KEYMATERIAL", path: ".cortex" }))),
    ).rejects.toThrow(/credential path/);
  });
  it("withSecretPathAccess is the only override", async () => {
    expect(isSecretPath(root, path.join(root, ".env"))).toBe(true);
    await expect(
      withSecretPathAccess(() => withFileRoot(root, () => confinePath(".env"))),
    ).resolves.toBe(path.join(root, ".env"));
  });
});
