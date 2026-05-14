export type Provider = "anthropic" | "openai" | "google" | "ollama";

export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export type TemplateName = "minimal" | "with-tools" | "streaming";

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
}

export interface ScaffoldResult {
  readonly dir: string;
  readonly files: readonly string[];
  readonly nextSteps: readonly string[];
}
