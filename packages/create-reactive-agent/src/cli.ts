#!/usr/bin/env node
// create-reactive-agent — scaffold a new Reactive Agents project.
//
// Usage:
//   npm create reactive-agent
//   npm create reactive-agent my-app
//   npm create reactive-agent my-app -- --template=minimal --provider=anthropic
//
// Flags:
//   --template=<minimal|with-tools|streaming>
//   --provider=<anthropic|openai|google|ollama>
//   --pm=<bun|npm|pnpm|yarn>
//   --yes               Skip prompts, use defaults
//   --help, --version

import * as path from "node:path";
import { scaffold } from "./lib/scaffold.js";
import { listTemplates } from "./templates/index.js";
import {
  promptSelect,
  promptText,
  logSuccess,
  logInfo,
  logHeader,
} from "./lib/prompts.js";
import type { PackageManager, Provider, TemplateName } from "./types.js";

const VERSION = "0.11.0";

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly flags: ReadonlyMap<string, string | boolean>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (const token of argv) {
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 0) {
        flags.set(token.slice(2, eq), token.slice(eq + 1));
      } else {
        flags.set(token.slice(2), true);
      }
    } else if (token.startsWith("-") && token.length > 1) {
      flags.set(token.slice(1), true);
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function getStr(flags: ReadonlyMap<string, string | boolean>, key: string): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

function printHelp(): void {
  console.log(`create-reactive-agent v${VERSION}

Scaffold a new Reactive Agents project.

Usage:
  npm create reactive-agent [dir]
  npm create reactive-agent [dir] -- [options]

Options:
  --template=<name>     minimal | with-tools | streaming
  --provider=<name>     anthropic | openai | google | ollama
  --pm=<manager>        bun | npm | pnpm | yarn
  --yes                 Accept all defaults, skip prompts
  --version             Print version
  --help                Show this help

Templates:
${listTemplates()
  .map((t) => `  ${t.name.padEnd(14)} ${t.description}`)
  .join("\n")}

Example:
  npm create reactive-agent my-agent -- --template=streaming --provider=anthropic
`);
}

function detectPackageManager(): PackageManager {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("bun")) return "bun";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  return "npm";
}

function isValidTemplate(s: string): s is TemplateName {
  return s === "minimal" || s === "with-tools" || s === "streaming";
}

function isValidProvider(s: string): s is Provider {
  return s === "anthropic" || s === "openai" || s === "google" || s === "ollama";
}

function isValidPM(s: string): s is PackageManager {
  return s === "bun" || s === "npm" || s === "pnpm" || s === "yarn";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgs(argv);

  if (flags.has("help") || flags.has("h")) {
    printHelp();
    return;
  }
  if (flags.has("version") || flags.has("v")) {
    console.log(VERSION);
    return;
  }

  const skipPrompts = flags.has("yes") || flags.has("y") || !process.stdin.isTTY;

  const defaultName = "my-reactive-agent";
  const cliName = positional[0];

  const projectName = cliName ?? (skipPrompts
    ? defaultName
    : await promptText("Project name?", defaultName));

  const templateFlag = getStr(flags, "template");
  const template: TemplateName = templateFlag && isValidTemplate(templateFlag)
    ? templateFlag
    : skipPrompts
      ? "minimal"
      : await promptSelect<TemplateName>(
          "Which template?",
          [
            { value: "minimal", label: "minimal — single-file agent, no tools" },
            { value: "with-tools", label: "with-tools — agent with built-in tools" },
            { value: "streaming", label: "streaming — token-by-token streaming" },
          ],
          "minimal",
        );

  const providerFlag = getStr(flags, "provider");
  const provider: Provider = providerFlag && isValidProvider(providerFlag)
    ? providerFlag
    : skipPrompts
      ? "anthropic"
      : await promptSelect<Provider>(
          "Which LLM provider?",
          [
            { value: "anthropic", label: "Anthropic (Claude)" },
            { value: "openai", label: "OpenAI (GPT)" },
            { value: "google", label: "Google (Gemini)" },
            { value: "ollama", label: "Ollama (local, no key)" },
          ],
          "anthropic",
        );

  const pmFlag = getStr(flags, "pm");
  const packageManager: PackageManager = pmFlag && isValidPM(pmFlag)
    ? pmFlag
    : detectPackageManager();

  logHeader("Scaffolding project");
  logInfo(`Name:     ${projectName}`);
  logInfo(`Template: ${template}`);
  logInfo(`Provider: ${provider}`);
  logInfo(`PM:       ${packageManager}`);

  try {
    const result = await scaffold({
      dir: path.resolve(process.cwd(), projectName),
      projectName,
      template,
      provider,
      packageManager,
    });

    logSuccess(`Created ${result.files.length} files in ${result.dir}`);

    logHeader("Next steps");
    for (const step of result.nextSteps) {
      console.log(`  ${step}`);
    }
    console.log();
    logInfo("Docs: https://docs.reactiveagents.dev");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${msg}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nFatal: ${msg}`);
  process.exit(1);
});
