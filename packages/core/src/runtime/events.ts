/**
 * What a run is, and everything that can happen during one.
 *
 * Events are the record; the `runs` row is a cache of the latest state that could
 * be rebuilt from them. That ordering is what lets the office replay a run after a
 * refresh, and lets a restart resume one.
 */

import type { ModelId, ModelSource } from "../providers/resolve.js";
import type { ToolCall, Usage } from "../providers/types.js";
import type { ApprovalBy, ApprovalDecision, ApprovalPreview, ToolSource } from "../shared/types.js";
import type { UserFacingError } from "./errors.js";

export type RunKind = "task" | "route" | "chat" | "revise" | "routine";
export type RunStatus = "queued" | "running" | "waiting_approval" | "done" | "failed";

export interface Run {
  id: string;
  kind: RunKind;
  agentId: string;
  department: string;
  model: ModelId;
  /** What the owner typed, or the brief the lead wrote when routing. */
  prompt: string;
  parentRunId: string | null;
  routineId: string | null;
  /** True for runs shipped inside a template, so demo content is distinguishable. */
  sample: boolean;
  status: RunStatus;
  createdAt: number;
  finishedAt: number | null;
  usage: Usage;
  costUsd: number | null;
}

export interface Deliverable {
  /** The first "# " heading of the final text, else its first 60 characters. */
  title: string;
  text: string;
  /** Set once the note is written. Null on route runs, which produce no deliverable. */
  noteId: string | null;
}

export type RunEvent =
  | {
      type: "started";
      agentId: string;
      kind: RunKind;
      model: ModelId;
      modelSource: ModelSource;
      prompt: string;
      parentRunId: string | null;
      routineId: string | null;
      systemPromptHash: string;
      toolNames: string[];
    }
  | { type: "routed"; toAgentId: string; childRunId: string; brief: string }
  | { type: "chunk"; turn: number; attempt: number; text: string }
  | {
      type: "tool_call";
      turn: number;
      call: ToolCall;
      scope: "read" | "write";
      egress: boolean;
      inputChars: number;
      group: string;
    }
  | {
      type: "tool_result";
      toolCallId: string;
      name: string;
      output: string;
      isError: boolean;
      durationMs: number;
      truncated: boolean;
      redactedCount: number;
      noteIds?: string[];
    }
  | { type: "tool_log"; toolCallId: string; msg: string; data?: Record<string, unknown> }
  | {
      type: "approval_needed";
      approvalId: string;
      toolCallId: string;
      tool: { name: string; source: ToolSource; scope: "write" };
      input: unknown;
      preview: ApprovalPreview;
      requestedAt: number;
      expiresAt: number;
    }
  | {
      type: "approval_resolved";
      approvalId: string;
      decision: ApprovalDecision;
      by: ApprovalBy;
      note?: string;
    }
  | { type: "brain_pinned_included"; noteIds: string[] }
  | { type: "brain_pinned_truncated"; noteIds: string[] }
  | { type: "brain_note_written"; noteId: string; revises?: string; status: "draft" }
  | {
      type: "done";
      deliverable: Deliverable;
      usage: Usage;
      costUsd: number | null;
      toolsUsed: string[];
      turns: number;
    }
  | { type: "failed"; error: UserFacingError; partialText: string | null; turns: number };

export type RunEventType = RunEvent["type"];

export interface RunEventEnvelope {
  seq: number;
  runId: string;
  at: number;
  event: RunEvent;
}

export type PendingApproval = Extract<RunEvent, { type: "approval_needed" }> & { runId: string };

export interface RunListFilter {
  status?: RunStatus[];
  kind?: RunKind[];
  agentId?: string;
  limit?: number;
}

export interface RunStore {
  create(run: Omit<Run, "status" | "finishedAt" | "usage" | "costUsd">): Promise<Run>;
  /** `at` is only for replaying history; leave it out for anything happening now. */
  append(runId: string, event: RunEvent, at?: number): Promise<RunEventEnvelope>;
  events(runId: string): AsyncIterable<RunEventEnvelope>;
  since(seq: number): AsyncIterable<RunEventEnvelope>;
  get(runId: string): Promise<Run | null>;
  list(filter: RunListFilter): Promise<Run[]>;
  lastDeliverable(agentId: string): Promise<{ run: Run; deliverable: Deliverable } | null>;
  pendingApprovals(): Promise<PendingApproval[]>;
  subscribe(fn: (e: RunEventEnvelope) => void): () => void;
  close(): void;
}

/** The title shown on a deliverable card. */
export function deliverableTitle(text: string): string {
  const heading = text.split("\n").find((line) => line.startsWith("# "));
  if (heading !== undefined) return heading.slice(2).trim();
  const firstLine = text.trim().split("\n")[0] ?? "";
  return firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 60).trimEnd()}...`;
}
