/**
 * Keeping secrets out of the run log, the WebSocket and exports.
 *
 * Two mechanisms, because either alone leaks. Configured values catch the keys we
 * know about, wherever they turn up, including inside a tool's output. Key-name
 * matching catches the ones we do not, such as a token a tool received from an API
 * we have never heard of.
 */

const SECRET_KEY = /token|secret|password|api[_-]?key|authorization/i;
const REPLACEMENT = "••••";
/** Shorter values are too likely to appear innocently elsewhere. PORT=4242 must not redact 4242. */
const MIN_SECRET_LENGTH = 8;

let configured: string[] = [];

/** Called once at boot with every .env value, MCP env and args, OAuth token and api_key. */
export function configureRedaction(secrets: Iterable<string>): void {
  configured = [
    ...new Set([...secrets].filter((s) => typeof s === "string" && s.length >= MIN_SECRET_LENGTH)),
  ]
    // Longest first, so a secret containing another is replaced whole.
    .sort((a, b) => b.length - a.length);
}

/**
 * Adds secrets to the ones already configured, rather than replacing them.
 *
 * An OAuth token arrives long after the office read config.yaml, and calling
 * configureRedaction again with only the new value would stop redacting every
 * key from the config file.
 */
export function addRedactionSecrets(secrets: Iterable<string>): void {
  configureRedaction([...configured, ...secrets]);
}

export function clearRedaction(): void {
  configured = [];
}

export function configuredSecretCount(): number {
  return configured.length;
}

/**
 * A deep copy with secrets replaced. Pure: it never mutates its argument, never
 * logs, and returns the same shape it was given.
 */
export function redactSecrets<T>(value: T): T {
  return redactSecretsCounted(value).value;
}

export function redactSecretsCounted<T>(value: T): { value: T; count: number } {
  let count = 0;

  const redactString = (text: string): string => {
    let out = text;
    for (const secret of configured) {
      if (out.includes(secret)) {
        out = out.split(secret).join(REPLACEMENT);
        count++;
      }
    }
    return out;
  };

  const walk = (node: unknown, keyIsSecret: boolean): unknown => {
    if (typeof node === "string") {
      if (keyIsSecret && node.length >= MIN_SECRET_LENGTH && node !== REPLACEMENT) {
        count++;
        return REPLACEMENT;
      }
      return redactString(node);
    }

    if (node === null || node === undefined) return node;
    if (node instanceof Date) return node;
    if (Array.isArray(node)) return node.map((item) => walk(item, keyIsSecret));

    if (typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v, SECRET_KEY.test(k));
      return out;
    }

    return node;
  };

  return { value: walk(value, false) as T, count };
}
