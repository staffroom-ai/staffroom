/**
 * The connection to the office.
 *
 * Reconnects on its own, because a laptop lid closing should not mean a reload.
 * On the way back it says the last sequence number it saw, so the office sends
 * only what was missed rather than a fresh world.
 */
import type { ClientMessage, ServerMessage } from "./protocol.js";

export type Connection = "connecting" | "open" | "reconnecting" | "stopped";

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8000;
/** After this long without a connection we stop trying and say so. */
const GIVE_UP_MS = 10_000;
const TOKEN_KEY = "staffroom-token";

/**
 * The token comes from the page the office served. `?t=` is the fallback for a
 * link the owner pasted; it is moved into sessionStorage and out of the URL so it
 * does not sit in browser history.
 */
export function readToken(
  doc: Document = document,
  url: string = window.location.href,
): string | undefined {
  const fromMeta = doc.querySelector<HTMLMetaElement>('meta[name="staffroom-token"]')?.content;
  if (fromMeta !== undefined && fromMeta.length > 0) return fromMeta;

  const fromQuery = new URL(url).searchParams.get("t");
  if (fromQuery !== null && fromQuery.length > 0) {
    try {
      sessionStorage.setItem(TOKEN_KEY, fromQuery);
    } catch {
      // Private browsing; the token still works for this page load.
    }
    return fromQuery;
  }

  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function backoffFor(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempt - 1));
}

export interface SocketOptions {
  url: string;
  token: string;
  onMessage: (message: ServerMessage) => void;
  onConnection: (state: Connection) => void;
  /** Injected in tests. */
  create?: (url: string) => WebSocket;
  now?: () => number;
}

export class OfficeSocket {
  private socket: WebSocket | undefined;
  private attempt = 0;
  private lastSeq = 0;
  private firstFailureAt: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private readonly options: SocketOptions;

  constructor(options: SocketOptions) {
    this.options = options;
  }

  connect(): void {
    if (this.closed) return;
    this.options.onConnection(this.attempt === 0 ? "connecting" : "reconnecting");

    const create = this.options.create ?? ((url: string) => new WebSocket(url));
    const socket = create(this.options.url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.firstFailureAt = undefined;
      this.options.onConnection("open");
      this.send({
        type: "hello",
        reqId: "hello",
        protocol: 1,
        token: this.options.token,
        // Zero means "everything"; the office treats it as a first connection.
        ...(this.lastSeq > 0 ? { resumeFrom: this.lastSeq } : {}),
      });
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      if (typeof message.seq === "number" && message.seq > this.lastSeq) this.lastSeq = message.seq;
      this.options.onMessage(message);
    };

    socket.onclose = () => this.scheduleReconnect();
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const now = (this.options.now ?? Date.now)();
    this.firstFailureAt ??= now;

    // Stop rather than retrying forever: a tab that cannot reach the office should
    // say so, not sit there looking live.
    if (now - this.firstFailureAt > GIVE_UP_MS) {
      this.options.onConnection("stopped");
      return;
    }

    this.attempt++;
    this.options.onConnection("reconnecting");
    this.timer = setTimeout(() => this.connect(), backoffFor(this.attempt));
  }

  send(message: ClientMessage): boolean {
    if (this.socket === undefined || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** Used by the store when the owner asks to reconnect after giving up. */
  retryNow(): void {
    this.firstFailureAt = undefined;
    this.attempt = 0;
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.socket?.close();
  }

  get sequence(): number {
    return this.lastSeq;
  }
}
