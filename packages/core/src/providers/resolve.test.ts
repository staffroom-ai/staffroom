import { describe, expect, it } from "vitest";
import { type AgentConfig, AgentsFileSchema } from "../config/agents.js";
import { ConfigSchema } from "../config/config.js";
import { RunError } from "../runtime/errors.js";
import { isLocalProvider, modelStatusFor, parseModelId, resolveModel } from "./resolve.js";

const agent = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  id: "copywriter",
  department: "marketing",
  role: "Copywriter",
  does: "Turns briefs into copy.",
  tools: [],
  lead: false,
  ...over,
});

const agentsFile = (defaultModel?: string) =>
  AgentsFileSchema.parse({
    version: 1,
    office: { name: "Northlight", timezone: "Australia/Melbourne" },
    ...(defaultModel === undefined ? {} : { default_model: defaultModel }),
    agents: [agent()],
  });

const config = (providers: Record<string, unknown>) =>
  ConfigSchema.parse({ version: 1, providers });

const ANTHROPIC = { anthropic: { api_key: "sk-ant-x" } };
const OLLAMA = { ollama: { base_url: "http://127.0.0.1:11434" } };

describe("parseModelId", () => {
  it("splits on the first slash so an openrouter path survives", () => {
    expect(parseModelId("openrouter/anthropic/claude-sonnet-5")).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5",
    });
  });

  it("handles the ordinary case", () => {
    expect(parseModelId("anthropic/claude-sonnet-5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
  });

  it("rejects a string with no slash, a leading slash or a trailing slash", () => {
    for (const bad of ["claude-sonnet-5", "/model", "anthropic/"]) {
      expect(parseModelId(bad), bad).toBeUndefined();
    }
  });
});

describe("isLocalProvider", () => {
  it("treats ollama as local by kind or by key", () => {
    expect(isLocalProvider({ kind: "ollama", pricing: {} }, "anything")).toBe(true);
    expect(isLocalProvider({ pricing: {} }, "ollama")).toBe(true);
  });

  it("treats a loopback base_url as local", () => {
    for (const url of [
      "http://localhost:1234/v1",
      "http://127.0.0.1:11434",
      "http://[::1]:8080/v1",
    ]) {
      expect(isLocalProvider({ base_url: url, pricing: {} }, "lmstudio"), url).toBe(true);
    }
  });

  it("treats a remote base_url as not local", () => {
    expect(
      isLocalProvider({ base_url: "https://api.groq.com/openai/v1", pricing: {} }, "groq"),
    ).toBe(false);
  });

  it("is false for an unknown provider or an unparseable url", () => {
    expect(isLocalProvider(undefined)).toBe(false);
    expect(isLocalProvider({ base_url: "not a url", pricing: {} }, "x")).toBe(false);
  });
});

describe("the four steps", () => {
  it("takes the agent's own model", () => {
    const resolved = resolveModel({
      agent: agent({ model: "anthropic/claude-opus-5" }),
      agentsFile: agentsFile("anthropic/claude-sonnet-5"),
      config: config(ANTHROPIC),
    });
    expect(resolved).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5",
      source: "agent",
      local: false,
    });
  });

  it("falls back to the office default", () => {
    const resolved = resolveModel({
      agent: agent(),
      agentsFile: agentsFile("anthropic/claude-sonnet-5"),
      config: config(ANTHROPIC),
    });
    expect(resolved).toMatchObject({ model: "claude-sonnet-5", source: "office_default" });
  });

  it("falls back to the first configured provider", () => {
    const resolved = resolveModel({
      agent: agent(),
      agentsFile: agentsFile(),
      config: config(ANTHROPIC),
    });
    expect(resolved).toMatchObject({ provider: "anthropic", source: "first_provider" });
  });

  it("takes an override over everything", () => {
    const resolved = resolveModel({
      agent: agent({ model: "anthropic/claude-sonnet-5" }),
      agentsFile: agentsFile(),
      config: config(ANTHROPIC),
      override: "anthropic/claude-opus-5",
    });
    expect(resolved).toMatchObject({ model: "claude-opus-5", source: "override" });
  });

  it("resolves an openrouter id to the provider and the full model path", () => {
    const resolved = resolveModel({
      agent: agent({ model: "openrouter/anthropic/claude-sonnet-5" }),
      agentsFile: agentsFile(),
      config: config({ openrouter: { api_key: "sk-or-x" } }),
    });
    expect(resolved).toMatchObject({ provider: "openrouter", model: "anthropic/claude-sonnet-5" });
  });

  it("skips an office default whose provider is not configured", () => {
    const resolved = resolveModel({
      agent: agent(),
      agentsFile: agentsFile("mistral/large"),
      config: config(ANTHROPIC),
    });
    expect(resolved.source).toBe("first_provider");
  });

  it("skips a provider configured without a key", () => {
    const resolved = resolveModel({
      agent: agent(),
      agentsFile: agentsFile(),
      config: config({ openai: { pricing: {} }, anthropic: { api_key: "sk-ant-x" } }),
    });
    expect(resolved.provider).toBe("anthropic");
  });

  it("needs no key for a local provider", () => {
    const resolved = resolveModel({
      agent: agent(),
      agentsFile: agentsFile(),
      config: config(OLLAMA),
    });
    expect(resolved).toMatchObject({ provider: "ollama", source: "first_provider", local: true });
  });
});

describe("refusals", () => {
  it("throws NO_MODEL_CONFIGURED when nothing resolves", () => {
    try {
      resolveModel({ agent: agent(), agentsFile: agentsFile(), config: config({}) });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as RunError).code).toBe("NO_MODEL_CONFIGURED");
      expect((error as RunError).toJSON().hint).toContain("npx staffroom setup");
    }
  });

  it("throws PROVIDER_NOT_CONFIGURED when the agent names a provider with no key", () => {
    try {
      resolveModel({
        agent: agent({ name: "Priya", model: "openai/gpt-5" }),
        agentsFile: agentsFile(),
        config: config(ANTHROPIC),
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as RunError).code).toBe("PROVIDER_NOT_CONFIGURED");
      expect((error as RunError).message).toBe("Priya uses openai, but it has no API key.");
    }
  });

  it("refuses to move a local agent onto a remote model", () => {
    try {
      resolveModel({
        agent: agent({ name: "Sam", model: "ollama/llama4" }),
        agentsFile: agentsFile(),
        config: config({ ...OLLAMA, ...ANTHROPIC }),
        override: "anthropic/claude-opus-5",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as RunError).code).toBe("MODEL_OVERRIDE_LEAVES_MACHINE");
      expect((error as RunError).message).toBe("Sam runs locally on purpose.");
    }
  });

  it("allows a local agent to be overridden onto another local model", () => {
    const resolved = resolveModel({
      agent: agent({ model: "ollama/llama4" }),
      agentsFile: agentsFile(),
      config: config(OLLAMA),
      override: "ollama/mistral",
    });
    expect(resolved).toMatchObject({ model: "mistral", local: true });
  });

  it("rejects an override that is not a model id", () => {
    expect(() =>
      resolveModel({
        agent: agent(),
        agentsFile: agentsFile(),
        config: config(ANTHROPIC),
        override: "gpt-5",
      }),
    ).toThrow(RunError);
  });
});

describe("modelStatusFor", () => {
  it("is ok when the model resolves", () => {
    expect(
      modelStatusFor({ agent: agent(), agentsFile: agentsFile(), config: config(ANTHROPIC) }),
    ).toBe("ok");
  });

  it("is no_key when nothing resolves", () => {
    expect(modelStatusFor({ agent: agent(), agentsFile: agentsFile(), config: config({}) })).toBe(
      "no_key",
    );
  });

  it("is unreachable when the provider does not answer", () => {
    expect(
      modelStatusFor({
        agent: agent(),
        agentsFile: agentsFile(),
        config: config(OLLAMA),
        reachable: () => false,
      }),
    ).toBe("unreachable");
  });
});
