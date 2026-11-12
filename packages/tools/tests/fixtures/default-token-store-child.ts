/**
 * Child-process helper for `default-token-store.test.ts`'s final-review C1 regression.
 *
 * Runs in its OWN process (spawned with an overridden `HOME`) because
 * `createFileTokenStore`'s default directory (`DEFAULT_MCP_AUTH_DIR`,
 * `../../src/mcp/auth/token-store.ts`) is computed once, at module-load time, from
 * `os.homedir()`. Overriding `process.env.HOME` from inside the test process would only
 * be reliable if this were the very first file in the whole `bun test` run to import
 * `mcp-client.ts` — true alphabetically today, but a silent trap for whoever adds a
 * test file that sorts earlier later. A real child process with its own `HOME` sidesteps
 * that ordering dependency entirely, and is also the only way to prove the connect
 * path really did write to `~/.reactive-agents/mcp-auth` under a real `HOME`, not just
 * to a directory a test happened to point a store at.
 *
 * Usage: bun run default-token-store-child.ts <resourceUrl> <clientId> <clientSecret>
 * Exits 0 on a successful connect (auth config has no explicit `tokenStore`, so it
 * exercises the real default), non-zero otherwise.
 */
import { Effect } from "effect";
import { makeMCPClient } from "../../src/mcp/mcp-client.js";

const [, , resourceUrl, clientId, clientSecret, expectedIssuer] = process.argv;

if (!resourceUrl || !clientId || !clientSecret) {
  console.error("usage: default-token-store-child.ts <resourceUrl> <clientId> <clientSecret>");
  process.exit(2);
}

const program = Effect.gen(function* () {
  const client = yield* makeMCPClient;
  yield* client.connect({
    name: "default-store-child",
    transport: "streamable-http",
    endpoint: resourceUrl,
    auth: { type: "client_credentials", clientId, clientSecret, expectedIssuer },
    // Deliberately no `tokenStore` — this is the exact case final-review C1 covers.
  });
});

Effect.runPromise(program)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
