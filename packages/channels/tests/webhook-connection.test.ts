import { describe, expect, test } from "bun:test";
import { Effect, Exit, Redacted } from "effect";
import {
  WebhookChannelAdapter,
  signRequest,
  webhookConnectionInfo,
  WEBHOOK_SIGNATURE_HEADER,
} from "../src/index.js";

const body = JSON.stringify({ id: "m1", content: "hi" });

const make = (secret = "s3cret"): { w: WebhookChannelAdapter; got: string[] } => {
  const w = new WebhookChannelAdapter({ secret: Redacted.make(secret) });
  const got: string[] = [];
  Effect.runSync(w.onMessage((m) => Effect.sync(() => void got.push(m.content))));
  return { w, got };
};

describe("webhook signRequest / connectionInfo", () => {
  test("signRequest output is accepted by handleWebhook", async () => {
    const { w, got } = make();
    await Effect.runPromise(w.handleWebhook({ body, headers: signRequest("s3cret", body).headers }));
    expect(got).toEqual(["hi"]);
  });

  test("tampered body and wrong secret are refused", async () => {
    const { w, got } = make();
    const ok = signRequest("s3cret", body).headers;
    const bad1 = await Effect.runPromiseExit(w.handleWebhook({ body: body.replace("hi", "yo"), headers: ok }));
    const bad2 = await Effect.runPromiseExit(w.handleWebhook({ body, headers: signRequest("other", body).headers }));
    expect(Exit.isFailure(bad1)).toBe(true);
    expect(Exit.isFailure(bad2)).toBe(true);
    expect(got).toEqual([]);
  });

  test("connectionInfo carries real header, algorithm, path and url", () => {
    const { w } = make();
    const info = w.connectionInfo({ baseUrl: "https://a.example.com/" });
    expect(info.path).toBe("/channels/webhook");
    expect(info.url).toBe("https://a.example.com/channels/webhook");
    expect(info.signature.header).toBe(WEBHOOK_SIGNATURE_HEADER);
    for (const ex of Object.values(info.examples)) expect(ex).toContain("sha256");
    expect(info.examples.curl).toContain(WEBHOOK_SIGNATURE_HEADER);
    expect(info.examples.node).toContain("createHmac");
    expect(info.examples.openssl).toContain("openssl dgst -sha256");
    expect(webhookConnectionInfo().url).toBeUndefined();
  });

  test("no messaging wording in connection info", () => {
    const text = JSON.stringify(webhookConnectionInfo({ baseUrl: "https://a.example.com" })).toLowerCase();
    for (const w of ["sender", "owner", "chat", "telegram", "signal"]) expect(text).not.toContain(w);
  });
});
