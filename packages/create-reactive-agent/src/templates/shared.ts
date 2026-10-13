import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";
import { providerEnvVar, providerDisplayName } from "../lib/provider-config.js";
import { ownPackageVersionRange } from "../lib/own-version.js";

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

  const packageJson = JSON.stringify(
    {
      name: opts.projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      // Minimum Node version stated in the framework README.
      engines: { node: ">=22.5" },
      scripts: {
        // Bun auto-loads .env at startup, so the bun arm needs no flag. The
        // tsx arm deliberately does NOT use `tsx --env-file=.env`: a missing
        // .env makes Node exit 9 ("node: .env: not found" - measured), and
        // `--env-file-if-exists` requires Node >= 22.9, above the declared
        // engines floor. The generated entry loads .env itself instead; keep
        // this asymmetry in sync with renderEnvGuard below.
        start: opts.packageManager === "bun" ? "bun run src/index.ts" : "tsx src/index.ts",
        typecheck: "tsc --noEmit",
        ...(tpl.extraScripts ?? {}),
      },
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
    ? `# ${providerDisplayName(opts.provider)} credentials\n${envVar}=your-key-here\n`
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
  return `${envLoad}if (!process.env.${envVar}) {
  console.error("Missing ${envVar}: copy .env.example to .env (or export the variable), then run the start script again.");
  process.exit(1);
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
    : `Ollama runs locally. Install and start it from <https://ollama.com>.`;

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
