---
"@staffroom/core": minor
"@staffroom/server": minor
---

MCP servers that need you to sign in can now be signed in to. The SDK does the
protocol — PKCE with S256, discovery, the token exchange; what Staffroom owns is
everything touching your machine.

Tokens are written to `office/.staffroom/secrets/`, the file mode 0600 and the
folder 0700, and are registered for redaction the moment they are saved rather
than at the next restart: a token that reaches a log before then is a token in a
log. Saved tokens are re-registered as the office opens, before any run can
start.

The callback route carries no session token, because the redirect arrives from
somebody else's website. A `state` the office issued is therefore the only thing
that makes a callback ours, it is good for exactly one use, and it expires. A
callback without one is refused and nothing is written.

A server that answers 401 is left at `needs_auth` and is not retried. Retrying
achieves nothing until you have actually signed in, and a loop of failing
requests against somebody's auth server is a good way to be rate-limited.
