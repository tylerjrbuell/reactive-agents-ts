import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { makeCertificateAuth } from "../src/auth/certificate-auth.js";
import type { Certificate } from "../src/types.js";

const run = <A>(effect: Effect.Effect<A, any>) => Effect.runPromise(effect);

describe("CertificateAuth", () => {
  test("creates valid certificate", async () => {
    const certAuth = await run(makeCertificateAuth);
    const cert = await run(certAuth.issueCertificate("agent-1"));

    expect(cert.agentId).toBe("agent-1");
    expect(cert.serialNumber).toBeDefined();
    expect(cert.publicKey).toBeDefined();
    expect(cert.fingerprint).toBeDefined();
    expect(cert.status).toBe("active");
    expect(cert.issuer).toBe("reactive-agents-ca");
    expect(cert.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test("respects custom TTL", async () => {
    const certAuth = await run(makeCertificateAuth);
    const now = Date.now();
    const cert = await run(certAuth.issueCertificate("agent-1", 1000));

    expect(cert.expiresAt.getTime()).toBeGreaterThanOrEqual(now + 1000);
    expect(cert.expiresAt.getTime()).toBeLessThan(now + 2000);
  });

  test("validates certificate on authentication", async () => {
    const certAuth = await run(makeCertificateAuth);
    const cert = await run(certAuth.issueCertificate("agent-1"));
    const result = await run(certAuth.authenticate(cert));

    expect(result.authenticated).toBe(true);
    expect(result.agentId).toBe("agent-1");
  });

  test("rejects expired certificates", async () => {
    const certAuth = await run(makeCertificateAuth);
    const cert = await run(certAuth.issueCertificate("agent-1", 0));
    await Effect.runPromise(Effect.sleep("5 millis"));

    const error = await run(certAuth.authenticate(cert).pipe(Effect.flip));
    expect(error.reason).toBe("expired");
  });

  test("rejects revoked certificates", async () => {
    const certAuth = await run(makeCertificateAuth);
    const cert = await run(certAuth.issueCertificate("agent-1"));

    await run(certAuth.revokeCertificate(cert.serialNumber));

    const error = await run(certAuth.authenticate(cert).pipe(Effect.flip));
    expect(error.reason).toBe("revoked");
  });

  test("rejects invalid certificates", async () => {
    const certAuth = await run(makeCertificateAuth);
    const invalidCert: Certificate = {
      serialNumber: "",
      agentId: "agent-1",
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      publicKey: "",
      issuer: "test",
      fingerprint: "",
      status: "active",
    };

    const error = await run(certAuth.authenticate(invalidCert).pipe(Effect.flip));
    expect(error.reason).toBe("invalid-certificate");
  });

  test("rotates certificate successfully", async () => {
    const certAuth = await run(makeCertificateAuth);
    const cert1 = await run(certAuth.issueCertificate("agent-1"));
    const cert2 = await run(certAuth.rotateCertificate("agent-1"));

    expect(cert2.serialNumber).not.toBe(cert1.serialNumber);
    expect(cert2.agentId).toBe(cert1.agentId);

    const oldResult = await run(certAuth.authenticate(cert1).pipe(Effect.flip));
    expect(oldResult.reason).toBe("revoked");

    const newResult = await run(certAuth.authenticate(cert2));
    expect(newResult.authenticated).toBe(true);
  });

  test("handles delegation chain via rotation", async () => {
    const certAuth = await run(makeCertificateAuth);

    const certA = await run(certAuth.issueCertificate("agent-A"));
    const certB = await run(certAuth.issueCertificate("agent-B"));

    await run(certAuth.rotateCertificate("agent-A"));

    const resultA = await run(certAuth.authenticate(certA).pipe(Effect.flip));
    expect(resultA.reason).toBe("revoked");

    const resultB = await run(certAuth.authenticate(certB));
    expect(resultB.authenticated).toBe(true);
  });

  test("revokes specific certificate", async () => {
    const certAuth = await run(makeCertificateAuth);
    const cert1 = await run(certAuth.issueCertificate("agent-1"));
    const cert2 = await run(certAuth.issueCertificate("agent-1"));

    await run(certAuth.revokeCertificate(cert1.serialNumber));

    const result1 = await run(certAuth.authenticate(cert1).pipe(Effect.flip));
    expect(result1.reason).toBe("revoked");

    const result2 = await run(certAuth.authenticate(cert2));
    expect(result2.authenticated).toBe(true);
  });
});
