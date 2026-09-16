/**
 * The approval card, actually rendered.
 *
 * Rendered with react-dom/server rather than a testing library, because the
 * things worth asserting here are what the card says and which buttons exist —
 * and adding a whole component-testing stack to check that would be a bigger
 * change than the card itself. The interaction logic lives in always-allow.ts
 * and is tested directly there.
 */

import type { PendingApprovalView } from "@staffroom/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalCard } from "./ApprovalCard.js";

function approval(over: Partial<PendingApprovalView> = {}): PendingApprovalView {
  return {
    id: "ap1",
    runId: "r1",
    agentId: "copywriter",
    agentName: "Priya",
    tool: { name: "send_sms", source: "custom", scope: "write" },
    input: { to: "+61400000000", body: "The banners are ready." },
    preview: {
      action: "Send a text message.",
      destination: "+61400000000",
      summary: "Texts a number.",
      body: "to: +61400000000\nbody: The banners are ready.",
      irreversible: true,
    },
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...over,
  } as PendingApprovalView;
}

function render(view: PendingApprovalView, days?: number): string {
  return renderToStaticMarkup(
    createElement(ApprovalCard, {
      approval: view,
      onDecide: () => {},
      ...(days === undefined ? {} : { whitelistDays: days }),
    }),
  );
}

describe("what the card offers", () => {
  it("has all three choices, and says how long always lasts", () => {
    const html = render(approval());
    expect(html).toContain("Approve once");
    expect(html).toContain("Decline");
    // The duration is on the button, not buried in a tooltip: it is part of the
    // decision being made.
    expect(html).toContain("Always allow (90 days)");
  });

  it("takes the office's own expiry rather than assuming ninety days", () => {
    expect(render(approval(), 30)).toContain("Always allow (30 days)");
  });

  it("shows the whole body, never a summary of it", () => {
    const html = render(approval());
    expect(html).toContain("The banners are ready.");
    expect(html).toContain("+61400000000");
  });

  it("warns before the buttons that this cannot be undone", () => {
    const html = render(approval());
    expect(html).toContain("cannot be undone");
    expect(html.indexOf("cannot be undone")).toBeLessThan(html.indexOf("Approve once"));
  });
});

describe("a tool on somebody else's server", () => {
  it("carries the line saying we cannot see what it will do", () => {
    const html = render(
      approval({
        tool: { name: "gmail.send_email", source: "mcp", scope: "write" },
        preview: {
          action: "Sends an email.",
          destination: "gmail (MCP server at https://mcp.example.com)",
          summary:
            "Staffroom cannot see what this server will do with these fields; approve only if you trust it.",
          body: "to: a@acme.com",
          irreversible: true,
        },
      } as Partial<PendingApprovalView>),
    );

    expect(html).toContain("Staffroom cannot see what this server will do");
    expect(html).toContain("MCP server at https://mcp.example.com");
  });

  it("does not show that line for an ordinary tool", () => {
    expect(render(approval())).not.toContain("Staffroom cannot see");
  });
});

describe("a tool that changed since it was allowed", () => {
  it("says so in as many words", () => {
    const html = render(
      approval({
        preview: {
          ...approval().preview,
          changedSinceAllowed: "Please look again.",
        },
      } as Partial<PendingApprovalView>),
    );
    expect(html).toContain("This tool changed since you allowed it.");
  });

  it("says nothing of the sort when it has not", () => {
    expect(render(approval())).not.toContain("changed since you allowed");
  });
});
