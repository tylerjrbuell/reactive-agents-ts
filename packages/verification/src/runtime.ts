import type { VerificationConfig, VerificationLLM } from "./types.js";
import { defaultVerificationConfig } from "./types.js";
import { VerificationServiceLive } from "./verification-service.js";

export const createVerificationLayer = (config?: Partial<VerificationConfig>, llm?: VerificationLLM) =>
  VerificationServiceLive({
    ...defaultVerificationConfig,
    ...config,
  }, llm);
