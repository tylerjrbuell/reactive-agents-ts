import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const HELP = `
  Usage: rax dev [options]

  Run your local agent entrypoint in watch mode.

  Options:
    --entry <path>     Entry file to run (default: src/index.ts)
    --no-watch         Run once without file watching
    --help             Show this help
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

  const command = watch
    ? ["--watch", "run", entry]
    : ["run", entry];

  console.log(`Starting dev runner: bun ${command.join(" ")}`);
  const child = spawnSync("bun", command, {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  process.exit(child.status ?? 1);
}
