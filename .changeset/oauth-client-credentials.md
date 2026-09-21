---
"@staffroom/core": patch
"@staffroom/server": patch
"@staffroom/web": patch
---

You can now sign in to a remote MCP server. The loopback address an OAuth
provider sends your browser back to was never set, so signing in to any remote
server answered "This office cannot sign in to servers." And a connector can
carry an OAuth client you registered yourself, which is the only way to reach
providers that do not offer dynamic registration — Google's Gmail MCP server
among them. The client secret goes to `office/.env`; `config.yaml` gets its name.
