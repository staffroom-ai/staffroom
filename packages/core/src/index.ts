/**
 * @staffroom/core — the agent runtime.
 *
 * Zero UI, zero HTTP, zero file watchers. Everything here can run in a test.
 */

export const VERSION = "0.0.1";

// Providers
export { AnthropicAdapter } from "./providers/anthropic.js";
export { mapAnthropicError } from "./providers/anthropic-errors.js";
export type { BaseAdapterOptions } from "./providers/base.js";
export { BaseAdapter, decodeToolName, encodeToolName, estimateTokens } from "./providers/base.js";
export type { OpenAIAdapterOptions } from "./providers/openai.js";
export { OpenAIAdapter } from "./providers/openai.js";
export { mapOpenAIError } from "./providers/openai-errors.js";
export { ANTHROPIC_PRICING, OPENAI_PRICING } from "./providers/pricing.js";
export type {
  CompleteOptions,
  CompletionChunk,
  Message,
  ModelInfo,
  ModelPricing,
  ProviderAdapter,
  ProviderCapabilities,
  StopReason,
  ToolCall,
  ToolSpec,
  Usage,
} from "./providers/types.js";
export { TOOL_NAME_PATTERN } from "./providers/types.js";
export type {
  ErrorDetail,
  ProviderErrorOptions,
  RunErrorCode,
  RunErrorOptions,
  UserFacingError,
} from "./runtime/errors.js";
// Errors
export {
  ProviderError,
  RUN_ERROR_CODES,
  RunError,
  userMessage,
} from "./runtime/errors.js";
// Shared types
export type {
  ApprovalBy,
  ApprovalDecision,
  ApprovalPreview,
  BrainListOptions,
  BrainNote,
  BrainNoteRef,
  BrainReader,
  BrainSearchOptions,
  ToolSource,
} from "./shared/types.js";
