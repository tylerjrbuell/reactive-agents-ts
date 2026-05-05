"use strict";

const message =
  "reactive-agents is an ESM-only package and cannot be loaded with CommonJS require().\n" +
  "\n" +
  "To use reactive-agents:\n" +
  "  • Use ESM import syntax:\n" +
  "      import { ReactiveAgents } from 'reactive-agents';\n" +
  "\n" +
  "  • Or set \"type\": \"module\" in your package.json:\n" +
  "      { \"type\": \"module\" }\n" +
  "\n" +
  "  • Or use dynamic import in CommonJS:\n" +
  "      const { ReactiveAgents } = await import('reactive-agents');\n" +
  "\n" +
  "Learn more: https://docs.reactiveagents.dev/installation\n" +
  "Reason: This package depends on Effect-TS and Bun-native APIs that require ESM.";

const error = new Error(message);
error.code = "ERR_REQUIRE_ESM";
throw error;
