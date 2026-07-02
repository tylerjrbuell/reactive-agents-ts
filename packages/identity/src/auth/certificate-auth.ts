import { Effect, Ref } from "effect";
import type { Certificate, AuthResult } from "../types.js";
import { AuthenticationError, CredentialError } from "../errors.js";

// ─── Helpers ───

const toBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
};

const fromBase64 = (b64: string): ArrayBuffer => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
};

/** Compute the 16-byte SHA-256 fingerprint (hex) of a raw public key. */
const fingerprintOfRaw = async (rawPub: ArrayBuffer): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", rawPub);
  return Array.from(new Uint8Array(hash).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/** Build the canonical payload that is signed: agentId|serialNumber|issuedAt|expiresAt|publicKey */
const certPayload = (cert: {
  agentId: string;
  serialNumber: string;
  issuedAt: Date;
  expiresAt: Date;
  publicKey: string;
}): ArrayBuffer => {
  const encoded = new TextEncoder().encode(
    `${cert.agentId}|${cert.serialNumber}|${cert.issuedAt.toISOString()}|${cert.expiresAt.toISOString()}|${cert.publicKey}`,
  );
  return encoded.buffer as ArrayBuffer;
};

// ─── Interface ───

export interface CertificateAuth {
  readonly authenticate: (cert: Certificate) => Effect.Effect<AuthResult, AuthenticationError>;
  readonly issueCertificate: (agentId: string, ttlMs?: number) => Effect.Effect<Certificate, CredentialError>;
  readonly rotateCertificate: (agentId: string) => Effect.Effect<Certificate, CredentialError>;
  readonly revokeCertificate: (serialNumber: string) => Effect.Effect<void, CredentialError>;
}

// ─── Implementation ───

export const makeCertificateAuth = Effect.gen(function* () {
  const certsRef = yield* Ref.make<Map<string, Certificate>>(new Map());
  const revokedRef = yield* Ref.make<Set<string>>(new Set());
  // Store private keys for signing — keyed by serialNumber
  const keysRef = yield* Ref.make<Map<string, CryptoKey>>(new Map());

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

      // A signature is mandatory — an unsigned cert must never authenticate (F5).
      if (!cert.signature) {
        return yield* Effect.fail(
          new AuthenticationError({
            message: `Unsigned certificate rejected for agent ${cert.agentId}`,
            reason: "invalid-certificate",
            agentId: cert.agentId,
          }),
        );
      }

      // Trust anchor (F5): the signature is carried alongside the public key it
      // is verified against, so a self-signed cert would verify against itself.
      // Anchor trust in this authenticator's own issued-cert store — the cert
      // must match one we issued (same serial → same agentId + public key).
      const issued = (yield* Ref.get(certsRef)).get(cert.serialNumber);
      if (
        !issued ||
        issued.publicKey !== cert.publicKey ||
        issued.agentId !== cert.agentId
      ) {
        return yield* Effect.fail(
          new AuthenticationError({
            message: `Certificate for agent ${cert.agentId} was not issued by this authenticator`,
            reason: "invalid-certificate",
            agentId: cert.agentId,
          }),
        );
      }

      // Verify fingerprint binding + Ed25519 signature against the trusted key.
      const valid = yield* Effect.tryPromise({
        try: async () => {
          const rawPub = fromBase64(cert.publicKey);
          if ((await fingerprintOfRaw(rawPub)) !== cert.fingerprint) return false;
          const pubKey = await crypto.subtle.importKey(
            "raw",
            rawPub,
            "Ed25519",
            true,
            ["verify"],
          );
          const payload = certPayload(cert);
          const sig = fromBase64(cert.signature!);
          return crypto.subtle.verify("Ed25519", pubKey, sig, payload);
        },
        catch: () =>
          new AuthenticationError({
            message: `Signature verification failed for agent ${cert.agentId}`,
            reason: "invalid-certificate",
            agentId: cert.agentId,
          }),
      });

      if (!valid) {
        return yield* Effect.fail(
          new AuthenticationError({
            message: `Invalid signature for agent ${cert.agentId}`,
            reason: "invalid-certificate",
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
    Effect.tryPromise({
      try: async () => {
        const now = new Date();
        const serialNumber = crypto.randomUUID();

        // Generate real Ed25519 keypair
        const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
          "sign",
          "verify",
        ]);

        // Export public key as base64 (raw format = 32 bytes)
        const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
        const publicKey = toBase64(rawPub);

        // Compute SHA-256 fingerprint of the public key
        const fingerprint = await fingerprintOfRaw(rawPub);

        const certBase = {
          serialNumber,
          agentId,
          issuedAt: now,
          expiresAt: new Date(now.getTime() + ttlMs),
          publicKey,
          issuer: "reactive-agents-ca",
          fingerprint,
          status: "active" as const,
        };

        // Sign the certificate payload with the private key
        const payload = certPayload(certBase);
        const sig = await crypto.subtle.sign(
          "Ed25519",
          keyPair.privateKey,
          payload,
        );
        const signature = toBase64(sig);

        const cert: Certificate = { ...certBase, signature };

        return { cert, privateKey: keyPair.privateKey };
      },
      catch: (e) =>
        new CredentialError({
          message: `Failed to issue certificate: ${e}`,
          agentId,
          operation: "issue",
        }),
    }).pipe(
      Effect.tap(({ cert, privateKey }) =>
        Effect.all([
          Ref.update(certsRef, (certs) => {
            const newCerts = new Map(certs);
            newCerts.set(cert.serialNumber, cert);
            return newCerts;
          }),
          Ref.update(keysRef, (keys) => {
            const newKeys = new Map(keys);
            newKeys.set(cert.serialNumber, privateKey);
            return newKeys;
          }),
        ]),
      ),
      Effect.map(({ cert }) => cert),
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
