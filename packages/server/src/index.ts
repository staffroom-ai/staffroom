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
import { resolveBrainPath } from "./http/paths.js";
import { say } from "./log.js";
import { OfficeWatchers } from "./watch/index.js";
import { SocketHub } from "./ws/socket.js";

export const VERSION = "0.0.1";

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
  let watchers: OfficeWatchers | undefined;
  if (options.watch !== false && options.office === undefined) {
    watchers = new OfficeWatchers({
      officeDir: options.officeDir,
      office,
      onEvent: (event) => {
        if (event.type === "config.reloaded") hub.broadcastConfigReloaded(event.file);
        else if (event.type === "config.error") hub.broadcastConfigError(event.errors);
        else if (event.type === "tools.reloaded")
          hub.broadcastToolsReloaded(event.file, event.ok, event.message, event.tools);
        else hub.scheduleState();
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
