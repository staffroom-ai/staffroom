/**
 * The brain, as a picture.
 *
 * This is the one view that answers "what does the office actually know?", and
 * the answer has to include what it does not know. Notes nobody wrote show as
 * outlines, template filler is dimmed, and nothing here tidies a gap away to
 * make the picture look better connected than the brain is.
 *
 * It is SVG rather than canvas because every node has to be a real element: the
 * graph is tabbable, each dot carries a sentence describing what the colour and
 * the ring are saying, and Enter opens the note. A canvas would be a picture
 * nobody using a keyboard could read.
 */
import type { BrainGraph, BrainGraphNode } from "@staffroom/core";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { layout, type Placed, tabOrder } from "../graph/layout.js";
import { matchingIds } from "../graph/patch.js";
import {
  acceptsUpload,
  describeNode,
  recentDeliverables,
  styleFor,
  UPLOAD_REFUSED,
  UPLOAD_TYPES,
} from "../graph/style.js";

const WIDTH = 1000;
const HEIGHT = 700;
/** Long enough that a burst of typing is one search, short enough to feel live. */
export const SEARCH_DEBOUNCE_MS = 150;

export interface GraphOverlayProps {
  graph: BrainGraph | undefined;
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
  onUpload: (file: File) => void;
  /** Shown when an upload is refused before it is sent. */
  onRefuse: (message: string) => void;
}

export function GraphOverlay({
  graph,
  onClose,
  onOpenNote,
  onUpload,
  onRefuse,
}: GraphOverlayProps): ReactElement {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [focused, setFocused] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];

  /*
   * Laid out when the brain changes, and not when anything else does.
   *
   * These arrays only get a new identity when the office actually pushes a
   * change, so this is enough: typing in the search box re-renders without
   * relaying out, and a force layout that reruns is a picture that jumps under
   * the cursor of whoever is reading it.
   */
  const placed = useMemo(
    () => layout(nodes, edges, { width: WIDTH, height: HEIGHT }),
    [nodes, edges],
  );

  const positions = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const matches = useMemo(() => matchingIds(nodes, debounced), [nodes, debounced]);
  const recent = useMemo(() => recentDeliverables(nodes), [nodes]);
  const order = useMemo(() => tabOrder(nodes), [nodes]);

  const chooseFile = (file: File | undefined): void => {
    if (file === undefined) return;
    if (!acceptsUpload(file.name)) {
      onRefuse(UPLOAD_REFUSED);
      return;
    }
    onUpload(file);
  };

  return (
    <section
      className="graph-overlay"
      aria-label="What this office knows"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        chooseFile(event.dataTransfer.files[0]);
      }}
    >
      <header className="graph-head">
        <h2 className="graph-title">What this office knows</h2>

        <input
          type="search"
          className="graph-search"
          placeholder="Search your notes"
          aria-label="Search your notes"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <span className="graph-count">
          {nodes.length} {nodes.length === 1 ? "note" : "notes"}
        </span>

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
            // Cleared so choosing the same file twice fires again.
            event.target.value = "";
          }}
        />

        <button type="button" className="btn-quiet" onClick={onClose}>
          Close
        </button>
      </header>

      {graph === undefined ? (
        <p className="graph-empty">Reading your notes…</p>
      ) : nodes.length === 0 ? (
        <p className="graph-empty">
          There is nothing in the brain yet. Add a file, or give somebody a task.
        </p>
      ) : (
        <svg
          className="graph-canvas"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          aria-label={`${nodes.length} notes`}
        >
          {/* The accessible name of the drawing as a whole. Each node carries its
              own; this is what the picture is. */}
          <title>Your notes and the links between them</title>

          {/* The arrows carry no text, so there is nothing here to announce. */}
          <g className="graph-edges">
            {edges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (from === undefined || to === undefined) return null;
              return (
                <line
                  key={`${edge.from}->${edge.to}:${edge.kind}`}
                  className={`graph-edge graph-edge-${edge.kind}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                />
              );
            })}
          </g>

          {placed.map((item) => (
            <Node
              key={item.id}
              placed={item}
              faded={!matches.has(item.id)}
              recent={recent.has(item.id)}
              focused={focused === item.id}
              tabIndex={order.indexOf(item.id) === 0 ? 0 : -1}
              onFocus={() => setFocused(item.id)}
              onOpen={() => onOpenNote(item.id)}
            />
          ))}
        </svg>
      )}

      {dragging && <p className="graph-drop">Drop it here to add it to the brain</p>}
    </section>
  );
}

function Node({
  placed,
  faded,
  recent,
  focused,
  tabIndex,
  onFocus,
  onOpen,
}: {
  placed: Placed;
  faded: boolean;
  recent: boolean;
  focused: boolean;
  tabIndex: number;
  onFocus: () => void;
  onOpen: () => void;
}): ReactElement {
  const node: BrainGraphNode = placed.node;
  const style = styleFor(node);
  const radius = recent ? style.radius * 1.35 : style.radius;

  const classes = [
    "graph-node",
    style.dim ? "is-sample" : "",
    style.outline ? "is-missing" : "",
    faded ? "is-faded" : "",
    recent ? "is-recent" : "",
    focused ? "is-focused" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // A button rather than a list item: every one of these opens a note, and
    // that is what somebody arriving on it with a keyboard needs told. SVG has
    // no button element, so the role is the only way to say it.
    // biome-ignore lint/a11y/useSemanticElements: SVG has no <button>.
    <g
      className={classes}
      role="button"
      transform={`translate(${placed.x} ${placed.y})`}
      tabIndex={tabIndex}
      // The whole sentence, because somebody moving through this with a screen
      // reader gets no colour, no size and no ring.
      aria-label={describeNode(node)}
      onFocus={onFocus}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {style.ring !== undefined && (
        <circle className="graph-ring" r={radius + 4} style={{ stroke: `var(${style.ring})` }} />
      )}
      <circle
        className="graph-dot"
        r={radius}
        style={style.outline ? undefined : { fill: `var(${style.fill})` }}
      />
      <text className="graph-label" y={radius + 13}>
        {node.title.length > 28 ? `${node.title.slice(0, 28)}…` : node.title}
      </text>
    </g>
  );
}
