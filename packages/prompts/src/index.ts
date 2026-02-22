// Types
export type {
  PromptVariable,
  PromptTemplate,
  CompiledPrompt,
} from "./types/template.js";

export {
  PromptVariableType,
  PromptVariableSchema,
  PromptTemplateSchema,
  CompiledPromptSchema,
} from "./types/template.js";

// Errors
export {
  PromptError,
  TemplateNotFoundError,
  VariableError,
  type PromptErrors,
} from "./errors/errors.js";

// Template engine
export { interpolate, estimateTokens } from "./services/template-engine.js";

// Built-in templates — reasoning (original high-level)
export { reactTemplate } from "./templates/reasoning/react.js";
export { planExecuteTemplate } from "./templates/reasoning/plan-execute.js";
export { treeOfThoughtTemplate } from "./templates/reasoning/tree-of-thought.js";
export { reflexionTemplate } from "./templates/reasoning/reflexion.js";
export { factCheckTemplate } from "./templates/verification/fact-check.js";

// Built-in templates — reasoning (strategy-specific system prompts)
export { reactSystemTemplate } from "./templates/reasoning/react-system.js";
export { reactThoughtTemplate } from "./templates/reasoning/react-thought.js";
export { planExecutePlanTemplate } from "./templates/reasoning/plan-execute-plan.js";
export { planExecuteExecuteTemplate } from "./templates/reasoning/plan-execute-execute.js";
export { planExecuteReflectTemplate } from "./templates/reasoning/plan-execute-reflect.js";
export { treeOfThoughtExpandTemplate } from "./templates/reasoning/tree-of-thought-expand.js";
export { treeOfThoughtScoreTemplate } from "./templates/reasoning/tree-of-thought-score.js";
export { treeOfThoughtSynthesizeTemplate } from "./templates/reasoning/tree-of-thought-synthesize.js";
export { reflexionGenerateTemplate } from "./templates/reasoning/reflexion-generate.js";
export { reflexionCritiqueTemplate } from "./templates/reasoning/reflexion-critique.js";
export { adaptiveClassifyTemplate } from "./templates/reasoning/adaptive-classify.js";

// Built-in templates — evaluation
export { judgeAccuracyTemplate } from "./templates/evaluation/judge-accuracy.js";
export { judgeRelevanceTemplate } from "./templates/evaluation/judge-relevance.js";
export { judgeCompletenessTemplate } from "./templates/evaluation/judge-completeness.js";
export { judgeSafetyTemplate } from "./templates/evaluation/judge-safety.js";
export { judgeGenericTemplate } from "./templates/evaluation/judge-generic.js";

// Built-in templates — agent
export { defaultSystemTemplate } from "./templates/agent/default-system.js";

// All built-in templates array (for bulk registration)
export { allBuiltinTemplates } from "./templates/all.js";

// Service
export { PromptService, PromptServiceLive } from "./services/prompt-service.js";

// Runtime
export { createPromptLayer } from "./runtime.js";
