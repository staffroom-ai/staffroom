/**
 * Who is allowed to talk to this office.
 *
 * Binding to loopback is not enough on its own. Any web page the owner has open
 * can try to reach ws://127.0.0.1:4242, so there are three checks, and all of them
 * stay on even with --host:
 *
 *   Origin must be exactly ours, which stops a page on another site connecting.
 *   A per-boot token must be presented, which stops anything that never loaded our
 *   page from guessing its way in.
 *   Host must be one we recognise, which stops DNS rebinding.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const TOKEN_HEADER = "x-staffroom-token";
export const TOKEN_META = "staffroom-token";
/** WebSocket close code for a bad or missing token. */
export const CLOSE_UNAUTHORISED = 4401;

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** Constant-time, so a wrong token cannot be narrowed down by timing. */
export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (given === undefined || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export interface AuthConfig {
  token: string;
  host: string;
  port: number;
}

/** Hosts we answer to. Anything else is a rebinding attempt or a misconfiguration. */
function allowedHosts(config: AuthConfig): Set<string> {
  const hosts = new Set<string>();
  for (const name of ["localhost", "127.0.0.1", "[::1]", config.host]) {
    hosts.add(`${name}:${config.port}`);
  }
  // A default-port URL may omit it entirely.
  if (config.port === 80) for (const name of ["localhost", "127.0.0.1"]) hosts.add(name);
  return hosts;
}

export function hostAllowed(request: IncomingMessage, config: AuthConfig): boolean {
  const host = request.headers.host;
  return host !== undefined && allowedHosts(config).has(host);
}

/**
 * Origin must match the Host the request claims. Host itself is checked separately
 * against the allow-list, so matching the two is enough to prove same-origin.
 * A missing Origin is allowed only for GETs, which is what a plain navigation sends.
 */
export function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return request.method === "GET" || request.method === undefined;

  const host = request.headers.host;
  if (host === undefined) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && (parsed.protocol === "http:" || parsed.protocol === "https:");
  } catch {
    return false;
  }
}

export type AuthFailure = { ok: false; status: 403; reason: "origin" | "host" | "token" };
export type AuthOk = { ok: true };

/** Every non-GET request and every WebSocket upgrade goes through this. */
export function checkRequest(
  request: IncomingMessage,
  config: AuthConfig,
  options: { requireToken?: boolean } = {},
): AuthOk | AuthFailure {
  if (!hostAllowed(request, config)) return { ok: false, status: 403, reason: "host" };
  if (!originAllowed(request)) return { ok: false, status: 403, reason: "origin" };
  if (options.requireToken === true) {
    const header = request.headers[TOKEN_HEADER];
    const given = Array.isArray(header) ? header[0] : header;
    if (!tokenMatches(config.token, given)) return { ok: false, status: 403, reason: "token" };
  }
  return { ok: true };
}

export const NO_ACCOUNTS_WARNING =
  "Staffroom has no user accounts. Anyone who can reach %HOST% and sees this link can read your notes and approve actions. Put it behind a VPN or a reverse proxy with auth.";

export function noAccountsWarning(host: string, port: number): string {
  return NO_ACCOUNTS_WARNING.replace("%HOST%", `${host}:${port}`);
}
