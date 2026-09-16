/**
 * web_search: the tool that talks to somebody else.
 *
 * Two things are being protected. The first is that a search which goes wrong —
 * a rejected key, a backend that is down, a reply in a shape nobody expected —
 * comes back as a result the agent can read and report, never as an exception
 * that ends a run somebody was watching.
 *
 * The second is the 4,000-character cap. Snippets are text written by strangers
 * arriving inside the agent's context, which makes them the cheapest
 * prompt-injection surface in the product; an uncapped result set is an
 * unbounded amount of somebody else's writing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { ConfigSchema, type OfficeConfig } from "../../config/config.js";
import {
  buildRequest,
  capResults,
  type SearchHit,
  SNIPPET_BUDGET,
  webSearchStatus,
  webSearchTool,
} from "./web-search.js";

function config(web: Record<string, unknown>): OfficeConfig {
  return ConfigSchema.parse({ version: 1, tools: { web } });
}

const ctx = {
  agentId: "researcher",
  department: "marketing",
  runId: "r1",
  signal: new AbortController().signal,
  log: () => {},
  brain: {} as never,
};

async function search(
  cfg: OfficeConfig,
  input: { query: string; maxResults?: number } = { query: "bakery" },
): Promise<unknown> {
  const tool = webSearchTool(cfg);
  const parsed = (tool.input as z.ZodType).parse(input);
  return await tool.run(parsed, ctx);
}

/** Answers every fetch with one recorded body. */
function reply(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Recorded from each provider's documented response shape. Only the fields the
// mapper reads are kept; the real bodies carry a great deal more.
const BRAVE = {
  web: {
    results: [
      { title: "Sourdough basics", url: "https://example.com/a", description: "Flour and time." },
      { title: "Bakery costs", url: "https://example.com/b", description: "What ovens cost." },
    ],
  },
};

const TAVILY = {
  results: [
    { title: "Sourdough basics", url: "https://example.com/a", content: "Flour and time." },
    { title: "Bakery costs", url: "https://example.com/b", content: "What ovens cost." },
  ],
};

const SEARXNG = {
  results: [
    { title: "Sourdough basics", url: "https://example.com/a", content: "Flour and time." },
  ],
};

describe("with no backend", () => {
  it("says so rather than throwing, so the run continues", async () => {
    const result = (await search(config({ provider: "none" }))) as { error: string };
    expect(result.error).toBe("web search is not configured");
  });

  it("shows grey on the connector strip", () => {
    expect(webSearchStatus(config({ provider: "none" })).state).toBe("unconfigured");
  });
});

describe("brave", () => {
  it("maps the response to title, url and snippet", async () => {
    reply(BRAVE);
    const hits = (await search(config({ provider: "brave", api_key: "k" }))) as SearchHit[];

    expect(hits).toEqual([
      { title: "Sourdough basics", url: "https://example.com/a", snippet: "Flour and time." },
      { title: "Bakery costs", url: "https://example.com/b", snippet: "What ovens cost." },
    ]);
  });

  it("sends the key in the header and never in the query string", () => {
    const request = buildRequest(config({ provider: "brave", api_key: "secret-key" }), "bakery", 5);
    if ("error" in request) throw new Error("expected a request");

    expect(request.url).not.toContain("secret-key");
    expect((request.init.headers as Record<string, string>)["X-Subscription-Token"]).toBe(
      "secret-key",
    );
  });

  it("asks for the number of results it was asked for", () => {
    const request = buildRequest(config({ provider: "brave", api_key: "k" }), "bakery", 3);
    if ("error" in request) throw new Error("expected a request");
    expect(request.url).toContain("count=3");
  });
});

describe("tavily", () => {
  it("maps content to snippet", async () => {
    reply(TAVILY);
    const hits = (await search(config({ provider: "tavily", api_key: "k" }))) as SearchHit[];
    expect(hits[0]?.snippet).toBe("Flour and time.");
  });

  it("puts the key in a header, not the body", () => {
    const request = buildRequest(config({ provider: "tavily", api_key: "secret-key" }), "q", 5);
    if ("error" in request) throw new Error("expected a request");

    expect(request.init.body).not.toContain("secret-key");
    expect((request.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer secret-key",
    );
  });
});

describe("searxng", () => {
  it("needs a base url, and says which setting is missing", async () => {
    const result = (await search(config({ provider: "searxng" }))) as { error: string };
    expect(result.error).toContain("tools.web.base_url");
  });

  it("asks a self-hosted instance for json", async () => {
    const cfg = config({ provider: "searxng", base_url: "http://127.0.0.1:8080" });
    const request = buildRequest(cfg, "bakery", 5);
    if ("error" in request) throw new Error("expected a request");

    expect(request.url).toBe("http://127.0.0.1:8080/search?q=bakery&format=json");
  });

  it("maps results with no key configured at all", async () => {
    reply(SEARXNG);
    const cfg = config({ provider: "searxng", base_url: "http://127.0.0.1:8080" });
    const hits = (await search(cfg)) as SearchHit[];
    expect(hits).toHaveLength(1);
  });
});

describe("when the backend refuses", () => {
  it("returns the status as a result, never an exception", async () => {
    reply({ message: "Unauthorized" }, 401);
    const cfg = config({ provider: "brave", api_key: "wrong" });

    const result = (await search(cfg)) as { error: string };
    expect(result.error).toContain("401");
    expect(result.error).toContain("brave");
  });

  it("does not put the key in the message", async () => {
    reply({}, 401);
    const cfg = config({ provider: "brave", api_key: "secret-key" });

    const result = (await search(cfg)) as { error: string };
    expect(result.error).not.toContain("secret-key");
  });

  it("turns the connector red", async () => {
    reply({}, 401);
    const cfg = config({ provider: "brave", api_key: "k" });

    expect(webSearchStatus(cfg).state).toBe("untried");
    await search(cfg);
    expect(webSearchStatus(cfg).state).toBe("down");
  });

  it("turns it green again once a call works", async () => {
    const cfg = config({ provider: "brave", api_key: "k" });
    reply({}, 500);
    await search(cfg);
    expect(webSearchStatus(cfg).state).toBe("down");

    reply(BRAVE);
    await search(cfg);
    expect(webSearchStatus(cfg).state).toBe("ok");
  });

  it("survives a backend that cannot be reached at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const result = (await search(config({ provider: "brave", api_key: "k" }))) as { error: string };
    expect(result.error).toContain("could not be reached");
  });

  it("survives a reply that is not the shape the backend documents", async () => {
    reply({ web: { results: "not an array" } });
    const hits = await search(config({ provider: "brave", api_key: "k" }));
    expect(hits).toEqual([]);
  });

  it("drops a row with no url rather than offering a link to nowhere", async () => {
    reply({ web: { results: [{ title: "No link", description: "..." }] } });
    const hits = (await search(config({ provider: "brave", api_key: "k" }))) as SearchHit[];
    expect(hits).toEqual([]);
  });
});

describe("the character budget", () => {
  function hit(snippet: string, n = 1): SearchHit {
    return { title: `T${n}`, url: `https://example.com/${n}`, snippet };
  }

  function total(hits: SearchHit[]): number {
    return hits.reduce((n, h) => n + h.title.length + h.url.length + h.snippet.length, 0);
  }

  it("keeps a small result set whole", () => {
    const hits = [hit("short", 1), hit("also short", 2)];
    expect(capResults(hits)).toEqual(hits);
  });

  it("never returns more than the budget", () => {
    const hits = Array.from({ length: 20 }, (_, i) => hit("x".repeat(500), i));
    expect(total(capResults(hits))).toBeLessThanOrEqual(SNIPPET_BUDGET);
  });

  it("cuts the snippet that crosses the line rather than dropping the hit", () => {
    const hits = [hit("a".repeat(3_900), 1), hit("b".repeat(3_900), 2)];
    const capped = capResults(hits);

    expect(capped).toHaveLength(2);
    expect(capped[1]?.snippet.length).toBeLessThan(3_900);
    expect(total(capped)).toBeLessThanOrEqual(SNIPPET_BUDGET);
  });

  it("counts titles and urls too, because those are somebody else's text as well", () => {
    // Every snippet is empty, so the only thing that can exceed the budget is
    // the titles and links. A cap that only weighed snippets would keep all 400.
    const hits = Array.from({ length: 400 }, (_, i) => ({
      title: "A title of some length",
      url: `https://example.com/a-fairly-long-path/${i}`,
      snippet: "",
    }));

    const capped = capResults(hits);
    expect(capped.length).toBeLessThan(hits.length);
    expect(total(capped)).toBeLessThanOrEqual(SNIPPET_BUDGET);
  });

  it("applies to what a real backend returns", async () => {
    reply({
      web: {
        results: Array.from({ length: 10 }, (_, i) => ({
          title: `Result ${i}`,
          url: `https://example.com/${i}`,
          description: "x".repeat(2_000),
        })),
      },
    });

    const hits = (await search(config({ provider: "brave", api_key: "k" }), {
      query: "bakery",
      maxResults: 10,
    })) as SearchHit[];

    expect(total(hits)).toBeLessThanOrEqual(SNIPPET_BUDGET);
  });
});

describe("the input contract", () => {
  it("refuses a query longer than the spec allows", () => {
    const tool = webSearchTool(config({ provider: "none" }));
    expect(() => (tool.input as z.ZodType).parse({ query: "x".repeat(401) })).toThrow();
  });

  it("asks for five results when nobody said", () => {
    const tool = webSearchTool(config({ provider: "none" }));
    const parsed = (tool.input as z.ZodType).parse({ query: "bakery" }) as { maxResults: number };
    expect(parsed.maxResults).toBe(5);
  });

  it("never asks a backend for more than the office configured", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => new Response(JSON.stringify(BRAVE)));
    vi.stubGlobal("fetch", fetchMock);

    const cfg = config({ provider: "brave", api_key: "k", max_results: 2 });
    await search(cfg, { query: "bakery", maxResults: 10 });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("count=2");
  });
});

describe("registration", () => {
  it("is a read that leaves the machine, so its input is size-limited", () => {
    const tool = webSearchTool(config({ provider: "none" }));
    expect(tool.scope).toBe("read");
    expect(tool.egress).toBe(true);
    expect(tool.source.kind).toBe("builtin");
  });
});
