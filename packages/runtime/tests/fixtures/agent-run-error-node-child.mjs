// agent-run-error-node-child.mjs — child process for run-error-output.test.ts.
// Rejects a top-level await with the run() boundary error under NODE (type
// stripping loads the zero-import .ts module directly), so the parent can
// assert what Node's uncaught-error printer shows a developer.
import { AgentRunError } from "../../src/errors/agent-run-error.ts";

const full = Object.assign(Object.create(Error.prototype), {
  message: "Authentication failed for anthropic: 401 invalid x-api-key — Verify ANTHROPIC_API_KEY",
});
const fail = async () => {
  throw new AgentRunError("Authentication failed for anthropic: 401 invalid x-api-key", full);
};
await fail();
