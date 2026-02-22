import type { PromptTemplate } from "../types/template.js";

// Original high-level templates
import { reactTemplate } from "./reasoning/react.js";
import { planExecuteTemplate } from "./reasoning/plan-execute.js";
import { treeOfThoughtTemplate } from "./reasoning/tree-of-thought.js";
import { reflexionTemplate } from "./reasoning/reflexion.js";
import { factCheckTemplate } from "./verification/fact-check.js";

// Strategy-specific system prompts
import { reactSystemTemplate } from "./reasoning/react-system.js";
import { reactThoughtTemplate } from "./reasoning/react-thought.js";
import { planExecutePlanTemplate } from "./reasoning/plan-execute-plan.js";
import { planExecuteExecuteTemplate } from "./reasoning/plan-execute-execute.js";
import { planExecuteReflectTemplate } from "./reasoning/plan-execute-reflect.js";
import { treeOfThoughtExpandTemplate } from "./reasoning/tree-of-thought-expand.js";
import { treeOfThoughtScoreTemplate } from "./reasoning/tree-of-thought-score.js";
import { treeOfThoughtSynthesizeTemplate } from "./reasoning/tree-of-thought-synthesize.js";
import { reflexionGenerateTemplate } from "./reasoning/reflexion-generate.js";
import { reflexionCritiqueTemplate } from "./reasoning/reflexion-critique.js";
import { adaptiveClassifyTemplate } from "./reasoning/adaptive-classify.js";

// Evaluation templates
import { judgeAccuracyTemplate } from "./evaluation/judge-accuracy.js";
import { judgeRelevanceTemplate } from "./evaluation/judge-relevance.js";
import { judgeCompletenessTemplate } from "./evaluation/judge-completeness.js";
import { judgeSafetyTemplate } from "./evaluation/judge-safety.js";
import { judgeGenericTemplate } from "./evaluation/judge-generic.js";

// Agent templates
import { defaultSystemTemplate } from "./agent/default-system.js";

export const allBuiltinTemplates: readonly PromptTemplate[] = [
  // High-level reasoning templates
  reactTemplate,
  planExecuteTemplate,
  treeOfThoughtTemplate,
  reflexionTemplate,
  factCheckTemplate,

  // Strategy-specific system prompts
  reactSystemTemplate,
  reactThoughtTemplate,
  planExecutePlanTemplate,
  planExecuteExecuteTemplate,
  planExecuteReflectTemplate,
  treeOfThoughtExpandTemplate,
  treeOfThoughtScoreTemplate,
  treeOfThoughtSynthesizeTemplate,
  reflexionGenerateTemplate,
  reflexionCritiqueTemplate,
  adaptiveClassifyTemplate,

  // Evaluation
  judgeAccuracyTemplate,
  judgeRelevanceTemplate,
  judgeCompletenessTemplate,
  judgeSafetyTemplate,
  judgeGenericTemplate,

  // Agent
  defaultSystemTemplate,
];
