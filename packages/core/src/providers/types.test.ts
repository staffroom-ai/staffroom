import { describe, expect, it } from "vitest";
import { BaseAdapter, decodeToolName, encodeToolName, estimateTokens } from "./base.js";
import { type Message, type ModelPricing, TOOL_NAME_PATTERN, type ToolSpec } from "./types.js";

describe("tool name mapping", () => {
  it("maps a dot to a double underscore", () => {
    expect(encodeToolName("notion.search_pages")).toBe("notion__search_pages");
  });

  it("round-trips", () => {
    const original = "notion.search_pages";
    expect(decodeToolName(encodeToolName(original))).toBe(original);
  });

  it("leaves a name without a dot alone", () => {
    expect(encodeToolName("brain_search")).toBe("brain_search");
    expect(decodeToolName("brain_search")).toBe("brain_search");
  });
});

describe("TOOL_NAME_PATTERN", () => {
  it("accepts a plain name and a single-dot name", () => {
    expect(TOOL_NAME_PATTERN.test("brain_search")).toBe(true);
    expect(TOOL_NAME_PATTERN.test("notion.search_pages")).toBe(true);
  });

  it("rejects a name with two dots", () => {
    expect(TOOL_NAME_PATTERN.test("a.b.c")).toBe(false);
  });

  it("rejects uppercase, a leading digit and an empty name", () => {
    expect(TOOL_NAME_PATTERN.test("Notion.search")).toBe(false);
    expect(TOOL_NAME_PATTERN.test("1tool")).toBe(false);
    expect(TOOL_NAME_PATTERN.test("")).toBe(false);
  });

  it("rejects a segment over 32 characters", () => {
    expect(TOOL_NAME_PATTERN.test("a".repeat(33))).toBe(false);
    expect(TOOL_NAME_PATTERN.test("a".repeat(32))).toBe(true);
  });
});

describe("estimateTokens", () => {
  it("returns 0 for an empty message list", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("counts characters and per-message overhead", () => {
    const messages: Message[] = [{ role: "user", content: "a".repeat(35) }];
    // 35 / 3.5 = 10, plus 4 for the message.
    expect(estimateTokens(messages)).toBe(14);
  });

  it("counts tool schemas", () => {
    const messages: Message[] = [{ role: "user", content: "hi" }];
    const tools: ToolSpec[] = [
      { name: "brain_search", description: "Search the notes.", inputSchema: { type: "object" } },
    ];
    expect(estimateTokens(messages, tools)).toBeGreaterThan(estimateTokens(messages));
  });

  it("counts an assistant message's tool calls", () => {
    const plain: Message[] = [{ role: "assistant", content: "ok" }];
    const withCall: Message[] = [
      {
        role: "assistant",
        content: "ok",
        toolCalls: [{ id: "1", name: "brain_search", input: { q: "pricing" } }],
      },
    ];
    expect(estimateTokens(withCall)).toBeGreaterThan(estimateTokens(plain));
  });
});

class TestAdapter extends BaseAdapter {
  protected readonly pricingTable: Record<string, ModelPricing> = {
    "test-model": { inputPer1k: 0.003, outputPer1k: 0.015 },
  };
}

describe("BaseAdapter.pricing", () => {
  it("returns the shipped price", () => {
    expect(new TestAdapter().pricing("test-model")).toEqual({
      inputPer1k: 0.003,
      outputPer1k: 0.015,
    });
  });

  it("lets config override the shipped price", () => {
    const adapter = new TestAdapter({
      pricingOverrides: { "test-model": { inputPer1k: 0, outputPer1k: 0 } },
    });
    expect(adapter.pricing("test-model")).toEqual({ inputPer1k: 0, outputPer1k: 0 });
  });

  it("returns null for an unknown model so cost shows as unknown", () => {
    expect(new TestAdapter().pricing("mystery")).toBeNull();
  });
});

describe("BaseAdapter.countTokens", () => {
  it("falls back to the estimate", async () => {
    const messages: Message[] = [{ role: "user", content: "a".repeat(35) }];
    await expect(new TestAdapter().countTokens(messages, [], "test-model")).resolves.toBe(14);
  });
});
