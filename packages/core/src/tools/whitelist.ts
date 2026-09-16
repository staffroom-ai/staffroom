/**
 * Permissions the owner has already given.
 *
 * "Approve and always allow" is the difference between an office you can leave
 * running and one that interrupts you every four minutes. It is also the single
 * easiest place to give away more than was meant, so the matching is deliberately
 * narrow and the rules are written down here rather than inferred.
 *
 * Three rules do the work:
 *
 *   A `*` never crosses a separator. `*@acme.com` allows one address at acme,
 *   not `evil@x.com,a@acme.com` — which is the same string with a comma in it,
 *   and is how a permission to email the team becomes a permission to email
 *   anyone.
 *
 *   An array is allowed only if every element is. One bad recipient in a list of
 *   twenty is still a bad recipient.
 *
 *   A permission is for the tool as it was. The fingerprint is stored with the
 *   row, and if the tool changes underneath it the row is suspended rather than
 *   quietly reused.
 *
 * The file is the owner's: they can read it, edit it, and delete a row to take a
 * permission back. Nothing here writes anything they could not have typed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import picomatch from "picomatch";
import { parse, stringify } from "yaml";
import type { Tool } from "./tool.js";

/**
 * Characters a `*` must never cross.
 *
 * Comma and semicolon separate recipients in every mail client there has ever
 * been; whitespace separates them in several; angle brackets wrap a display
 * name. A pattern that matched across any of these would turn one allowed
 * destination into an arbitrary list.
 */
const SEPARATORS = /[,;\s<>]/;

export interface AllowRow {
  agent: string;
  tool: string;
  /** Field patterns, all of which must match. Absent means any input. */
  match?: Record<string, string>;
  /** The tool as it was when this was granted. */
  fingerprint?: string;
  granted: string;
  expires?: string;
  /** Set when the tool changed; the owner is asked again. */
  suspended?: boolean;
}

export interface ApprovalsFile {
  allow: AllowRow[];
}

export function approvalsPath(officeDir: string): string {
  return join(officeDir, "approvals.yaml");
}

/**
 * Does one value satisfy one pattern?
 *
 * Exported because this is the rule the whole feature rests on, and it deserves
 * to be tested directly rather than only through the registry.
 */
export function valueMatches(pattern: string, value: unknown): boolean {
  if (Array.isArray(value)) {
    // Every element, and never an empty list: "allow nothing" is not a match.
    return value.length > 0 && value.every((item) => valueMatches(pattern, item));
  }

  // Numbers and booleans are compared as written; anything else — an object, a
  // function, null — is not something a pattern can sensibly allow.
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value) === pattern;
  }
  if (typeof value !== "string") return false;

  // The rule that matters. A separator in the value means it is more than one
  // thing, and a pattern for one thing must not allow it.
  if (SEPARATORS.test(value)) return false;

  return picomatch.isMatch(value, pattern, {
    nobrace: true,
    noglobstar: true,
    dot: true,
  });
}

/** Every pattern in a row must match the field it names. */
export function inputMatches(match: Record<string, string> | undefined, input: unknown): boolean {
  if (match === undefined || Object.keys(match).length === 0) return true;
  if (typeof input !== "object" || input === null) return false;

  const record = input as Record<string, unknown>;
  for (const [field, pattern] of Object.entries(match)) {
    if (!valueMatches(pattern, record[field])) return false;
  }
  return true;
}

export class FileWhitelist {
  private readonly officeDir: string;
  private readonly days: number;
  private rows: AllowRow[] = [];

  constructor(officeDir: string, options: { whitelistDays?: number } = {}) {
    this.officeDir = officeDir;
    this.days = options.whitelistDays ?? 30;
    this.reload();
  }

  /** Re-reads the file, so deleting a row takes effect without a restart. */
  reload(): void {
    const path = approvalsPath(this.officeDir);
    if (!existsSync(path)) {
      this.rows = [];
      return;
    }
    try {
      const parsed = parse(readFileSync(path, "utf8")) as ApprovalsFile | null;
      this.rows = Array.isArray(parsed?.allow) ? parsed.allow : [];
    } catch {
      // A file the owner has half-edited is not a reason to start allowing
      // things, nor to refuse to open. No rows means every call is asked about.
      this.rows = [];
    }
  }

  list(): AllowRow[] {
    return this.rows.map((row) => ({ ...row }));
  }

  /** The row that would allow this call, ignoring whether it is usable. */
  private rowFor(agentId: string, tool: string, input: unknown): AllowRow | undefined {
    return this.rows.find(
      (row) => row.agent === agentId && row.tool === tool && inputMatches(row.match, input),
    );
  }

  allows(tool: Tool, input: unknown, fingerprint: string, agentId: string): boolean {
    const row = this.rowFor(agentId, tool.name, input);
    if (row === undefined) return false;
    if (row.suspended === true) return false;
    if (row.expires !== undefined && Date.parse(row.expires) < Date.now()) return false;

    // A permission is for the tool as it was. If the tool has changed, the row
    // does not apply to what is in front of us now.
    if (row.fingerprint !== undefined && row.fingerprint !== fingerprint) return false;

    return true;
  }

  /** True when a matching row exists but has been suspended: the card says so. */
  changedSinceAllowed(agentId: string, tool: string, input: unknown): boolean {
    const row = this.rowFor(agentId, tool, input);
    return row?.suspended === true;
  }

  grant(options: {
    agentId: string;
    tool: string;
    match?: Record<string, string>;
    fingerprint?: string;
    /** Allows a row with no match, which permits any input to that tool. */
    allowAnyRecipient?: boolean;
  }): AllowRow {
    const hasMatch = options.match !== undefined && Object.keys(options.match).length > 0;
    if (!hasMatch && options.allowAnyRecipient !== true) {
      // "Always allow" with nothing to match on is "always allow anything", which
      // is almost never what somebody clicking a button on one email means.
      throw new Error(
        "Allowing every input to a tool has to be asked for explicitly. " +
          "Grant it for a specific recipient, or pass allowAnyRecipient.",
      );
    }

    const expires = new Date(Date.now() + this.days * 24 * 60 * 60 * 1000).toISOString();
    const row: AllowRow = {
      agent: options.agentId,
      tool: options.tool,
      ...(hasMatch ? { match: options.match } : {}),
      ...(options.fingerprint === undefined ? {} : { fingerprint: options.fingerprint }),
      granted: new Date().toISOString(),
      expires,
    };

    // Replace rather than stack: granting the same thing twice should refresh it,
    // not leave a suspended row behind that keeps asking.
    this.rows = this.rows.filter(
      (existing) =>
        !(
          existing.agent === row.agent &&
          existing.tool === row.tool &&
          JSON.stringify(existing.match ?? {}) === JSON.stringify(row.match ?? {})
        ),
    );
    this.rows.push(row);
    this.write();
    return row;
  }

  revoke(agentId: string, tool: string): number {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !(row.agent === agentId && row.tool === tool));
    if (this.rows.length !== before) this.write();
    return before - this.rows.length;
  }

  /**
   * Suspends every row for a tool whose fingerprint no longer matches.
   *
   * Called when an MCP server changes its tools. The rows are kept rather than
   * deleted: the owner gave that permission, and the office's job is to ask
   * again about what changed, not to silently forget what they decided.
   */
  suspendWhere(tool: string, fingerprint: string): number {
    let touched = 0;
    for (const row of this.rows) {
      if (row.tool !== tool) continue;
      if (row.fingerprint === undefined || row.fingerprint === fingerprint) continue;
      if (row.suspended === true) continue;
      row.suspended = true;
      touched += 1;
    }
    if (touched > 0) this.write();
    return touched;
  }

  private write(): void {
    writeFileSync(
      approvalsPath(this.officeDir),
      `# Written by "Approve and always allow". Delete a row to take the permission back.\n${stringify(
        { allow: this.rows },
      )}`,
      "utf8",
    );
  }
}
