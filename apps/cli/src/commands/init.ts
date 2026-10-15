import { join } from "node:path";
import {
  scaffold,
  listTemplates,
  type PackageManager,
  type Provider,
  type ScaffoldResult,
  type TemplateName,
} from "create-reactive-agent";
import { banner, fail, info, kv, section, success } from "../ui.js";

/**
 * The engine's non-interactive default template (mirrors
 * `packages/create-reactive-agent/src/cli.ts`, which falls back to "minimal"
 * when it does not prompt). rax init stays non-interactive, so it adopts the
 * same default. No compat aliases for the old `standard`/`full` names: rax
 * init is pre-1.0 and a second name-mapping surface would re-fork the truth.
 */
const DEFAULT_TEMPLATE: TemplateName = "minimal";

function validTemplateNames(): readonly string[] {
  return listTemplates().map((t) => t.name);
}

export interface InitRequest {
  readonly projectName: string;
  readonly template: TemplateName;
}

/**
 * Pure argument validation for `rax init` (house pattern from sibling
 * commands: exported parser that throws with a usage message; the command
 * wrapper turns throws into `fail()` + exit). Validated against the engine's
 * `listTemplates()` - the single template-name truth.
 */
export function parseInitArgs(args: readonly string[]): InitRequest {
  const name = args[0];
  if (!name) {
    throw new Error(
      `Usage: rax init <project-name> [--template ${validTemplateNames().join("|")}]`,
    );
  }

  let template = DEFAULT_TEMPLATE;
  const templateIdx = args.indexOf("--template");
  if (templateIdx !== -1 && args[templateIdx + 1]) {
    const candidate = args[templateIdx + 1]!;
    if (!validTemplateNames().includes(candidate)) {
      throw new Error(
        `Invalid template: ${candidate}. Valid options: ${validTemplateNames().join(", ")}`,
      );
    }
    template = candidate as TemplateName;
  }

  return { projectName: name, template };
}

/**
 * Detect the provider from environment variables, returning the ENGINE's
 * `Provider` names (note: Gemini maps to `"google"`; the engine renders the
 * framework runtime name itself). Kept in init.ts because the engine exposes
 * no env detector to reuse - (its CLI defaults to "anthropic" instead) - this
 * is the one detector, not a fork of a second one.
 */
export function detectProviderFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): Provider {
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.OPENAI_API_KEY) return "openai";
  if (env.GOOGLE_API_KEY || env.GEMINI_API_KEY) return "google";
  if (env.GROQ_API_KEY) return "groq";
  if (env.XAI_API_KEY) return "xai";
  return "ollama";
}

/** Infer the package manager: bun when running under Bun, else npm (matches
 * the engine CLI's defaults; rax init has no pnpm/yarn launch path). */
export function detectPackageManager(): PackageManager {
  return typeof Bun !== "undefined" ? "bun" : "npm";
}

export interface CreateProjectInput {
  readonly projectName: string;
  readonly template: TemplateName;
  readonly provider: Provider;
  readonly packageManager: PackageManager;
  /** Directory the project folder is created in (usually process.cwd()). */
  readonly cwd: string;
  /**
   * Optional explicit framework range. Left undefined by `rax init` so the
   * engine's W0.1 own-version truth applies.
   */
  readonly version?: string;
}

/**
 * The delegation seam: builds `ScaffoldOptions` and calls the engine's
 * `scaffold()`. Everything generated here (version pin, env guard, README,
 * next steps) comes from create-reactive-agent; init.ts owns only UX.
 */
export async function createProject(input: CreateProjectInput): Promise<ScaffoldResult> {
  const targetDir = join(input.cwd, input.projectName);
  let provider = input.provider;
  if (input.template === "cloudflare-worker" && provider !== "openai") {
    // Mirrors the engine CLI rule: the edge runtime is only verified on
    // OpenAI (fetch-based, workerd-safe), so pin it rather than scaffold a
    // project that cannot run.
    provider = "openai";
  }
  return scaffold({
    dir: targetDir,
    projectName: input.projectName,
    template: input.template,
    provider,
    packageManager: input.packageManager,
    ...(input.version !== undefined ? { version: input.version } : {}),
  });
}

function helpText(): string {
  const names = validTemplateNames().join(" | ");
  return `
  Usage: rax init <name> [options]

  Scaffold a new reactive-agents project from a template.
  Delegates to the create-reactive-agent template engine.

  Arguments:
    <name>             Project directory name to create

  Options:
    --template <type>  Template: ${names} (default: ${DEFAULT_TEMPLATE})
    --help, -h         Show this help

  Examples:
    rax init my-agent
    rax init my-agent --template with-tools
`.trimEnd();
}

export function runInit(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(helpText());
    return;
  }

  let request: InitRequest;
  try {
    request = parseInitArgs(args);
  } catch (error) {
    console.error(fail(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }

  const detectedProvider = detectProviderFromEnv(process.env);
  const packageManager = detectPackageManager();

  banner("rax init", `Creating "${request.projectName}" with template "${request.template}"`);
  console.log(
    info(
      `Creating project "${request.projectName}" with template "${request.template}" (provider: ${detectedProvider})...`,
    ),
  );

  void createProject({
    projectName: request.projectName,
    template: request.template,
    provider: detectedProvider,
    packageManager,
    cwd: process.cwd(),
  })
    .then((result) => {
      console.log(success(`Created ${result.files.length} files:`));
      for (const file of result.files) {
        console.log(`  - ${file}`);
      }
      console.log(section("Next Steps"));
      result.nextSteps.forEach((step, i) => {
        console.log(kv(String(i + 1), step));
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(fail(message));
      process.exit(1);
    });
}
