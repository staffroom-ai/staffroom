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
        // "Always allow" has to say what it is allowing. Without a match it means
        // "any input to this tool from now on", which is almost never what
        // somebody clicking a button on one message intends.
        if (message.decision === "approve_always" && message.match === undefined) {
          return {
            ok: false,
            error: {
              code: "MATCH_REQUIRED",
              message: "Say what to always allow.",
              hint: "Allow it for a specific recipient, or approve this one call instead.",
            },
          };
        }

        const resolved = office.tools.resolve(
          message.approvalId,
          message.decision,
          "owner",
          message.note,
          message.decision === "approve_always" && message.match !== undefined
            ? { match: message.match }
            : undefined,
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

      // SR-055: a connector the owner has fixed — a key pasted, a server
      // restarted — should come back without restarting the whole office.
      case "mcp.reconnect": {
        if (!(message.server in office.config.mcp.servers)) {
          return {
            ok: false,
            error: {
              code: "INTERNAL",
              message: `There is no MCP server called ${message.server}.`,
              hint: "Check the name against office/config.yaml.",
            },
          };
        }
        await office.mcp.reconnect(message.server);
        return { ok: true };
      }

      // SR-057: the Connect button behind an "needs you to sign in" connector.
      //
      // The office cannot open a browser tab, and should not try: the owner is
      // already looking at one. The authorisation URL is handed back and the page
      // opens it, which also keeps the sign-in on the owner's own click rather
      // than on something the office decided to do to them.
      case "mcp.oauth.begin": {
        const begun = await office.mcp.beginOAuth(message.server);
        if (!begun.ok) {
          return {
            ok: false,
            error: {
              code: "INTERNAL",
              message: begun.message,
              hint: `Check the entry for ${message.server} in office/config.yaml.`,
            },
          };
        }
        return { ok: true, result: { url: begun.url } };
      }

      // SR-043: the office writes the name into agents.yaml through the document
      // API, so the owner's comments and formatting survive being renamed.
      case "agent.rename": {
        const renamed = office.renameAgent?.(message.agentId, message.name);
        if (renamed !== true) {
          return {
            ok: false,
            error: {
              code: "AGENT_FIELD_MISSING",
              message: `There is nobody called ${message.agentId} in this office.`,
              hint: "Check office/agents.yaml.",
            },
          };
        }
        return { ok: true, result: { agentId: message.agentId, name: message.name } };
      }

      // SR-043: a key typed into Settings goes to office/.env and never into
      // config.yaml, never into a log, and never back down the socket.
      case "provider.set_key": {
        const stored = office.setProviderKey?.(message.provider, message.key);
        if (stored !== true) {
          return {
            ok: false,
            error: {
              code: "PROVIDER_KIND_UNKNOWN",
              message: `Staffroom does not know a provider called ${message.provider}.`,
              hint: "Try anthropic, openai or ollama.",
            },
          };
        }
        // Deliberately no echo: the key must not travel back to the browser.
        return { ok: true, result: { provider: message.provider, stored: true } };
      }

      // SR-058: which agents may use a tool, without editing YAML by hand.
      /*
       * SR-058: the answer to "New tool x is ready. Who may use it?"
       *
       * Several agents at once, because that is the question the card asks. An
       * id that already has the tool is not a failure — the row is already how
       * the owner wants it — so only an id that could not be written at all
       * stops this. Reporting those by name matters: silently assigning three of
       * four and answering ok would leave somebody wondering why one of their
       * staff still cannot use it.
       */
      case "tools.assign": {
        if (message.agentIds.length === 0) {
          return {
            ok: false,
            error: {
              code: "AGENT_TOOL_UNKNOWN",
              message: "Nobody was chosen, so nothing was given out.",
              hint: "Tick at least one person on the card.",
            },
          };
        }

        const has = (agentId: string): boolean =>
          office.agentsFile.agents.some(
            (agent) => agent.id === agentId && agent.tools.includes(message.name),
          );

        const failed: string[] = [];
        for (const agentId of message.agentIds) {
          // Nothing was written when they already had it, which is not a
          // failure: the row is already what the owner is asking for.
          if (office.assignTool?.(agentId, message.name) !== true && !has(agentId)) {
            failed.push(agentId);
          }
        }

        if (failed.length === message.agentIds.length) {
          return {
            ok: false,
            error: {
              code: "AGENT_TOOL_UNKNOWN",
              message: `Could not give ${message.name} to ${failed.join(", ")}.`,
              hint: "Check the tool name in office/tools/ or config.yaml mcp.servers.",
            },
          };
        }

        return {
          ok: true,
          result: {
            name: message.name,
            assigned: message.agentIds.filter((id) => !failed.includes(id)),
            ...(failed.length === 0 ? {} : { failed }),
          },
        };
      }

      // SR-043: shows the note in Finder or Explorer, so the owner can see that
      // their deliverables are ordinary files they own.
      case "note.reveal": {
        const revealed = office.revealNote?.(message.noteId, message.app);
        return revealed === true
          ? { ok: true, result: { noteId: message.noteId } }
          : {
              ok: false,
              error: {
                code: "INTERNAL",
                message: "Could not open that note on this computer.",
                hint: "Open office/brain in your file manager instead.",
              },
            };
      }

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
