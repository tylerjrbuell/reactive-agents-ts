# interaction/

Autonomy modes — control how much human supervision an agent requires.

| #   | File              | Shows                                                                                    | Offline? |
| --- | ----------------- | ---------------------------------------------------------------------------------------- | -------- |
| 21  | interaction-modes | Default autonomous, `.withInteraction()`, `.withKillSwitch()`, and full supervised stack | ✅       |

Runs offline. Demonstrates transitioning between supervision levels using the interaction layer and kill switch.

Run: `bun run ../../index.ts --filter interaction`
