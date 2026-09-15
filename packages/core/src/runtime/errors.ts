/**
 * Every way a run can fail, and what we say to the person watching.
 *
 * Two rules hold this file together:
 *
 * 1. The message says what happened. The hint says what to do about it. A user
 *    who reads only the hint should be able to fix the problem.
 * 2. Every command a hint names is written `npx staffroom <sub>`. Our users have
 *    not installed the CLI globally, so a bare `staffroom doctor` sends them to
 *    "command not found". `scripts/lint/npx-grep.mjs` enforces this.
 *
 * The server sends `{ code, message, hint }` from `toJSON()` straight down the
 * WebSocket, so changing wording here changes what the office shows.
 */

export type RunErrorCode =
  | "NO_MODEL_CONFIGURED"
  | "PROVIDER_NOT_CONFIGURED"
  | "MODEL_OVERRIDE_LEAVES_MACHINE"
  | "MODEL_NOT_FOUND"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "CONTEXT_TOO_LONG"
  | "OUTPUT_TRUNCATED"
  | "TOOLS_UNSUPPORTED"
  | "TOOL_NOT_ALLOWED"
  | "TOOL_FAILED"
  | "TOOL_TIMEOUT"
  | "APPROVAL_REJECTED"
  | "MAX_TURNS"
  | "BAD_ROUTING"
  | "NOTHING_TO_REVISE"
  | "CANCELLED"
  | "INTERNAL";

/** Values a hint or message may interpolate. */
export type ErrorDetail = Record<string, string | number>;

export interface UserFacingError {
  code: RunErrorCode;
  message: string;
  hint: string;
  detail: ErrorDetail;
}

interface Entry {
  message: string;
  hint: string;
  /** Used when `detail.providerKind === "ollama"`: a local model fails differently. */
  ollama?: { message: string; hint: string };
}

const TABLE: Record<RunErrorCode, Entry> = {
  NO_MODEL_CONFIGURED: {
    message: "No model configured.",
    hint: "Open Settings > Models in the office and paste a key, or run npx staffroom setup in Terminal.",
  },
  PROVIDER_NOT_CONFIGURED: {
    message: "{agent} uses {provider}, but it has no API key.",
    hint: "Open Settings > Models and add a {provider} key, or change the agent's model in office/agents.yaml.",
  },
  MODEL_OVERRIDE_LEAVES_MACHINE: {
    message: "{agent} runs locally on purpose.",
    hint: "Edit office/agents.yaml if you want to change that.",
  },
  MODEL_NOT_FOUND: {
    message: '{provider} does not know the model "{model}".',
    hint: "Check the spelling in office/agents.yaml.",
    ollama: {
      message: "Ollama does not have {model} yet.",
      hint: "Open Terminal and run: ollama pull {model} (about 5 GB).",
    },
  },
  AUTH_FAILED: {
    message: "{provider} rejected the API key.",
    hint: "Paste a new key in Settings > Models, or create one on the provider's site.",
  },
  RATE_LIMITED: {
    message: "{provider} is rate-limiting requests.",
    hint: "The office retried three times. Wait a minute and try again, or move this agent to another model.",
  },
  PROVIDER_UNAVAILABLE: {
    message: "Could not reach {provider}.",
    hint: "Check your connection.",
    ollama: {
      message: "Ollama is not running.",
      hint: "Install it from ollama.com, open the Ollama app, then try again.",
    },
  },
  CONTEXT_TOO_LONG: {
    message: "The task and notes are too long for {model}.",
    hint: "Shorten the task, or move this agent to a model with a bigger context window.",
  },
  OUTPUT_TRUNCATED: {
    message: "{agent} ran out of room before finishing.",
    hint: "Ask for a shorter deliverable, or raise runner.max_output_tokens.",
  },
  TOOLS_UNSUPPORTED: {
    message: "{model} cannot use tools, but {agent} has tools listed.",
    hint: "Pick a model that supports tools, or remove the tools from this agent in office/agents.yaml.",
  },
  // Never fails a run on its own. This is the text handed back to the model as a
  // tool result, so the model can choose something else and carry on.
  TOOL_NOT_ALLOWED: {
    message: "{agent} is not allowed to use {tool}.",
    hint: "Add it to that agent's tools in office/agents.yaml, or check the deny list in office/config.yaml.",
  },
  TOOL_FAILED: {
    message: "{agent} kept hitting errors with {tool}.",
    hint: "Check the connector in office/config.yaml. The error was: {error}.",
  },
  TOOL_TIMEOUT: {
    message: "{tool} did not respond in {seconds} s.",
    hint: "Try again, or raise runner.tool_timeout_ms.",
  },
  APPROVAL_REJECTED: {
    message: "You declined {tool}, so {agent} stopped.",
    hint: "Open their chat and send revise: with what to do instead.",
  },
  MAX_TURNS: {
    message: "{agent} did not finish within {turns} steps.",
    hint: "The partial work is saved in the run. Break the task into smaller pieces.",
  },
  BAD_ROUTING: {
    message: "{lead} could not pick a team member, so the task went to {agent}.",
    hint: "If that is wrong, open the right agent's chat and give the task there.",
  },
  NOTHING_TO_REVISE: {
    message: "{agent} has no deliverable to revise yet.",
    hint: "Give them a task first.",
  },
  CANCELLED: {
    message: "Stopped.",
    hint: "Nothing was saved to the brain.",
  },
  INTERNAL: {
    message: "Something went wrong inside Staffroom.",
    hint: "Please report this with the run id {runId}.",
  },
};

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Fills `{placeholder}` from `detail`. A placeholder with no matching key renders
 * as `?` rather than leaving `{agent}` on screen: a stray `?` reads as missing
 * information, a stray `{agent}` reads as a broken program.
 */
function interpolate(template: string, detail: ErrorDetail): string {
  return template.replace(PLACEHOLDER, (_, key: string) =>
    Object.hasOwn(detail, key) ? String(detail[key]) : "?",
  );
}

/** The message and hint shown to the person watching the office. */
export function userMessage(
  code: RunErrorCode,
  detail: ErrorDetail = {},
): { message: string; hint: string } {
  const entry = TABLE[code];
  const chosen = detail["providerKind"] === "ollama" && entry.ollama ? entry.ollama : entry;
  return {
    message: interpolate(chosen.message, detail),
    hint: interpolate(chosen.hint, detail),
  };
}

/** Every code, for tests and for the generated error reference in the docs. */
export const RUN_ERROR_CODES = Object.keys(TABLE) as RunErrorCode[];

export interface RunErrorOptions {
  cause?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
}

export class RunError extends Error {
  readonly code: RunErrorCode;
  readonly detail: ErrorDetail;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(code: RunErrorCode, detail: ErrorDetail = {}, options: RunErrorOptions = {}) {
    super(userMessage(code, detail).message, options.cause ? { cause: options.cause } : undefined);
    this.name = "RunError";
    this.code = code;
    this.detail = detail;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }

  /** Exactly what the server puts on the wire. */
  toJSON(): UserFacingError {
    const { message, hint } = userMessage(this.code, this.detail);
    return { code: this.code, message, hint, detail: this.detail };
  }
}

export interface ProviderErrorOptions extends RunErrorOptions {
  providerKind?: string;
  /** HTTP status, when the provider gave one. */
  status?: number;
}

/**
 * Thrown by adapters. Adapters map the provider's own error to a `RunErrorCode`
 * before throwing, and never retry: retry policy belongs to the loop.
 */
export class ProviderError extends RunError {
  readonly providerKind: string | undefined;
  readonly status: number | undefined;

  constructor(code: RunErrorCode, detail: ErrorDetail = {}, options: ProviderErrorOptions = {}) {
    super(
      code,
      { ...detail, ...(options.providerKind ? { providerKind: options.providerKind } : {}) },
      options,
    );
    this.name = "ProviderError";
    this.providerKind = options.providerKind;
    this.status = options.status;
  }
}
