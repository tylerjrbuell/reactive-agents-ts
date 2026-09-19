export type Provider = "anthropic" | "openai" | "google" | "ollama" | "groq" | "xai";

export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export type TemplateName =
  | "minimal"
  | "with-tools"
  | "streaming"
  | "with-structured-output"
  | "with-approval-gates"
  | "with-memory"
  | "cloudflare-worker";

export interface ScaffoldOptions {
  readonly dir: string;
  readonly projectName: string;
  readonly template: TemplateName;
  readonly provider: Provider;
  readonly packageManager: PackageManager;
  readonly version?: string;
}

export interface TemplateFile {
  readonly path: string;
  readonly content: string;
}

export interface Template {
  readonly name: TemplateName;
  readonly description: string;
  readonly render: (opts: ScaffoldOptions) => readonly TemplateFile[];
  /** Extra npm dependencies this template needs beyond `reactive-agents`, merged into the generated package.json. */
  readonly extraDependencies?: Readonly<Record<string, string>>;
  /** Extra devDependencies (e.g. `wrangler`), merged into the generated package.json. */
  readonly extraDevDependencies?: Readonly<Record<string, string>>;
  /** Extra package.json scripts (e.g. `dev`, `deploy`), merged over the shared defaults. */
  readonly extraScripts?: Readonly<Record<string, string>>;
  /** Extra lines appended to the generated .gitignore (e.g. `.dev.vars`). */
  readonly gitignoreLines?: readonly string[];
}

export interface ScaffoldResult {
  readonly dir: string;
  readonly files: readonly string[];
  readonly nextSteps: readonly string[];
}
