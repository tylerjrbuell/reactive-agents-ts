import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";
import { KEY_PLACEHOLDER, providerDefaultModel, providerEnvVar, providerDisplayName } from "../lib/provider-config.js";
import { ownPackageVersionRange } from "../lib/own-version.js";
import { renderAgentsMd } from "./agents-md.js";

export function renderSharedFiles(
  opts: ScaffoldOptions,
  tpl: Pick<Template, "extraDependencies" | "extraDevDependencies" | "extraScripts" | "gitignoreLines">,
): readonly TemplateFile[] {
  // The default pin is derived from THIS package's own (lockstep-stamped)
  // version, so a scaffolded project always installs the framework release the
  // templates actually compile against. Templates rely on APIs that need
  // >= 0.14 (`.withOutputSchema`, `.withDurableRuns`, `.withApprovalPolicy`) -
  // a hardcoded fallback drifted behind the releases and scaffolded projects
  // that could not compile. `opts.version` still wins when injected; there is
  // no lying literal (drift is a release error - see scripts/release.ts).
  const raVersion = opts.version ?? ownPackageVersionRange();

  const scripts: Readonly<Record<string, string>> = {
    // Bun auto-loads .env at startup, so the bun arm needs no flag. The
    // tsx arm deliberately does NOT use `tsx --env-file=.env`: a missing
    // .env makes Node exit 9 ("node: .env: not found" - measured), and
    // `--env-file-if-exists` requires Node >= 22.9, above the declared
    // engines floor. The generated entry loads .env itself instead; keep
    // this asymmetry in sync with renderEnvGuard below.
    start: opts.packageManager === "bun" ? "bun run src/index.ts" : "tsx src/index.ts",
    typecheck: "tsc --noEmit",
    ...(tpl.extraScripts ?? {}),
  };

  const packageJson = JSON.stringify(
    {
      name: opts.projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      // Minimum Node version stated in the framework README.
      engines: { node: ">=22.5" },
      scripts,
      dependencies: {
        "reactive-agents": raVersion,
        ...(tpl.extraDependencies ?? {}),
      },
      devDependencies: {
        typescript: "^5.7.0",
        ...(opts.packageManager === "bun"
          ? { "bun-types": "latest" }
          : { "@types/node": "^22.0.0", tsx: "^4.19.0" }),
        ...(tpl.extraDevDependencies ?? {}),
      },
    },
    null,
    2,
  );

  const tsconfig = JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        types: opts.packageManager === "bun" ? ["bun-types"] : ["node"],
      },
      include: ["src/**/*"],
    },
    null,
    2,
  );

  const envVar = providerEnvVar(opts.provider);
  const envContent = envVar
    ? `# ${providerDisplayName(opts.provider)} credentials\n${envVar}=${KEY_PLACEHOLDER}\n`
    : `# Ollama runs locally — no API key needed.\n# Make sure Ollama is running: https://ollama.com\n`;

  const gitignore =
    [
      "node_modules",
      "dist",
      ".env",
      ".env.*",
      "!.env.example",
      "*.log",
      ".DS_Store",
      ...(tpl.gitignoreLines ?? []),
    ].join("\n") + "\n";

  return [
    { path: "package.json", content: packageJson + "\n" },
    { path: "tsconfig.json", content: tsconfig + "\n" },
    { path: ".env.example", content: envContent },
    { path: ".gitignore", content: gitignore },
    { path: "README.md", content: renderReadme(opts) },
    { path: "AGENTS.md", content: renderAgentsMd(opts, scripts) },
  ];
}

/**
 * The keyless-failure seam emitted at the top of every Node-runnable
 * template's src/index.ts (all templates except cloudflare-worker, which
 * reads its key from the Worker env binding instead).
 *
 * For the tsx/Node arm, the entry loads `.env` itself via
 * `process.loadEnvFile` (Node >= 20.12, inside the >= 22.5 engines floor) in a
 * try/catch: a missing `.env` falls through to the named guard error rather
 * than crashing. The bun arm gets only the guard, because bun auto-loads
 * `.env` at startup (and bun-types does not declare `loadEnvFile`, so emitting
 * it there would fail the generated `typecheck`). One seam, every template:
 * change the message here, not in seven files.
 */
export function renderEnvGuard(opts: ScaffoldOptions): string {
  const envVar = providerEnvVar(opts.provider);
  if (!envVar) {
    return "// Ollama is local - no API key required.";
  }
  const envLoad =
    opts.packageManager === "bun"
      ? ""
      : `if (!process.env.${envVar}) {
  // Node does not auto-load .env (bun does): read it here so a copied
  // .env.example works without exporting variables by hand. A missing .env
  // throws here and is swallowed - the guard below names the fix instead.
  try {
    process.loadEnvFile();
  } catch {
    // no .env yet: fall through to the check
  }
}

`;
  return `${envLoad}if (!process.env.${envVar} || process.env.${envVar} === "${KEY_PLACEHOLDER}") {
  console.error("Missing ${envVar}: copy .env.example to .env and replace ${KEY_PLACEHOLDER} with your key (or export the variable), then run the start script again.");
  process.exit(1);
}`;
}

/**
 * The provider-error seam emitted at the bottom of every Node-runnable
 * template's src/index.ts. Templates attach it as `.catch(fail)` to `build()`
 * and `run()` (a rejected top-level await otherwise prints the framework
 * source frame plus a `triggerUncaughtException` stack on a bad key or an
 * unreachable Ollama). `never` keeps `const result = await x.catch(fail)`
 * typed as the resolved value. A function declaration, so it hoists: the
 * example reads top to bottom with the helper out of the way at the end.
 */
export function renderFailHelper(): string {
  return `// Print a failed build or run as one line (no stack trace) and exit 1.
function fail(err: unknown): never {
  const message = typeof err === "object" && err !== null && "message" in err ? err.message : err;
  console.error(\`Error: \${message}\`);
  process.exit(1);
}`;
}

/**
 * The cost-print seam emitted by templates that show a run's cost. A model
 * with no known price adds nothing to the total rather than a guess, so the
 * figure is then a lower bound (`complete: false`) and must not print as an
 * exact total. Pair it with `await result.totalCost?.()` (the billed total)
 * on `run()` results, or `metadata.cost` + `metadata.costComplete` on a
 * `StreamCompleted` event.
 */
export function renderCostHelper(): string {
  return `// Print a run's cost. \`complete\` is false when a model had no known price:
// the total then leaves those calls out, so it is a lower bound.
function formatCost(cost: { usd: number; complete: boolean }): string {
  const usd = \`$\${cost.usd.toFixed(6)}\`;
  return cost.complete ? usd : \`>= \${usd} (some prices unknown)\`;
}`;
}

function renderReadme(opts: ScaffoldOptions): string {
  const envVar = providerEnvVar(opts.provider);
  const envBlock = envVar
    ? `Create \`.env\` from \`.env.example\` and set \`${envVar}\`:

\`\`\`bash
cp .env.example .env
\`\`\`

${
      opts.packageManager === "bun"
        ? "bun loads `.env` automatically at startup - no flag or export needed."
        : "The start script loads `.env` automatically (the generated entry reads it via `process.loadEnvFile` on Node >= 22.5). Exporting the variable in your shell also works."
    }`
    : `Ollama runs locally. Install and start it from <https://ollama.com>, then pull the model this project uses:

\`\`\`bash
ollama pull ${providerDefaultModel(opts.provider)}
\`\`\``;

  return `# ${opts.projectName}

A Reactive Agents project scaffolded with \`create-reactive-agent\`.

- **Template:** ${opts.template}
- **Provider:** ${providerDisplayName(opts.provider)}
- **Package manager:** ${opts.packageManager}

## Setup

${envBlock}

\`\`\`bash
${opts.packageManager} install
${opts.packageManager === "npm" ? "npm run start" : `${opts.packageManager} start`}
\`\`\`

## Learn more

- Docs: <https://docs.reactiveagents.dev>
- GitHub: <https://github.com/tylerjrbuell/reactive-agents-ts>
`;
}
