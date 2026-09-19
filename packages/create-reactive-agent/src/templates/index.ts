import type { ScaffoldOptions, Template, TemplateFile, TemplateName } from "../types.js";
import { minimalTemplate } from "./minimal.js";
import { withToolsTemplate } from "./with-tools.js";
import { streamingTemplate } from "./streaming.js";
import { withStructuredOutputTemplate } from "./with-structured-output.js";
import { withApprovalGatesTemplate } from "./with-approval-gates.js";
import { withMemoryTemplate } from "./with-memory.js";
import { cloudflareWorkerTemplate } from "./cloudflare-worker.js";
import { renderSharedFiles } from "./shared.js";

const TEMPLATES: Record<TemplateName, Template> = {
  minimal: minimalTemplate,
  "with-tools": withToolsTemplate,
  streaming: streamingTemplate,
  "with-structured-output": withStructuredOutputTemplate,
  "with-approval-gates": withApprovalGatesTemplate,
  "with-memory": withMemoryTemplate,
  "cloudflare-worker": cloudflareWorkerTemplate,
};

export function getTemplate(name: TemplateName): Template {
  return TEMPLATES[name];
}

export function listTemplates(): readonly Template[] {
  return Object.values(TEMPLATES);
}

export function renderTemplate(opts: ScaffoldOptions): readonly TemplateFile[] {
  const tpl = getTemplate(opts.template);
  const shared = renderSharedFiles(opts, tpl);
  const specific = tpl.render(opts);
  // Template-specific files override shared ones at the same path (last wins),
  // keeping the shared slot's position. Lets a template replace e.g. README.md
  // or .env.example without re-deriving the shared package.json logic.
  return dedupeByPath([...shared, ...specific]);
}

function dedupeByPath(files: readonly TemplateFile[]): readonly TemplateFile[] {
  const byPath = new Map<string, TemplateFile>();
  for (const file of files) byPath.set(file.path, file);
  return [...byPath.values()];
}
