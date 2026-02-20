import { Effect, Ref } from "effect";
import type { Certificate, AuthResult } from "../types.js";
import { AuthenticationError, CredentialError } from "../errors.js";

export interface CertificateAuth {
  readonly authenticate: (cert: Certificate) => Effect.Effect<AuthResult, AuthenticationError>;
  readonly issueCertificate: (agentId: string, ttlMs?: number) => Effect.Effect<Certificate, CredentialError>;
  readonly rotateCertificate: (agentId: string) => Effect.Effect<Certificate, CredentialError>;
  readonly revokeCertificate: (serialNumber: string) => Effect.Effect<void, CredentialError>;
}

export const makeCertificateAuth = Effect.gen(function* () {
  const certsRef = yield* Ref.make<Map<string, Certificate>>(new Map());
  const revokedRef = yield* Ref.make<Set<string>>(new Set());

  const authenticate = (
    cert: Certificate,
  ): Effect.Effect<AuthResult, AuthenticationError> =>
    Effect.gen(function* () {
      // Verify certificate format
      if (!cert.serialNumber || !cert.publicKey || !cert.fingerprint) {
        return yield* Effect.fail(
          new AuthenticationError({
            message: `Invalid certificate for agent ${cert.agentId}`,
            reason: "invalid-certificate",
            agentId: cert.agentId,
          }),
        );
      }

      // Check expiration
      if (cert.expiresAt < new Date()) {
        return yield* Effect.fail(
          new AuthenticationError({
            message: `Certificate expired for agent ${cert.agentId}`,
            reason: "expired",
            agentId: cert.agentId,
          }),
        );
      }

      // Check revocation
      const revoked = yield* Ref.get(revokedRef);
      if (revoked.has(cert.serialNumber)) {
        return yield* Effect.fail(
          new AuthenticationError({
            message: `Certificate revoked for agent ${cert.agentId}`,
            reason: "revoked",
            agentId: cert.agentId,
          }),
        );
      }

      return {
        authenticated: true,
        agentId: cert.agentId,
        expiresAt: cert.expiresAt,
      };
    });

  const issueCertificate = (
    agentId: string,
    ttlMs: number = 7 * 24 * 60 * 60 * 1000,
  ): Effect.Effect<Certificate, CredentialError> =>
    Effect.try({
      try: () => {
        const now = new Date();
        const serialNumber = crypto.randomUUID();
        const publicKey = `pk-${crypto.randomUUID()}`;
        const fingerprint = `fp-${crypto.randomUUID().slice(0, 16)}`;

        const cert: Certificate = {
          serialNumber,
          agentId,
          issuedAt: now,
          expiresAt: new Date(now.getTime() + ttlMs),
          publicKey,
          issuer: "reactive-agents-ca",
          fingerprint,
          status: "active",
        };

        return cert;
      },
      catch: (e) =>
        new CredentialError({
          message: `Failed to issue certificate: ${e}`,
          agentId,
          operation: "issue",
        }),
    }).pipe(
      Effect.tap((cert) =>
        Ref.update(certsRef, (certs) => {
          const newCerts = new Map(certs);
          newCerts.set(cert.serialNumber, cert);
          return newCerts;
        }),
      ),
    );

  const rotateCertificate = (
    agentId: string,
  ): Effect.Effect<Certificate, CredentialError> =>
    Effect.gen(function* () {
      // Revoke all existing certificates for this agent
      const certs = yield* Ref.get(certsRef);
      for (const [serial, cert] of certs) {
        if (cert.agentId === agentId && cert.status === "active") {
          yield* Ref.update(revokedRef, (revoked) => new Set([...revoked, serial]));
        }
      }
      // Issue new certificate
      return yield* issueCertificate(agentId);
    });

  const revokeCertificate = (
    serialNumber: string,
  ): Effect.Effect<void, CredentialError> =>
    Ref.update(revokedRef, (revoked) => new Set([...revoked, serialNumber])).pipe(
      Effect.mapError(
        () => new CredentialError({ message: "Revocation failed", agentId: "unknown", operation: "revoke" }),
      ),
    );

  return { authenticate, issueCertificate, rotateCertificate, revokeCertificate } satisfies CertificateAuth;
});
