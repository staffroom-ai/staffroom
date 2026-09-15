/**
 * Shipped prices, US dollars per 1000 tokens. Config overrides these per provider;
 * an unlisted model prices as null and the office says "cost unknown" rather than
 * implying a run was free. SR-010 extends this with the resolution rules.
 */
import type { ModelPricing } from "./types.js";

export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  "claude-opus-5": { inputPer1k: 0.015, outputPer1k: 0.075, cachedInputPer1k: 0.0015 },
  "claude-sonnet-5": { inputPer1k: 0.003, outputPer1k: 0.015, cachedInputPer1k: 0.0003 },
  "claude-haiku-4-5-20251001": { inputPer1k: 0.0008, outputPer1k: 0.004 },
};
