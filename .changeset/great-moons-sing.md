---
"@staffroom/core": patch
"@staffroom/server": patch
---

web_search can actually search now: Brave, Tavily and self-hosted SearXNG.

Each maps its own reply shape to the same `{ title, url, snippet }`, and the
whole result set is capped at 4,000 characters — titles and links included,
because all three are text a stranger wrote arriving inside the agent's context,
which makes them the cheapest prompt-injection surface in the product. The hit
that crosses the line is truncated rather than dropped, so a partial extract
still carries a link worth following.

Nothing here throws. A rejected key, a backend that is down, a reply in a shape
nobody expected: each comes back as a result the agent can read and report,
rather than an exception that ends a run somebody was watching. The key goes in
a header, never a query string, and never appears in an error message.

The web_search connector follows: grey with no backend, and red with the reason
once a call has actually failed. Configured-but-never-called is not reported as
working, because it has not been shown to work.
