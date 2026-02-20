import { Layer } from "effect";
import type { InteractionConfig } from "./types/config.js";
import { defaultInteractionConfig } from "./types/config.js";
import { NotificationServiceLive } from "./services/notification-service.js";
import { ModeSwitcherLive } from "./services/mode-switcher.js";
import { CheckpointServiceLive } from "./services/checkpoint-service.js";
import { CollaborationServiceLive } from "./services/collaboration-service.js";
import { PreferenceLearnerLive } from "./services/preference-learner.js";
import { InteractionManagerLive } from "./services/interaction-manager.js";

/**
 * Create the Interaction layer (Phase 3 — all 5 modes).
 *
 * Provides: InteractionManager, ModeSwitcher, NotificationService,
 *           CheckpointService, CollaborationService, PreferenceLearner
 * Requires: EventBus (from @reactive-agents/core)
 */
export const createInteractionLayer = (
  config: InteractionConfig = defaultInteractionConfig,
) => {
  // Leaf services (depend only on EventBus from L1 Core)
  const NotificationLayer = NotificationServiceLive;
  const SwitcherLayer = ModeSwitcherLive(config);
  const CheckpointLayer = CheckpointServiceLive;
  const CollaborationLayer = CollaborationServiceLive;
  const PreferenceLayer = PreferenceLearnerLive;

  const LeafLayers = Layer.mergeAll(
    NotificationLayer,
    SwitcherLayer,
    CheckpointLayer,
    CollaborationLayer,
    PreferenceLayer,
  );

  // InteractionManager orchestrates all services
  const ManagerLayer = InteractionManagerLive.pipe(Layer.provide(LeafLayers));

  return Layer.mergeAll(ManagerLayer, LeafLayers);
};
