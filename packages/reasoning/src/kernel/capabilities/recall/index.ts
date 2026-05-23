/**
 * recall/ — Per-iter memory/skill/profile recall capability barrel.
 *
 * Phase 1 (Issue #129): seam-only. Exports the RecallService tag and the
 * NoopRecallServiceLayer default. Phase 2 will add MemoryStore /
 * SkillStore / CalibrationStore-backed Layers from other warden
 * dispatches and migrate the upstream
 * `packages/runtime/src/engine/bootstrap/` recall through this seam.
 */
export {
  RecallService,
  NoopRecallServiceLayer,
  type RecallServiceMethods,
  type MemoryRecallResult,
  type FoundSkill,
  type ProfileSnapshot,
} from "./recall-service.js";
