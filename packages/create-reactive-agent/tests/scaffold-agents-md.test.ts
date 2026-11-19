// AGENTS.md pin: every scaffolded project ships one AGENTS.md that points
// coding agents at the current docs (llms.txt, .md page twins, consumer
// skills) instead of training data, and the post-scaffold output says so.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { scaffold } from "../src/lib/scaffold.js";
import { listTemplates } from "../src/templates/index.js";
import { AGENTS_MD_HINT, DOCS_URL, LLMS_TXT_URL } from "../src/templates/agents-md.js";
import type { PackageManager } from "../src/types.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "cra-agents-md-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

const PMS: readonly PackageManager[] = ["bun", "npm", "pnpm", "yarn"];

describe("AGENTS.md in every scaffolded project", () => {
  for (const tpl of listTemplates()) {
    for (const pm of PMS) {
      test(`${tpl.name} × ${pm} writes AGENTS.md with the docs entry and real scripts`, async () => {
        const result = await scaffold({
          dir: path.join(tmpRoot, `${tpl.name}-${pm}`),
          projectName: `${tpl.name}-${pm}`,
          template: tpl.name,
          provider: tpl.name === "cloudflare-worker" ? "openai" : "anthropic",
          packageManager: pm,
        });
        expect(result.files).toContain("AGENTS.md");

        const md = await readFile(path.join(result.dir, "AGENTS.md"), "utf8");
        expect(md).toContain(LLMS_TXT_URL);
        expect(md).toContain(`npx skills add ${DOCS_URL}`);
        expect(md).toContain("append `.md` to the page URL");
        if (tpl.name === "cloudflare-worker") {
          // No filesystem on workerd: no trace section, secrets via .dev.vars.
          expect(md).not.toContain("rax diagnose");
          expect(md).toContain(".dev.vars");
        } else {
          expect(md).toContain("npx rax diagnose cause latest");
          expect(md).toContain(".env.example");
        }
        expect(md.split("\n").length).toBeLessThanOrEqual(60);

        // The Run section lists only scripts the generated package.json has.
        const pkg = JSON.parse(
          await readFile(path.join(result.dir, "package.json"), "utf8"),
        ) as { scripts: Record<string, string> };
        const listed = [...md.matchAll(new RegExp(`^${pm} run (\\S+)`, "gm"))].map((m) => m[1]!);
        expect(listed.length).toBeGreaterThan(0);
        for (const name of listed) expect(pkg.scripts[name]).toBeDefined();
        expect(listed).toContain("typecheck");
        if (tpl.name === "cloudflare-worker") {
          expect(listed).toContain("dev");
          expect(listed).not.toContain("start");
        } else {
          expect(listed).toContain("start");
        }
      });
    }
  }
});

describe("post-scaffold output", () => {
  test("the CLI success output mentions AGENTS.md", () => {
    const cli = path.join(import.meta.dir, "..", "src", "cli.ts");
    const run = spawnSync(
      process.execPath,
      [cli, "agent-app", "--yes", "--template=minimal", "--provider=ollama", "--pm=bun"],
      { cwd: tmpRoot, encoding: "utf8" },
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(AGENTS_MD_HINT);
  });
});
