/**
 * Bringing somebody's existing notes in.
 *
 * Most people who want this already keep notes somewhere — an Obsidian vault, a
 * folder of markdown — and the whole promise of the brain is that it is ordinary
 * files they own. So the import has one job beyond copying: what worked before
 * has to still work after. A vault whose `[[wiki-links]]` all resolve must not
 * arrive with half of them pointing nowhere.
 *
 * Three rules it follows:
 *
 *   Copy, do not move, unless asked. Somebody trying this out should be able to
 *   change their mind by deleting a folder, not by hunting for where their notes
 *   went.
 *
 *   Nothing is overwritten. A name already taken gets a suffix, because two
 *   notes called `meeting.md` are two notes and losing one silently is losing
 *   the owner's writing.
 *
 *   Nothing is pinned. Pinned notes go in every prompt every agent sees, and
 *   that is the owner's decision to make deliberately, not something five
 *   hundred imported notes should do to them.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";

/** Where an import lands unless told otherwise: half weight, never pinned. */
export const DEFAULT_AREA = "90-archive";

/** Referenced by notes, indexed by filename only in v1. */
export const ATTACHMENTS = "_attachments";

/**
 * Never brought in unless `--include-tools`.
 *
 * `tools/` is the dangerous one: a folder of TypeScript the office would load
 * and run. The rest are noise somebody would have to delete by hand.
 */
export const SKIPPED_DIRS = ["node_modules", ".git", ".staffroom", "tools", ".obsidian"];
export const SKIPPED_FILES = ["package.json", "package-lock.json", "pnpm-lock.yaml"];

/** Copied into `_attachments/` when a note refers to them. */
const ATTACHMENT_TYPES = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".pdf",
  ".heic",
]);

export interface ImportOptions {
  /** Move instead of copy. Off by default; see the header. */
  move?: boolean;
  /** Top-level folder to land in. Defaults to `90-archive`. */
  area?: string;
  /** Bring `tools/` and `package.json` too. Off by default. */
  includeTools?: boolean;
}

export interface ImportSummary {
  /** True when the source had a `.obsidian/` folder. */
  obsidian: boolean;
  notes: number;
  attachments: number;
  /** Wiki-links and embeds that found the note they name. */
  linksResolved: number;
  /** Ones that did not. Reported, never invented. */
  linksUnresolved: string[];
  /** Paths skipped, and why. */
  skipped: Array<{ path: string; reason: string }>;
}

/** A vault announces itself: Obsidian keeps its settings in `.obsidian/`. */
export function isObsidianVault(source: string): boolean {
  return existsSync(join(source, ".obsidian"));
}

interface Found {
  /** Absolute. */
  path: string;
  /** Relative to the source root, with forward slashes. */
  rel: string;
}

/** Everything worth looking at, with the skip list applied. */
export function walk(
  source: string,
  options: { includeTools?: boolean } = {},
): { files: Found[]; skipped: Array<{ path: string; reason: string }> } {
  const files: Found[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  const skipDirs = new Set(
    options.includeTools === true ? SKIPPED_DIRS.filter((d) => d !== "tools") : SKIPPED_DIRS,
  );

  const descend = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      // A folder that cannot be read is reported, not fatal: one unreadable
      // directory should not stop an import of five hundred notes.
      skipped.push({ path: relative(source, dir) || ".", reason: "could not be read" });
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry);
      const rel = relative(source, full).split(sep).join("/");

      if (skipDirs.has(entry)) {
        skipped.push({
          path: rel,
          reason: entry === "tools" ? "tools are not imported unless asked" : "not note content",
        });
        continue;
      }
      // Anything hidden: dotfiles are configuration, not somebody's writing.
      if (entry.startsWith(".")) {
        skipped.push({ path: rel, reason: "hidden" });
        continue;
      }
      if (options.includeTools !== true && SKIPPED_FILES.includes(entry)) {
        skipped.push({ path: rel, reason: "not note content" });
        continue;
      }

      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(full);
      } catch {
        skipped.push({ path: rel, reason: "could not be read" });
        continue;
      }

      if (stats.isDirectory()) {
        descend(full);
        continue;
      }
      files.push({ path: full, rel });
    }
  };

  descend(source);
  return { files, skipped };
}

/** `Meeting Notes.md` becomes `meeting-notes`, which is what a note id looks like. */
export function slugOf(name: string): string {
  const stem = name.slice(0, name.length - extname(name).length);
  return (
    stem
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "note"
  );
}

/** A name nothing else has taken, so an import never lands on somebody's writing. */
function freeName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

const WIKI = /!?\[\[([^\]|#]+)((?:[#|][^\]]*)?)\]\]/g;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Front matter, kept as it was, with the three missing pieces filled in.
 *
 * Existing keys are never touched: an owner who wrote `tags:` or their own
 * `status:` should find them intact. Only `title`, `created` and `written_by`
 * are added, and only when absent.
 */
export function fillFrontMatter(
  text: string,
  fallback: { title: string; created: string },
): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const body = match === null ? text : text.slice(match[0].length);
  const existing = match?.[1] ?? "";

  const has = (key: string): boolean => new RegExp(`^${key}\\s*:`, "m").test(existing);

  const added: string[] = [];
  if (!has("title")) added.push(`title: ${JSON.stringify(fallback.title)}`);
  if (!has("created")) added.push(`created: ${fallback.created}`);
  // Imported notes are the owner's own writing, whoever typed them originally.
  // Nothing here claims an agent wrote something a person did.
  if (!has("written_by")) added.push("written_by: owner");

  const lines = [existing, ...added].filter((line) => line.trim().length > 0);
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

interface Rewritten {
  text: string;
  resolved: number;
  unresolved: string[];
  /** Attachment paths the note referred to, relative to the source. */
  attachments: string[];
}

/**
 * Rewrites what a note points at, now that it lives somewhere else.
 *
 * A wiki-link names a note rather than a path, so it survives the move as long
 * as the note it names came too — which is what `known` is for. An image is a
 * path, and paths change, so those are rewritten to the attachments folder.
 *
 * `attachmentPrefix` is how the note reaches that folder from where it now
 * sits, which is not the same for every note: attachments live at the top of
 * the brain, and a note lives inside an area, so the two are only ever the same
 * string by accident.
 *
 * An unresolved link is left exactly as the owner wrote it. Rewriting it to
 * something that does exist would be the import guessing at what they meant.
 */
export function rewriteLinks(
  text: string,
  context: {
    known: Map<string, string>;
    attachmentsOf: (target: string) => string | undefined;
    attachmentPrefix?: string;
  },
): Rewritten {
  const prefix = context.attachmentPrefix ?? ATTACHMENTS;
  const unresolved: string[] = [];
  const attachments: string[] = [];
  let resolved = 0;

  let out = text.replace(WIKI, (whole, target: string, suffix: string) => {
    const name = target.trim();
    const embed = whole.startsWith("!");

    // An embed of a picture is an attachment, not a link to a note.
    if (embed && ATTACHMENT_TYPES.has(extname(name).toLowerCase())) {
      const found = context.attachmentsOf(name);
      if (found === undefined) {
        unresolved.push(name);
        return whole;
      }
      attachments.push(found);
      return `![${basename(name)}](${prefix}/${basename(found)})`;
    }

    const id = context.known.get(name.toLowerCase());
    if (id === undefined) {
      unresolved.push(name);
      return whole;
    }
    resolved += 1;
    // Kept as a wiki-link, because that is what the brain's own resolver reads.
    return `${embed ? "!" : ""}[[${id}${suffix}]]`;
  });

  out = out.replace(MARKDOWN_IMAGE, (whole, alt: string, href: string) => {
    if (/^[a-z]+:\/\//i.test(href)) return whole;
    if (!ATTACHMENT_TYPES.has(extname(href).toLowerCase())) return whole;

    const found = context.attachmentsOf(href);
    if (found === undefined) {
      unresolved.push(href);
      return whole;
    }
    attachments.push(found);
    return `![${alt}](${prefix}/${basename(found)})`;
  });

  return { text: out, resolved, unresolved, attachments };
}

/**
 * Brings a folder of notes into the brain.
 *
 * Two passes, because the first has to finish before the second can be right: a
 * link can only be resolved once every note that might be its target is known.
 */
export function importBrain(
  source: string,
  brainDir: string,
  options: ImportOptions = {},
): ImportSummary {
  const area = options.area ?? DEFAULT_AREA;
  const root = resolve(source);
  const obsidian = isObsidianVault(root);

  const { files, skipped } = walk(root, {
    ...(options.includeTools === undefined ? {} : { includeTools: options.includeTools }),
  });

  const notes = files.filter((f) => f.rel.toLowerCase().endsWith(".md"));
  const others = files.filter((f) => !f.rel.toLowerCase().endsWith(".md"));

  const target = join(brainDir, area);
  mkdirSync(target, { recursive: true });

  /*
   * Pass one: decide where every note is going.
   *
   * Nothing is written yet. A wiki-link names a note by its file name or its
   * path, and both have to be answerable before a single file is rewritten.
   */
  const known = new Map<string, string>();
  const placed: Array<{ from: Found; name: string }> = [];

  for (const note of notes) {
    const name = freeName(target, `${slugOf(basename(note.rel))}.md`);
    const id = `${area}/${name.slice(0, name.length - 3)}`;

    // Both the bare name and the path, because a vault uses either.
    known.set(basename(note.rel).replace(/\.md$/i, "").toLowerCase(), id);
    known.set(note.rel.replace(/\.md$/i, "").toLowerCase(), id);
    placed.push({ from: note, name });
  }

  const attachmentIndex = new Map<string, string>();
  for (const file of others) {
    if (!ATTACHMENT_TYPES.has(extname(file.rel).toLowerCase())) continue;
    attachmentIndex.set(basename(file.rel).toLowerCase(), file.rel);
    attachmentIndex.set(file.rel.toLowerCase(), file.rel);
  }

  const attachmentsOf = (wanted: string): string | undefined => {
    const clean = wanted.split("#")[0]?.split("?")[0]?.trim() ?? wanted;
    return (
      attachmentIndex.get(clean.toLowerCase()) ?? attachmentIndex.get(basename(clean).toLowerCase())
    );
  };

  // How a note in this area reaches `_attachments/`, which sits at the top of
  // the brain. Written out rather than assumed, because the owner picks the
  // area and `--area client-work/acme` is a perfectly ordinary thing to pass.
  const depth = area.split("/").filter((part) => part.length > 0).length;
  const attachmentPrefix = `${"../".repeat(depth)}${ATTACHMENTS}`;

  // Pass two: write them.
  let linksResolved = 0;
  const linksUnresolved: string[] = [];
  const wantedAttachments = new Set<string>();

  for (const { from, name } of placed) {
    let raw: string;
    try {
      raw = readFileSync(from.path, "utf8");
    } catch {
      skipped.push({ path: from.rel, reason: "could not be read" });
      continue;
    }

    const rewritten = rewriteLinks(raw, { known, attachmentsOf, attachmentPrefix });
    linksResolved += rewritten.resolved;
    linksUnresolved.push(...rewritten.unresolved);
    for (const attachment of rewritten.attachments) wantedAttachments.add(attachment);

    const created = (() => {
      try {
        return statSync(from.path).birthtime.toISOString();
      } catch {
        return new Date().toISOString();
      }
    })();

    const filled = fillFrontMatter(rewritten.text, {
      // The file name as the owner wrote it, not the slug: `Acme Bakery.md`
      // should read `Acme Bakery`, not `acme-bakery`.
      title: basename(from.rel).replace(/\.md$/i, ""),
      created,
    });

    writeFileSync(join(target, name), filled, "utf8");
    if (options.move === true) {
      try {
        renameSync(from.path, join(target, name));
      } catch {
        // Already written at the destination; the original staying put is a
        // worse outcome than a failed delete, so this is not fatal.
      }
    }
  }

  // Only the attachments something actually points at. Copying a vault's whole
  // image folder would bring in years of screenshots nothing refers to.
  const attachmentDir = join(brainDir, ATTACHMENTS);
  let copied = 0;

  for (const rel of wantedAttachments) {
    mkdirSync(attachmentDir, { recursive: true });
    const from = join(root, rel.split("/").join(sep));
    const to = join(attachmentDir, basename(rel));
    try {
      if (!existsSync(to)) copyFileSync(from, to);
      copied += 1;
    } catch {
      skipped.push({ path: rel, reason: "could not be copied" });
    }
  }

  return {
    obsidian,
    notes: placed.length,
    attachments: copied,
    linksResolved,
    linksUnresolved,
    skipped,
  };
}

/** The summary, as lines to print. Plain sentences, not a table. */
export function summaryLines(summary: ImportSummary): string[] {
  const lines: string[] = [];

  lines.push(
    `Imported ${summary.notes} ${summary.notes === 1 ? "note" : "notes"}${
      summary.obsidian ? " from an Obsidian vault" : ""
    }.`,
  );

  if (summary.attachments > 0) {
    lines.push(
      `Copied ${summary.attachments} ${
        summary.attachments === 1 ? "attachment" : "attachments"
      } into ${ATTACHMENTS}/.`,
    );
  }

  lines.push(
    summary.linksResolved === 1
      ? "1 link still points at the right note."
      : `${summary.linksResolved} links still point at the right note.`,
  );

  if (summary.linksUnresolved.length > 0) {
    // Named rather than counted: the owner is the only one who knows whether a
    // broken link mattered, and they cannot judge that from a number.
    const shown = [...new Set(summary.linksUnresolved)].slice(0, 10);
    lines.push(
      `${summary.linksUnresolved.length} pointed at something that did not come with them: ${shown.join(", ")}${
        summary.linksUnresolved.length > shown.length ? ", and more" : ""
      }. They were left exactly as you wrote them.`,
    );
  }

  const tools = summary.skipped.filter((s) => s.reason.includes("tools"));
  if (tools.length > 0) {
    lines.push(
      "Skipped a tools folder. Pass --include-tools if you meant to bring it, and read it first: those files run on this machine.",
    );
  }

  const others = summary.skipped.length - tools.length;
  if (others > 0) {
    lines.push(`Skipped ${others} other ${others === 1 ? "file" : "files"} that are not notes.`);
  }

  return lines;
}

/** Where the notes went, for the line that says so. */
export function landedIn(options: ImportOptions = {}): string {
  return `brain/${options.area ?? DEFAULT_AREA}/`;
}

/** The directory a caller should hand `importBrain`, given an office. */
export function brainDirOf(officeDir: string, brainFolder = "brain"): string {
  return join(officeDir, brainFolder);
}
