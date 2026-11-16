/**
 * What each client message does.
 *
 * Every RunError becomes an `error` frame with the code, message and hint core
 * already wrote, so the office never invents its own wording for a failure.
 */
import type { EditResult, Office, RunError } from "@staffroom/core";
import { RunError as CoreRunError } from "@staffroom/core";
import { leaveDemo } from "../demo/leave.js";
import { idFromLabel, RoutineSchema, removeRoutine, upsertRoutine } from "../scheduler/routines.js";
import type { SampleAnswer, Scheduler } from "../scheduler/scheduler.js";
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

/**
 * The scheduler, when the office has one.
 *
 * Optional because an office started with `watch: false` in a test has no
 * scheduler and should still answer everything else. A routine message without
 * one says so rather than pretending it worked.
 */
export interface Handlers {
  scheduler?: Scheduler | undefined;
  /** SR-066: present only while the sample-content question is open. */
  samples?:
    | {
        brainDir: string;
        /** Writes the answer down and stops the office asking again. */
        record(answer: SampleAnswer): void;
      }
    | undefined;
}

/**
 * Is this a model some configured provider could actually run?
 *
 * The provider half is checked, not the model half. Asking the provider would
 * mean a network call on every save, and a provider that is briefly unreachable
 * would refuse a model the owner picked from its own list a second earlier.
 */
/**
 * Turns a roster edit's result into an answer for the browser.
 *
 * A refusal is an ack with the writer's own sentence, not a stack trace and not
 * a generic "could not write". These are forms, and the person filling one in
 * can do something about "there is already somebody with the id bookkeeper".
 *
 * `undefined` means an office that does not implement the edit — a test double,
 * or a version that predates it — which is worth saying plainly rather than
 * reading as success.
 */
function rosterEdit(result: EditResult | undefined, extra: Record<string, string>): HandlerResult {
  if (result === undefined) {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: "This office cannot edit its roster.",
        hint: "Edit office/agents.yaml by hand.",
      },
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: "AGENT_FIELD_MISSING",
        message: result.reason,
        hint: "Change it and try again.",
      },
    };
  }
  return { ok: true, result: extra };
}

function canRun(office: Office, model: string): boolean {
  const provider = model.split("/")[0] ?? "";
  return provider.length > 0 && office.providers.has(provider);
}

const noScheduler = (): HandlerResult => ({
  ok: false,
  error: {
    code: "INTERNAL",
    message: "This office is not running routines.",
    hint: "Routines need the office started normally, not with --no-watch.",
  },
});

export async function handle(
  office: Office,
  message: ClientMessage,
  deps: Handlers = {},
): Promise<HandlerResult> {
  if (NOT_YET.has(message.type)) return notYet();

  try {
    switch (message.type) {
      case "ping":
        return { ok: true };

      case "task.create": {
        /*
         * SR-063: "do it" and "do it every morning" are one control.
         *
         * The schedule popover sends the same message with a `schedule`, and
         * the office turns it into a routine rather than making the owner learn
         * a second concept. Nothing runs now: they asked for a schedule.
         */
        if (message.schedule !== undefined) {
          const scheduler = deps.scheduler;
          if (scheduler === undefined) return noScheduler();

          const agentId = message.agentId ?? office.roster.leadFor(message.department)?.id;
          if (agentId === undefined) {
            return {
              ok: false,
              error: {
                code: "BAD_ROUTING",
                message: `There is nobody in ${message.department} to give this to.`,
                hint: "Check office/agents.yaml.",
              },
            };
          }

          const schedule = message.schedule;
          const label = schedule.label ?? message.text.slice(0, 80);
          const taken = new Set(scheduler.list().map((r) => r.id));

          const routine = RoutineSchema.parse({
            id: idFromLabel(label, taken),
            label,
            agent: agentId,
            task: message.text,
            cadence: schedule.cadence,
            time: schedule.time,
            ...(schedule.weekday === undefined ? {} : { weekday: schedule.weekday }),
            ...(schedule.day === undefined ? {} : { day: schedule.day }),
            ...(schedule.approvalRequired === undefined
              ? {}
              : { approval_before_send: schedule.approvalRequired }),
          });

          scheduler.save(upsertRoutine(scheduler.list(), routine));
          return { ok: true, result: { routineId: routine.id, scheduled: true } };
        }

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

      /*
       * SR-066: yes or no to Northlight Studio.
       *
       * The answer is recorded either way and before anything is reported, so
       * an office that crashes halfway through the move does not come back and
       * ask again. Being asked twice is worse than a handful of sample notes
       * left in an archive folder nobody reads.
       */
      case "demo.samples": {
        const samples = deps.samples;
        if (samples === undefined) {
          // Already answered, or never asked. Not an error: two tabs are both
          // showing the card, and the second click should be a quiet no-op
          // rather than a red banner about something that already happened.
          return { ok: true, result: { removed: 0, kept: true } };
        }

        if (!message.remove) {
          samples.record("kept");
          return { ok: true, result: { notesMoved: 0, runsDeleted: 0, kept: true } };
        }

        const result = await leaveDemo({ brainDir: samples.brainDir, store: office.store });
        samples.record("removed");

        if (result.failed.length > 0) {
          // Reported rather than swallowed, and by name: a note that would not
          // move is one the owner will still see in search tomorrow, and the
          // only person who can do anything about it is them.
          return {
            ok: false,
            error: {
              code: "INTERNAL",
              message: `Moved ${result.notesMoved}, but could not move ${result.failed.join(", ")}.`,
              hint: "Check the file permissions in your office's brain folder.",
            },
          };
        }

        return {
          ok: true,
          result: {
            notesMoved: result.notesMoved,
            runsDeleted: result.runsDeleted,
            kept: false,
          },
        };
      }

      /*
       * SR-067: taking a permission back.
       *
       * By key rather than by tool name: an agent can hold several permissions
       * for the same tool, one per recipient, and a Revoke button that took all
       * of them because they share a name would be taking back decisions
       * nobody asked about.
       *
       * A row that is already gone answers ok. The owner may have deleted it in
       * the file — which the office tells them they can do — and the next state
       * push will show it missing either way.
       */
      case "approvals.revoke": {
        const removed = office.whitelist.revokeKey(message.key);
        return { ok: true, result: { removed } };
      }

      /*
       * SR-067: the model everybody uses unless their own row says otherwise.
       *
       * Refused unless a configured provider actually offers it. A select can
       * only send what it was shown, so a value that is not on offer means a
       * stale tab or a hand-made message, and either way writing it would put a
       * model into agents.yaml that nothing can run.
       */
      /*
       * Hiring, editing and letting go.
       *
       * Every refusal comes back with the writer's own sentence rather than a
       * generic failure, because these are forms: "there is already somebody
       * with the id bookkeeper" is something the person can act on where
       * "could not write agents.yaml" is not.
       */
      case "agent.create":
        return rosterEdit(office.addAgent?.(message.agent), { agentId: message.agent.id });

      case "agent.remove":
        return rosterEdit(office.removeAgent?.(message.agentId), { agentId: message.agentId });

      case "agent.update":
        return rosterEdit(office.updateAgent?.(message.agentId, message.fields), {
          agentId: message.agentId,
        });

      case "connector.add": {
        // Secrets first: a config entry pointing at a variable that is not there
        // yet is a connector that reads as broken for no reason.
        for (const [name, value] of Object.entries(message.secrets ?? {})) {
          const stored = office.setEnvValue?.(name, value);
          if (stored !== undefined && !stored.ok) return rosterEdit(stored, {});
        }
        return rosterEdit(await office.setMcpServer?.(message.name, message.server), {
          name: message.name,
        });
      }

      case "connector.remove":
        return rosterEdit(await office.removeMcpServer?.(message.name), { name: message.name });

      case "connector.scope":
        return rosterEdit(await office.setMcpDepartments?.(message.name, message.departments), {
          name: message.name,
        });

      case "office.rename":
        return rosterEdit(office.setOfficeName?.(message.name), { name: message.name });

      case "department.create":
        return rosterEdit(office.addDepartment?.(message.id, message.label), { id: message.id });

      case "department.rename":
        return rosterEdit(office.renameDepartment?.(message.id, message.label), { id: message.id });

      case "department.remove":
        return rosterEdit(office.removeDepartment?.(message.id), { id: message.id });

      case "agents.set_default_model": {
        if (!canRun(office, message.model)) {
          return {
            ok: false,
            error: {
              code: "MODEL_NOT_FOUND",
              message: `No configured provider offers ${message.model}.`,
              hint: "Pick one from the list, or add the provider in office/config.yaml.",
            },
          };
        }

        if (office.setDefaultModel?.(message.model) !== true) {
          return {
            ok: false,
            error: {
              code: "INTERNAL",
              message: "Could not write the default model to agents.yaml.",
              hint: "Check the file is there and that you can write to it.",
            },
          };
        }
        return { ok: true, result: { model: message.model } };
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

      /*
       * SR-063: the three ways a routine is changed from the office.
       *
       * All three go through the scheduler rather than the file directly, so
       * the running schedule and routines.yaml can never disagree about what is
       * due next.
       */
      case "routine.upsert": {
        const scheduler = deps.scheduler;
        if (scheduler === undefined) return noScheduler();

        /*
         * Merged onto the one that is already there, when there is one.
         *
         * This is what "upsert" means, and it is what makes Pause possible: the
         * browser is sent a routine's label and cadence, never its task or its
         * agent, so it cannot send back a whole routine and must not have to.
         */
        const incoming = (message.routine ?? {}) as { id?: unknown };
        const existing =
          typeof incoming.id === "string"
            ? scheduler.list().find((r) => r.id === incoming.id)
            : undefined;

        const parsed = RoutineSchema.safeParse(
          existing === undefined ? message.routine : { ...existing, ...message.routine },
        );
        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: "INTERNAL",
              message: parsed.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; "),
              hint: "Check the routine against the example in office/routines.yaml.",
            },
          };
        }

        // A routine naming nobody would fail every morning in silence, so it is
        // refused now, while somebody is looking at the screen.
        if (office.roster.agent(parsed.data.agent) === undefined) {
          return {
            ok: false,
            error: {
              code: "AGENT_FIELD_MISSING",
              message: `There is nobody called ${parsed.data.agent} in this office.`,
              hint: "Check office/agents.yaml.",
            },
          };
        }

        scheduler.save(upsertRoutine(scheduler.list(), parsed.data));
        return { ok: true, result: { id: parsed.data.id } };
      }

      case "routine.delete": {
        const scheduler = deps.scheduler;
        if (scheduler === undefined) return noScheduler();

        const before = scheduler.list();
        const after = removeRoutine(before, message.routineId);
        if (after.length === before.length) {
          return {
            ok: false,
            error: {
              code: "INTERNAL",
              message: `There is no routine called ${message.routineId}.`,
              hint: "Check office/routines.yaml.",
            },
          };
        }

        scheduler.save(after);
        return { ok: true, result: { id: message.routineId } };
      }

      case "routine.run_now": {
        const scheduler = deps.scheduler;
        if (scheduler === undefined) return noScheduler();

        // Not awaited: a routine can take minutes, and the owner clicked a
        // button rather than asking to wait. The run shows up in the office the
        // same way every other run does.
        const found = scheduler.list().some((r) => r.id === message.routineId);
        if (!found) {
          return {
            ok: false,
            error: {
              code: "INTERNAL",
              message: `There is no routine called ${message.routineId}.`,
              hint: "Check office/routines.yaml.",
            },
          };
        }

        void scheduler.runNow(message.routineId);
        return { ok: true, result: { id: message.routineId } };
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
