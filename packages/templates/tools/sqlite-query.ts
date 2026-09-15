/**
 * Ask a question of a SQLite database you already have.
 *
 * Read queries only, and that is enforced rather than requested: the statement is
 * prepared and rejected if SQLite says it would write. Point DB_PATH at your file.
 *
 * TRY IT: How many rows are in the orders table?
 */

import { tool } from "@staffroom/core";
import Database from "better-sqlite3";
import { z } from "zod";

const DB_PATH = process.env["STAFFROOM_SQLITE_PATH"] ?? "data/business.sqlite";
const MAX_ROWS = 200;

export default tool({
  name: "sqlite_query",
  description: "Run a read-only SQL query against the business database and return the rows.",
  input: z.object({
    sql: z.string().describe("A SELECT statement."),
    params: z.array(z.union([z.string(), z.number()])).optional(),
  }),
  scope: "read",
  run: async ({ sql, params }) => {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    try {
      const statement = db.prepare(sql);
      // SQLite itself decides what counts as a write, so no keyword list to outwit.
      if (!statement.readonly) return { error: "This tool only runs read queries." };
      const rows = statement.all(...(params ?? [])) as unknown[];
      return { rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS };
    } finally {
      db.close();
    }
  },
});
