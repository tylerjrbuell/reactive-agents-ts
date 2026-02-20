import { Layer } from "effect";
import { OrchestrationService, OrchestrationServiceLive } from "./orchestration-service.js";

export const createOrchestrationLayer = (): Layer.Layer<OrchestrationService> =>
  Layer.effect(OrchestrationService, OrchestrationServiceLive);
