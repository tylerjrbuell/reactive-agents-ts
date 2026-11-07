Pre-registered 2026-11-07 before any A/B cell (from zero-token replay of 166 runs):
1. Uptake: small models rarely self-verify. Prior code-execute uptake: 1/67 lh-debug-green, 21/76 rw-7 failed runs.
   Predict shell-execute `bun test` calls in <=1/3 of shell-arm runs per tier.
2. rw-7: pipeline check stays failed in >=80% of runs both arms (Promise.all race is not behaviorally observable;
   26/33 wrong pipeline writes still use Promise.all and pass any behavioral test).
3. lh-debug-green: lift only in runs that actually run tests; dominant failure (1 of 6 modules written, then answer)
   persists unless the model runs tests. No resolvable accuracy gap at k=3.
