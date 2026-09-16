/**
 * Work the office does without being asked.
 *
 * `office/routines.yaml` is the owner's file like every other one here, so it is
 * read and written through the yaml document API: a routine paused from the
 * browser must not cost them the comments they wrote around it.
 *
 * Two rules the scheduler is built on:
 *
 *   A routine that will not parse never stops the office. The rest of the file
 *   still runs and the bad row is reported, because an office that refuses to
 *   open over a mistyped cadence is an office nobody leaves running.
 *
 *   Nothing fires twice. `lastRunAt` is written before the run starts, not after
 *   it finishes, so a crash mid-run loses the work rather than repeating it. For
 *   a routine that emails somebody, doing it twice is the worse failure.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDocument, stringify } from "yaml";
import { z } from "zod";

export const ROUTINE_ID = /^[a-z][a-z0-9-]{1,39}$/;

export const RoutineSchema = z
  .object({
    id: z.string().regex(ROUTINE_ID),
    label: z.string().min(1).max(80),
    agent: z.string(),
    task: z.string().min(5).max(2000),
    cadence: z.enum(["daily", "weekdays", "weekly", "monthly", "cron"]),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    weekday: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]).optional(),
    /** 1 to 28: the 29th onward does not exist in every month. */
    day: z.number().int().min(1).max(28).optional(),
    cron: z.string().optional(),
    /**
     * True makes the registry ignore the whitelist for this run's write tools.
     *
     * The default, on purpose. A routine runs while nobody is watching, and a
     * permission the owner granted once by hand is not a permission to do the
     * same thing unattended every morning.
     */
    approval_before_send: z.boolean().default(true),
    catch_up: z.enum(["latest", "all", "skip"]).default("latest"),
    paused: z.boolean().default(false),
  })
  .strict();

export type Routine = z.infer<typeof RoutineSchema>;
export type RoutineInput = z.input<typeof RoutineSchema>;

export interface RoutineProblem {
  id: string;
  message: string;
}

export interface LoadedRoutines {
  routines: Routine[];
  /** Rows that would not parse. Reported, never fatal. */
  problems: RoutineProblem[];
}

export function routinesPath(officeDir: string): string {
  return join(officeDir, "routines.yaml");
}

const HEADER = `# office/routines.yaml
#
# Work the office does without being asked. Times are on your own clock, from
# the timezone in agents.yaml.
`;

export function loadRoutines(officeDir: string): LoadedRoutines {
  const path = routinesPath(officeDir);
  if (!existsSync(path)) return { routines: [], problems: [] };

  let rows: unknown[];
  try {
    const parsed = parseDocument(readFileSync(path, "utf8")).toJS() as {
      routines?: unknown;
    } | null;
    rows = Array.isArray(parsed?.routines) ? parsed.routines : [];
  } catch (error) {
    // A half-edited file is not a reason to refuse to open. Nothing is
    // scheduled, and the owner is told which file to look at.
    return {
      routines: [],
      problems: [
        {
          id: "routines.yaml",
          message: `routines.yaml could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }

  const routines: Routine[] = [];
  const problems: RoutineProblem[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const parsed = RoutineSchema.safeParse(row);
    if (!parsed.success) {
      const id = (row as { id?: unknown })?.id;
      problems.push({
        id: typeof id === "string" ? id : "(a routine with no id)",
        message: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      });
      continue;
    }

    // Two routines with one id is ambiguous about which one `run now` means, so
    // the second is reported rather than silently shadowing the first.
    if (seen.has(parsed.data.id)) {
      problems.push({
        id: parsed.data.id,
        message: "there is more than one routine with this id; only the first is used",
      });
      continue;
    }

    /*
     * `cron` is in the schema and nothing computes its fire times yet.
     *
     * Left in rather than removed, because a file that already says `cron`
     * should not stop loading — but a routine that will never fire has to say so
     * out loud, or it sits in the list looking scheduled forever.
     */
    if (parsed.data.cadence === "cron") {
      problems.push({
        id: parsed.data.id,
        message:
          "cron schedules are not supported yet, so this routine will not fire. " +
          "Use daily, weekdays, weekly or monthly.",
      });
    }

    seen.add(parsed.data.id);
    routines.push(parsed.data);
  }

  return { routines, problems };
}

/**
 * Writes the file back, keeping what the owner wrote around it.
 *
 * Document mode rather than a dump: the header, and any comment they added
 * beside a routine, survive a pause toggled from the browser.
 */
export function saveRoutines(officeDir: string, routines: Routine[]): void {
  const path = routinesPath(officeDir);
  mkdirSync(dirname(path), { recursive: true });

  if (!existsSync(path)) {
    writeFileSync(path, HEADER + stringify({ version: 1, routines }), "utf8");
    return;
  }

  const doc = parseDocument(readFileSync(path, "utf8"));
  doc.set("version", 1);

  const existing = doc.get("routines") as
    | { items?: Array<{ get?: (k: string) => unknown; set?: (k: string, v: unknown) => void }> }
    | undefined;

  if (existing?.items === undefined) {
    doc.set("routines", routines);
    writeFileSync(path, String(doc), "utf8");
    return;
  }

  /*
   * Field by field on the node that is already there.
   *
   * Replacing the sequence would be one line, and would throw away every comment
   * the owner wrote beside a routine — which is the whole reason this file is
   * edited in document mode rather than dumped.
   */
  const byId = new Map<string, (typeof existing.items)[number]>();
  for (const node of existing.items) {
    const id = node.get?.("id");
    if (typeof id === "string") byId.set(id, node);
  }

  const rebuilt: unknown[] = [];
  for (const routine of routines) {
    const node = byId.get(routine.id);
    if (node?.set === undefined) {
      rebuilt.push(routine);
      continue;
    }
    for (const [key, value] of Object.entries(routine)) node.set(key, value);
    rebuilt.push(node);
  }

  doc.set("routines", rebuilt);
  writeFileSync(path, String(doc), "utf8");
}

/** Adds or replaces one, keeping the order of the rest. */
export function upsertRoutine(routines: Routine[], routine: Routine): Routine[] {
  const index = routines.findIndex((r) => r.id === routine.id);
  if (index === -1) return [...routines, routine];
  return routines.map((r, i) => (i === index ? routine : r));
}

export function removeRoutine(routines: Routine[], id: string): Routine[] {
  return routines.filter((r) => r.id !== id);
}

/**
 * An id from a label: `Morning inbox summary` becomes `morning-inbox-summary`.
 *
 * Used when the task bar's schedule popover creates one, because nobody typing
 * "every weekday at 8" should have to think of an identifier as well.
 */
export function idFromLabel(label: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 36) || "routine";

  if (!taken.has(base)) return base;
  for (let n = 2; n < 1_000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
