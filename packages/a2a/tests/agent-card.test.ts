import { describe, it, expect } from "bun:test";
import { generateAgentCard, toolsToSkills } from "../src/agent-card.js";

describe("AgentCard Generator", () => {
  it("should generate a card with minimal config", () => {
    const card = generateAgentCard({
      name: "my-agent",
      url: "http://localhost:3000",
    });

    expect(card.name).toBe("my-agent");
    expect(card.url).toBe("http://localhost:3000");
    expect(card.version).toBe("0.1.0");
    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.provider.organization).toBe("Reactive Agents");
    expect(card.capabilities.streaming).toBe(true);
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(card.skills).toEqual([]);
    expect(card.defaultInputModes).toContain("text/plain");
    expect(card.defaultOutputModes).toContain("application/json");
  });

  it("should generate a card with full config", () => {
    const card = generateAgentCard({
      name: "full-agent",
      description: "A fully configured agent",
      version: "2.0.0",
      url: "https://agent.example.com",
      organization: "Acme Corp",
      organizationUrl: "https://acme.example.com",
      capabilities: {
        streaming: false,
        pushNotifications: true,
        stateTransitionHistory: true,
      },
      skills: [
        {
          id: "search",
          name: "Web Search",
          description: "Searches the web",
          tags: ["search", "web"],
        },
      ],
    });

    expect(card.name).toBe("full-agent");
    expect(card.description).toBe("A fully configured agent");
    expect(card.version).toBe("2.0.0");
    expect(card.url).toBe("https://agent.example.com");
    expect(card.provider.organization).toBe("Acme Corp");
    expect(card.provider.url).toBe("https://acme.example.com");
    expect(card.capabilities.streaming).toBe(false);
    expect(card.capabilities.pushNotifications).toBe(true);
    expect(card.capabilities.stateTransitionHistory).toBe(true);
    expect(card.skills).toHaveLength(1);
    expect(card.skills![0].id).toBe("search");
    expect(card.skills![0].name).toBe("Web Search");
  });

  it("should apply default values when not specified", () => {
    const card = generateAgentCard({
      name: "defaults-agent",
      url: "http://localhost:4000",
    });

    expect(card.version).toBe("0.1.0");
    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.provider.organization).toBe("Reactive Agents");
    expect(card.provider.url).toBeUndefined();
    expect(card.description).toBeUndefined();
    expect(card.capabilities.streaming).toBe(true);
    expect(card.capabilities.pushNotifications).toBe(false);
  });
});

describe("toolsToSkills", () => {
  it("should map tool definitions to AgentSkill array", () => {
    const tools = [
      { name: "web-search", description: "Search the web", parameters: [{ name: "query" }] },
      { name: "calculator", description: "Perform calculations", parameters: [{ name: "expression" }] },
    ];

    const skills = toolsToSkills(tools);

    expect(skills).toHaveLength(2);
    expect(skills[0].id).toBe("web-search");
    expect(skills[0].name).toBe("web-search");
    expect(skills[0].description).toBe("Search the web");
    expect(skills[0].tags).toEqual([]);
    expect(skills[1].id).toBe("calculator");
    expect(skills[1].name).toBe("calculator");
  });

  it("should handle empty tools array", () => {
    const skills = toolsToSkills([]);
    expect(skills).toEqual([]);
  });

  it("should handle tools without parameters", () => {
    const tools = [
      { name: "ping", description: "Ping the server" },
    ];

    const skills = toolsToSkills(tools);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("ping");
  });
});
