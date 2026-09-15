/**
 * Wiki-links, and how a name becomes a note.
 *
 * Resolution goes exact id, then unique basename, then unique title. Ambiguity
 * resolves to nothing rather than guessing: a link pointing at the wrong note is
 * worse than one the graph shows as missing.
 */
import type { ParsedNote } from "./types.js";

export type LinkKind = "wiki" | "markdown" | "front_matter" | "missing";

export interface Link {
  from: string;
  to: string;
  kind: LinkKind;
  resolved: boolean;
}

const WIKI = /\[\[([^\]]+)\]\]/g;
const MARKDOWN = /\[[^\]]*\]\(([^)]+\.md)\)/g;

/** `[[Acme|the client]]` and `[[Acme#pricing]]` both point at Acme. */
function linkTarget(raw: string): string {
  return (raw.split("|")[0] ?? "").split("#")[0]?.trim() ?? "";
}

export interface Resolver {
  byId: Set<string>;
  byBasename: Map<string, string[]>;
  byTitle: Map<string, string[]>;
}

export function buildResolver(notes: Iterable<Pick<ParsedNote, "id" | "title">>): Resolver {
  const byId = new Set<string>();
  const byBasename = new Map<string, string[]>();
  const byTitle = new Map<string, string[]>();

  for (const note of notes) {
    byId.add(note.id);
    const basename = note.id.split("/").pop() ?? note.id;
    byBasename.set(basename, [...(byBasename.get(basename) ?? []), note.id]);
    const title = note.title.toLowerCase();
    byTitle.set(title, [...(byTitle.get(title) ?? []), note.id]);
  }
  return { byId, byBasename, byTitle };
}

export function resolveTarget(raw: string, resolver: Resolver): string | undefined {
  const target = linkTarget(raw);
  if (target.length === 0) return undefined;

  const asId = target.replace(/\.md$/i, "");
  if (resolver.byId.has(asId)) return asId;

  const byBasename = resolver.byBasename.get(asId.split("/").pop() ?? asId);
  if (byBasename?.length === 1) return byBasename[0];

  const byTitle = resolver.byTitle.get(target.toLowerCase());
  if (byTitle?.length === 1) return byTitle[0];

  return undefined;
}

export function linksFrom(note: ParsedNote, resolver: Resolver): Link[] {
  const found = new Map<string, Link>();

  const add = (raw: string, kind: Exclude<LinkKind, "missing">): void => {
    const resolved = resolveTarget(raw, resolver);
    const to = resolved ?? linkTarget(raw);
    if (to.length === 0 || to === note.id) return;
    const key = `${to}:${kind}`;
    if (found.has(key)) return;
    found.set(key, {
      from: note.id,
      to,
      kind: resolved === undefined ? "missing" : kind,
      resolved: resolved !== undefined,
    });
  };

  for (const match of note.body.matchAll(WIKI)) add(match[1] as string, "wiki");
  for (const match of note.body.matchAll(MARKDOWN)) add(match[1] as string, "markdown");
  for (const explicit of note.frontMatter.links ?? []) add(explicit, "front_matter");

  return [...found.values()];
}
