/**
 * Working out what "always allow" should actually permit.
 *
 * The owner is looking at one message to one person. What they mean by "always"
 * is "to this person", not "with any input at all", so the card proposes a match
 * built from the destination fields and shows it to them before anything is
 * saved.
 *
 * Nothing here widens a value on the owner's behalf. If a call goes to three
 * different addresses there is no honest single pattern to propose — guessing
 * `*@acme.com` from `a@acme.com` would be inventing a permission nobody asked
 * for — so the field is left for them to fill in and the card says so.
 */

/** Fields that name where something is going, in the order a card should show them. */
export const RECIPIENT_FIELDS = [
  "to",
  "cc",
  "bcc",
  "recipient",
  "recipients",
  "channel",
  "url",
  "phone",
  "number",
] as const;

export interface ProposedField {
  name: string;
  /** Empty when the call has several destinations and no one value describes them. */
  value: string;
  /** What the call actually contained, for the owner to read. */
  actual: string;
  needsOwner: boolean;
}

/** One value, or nothing, for a field that may hold a list. */
function singleValue(value: unknown): { value: string; actual: string; single: boolean } {
  if (typeof value === "string" || typeof value === "number") {
    return { value: String(value), actual: String(value), single: true };
  }

  if (Array.isArray(value)) {
    const items = value
      .filter(
        (item): item is string | number => typeof item === "string" || typeof item === "number",
      )
      .map(String);
    const distinct = [...new Set(items)];
    if (distinct.length === 1) {
      // A list of one is still one destination, and the acceptance case.
      return { value: distinct[0] as string, actual: items.join(", "), single: true };
    }
    return { value: "", actual: items.join(", "), single: false };
  }

  return { value: "", actual: "", single: false };
}

/** The match to propose for a call, field by field. */
export function proposeMatch(input: unknown): ProposedField[] {
  if (typeof input !== "object" || input === null) return [];
  const record = input as Record<string, unknown>;
  const fields: ProposedField[] = [];

  for (const name of RECIPIENT_FIELDS) {
    if (!(name in record)) continue;
    const { value, actual, single } = singleValue(record[name]);
    if (actual === "") continue;
    fields.push({ name, value, actual, needsOwner: !single });
  }

  return fields;
}

/** The match object to send, once the owner has had their say. */
export function matchFrom(fields: ProposedField[]): Record<string, string> {
  const match: Record<string, string> = {};
  for (const field of fields) {
    if (field.value.trim().length > 0) match[field.name] = field.value.trim();
  }
  return match;
}

/**
 * The sentence on the confirm step.
 *
 * Deliberately long. It names the person, what the tool does, the tool's real
 * name and where it is allowed to go, because every one of those is something
 * the owner would want to have been told afterwards.
 */
export function alwaysAllowSentence(options: {
  agentName: string;
  action: string;
  toolName: string;
  fields: ProposedField[];
}): string {
  const destinations = options.fields
    .filter((field) => field.value.trim().length > 0)
    // "to" is already the preposition in the sentence, so naming the field as
    // well reads as "to to a@acme.com".
    .map((field) =>
      field.name === "to" ? field.value.trim() : `${field.name} ${field.value.trim()}`,
    );

  const where = destinations.length === 0 ? "with any input" : `to ${destinations.join(" and ")}`;

  return `Always allow ${options.agentName} to ${lowerFirst(options.action)} (${options.toolName}) ${where}.`;
}

function lowerFirst(text: string): string {
  const trimmed = text.trim().replace(/\.$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** Can this be saved? Either a real match, or the owner ticked "any recipient". */
export function canAlwaysAllow(fields: ProposedField[], allowAny: boolean): boolean {
  if (allowAny) return true;
  return Object.keys(matchFrom(fields)).length > 0;
}
