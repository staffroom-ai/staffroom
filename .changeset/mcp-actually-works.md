---
"@staffroom/core": patch
"@staffroom/server": patch
---

MCP connectors work. Every MCP tool used to fail to register — connect a server,
watch it report ready with a tool count, and no agent could use a single one of
its tools. The connector strip also never changed after boot, and adding a server
to `config.yaml` did nothing until a restart. All three are fixed, and connectors
can be scoped to departments as well as to individual staff.
