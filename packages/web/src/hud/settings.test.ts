/**
 * What Settings promises about keys.
 *
 * The rendering is a form; what matters and can regress is that the provider list
 * matches what the server will actually accept, and that the key field is never
 * a readable one.
 */
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "./Settings.js";

describe("the provider rows", () => {
  it("offers exactly the providers the server's set_key accepts", () => {
    // The handler's own hint is "Try anthropic, openai or ollama." Offering a row
    // the server will reject is a dead end the owner cannot diagnose.
    expect(PROVIDERS.map((p) => p.id)).toEqual(["anthropic", "openai", "ollama"]);
  });

  it("asks Ollama for a URL and everyone else for a key", () => {
    const bySecret = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.secret]));
    expect(bySecret["ollama"]).toBe("url");
    expect(bySecret["anthropic"]).toBe("key");
    expect(bySecret["openai"]).toBe("key");
  });

  it("gives every row a placeholder and a note, so no row is bare", () => {
    for (const provider of PROVIDERS) {
      expect(provider.placeholder.length).toBeGreaterThan(0);
      expect(provider.note.length).toBeGreaterThan(0);
      expect(provider.name.length).toBeGreaterThan(0);
    }
  });

  it("says where the OpenAI row also works, because that is not obvious", () => {
    const openai = PROVIDERS.find((p) => p.id === "openai");
    expect(openai?.note).toContain("Groq");
    expect(openai?.note).toContain("OpenRouter");
  });
});
