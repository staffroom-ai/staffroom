import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentConfig } from "../config/agents.js";
import { ConfigSchema, type OfficeConfig } from "../config/config.js";
import type { BrainReader, ToolSource } from "../shared/types.js";
import { buildPreview } from "./preview.js";
import {
  type ApprovalRequest,
  DENY_ALL,
  IMPLIED_TOOLS,
  ToolNameConflict,
  ToolRegistry,
} from "./registry.js";
import { scopeWasAssumed, type Tool, type ToolContext, ToolNameInvalid, tool } from "./tool.js";

const brain: BrainReader = {
  search: () => Promise.resolve([]),
  read: () => Promise.resolve(null),
  list: () => Promise.resolve([]),
};

const config = (over: Record<string, unknown> = {}): OfficeConfig =>
  ConfigSchema.parse({ version: 1, ...over });

const ctx = (over: Partial<ToolContext & { toolCallId: string }> = {}) => ({
  agentId: "copywriter",
  department: "marketing",
  runId: "run_1",
  toolCallId: "call_1",
  signal: new AbortController().signal,
  log: () => undefined,
  brain,
  ...over,
});

const agent = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  id: "copywriter",
  department: "marketing",
  role: "Copywriter",
  does: "Writes copy.",
  tools: [],
  lead: false,
  ...over,
});

/** A tool with its source forced, since tool() always says custom. */
const withSource = <T extends Tool>(t: T, source: ToolSource): T => ({ ...t, source }) as T;

const readTool = (over: Partial<Tool> = {}) =>
  withSource(
    tool({
      name: "lookup_order",
      description: "Find an order.",
      input: z.object({ orderNumber: z.string() }),
      scope: "read",
      run: () => Promise.resolve({ status: "shipped" }),
      ...over,
    }) as Tool,
    over.source ?? { kind: "custom", file: "lookup-order.ts" },
  );

const writeTool = (over: Partial<Tool> = {}) =>
  withSource(
    tool({
      name: "send_email",
      description: "Send an email.",
      input: z.object({ to: z.string(), body: z.string() }),
      scope: "write",
      run: () => Promise.resolve({ sent: true }),
      ...over,
    }) as Tool,
    over.source ?? { kind: "custom", file: "send-email.ts" },
  );

describe("tool()", () => {
  it("defaults a missing scope to write, so a forgotten line cannot send email unasked", () => {
    const t = tool({
      name: "risky",
      description: "d",
      input: z.object({}),
      run: () => Promise.resolve(1),
    });
    expect(t.scope).toBe("write");
    expect(scopeWasAssumed({})).toBe(true);
    expect(scopeWasAssumed({ scope: "read" })).toBe(false);
  });

  it("freezes the tool so it cannot change after registration", () => {
    // Directly from tool(), not through the spread helper, which would copy it.
    const t = tool({
      name: "frozen_one",
      description: "d",
      input: z.object({}),
      run: async () => 1,
    });
    expect(Object.isFrozen(t)).toBe(true);
    expect(() => {
      (t as unknown as { description: string }).description = "something else";
    }).toThrow();
  });

  it("accepts a plain name and an MCP name", () => {
    expect(() =>
      tool({ name: "brain_search", description: "d", input: z.object({}), run: async () => 1 }),
    ).not.toThrow();
    expect(() =>
      tool({
        name: "notion.search_pages",
        description: "d",
        input: z.object({}),
        run: async () => 1,
      }),
    ).not.toThrow();
  });

  it("rejects a name with capitals, spaces, two dots or one character", () => {
    for (const name of ["Lookup", "look up", "a.b.c", "x"]) {
      expect(
        () => tool({ name, description: "d", input: z.object({}), run: async () => 1 }),
        name,
      ).toThrow(ToolNameInvalid);
    }
  });
});

describe("register", () => {
  it("converts the schema and fingerprints the tool", () => {
    const r = new ToolRegistry({ config: config() });
    r.register(readTool());
    const got = r.get("lookup_order");
    expect(got?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(got?.inputSchema).toMatchObject({ type: "object" });
    expect(r.has("lookup_order")).toBe(true);
  });

  it("gives a different fingerprint when the description changes", () => {
    const a = new ToolRegistry({ config: config() });
    a.register(readTool());
    const b = new ToolRegistry({ config: config() });
    b.register(readTool({ description: "Find an order, differently." }));
    expect(a.get("lookup_order")?.fingerprint).not.toBe(b.get("lookup_order")?.fingerprint);
  });

  it("refuses a duplicate name", () => {
    const r = new ToolRegistry({ config: config() });
    r.register(readTool());
    expect(() => r.register(readTool())).toThrow(ToolNameConflict);
  });

  it("unregisters and stops reporting the name", () => {
    const r = new ToolRegistry({ config: config() });
    r.register(readTool());
    r.unregister("lookup_order");
    expect(r.has("lookup_order")).toBe(false);
  });
});

describe("forAgent", () => {
  const mcpTool = (name: string, server: string) =>
    withSource(
      tool({
        name,
        description: "d",
        input: z.object({}),
        scope: "read",
        run: async () => 1,
      }) as Tool,
      { kind: "mcp", server },
    );

  const setup = (tools: Tool[], cfg = config()) => {
    const r = new ToolRegistry({ config: cfg });
    for (const t of tools) r.register(t);
    return r;
  };

  it("implies the three brain tools without them being listed", () => {
    const brainTools = [...IMPLIED_TOOLS].map((name) =>
      withSource(
        tool({
          name,
          description: "d",
          input: z.object({}),
          scope: "read",
          run: async () => 1,
        }) as Tool,
        {
          kind: "builtin",
        },
      ),
    );
    const r = setup(brainTools);
    expect(
      r
        .forAgent(agent())
        .map((t) => t.tool.name)
        .sort(),
    ).toEqual([...IMPLIED_TOOLS].sort());
  });

  it("never implies web_search", () => {
    const web = withSource(
      tool({
        name: "web_search",
        description: "d",
        input: z.object({}),
        scope: "read",
        egress: true,
        run: async () => 1,
      }) as Tool,
      { kind: "builtin" },
    );
    expect(setup([web]).forAgent(agent())).toHaveLength(0);
  });

  it("accepts web as the alias for web_search", () => {
    const web = withSource(
      tool({
        name: "web_search",
        description: "d",
        input: z.object({}),
        scope: "read",
        egress: true,
        run: async () => 1,
      }) as Tool,
      { kind: "builtin" },
    );
    expect(setup([web]).forAgent(agent({ tools: ["web"] }))).toHaveLength(1);
    expect(setup([web]).forAgent(agent({ tools: ["web_search"] }))).toHaveLength(1);
  });

  it("gives an agent an MCP server's tools when the server is listed", () => {
    const r = setup([
      mcpTool("notion.search_pages", "notion"),
      mcpTool("notion.create_page", "notion"),
    ]);
    expect(r.forAgent(agent({ tools: ["notion"] }))).toHaveLength(2);
  });

  it("respects a tool's own department restriction", () => {
    const limited = readTool({ departments: ["finance"] });
    expect(setup([limited]).forAgent(agent({ tools: ["lookup_order"] }))).toHaveLength(0);
    expect(
      setup([limited]).forAgent(agent({ department: "finance", tools: ["lookup_order"] })),
    ).toHaveLength(1);
  });

  it("respects the office's wiring for an MCP server", () => {
    const cfg = config({ mcp: { servers: {}, deny: [], departments: { slack: ["ops"] } } });
    const r = setup([mcpTool("slack.post", "slack")], cfg);
    expect(r.forAgent(agent({ tools: ["slack"] }), cfg)).toHaveLength(0);
    expect(r.forAgent(agent({ department: "ops", tools: ["slack"] }), cfg)).toHaveLength(1);
  });

  it("excludes a denied server even when the agent lists it", () => {
    const cfg = config({ mcp: { servers: {}, deny: ["stripe"], departments: {} } });
    const r = setup([mcpTool("stripe.charge", "stripe")], cfg);
    expect(r.forAgent(agent({ tools: ["stripe"] }), cfg)).toHaveLength(0);
  });
});

describe("invoke: validation and the egress limit", () => {
  const setup = (t: Tool, cfg = config()) => {
    const r = new ToolRegistry({ config: cfg });
    r.register(t);
    return r;
  };

  it("reports a tool that does not exist", async () => {
    const r = new ToolRegistry({ config: config() });
    const result = await r.invoke("nope", {}, ctx());
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("rejects input the schema refuses", async () => {
    const result = await setup(readTool()).invoke("lookup_order", { orderNumber: 42 }, ctx());
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("refuses an over-long input to an egress read, with the exact message", async () => {
    const egressRead = readTool({
      name: "notion.search_pages",
      egress: true,
      input: z.object({ query: z.string() }),
      source: { kind: "mcp", server: "notion" },
    });
    const result = await setup(egressRead).invoke(
      "notion.search_pages",
      { query: "x".repeat(1001) },
      ctx(),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message:
          "Input to notion.search_pages is over 1000 characters; this tool sends its input off this computer.",
      },
      durationMs: expect.any(Number),
    });
  });

  it("does not limit a local read of the same size", async () => {
    const big = readTool({ input: z.object({ orderNumber: z.string() }) });
    const result = await setup(big).invoke(
      "lookup_order",
      { orderNumber: "x".repeat(2000) },
      ctx(),
    );
    expect(result.ok).toBe(true);
  });

  it("runs a read without asking anyone", async () => {
    const result = await setup(readTool()).invoke("lookup_order", { orderNumber: "91" }, ctx());
    expect(result).toMatchObject({ ok: true, output: { status: "shipped" } });
  });
});

describe("invoke: the approval gate", () => {
  const setup = (t: Tool, over: Record<string, unknown> = {}) => {
    const asked: ApprovalRequest[] = [];
    const local: ApprovalRequest[] = [];
    const r = new ToolRegistry({
      config: config(),
      whitelist: DENY_ALL,
      onApprovalNeeded: (req) => asked.push(req),
      onLocalWrite: (req) => local.push(req),
      ...over,
    });
    r.register(t);
    return { r, asked, local };
  };

  it("blocks a write until the owner answers, then runs it", async () => {
    const { r, asked } = setup(writeTool());
    const running = r.invoke("send_email", { to: "a@b.c", body: "hi" }, ctx());

    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(r.pending()).toHaveLength(1);
    r.resolve(asked[0]?.approvalId as string, "approve", "owner");

    await expect(running).resolves.toMatchObject({ ok: true, output: { sent: true } });
    expect(r.pending()).toHaveLength(0);
  });

  it("returns the owner's refusal to the model in their own words", async () => {
    const { r, asked } = setup(writeTool());
    const running = r.invoke("send_email", { to: "a@b.c", body: "hi" }, ctx());
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    r.resolve(asked[0]?.approvalId as string, "deny", "owner", "wrong address");

    await expect(running).resolves.toEqual({
      ok: false,
      error: { code: "approval_denied", message: "The owner declined this action." },
      durationMs: expect.any(Number),
    });
  });

  it("treats approve_always as approval", async () => {
    const { r, asked } = setup(writeTool());
    const running = r.invoke("send_email", { to: "a@b.c", body: "hi" }, ctx());
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    r.resolve(asked[0]?.approvalId as string, "approve_always", "owner");
    await expect(running).resolves.toMatchObject({ ok: true });
  });

  it("reports an expired approval as its own thing, not a refusal", async () => {
    const { r, asked } = setup(writeTool());
    const running = r.invoke("send_email", { to: "a@b.c", body: "hi" }, ctx());
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    r.resolve(asked[0]?.approvalId as string, "expired", "system", "server_restart");
    await expect(running).resolves.toMatchObject({
      ok: false,
      error: { code: "approval_expired" },
    });
  });

  it("stops waiting when the run is cancelled", async () => {
    const controller = new AbortController();
    const { r, asked } = setup(writeTool());
    const running = r.invoke(
      "send_email",
      { to: "a@b.c", body: "hi" },
      ctx({ signal: controller.signal }),
    );

    await vi.waitFor(() => expect(asked).toHaveLength(1));
    controller.abort();
    await expect(running).resolves.toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(r.pending()).toHaveLength(0);
  });

  it("does not block on an already-cancelled run", async () => {
    const controller = new AbortController();
    controller.abort();
    const { r } = setup(writeTool());
    await expect(
      r.invoke("send_email", { to: "a@b.c", body: "hi" }, ctx({ signal: controller.signal })),
    ).resolves.toMatchObject({ ok: false, error: { code: "cancelled" } });
  });

  it("runs a local write without asking, but still records it", async () => {
    const { r, asked, local } = setup(writeTool({ name: "brain_write", local: true }));
    await expect(r.invoke("brain_write", { to: "x", body: "y" }, ctx())).resolves.toMatchObject({
      ok: true,
    });
    expect(asked).toHaveLength(0);
    expect(local).toHaveLength(1);
  });

  it("runs without asking when the whitelist allows it", async () => {
    const { r, asked, local } = setup(writeTool(), { whitelist: { allows: () => true } });
    await expect(r.invoke("send_email", { to: "a@b.c", body: "hi" }, ctx())).resolves.toMatchObject(
      { ok: true },
    );
    expect(asked).toHaveLength(0);
    expect(local).toHaveLength(1);
  });

  it("ignores a resolve for an approval nobody is waiting on", () => {
    const { r } = setup(writeTool());
    expect(r.resolve("apr_nothing", "approve", "owner")).toBe(false);
  });
});

describe("invoke: running the handler", () => {
  const setup = (t: Tool, cfg = config()) => {
    const r = new ToolRegistry({ config: cfg });
    r.register(t);
    return r;
  };

  it("reports a handler that throws, keeping its message", async () => {
    const boom = readTool({ run: () => Promise.reject(new Error("the shop is closed")) });
    await expect(setup(boom).invoke("lookup_order", { orderNumber: "1" }, ctx())).resolves.toEqual({
      ok: false,
      error: { code: "handler_error", message: "the shop is closed" },
      durationMs: expect.any(Number),
    });
  });

  it("stops a handler that never returns and says how long it waited", async () => {
    const slow = readTool({ timeoutMs: 20, run: () => new Promise(() => undefined) });
    const result = await setup(slow).invoke("lookup_order", { orderNumber: "1" }, ctx());
    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
    if (!result.ok)
      expect(result.error.message).toBe("lookup_order took longer than 0 s and was stopped.");
  });

  it("copies noteIds off a brain tool's output", async () => {
    const brainTool = readTool({
      name: "brain_search",
      run: () => Promise.resolve({ notes: [], noteIds: ["10-customers/acme"] }),
    });
    const result = await setup(brainTool).invoke("brain_search", { orderNumber: "x" }, ctx());
    expect(result).toMatchObject({ ok: true, noteIds: ["10-customers/acme"] });
  });

  it("leaves noteIds off when the tool returned none", async () => {
    const result = await setup(readTool()).invoke("lookup_order", { orderNumber: "1" }, ctx());
    expect(result.ok && "noteIds" in result).toBe(false);
  });

  it("hands the context to the handler", async () => {
    const seen: string[] = [];
    const t = readTool({ run: (_i, c) => Promise.resolve(seen.push(c.agentId, c.runId)) });
    await setup(t).invoke("lookup_order", { orderNumber: "1" }, ctx());
    expect(seen).toEqual(["copywriter", "run_1"]);
  });
});

describe("buildPreview", () => {
  it("uses the tool's own preview when it has one", () => {
    const t = writeTool({
      preview: () => ({
        action: "Send",
        destination: "a@b.c",
        summary: "s",
        body: "b",
        irreversible: true,
      }),
    });
    expect(buildPreview(t, {}).action).toBe("Send");
  });

  it("assumes irreversible for a tool that wrote none", () => {
    expect(buildPreview(writeTool(), { to: "a@b.c", body: "hi" }).irreversible).toBe(true);
  });

  it("finds the destination from a recipient-shaped key", () => {
    expect(buildPreview(writeTool(), { to: "a@b.c", body: "hi" }).destination).toBe("a@b.c");
  });

  it("falls back to naming the MCP server it would reach", () => {
    const t = writeTool({ source: { kind: "mcp", server: "gmail" } });
    expect(buildPreview(t, { body: "hi" }).destination).toBe("gmail");
  });

  it("shows the whole input, nothing elided", () => {
    const body = buildPreview(writeTool(), { to: "a@b.c", body: "the entire message" }).body;
    expect(body).toContain("the entire message");
    expect(body).not.toContain("...");
  });

  it("marks a destination field editable and other fields not", () => {
    const fields = buildPreview(writeTool(), { to: "a@b.c", body: "hi" }).fields ?? [];
    expect(fields.find((f) => f.name === "to")?.editable).toBe(true);
    expect(fields.find((f) => f.name === "body")?.editable).toBe(false);
  });

  it("humanises the action from the tool name", () => {
    expect(
      buildPreview(
        writeTool({ source: { kind: "mcp", server: "gmail" }, name: "gmail.send_email" }),
        {},
      ).action,
    ).toBe("Send email");
  });

  it("says so when there is no input at all", () => {
    expect(buildPreview(writeTool(), {}).body).toBe("(no input)");
  });
});
