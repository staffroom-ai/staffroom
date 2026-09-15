/**
 * config.yaml: providers, MCP servers, tools, and the runtime knobs.
 *
 * Strict everywhere, for the same reason agents.yaml is: a key we silently ignore
 * is a setting the owner believes is working.
 */
import { z } from "zod";

/** A string that may be a `$NAME` reference resolved from the environment or office/.env. */
export const EnvString = z.string();

export const ProviderSchema = z
  .object({
    /** Defaults from the key: `anthropic:` means kind anthropic. */
    kind: z.enum(["anthropic", "openai", "ollama"]).optional(),
    api_key: EnvString.optional(),
    base_url: z.string().url().optional(),
    label: z.string().min(1).max(40).optional(),
    max_context_tokens: z.number().int().positive().optional(),
    /** Endpoints that reject stream_options set this false rather than eating a 400. */
    stream_usage: z.boolean().optional(),
    pricing: z
      .record(
        z.string(),
        z.object({
          input_per_1k: z.number().nonnegative(),
          output_per_1k: z.number().nonnegative(),
          cached_input_per_1k: z.number().nonnegative().optional(),
        }),
      )
      .default({}),
  })
  .strict();

export const McpStdioSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(EnvString).default([]),
    env: z.record(z.string(), EnvString).default({}),
    cwd: z.string().optional(),
  })
  .strict();

export const McpHttpSchema = z
  .object({
    url: z.string().url(),
    auth: z.enum(["none", "oauth", "bearer"]).default("none"),
    token: EnvString.optional(),
    headers: z.record(z.string(), EnvString).default({}),
  })
  .strict();

export const McpServerSchema = z.union([McpStdioSchema, McpHttpSchema]);

export const McpConfigSchema = z
  .object({
    servers: z.record(z.string(), McpServerSchema).default({}),
    /** Stays visible on the connector strip, struck through, out of every agent's hands. */
    deny: z.array(z.string()).default([]),
    /** Which pods a server is wired to. Absent means every pod. */
    departments: z.record(z.string(), z.array(z.string())).default({}),
  })
  .strict();

export const WebToolSchema = z
  .object({
    provider: z.enum(["brave", "tavily", "searxng", "none"]).default("none"),
    api_key: EnvString.optional(),
    base_url: z.string().url().optional(),
    max_results: z.number().int().min(1).max(20).default(8),
  })
  .strict();

export const ToolsConfigSchema = z
  .object({
    web: WebToolSchema.prefault({}),
    custom_dir: z.string().default("tools"),
    hot_reload: z.boolean().default(true),
  })
  .strict();

export const RunnerConfigSchema = z
  .object({
    max_turns: z.number().int().min(1).max(50).default(12),
    max_output_tokens: z.number().int().min(256).max(64_000).default(4096),
    tool_timeout_ms: z.number().int().min(1000).max(600_000).default(60_000),
    temperature: z.number().min(0).max(2).optional(),
    max_retries: z.number().int().min(0).max(10).default(3),
  })
  .strict();

export const BrainConfigSchema = z
  .object({
    dir: z.string().default("brain"),
    embeddings: z
      .object({
        enabled: z.boolean().default(false),
        /** Required when enabled: an embedding index built with an unknown model is not reusable. */
        model: z.string().optional(),
      })
      .strict()
      .prefault({})
      .refine((v) => !v.enabled || (v.model !== undefined && v.model.length > 0), {
        message: "brain.embeddings.model is required when embeddings are enabled",
      }),
    max_pinned_chars: z.number().int().min(500).max(100_000).default(8000),
  })
  .strict();

export const ApprovalsConfigSchema = z
  .object({
    expiry_hours: z.number().int().min(1).max(168).default(24),
    whitelist_days: z.number().int().min(1).max(365).default(90),
  })
  .strict();

export const TelemetryConfigSchema = z.object({ enabled: z.boolean().default(false) }).strict();

export const ServerConfigSchema = z
  .object({
    port: z.number().int().min(1).max(65_535).default(4242),
    log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    /** Binding beyond loopback is opt-in and the CLI prints a warning when it is used. */
    host: z.string().default("127.0.0.1"),
  })
  .strict();

export const ConfigSchema = z
  .object({
    version: z.literal(1),
    providers: z.record(z.string(), ProviderSchema).default({}),
    mcp: McpConfigSchema.prefault({}),
    tools: ToolsConfigSchema.prefault({}),
    runner: RunnerConfigSchema.prefault({}),
    brain: BrainConfigSchema.prefault({}),
    approvals: ApprovalsConfigSchema.prefault({}),
    telemetry: TelemetryConfigSchema.prefault({}),
    server: ServerConfigSchema.prefault({}),
  })
  .strict();

export type ProviderConfig = z.infer<typeof ProviderSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;
export type BrainConfig = z.infer<typeof BrainConfigSchema>;
export type OfficeConfig = z.infer<typeof ConfigSchema>;

/** Keys owners commonly put in the wrong file, and where they actually belong. */
export const MISPLACED_KEYS: Record<string, string> = {
  default_model: "put it in office/agents.yaml as a top-level key.",
  name: "office names live in office/agents.yaml under office.name.",
  timezone: "put it in office/agents.yaml under office.timezone.",
  agents: "the roster lives in office/agents.yaml.",
  departments: "department display names live in office/agents.yaml.",
};
