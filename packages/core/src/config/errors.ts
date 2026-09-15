/**
 * Configuration problems, and how they are shown.
 *
 * These are read by people who are not developers, so every error names the file
 * and the path inside it, says what is wrong in one line, and where possible says
 * what to do instead. The printed form is what `npx staffroom doctor` shows and
 * what the office puts in the config error panel.
 */

export type ConfigErrorCode =
  | "AGENT_ID_DUPLICATE"
  | "AGENT_ID_INVALID"
  | "AGENT_DEPARTMENT_LIMIT"
  | "AGENT_SEAT_LIMIT"
  | "AGENT_MODEL_PROVIDER_MISSING"
  | "AGENT_TOOL_UNKNOWN"
  | "AGENT_TOOL_DENIED"
  | "AGENT_TOOL_WRONG_DEPARTMENT"
  | "AGENT_LEAD_DUPLICATE"
  | "AGENT_FIELD_MISSING"
  | "OFFICE_TIMEZONE_INVALID"
  | "CONFIG_VERSION_UNKNOWN"
  | "ENV_VAR_UNRESOLVED"
  | "SECRET_LITERAL_IN_CONFIG"
  | "UNKNOWN_KEY"
  | "PROVIDER_KIND_UNKNOWN"
  | "MCP_SERVER_INVALID"
  | "YAML_PARSE";

export type ConfigFile = "agents.yaml" | "config.yaml" | "routines.yaml" | "approvals.yaml";

export interface ConfigError {
  code: ConfigErrorCode;
  file: ConfigFile;
  /** Path inside the file, for example `agents[3].tools[1]`. */
  path: string;
  line?: number;
  message: string;
  hint?: string;
}

/**
 * The two- or three-line printed form:
 *
 *   office/agents.yaml:31  agents[3].tools[1]
 *     AGENT_TOOL_UNKNOWN: no tool called "lookup_orders". Did you mean "lookup_order"?
 *     Hint: check the name in office/tools/ or config.yaml mcp.servers.
 */
export function printConfigError(error: ConfigError): string {
  const where =
    error.line === undefined ? `office/${error.file}` : `office/${error.file}:${error.line}`;
  const lines = [`${where}  ${error.path}`, `  ${error.code}: ${error.message}`];
  if (error.hint !== undefined) lines.push(`  Hint: ${error.hint}`);
  return lines.join("\n");
}

export function printConfigErrors(errors: ConfigError[]): string {
  return errors.map(printConfigError).join("\n\n");
}

/** Thrown when a file cannot produce a usable roster or config at all. */
export class ConfigInvalid extends Error {
  readonly errors: ConfigError[];

  constructor(errors: ConfigError[]) {
    super(
      errors.length === 1
        ? (errors[0] as ConfigError).message
        : `${errors.length} problems in your office configuration.`,
    );
    this.name = "ConfigInvalid";
    this.errors = errors;
  }

  override toString(): string {
    return printConfigErrors(this.errors);
  }
}

/** "lookup_orders" against ["lookup_order"] gives "lookup_order". Levenshtein within two edits. */
export function didYouMean(input: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const d = distance(input, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (current[j - 1] as number) + 1,
        (previous[j] as number) + 1,
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] as number;
}
