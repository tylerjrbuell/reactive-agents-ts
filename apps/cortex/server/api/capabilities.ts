/**
 * GET /api/capabilities — serves the framework CapabilityManifest so the Cortex
 * UI can render config controls + the strategy list dynamically. New strategies
 * / builder methods / config fields appear here automatically (the manifest is
 * derived from the registry + builder prototype + AgentConfigSchema). Static per
 * process (the framework memoizes it) — no DB, no service dependency.
 */
import { Elysia } from "elysia";
import { getCapabilityManifest } from "@reactive-agents/runtime";

export const capabilitiesRouter = new Elysia().get("/api/capabilities", () =>
  getCapabilityManifest(),
);
