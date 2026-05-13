const KILLSWITCH_NAMES = [
  'budgetLimit',
  'timeoutAfter',
  'maxIterations',
  'requireApprovalFor',
  'watchdog',
  'confidenceFloor',
] as const;

export type KillswitchName = typeof KILLSWITCH_NAMES[number];

export const killswitches = {
  list: (): readonly KillswitchName[] => KILLSWITCH_NAMES,
} as const;
