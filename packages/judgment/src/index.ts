export type {
  ChoiceAnswer,
  ChoiceCriteria,
  ChoiceSpec,
  JudgmentAnswer,
  JudgmentAnswers,
  JudgmentBackend,
  JudgmentCapabilities,
  JudgmentConfig,
  JudgmentEntry,
  JudgmentError,
  JudgmentModel,
  JudgmentQuestionKind,
  NoulAnswer,
  NoulSpec,
  QuestionSpec,
  QuestionSpecs,
  ScoreAnswer,
  ScoreCriteria,
  ScoreSpec,
} from "./types.js";
export {
  ChoiceAnswerSchema,
  DEFAULT_JUDGMENT_CAPABILITIES,
  DEFAULT_TIMEOUT_MS,
  JudgmentBadResponse,
  JudgmentConfig as JudgmentConfigSchema,
  JudgmentConnectionError,
  JudgmentRateLimited,
  JudgmentShadowDropped,
  JudgmentTimeout,
  JudgmentUnauthorized,
  JudgmentUnsupported,
  NoulAnswerSchema,
  ScoreAnswerSchema,
  passes,
} from "./types.js";

export { JudgmentService, capabilitiesOf, makeJudgmentServiceLive, withEvents } from "./services/judgment-service.js";
export type { AskPriority, ShadowGateOptions, ShadowStats } from "./services/judgment-service.js";
export { makeJevBackend } from "./backends/jev-backend.js";
export { makeLlmBackend } from "./backends/llm-backend.js";

// System One protocol core
export { makeSystemOneHttpBackend } from "./backends/systemone/engine.js";
export type {
  SystemOneProviderDescriptor,
  SystemOneHttpConfig,
} from "./backends/systemone/engine.js";
export { makeOllamaBackend } from "./backends/systemone/providers/ollama.js";
export type { OllamaJudgmentConfig } from "./backends/systemone/providers/ollama.js";
