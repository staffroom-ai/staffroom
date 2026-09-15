/**
 * Reading office/agents.yaml and office/config.yaml from disk.
 *
 * Both loaders collect every problem rather than throwing on the first, because an
 * owner fixing their file wants the whole list, not one error at a time.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ZodError } from "zod";
import { type AgentsFile, AgentsFileSchema } from "./agents.js";
import { ConfigSchema, MISPLACED_KEYS, type OfficeConfig } from "./config.js";
import { expandEnv, loadDotEnv } from "./env.js";
import { type ConfigError, type ConfigFile, ConfigInvalid } from "./errors.js";
import { Roster } from "./roster.js";

/** Turns a zod issue into the error an owner sees, naming the file and the path. */
function fromZod(error: ZodError, file: ConfigFile): ConfigError[] {
  return error.issues.map((issue) => {
    const path = issue.path
      .map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`))
      .join("")
      .replace(/^\./, "");

    if (issue.code === "unrecognized_keys") {
      const key = (issue as { keys: string[] }).keys[0] as string;
      const hint = MISPLACED_KEYS[key];
      return {
        code: "UNKNOWN_KEY" as const,
        file,
        path: path.length === 0 ? key : `${path}.${key}`,
        message: `${key} is not a setting in this file.`,
        ...(hint === undefined ? {} : { hint }),
      };
    }

    if (path.endsWith("timezone")) {
      return {
        code: "OFFICE_TIMEZONE_INVALID" as const,
        file,
        path,
        message: `${issue.message}. Use an IANA name such as Australia/Melbourne.`,
      };
    }

    if (path === "version") {
      return {
        code: "CONFIG_VERSION_UNKNOWN" as const,
        file,
        path,
        message: "this file needs version: 1 at the top.",
      };
    }

    return {
      code: "AGENT_FIELD_MISSING" as const,
      file,
      path: path.length === 0 ? "(root)" : path,
      message: issue.message,
    };
  });
}

function readYaml(path: string, file: ConfigFile): { data: unknown; errors: ConfigError[] } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {
      data: undefined,
      errors: [
        {
          code: "YAML_PARSE",
          file,
          path: "(file)",
          message: `office/${file} is missing.`,
          hint: "run npx staffroom init to create an office, or check the --office path.",
        },
      ],
    };
  }

  try {
    return { data: parseYaml(text), errors: [] };
  } catch (error) {
    return {
      data: undefined,
      errors: [
        {
          code: "YAML_PARSE",
          file,
          path: "(file)",
          message:
            error instanceof Error
              ? (error.message.split("\n")[0] ?? "invalid YAML")
              : "invalid YAML",
          hint: "check the indentation; YAML is sensitive to it.",
        },
      ],
    };
  }
}

export interface LoadedConfig {
  config: OfficeConfig;
  /** Resolved secret values, for configureRedaction. */
  secrets: string[];
  /** Providers and MCP servers whose $NAME did not resolve; these degrade rather than fail. */
  unresolved: Array<{ path: string; name: string }>;
  warnings: ConfigError[];
}

export function loadConfig(officeDir: string): LoadedConfig {
  const { data, errors } = readYaml(join(officeDir, "config.yaml"), "config.yaml");
  if (errors.length > 0) throw new ConfigInvalid(errors);

  const env = { ...process.env, ...loadDotEnv(officeDir) };
  const expanded = expandEnv(data, env);

  const parsed = ConfigSchema.safeParse(expanded.value);
  if (!parsed.success)
    throw new ConfigInvalid([...expanded.errors, ...fromZod(parsed.error, "config.yaml")]);
  if (expanded.errors.length > 0) throw new ConfigInvalid(expanded.errors);

  // An unresolved $NAME under providers or mcp.servers is a warning: that provider
  // is skipped and that server shows unavailable. Anywhere else it is an error.
  const warnings: ConfigError[] = [];
  const hard: ConfigError[] = [];
  for (const { path, name } of expanded.unresolved) {
    const degrades = path.startsWith("providers.") || path.startsWith("mcp.servers.");
    const entry: ConfigError = {
      code: "ENV_VAR_UNRESOLVED",
      file: "config.yaml",
      path,
      message: `$${name} is not set, so ${path.split(".").slice(0, 2).join(".")} is unavailable.`,
      hint: `add ${name}=... to office/.env, or remove this setting.`,
    };
    if (degrades) warnings.push(entry);
    else hard.push(entry);
  }
  if (hard.length > 0) throw new ConfigInvalid(hard);

  return {
    config: parsed.data,
    secrets: expanded.secrets,
    unresolved: expanded.unresolved,
    warnings,
  };
}

export function loadAgentsFile(officeDir: string): AgentsFile {
  const { data, errors } = readYaml(join(officeDir, "agents.yaml"), "agents.yaml");
  if (errors.length > 0) throw new ConfigInvalid(errors);

  const parsed = AgentsFileSchema.safeParse(data);
  if (!parsed.success) throw new ConfigInvalid(fromZod(parsed.error, "agents.yaml"));
  return parsed.data;
}

export function loadRoster(officeDir: string): Roster {
  return new Roster(loadAgentsFile(officeDir));
}

/** The raw text, for RosterWriter to edit without losing comments. */
export function readAgentsText(officeDir: string): string {
  return readFileSync(join(officeDir, "agents.yaml"), "utf8");
}
