import { describe, expectTypeOf, it } from "vitest";
import type {
  ApprovalBy,
  ApprovalDecision,
  ApprovalPreview,
  BrainReader,
  ToolSource,
} from "./types.js";

describe("shared types", () => {
  it("keeps ApprovalDecision a closed union", () => {
    expectTypeOf<ApprovalDecision>().toEqualTypeOf<
      "approve" | "approve_always" | "deny" | "expired" | "cancelled"
    >();
  });

  it("keeps ApprovalBy a closed union", () => {
    expectTypeOf<ApprovalBy>().toEqualTypeOf<"owner" | "system" | "whitelist">();
  });

  it("discriminates ToolSource on kind", () => {
    const mcp: ToolSource = { kind: "mcp", server: "notion" };
    if (mcp.kind === "mcp") expectTypeOf(mcp.server).toEqualTypeOf<string>();
  });

  it("requires irreversible on every approval preview", () => {
    expectTypeOf<ApprovalPreview>().toHaveProperty("irreversible").toEqualTypeOf<boolean>();
  });

  it("gives BrainReader the three read methods", () => {
    expectTypeOf<BrainReader>().toHaveProperty("search");
    expectTypeOf<BrainReader>().toHaveProperty("read");
    expectTypeOf<BrainReader>().toHaveProperty("list");
  });
});
