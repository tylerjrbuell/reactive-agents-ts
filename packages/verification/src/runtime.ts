import type { VerificationConfig } from "./types.js";
import { defaultVerificationConfig } from "./types.js";
import { VerificationServiceLive } from "./verification-service.js";

export const createVerificationLayer = (config?: Partial<VerificationConfig>) =>
  VerificationServiceLive({
    ...defaultVerificationConfig,
    ...config,
  });
