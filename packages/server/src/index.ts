/**
 * @staffroom/server — the office over HTTP and WebSocket.
 *
 * Binds loopback by default. The three auth checks in auth.ts stay on regardless,
 * because "it is only on my machine" stops being true the moment the owner opens a
 * web page that decides to try port 4242.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Office } from "@staffroom/core";
import { WebSocketServer } from "ws";
import {
  type AuthConfig,
  checkRequest,
  newSessionToken,
  noAccountsWarning,
  TOKEN_META,
} from "./auth.js";
import { boot } from "./boot.js";
import { DEMO_BANNER, setDemoSpeed } from "./demo/demo.js";
import { boundaryOf, firstFilePart } from "./http/multipart.js";
import { resolveBrainPath } from "./http/paths.js";
import { MAX_UPLOAD_BYTES, storeUpload } from "./http/upload.js";
import { say } from "./log.js";
import { Scheduler } from "./scheduler/scheduler.js";
import { OfficeWatchers } from "./watch/index.js";
import { SocketHub } from "./ws/socket.js";

export const VERSION = "0.1.1";

export interface ServerOptions {
  officeDir: string;
  port?: number;
  host?: string;
  open?: boolean;
  demo?: boolean;
  watch?: boolean;
  /** Where demo transcripts live. Defaults to office/.staffroom/demo-runs/. */
  demoRunsDir?: string;
  /** Injected in tests and demo mode. */
  office?: Office;
}

export interface StaffroomServer {
  url: string;
  port: number;
  token: string;
  office: Office;
  hub: SocketHub;
  /** Demo playback speed, from the office's speed control. */
  setDemoSpeed(factor: 1 | 2 | 4): boolean;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
};

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "./public");

function send(
  response: ServerResponse,
  status: number,
  body: string,
  type = "application/json; charset=utf-8",
): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

/** The token travels in the page, not the URL bar, so it stays out of history. */
function servePage(response: ServerResponse, token: string): void {
  const indexPath = join(publicDir, "index.html");
  const html = existsSync(indexPath)
    ? readFileSync(indexPath, "utf8")
    : '<!doctype html><html><head></head><body><div id="root"></div></body></html>';
  const withToken = html.replace(
    "</head>",
    `<meta name="${TOKEN_META}" content="${token}"></head>`,
  );
  send(response, 200, withToken, "text/html; charset=utf-8");
}

/** A plain page for the browser tab the owner is sent back to. */
function oauthPage(message: string): string {
  const safe = message.replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;",
  );
  return `<!doctype html><meta charset="utf-8"><title>Staffroom</title><body style="font:16px/1.5 system-ui;margin:3rem auto;max-width:34rem;color:#12171d"><p>${safe}</p></body>`;
}

export async function createServer(options: ServerOptions): Promise<StaffroomServer> {
  const host = options.host ?? "127.0.0.1";
  const booted =
    options.office === undefined
      ? await boot({
          officeDir: options.officeDir,
          ...(options.demo === undefined ? {} : { demo: options.demo }),
          ...(options.demoRunsDir === undefined ? {} : { demoRunsDir: options.demoRunsDir }),
        })
      : { office: options.office, notices: [] };
  const office = booted.office;
  const token = newSessionToken();
  const startedAt = Date.now();

  /**
   * The whole body, refusing anything over the cap while it arrives.
   *
   * Checked as it streams rather than after: a caller who ignores the limit
   * should not be able to make the office hold their file in memory first.
   */
  const readBody = (request: IncomingMessage, limit: number): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          request.destroy();
          reject(new Error("too large"));
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => resolve(Buffer.concat(chunks)));
      request.on("error", reject);
    });

  const http: Server = createHttpServer((request, response) => {
    void handleRequest(request, response);
  });

  let authConfig: AuthConfig = { token, host, port: options.port ?? 4242 };

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const isWrite = request.method !== undefined && request.method !== "GET";

    const auth = checkRequest(request, authConfig, { requireToken: isWrite });
    if (!auth.ok) {
      send(response, 403, JSON.stringify({ error: "forbidden" }));
      return;
    }

    if (url.pathname === "/api/health") {
      send(
        response,
        200,
        JSON.stringify({
          ok: true,
          version: VERSION,
          mode: office.mode,
          office: office.roster.officeName,
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        }),
      );
      return;
    }

    // Where an OAuth provider sends the owner's browser back after they sign in
    // to an MCP server. It carries no session token, because the redirect comes
    // from somebody else's site, so the `state` is the only proof that this
    // callback belongs to a sign-in the office actually started.
    if (url.pathname === "/api/mcp/oauth/callback") {
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      const failure = url.searchParams.get("error");

      if (failure !== null) {
        send(response, 400, oauthPage(`The server refused the sign-in: ${failure}`), "text/html");
        return;
      }

      const claimed = state === "" ? undefined : office.mcp.pending.claim(state);
      if (claimed === undefined || code === "") {
        // Nothing is stored and nothing is retried: an unrecognised state is
        // either a stale tab or somebody else's redirect.
        send(
          response,
          400,
          oauthPage("That sign-in link is not one this office is waiting for."),
          "text/html",
        );
        return;
      }

      void office.mcp
        .finishOAuth(claimed.server, code)
        .then(() => undefined)
        .catch(() => undefined);

      send(
        response,
        200,
        oauthPage(`Signed in to ${claimed.server}. You can close this tab.`),
        "text/html",
      );
      return;
    }

    /*
     * SR-061: adding a file to the brain from the browser.
     *
     * The only route that writes a file the owner did not type. checkRequest has
     * already refused anything that is not a same-origin POST carrying the
     * session token; upload.ts decides everything else, and lands it in
     * brain/inbox/ where it is indexed at half weight and never pinned.
     */
    if (url.pathname === "/api/brain/upload") {
      if (request.method !== "POST") {
        send(response, 405, JSON.stringify({ error: "post a file here" }));
        return;
      }

      const boundary = boundaryOf(request.headers["content-type"]);
      if (boundary === undefined) {
        send(response, 400, JSON.stringify({ error: "send the file as multipart/form-data" }));
        return;
      }

      let body: Buffer;
      try {
        body = await readBody(request, MAX_UPLOAD_BYTES);
      } catch {
        send(
          response,
          413,
          JSON.stringify({ error: `files are limited to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB` }),
        );
        return;
      }

      const part = firstFilePart(body, boundary);
      if (part === undefined) {
        send(response, 400, JSON.stringify({ error: "no file was attached" }));
        return;
      }

      const brainDir = join(options.officeDir, office.config.brain.dir);
      const stored = storeUpload(brainDir, part);
      if (!stored.ok) {
        send(response, stored.status, JSON.stringify({ error: stored.error }));
        return;
      }

      // Indexed here rather than left to the watcher, so the answer to the
      // upload is true by the time the browser reads it, with or without one.
      office.brain.reindexFile(stored.path);
      hub.broadcastNoteIndexed(stored.noteId);

      send(response, 201, JSON.stringify({ ok: true, noteId: stored.noteId, name: stored.name }));
      return;
    }

    if (url.pathname === "/api/brain/file") {
      const brainDir = join(options.officeDir, office.config.brain.dir);
      const target = resolveBrainPath(brainDir, url.searchParams.get("path") ?? "");
      // Every way of asking for something outside brain/ gets the same answer, so
      // nothing can be learned by trying them.
      if (target === undefined || !existsSync(target)) {
        send(response, 404, JSON.stringify({ error: "not found" }));
        return;
      }
      response.writeHead(200, {
        "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
        "content-length": statSync(target).size,
        "cache-control": "no-store",
      });
      createReadStream(target).pipe(response);
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      servePage(response, token);
      return;
    }

    // Static assets, path-checked the same way as the brain.
    const asset = resolveStatic(url.pathname);
    if (asset !== undefined) {
      response.writeHead(200, {
        "content-type": MIME[extname(asset).toLowerCase()] ?? "application/octet-stream",
      });
      createReadStream(asset).pipe(response);
      return;
    }

    send(response, 404, JSON.stringify({ error: "not found" }));
  };

  const wss = new WebSocketServer({ noServer: true });
  const hub = new SocketHub({ office, token, version: VERSION });
  hub.attach(wss);

  http.on("upgrade", (request, socket, head) => {
    const auth = checkRequest(request, authConfig);
    if (!auth.ok || new URL(request.url ?? "/", "http://x").pathname !== "/ws") {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  const port = await listen(http, options.port ?? 4242, host);
  authConfig = { token, host, port };

  // Watching is on unless asked otherwise: an owner editing agents.yaml expects
  // the office to notice without a restart.
  /*
   * SR-063: the routines, ticking.
   *
   * Only when the office is watching. An office opened with --no-watch is
   * somebody inspecting a folder, and starting unattended work in it — sending
   * email, writing notes — because they looked at it is not something to do
   * quietly.
   */
  let scheduler: Scheduler | undefined;
  if (options.watch !== false && options.office === undefined) {
    scheduler = new Scheduler({
      officeDir: options.officeDir,
      office,
      onNotice: (message) => hub.broadcastRoutineNotice(message),
    });
    hub.useScheduler(scheduler);
    scheduler.start();
    // Straight away as well as on the tick, so a laptop opened after a week
    // does not wait thirty seconds to notice.
    void scheduler.tick();
  }

  let watchers: OfficeWatchers | undefined;
  if (options.watch !== false && options.office === undefined) {
    watchers = new OfficeWatchers({
      officeDir: options.officeDir,
      office,
      onEvent: (event) => {
        if (event.type === "config.reloaded") hub.broadcastConfigReloaded(event.file);
        else if (event.type === "config.error") hub.broadcastConfigError(event.errors);
        else if (event.type === "tools.reloaded") hub.broadcastToolsReloaded(event);
        // SR-061: a note the owner wrote in Obsidian appears in the graph
        // without a reload, and one they deleted takes its arrows with it.
        else if (event.type === "brain.changed") {
          if (event.removed) hub.broadcastNoteRemoved(event.noteId);
          else hub.broadcastNoteIndexed(event.noteId);
        } else hub.scheduleState();
      },
    });
    watchers.start();
  }

  if (office.mode === "demo") say(DEMO_BANNER);

  if (options.host !== undefined && options.host !== "127.0.0.1") {
    say(noAccountsWarning(host, port));
  }

  return {
    url: `http://${host}:${port}/?t=${token}`,
    port,
    token,
    office,
    hub,
    setDemoSpeed: (factor: 1 | 2 | 4) => setDemoSpeed(office.providers, factor),
    close: async () => {
      // Stopped first, then drained: no new routine starts while the office is
      // closing, and one already running is not cut in half.
      scheduler?.stop();
      await scheduler?.drain();
      await watchers?.close();
      hub.close();
      wss.close();
      await new Promise<void>((done) => http.close(() => done()));
      if (options.office === undefined) office.close();
    },
  };
}

function resolveStatic(pathname: string): string | undefined {
  if (pathname.includes("..") || pathname.includes("\0")) return undefined;
  const target = join(publicDir, pathname.replace(/^\//, ""));
  if (!target.startsWith(publicDir)) return undefined;
  return existsSync(target) && statSync(target).isFile() ? target : undefined;
}

/** Tries the asked-for port, then the next ten, so two offices can coexist. */
async function listen(server: Server, wanted: number, host: string): Promise<number> {
  for (let port = wanted; port <= wanted + 10; port++) {
    try {
      return await new Promise<number>((done, fail) => {
        const onError = (error: NodeJS.ErrnoException): void => {
          server.removeListener("error", onError);
          fail(error);
        };
        server.once("error", onError);
        server.listen(port === 0 ? 0 : port, host, () => {
          server.removeListener("error", onError);
          const address = server.address();
          done(typeof address === "object" && address !== null ? address.port : port);
        });
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(
    `Ports ${wanted} to ${wanted + 10} are all in use. Close whatever is using them, or start with --port.`,
  );
}

export { checkRequest, newSessionToken } from "./auth.js";
export { boot, checkNodeVersion } from "./boot.js";
export {
  DEMO_BANNER,
  demoAdapters,
  findDemoRuns,
  NO_TRANSCRIPTS,
  officeDemoRuns,
  shouldUseDemo,
} from "./demo/demo.js";
export type { DoctorCheck, DoctorOptions, DoctorResult, DoctorStatus } from "./doctor/index.js";
export { GITIGNORE_LINES, runDoctor } from "./doctor/index.js";
export { resolveBrainPath } from "./http/paths.js";
export type { LogLine } from "./log.js";
export { say, setLogSink } from "./log.js";
export type { WatchEvent } from "./watch/index.js";
export { OfficeWatchers } from "./watch/index.js";
export { splitRevise } from "./ws/handlers.js";
export type { ClientMessage, ServerMessage } from "./ws/protocol.js";
export { SocketHub } from "./ws/socket.js";
export { buildOfficeState, collectState } from "./ws/state.js";
