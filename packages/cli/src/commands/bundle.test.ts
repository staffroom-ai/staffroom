/**
 * The support bundle, and the one thing it must never do.
 *
 * The acceptance case is grep: no value from `.env` appears anywhere in the
 * output. Checked against the raw bytes of the zip rather than against the
 * strings on the way in, because the question is what somebody receives when
 * this is emailed to a stranger — not what this code believed it wrote.
 *
 * The bundle exists precisely so nobody zips the folder by hand, since the
 * hand-made version is the one with the keys in it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { crc32, zip } from "../zip.js";
import { buildBundle, redactAll, secretsOf } from "./bundle.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ANTHROPIC = "sk-ant-api03-REALKEYVALUE9876543210";
const BRAVE = "BSA-brave-key-0011223344";
/** Deliberately a prefix of the one above, which is the case that bites. */
const SHORT = "BSA-brave";

function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-bundle-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".staffroom"), { recursive: true });

  writeFileSync(
    join(dir, ".env"),
    [
      `ANTHROPIC_API_KEY=${ANTHROPIC}`,
      `BRAVE_API_KEY="${BRAVE}"`,
      `SHORT_KEY=${SHORT}`,
      "EMPTY=",
      "# a comment",
    ].join("\n"),
    "utf8",
  );

  // config.yaml names them by variable, which is the correct shape — but a
  // real office also ends up with a resolved value somewhere, which is the
  // case this has to survive.
  writeFileSync(
    join(dir, "config.yaml"),
    `version: 2\nproviders:\n  anthropic:\n    api_key: $ANTHROPIC_API_KEY\n# pasted here by accident: ${ANTHROPIC}\n`,
    "utf8",
  );
  writeFileSync(join(dir, "agents.yaml"), "version: 1\nagents: []\n", "utf8");
  writeFileSync(join(dir, ".staffroom", "scheduler.json"), '{"lastRunAt":{}}', "utf8");

  return dir;
}

const bytesOf = (path: string): string => readFileSync(path).toString("latin1");

describe("reading the secrets", () => {
  it("takes every value, quoted or not", () => {
    const values = secretsOf(office()).map((s) => s.value);
    expect(values).toContain(ANTHROPIC);
    // The quotes are stripped: the value in a log line will not have them, and
    // a quoted comparison would never match.
    expect(values).toContain(BRAVE);
  });

  it("skips comments and empty values", () => {
    const names = secretsOf(office()).map((s) => s.name);
    expect(names).not.toContain("EMPTY");
    expect(names.every((n) => !n.startsWith("#"))).toBe(true);
  });

  it("puts the longest first, so a prefix cannot leave a tail behind", () => {
    const values = secretsOf(office()).map((s) => s.value);
    expect(values.indexOf(BRAVE)).toBeLessThan(values.indexOf(SHORT));
  });

  it("says nothing for an office with no .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "staffroom-bundle-bare-"));
    dirs.push(dir);
    expect(secretsOf(dir)).toEqual([]);
  });
});

describe("redacting", () => {
  it("replaces a value with the name it came from", () => {
    // Not `***`: the reader usually needs to know which key was there, and the
    // name tells them that without telling them the key.
    expect(redactAll(`key=${ANTHROPIC}`, secretsOf(office()))).toBe("key=$ANTHROPIC_API_KEY");
  });

  it("replaces every occurrence, not just the first", () => {
    const out = redactAll(`${ANTHROPIC} and again ${ANTHROPIC}`, secretsOf(office()));
    expect(out).not.toContain(ANTHROPIC);
    expect(out.split("$ANTHROPIC_API_KEY")).toHaveLength(3);
  });

  it("does not leave the tail of a longer secret behind", () => {
    // Replacing SHORT first would turn BRAVE into "$SHORT_KEY-key-0011223344",
    // which looks redacted and is not.
    const out = redactAll(`token ${BRAVE}`, secretsOf(office()));
    expect(out).not.toContain("0011223344");
  });
});

describe("the bundle", () => {
  it("contains no value from .env, anywhere in the file", () => {
    // The acceptance case, against the bytes somebody would actually receive.
    const dir = office();
    const out = join(dir, "bundle.zip");

    buildBundle({
      officeDir: dir,
      out,
      report: `doctor said: the key is ${ANTHROPIC}`,
      log: `a log line mentioning ${BRAVE} and ${ANTHROPIC}`,
    });

    const bytes = bytesOf(out);
    for (const secret of [ANTHROPIC, BRAVE, SHORT]) {
      expect(bytes, secret).not.toContain(secret);
    }
  });

  it("does not include .env itself", () => {
    const dir = office();
    const out = join(dir, "bundle.zip");
    const result = buildBundle({ officeDir: dir, out, report: "fine" });

    expect(result.files).not.toContain(".env");
    // Names are stored in the clear in a zip, so this is checkable by grep too.
    expect(bytesOf(out)).not.toContain("ANTHROPIC_API_KEY=");
  });

  it("includes the files a maintainer would need", () => {
    const dir = office();
    const result = buildBundle({ officeDir: dir, out: join(dir, "b.zip"), report: "fine" });

    expect(result.files).toContain("doctor.txt");
    expect(result.files).toContain("config.yaml");
    expect(result.files).toContain("agents.yaml");
    expect(result.files).toContain("README.txt");
  });

  it("counts what it replaced, as evidence rather than a claim", () => {
    const dir = office();
    const result = buildBundle({
      officeDir: dir,
      out: join(dir, "b.zip"),
      report: `${ANTHROPIC} ${ANTHROPIC}`,
    });

    // Two in the report plus the one pasted into config.yaml.
    expect(result.redactions).toBeGreaterThanOrEqual(3);
  });

  it("says in the archive itself what was done to it", () => {
    const dir = office();
    buildBundle({ officeDir: dir, out: join(dir, "b.zip"), report: "fine" });
    const bytes = bytesOf(join(dir, "b.zip"));
    expect(bytes).toContain("has been replaced with the name it came");
    expect(bytes).toContain("Read it before you send it");
  });

  it("skips a file that is not there rather than failing", () => {
    const dir = mkdtempSync(join(tmpdir(), "staffroom-bundle-bare-"));
    dirs.push(dir);
    const result = buildBundle({ officeDir: dir, out: join(dir, "b.zip"), report: "nothing here" });
    expect(result.files).toEqual(["doctor.txt", "README.txt"]);
  });
});

describe("the zip itself", () => {
  it("is a real zip, by its signatures", () => {
    const archive = zip([{ path: "a.txt", data: "hello" }]);
    // Local file header at the front, end of central directory at the back.
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
  });

  it("stores the content where a reader can find it", () => {
    const archive = zip([{ path: "a.txt", data: "hello" }]);
    expect(archive.toString("latin1")).toContain("hello");
    expect(archive.toString("latin1")).toContain("a.txt");
  });

  it("computes the CRC the format requires", () => {
    // The known value for "123456789", which is how every CRC-32 is checked.
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("is the same bytes twice for the same input", () => {
    // No timestamps: a bundle that differed between two runs of the same office
    // would be one nobody could diff.
    const once = zip([{ path: "a.txt", data: "hello" }]);
    const twice = zip([{ path: "a.txt", data: "hello" }]);
    expect(once.equals(twice)).toBe(true);
  });

  it("holds more than one file", () => {
    const archive = zip([
      { path: "a.txt", data: "one" },
      { path: "b/c.txt", data: "two" },
    ]);
    expect(archive.readUInt16LE(archive.length - 14)).toBe(2);
  });
});
