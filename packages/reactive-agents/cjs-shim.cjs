"use strict";

// CommonJS entry stub. Wired via the "require" export condition in package.json.
// Throws a helpful error because reactive-agents is ESM-only — Node's default
// CJS-loads-ESM path fails with cryptic ERR_INTERNAL_ASSERTION otherwise.

const message =
  "reactive-agents is an ESM-only package and cannot be loaded with CommonJS require().\n" +
  "\n" +
  "To use reactive-agents:\n" +
  "  - Use ESM import syntax:\n" +
  "      import { ReactiveAgents } from 'reactive-agents';\n" +
  "\n" +
  "  - Or set \"type\": \"module\" in your package.json:\n" +
  "      { \"type\": \"module\" }\n" +
  "\n" +
  "  - Or use dynamic import inside an async function in CommonJS:\n" +
  "      async function main() {\n" +
  "        const { ReactiveAgents } = await import('reactive-agents');\n" +
  "      }\n" +
  "\n" +
  "Learn more: https://github.com/tylerjrbuell/reactive-agents-ts#installation\n" +
  "Reason: This package depends on Effect-TS and Bun-native APIs that require ESM.";

const error = new Error(message);
error.code = "ERR_REQUIRE_ESM";
throw error;
