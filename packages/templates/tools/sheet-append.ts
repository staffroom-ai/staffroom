/**
 * Append a row to a CSV in office/data/.
 *
 * A write, but a local one: the file never leaves this computer, so the office
 * records it rather than stopping to ask. Change `local` to false if you want to
 * approve every row.
 *
 * TRY IT: Add a row to leads.csv with today's date and Acme Bakery.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tool } from "@staffroom/core";
import { z } from "zod";

/** Everything stays under office/data/, whatever file name is asked for. */
const DATA_DIR = resolve(process.cwd(), "data");

function safePath(file: string): string {
  const target = resolve(DATA_DIR, file.replace(/^\/+/, ""));
  if (!target.startsWith(DATA_DIR))
    throw new Error("Files can only be written inside office/data.");
  return target;
}

export default tool({
  name: "sheet_append",
  description: "Add one row to a CSV file in your office's data folder.",
  input: z.object({
    file: z.string().describe("File name, for example leads.csv."),
    row: z.array(z.string()).describe("The cells, left to right."),
    header: z.array(z.string()).optional().describe("Written once if the file is new."),
  }),
  scope: "write",
  local: true,
  preview: ({ file, row }) => ({
    action: "Add a row",
    destination: `office/data/${file}`,
    summary: `Adds one row to ${file} on this computer.`,
    body: row.join(", "),
    irreversible: false,
  }),
  run: async ({ file, row, header }) => {
    const path = safePath(file);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path) && header !== undefined)
      writeFileSync(path, `${header.join(",")}\n`, "utf8");
    appendFileSync(path, `${row.map((c) => (c.includes(",") ? `"${c}"` : c)).join(",")}\n`, "utf8");
    return { written: true, file: join("data", file) };
  },
});
