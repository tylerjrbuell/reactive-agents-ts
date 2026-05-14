import { mkdir, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import type { ScaffoldOptions, ScaffoldResult } from "../types.js";
import { renderTemplate } from "../templates/index.js";
import { providerEnvVar } from "./provider-config.js";

export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  const targetDir = path.resolve(opts.dir);

  if (existsSync(targetDir)) {
    const entries = await readdir(targetDir);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${targetDir}`);
    }
  } else {
    await mkdir(targetDir, { recursive: true });
  }

  const files = renderTemplate(opts);
  const written: string[] = [];

  for (const f of files) {
    const full = path.join(targetDir, f.path);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, f.content, "utf8");
    written.push(f.path);
  }

  return {
    dir: targetDir,
    files: written,
    nextSteps: buildNextSteps(opts),
  };
}

function buildNextSteps(opts: ScaffoldOptions): readonly string[] {
  const steps: string[] = [];
  steps.push(`cd ${opts.projectName}`);
  steps.push(`${opts.packageManager} install`);

  const envVar = providerEnvVar(opts.provider);
  if (envVar) {
    steps.push(`echo "${envVar}=your-key-here" > .env`);
  } else if (opts.provider === "ollama") {
    steps.push("# Ensure Ollama is running: https://ollama.com");
  }

  const runCmd = opts.packageManager === "npm" ? "npm run start" : `${opts.packageManager} start`;
  steps.push(runCmd);
  return steps;
}
