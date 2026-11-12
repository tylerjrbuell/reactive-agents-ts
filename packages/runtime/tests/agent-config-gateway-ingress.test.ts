import { describe, test, expect } from "bun:test";
import { Schema } from "effect";
import {
  AgentConfigSchema,
  agentConfigFromJSON,
} from "../src/agent-config.js";
import { agentConfigToBuilderCalls } from "../src/builder/config-calls.js";

const base = { name: "a", provider: "test" } as const;

describe("AgentConfig gateway.ingress", () => {
  test("id list survives decode and JSON round-trip", () => {
    const cfg = Schema.decodeUnknownSync(AgentConfigSchema)({
      ...base,
      gateway: { ingress: { channels: ["a", "b"] } },
    });
    expect(cfg.gateway?.ingress?.channels).toEqual(["a", "b"]);
    const back = agentConfigFromJSON(JSON.stringify(cfg));
    expect(back.gateway?.ingress).toEqual({ channels: ["a", "b"] });
  });

  test("channels:false survives decode", () => {
    const cfg = agentConfigFromJSON(
      JSON.stringify({ ...base, gateway: { ingress: { channels: false } } }),
    );
    expect(cfg.gateway?.ingress?.channels).toBe(false);
  });

  test("reaches withGateway call", () => {
    const cfg = agentConfigFromJSON(
      JSON.stringify({ ...base, gateway: { ingress: { channels: false } } }),
    );
    const call = agentConfigToBuilderCalls(cfg).find((c) => c.method === "withGateway");
    expect(call?.args[0]).toMatchObject({ ingress: { channels: false } });
  });
});
