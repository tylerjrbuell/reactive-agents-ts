import type { ScaffoldOptions, Template, TemplateFile, TemplateName } from "../types.js";
import { minimalTemplate } from "./minimal.js";
import { withToolsTemplate } from "./with-tools.js";
import { streamingTemplate } from "./streaming.js";
import { withStructuredOutputTemplate } from "./with-structured-output.js";
import { withApprovalGatesTemplate } from "./with-approval-gates.js";
import { withMemoryTemplate } from "./with-memory.js";
import { renderSharedFiles } from "./shared.js";

const TEMPLATES: Record<TemplateName, Template> = {
  minimal: minimalTemplate,
  "with-tools": withToolsTemplate,
  streaming: streamingTemplate,
  "with-structured-output": withStructuredOutputTemplate,
  "with-approval-gates": withApprovalGatesTemplate,
  "with-memory": withMemoryTemplate,
};

export function getTemplate(name: TemplateName): Template {
  return TEMPLATES[name];
}

export function listTemplates(): readonly Template[] {
  return Object.values(TEMPLATES);
}

export function renderTemplate(opts: ScaffoldOptions): readonly TemplateFile[] {
  const tpl = getTemplate(opts.template);
  const shared = renderSharedFiles(opts, tpl.extraDependencies);
  const specific = tpl.render(opts);
  return [...shared, ...specific];
}
