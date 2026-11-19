export type {
  Provider,
  PackageManager,
  TemplateName,
  ScaffoldOptions,
  ScaffoldResult,
  TemplateFile,
  Template,
} from "./types.js";

export { scaffold } from "./lib/scaffold.js";
export { renderTemplate, getTemplate, listTemplates } from "./templates/index.js";
export { AGENTS_MD_HINT, DOCS_URL, LLMS_TXT_URL } from "./templates/agents-md.js";
export { providerEnvVar, providerDefaultModel, providerImport, providerRuntimeName } from "./lib/provider-config.js";
