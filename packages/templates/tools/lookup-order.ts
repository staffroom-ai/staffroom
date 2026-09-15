/**
 * Look up an order in your own system.
 *
 * This one is a stub with three fake orders so it runs out of the box. Replace
 * the body of `run` with a call to your real system: a fetch to your API, a
 * database query, whatever you already have.
 *
 * TRY IT: What is the status of order 1002?
 */
import { tool } from "@staffroom/core";
import { z } from "zod";

const ORDERS: Record<string, { status: string; items: string[]; customer: string }> = {
  "1001": { status: "shipped", items: ["Sourdough x2"], customer: "Acme Bakery" },
  "1002": { status: "packing", items: ["Banner, 2m"], customer: "Harlow and Co" },
  "1003": { status: "cancelled", items: ["Sign, A1"], customer: "Bright Electrical" },
};

export default tool({
  name: "lookup_order",
  description: "Find an order by its number and return its status, customer and items.",
  input: z.object({
    orderNumber: z.string().describe("The order number, for example 1002."),
  }),
  // Reads only, so it runs without asking the owner.
  scope: "read",
  run: async ({ orderNumber }) => {
    const order = ORDERS[orderNumber];
    if (order === undefined) return { found: false, orderNumber };
    return { found: true, orderNumber, ...order };
  },
});
