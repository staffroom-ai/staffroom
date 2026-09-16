/**
 * Putting a file into the brain from the browser.
 *
 * The thing worth protecting is the token. This is the one request the office
 * makes that writes a file, and it is refused without the session token in the
 * header — so a version of this that forgot to send it would fail in a way that
 * looks like a server bug, and the fix would be to weaken the server.
 *
 * The rest is about the failure path. An upload that silently does nothing is
 * the worst outcome here, because the owner has no reason to look in the folder
 * and check.
 */
import type { BrainGraph, BrainGraphEdge } from "@staffroom/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chainFor, uploadToBrain } from "./upload.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Sent {
  url: string;
  init: RequestInit;
}

/** Records the request and answers with whatever the test wants. */
function mockFetch(response: { status: number; body?: unknown }): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(JSON.stringify(response.body ?? {}), { status: response.status });
    }),
  );
  return sent;
}

const file = (name = "notes.md", text = "# Notes\n"): File =>
  new File([text], name, { type: "text/markdown" });

describe("uploading a file", () => {
  it("sends the session token, which the office refuses the request without", async () => {
    const sent = mockFetch({ status: 201, body: { ok: true } });
    await uploadToBrain(file(), "the-token");

    const headers = sent[0]?.init.headers as Record<string, string>;
    expect(headers["X-Staffroom-Token"]).toBe("the-token");
  });

  it("posts to the brain's own route", async () => {
    const sent = mockFetch({ status: 201 });
    await uploadToBrain(file(), "t");

    expect(sent[0]?.url).toBe("/api/brain/upload");
    expect(sent[0]?.init.method).toBe("POST");
  });

  it("sends it as a form, carrying the filename", async () => {
    const sent = mockFetch({ status: 201 });
    await uploadToBrain(file("Meeting Notes.md"), "t");

    const body = sent[0]?.init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    // The filename is the only thing the browser can say about what this is, and
    // the route reads it back out to decide the note's name.
    const part = body.get("file") as File;
    expect(part.name).toBe("Meeting Notes.md");
  });

  it("does not invent a header when there is no token", async () => {
    const sent = mockFetch({ status: 201 });
    await uploadToBrain(file(), undefined);

    expect(Object.keys(sent[0]?.init.headers as Record<string, string>)).toEqual([]);
  });

  it("says nothing when it worked, because there is nothing to say", async () => {
    mockFetch({ status: 201, body: { ok: true } });
    expect(await uploadToBrain(file(), "t")).toBeUndefined();
  });

  it("passes on the reason the office gave, rather than a generic failure", async () => {
    mockFetch({ status: 415, body: { error: "only .md, .txt, .pdf files can be added" } });
    expect(await uploadToBrain(file("a.exe"), "t")).toContain(".md");
  });

  it("still says something when the office refused without saying why", async () => {
    mockFetch({ status: 500, body: {} });
    expect(await uploadToBrain(file("notes.md"), "t")).toContain("notes.md");
  });

  it("says the office did not answer, rather than throwing at the caller", async () => {
    // A failed upload that surfaces as an unhandled rejection is an upload the
    // owner is never told about.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const failure = await uploadToBrain(file(), "t");
    expect(failure).toContain("did not answer");
  });
});

describe("which draft am I looking at", () => {
  function graph(edges: BrainGraphEdge[]): BrainGraph {
    return { generatedAt: "2026-01-01T00:00:00.000Z", nodes: [], edges };
  }

  const chain = graph([
    { from: "d/v2", to: "d/v1", kind: "revises" },
    { from: "d/v3", to: "d/v2", kind: "revises" },
    { from: "other", to: "d/v1", kind: "link" },
  ]);

  it("reads the same chain from either end of it", () => {
    for (const id of ["d/v1", "d/v2", "d/v3"]) {
      expect(chainFor(chain, id)).toEqual(["d/v1", "d/v2", "d/v3"]);
    }
  });

  it("ignores an ordinary link, which is a reference rather than history", () => {
    expect(chainFor(chain, "other")).toBeUndefined();
  });

  it("says nothing for a note that was never revised", () => {
    expect(chainFor(graph([]), "d/v1")).toBeUndefined();
  });

  it("says nothing before the office has sent a graph", () => {
    expect(chainFor(undefined, "d/v1")).toBeUndefined();
  });

  it("stops rather than spinning on a chain somebody typed into a loop", () => {
    // Front matter is the owner's to write and nothing stops them typing this.
    const loop = graph([
      { from: "a", to: "b", kind: "revises" },
      { from: "b", to: "a", kind: "revises" },
    ]);
    expect(chainFor(loop, "a")?.length).toBeLessThanOrEqual(2);
  });
});
