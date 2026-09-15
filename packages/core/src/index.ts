/**
 * @staffroom/core — the agent runtime.
 *
 * Zero UI, zero HTTP, zero file watchers. Everything here can run in a test.
 */

export const VERSION = "0.0.1";

export type { BrainIndexOptions } from "./brain/index.js";
// Brain
export { BrainIndex } from "./brain/index.js";
export type { Link, LinkKind, Resolver } from "./brain/links.js";
export { buildResolver, linksFrom, resolveTarget } from "./brain/links.js";
export type { ParseOptions } from "./brain/parse.js";
export { isSkipped, noteIdFor, parseNote, weightFor } from "./brain/parse.js";
export type {
  BrainSearchHit,
  NoteFrontMatter,
  NoteTrust,
  NoteWarning,
  ParsedNote,
} from "./brain/types.js";
export type { AgentConfig, AgentsFile } from "./config/agents.js";
// Config
export {
  AgentSchema,
  AgentsFileSchema,
  DepartmentId,
  isIanaTimezone,
  MAX_AGENTS,
  MAX_DEPARTMENTS,
} from "./config/agents.js";
export type {
  BrainConfig,
  McpConfig,
  OfficeConfig,
  ProviderConfig,
  RunnerConfig,
} from "./config/config.js";
export { ConfigSchema, MISPLACED_KEYS } from "./config/config.js";
export { expandEnv, loadDotEnv, parseDotEnv, SECRET_LITERAL_HINT } from "./config/env.js";
export type { ConfigError, ConfigErrorCode, ConfigFile } from "./config/errors.js";
export {
  ConfigInvalid,
  didYouMean,
  printConfigError,
  printConfigErrors,
} from "./config/errors.js";
export type { LoadedConfig } from "./config/load.js";
export {
  loadAgentsFile,
  loadConfig,
  loadRoster,
  readAgentsText,
} from "./config/load.js";
export type { Department, Seat } from "./config/roster.js";
export { Roster, RosterWriter } from "./config/roster.js";
export type { ToolNameResolver, ValidateOptions } from "./config/validate.js";
export { validateAgents } from "./config/validate.js";
// Providers
export { AnthropicAdapter } from "./providers/anthropic.js";
export { mapAnthropicError } from "./providers/anthropic-errors.js";
export type { BaseAdapterOptions } from "./providers/base.js";
export { BaseAdapter, decodeToolName, encodeToolName, estimateTokens } from "./providers/base.js";
export type { OllamaAdapterOptions } from "./providers/ollama.js";
// Ollama
export { OllamaAdapter } from "./providers/ollama.js";
export { mapOllamaError } from "./providers/ollama-errors.js";
export type { OpenAIAdapterOptions } from "./providers/openai.js";
export { OpenAIAdapter } from "./providers/openai.js";
export { mapOpenAIError } from "./providers/openai-errors.js";
export { ANTHROPIC_PRICING, OPENAI_PRICING } from "./providers/pricing.js";
export type { ModelId, ModelSource, ModelStatus, ResolvedModel } from "./providers/resolve.js";
// Model resolution
export {
  isLocalProvider,
  modelStatusFor,
  parseModelId,
  resolveModel,
} from "./providers/resolve.js";
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
// Redaction
export {
  clearRedaction,
  configuredSecretCount,
  configureRedaction,
  redactSecrets,
  redactSecretsCounted,
} from "./redact.js";
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
export type {
  Deliverable,
  PendingApproval,
  Run,
  RunEvent,
  RunEventEnvelope,
  RunEventType,
  RunKind,
  RunListFilter,
  RunStatus,
  RunStore,
} from "./runtime/events.js";
// Runs
export { deliverableTitle } from "./runtime/events.js";
export type { SqliteRunStoreOptions } from "./runtime/store.js";
export { newApprovalId, newRunId, SqliteRunStore } from "./runtime/store.js";
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
// Tools
export { buildPreview } from "./tools/preview.js";
export type {
  ApprovalRequest,
  RegisteredTool,
  ToolErrorCode,
  ToolRegistryOptions,
  ToolResult,
  Whitelist,
} from "./tools/registry.js";
export {
  DENY_ALL,
  IMPLIED_TOOLS,
  ToolNameConflict,
  ToolRegistry,
} from "./tools/registry.js";
export type { Tool, ToolContext, ToolDefinition, ToolScope } from "./tools/tool.js";
export { MCP_TOOL_NAME, scopeWasAssumed, TOOL_NAME, ToolNameInvalid, tool } from "./tools/tool.js";
