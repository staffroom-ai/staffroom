/**
 * `doctor.run` over the socket, and `models.list` next to it.
 *
 * The acceptance case is that the browser and the terminal give the same
 * answer: `doctor.run` returns the same `checks` array as
 * `npx staffroom doctor --json` on the same office. Two ways of producing an
 * answer is two ways for the answers to diverge, and the one somebody trusts is
 * whichever they looked at last.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { runDoctor } from "../doctor/index.js";
import { createServer, type StaffroomServer } from "../index.js";
import type { ServerMessage } from "./protocol.js";

const servers: StaffroomServer[] = [];
const sockets: WebSocket[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A tab, recording everything the office pushed to it. */
class Client {
  readonly received: ServerMessage[] = [];
  private constructor(readonly socket: WebSocket) {}

  static async open(server: StaffroomServer): Promise<Client> {
    const origin = `http://127.0.0.1:${server.port}`;
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      headers: { origin, host: `127.0.0.1:${server.port}` },
    });
    sockets.push(socket);
    const client = new Client(socket);
    socket.on("message", (raw: Buffer) =>
      client.received.push(JSON.parse(raw.toString()) as ServerMessage),
    );
    await new Promise<void>((done, fail) => {
      socket.once("open", () => done());
      socket.once("error", fail);
    });
    client.send({ type: "hello", reqId: "hello", protocol: 1, token: server.token });
    await client.waitFor("welcome");
    return client;
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Send, then wait for the reply that carries the same reqId. */
  async request(message: { reqId: string } & Record<string, unknown>, type: ServerMessage["type"]) {
    this.send(message);
    return this.waitFor(type, (m) => (m as { reqId?: string }).reqId === message.reqId);
  }

  async waitFor<T extends ServerMessage["type"]>(
    type: T,
    match: (m: ServerMessage) => boolean = () => true,
    timeoutMs = 15_000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const started = Date.now();
    for (;;) {
      const found = this.received.find((m) => m.type === type && match(m));
      if (found !== undefined) return found as Extract<ServerMessage, { type: T }>;
      if (Date.now() - started > timeoutMs) {
        throw new Error(
          `no ${type} after ${timeoutMs}ms; saw ${this.received.map((m) => m.type).join(", ")}`,
        );
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

async function office(): Promise<{ server: StaffroomServer; dir: string; client: Client }> {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-doctor-ws-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  const server = await createServer({
    officeDir: dir,
    port: 0,
    watch: false,
    demoRunsDir: join(templateDir("studio"), "demo-runs"),
  });
  servers.push(server);
  const client = await Client.open(server);
  return { server, dir, client };
}

describe("doctor.run", () => {
  it("returns the same checks as the terminal command on the same office", async () => {
    const { dir, client } = await office();

    const reply = (await client.request({ type: "doctor.run", reqId: "d1" }, "doctor.result")) as {
      checks: { id: string; status: string; message: string }[];
      ok: boolean;
    };
    const terminal = await runDoctor({ officeDir: dir });

    // Ids and statuses, not the whole objects: a message can name a port or a
    // free-disk figure that moved between the two calls, and the acceptance
    // case is about the two surfaces agreeing on what was checked and how it
    // came out — not about two readings of the same disk being byte-identical.
    expect(reply.checks.map((c) => c.id)).toEqual(terminal.checks.map((c) => c.id));
    expect(reply.checks.map((c) => c.status)).toEqual(terminal.checks.map((c) => c.status));
    expect(reply.ok).toBe(terminal.ok);
  });

  it("gives every check an id, a status and something to read", async () => {
    const { client } = await office();
    const reply = (await client.request({ type: "doctor.run", reqId: "d1" }, "doctor.result")) as {
      checks: { id: string; status: string; message: string }[];
    };

    expect(reply.checks.length).toBeGreaterThan(5);
    for (const check of reply.checks) {
      expect(check.id.length).toBeGreaterThan(0);
      expect(["ok", "warn", "fail"]).toContain(check.status);
      expect(check.message.length).toBeGreaterThan(0);
    }
  });

  it("answers the tab that asked, with its own reqId", async () => {
    const { client } = await office();
    const reply = (await client.request(
      { type: "doctor.run", reqId: "mine" },
      "doctor.result",
    )) as { reqId: string };
    expect(reply.reqId).toBe("mine");
  });
});

describe("models.list", () => {
  it("answers with a row per configured provider, never a short list", async () => {
    // A demo office has only the demo adapter, which is not a choice anybody
    // makes, so the answer here is an empty list rather than a fake row.
    const { client } = await office();
    const reply = (await client.request({ type: "models.list", reqId: "m1" }, "models.result")) as {
      providers: { id: string }[];
    };

    expect(Array.isArray(reply.providers)).toBe(true);
    expect(reply.providers.map((p) => p.id)).not.toContain("demo");
  });
});
