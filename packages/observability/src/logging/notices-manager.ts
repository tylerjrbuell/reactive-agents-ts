/**
 * Manages notices and disclaimers.
 * Shows each notice once per session, respects user dismissals.
 */
export interface NoticesManager {
  /**
   * Check if a notice should be shown.
   * Returns true only if not yet shown/dismissed in this session.
   */
  shouldShow(noticeId: string): boolean;

  /**
   * Mark a notice as dismissed (won't show again this session).
   */
  dismiss(noticeId: string): void;

  /**
   * Reset all notices (for testing or new session).
   */
  reset(): void;
}

/**
 * Create a notices manager for the session.
 */
export function makeNoticesManager(): NoticesManager {
  const shown = new Set<string>();

  return {
    shouldShow(noticeId: string): boolean {
      if (shown.has(noticeId)) {
        return false;
      }
      shown.add(noticeId);
      return true;
    },

    dismiss(noticeId: string): void {
      shown.add(noticeId);
    },

    reset(): void {
      shown.clear();
    },
  };
}

/**
 * Pre-defined notice IDs for the framework.
 */
export const NOTICE_IDS = {
  TELEMETRY_ENABLED: "telemetry-enabled",
  STRATEGY_SWITCHING_DISABLED: "strategy-switching-disabled",
  LOCAL_MODEL_WARNINGS: "local-model-warnings",
} as const;
