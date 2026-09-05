import { describe, it, expect, afterEach } from "bun:test";
import { agentEgressGuard } from "../src/client/discovery.js";

describe("agentEgressGuard — config > env > default (F15)", () => {
  afterEach(() => {
    delete process.env.RA_AGENT_STRICT_EGRESS;
  });

  it("allows private peers by default", () => {
    delete process.env.RA_AGENT_STRICT_EGRESS;
    expect(agentEgressGuard().allowPrivate).toBe(true);
  });

  it("RA_AGENT_STRICT_EGRESS=1 refuses private peers", () => {
    process.env.RA_AGENT_STRICT_EGRESS = "1";
    expect(agentEgressGuard().allowPrivate).toBe(false);
  });

  it("config.strictEgress wins over env, either direction", () => {
    process.env.RA_AGENT_STRICT_EGRESS = "1";
    expect(agentEgressGuard({ strictEgress: false }).allowPrivate).toBe(true);

    delete process.env.RA_AGENT_STRICT_EGRESS;
    expect(agentEgressGuard({ strictEgress: true }).allowPrivate).toBe(false);
  });
});
