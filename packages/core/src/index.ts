/**
 * @staffroom/core — the agent runtime.
 *
 * Zero UI, zero HTTP, zero file watchers. Everything here can run in a test.
 */

export const VERSION = "0.1.1";

export type {
  BrainGraph,
  BrainGraphEdge,
  BrainGraphNode,
  BuildGraphOptions,
} from "./brain/graph.js";
export {
  brainRevisions,
  buildGraph,
  missingId,
  nodeKind,
  noteIndexedDelta,
  noteRemovedDelta,
} from "./brain/graph.js";
export type { ImportOptions, ImportSummary } from "./brain/import.js";
export {
  ATTACHMENTS,
  DEFAULT_AREA,
  fillFrontMatter,
  importBrain,
  isObsidianVault,
  rewriteLinks,
  slugOf,
  summaryLines,
  walk as walkImportSource,
} from "./brain/import.js";
export type { BrainIndexOptions } from "./brain/index.js";
// Brain
export { BrainIndex } from "./brain/index.js";
export type { Link, LinkKind, Resolver } from "./brain/links.js";
export { buildResolver, linksFrom, resolveTarget } from "./brain/links.js";
export type { ParseOptions } from "./brain/parse.js";
export { frontMatterOf, isSkipped, noteIdFor, parseNote, weightFor } from "./brain/parse.js";
export type {
  BrainNoteRecord,
  BrainSearchHit,
  NoteFrontMatter,
  NoteTrust,
  NoteWarning,
  ParsedNote,
} from "./brain/types.js";
export type { WriteDeliverableInput, WrittenNote } from "./brain/write.js";
export {
  DELIVERABLES_ROOT,
  markRejected,
  slugify,
  unpinned,
  writeDeliverable,
} from "./brain/write.js";
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
export type {
  McpManagerOptions,
  McpState,
  McpStatus,
  McpToolsChanged,
} from "./mcp/manager.js";
export { capDescription, capSchema, fingerprint, McpManager } from "./mcp/manager.js";
export type { ProviderOptions, StoredTokens } from "./mcp/oauth.js";
export {
  loadAllTokens,
  loadTokens,
  OfficeOAuthProvider,
  PendingAuthorizations,
  saveTokens,
  secretsDir,
  secretsOf,
  tokenPath,
} from "./mcp/oauth.js";
// What the office looks like
export type {
  ActiveRun,
  Agent,
  AgentStatus,
  Connector,
  DeliverableSummary,
  Department as DepartmentView,
  OfficeState,
  PendingApprovalView,
  RoutineView,
} from "./office-state.js";
// Prompt and loop
export { OUTPUT_CONTRACT, SAFETY_RULE } from "./prompt/safety-rule.js";
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
  addRedactionSecrets,
  clearRedaction,
  configuredSecretCount,
  configureRedaction,
  redactSecrets,
  redactSecretsCounted,
} from "./redact.js";
export type { DetectedEditor } from "./runtime/editors.js";
export { detectEditors, openCommandFor } from "./runtime/editors.js";
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
  NewRun,
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
export type { LoopContext, LoopRunnerConfig } from "./runtime/loop.js";
export { costOf, messagesFromEvents, runAgentLoop } from "./runtime/loop.js";
export type { CreateOfficeOptions, Office } from "./runtime/office.js";
// The office
export { buildAdapters, createOffice } from "./runtime/office.js";
// Edits to the owner's files
export {
  assignTool,
  envKeyFor,
  renameAgent,
  revealNote,
  setProviderKey,
} from "./runtime/office-edits.js";
export type { BuildPromptOptions, BuiltPrompt, PinnedNote } from "./runtime/prompt.js";
export { buildSystemPrompt } from "./runtime/prompt.js";
export { buildReviseMessages, DEFAULT_REVISE_INSTRUCTION } from "./runtime/revise.js";
export type { RouteDecision, RouteOptions } from "./runtime/routing.js";
export {
  ASSIGN_TASK,
  askLead,
  assignTaskSpec,
  buildRoutingPrompt,
  parseDecisionFromText,
  resolveDecision,
} from "./runtime/routing.js";
export type { RunnerDeps, SubmitTaskInput } from "./runtime/runner.js";
export { Runner } from "./runtime/runner.js";
export { readSampleRun, sampleRunPath, seedSampleRun } from "./runtime/seed.js";
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
export type { BrainToolsOptions } from "./tools/builtins/brain.js";
// Built-in tools
export { brainTools } from "./tools/builtins/brain.js";
export type { SearchHit, WebSearchState, WebSearchStatus } from "./tools/builtins/web-search.js";
export {
  buildRequest,
  capResults,
  SNIPPET_BUDGET,
  WEB_SEARCH_UNCONFIGURED,
  webSearchConfigError,
  webSearchStatus,
  webSearchTool,
} from "./tools/builtins/web-search.js";
export type { LoadedTool, LoadFailure, LoadResult, LoadToolsOptions } from "./tools/loader.js";
export { loadCustomTools } from "./tools/loader.js";
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
export type { AllowRow, ApprovalsFile } from "./tools/whitelist.js";
export {
  approvalsPath,
  FileWhitelist,
  inputMatches,
  valueMatches,
} from "./tools/whitelist.js";
