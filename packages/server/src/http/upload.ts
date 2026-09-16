/**
 * Dropping a file into the brain from the browser.
 *
 * This is the one route that writes a file the owner did not type, so it is the
 * narrowest one in the office. Everything it accepts is decided here rather than
 * anywhere downstream:
 *
 *   The name is thrown away and rebuilt. A multipart filename is attacker-chosen
 *   text that is about to become a path, and the list of ways that goes wrong is
 *   longer than anybody's list of checks. Only the extension survives, and only
 *   if it is one of three.
 *
 *   Everything lands in `brain/inbox/`, which is indexed at half weight and is
 *   never pinned. An upload cannot reach the notes every agent reads.
 *
 *   A name already taken is never overwritten. Two files called notes.md are two
 *   files; losing the first one silently would be losing the owner's writing.
 *
 * The token and Origin checks are not here: `checkRequest` has already refused
 * anything that is not a same-origin request carrying the session token, because
 * that is true of every write and belongs in one place.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

/** Markdown and text index directly; a PDF is stored and read by hand for now. */
export const UPLOAD_EXTENSIONS = [".md", ".txt", ".pdf"] as const;

/** Where uploads land. Half weight, never pinned; see brain.md. */
export const INBOX = "inbox";

/** Big enough for a long document, small enough that nobody fills a disk. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface UploadedFile {
  filename: string;
  content: Buffer;
}

/**
 * A safe filename, built rather than trusted.
 *
 * Only the extension is taken from what arrived. The stem is reduced to letters,
 * digits, dashes and underscores, which cannot be a path, a drive, a device name
 * or a dotfile whatever the original was.
 */
export function safeName(filename: string, fallback: string): string {
  const ext = extname(filename).toLowerCase();
  const allowed = (UPLOAD_EXTENSIONS as readonly string[]).includes(ext) ? ext : "";
  if (allowed === "") return "";

  const stem = filename
    .slice(0, filename.length - ext.length)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();

  return `${stem === "" ? fallback : stem}${allowed}`;
}

/** `notes.md`, then `notes-2.md`: an upload never lands on somebody's writing. */
export function freeName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;

  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; n < 1_000; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

export type UploadResult =
  | { ok: true; noteId: string; path: string; name: string }
  | { ok: false; status: number; error: string };

export function storeUpload(brainDir: string, file: UploadedFile): UploadResult {
  if (file.content.length === 0) {
    return { ok: false, status: 400, error: "that file is empty" };
  }
  if (file.content.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `files are limited to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`,
    };
  }

  const name = safeName(file.filename, "note");
  if (name === "") {
    return {
      ok: false,
      status: 415,
      error: `only ${UPLOAD_EXTENSIONS.join(", ")} files can be added to the brain`,
    };
  }

  const dir = join(brainDir, INBOX);
  mkdirSync(dir, { recursive: true });
  const final = freeName(dir, name);
  const path = join(dir, final);

  writeFileSync(path, file.content);

  return {
    ok: true,
    name: final,
    path,
    noteId: `${INBOX}/${final.slice(0, final.length - extname(final).length)}`,
  };
}
