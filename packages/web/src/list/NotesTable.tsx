/**
 * The brain as a table, for anybody the picture does not serve.
 *
 * The graph is the better view when the question is "how is this connected?",
 * and the worse one when the question is "what is in here?" — a force layout has
 * no order anybody can predict, which makes it hard to scan and impossible to
 * read aloud in a useful sequence. This is the same notes, sorted, with the same
 * Add a file button.
 *
 * Not a fallback and not a degraded mode: on a narrow window it is the only view
 * there is room for, and it is a perfectly good way to look at a brain.
 */
import type { BrainGraph, BrainGraphNode } from "@staffroom/core";
import { type ReactElement, useRef } from "react";
import { acceptsUpload, UPLOAD_REFUSED, UPLOAD_TYPES } from "../graph/style.js";

/** Areas first, then titles: the folders the owner made are an order they know. */
function ordered(nodes: BrainGraphNode[]): BrainGraphNode[] {
  return [...nodes].sort((a, b) => {
    if (a.area !== b.area) return a.area.localeCompare(b.area);
    return a.title.localeCompare(b.title);
  });
}

function whoWrote(node: BrainGraphNode): string {
  if (node.kind === "missing") return "nobody";
  return node.writtenBy === "owner" ? "you" : node.writtenBy.slice(6);
}

export function NotesTable({
  graph,
  onOpenNote,
  onUpload,
  onRefuse,
}: {
  graph: BrainGraph | undefined;
  onOpenNote: (noteId: string) => void;
  onUpload: (file: File) => void;
  onRefuse: (message: string) => void;
}): ReactElement {
  const fileInput = useRef<HTMLInputElement>(null);

  const chooseFile = (file: File | undefined): void => {
    if (file === undefined) return;
    if (!acceptsUpload(file.name)) {
      onRefuse(UPLOAD_REFUSED);
      return;
    }
    onUpload(file);
  };

  const nodes = ordered(graph?.nodes ?? []);

  return (
    <section aria-labelledby="notes-heading">
      <div className="list-head">
        <h2 id="notes-heading" className="list-heading">
          What this office knows
        </h2>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          Add a file
        </button>
        <input
          ref={fileInput}
          type="file"
          className="visually-hidden"
          accept={UPLOAD_TYPES.join(",")}
          onChange={(event) => {
            chooseFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      {graph === undefined ? (
        <p className="list-empty">Reading your notes…</p>
      ) : nodes.length === 0 ? (
        <p className="list-empty">
          There is nothing in the brain yet. Add a file, or give somebody a task.
        </p>
      ) : (
        <table className="notes-table">
          <caption className="visually-hidden">{nodes.length} notes, by folder then title</caption>
          <thead>
            <tr>
              <th scope="col">Note</th>
              <th scope="col">Where</th>
              <th scope="col">Written by</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id} className={node.kind === "sample" ? "is-sample" : undefined}>
                <th scope="row">
                  {node.kind === "missing" ? (
                    // Nothing to open: there is no note behind this row, which is
                    // the whole reason it is in the table.
                    <span className="notes-missing">{node.title}</span>
                  ) : (
                    <button type="button" className="btn-link" onClick={() => onOpenNote(node.id)}>
                      {node.title}
                    </button>
                  )}
                </th>
                <td>{node.area}</td>
                <td>{whoWrote(node)}</td>
                <td>
                  {node.kind === "missing"
                    ? "linked to, never written"
                    : (node.status ?? (node.pinned ? "pinned" : "—"))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
