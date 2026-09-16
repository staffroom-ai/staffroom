/**
 * Types that more than one subsystem needs. They live here so the tool registry,
 * the run log and the brain do not have to import from each other.
 */

/** Where a tool came from. The office shows this on every tool card. */
export type ToolSource =
  | { kind: "builtin" }
  | { kind: "custom"; file: string }
  | { kind: "mcp"; server: string };

/**
 * What the owner sees before they allow something to leave the machine.
 *
 * This is the whole safety story in one object, so it is deliberately concrete:
 * `destination` is where it goes, `body` is what will actually be sent. Never
 * summarise the body into nothing. A person approving a send needs to read the
 * send.
 */
export interface ApprovalPreview {
  /** Plain verb phrase: "Send an email", "Post to #general". */
  action: string;
  /** Who or where it goes: an address, a channel, a hostname. */
  destination: string;
  /** One line the owner can decide on at a glance. */
  summary: string;
  /** The full content that will be sent, unabridged. */
  body: string;
  /**
   * Named fields the owner may edit before approving, such as a recipient.
   * `sensitive` fields are shown masked: an approval card is often read with
   * someone looking over the owner's shoulder, and a token on screen is a token
   * leaked.
   */
  fields?: Array<{ name: string; value: string; editable: boolean; sensitive?: boolean }>;
  /** True when it cannot be taken back: a send, a payment, a delete. */
  irreversible: boolean;
  /**
   * Set when this tool was whitelisted earlier but the call differs from what was
   * allowed (a new recipient, say). The office shows a "changed since you allowed
   * this" line and asks again.
   */
  changedSinceAllowed?: string;
}

export type ApprovalDecision = "approve" | "approve_always" | "deny" | "expired" | "cancelled";

export type ApprovalBy = "owner" | "system" | "whitelist";

export interface BrainNoteRef {
  id: string;
  title: string;
  area: string;
  /** Excerpt around the match, for search results. */
  excerpt?: string;
}

export interface BrainSearchOptions {
  limit?: number;
  area?: string;
  /** Include notes marked private in their front matter. Off by default. */
  includePrivate?: boolean;
}

export interface BrainListOptions {
  area?: string;
  limit?: number;
}

export interface BrainNote extends BrainNoteRef {
  body: string;
  tags: string[];
  writtenBy?: string;
  createdAt?: string;
}

/**
 * The read side of the brain. The tool registry puts one of these on every
 * `ToolContext` so a tool can look things up without knowing how notes are stored.
 */
export interface BrainReader {
  search(query: string, opts?: BrainSearchOptions): Promise<BrainNoteRef[]>;
  read(id: string): Promise<BrainNote | null>;
  list(opts?: BrainListOptions): Promise<BrainNoteRef[]>;
}
