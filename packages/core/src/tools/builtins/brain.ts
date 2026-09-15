/**
 * The four brain tools every agent gets without listing them.
 *
 * brain_write is `local: true`: it creates a draft on this machine and nothing
 * leaves, so it is recorded but never waits for approval. It also has no path
 * field, which is what stops an agent writing anywhere but its own department's
 * deliverables folder.
 */
import { z } from "zod";
import { writeDeliverable } from "../../brain/write.js";
import { type Tool, tool } from "../tool.js";

export interface BrainToolsOptions {
  brainDir: string;
  /** Resolved at call time so a rename between runs is picked up. */
  departmentFor: (agentId: string) => string;
}

export function brainTools(options: BrainToolsOptions): Tool[] {
  const search = tool({
    name: "brain_search",
    description:
      "Search the business's notes. Use this before answering anything that depends on how this business works.",
    input: z.object({
      query: z.string().min(1).describe("What to look for, in plain words."),
      limit: z.number().int().min(1).max(20).optional(),
      area: z
        .string()
        .optional()
        .describe("Restrict to one top-level folder, such as 10-customers."),
    }),
    scope: "read",
    run: async (input, ctx) => {
      const { query, limit, area } = input as { query: string; limit?: number; area?: string };
      const hits = await ctx.brain.search(query, {
        ...(limit === undefined ? {} : { limit }),
        ...(area === undefined ? {} : { area }),
      });
      return { notes: hits, noteIds: hits.map((h) => h.id) };
    },
  });

  const read = tool({
    name: "brain_read",
    description: "Read one note in full, by its id, as returned by brain_search or brain_list.",
    input: z.object({ id: z.string().min(1) }),
    scope: "read",
    run: async (input, ctx) => {
      const note = await ctx.brain.read((input as { id: string }).id);
      if (note === null) return { found: false, noteIds: [] };
      return { found: true, note, noteIds: [note.id] };
    },
  });

  const list = tool({
    name: "brain_list",
    description:
      "List note titles, to see what exists before searching for words that may not appear.",
    input: z.object({
      area: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    scope: "read",
    run: async (input, ctx) => {
      const { area, limit } = input as { area?: string; limit?: number };
      const notes = await ctx.brain.list({
        ...(area === undefined ? {} : { area }),
        limit: Math.min(limit ?? 50, 50),
      });
      return { notes, noteIds: notes.map((n) => n.id) };
    },
  });

  const write = tool({
    name: "brain_write",
    description:
      "File a finished deliverable in the business's notes. Creates a new draft; it never edits an existing note.",
    input: z.object({
      title: z.string().min(1).max(120),
      body: z.string().min(1).describe("The deliverable itself, as markdown."),
      revises: z.string().optional().describe("Note id this replaces, if it is a revision."),
    }),
    scope: "write",
    // Stays on this machine, so it is recorded rather than blocking.
    local: true,
    run: async (input, ctx) => {
      const { title, body, revises } = input as { title: string; body: string; revises?: string };
      const written = writeDeliverable(options.brainDir, {
        title,
        body,
        department: options.departmentFor(ctx.agentId),
        agentId: ctx.agentId,
        runId: ctx.runId,
        ...(revises === undefined ? {} : { revises }),
      });
      return { noteId: written.id, noteIds: [written.id] };
    },
  });

  return [
    { ...search, source: { kind: "builtin" } },
    { ...read, source: { kind: "builtin" } },
    { ...list, source: { kind: "builtin" } },
    { ...write, source: { kind: "builtin" } },
  ] as Tool[];
}
