import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { hasBunOnPath, isBunRuntime } from "../runtime.js";
import { fail } from "../ui.js";

const HELP = `
  Usage: rax dev [options]

  Run your local agent entrypoint in watch mode, with Bun when installed,
  else with the project's tsx (Node).

  Options:
    --entry <path>     Entry file to run (default: src/index.ts)
    --no-watch         Run once without file watching
    --help             Show this help

  Example:
    rax dev --entry src/main.ts
`.trimEnd();

export function runDev(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }

  let entry = "src/index.ts";
  let watch = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--entry" && args[i + 1]) {
      entry = args[++i];
    } else if (arg === "--no-watch") {
      watch = false;
    }
  }

  const entryPath = resolve(process.cwd(), entry);
  if (!existsSync(entryPath)) {
    const fallback = join(process.cwd(), "src", "main.ts");
    console.error(`Entry file not found: ${entry}`);
    if (existsSync(fallback)) {
      console.error("Tip: detected src/main.ts. Try: rax dev --entry src/main.ts");
    } else {
      console.error("Tip: pass a custom entry file with --entry <path>");
    }
    process.exit(1);
  }

  const tsxBin = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const runner = pickDevRunner(entry, watch, {
    bunAvailable: isBunRuntime() || hasBunOnPath(),
    tsxPath: existsSync(tsxBin) ? tsxBin : undefined,
  });
  if (!runner) {
    console.error(
      fail("rax dev needs Bun or a local tsx to run TypeScript. Install Bun (https://bun.sh) or run: npm install -D tsx"),
    );
    process.exit(1);
  }

  console.log(`Starting dev runner: ${runner.label} ${runner.args.join(" ")}`);
  const child = spawnSync(runner.command, runner.args, {
    stdio: "inherit",
    cwd: process.cwd(),
    // .cmd shims on Windows only launch through a shell.
    shell: process.platform === "win32" && runner.command.endsWith(".cmd"),
  });

  process.exit(child.status ?? 1);
}

/** A resolved dev runner: executable, its args, and a short display name. */
export interface DevRunner {
  readonly command: string;
  readonly label: string;
  readonly args: readonly string[];
}

/**
 * Pick how `rax dev` runs the entry. Bun first (unchanged behavior: `bun
 * --watch run`); on a Node-only machine, the project's own tsx, which the
 * npm/pnpm/yarn scaffolds already install. `undefined` = neither available.
 */
export function pickDevRunner(
  entry: string,
  watch: boolean,
  env: { readonly bunAvailable: boolean; readonly tsxPath: string | undefined },
): DevRunner | undefined {
  if (env.bunAvailable) {
    return { command: "bun", label: "bun", args: watch ? ["--watch", "run", entry] : ["run", entry] };
  }
  if (env.tsxPath !== undefined) {
    return { command: env.tsxPath, label: "tsx", args: watch ? ["watch", entry] : [entry] };
  }
  return undefined;
}
