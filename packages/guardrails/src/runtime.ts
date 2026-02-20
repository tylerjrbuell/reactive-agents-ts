import type { GuardrailConfig } from "./types.js";
import { defaultGuardrailConfig } from "./types.js";
import { GuardrailServiceLive } from "./guardrail-service.js";

export const createGuardrailsLayer = (config?: Partial<GuardrailConfig>) =>
  GuardrailServiceLive({
    ...defaultGuardrailConfig,
    ...config,
  });
