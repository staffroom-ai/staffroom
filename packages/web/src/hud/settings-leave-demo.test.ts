/**
 * The sample-content card in Settings, actually rendered.
 *
 * Rendered with react-dom/server for the same reason as the approval card: what
 * matters here is what the card says and which buttons exist. The question text
 * itself comes from the server, so the card is never in a position to invent a
 * business name or soften what it is offering to do.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Settings } from "./Settings.js";

const QUESTION =
  "Remove the sample notes and runs from Northlight Studio? Your own notes are kept. (Recommended)";

function render(over: { sampleQuestion?: string | null; sampleBusy?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(Settings, {
      mode: "live",
      states: {},
      routines: [],
      routineActions: { onPause: () => {}, onRunNow: () => {}, onDelete: () => {} },
      onAnswerSamples: () => {},
      onSave: () => {},
      onClose: () => {},
      sampleQuestion: null,
      ...over,
    } as Parameters<typeof Settings>[0]),
  );
}

describe("the sample-content card", () => {
  it("is not there when there is nothing to ask", () => {
    const html = render();
    expect(html).not.toContain("Remove them");
    expect(html).not.toContain("Keep them");
  });

  it("shows the server's question word for word", () => {
    // The office name in it is the whole reason it is answerable, and only the
    // server knows it. A card that wrote its own wording would eventually say
    // something the office cannot do.
    expect(render({ sampleQuestion: QUESTION })).toContain(QUESTION);
  });

  it("offers both answers, not one button and a close box", () => {
    const html = render({ sampleQuestion: QUESTION });
    expect(html).toContain("Remove them");
    expect(html).toContain("Keep them");
  });

  it("says where the notes go and that nothing is deleted", () => {
    // "Remove" is a frightening word for somebody's only copy of anything. The
    // card has to say, on the card, that the files survive.
    const html = render({ sampleQuestion: QUESTION });
    expect(html).toContain("90-archive/_sample/");
    expect(html).toContain("Nothing is deleted from disk.");
  });

  it("disables both answers while the office is working on the last one", () => {
    const html = render({ sampleQuestion: QUESTION, sampleBusy: true });
    // Two clicks would be two moves over the same files.
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Removing…");
  });

  it("sits above the key fields, since it is about the office already open", () => {
    const html = render({ sampleQuestion: QUESTION });
    expect(html.indexOf("Remove them")).toBeLessThan(html.indexOf("Anthropic"));
  });

  it("still shows the provider rows, so the card never blocks the screen", () => {
    const html = render({ sampleQuestion: QUESTION });
    for (const name of ["Anthropic", "OpenAI", "Ollama"]) expect(html).toContain(name);
  });
});
