/**
 * "Approve and always allow", from the office.
 *
 * The rule this protects: a permission has to say what it is permitting. A
 * decision arriving with no match would mean "any input to this tool from now
 * on", which is not what somebody clicking a button on one message means, so the
 * server refuses it rather than guessing.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalsPath } from "@staffroom/core";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type StaffroomServer } from "../index.js";
import { handle } from "./handlers.js";

const servers: StaffroomServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function office(): Promise<{ server: StaffroomServer; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-always-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  const server = await createServer({
    officeDir: dir,
    port: 0,
    watch: false,
    demoRunsDir: join(templateDir("studio"), "demo-runs"),
  });
  servers.push(server);
  return { server, dir };
}

describe("approve_always", () => {
  it("is refused without a match, and nothing is written", async () => {
    const { server, dir } = await office();

    const result = await handle(server.office, {
      type: "approval.decide",
      reqId: "r1",
      approvalId: "any",
      decision: "approve_always",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MATCH_REQUIRED");
    // Refused before it ever reached the approval, so no permission was recorded.
    expect(readFileSync(approvalsPath(dir), "utf8")).toContain("allow: []");
  });

  it("says what to do instead of only saying no", async () => {
    const { server } = await office();
    const result = await handle(server.office, {
      type: "approval.decide",
      reqId: "r1",
      approvalId: "any",
      decision: "approve_always",
    });
    expect(result.error?.hint).toContain("recipient");
  });

  it("with a match, reaches the approval and reports it is no longer pending", async () => {
    const { server } = await office();

    // No approval is waiting, so this proves the message got past the guard and
    // into the registry rather than being refused for the wrong reason.
    const result = await handle(server.office, {
      type: "approval.decide",
      reqId: "r1",
      approvalId: "not-a-real-one",
      decision: "approve_always",
      match: { to: "*@acme.com" },
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_NOT_PENDING");
  });

  it("still lets a plain approve through without a match", async () => {
    const { server } = await office();
    const result = await handle(server.office, {
      type: "approval.decide",
      reqId: "r1",
      approvalId: "not-a-real-one",
      decision: "approve",
    });
    expect(result.error?.code).toBe("APPROVAL_NOT_PENDING");
  });
});

describe("taking a permission back", () => {
  it("re-reads approvals.yaml when the owner edits it", async () => {
    const { server, dir } = await office();

    server.office.whitelist.grant({
      agentId: "copywriter",
      tool: "send_email",
      match: { to: "*@acme.com" },
    });
    expect(server.office.whitelist.list()).toHaveLength(1);

    // The file is the owner's, and deleting a row is how a permission is taken
    // back. It must not need a restart.
    rmSync(approvalsPath(dir));
    server.office.whitelist.reload();
    expect(server.office.whitelist.list()).toEqual([]);
  });
});
