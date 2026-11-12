// Run: bun run repo test apps/cortex/server/tests/workspace-files.test.ts
//
// The composer's `@` picker reads files under the session workspace only: traversal,
// absolute paths, symlink escapes, secrets, VCS/dependency dirs and binaries are refused.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gitignoreRules,
  isSecretName,
  listWorkspaceFiles,
  readWorkspaceText,
  resolveWorkspaceFile,
  searchWorkspaceFiles,
} from "../services/workspace-files.js";

let base = "";
let root = "";
let outside = "";

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "cortex-wsfiles-"));
  root = join(base, "ws");
  outside = join(base, "outside");
  mkdirSync(join(root, "src", "chat"), { recursive: true });
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, "generated"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "README.md"), "# hello\n");
  writeFileSync(join(root, "src", "chat", "composer.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "src", "big.txt"), "x".repeat(200_000));
  writeFileSync(join(root, ".env"), "SECRET=1\n");
  writeFileSync(join(root, ".env.example"), "KEY=\n");
  writeFileSync(join(root, "id_rsa"), "private");
  writeFileSync(join(root, "node_modules", "dep", "index.js"), "x");
  writeFileSync(join(root, ".git", "config"), "x");
  writeFileSync(join(root, "generated", "out.txt"), "x");
  writeFileSync(join(root, ".gitignore"), "generated/\n*.log\n");
  writeFileSync(join(root, "run.log"), "x");
  writeFileSync(join(root, "pic.bin"), Buffer.from([0, 1, 2, 0, 255, 0]));
  writeFileSync(join(outside, "passwd"), "root:x:0:0\n");
  symlinkSync(join(outside, "passwd"), join(root, "escape-link"));
  symlinkSync(outside, join(root, "escape-dir"));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("listing", () => {
  it("lists files, skipping secrets, VCS, dependencies, gitignored and symlinks", () => {
    const paths = listWorkspaceFiles(root).files.map((f) => f.path);
    expect(paths).toContain("README.md");
    expect(paths).toContain("src/chat/composer.ts");
    expect(paths).toContain(".env.example");
    for (const hidden of [".env", "id_rsa", "node_modules/dep/index.js", ".git/config", "generated/out.txt", "run.log", "escape-link", "escape-dir/passwd"]) {
      expect(paths).not.toContain(hidden);
    }
  });

  it("search ranks the best match first and reports sizes", () => {
    const r = searchWorkspaceFiles(root, "composer");
    expect(r.files[0]?.path).toBe("src/chat/composer.ts");
    expect(r.files[0]?.bytes).toBe(20);
    expect(searchWorkspaceFiles(root, "composer", 0).files).toHaveLength(1);
  });

  it("secret names", () => {
    expect(isSecretName(".env")).toBe(true);
    expect(isSecretName(".env.production")).toBe(true);
    expect(isSecretName(".env.example")).toBe(false);
    expect(isSecretName("server.pem")).toBe(true);
    expect(isSecretName("credentials.json")).toBe(true);
    expect(isSecretName("composer.ts")).toBe(false);
  });

  it("gitignore rules: names, dirs, extensions, anchored paths; negations skipped", () => {
    const rules = gitignoreRules("# c\nout/\n*.log\n/docs/gen\n!keep.log\n");
    const hit = (p: string, dir = false) => rules.some((r) => r.test(p, dir));
    expect(hit("out", true)).toBe(true);
    expect(hit("a/out", true)).toBe(true);
    expect(hit("x/y.log")).toBe(true);
    expect(hit("docs/gen", true)).toBe(true);
    expect(hit("other/docs/gen", true)).toBe(false);
    expect(hit("src/a.ts")).toBe(false);
  });
});

describe("path safety", () => {
  it("rejects traversal, absolute paths and NUL", () => {
    for (const p of ["../../etc/passwd", "../outside/passwd", "src/../../outside/passwd", "/etc/passwd", "C:\\Windows\\win.ini", "a\0b", ""]) {
      const r = resolveWorkspaceFile(root, p);
      expect(r.ok).toBe(false);
    }
    const r = resolveWorkspaceFile(root, "../../etc/passwd");
    expect(r.ok === false && r.code).toBe("outside-workspace");
  });

  it("rejects a symlink whose target leaves the workspace", () => {
    const r = resolveWorkspaceFile(root, "escape-link");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("outside-workspace");
    expect(resolveWorkspaceFile(root, "escape-dir/passwd").ok).toBe(false);
  });

  it("rejects secrets and ignored directories even when asked by name", () => {
    expect(resolveWorkspaceFile(root, ".env")).toMatchObject({ ok: false, code: "secret" });
    expect(resolveWorkspaceFile(root, "id_rsa")).toMatchObject({ ok: false, code: "secret" });
    expect(resolveWorkspaceFile(root, "node_modules/dep/index.js")).toMatchObject({ ok: false, code: "secret" });
    expect(resolveWorkspaceFile(root, ".git/config")).toMatchObject({ ok: false, code: "secret" });
  });

  it("missing files and directories", () => {
    expect(resolveWorkspaceFile(root, "nope.md")).toMatchObject({ ok: false, code: "not-found" });
    expect(resolveWorkspaceFile(root, "src")).toMatchObject({ ok: false, code: "not-a-file" });
  });
});

describe("bounded reads", () => {
  it("reads a small file whole", () => {
    expect(readWorkspaceText(root, "README.md")).toMatchObject({ ok: true, text: "# hello\n", truncated: false, totalBytes: 8, shownBytes: 8 });
  });

  it("cuts a large file at the cap and says how much was shown", () => {
    const r = readWorkspaceText(root, "src/big.txt", 1000);
    expect(r).toMatchObject({ ok: true, truncated: true, totalBytes: 200_000, shownBytes: 1000 });
    expect(r.ok && r.text.length).toBe(1000);
  });

  it("refuses a binary file with its reason", () => {
    const r = readWorkspaceText(root, "pic.bin");
    expect(r).toMatchObject({ ok: false, code: "binary" });
  });

  it("the traversal and symlink refusals hold through the read path", () => {
    expect(readWorkspaceText(root, "../outside/passwd").ok).toBe(false);
    expect(readWorkspaceText(root, "escape-link").ok).toBe(false);
  });
});
