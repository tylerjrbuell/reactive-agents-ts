/**
 * Example 11: Agent Identity & Cryptography
 *
 * Demonstrates:
 * - Ed25519 certificate generation via makeCertificateAuth
 * - Signature verification (authenticate a certificate)
 * - Role-Based Access Control via makePermissionManager
 * - Certificate fingerprint inspection
 * - Permission delegation between agents
 *
 * This example runs entirely offline — no LLM, no API key required.
 * All operations are pure cryptographic / in-memory.
 *
 * Usage:
 *   bun run apps/examples/src/trust/11-identity.ts
 */

import { Effect } from "effect";
import {
  makeCertificateAuth,
  makePermissionManager,
  DefaultRoles,
} from "@reactive-agents/identity";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  const lines: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    lines.push(msg);
  };

  log("\n=== Agent Identity & Cryptography Example ===\n");

  const program = Effect.gen(function* () {
    // ── Step 1: Create a certificate authority ──────────────────────────────
    log("Step 1: Creating certificate authority...");
    const ca = yield* makeCertificateAuth;

    // ── Step 2: Issue Ed25519 certificate for an agent ──────────────────────
    log("Step 2: Issuing Ed25519 certificate for agent 'primary-agent'...");
    const cert = yield* ca.issueCertificate("primary-agent");

    log(`  Serial:      ${cert.serialNumber}`);
    log(`  Agent ID:    ${cert.agentId}`);
    log(`  Fingerprint: ${cert.fingerprint}`);
    log(`  Public Key:  ${cert.publicKey.slice(0, 20)}...`);
    log(`  Issued At:   ${cert.issuedAt.toISOString()}`);
    log(`  Expires At:  ${cert.expiresAt.toISOString()}`);
    log(`  Signature:   ${cert.signature ? cert.signature.slice(0, 20) + "..." : "(none)"}`);

    // ── Step 3: Verify the certificate signature ─────────────────────────────
    log("\nStep 3: Verifying certificate signature...");
    const authResult = yield* ca.authenticate(cert);

    log(`  Authenticated: ${authResult.authenticated}`);
    log(`  Agent ID:      ${authResult.agentId}`);

    if (!authResult.authenticated) {
      return yield* Effect.fail(new Error("Certificate authentication failed"));
    }

    // ── Step 4: RBAC — assign roles to agents ────────────────────────────────
    log("\nStep 4: Setting up RBAC with DefaultRoles...");
    const pm = yield* makePermissionManager;

    const standardRole = DefaultRoles["agent-standard"]!;
    const orchestratorRole = DefaultRoles["orchestrator"]!;

    yield* pm.assignRole("primary-agent", standardRole);
    yield* pm.assignRole("orchestrator-agent", orchestratorRole);

    const primaryRoles = yield* pm.getRoles("primary-agent");
    log(`  primary-agent roles:      [${primaryRoles.map((r) => r.name).join(", ")}]`);

    const orchRoles = yield* pm.getRoles("orchestrator-agent");
    log(`  orchestrator-agent roles: [${orchRoles.map((r) => r.name).join(", ")}]`);

    // ── Step 5: Authorize allowed access ─────────────────────────────────────
    log("\nStep 5: Checking authorized permissions...");
    const allowedDecision = yield* pm.authorize(
      "primary-agent",
      "tools/file-write",
      "execute",
    );
    log(`  primary-agent execute tools/file-write: ${allowedDecision.allowed ? "ALLOWED" : "DENIED"}`);
    log(`  Matched permission: ${allowedDecision.matchedPermission?.resource}`);

    const memoryReadDecision = yield* pm.authorize(
      "primary-agent",
      "memory/working",
      "read",
    );
    log(`  primary-agent read  memory/working:     ${memoryReadDecision.allowed ? "ALLOWED" : "DENIED"}`);

    // ── Step 6: Reject unauthorized access ───────────────────────────────────
    log("\nStep 6: Verifying unauthorized access is rejected...");
    const deniedResult = yield* pm
      .authorize("primary-agent", "agents/worker-99", "admin")
      .pipe(Effect.either);

    const denied = deniedResult._tag === "Left";
    log(`  primary-agent admin agents/worker-99:   ${denied ? "DENIED (expected)" : "ALLOWED (unexpected)"}`);

    // ── Step 7: Orchestrator has full access ─────────────────────────────────
    log("\nStep 7: Verifying orchestrator has full admin access...");
    const orchAdmin = yield* pm.authorize(
      "orchestrator-agent",
      "agents/worker-99",
      "admin",
    );
    log(`  orchestrator-agent admin agents/worker-99: ${orchAdmin.allowed ? "ALLOWED" : "DENIED"}`);

    // ── Step 8: Certificate fingerprint is deterministic ─────────────────────
    log("\nStep 8: Verifying certificate fingerprint is non-empty...");
    const fingerprintValid =
      typeof cert.fingerprint === "string" && cert.fingerprint.length === 32;
    log(`  Fingerprint length: ${cert.fingerprint.length} chars (expected 32) — ${fingerprintValid ? "VALID" : "INVALID"}`);

    // ── Step 9: Permission delegation ────────────────────────────────────────
    log("\nStep 9: Delegating 'execute' on 'tools/sandbox' from orchestrator to primary...");
    const delegation = yield* pm.delegate(
      "orchestrator-agent",
      "primary-agent",
      [{ resource: "tools/sandbox", actions: ["execute"] }],
      "temporary tool grant",
      60_000,
    );
    log(`  Delegation ID: ${delegation.id}`);
    log(`  Status:        ${delegation.status}`);

    const delegatedDecision = yield* pm.authorize(
      "primary-agent",
      "tools/sandbox",
      "execute",
    );
    log(`  primary-agent execute tools/sandbox (via delegation): ${delegatedDecision.allowed ? "ALLOWED" : "DENIED"}`);

    // ── Step 10: Certificate revocation ──────────────────────────────────────
    log("\nStep 10: Revoking certificate and verifying rejection...");
    yield* ca.revokeCertificate(cert.serialNumber);
    const revokedResult = yield* ca.authenticate(cert).pipe(Effect.either);
    const revokedCorrectly = revokedResult._tag === "Left";
    log(`  Revoked cert authentication: ${revokedCorrectly ? "REJECTED (expected)" : "ACCEPTED (unexpected)"}`);

    // ── Pass criteria ─────────────────────────────────────────────────────────
    const passed =
      authResult.authenticated &&          // cert verification succeeded
      allowedDecision.allowed &&            // standard agent can execute tools
      memoryReadDecision.allowed &&         // standard agent can read memory
      denied &&                             // basic agent cannot admin agents/*
      orchAdmin.allowed &&                  // orchestrator can admin anything
      fingerprintValid &&                   // fingerprint is 32 hex chars
      delegatedDecision.allowed &&          // delegated permission works
      revokedCorrectly;                     // revoked cert is rejected

    log(`\n${"─".repeat(50)}`);
    log(`Pass: ${passed}`);

    return passed;
  });

  const passed = await Effect.runPromise(
    program.pipe(
      Effect.catchAll((err) => {
        console.error("Example failed:", err);
        return Effect.succeed(false);
      }),
    ),
  );

  const output = lines.join("\n");
  return {
    passed: passed as boolean,
    output,
    steps: 10,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
