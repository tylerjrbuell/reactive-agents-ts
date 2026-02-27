# multi-agent/

Agent-to-Agent (A2A) protocol, workflow orchestration, and dynamic sub-agent spawning.

| #   | File             | Shows                                                                         |
| --- | ---------------- | ----------------------------------------------------------------------------- |
| 08  | a2a-protocol     | Two agents communicate via A2A JSON-RPC: discovery → task delegation → result |
| 09  | orchestration    | 3-step workflow with approval gate; context flows between steps               |
| 10  | dynamic-spawning | Parent agent spawns specialist sub-agents at runtime via `spawn-agent` tool   |

All require `ANTHROPIC_API_KEY`. The A2A example (08) starts a local Bun HTTP server.

Run: `ANTHROPIC_API_KEY=sk-ant-... bun run ../../index.ts --filter multi-agent`
