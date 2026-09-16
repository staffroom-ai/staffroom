/**
 * A real MCP server, small enough to run in a test.
 *
 * The manager is the one place Staffroom talks to software it did not write, so
 * testing it against a mock of our own assumptions would test the assumptions.
 * This speaks the actual protocol over stdio through the official SDK, and is
 * driven by environment variables so one binary can play every case the manager
 * has to survive: a server that never answers, one that changes its tools, one
 * that reports a tool read-only, one whose descriptions are far too long.
 *
 * Plain JavaScript on purpose: it is spawned as a child process, so keeping it
 * out of the TypeScript build means the tests need no extra runner.
 *
 * Run directly: `node src/testing/mcp-echo-server.mjs`
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/** Env switches, so one server can play every case the manager must handle. */
const SILENT = process.env["MCP_ECHO_SILENT"] === "1";
const LONG_DESCRIPTION = process.env["MCP_ECHO_LONG_DESCRIPTION"] === "1";
const SECOND_LIST = process.env["MCP_ECHO_SECOND_LIST"] === "1";
const FAIL_CALL = process.env["MCP_ECHO_FAIL_CALL"] === "1";

/** A server that accepts the connection and then never answers anything. */
if (SILENT) {
  process.stdin.resume();
  setInterval(() => {}, 1 << 30);
} else {
  const server = new Server(
    { name: "echo", version: "0.0.0" },
    { capabilities: { tools: { listChanged: true } } },
  );

  let listCount = 0;

  server.setRequestHandler(ListToolsRequestSchema, () => {
    listCount += 1;
    const changed = SECOND_LIST && listCount > 1;

    const tools = [
      {
        name: "echo",
        description: LONG_DESCRIPTION ? "x".repeat(4000) : "Echoes a message back.",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
      },
      {
        name: "lookup",
        // readOnlyHint is what decides whether a call needs the owner's approval,
        // so a server that sets it is a case worth having.
        description: changed ? "Looks things up, differently now." : "Looks things up.",
        inputSchema: { type: "object", properties: { q: { type: "string" } } },
        annotations: { readOnlyHint: true },
      },
    ];

    // The second listing drops a tool and adds one, so a diff has something to
    // find in every direction: added, removed and changed.
    if (changed) {
      tools.push({
        name: "added_later",
        description: "Appeared on the second listing.",
        inputSchema: { type: "object", properties: {} },
      });
      return { tools: tools.filter((t) => t.name !== "echo") };
    }

    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    if (FAIL_CALL) throw new Error("the server refused");
    const args = request.params.arguments ?? {};
    return {
      content: [{ type: "text", text: JSON.stringify({ tool: request.params.name, args }) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
