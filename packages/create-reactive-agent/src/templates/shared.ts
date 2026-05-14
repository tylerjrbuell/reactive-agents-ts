import type { ScaffoldOptions, TemplateFile } from "../types.js";
import { providerEnvVar, providerDisplayName } from "../lib/provider-config.js";

const RA_VERSION_FALLBACK = "^0.11.0";

export function renderSharedFiles(opts: ScaffoldOptions): readonly TemplateFile[] {
  const raVersion = opts.version ?? RA_VERSION_FALLBACK;

  const packageJson = JSON.stringify(
    {
      name: opts.projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        start: opts.packageManager === "bun" ? "bun run src/index.ts" : "tsx src/index.ts",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        "reactive-agents": raVersion,
      },
      devDependencies: {
        typescript: "^5.7.0",
        ...(opts.packageManager === "bun"
          ? { "bun-types": "latest" }
          : { "@types/node": "^22.0.0", tsx: "^4.19.0" }),
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

  const gitignore = `node_modules
dist
.env
.env.*
!.env.example
*.log
.DS_Store
`;

  return [
    { path: "package.json", content: packageJson + "\n" },
    { path: "tsconfig.json", content: tsconfig + "\n" },
    { path: ".env.example", content: envContent },
    { path: ".gitignore", content: gitignore },
    { path: "README.md", content: renderReadme(opts) },
  ];
}

function renderReadme(opts: ScaffoldOptions): string {
  const envVar = providerEnvVar(opts.provider);
  const envBlock = envVar
    ? `\`\`\`bash\nexport ${envVar}=your-key-here\n\`\`\``
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
