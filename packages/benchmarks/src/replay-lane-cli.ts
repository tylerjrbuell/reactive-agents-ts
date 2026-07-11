// CLI entry for the bench:replay lane. Kept separate from replay-lane.ts so
// tests can import the lane's functions without triggering a process exit.
import { runReplayLane } from "./replay-lane.js";

process.exit(await runReplayLane());
