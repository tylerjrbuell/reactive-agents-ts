import { describe, it, expect } from "bun:test";
import { schemaSatisfactionCheck } from "./schema-satisfaction.js";

describe("schemaSatisfactionCheck", () => {
  it("passes when no missing required + no low-confidence fields", () => {
    const c = schemaSatisfactionCheck({ missingRequired: [], lowConfidenceFields: [] });
    expect(c.severity).toBe("pass");
    expect(c.passed).toBe(true);
  });

  it("rejects when required fields are missing", () => {
    const c = schemaSatisfactionCheck({ missingRequired: ["total"], lowConfidenceFields: [] });
    expect(c.severity).toBe("reject");
    expect(c.passed).toBe(false);
  });

  it("escalates when fields are low-confidence (and nothing missing)", () => {
    const c = schemaSatisfactionCheck({ missingRequired: [], lowConfidenceFields: ["total"] });
    expect(c.severity).toBe("escalate");
    expect(c.passed).toBe(false);
  });

  it("reject takes precedence over escalate", () => {
    const c = schemaSatisfactionCheck({ missingRequired: ["a"], lowConfidenceFields: ["b"] });
    expect(c.severity).toBe("reject");
    expect(c.passed).toBe(false);
  });

  it("has the expected check name", () => {
    const c = schemaSatisfactionCheck({ missingRequired: [], lowConfidenceFields: [] });
    expect(c.name).toBe("schema-satisfaction");
  });

  it("includes missing field names in reason on reject", () => {
    const c = schemaSatisfactionCheck({ missingRequired: ["price", "sku"], lowConfidenceFields: [] });
    expect(c.reason).toContain("price");
    expect(c.reason).toContain("sku");
  });

  it("includes low-confidence field names in reason on escalate", () => {
    const c = schemaSatisfactionCheck({ missingRequired: [], lowConfidenceFields: ["amount"] });
    expect(c.reason).toContain("amount");
  });
});
