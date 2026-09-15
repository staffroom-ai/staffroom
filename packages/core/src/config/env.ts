/**
 * `$NAME` expansion, and refusing to let a real key sit in config.yaml.
 *
 * config.yaml is the file owners paste into issues and screenshots. Keys belong in
 * office/.env, which is gitignored and never exported, so a literal in a secret
 * position is an error rather than a warning.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigError, ConfigFile } from "./errors.js";

const REFERENCE = /^\$([A-Z_][A-Z0-9_]*)$/;
/** Keys whose value must be a $NAME reference, never a literal. */
const SECRET_KEY = /(^|[._-])(api[_-]?key|token|secret|password|bearer|authorization)$/i;
/** Shorter than this and it is far more likely a placeholder than a key. */
const SECRET_MIN_LENGTH = 12;

export const SECRET_LITERAL_HINT =
  "config.yaml contains what looks like a key. Move it to office/.env as ANTHROPIC_API_KEY=... and write $ANTHROPIC_API_KEY here.";

/** Parses NAME=value lines. Ignores blanks, comments, and strips one layer of quotes. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadDotEnv(officeDir: string): Record<string, string> {
  try {
    return parseDotEnv(readFileSync(join(officeDir, ".env"), "utf8"));
  } catch {
    return {};
  }
}

export interface ExpandResult<T> {
  value: T;
  errors: ConfigError[];
  /** Every value that resolved, for redaction to be configured with. */
  secrets: string[];
  /** Paths whose $NAME did not resolve. Providers and MCP servers degrade rather than fail. */
  unresolved: Array<{ path: string; name: string }>;
}

/**
 * Walks the parsed config replacing `$NAME`, collecting what it could not resolve
 * and refusing literals in secret positions.
 */
export function expandEnv<T>(
  value: T,
  env: Record<string, string | undefined>,
  file: ConfigFile = "config.yaml",
): ExpandResult<T> {
  const errors: ConfigError[] = [];
  const secrets: string[] = [];
  const unresolved: Array<{ path: string; name: string }> = [];

  const walk = (node: unknown, path: string, key: string): unknown => {
    if (typeof node === "string") {
      const match = REFERENCE.exec(node);
      if (match) {
        const name = match[1] as string;
        const resolved = env[name];
        if (resolved === undefined || resolved.length === 0) {
          unresolved.push({ path, name });
          return node;
        }
        if (resolved.length >= 8) secrets.push(resolved);
        return resolved;
      }
      // Not a reference. In a secret position, a long literal is a pasted key.
      if (SECRET_KEY.test(key) && node.length > SECRET_MIN_LENGTH) {
        errors.push({
          code: "SECRET_LITERAL_IN_CONFIG",
          file,
          path,
          message: `${key} looks like a real key rather than a $NAME reference.`,
          hint: SECRET_LITERAL_HINT,
        });
      }
      return node;
    }

    if (Array.isArray(node)) return node.map((item, i) => walk(item, `${path}[${i}]`, key));

    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        out[k] = walk(v, path.length === 0 ? k : `${path}.${k}`, k);
      }
      return out;
    }

    return node;
  };

  return { value: walk(value, "", "") as T, errors, secrets, unresolved };
}

/**
 * Every value under `mcp.servers.*.env` and `.args` is a secret position too,
 * regardless of its key, because that is where server tokens are passed.
 */
export function mcpSecretPaths(config: unknown): string[] {
  const paths: string[] = [];
  const servers = (config as { mcp?: { servers?: Record<string, unknown> } })?.mcp?.servers;
  if (!servers) return paths;
  for (const name of Object.keys(servers)) {
    paths.push(`mcp.servers.${name}.env`, `mcp.servers.${name}.args`);
  }
  return paths;
}
