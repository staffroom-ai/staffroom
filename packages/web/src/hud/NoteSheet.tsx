/**
 * One note from the brain, read in place.
 *
 * The deliverable card can say what was written; this is where you read it
 * without leaving the office. It is deliberately a reader and not an editor: the
 * file on disk is the original, and the office should never be the only place a
 * piece of work exists.
 */
import { type ReactElement, useEffect, useState } from "react";

export interface NoteContent {
  frontMatter: Array<[string, string]>;
  body: string;
}

/**
 * Split the YAML front matter off the top without pulling in a parser. Only the
 * scalar `key: value` lines are shown, because that is all the brain writes and
 * a half-rendered nested structure would be worse than omitting it.
 */
export function parseNote(raw: string): NoteContent {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (match === null) return { frontMatter: [], body: raw };

  const frontMatter: Array<[string, string]> = [];
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (pair === null) continue;
    const value = (pair[2] ?? "").replace(/^["']|["']$/g, "");
    if (value.length > 0) frontMatter.push([pair[1] as string, value]);
  }

  return { frontMatter, body: raw.slice(match[0].length) };
}

/** Enough markdown for a deliverable: headings, bullets, and paragraphs. */
function Markdown({ body }: { body: string }): ReactElement {
  const blocks = body.split(/\n{2,}/).filter((block) => block.trim().length > 0);

  return (
    <div className="note-body">
      {blocks.map((block, index) => {
        const key = `${index}-${block.slice(0, 24)}`;
        const heading = /^(#{1,6})\s+(.*)$/.exec(block.trim());
        if (heading !== null) {
          const level = Math.min(6, (heading[1] as string).length);
          const Tag = `h${level === 1 ? 2 : level}` as "h2" | "h3" | "h4" | "h5" | "h6";
          return (
            <Tag key={key} className="note-heading">
              {heading[2]}
            </Tag>
          );
        }

        const lines = block.split(/\r?\n/);
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <ul key={key} className="note-list">
              {lines.map((line) => (
                <li key={line}>{line.replace(/^\s*[-*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={key} className="note-para">
            {block}
          </p>
        );
      })}
    </div>
  );
}

export function NoteSheet({
  noteId,
  token,
  revealLabel,
  onReveal,
  onClose,
}: {
  noteId: string;
  token: string | undefined;
  revealLabel: string;
  onReveal: () => void;
  onClose: () => void;
}): ReactElement {
  const [note, setNote] = useState<NoteContent | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  // Esc closes, because a sheet that traps you is worse than no sheet.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setNote(undefined);
    setFailure(undefined);

    const headers: Record<string, string> = {};
    if (token !== undefined) headers["X-Staffroom-Token"] = token;

    fetch(`/api/brain/file?path=${encodeURIComponent(`${noteId}.md`)}`, { headers })
      .then(async (response) => {
        if (!live) return;
        if (response.status === 404) {
          setFailure("This note is no longer in the brain.");
          return;
        }
        if (!response.ok) {
          setFailure("That note could not be read.");
          return;
        }
        setNote(parseNote(await response.text()));
      })
      .catch(() => {
        if (live) setFailure("That note could not be read.");
      });

    return () => {
      live = false;
    };
  }, [noteId, token]);

  return (
    <aside className="sheet" aria-label={`Note ${noteId}`}>
      <header className="sheet-head">
        <h2 className="sheet-title">{noteId}</h2>
        <div className="sheet-actions">
          <button type="button" className="btn-quiet" onClick={onReveal}>
            {revealLabel}
          </button>
          <button type="button" className="btn-quiet" onClick={onClose} aria-label="Close note">
            Close
          </button>
        </div>
      </header>

      <div className="sheet-scroll">
        {failure !== undefined && <p className="sheet-failure">{failure}</p>}

        {note !== undefined && (
          <>
            {note.frontMatter.length > 0 && (
              <dl className="note-meta">
                {note.frontMatter.map(([key, value]) => (
                  <div className="note-meta-row" key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <Markdown body={note.body} />
          </>
        )}

        {note === undefined && failure === undefined && <p className="sheet-failure">Reading…</p>}
      </div>
    </aside>
  );
}
