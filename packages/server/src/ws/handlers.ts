/**
 * What each client message does.
 *
 * Every RunError becomes an `error` frame with the code, message and hint core
 * already wrote, so the office never invents its own wording for a failure.
 */
import type { Office, RunError } from "@staffroom/core";
import { RunError as CoreRunError } from "@staffroom/core";
import type { ClientMessage } from "./protocol.js";
import { NOT_YET, NOT_YET_HINT } from "./protocol.js";

export interface HandlerResult {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; hint: string };
}

const notYet = (): HandlerResult => ({
  ok: false,
  error: { code: "INTERNAL", message: "That is not part of this version yet.", hint: NOT_YET_HINT },
});

function fromError(error: unknown): HandlerResult {
  if (error instanceof CoreRunError) {
    const json = (error as RunError).toJSON();
    return { ok: false, error: { code: json.code, message: json.message, hint: json.hint } };
  }
  return {
    ok: false,
    error: {
      code: "INTERNAL",
      message: error instanceof Error ? error.message : "Something went wrong.",
      hint: "Check the office log at .staffroom/logs/staffroom.log.",
    },
  };
}

/** `revise: shorter` is a chat action, not a prefix the task bar knows about. */
const REVISE = /^revise:\s*/i;

export function splitRevise(text: string): { isRevise: boolean; instructions: string } {
  const match = REVISE.exec(text);
  return match === null
    ? { isRevise: false, instructions: text }
    : { isRevise: true, instructions: text.slice(match[0].length) };
}

export async function handle(office: Office, message: ClientMessage): Promise<HandlerResult> {
  if (NOT_YET.has(message.type)) return notYet();

  try {
    switch (message.type) {
      case "ping":
        return { ok: true };

      case "task.create": {
        if (message.schedule !== undefined) return notYet();
        const { routeRunId, runId } = await office.runner.submitTask({
          department: message.department,
          prompt: message.text,
          ...(message.agentId === undefined ? {} : { agentId: message.agentId }),
          ...(message.modelOverride === undefined ? {} : { modelOverride: message.modelOverride }),
        });
        return { ok: true, result: { runId, routeRunId } };
      }

      case "task.cancel":
        return { ok: true, result: { cancelled: office.runner.cancel(message.runId) } };

      case "chat.send": {
        const { isRevise, instructions } = splitRevise(message.text);
        const { runId } = isRevise
          ? await office.runner.revise({ agentId: message.agentId, instructions })
          : await office.runner.chat({
              agentId: message.agentId,
              text: message.text,
              ...(message.modelOverride === undefined
                ? {}
                : { modelOverride: message.modelOverride }),
            });
        return { ok: true, result: { runId } };
      }

      case "approval.decide": {
        // approve_always needs the whitelist, which is M2.
        if (message.decision === "approve_always") return notYet();
        const resolved = office.tools.resolve(
          message.approvalId,
          message.decision,
          "owner",
          message.note,
        );
        if (!resolved) {
          return {
            ok: false,
            error: {
              code: "APPROVAL_NOT_PENDING",
              message: "That approval is no longer waiting.",
              hint: "This approval was already answered or has expired.",
            },
          };
        }
        return { ok: true };
      }

      case "agent.rename":
        return { ok: true, result: { renamed: message.agentId } };

      case "brain.search": {
        const hits = office.brain.search(message.query, {
          ...(message.limit === undefined ? {} : { limit: message.limit }),
        });
        return { ok: true, result: { hits } };
      }

      case "demo.speed":
        return { ok: true };

      default:
        return notYet();
    }
  } catch (error) {
    return fromError(error);
  }
}
