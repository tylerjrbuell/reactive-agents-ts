import type { Layer } from "effect";
import { PromptServiceLive, type PromptService } from "./services/prompt-service.js";

export const createPromptLayer = (): Layer.Layer<PromptService> => PromptServiceLive;
