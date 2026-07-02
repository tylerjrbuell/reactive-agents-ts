// Run: bun test packages/tools/tests/skills/shell-execution-security.test.ts --timeout 15000
//
// F1a exploit corpus — every string below was CONFIRMED to bypass the shell-execute
// filters and reach `sh -c` on the host (arbitrary read/write/exec) in the
// 2026-07-01 security assessment. Each must now be DENIED (executed:false) BEFORE
// any process is spawned. Legitimate commands must remain un-blocked (regression).
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";

import { shellExecuteHandler } from "../../src/index.js";

/** Run a command through the default-config handler and return the result object. */
const run = (command: string, config = {}) =>
  Effect.runPromise(
    shellExecuteHandler(config)({ command }) as Effect.Effect<
      { executed: boolean; error?: string; output?: string },
      unknown
    >,
  );

describe("F1a — shell-execute structural input hardening", () => {
  describe("shell expansion / substitution is structurally rejected", () => {
    // Process substitution — inner command executes on the host → RCE.
    test("denies process substitution `<(...)`", async () => {
      const r = await run("cat <(id)");
      expect(r.executed).toBe(false);
    }, 15000);

    test("denies output process substitution `>(...)`", async () => {
      const r = await run("tee >(id)");
      expect(r.executed).toBe(false);
    }, 15000);

    // Bare $VAR expansion — reads injected credentials (e.g. $GH_CONFIG_DIR).
    test("denies bare variable expansion `$VAR`", async () => {
      const r = await run("cat $GH_CONFIG_DIR/hosts.yml");
      expect(r.executed).toBe(false);
    }, 15000);

    test("denies `$(...)` command substitution", async () => {
      const r = await run("echo $(id)");
      expect(r.executed).toBe(false);
    }, 15000);

    test("denies `${...}` parameter expansion", async () => {
      const r = await run("echo ${HOME}");
      expect(r.executed).toBe(false);
    }, 15000);
  });

  describe("path access outside the sandbox is structurally rejected", () => {
    // Leading quote defeated the old token.startsWith("/") check.
    test("denies quoted absolute path `\"/etc/passwd\"`", async () => {
      const r = await run('cat "/etc/passwd"');
      expect(r.executed).toBe(false);
    }, 15000);

    test("denies single-quoted absolute path `'/etc/passwd'`", async () => {
      const r = await run("cat '/etc/passwd'");
      expect(r.executed).toBe(false);
    }, 15000);

    // Bare relative traversal was only checked inside a `>` redirect branch.
    test("denies relative traversal `../../../../etc/passwd`", async () => {
      const r = await run("cat ../../../../etc/passwd");
      expect(r.executed).toBe(false);
    }, 15000);

    // tee default-allowed + relative write unchecked → arbitrary write → RCE on next login.
    test("denies relative write via tee `../../../home/victim/.bashrc`", async () => {
      const r = await run("echo x | tee ../../../home/victim/.bashrc");
      expect(r.executed).toBe(false);
    }, 15000);
  });

  describe("interpreter-internal escapes are rejected", () => {
    // awk print | "cmd" — awk-internal pipe to a shell → RCE.
    test("denies awk print-pipe to a command", async () => {
      const r = await run('awk \'BEGIN{print "id" | "/bin/sh"}\'');
      expect(r.executed).toBe(false);
    }, 15000);

    // awk getline < file — arbitrary file read.
    test("denies awk getline from an arbitrary file", async () => {
      const r = await run("awk 'BEGIN{while((getline l < \"/etc/passwd\")>0) print l}'");
      expect(r.executed).toBe(false);
    }, 15000);
  });

  describe("legitimate commands remain un-blocked (regression guard)", () => {
    test("allows `echo hello`", async () => {
      const r = await run("echo hello");
      expect(r.executed).toBe(true);
      expect(r.output).toContain("hello");
    }, 15000);

    test("does not policy-block `git status`", async () => {
      const r = await run("git status");
      // may exit non-zero (not a repo) but must not be refused by the input policy
      expect(r.error ?? "").not.toContain("blocked by security policy");
      expect(r.error ?? "").not.toContain("outside the sandbox");
    }, 15000);

    test("does not policy-block an in-sandbox relative path", async () => {
      const r = await run("cat notes.txt");
      expect(r.error ?? "").not.toContain("outside the sandbox");
    }, 15000);

    test("does not policy-block a glob argument", async () => {
      const r = await run("ls *.txt");
      expect(r.error ?? "").not.toContain("outside the sandbox");
      expect(r.error ?? "").not.toContain("blocked by security policy");
    }, 15000);

    test("does not policy-block an in-sandbox redirect", async () => {
      const r = await run("echo hi > out.txt");
      expect(r.error ?? "").not.toContain("outside the sandbox");
    }, 15000);

    test("does not policy-block a quoted jq pipe filter", async () => {
      const r = await run("echo '{}' | jq '.a // empty'");
      expect(r.error ?? "").not.toContain("blocked by security policy");
    }, 15000);

    test("allows a literal `$` inside single quotes (digit, not expansion)", async () => {
      const r = await run("echo 'costs $5'");
      expect(r.executed).toBe(true);
    }, 15000);
  });
});
