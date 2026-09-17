/**
 * Bringing an owner's config files forward.
 *
 * The acceptance case is the one that would bite in practice: the office boots
 * on every `npx staffroom`, so running twice on a v1 file must produce one
 * backup and no second rewrite. A migration that re-ran would make a new .bak
 * every morning and eventually be the largest thing in the folder.
 *
 * Everything else here is the promise that makes migration acceptable at all:
 * the file is edited rather than rewritten, so comments survive; the old copy
 * is kept before a byte is written; and a file from the future is refused
 * rather than guessed at.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  APPROVALS_WHITELIST_DAYS,
  backupPath,
  CONFIG_VERSION,
  migrateLines,
  migrateOffice,
  versionOf,
} from "./index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An office as staffroom 0.1.0 wrote one: v1, and no whitelist_days. */
const V1 = `# office/config.yaml
#
# Keys live in office/.env, never here. Write $NAME and the office reads it.
version: 1

providers: {}
  # anthropic:
  #   api_key: $ANTHROPIC_API_KEY

approvals:
  expiry_hours: 24        # how long a card waits

server:
  port: 4242
`;

function office(config = V1): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-migrate-"));
  dirs.push(dir);
  writeFileSync(join(dir, "config.yaml"), config, "utf8");
  return dir;
}

const configOf = (dir: string): string => readFileSync(join(dir, "config.yaml"), "utf8");

function backupsIn(dir: string): string[] {
  try {
    return readdirSync(join(dir, ".staffroom", "backups"));
  } catch {
    return [];
  }
}

describe("running it twice", () => {
  it("makes one backup and does not rewrite the file again", () => {
    // The acceptance case. The office boots on every `npx staffroom`.
    const dir = office();

    const first = migrateOffice(dir);
    expect(first.applied.length).toBe(1);
    expect(backupsIn(dir)).toEqual(["config.yaml.v1.bak"]);
    const afterFirst = configOf(dir);

    const second = migrateOffice(dir);

    expect(second.applied).toEqual([]);
    expect(second.backups).toEqual([]);
    expect(backupsIn(dir)).toEqual(["config.yaml.v1.bak"]);
    // Byte for byte: a second write with the same content would still churn
    // the mtime and confuse anybody watching the folder.
    expect(configOf(dir)).toBe(afterFirst);
  });

  it("does nothing at all to an office that is already current", () => {
    const dir = mkdtempSync(join(tmpdir(), "staffroom-migrate-new-"));
    dirs.push(dir);
    copyTemplate("studio", dir);
    const before = configOf(dir);

    const result = migrateOffice(dir);

    // A brand-new office should never be migrated on its first boot, or every
    // owner meets a backup folder before they have done anything.
    expect(result.applied).toEqual([]);
    expect(backupsIn(dir)).toEqual([]);
    expect(configOf(dir)).toBe(before);
  });
});

describe("what it writes", () => {
  it("adds whitelist_days and moves the version on", () => {
    const dir = office();
    migrateOffice(dir);

    const parsed = parse(configOf(dir)) as {
      version: number;
      approvals: { expiry_hours: number; whitelist_days: number };
    };
    expect(parsed.version).toBe(2);
    expect(parsed.approvals.whitelist_days).toBe(90);
    expect(parsed.approvals.expiry_hours).toBe(24);
  });

  it("keeps every comment the owner wrote", () => {
    // This is the whole reason migrations edit a document rather than reparse
    // and dump. Eating somebody's notes to themselves would cost more than the
    // setting was worth.
    const dir = office();
    migrateOffice(dir);

    const text = configOf(dir);
    expect(text).toContain("# office/config.yaml");
    expect(text).toContain("# Keys live in office/.env, never here.");
    expect(text).toContain("#   api_key: $ANTHROPIC_API_KEY");
    expect(text).toContain("# how long a card waits");
  });

  it("keeps the owner's own value rather than resetting it to the default", () => {
    const dir = office(V1.replace("expiry_hours: 24", "expiry_hours: 72"));
    migrateOffice(dir);
    expect(
      (parse(configOf(dir)) as { approvals: { expiry_hours: number } }).approvals.expiry_hours,
    ).toBe(72);
  });

  it("does not overwrite a whitelist_days that was already typed in by hand", () => {
    const dir = office(V1.replace("expiry_hours: 24", "expiry_hours: 24\n  whitelist_days: 7"));
    migrateOffice(dir);

    const parsed = parse(configOf(dir)) as {
      version: number;
      approvals: { whitelist_days: number };
    };
    expect(parsed.approvals.whitelist_days).toBe(7);
    // Still moved forward, or it would migrate again on every boot.
    expect(parsed.version).toBe(2);
  });

  it("writes both keys when there is no approvals block at all", () => {
    const dir = office("version: 1\nproviders: {}\n");
    migrateOffice(dir);

    const parsed = parse(configOf(dir)) as {
      approvals: { expiry_hours: number; whitelist_days: number };
    };
    expect(parsed.approvals).toEqual({ expiry_hours: 24, whitelist_days: 90 });
  });

  it("leaves a copy of the file as it was", () => {
    const dir = office();
    const before = configOf(dir);

    migrateOffice(dir);

    // The owner has no other copy of this and did not ask for any of it.
    expect(readFileSync(backupPath(dir, "config.yaml", 1), "utf8")).toBe(before);
  });
});

describe("--dry-run", () => {
  it("says what would change and writes nothing", () => {
    const dir = office();
    const before = configOf(dir);

    const result = migrateOffice(dir, { dryRun: true });

    expect(result.applied.length).toBe(1);
    expect(result.backups).toEqual([]);
    expect(configOf(dir)).toBe(before);
    expect(backupsIn(dir)).toEqual([]);
  });

  it("agrees with the real thing about what would happen", () => {
    // Two code paths that could disagree would make the dry run worthless.
    const dry = migrateOffice(office(), { dryRun: true });
    const real = migrateOffice(office());
    expect(dry.applied).toEqual(real.applied);
  });

  it("tells the owner nothing was written", () => {
    const lines = migrateLines(migrateOffice(office(), { dryRun: true }), true);
    expect(lines.join(" ")).toContain("Nothing was written");
    expect(lines.join(" ")).toContain("npx staffroom migrate");
  });
});

describe("a file from the future", () => {
  it("is refused rather than guessed at", () => {
    const dir = office(V1.replace("version: 1", `version: ${CONFIG_VERSION + 1}`));
    const before = configOf(dir);

    const result = migrateOffice(dir);

    expect(result.tooNew?.version).toBe(CONFIG_VERSION + 1);
    expect(result.applied).toEqual([]);
    expect(configOf(dir)).toBe(before);
  });

  it("says to update Staffroom, which is the only thing that helps", () => {
    const dir = office(V1.replace("version: 1", "version: 99"));
    const lines = migrateLines(migrateOffice(dir), false).join(" ");
    expect(lines).toContain("version 99");
    expect(lines).toContain("Update Staffroom");
  });
});

describe("reading the version", () => {
  it("takes it off the file", () => {
    expect(versionOf("version: 1\n")).toBe(1);
    expect(versionOf("version: 2\n")).toBe(2);
  });

  it("treats a file with no version as the oldest, so it gets migrated", () => {
    expect(versionOf("providers: {}\n")).toBe(1);
  });

  it("treats a version that is not a whole number as the oldest", () => {
    expect(versionOf("version: banana\n")).toBe(1);
    expect(versionOf("version: 1.5\n")).toBe(1);
  });

  it("treats a file that will not parse as current, so nothing is written to it", () => {
    // The loader reports a broken file properly. Migrating one the office
    // cannot read would be editing something nobody has understood.
    expect(versionOf("version: [unclosed\n")).toBe(CONFIG_VERSION);
  });
});

describe("the office folder", () => {
  it("is left alone when there is no config.yaml in it", () => {
    const dir = mkdtempSync(join(tmpdir(), "staffroom-migrate-empty-"));
    dirs.push(dir);
    mkdirSync(join(dir, "brain"), { recursive: true });
    expect(migrateOffice(dir).applied).toEqual([]);
  });

  it("says plainly when there was nothing to do", () => {
    const dir = office("version: 2\napprovals: { whitelist_days: 90 }\n");
    expect(migrateLines(migrateOffice(dir), false).join(" ")).toContain("already up to date");
  });
});

describe("the migration itself", () => {
  it("names the file and the versions it moves between", () => {
    expect(APPROVALS_WHITELIST_DAYS.file).toBe("config.yaml");
    expect(APPROVALS_WHITELIST_DAYS.from).toBe(1);
    expect(APPROVALS_WHITELIST_DAYS.to).toBe(CONFIG_VERSION);
  });

  it("describes itself in the owner's terms, not the schema's", () => {
    expect(APPROVALS_WHITELIST_DAYS.describe).toContain("config.yaml");
    expect(APPROVALS_WHITELIST_DAYS.describe.length).toBeGreaterThan(20);
  });
});
