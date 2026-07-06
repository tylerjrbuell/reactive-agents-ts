import { describe, test, expect } from "bun:test";
import { computeTrustReceipt } from "@reactive-agents/core";
import {
  generateReceiptKeyPair,
  signReceipt,
  verifyReceipt,
  resolveReceiptSigningKey,
} from "../src/receipt-signing.js";
import { ReactiveAgents } from "../src/index.js";

describe("receipt signing", () => {
  test("sign → verify roundtrip; tamper breaks", async () => {
    const { privateKeyJwk } = await generateReceiptKeyPair();
    const receipt = computeTrustReceipt({
      toolCalls: [{ name: "calc", ok: true }],
      abstained: false,
      success: true,
      modelId: "m",
      now: 1,
      goalAchieved: true,
    });
    const signed = await signReceipt(receipt, privateKeyJwk);
    expect(signed.signature?.alg).toBe("ed25519");
    expect(await verifyReceipt(signed)).toBe(true);
    const tampered = { ...signed, verdict: "tool-grounded" as const, toolsUsed: ["fake"] };
    expect(await verifyReceipt(tampered)).toBe(false);
  });

  test("unsigned receipt fails verification (nothing to verify)", async () => {
    const receipt = computeTrustReceipt({
      toolCalls: [],
      abstained: false,
      success: true,
      modelId: "m",
      now: 1,
      goalAchieved: true,
    });
    expect(await verifyReceipt(receipt)).toBe(false);
  });

  test("malformed signature returns false, never throws", async () => {
    const receipt = computeTrustReceipt({
      toolCalls: [],
      abstained: false,
      success: true,
      modelId: "m",
      now: 1,
      goalAchieved: true,
    });
    const malformed = {
      ...receipt,
      signature: { alg: "ed25519" as const, publicKey: "not-json", sig: "not-base64!!" },
    };
    await expect(verifyReceipt(malformed)).resolves.toBe(false);
  });

  test("two independently generated key pairs produce non-interchangeable signatures", async () => {
    const keyPairA = await generateReceiptKeyPair();
    const keyPairB = await generateReceiptKeyPair();
    const receipt = computeTrustReceipt({
      toolCalls: [{ name: "calc", ok: true }],
      abstained: false,
      success: true,
      modelId: "m",
      now: 1,
      goalAchieved: true,
    });
    const signedWithA = await signReceipt(receipt, keyPairA.privateKeyJwk);
    const signedWithB = await signReceipt(receipt, keyPairB.privateKeyJwk);
    // Mix A's public key with B's signature bytes — must fail: B's signature
    // was produced by B's private key, so it does not validate against A's
    // public key even though the signed content is identical.
    const frankensteined = {
      ...signedWithA,
      signature: { ...signedWithA.signature!, sig: signedWithB.signature!.sig },
    };
    expect(await verifyReceipt(frankensteined)).toBe(false);
  });

  test("resolveReceiptSigningKey: builder-configured key wins over env", () => {
    const configured = { kty: "OKP", crv: "Ed25519", x: "abc", d: "def" };
    const resolved = resolveReceiptSigningKey(configured);
    expect(resolved).toEqual(configured);
  });

  test("resolveReceiptSigningKey: absent config and env → undefined", () => {
    const prior = process.env["RA_RECEIPT_KEY"];
    delete process.env["RA_RECEIPT_KEY"];
    try {
      expect(resolveReceiptSigningKey(undefined)).toBeUndefined();
    } finally {
      if (prior !== undefined) process.env["RA_RECEIPT_KEY"] = prior;
    }
  });

  test("resolveReceiptSigningKey: falls back to RA_RECEIPT_KEY env var (JWK JSON)", async () => {
    const { privateKeyJwk } = await generateReceiptKeyPair();
    const prior = process.env["RA_RECEIPT_KEY"];
    process.env["RA_RECEIPT_KEY"] = JSON.stringify(privateKeyJwk);
    try {
      const resolved = resolveReceiptSigningKey(undefined);
      expect(resolved).toEqual(privateKeyJwk);
    } finally {
      if (prior !== undefined) process.env["RA_RECEIPT_KEY"] = prior;
      else delete process.env["RA_RECEIPT_KEY"];
    }
  });

  // ── End-to-end wiring: .withReceiptSigning() → agent.run().receipt.signature ──
  test("agent.run() signs the receipt when .withReceiptSigning() is configured", async () => {
    const { privateKeyJwk } = await generateReceiptKeyPair();
    const agent = await ReactiveAgents.create()
      .withName("receipt-signing-agent")
      .withModel("test-model")
      .withTestScenario([{ match: "What is 2+2", text: "The answer is 4." }])
      .withReceiptSigning({ privateKeyJwk })
      .build();

    const result = await agent.run("What is 2+2?");

    expect(result.receipt?.verdict).toBeDefined();
    expect(result.receipt?.signature?.alg).toBe("ed25519");
    expect(await verifyReceipt(result.receipt!)).toBe(true);
  });

  test("agent.run() leaves the receipt unsigned when no key is configured", async () => {
    const agent = await ReactiveAgents.create()
      .withName("receipt-unsigned-agent")
      .withModel("test-model")
      .withTestScenario([{ match: "What is 2+2", text: "The answer is 4." }])
      .build();

    const result = await agent.run("What is 2+2?");

    expect(result.receipt?.verdict).toBeDefined();
    expect(result.receipt?.signature).toBeUndefined();
  });
});
