// Run: bun test packages/tools/tests/skills/shell-program-guard-seam.test.ts --timeout 15000
//
// Seam pin for skills/shell-program-guard.ts (deny-by-default sed/awk program parse)
// and the option-value path check in shell-command-segments.ts. Every DENIED case
// below was reproduced as host command execution / out-of-sandbox write with the
// default allow-list (2026-11-12 security audit, C1).
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { existsSync, rmSync } from "node:fs";

import { shellExecuteHandler } from "../../src/index.js";
import { scriptEscapeDenial } from "../../src/skills/shell-program-guard.js";
import { pathCandidateTokens } from "../../src/skills/shell-command-segments.js";

const run = (command: string) =>
  Effect.runPromise(
    shellExecuteHandler({})({ command }) as Effect.Effect<
      { executed: boolean; error?: string; output?: string },
      unknown
    >,
  );

describe("scriptEscapeDenial — refused programs", () => {
  const denied: ReadonlyArray<string> = [
    "echo id | sed e",
    "sed '1e id'",
    "sed -e 'e id'",
    "sed -ne 'e id'",
    "sed --expression='e id'",
    "sed -l 5 'e id'",
    "sed '$!{e id}'",
    "sed '/x/e id'",
    "sed '/x/,/y/w /tmp/f'",
    "sed 's/a/b/w/tmp/f'",
    "sed 's|a|b|w /tmp/f'",
    "sed 's/a/b/e'",
    "sed 's/a/b/ge'",
    "sed 'r /etc/passwd'",
    "sed 'R /etc/passwd'",
    "sed 'w out'",
    "sed -f script.sed",
    "sed --file=script.sed",
    "xargs sed e",
    "xargs -I {} sed 'e id' {}",
    "env X=1 sed e",
    `awk '{print $0 |("id")}'`,
    `awk '{print $0 | "id"}'`,
    `awk 'BEGIN{system("id")}'`,
    `awk 'BEGIN{"id" | getline x; print x}'`,
    `awk 'BEGIN{getline x < "/etc/passwd"}'`,
    `awk 'BEGIN{print "x" > ("/tm" "p/f")}'`,
    `awk 'BEGIN{print "x" >> "out"}'`,
    `awk 'BEGIN{printf "x" > "out"}'`,
    `awk 'BEGIN{ARGV[1]="/etc/passwd"; ARGC=2} {print}'`,
    `awk '/a/ {print} @include "x"'`,
    "awk -f prog.awk",
    "awk -i inplace '{print}'",
    "awk --file=prog.awk",
    "sort -S 1 --compress-program=sh x",
    // find write options + -exec of a program outside the allow-list (2026-11-12 third pass)
    "find . -maxdepth 1 -fprint /tmp/ra-find-out",
    "find . -fprintf /tmp/ra-find-out '%p'",
    "find . -fprint0 /tmp/ra-find-out",
    "find . -fls /tmp/ra-find-out",
    "find . -exec sh -c id ;",
    "find . -execdir curl http://x ;",
    "find . -ok sh ;",
    "find . -okdir bash ;",
    "find . -exec sed e {} ;",
    "find . -exec awk 'BEGIN{system(\"id\")}' {} +",
    "find . -exec /bin/sh -c id ;",
  ];
  for (const command of denied) {
    test(`denies: ${command}`, () => {
      const direct = scriptEscapeDenial(command);
      // sort --compress-program is a block-list rule, not the parser's job.
      if (!command.startsWith("sort")) expect(direct).not.toBeNull();
    });
    test(`handler refuses before spawn: ${command}`, async () => {
      const result = await run(command);
      expect(result.executed).toBe(false);
      // xargs/env are opt-in commands: the allow-list refuses them first by default.
      if (!/^(xargs|env) /.test(command)) expect(result.error).toContain("blocked by security policy");
    }, 15000);
  }

  test("a granted wrapper does not hide the program (xargs sed e)", async () => {
    const result = await Effect.runPromise(
      shellExecuteHandler({ additionalCommands: ["xargs", "env"] })({ command: "echo id | xargs -I {} sed e {}" }) as Effect.Effect<
        { executed: boolean; error?: string },
        unknown
      >,
    );
    expect(result.executed).toBe(false);
    expect(result.error).toContain("sed e command");
  }, 15000);

  test("sed w to an absolute path writes nothing", async () => {
    const target = `/tmp/ra-sed-escape-${process.pid}`;
    rmSync(target, { force: true });
    const result = await run(`echo hi | sed 's/hi/X/w${target}'`);
    expect(result.executed).toBe(false);
    expect(existsSync(target)).toBe(false);
  }, 15000);
});

describe("scriptEscapeDenial — legitimate programs stay allowed", () => {
  const allowed: ReadonlyArray<string> = [
    "find . -name '*.ts' -print",
    "find . -type f -exec cat {} ;",
    "find . -type f -exec grep -l foo {} +",
    "find . -name x -execdir ls {} ;",
    "sed 's/a/b/g' file.txt",
    "sed -n '1,5p' file.txt",
    "sed -n '/foo/p;/bar/d' file.txt",
    "sed -i 's/a/b/' file.txt",
    "sed -E 's/(a|b)+/X/g' file.txt",
    "sed 's/a/b/;s/c/d/' file.txt",
    "sed '/start/,/end/d' file.txt",
    "sed '2q' file.txt",
    "sed 'y/abc/xyz/' file.txt",
    "sed '/x/{s/a/b/;p}' file.txt",
    "sed -e 's/a/b/' -e 's/c/d/' file.txt",
    "sed 's/a/b/w' file.txt".replace("/w", "/g"),
    `awk '{print $1}' file.txt`,
    `awk '$3 > 5' file.txt`,
    `awk '$3 > 5 {print $1}' file.txt`,
    `awk -F, '{print $2}' file.txt`,
    `awk -F ',' '{ sum += $2 } END { print sum }' file.txt`,
    `awk '/foo|bar/ {print}' file.txt`,
    `awk '$1 == 1 || $2 == 2' file.txt`,
    `awk 'BEGIN{x = 1; print (x > 0)}'`,
    `awk -v n=3 'NR <= n' file.txt`,
    `awk '{ printf "%s\\n", $1 }' file.txt`,
    `awk 'length($0) > 80' file.txt`,
  ];
  for (const command of allowed) {
    test(`allows: ${command}`, () => {
      expect(scriptEscapeDenial(command)).toBeNull();
    });
  }

  test("a sed/awk pipeline still runs end to end", async () => {
    const result = await run(`echo "a b c" | awk '{print $2}' | sed 's/b/B/'`);
    expect(result.executed).toBe(true);
    expect(result.output).toContain("B");
  }, 15000);
});

describe("option values are path-checked", () => {
  test("pathCandidateTokens exposes the value of --opt=/abs and -o/abs", () => {
    expect(pathCandidateTokens("sort --output=/tmp/x")).toContain("/tmp/x");
    expect(pathCandidateTokens("sort -o/tmp/x")).toContain("/tmp/x");
    expect(pathCandidateTokens("tool --file=../x")).toContain("../x");
    // A lone slash is a delimiter, not a path.
    expect(pathCandidateTokens("cut -d/ -f1")).not.toContain("/");
  });

  test("sort --output=/tmp/x is refused and writes nothing", async () => {
    const target = `/tmp/ra-opt-escape-${process.pid}`;
    rmSync(target, { force: true });
    const result = await run(`echo pwned | sort --output=${target}`);
    expect(result.executed).toBe(false);
    expect(result.error).toContain("outside the sandbox");
    expect(existsSync(target)).toBe(false);
  }, 15000);

  test("sort -o/abs (glued short option) is refused", async () => {
    const result = await run("echo pwned | sort -o/tmp/ra-glued-escape");
    expect(result.executed).toBe(false);
  }, 15000);

  test("ordinary options and delimiters still run", async () => {
    const result = await run(`echo "a/b/c" | cut -d/ -f2`);
    expect(result.executed).toBe(true);
    expect(result.output).toContain("b");
  }, 15000);
});
