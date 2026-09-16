/**
 * web_search.
 *
 * Registered even when no backend is configured, because the name has to exist:
 * the studio roster lists `web`, forAgent resolves that alias to this tool, and a
 * roster naming a tool that is not registered fails validation at boot. With no
 * key it returns an error object rather than throwing, so a run continues and the
 * model can say it could not search.
 *
 * Three rules the backends are held to:
 *
 *   Nothing here throws. A search that failed is a result the agent reads and
 *   reports — "I could not search, the key was rejected" — rather than an
 *   exception that ends a run the owner was watching.
 *
 *   Results are capped at 4,000 characters in total, not only at `maxResults`.
 *   A snippet is the cheapest prompt-injection surface there is: it is text from
 *   a stranger's web page arriving inside the agent's context, and an
 *   unbounded one is an unbounded amount of somebody else's writing.
 *
 *   The key never appears in a message. Errors quote the status, not the request.
 */
import { z } from "zod";
import type { OfficeConfig } from "../../config/config.js";
import { type Tool, tool } from "../tool.js";

export const WEB_SEARCH_UNCONFIGURED =
  "Add a search key in office/config.yaml under tools.web to turn this on.";

/** The whole result set, across every snippet. See the header. */
export const SNIPPET_BUDGET = 4_000;

/** A backend that has stopped answering should not hold a run open. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/**
 * What the connector strip shows for web_search.
 *
 * Kept per office config rather than per process: two offices in one process
 * (the tests, and the demo fallback at boot) must not report each other's
 * failures. `untried` is deliberately distinct from `ok` — a configured backend
 * nobody has called yet has not been shown to work.
 */
export type WebSearchState = "unconfigured" | "untried" | "ok" | "down";

export interface WebSearchStatus {
  state: WebSearchState;
  message?: string;
}

const STATUS = new WeakMap<OfficeConfig, WebSearchStatus>();

export function webSearchStatus(config: OfficeConfig): WebSearchStatus {
  if (config.tools.web.provider === "none") {
    return { state: "unconfigured", message: WEB_SEARCH_UNCONFIGURED };
  }
  return STATUS.get(config) ?? { state: "untried" };
}

/**
 * Trims a result set to the budget.
 *
 * Whole hits are kept where they fit and the one that crosses the line is cut
 * rather than dropped, because a half-read title is still a link the agent can
 * follow. Titles and urls count towards the budget too: they are just as much
 * somebody else's text.
 */
export function capResults(hits: SearchHit[], budget = SNIPPET_BUDGET): SearchHit[] {
  const kept: SearchHit[] = [];
  let used = 0;

  for (const hit of hits) {
    const fixed = hit.title.length + hit.url.length;
    // No room for even the title and the link: stop rather than emit a stub.
    if (used + fixed >= budget) break;
    used += fixed;

    const room = budget - used;
    const snippet = hit.snippet.length <= room ? hit.snippet : hit.snippet.slice(0, room);
    used += snippet.length;
    kept.push({ ...hit, snippet });

    if (used >= budget) break;
  }

  return kept;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Anything without a url is not a search result, whatever the backend called it. */
function hitsFrom(rows: unknown, snippetKey: string): SearchHit[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const record = (row ?? {}) as Record<string, unknown>;
      return {
        title: text(record["title"]),
        url: text(record["url"]),
        snippet: text(record[snippetKey]),
      };
    })
    .filter((hit) => hit.url.length > 0);
}

interface BackendRequest {
  url: string;
  init: RequestInit;
  /** Which field on a result row holds the extract. */
  snippetKey: string;
  /** Where the rows live in the response body. */
  rows: (body: Record<string, unknown>) => unknown;
}

export function buildRequest(
  config: OfficeConfig,
  query: string,
  count: number,
): BackendRequest | { error: string } {
  const web = config.tools.web;
  const key = web.api_key ?? "";

  switch (web.provider) {
    case "brave": {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));
      return {
        url: url.toString(),
        init: {
          headers: { Accept: "application/json", "X-Subscription-Token": key },
        },
        snippetKey: "description",
        rows: (body) => (body["web"] as { results?: unknown } | undefined)?.results,
      };
    }

    case "tavily":
      return {
        url: "https://api.tavily.com/search",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ query, max_results: count }),
        },
        snippetKey: "content",
        rows: (body) => body["results"],
      };

    case "searxng": {
      // Self-hosted and keyless, so the address is the whole configuration and
      // there is no sensible default to guess at.
      if (web.base_url === undefined || web.base_url.length === 0) {
        return { error: "searxng needs tools.web.base_url in office/config.yaml" };
      }
      const url = new URL("/search", web.base_url);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      return {
        url: url.toString(),
        init: { headers: { Accept: "application/json" } },
        snippetKey: "content",
        rows: (body) => body["results"],
      };
    }

    default:
      return { error: "web search is not configured" };
  }
}

export function webSearchTool(config: OfficeConfig): Tool {
  const web = config.tools.web;

  return {
    ...tool({
      name: "web_search",
      description: "Search the web. Returns titles, urls and short extracts.",
      input: z.object({
        query: z.string().min(1).max(400),
        maxResults: z.number().int().min(1).max(10).default(5),
      }),
      scope: "read",
      // The query leaves this machine, so it is size-limited like any egress read.
      egress: true,
      run: async (input, ctx) => {
        const { query, maxResults } = input as { query: string; maxResults: number };

        if (web.provider === "none") {
          return { error: "web search is not configured", hint: WEB_SEARCH_UNCONFIGURED };
        }

        const count = Math.min(maxResults, web.max_results);
        const request = buildRequest(config, query, count);
        if ("error" in request) {
          STATUS.set(config, { state: "down", message: request.error });
          return { error: request.error, hint: WEB_SEARCH_UNCONFIGURED };
        }

        try {
          const response = await fetch(request.url, {
            ...request.init,
            // The run's own signal as well as a ceiling, so cancelling a task
            // does not leave a search running against somebody's API.
            signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          });

          if (!response.ok) {
            // The status, never the request: the key is in the request.
            const message = `${web.provider} search failed with HTTP ${response.status}`;
            STATUS.set(config, { state: "down", message });
            return { error: message };
          }

          const body = (await response.json()) as Record<string, unknown>;
          const hits = capResults(hitsFrom(request.rows(body), request.snippetKey).slice(0, count));

          STATUS.set(config, { state: "ok" });
          return hits;
        } catch (error) {
          const message =
            error instanceof Error && error.name === "TimeoutError"
              ? `${web.provider} search did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds`
              : `${web.provider} search could not be reached`;
          STATUS.set(config, { state: "down", message });
          return { error: message };
        }
      },
    }),
    source: { kind: "builtin" },
  } as Tool;
}

/** A backend named without a key is a config mistake, not a silent fall-through. */
export function webSearchConfigError(config: OfficeConfig): string | undefined {
  const web = config.tools.web;
  if (web.provider === "none" || web.provider === "searxng") return undefined;
  if (web.api_key === undefined || web.api_key.length === 0) {
    return `tools.web.provider is ${web.provider} but tools.web.api_key is not set.`;
  }
  return undefined;
}
