/**
 * web_search.
 *
 * Registered even when no backend is configured, because the name has to exist:
 * the studio roster lists `web`, forAgent resolves that alias to this tool, and a
 * roster naming a tool that is not registered fails validation at boot. With no
 * key it returns an error object rather than throwing, so a run continues and the
 * model can say it could not search.
 *
 * The brave, tavily and searxng backends land in SR-059.
 */
import { z } from "zod";
import type { OfficeConfig } from "../../config/config.js";
import { type Tool, tool } from "../tool.js";

export const WEB_SEARCH_UNCONFIGURED =
  "Add a search key in office/config.yaml under tools.web to turn this on.";

export function webSearchTool(config: OfficeConfig): Tool {
  const provider = config.tools.web.provider;

  return {
    ...tool({
      name: "web_search",
      description: "Search the web. Returns titles, urls and short extracts.",
      input: z.object({
        query: z.string().min(1),
        maxResults: z.number().int().min(1).max(20).default(5),
      }),
      scope: "read",
      // The query leaves this machine, so it is size-limited like any egress read.
      egress: true,
      run: async () => {
        if (provider === "none") {
          return { error: "web search is not configured", hint: WEB_SEARCH_UNCONFIGURED };
        }
        // SR-059 replaces this with the real backends.
        return {
          error: `the ${provider} backend is not implemented yet`,
          hint: WEB_SEARCH_UNCONFIGURED,
        };
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
