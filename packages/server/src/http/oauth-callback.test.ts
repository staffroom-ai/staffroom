/**
 * The page an OAuth provider sends the owner's browser back to.
 *
 * This route is unusual: it carries no session token, because the redirect comes
 * from somebody else's website. The `state` is therefore the only thing standing
 * between a sign-in the office started and any other page the owner happens to
 * have open. It is worth testing on its own.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secretsDir } from "@staffroom/core";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type StaffroomServer } from "../index.js";

const servers: StaffroomServer[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function office(): Promise<{ server: StaffroomServer; dir: string; base: string }> {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-oauth-http-"));
  dirs.push(dir);
  copyTemplate("studio", dir);

  const server = await createServer({
    officeDir: dir,
    port: 0,
    watch: false,
    demoRunsDir: join(templateDir("studio"), "demo-runs"),
  });
  servers.push(server);
  return { server, dir, base: server.url.replace(/\/\?t=.*$/, "") };
}

function tokenFiles(dir: string): string[] {
  const path = secretsDir(dir);
  return existsSync(path) ? readdirSync(path) : [];
}

describe("the OAuth callback", () => {
  it("refuses a state the office never issued, and stores nothing", async () => {
    const { dir, base } = await office();

    const response = await fetch(`${base}/api/mcp/oauth/callback?state=not-ours&code=some-code`);

    expect(response.status).toBe(400);
    // The important half: no token file appears for a callback we did not start.
    expect(tokenFiles(dir)).toEqual([]);
  });

  it("refuses a callback with no state at all", async () => {
    const { dir, base } = await office();
    const response = await fetch(`${base}/api/mcp/oauth/callback?code=some-code`);
    expect(response.status).toBe(400);
    expect(tokenFiles(dir)).toEqual([]);
  });

  it("refuses a state we issued when there is no code with it", async () => {
    const { server, dir, base } = await office();
    const state = server.office.mcp.pending.issue("notion");

    const response = await fetch(`${base}/api/mcp/oauth/callback?state=${state}`);
    expect(response.status).toBe(400);
    expect(tokenFiles(dir)).toEqual([]);
  });

  it("reports the provider's own refusal rather than a blank page", async () => {
    const { base } = await office();
    const response = await fetch(`${base}/api/mcp/oauth/callback?error=access_denied&state=x`);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("access_denied");
  });

  it("uses a state exactly once, so a replayed link is refused", async () => {
    const { server, base } = await office();
    const state = server.office.mcp.pending.issue("notion");

    const first = await fetch(`${base}/api/mcp/oauth/callback?state=${state}&code=abc`);
    expect(first.status).toBe(200);

    // The same link opened again, from history or a shared tab.
    const second = await fetch(`${base}/api/mcp/oauth/callback?state=${state}&code=abc`);
    expect(second.status).toBe(400);
  });

  it("does not put the code into the page it returns", async () => {
    const { server, base } = await office();
    const state = server.office.mcp.pending.issue("notion");

    const response = await fetch(
      `${base}/api/mcp/oauth/callback?state=${state}&code=a-secret-code`,
    );
    expect(await response.text()).not.toContain("a-secret-code");
  });
});
