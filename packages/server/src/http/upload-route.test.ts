/**
 * The upload route as a browser reaches it.
 *
 * upload.test.ts covers what is allowed to land on disk. This covers who is
 * allowed to put it there, which is the half that matters if the office is ever
 * reachable from anything but the owner's own tab: without the token and the
 * Origin check, any page the owner happened to have open could post a file into
 * their brain and then ask an agent to read it.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { TOKEN_HEADER } from "../auth.js";
import { createServer, type StaffroomServer } from "../index.js";

const servers: StaffroomServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function office(): Promise<{ server: StaffroomServer; dir: string; base: string }> {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-upload-http-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  const server = await createServer({
    officeDir: dir,
    port: 0,
    watch: false,
    demoRunsDir: join(templateDir("studio"), "demo-runs"),
  });
  servers.push(server);
  return { server, dir, base: `http://127.0.0.1:${server.port}` };
}

const BOUNDARY = "----staffroomtest";

function multipart(filename: string, content: string): Buffer {
  return Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      "Content-Type: text/markdown\r\n\r\n" +
      `${content}\r\n--${BOUNDARY}--`,
  );
}

/**
 * A browser's POST, which always carries an Origin. Node's fetch does not send
 * one on its own, and a POST without one is refused — correctly, so each test
 * below is isolating the thing it names rather than tripping over that.
 */
async function post(
  base: string,
  token: string | undefined,
  body: Buffer,
  extra: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
    origin: base,
    ...extra,
  };
  if (token !== undefined) headers[TOKEN_HEADER] = token;
  // Buffer is a Uint8Array; fetch's types want the view rather than the alias.
  return await fetch(`${base}/api/brain/upload`, {
    method: "POST",
    headers,
    body: new Uint8Array(body),
  });
}

describe("who may add a file to the brain", () => {
  it("the owner's own tab, with the session token", async () => {
    const { server, base, dir } = await office();
    const response = await post(base, server.token, multipart("meeting.md", "# Standup\n\nNotes."));

    expect(response.status).toBe(201);
    const body = (await response.json()) as { noteId: string };
    expect(body.noteId).toBe("inbox/meeting");
    expect(existsSync(join(dir, "brain", "inbox", "meeting.md"))).toBe(true);
  });

  it("not a request with no token", async () => {
    const { base, dir } = await office();
    const response = await post(base, undefined, multipart("meeting.md", "x"));

    expect(response.status).toBe(403);
    expect(existsSync(join(dir, "brain", "inbox", "meeting.md"))).toBe(false);
  });

  it("not a request with the wrong token", async () => {
    const { base } = await office();
    expect((await post(base, "not-the-token", multipart("a.md", "x"))).status).toBe(403);
  });

  it("not a post with no Origin at all, whatever else it carries", async () => {
    const { server, base } = await office();
    const response = await fetch(`${base}/api/brain/upload`, {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        [TOKEN_HEADER]: server.token,
      },
      body: new Uint8Array(multipart("a.md", "x")),
    });

    // A browser always sends one on a POST. Something that does not is not a
    // browser doing what the owner asked.
    expect(response.status).toBe(403);
  });

  it("not another site, even holding a token", async () => {
    const { server, base } = await office();
    // The whole point of the Origin check: a token that leaked into another page
    // must not be enough on its own.
    const response = await post(base, server.token, multipart("a.md", "x"), {
      origin: "https://evil.example.com",
    });

    expect(response.status).toBe(403);
  });
});

describe("what the route answers", () => {
  it("names the note it made, so the browser can open it", async () => {
    const { server, base } = await office();
    const response = await post(base, server.token, multipart("Meeting Notes.md", "hello"));

    const body = (await response.json()) as { ok: boolean; noteId: string; name: string };
    expect(body.ok).toBe(true);
    expect(body.name).toBe("meeting-notes.md");
  });

  it("makes it searchable straight away, rather than waiting for a watcher", async () => {
    const { server, base } = await office();
    await post(base, server.token, multipart("kiln.md", "# Kiln\n\nThe kiln runs at 240 degrees."));

    // The answer to the upload has to be true by the time the browser reads it,
    // with or without a file watcher running.
    const hits = server.office.brain.search("kiln", {});
    expect(hits.map((h) => h.id)).toContain("inbox/kiln");
  });

  it("refuses a type the brain cannot use, and writes nothing", async () => {
    const { server, base, dir } = await office();
    const response = await post(base, server.token, multipart("payload.exe", "MZ"));

    expect(response.status).toBe(415);
    expect(existsSync(join(dir, "brain", "inbox"))).toBe(false);
  });

  it("refuses a body that is not multipart", async () => {
    const { server, base } = await office();
    const response = await fetch(`${base}/api/brain/upload`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: base,
        [TOKEN_HEADER]: server.token,
      },
      body: JSON.stringify({ filename: "a.md" }),
    });

    expect(response.status).toBe(400);
  });

  it("refuses a GET, and says what to do instead", async () => {
    const { base } = await office();
    const response = await fetch(`${base}/api/brain/upload`);
    expect(response.status).toBe(405);
  });
});
