import { describe, expect, it } from "vitest";
import {
  ProviderError,
  RUN_ERROR_CODES,
  RunError,
  type RunErrorCode,
  userMessage,
} from "./errors.js";

describe("userMessage", () => {
  it("has an entry for all 19 codes", () => {
    expect(RUN_ERROR_CODES).toHaveLength(19);
  });

  it("returns the NO_MODEL_CONFIGURED hint verbatim", () => {
    // The CLI test in SR-047 greps for this exact string.
    expect(userMessage("NO_MODEL_CONFIGURED", {}).hint).toBe(
      "Open Settings > Models in the office and paste a key, or run npx staffroom setup in Terminal.",
    );
  });

  it("interpolates detail into message and hint", () => {
    const { message, hint } = userMessage("PROVIDER_NOT_CONFIGURED", {
      agent: "Priya",
      provider: "OpenAI",
    });
    expect(message).toBe("Priya uses OpenAI, but it has no API key.");
    expect(hint).toContain("add a OpenAI key");
  });

  it("renders a missing detail key as ? rather than leaving the placeholder", () => {
    const { message } = userMessage("PROVIDER_NOT_CONFIGURED", { agent: "Priya" });
    expect(message).toBe("Priya uses ?, but it has no API key.");
    expect(message).not.toContain("{");
  });

  it("uses the Ollama variant for MODEL_NOT_FOUND", () => {
    const remote = userMessage("MODEL_NOT_FOUND", { provider: "OpenAI", model: "gpt-9" });
    expect(remote.message).toBe('OpenAI does not know the model "gpt-9".');

    const local = userMessage("MODEL_NOT_FOUND", { providerKind: "ollama", model: "llama4" });
    expect(local.message).toBe("Ollama does not have llama4 yet.");
    expect(local.hint).toBe("Open Terminal and run: ollama pull llama4 (about 5 GB).");
  });

  it("uses the Ollama variant for PROVIDER_UNAVAILABLE", () => {
    const local = userMessage("PROVIDER_UNAVAILABLE", { providerKind: "ollama" });
    expect(local.message).toBe("Ollama is not running.");
    expect(local.hint).toContain("ollama.com");
  });

  it("falls back to the general text when the provider is not Ollama", () => {
    const remote = userMessage("PROVIDER_UNAVAILABLE", {
      providerKind: "openai",
      provider: "Groq",
    });
    expect(remote.message).toBe("Could not reach Groq.");
  });

  it("leaves no unfilled placeholder for any code when every key is supplied", () => {
    const detail = {
      agent: "Priya",
      provider: "OpenAI",
      model: "gpt-5",
      tool: "gmail.send",
      error: "timeout",
      seconds: 30,
      turns: 12,
      lead: "Sam",
      runId: "run_1",
    };
    for (const code of RUN_ERROR_CODES) {
      const { message, hint } = userMessage(code, detail);
      expect(message, `${code} message`).not.toMatch(/[{}]/);
      expect(hint, `${code} hint`).not.toMatch(/[{}]/);
      expect(message.length, `${code} message is empty`).toBeGreaterThan(0);
      expect(hint.length, `${code} hint is empty`).toBeGreaterThan(0);
    }
  });

  it("never tells the user to run a bare staffroom command", () => {
    for (const code of RUN_ERROR_CODES) {
      const { hint } = userMessage(code, {});
      expect(hint, code).not.toContain("Run staffroom ");
      if (hint.includes("staffroom")) expect(hint, code).toContain("npx staffroom");
    }
  });

  it("matches the snapshot for every code", () => {
    const all = Object.fromEntries(
      RUN_ERROR_CODES.map((code) => [code, userMessage(code, {})]),
    ) as Record<RunErrorCode, { message: string; hint: string }>;
    expect(all).toMatchSnapshot();
  });
});

describe("RunError", () => {
  it("uses the rendered message as the Error message", () => {
    const e = new RunError("CANCELLED");
    expect(e.message).toBe("Stopped.");
    expect(e.name).toBe("RunError");
  });

  it("is not retryable by default", () => {
    expect(new RunError("INTERNAL").retryable).toBe(false);
    expect(
      new RunError("RATE_LIMITED", {}, { retryable: true, retryAfterMs: 5000 }).retryAfterMs,
    ).toBe(5000);
  });

  it("serialises to what the server puts on the wire", () => {
    const e = new RunError("MAX_TURNS", { agent: "Priya", turns: 12 });
    expect(e.toJSON()).toEqual({
      code: "MAX_TURNS",
      message: "Priya did not finish within 12 steps.",
      hint: "The partial work is saved in the run. Break the task into smaller pieces.",
      detail: { agent: "Priya", turns: 12 },
    });
  });

  it("keeps the cause", () => {
    const cause = new Error("socket hang up");
    expect(new RunError("PROVIDER_UNAVAILABLE", {}, { cause }).cause).toBe(cause);
  });
});

describe("ProviderError", () => {
  it("folds providerKind into detail so the Ollama variants are selected", () => {
    const e = new ProviderError("PROVIDER_UNAVAILABLE", {}, { providerKind: "ollama" });
    expect(e.message).toBe("Ollama is not running.");
    expect(e.providerKind).toBe("ollama");
    expect(e.toJSON().detail["providerKind"]).toBe("ollama");
  });

  it("works without a providerKind and keeps detail untouched", () => {
    const e = new ProviderError("RATE_LIMITED", { provider: "Groq" });
    expect(e.providerKind).toBeUndefined();
    expect(e.toJSON().detail).toEqual({ provider: "Groq" });
    expect(e.message).toBe("Groq is rate-limiting requests.");
  });

  it("carries the HTTP status when the provider gave one", () => {
    const e = new ProviderError(
      "AUTH_FAILED",
      { provider: "OpenAI" },
      { providerKind: "openai", status: 401 },
    );
    expect(e.status).toBe(401);
    expect(e).toBeInstanceOf(RunError);
  });
});
