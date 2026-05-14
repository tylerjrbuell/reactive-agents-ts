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
export { providerEnvVar, providerDefaultModel, providerImport } from "./lib/provider-config.js";
