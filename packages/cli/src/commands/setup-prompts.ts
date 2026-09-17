/**
 * The questions `npx staffroom setup` asks.
 *
 * Separate from setup.ts on purpose. Everything that decides or writes anything
 * is in there and can be tested by calling it; this file is the part that talks
 * to a terminal, which cannot be, so it is kept as small as it can be and does
 * nothing but ask and hand the answers on.
 *
 * It is also why `@inquirer/prompts` is imported here and nowhere else: importing
 * it takes over stdin, which is not a thing a test should have to survive.
 */

import { checkbox, confirm, input, password, select } from "@inquirer/prompts";
import type { ProviderAdapter } from "@staffroom/core";
import { resolveOfficeDir } from "../office-dir.js";
import {
  answersFromFlags,
  applySetup,
  modelMenu,
  officeOrThrow,
  PROVIDERS,
  type SetupAnswers,
  type SetupOptions,
  summaryLines,
  WEB_SEARCH,
} from "./setup.js";

/** Listing models can hang on a bad address; the owner is watching a cursor. */
const LIST_TIMEOUT_MS = 10_000;

async function askProviders(): Promise<SetupAnswers["providers"]> {
  const chosen = await checkbox({
    message: "Which model providers do you want to use?",
    choices: PROVIDERS.map((provider) => ({
      name: `${provider.name} — ${provider.note}`,
      value: provider.id,
    })),
  });

  const answers: SetupAnswers["providers"] = [];
  for (const id of chosen) {
    const provider = PROVIDERS.find((p) => p.id === id);
    if (provider === undefined) continue;

    // An address is not a secret and hiding it only makes it harder to check.
    const secret =
      provider.secret === "url"
        ? await input({ message: `${provider.name} address`, default: "http://127.0.0.1:11434" })
        : await password({ message: `${provider.name} key`, mask: "*" });

    if (secret.trim().length > 0) answers.push({ id, secret: secret.trim() });
  }

  return answers;
}

/**
 * Which model everybody uses unless their own row says otherwise.
 *
 * The list comes from the provider rather than from anything Staffroom ships: a
 * list we ship is out of date the week after a release, and the owner is the one
 * who finds out, by picking a model that no longer exists.
 */
async function askModel(adapters: Map<string, ProviderAdapter>): Promise<string | undefined> {
  for (const [id, adapter] of adapters) {
    let models: Awaited<ReturnType<ProviderAdapter["listModels"]>>;
    try {
      models = await withTimeout(adapter.listModels(), LIST_TIMEOUT_MS);
    } catch {
      // A provider that will not list is not a reason to stop: its own default
      // is a working answer, and the next provider may well answer.
      continue;
    }
    if (models.length === 0) continue;

    const { choices, more } = modelMenu(models, adapter.defaultModel());
    // Not a model id any provider could issue, so it cannot collide with a real
    // choice. Spelled out rather than a control character, which the formatter
    // will happily turn into a raw byte in the file.
    const SHOW_ALL = "__staffroom_show_all__";

    let picked = await select({
      message: `Default model (${id})`,
      choices: [
        ...choices.map((choice) => ({ name: choice.label, value: choice.id })),
        ...(more > 0 ? [{ name: `Show all ${more} more…`, value: SHOW_ALL }] : []),
      ],
    });

    if (picked === SHOW_ALL) {
      picked = await select({
        message: `Default model (${id})`,
        choices: models.map((model) => ({ name: model.id, value: model.id })),
      });
    }

    return `${id}/${picked}`;
  }

  return undefined;
}

async function askWeb(): Promise<SetupAnswers["web"]> {
  const provider = await select({
    message: "Web search, so your staff can look things up?",
    choices: WEB_SEARCH.map((option) => ({ name: option.name, value: option.id })),
  });

  const needsKey = WEB_SEARCH.find((option) => option.id === provider)?.needsKey === true;
  if (!needsKey) return { provider };

  const key = await password({ message: `${provider} key`, mask: "*" });
  return key.trim().length > 0 ? { provider, key: key.trim() } : { provider: "none" };
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_ok, fail) => {
        timer = setTimeout(() => fail(new Error("timed out")), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Whether the person pressed Ctrl+C.
 *
 * inquirer throws for this, and the message it throws — "User force closed the
 * prompt with 0 null" — is what the CLI would otherwise print at somebody who
 * simply changed their mind. Matched on the error's name rather than its text,
 * which is inquirer's to change.
 */
function wasCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "ExitPromptError";
}

export async function setup(
  options: SetupOptions,
  log: (line: string) => void = console.log,
): Promise<void> {
  try {
    await ask(options, log);
  } catch (error) {
    if (!wasCancelled(error)) throw error;
    // Nothing has been written that was not written before the last answer, and
    // leaving early is a thing people are allowed to do.
    log("");
    log("  Stopped. Nothing further was changed.");
    log("");
  }
}

async function ask(options: SetupOptions, log: (line: string) => void): Promise<void> {
  const resolved = resolveOfficeDir({
    flag: options.office,
    env: process.env["STAFFROOM_OFFICE"],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.home === undefined ? {} : { home: options.home }),
  });
  const officeDir = officeOrThrow(resolved.dir);

  if (options.nonInteractive === true) {
    const summary = await applySetup(officeDir, answersFromFlags(options));
    for (const line of summaryLines(summary)) log(line);
    return;
  }

  log("");
  log(`  Setting up ${officeDir}`);
  log("  Keys go in office/.env, which is a file on your machine and nowhere else.");
  log("");

  const providers = await askProviders();
  const web = await askWeb();
  /*
   * Off unless somebody says otherwise, and asked in plain words rather than as
   * "improve the product". The default is No because a default of Yes on a
   * question nobody reads is not consent.
   */
  const telemetry = await confirm({
    message: "Send anonymous usage counts? Nothing you write is ever included.",
    default: false,
  });

  const summary = await applySetup(
    officeDir,
    { providers, telemetry, ...(web === undefined ? {} : { web }) },
    { chooseModel: askModel },
  );

  for (const line of summaryLines(summary)) log(line);
}
