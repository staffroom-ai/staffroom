/**
 * The message types, mirrored from the server.
 *
 * Duplicated rather than imported because the web package must not depend on the
 * server package: the browser bundle would drag in node built-ins. The shapes the
 * office actually renders come from @staffroom/core as types.
 */
import type { ConfigError, OfficeState, RunEventEnvelope } from "@staffroom/core";

export type ClientMessage =
  | { type: "hello"; reqId: string; protocol: 1; token: string; resumeFrom?: number }
  | {
      type: "task.create";
      reqId: string;
      department: string;
      text: string;
      agentId?: string;
      modelOverride?: string;
    }
  | { type: "task.cancel"; reqId: string; runId: string }
  | { type: "chat.send"; reqId: string; agentId: string; text: string; modelOverride?: string }
  | {
      type: "approval.decide";
      reqId: string;
      approvalId: string;
      decision: "approve" | "approve_always" | "deny";
      note?: string;
    }
  | { type: "agent.rename"; reqId: string; agentId: string; name: string }
  | { type: "brain.search"; reqId: string; query: string; limit?: number }
  | { type: "runs.replay"; reqId: string; runId: string }
  | { type: "note.reveal"; reqId: string; noteId: string }
  | { type: "provider.set_key"; reqId: string; provider: string; key: string }
  | { type: "tools.assign"; reqId: string; agentId: string; tool: string }
  | { type: "demo.speed"; reqId: string; factor: 1 | 2 | 4 }
  | { type: "ping"; reqId: string };

export type ServerMessage =
  | {
      type: "welcome";
      reqId: string;
      seq: number;
      protocol: 1;
      version: string;
      mode: "live" | "demo";
      platform: "mac" | "windows" | "linux";
      resumed: boolean;
      state: OfficeState;
    }
  | { type: "ack"; reqId: string; seq: number; ok: true; result?: unknown }
  | { type: "error"; reqId?: string; seq: number; code: string; message: string; hint: string }
  | { type: "state"; seq: number; state: OfficeState }
  | { type: "event"; seq: number; event: RunEventEnvelope }
  | {
      type: "replay";
      reqId: string;
      seq: number;
      runId: string;
      events: RunEventEnvelope[];
      done: boolean;
    }
  | { type: "config.error"; seq: number; errors: ConfigError[] }
  | { type: "config.reloaded"; seq: number; file: string }
  | { type: "tools.reloaded"; seq: number; file: string; ok: boolean; message?: string }
  | { type: "brain.results"; reqId: string; seq: number; hits: unknown[] }
  | { type: "brain.warning"; seq: number; scope: "note"; id: string; reason: string }
  | { type: "pong"; reqId: string; seq: number };
