/**
 * `npx staffroom setup`, and the promise it exists to keep.
 *
 * The command was named by two doctor checks and by the NO_MODEL_CONFIGURED
 * error long before it existed, so anybody who followed the office's own advice
 * got a commander error about a command they had not typed. The last describe in
 * this file is the one that matters most: it takes every hint the product can
 * print, pulls the commands out of them, and runs each one. A hint that names
 * something that is not there fails here rather than in front of a new user.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { RUN_ERROR_CODES, userMessage } from "@staffroom/core";
import { runDoctor } from "@staffroom/server";
import { copyTemplate } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  answersFromFlags,
  applySetup,
  modelMenu,
  officeOrThrow,
  SAVED_LINE,
  summaryLines,
} from "./setup.js";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-setup-"));
  made.push(dir);
  copyTemplate("studio", dir);
  return dir;
}

/** Nothing here should reach a provider; every test says what the answer is. */
const passes = async (): Promise<undefined> => undefined;

describe("the model menu", () => {
  const models = [
    { id: "old-one", created: "2024-01-01" },
    { id: "newest", created: "2026-09-01" },
    { id: "middle", created: "2025-06-01" },
    { id: "a", created: "2025-05-01" },
    { id: "b", created: "2025-04-01" },
    { id: "c", created: "2025-03-01" },
    { id: "d", created: "2025-02-01" },
  ];

  it("puts the provider's own recommendation first and says so", () => {
    const { choices } = modelMenu(models, "middle");
    expect(choices[0]?.id).toBe("middle");
    expect(choices[0]?.label).toContain("(recommended)");
  });

  it("shows six and counts the rest rather than hiding them", () => {
    // OpenAI answers with over sixty ids, most of them dated snapshots of the
    // same three models. A select with sixty rows is a select nobody reads.
    const { choices, more } = modelMenu(models, "middle");
    expect(choices).toHaveLength(6);
    expect(more).toBe(1);
  });

  it("puts the newest first after the recommendation", () => {
    const { choices } = modelMenu(models, "middle");
    expect(choices[1]?.id).toBe("newest");
  });
});

describe("answers taken from flags", () => {
  it("leaves telemetry off unless it is asked for", () => {
    // The default is No everywhere, and a default of Yes on a flag nobody reads
    // is not consent.
    expect(answersFromFlags({}).telemetry).toBe(false);
    expect(answersFromFlags({ telemetry: true }).telemetry).toBe(true);
  });

  it("takes each provider from its own flag", () => {
    const answers = answersFromFlags({ anthropicKey: "sk-a", ollamaUrl: "http://x:11434" });
    expect(answers.providers).toEqual([
      { id: "anthropic", secret: "sk-a" },
      { id: "ollama", secret: "http://x:11434" },
    ]);
  });
});

describe("applying the answers", () => {
  it("leaves the office able to run, which is the whole point", async () => {
    const dir = office();
    const summary = await applySetup(
      dir,
      { providers: [{ id: "anthropic", secret: "sk-x" }], telemetry: false },
      { test: passes },
    );

    expect(summary.providers).toEqual(["anthropic"]);
    const config = parse(readFileSync(join(dir, "config.yaml"), "utf8")) as {
      providers: Record<string, unknown>;
    };
    expect(config.providers["anthropic"]).toBeDefined();
    expect(readFileSync(join(dir, ".env"), "utf8")).toContain("ANTHROPIC_API_KEY=sk-x");
  });

  it("keeps a key that did not answer, and says what happened", async () => {
    // A key that failed once because the wifi dropped is not a key to throw
    // away, and the file is the owner's to correct.
    const dir = office();
    const summary = await applySetup(
      dir,
      { providers: [{ id: "anthropic", secret: "sk-bad" }], telemetry: false },
      { test: async () => "Anthropic rejected the API key." },
    );

    expect(summary.failed).toEqual([
      { id: "anthropic", reason: "Anthropic rejected the API key." },
    ]);
    expect(readFileSync(join(dir, ".env"), "utf8")).toContain("sk-bad");
    expect(summaryLines(summary).join(" ")).toContain("The key is saved");
  });

  it("puts the web search key in .env and only its name in config.yaml", async () => {
    const dir = office();
    await applySetup(
      dir,
      { providers: [], telemetry: false, web: { provider: "brave", key: "brv-secret" } },
      { test: passes },
    );

    expect(readFileSync(join(dir, ".env"), "utf8")).toContain("BRAVE_API_KEY=brv-secret");
    const text = readFileSync(join(dir, "config.yaml"), "utf8");
    expect(text).not.toContain("brv-secret");
    const config = parse(text) as { tools: { web: { provider: string; api_key: string } } };
    expect(config.tools.web.provider).toBe("brave");
    expect(config.tools.web.api_key).toBe("$BRAVE_API_KEY");
  });

  it("writes telemetry as a real no rather than leaving it unsaid", async () => {
    const dir = office();
    await applySetup(dir, { providers: [], telemetry: false }, { test: passes });
    const config = parse(readFileSync(join(dir, "config.yaml"), "utf8")) as {
      telemetry: { enabled: boolean };
    };
    expect(config.telemetry.enabled).toBe(false);
  });

  it("keeps the comments in config.yaml, which is a file people edit", async () => {
    const dir = office();
    await applySetup(
      dir,
      {
        providers: [{ id: "anthropic", secret: "sk-x" }],
        telemetry: true,
        web: { provider: "none" },
      },
      { test: passes },
    );
    const text = readFileSync(join(dir, "config.yaml"), "utf8");
    expect(text).toContain("Keys live in office/.env, never here.");
    expect(text).toContain("searxng needs no key");
  });

  it("asks for a model only when there is a provider to ask about", async () => {
    const dir = office();
    let asked = false;
    await applySetup(
      dir,
      { providers: [], telemetry: false },
      {
        test: passes,
        chooseModel: async () => {
          asked = true;
          return "anthropic/claude-sonnet-5";
        },
      },
    );
    expect(asked).toBe(false);
  });
});

describe("what it says when there is no office", () => {
  it("names the command that makes one", () => {
    const empty = mkdtempSync(join(tmpdir(), "staffroom-none-"));
    made.push(empty);
    expect(() => officeOrThrow(empty)).toThrow(/npx staffroom/);
  });
});

describe("the closing line", () => {
  it("says where the keys went and how to change them", () => {
    expect(SAVED_LINE).toContain("office/.env");
    expect(SAVED_LINE).toContain("npx staffroom setup again");
  });
});

/*
 * The test this whole ticket is about.
 *
 * Every hint the office can print is collected, every `npx staffroom <word>` in
 * them is pulled out, and each word is run against the built binary. `setup` was
 * named by three of these for months and did not exist, so anybody who followed
 * the advice got "too many arguments for 'start'".
 *
 * Against the built binary rather than a list of command names, because a list
 * is a second place to forget.
 */
const run = promisify(execFile);
const BIN = resolve(import.meta.dirname, "..", "..", "dist", "index.js");

describe.skipIf(!existsSync(BIN))("every command a hint names", () => {
  it("is a command this program has", async () => {
    const hints: string[] = [];

    for (const code of RUN_ERROR_CODES) {
      const message = userMessage(code, {});
      if (message.hint !== undefined) hints.push(message.hint);
    }
    for (const check of (await runDoctor({ officeDir: office() })).checks) {
      if (check.hint !== undefined) hints.push(check.hint);
    }

    const named = new Set<string>();
    for (const hint of hints) {
      for (const match of hint.matchAll(/npx staffroom ([a-z][a-z-]*)/g)) {
        named.add(match[1] as string);
      }
    }

    // A guard on the guard: if the regex stops matching, or no hint names a
    // command any more, this test would otherwise pass by finding nothing.
    expect(named.size).toBeGreaterThan(0);

    /*
     * Read out of the program's own help rather than by running each word.
     *
     * The first version of this ran `<word> --help` and was worthless: commander
     * answers --help before it validates anything, so a missing command exited 0
     * and the test passed with the bug in place. Checked by deleting the setup
     * command from a build and watching it stay green.
     */
    const { stdout } = await run(process.execPath, [BIN, "--help"]);
    const listed = new Set(
      [...stdout.matchAll(/^ {2}([a-z][a-z-]*)[ []/gm)].map((match) => match[1] as string),
    );
    expect(listed.has("doctor")).toBe(true);

    for (const command of named) {
      expect(listed.has(command), `the hints say to run "npx staffroom ${command}"`).toBe(true);
    }
  });
});
