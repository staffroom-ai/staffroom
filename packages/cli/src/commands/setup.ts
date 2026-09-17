/**
 * `npx staffroom setup` — the command the office has been telling people to run.
 *
 * Two doctor checks and the NO_MODEL_CONFIGURED error all end with "or run npx
 * staffroom setup in Terminal", and until now that command did not exist. A
 * product whose own hints are dead ends teaches people not to read them, which
 * is worse than never having written them.
 *
 * What it does is ordinary: pick providers, paste keys, check each one works,
 * pick the model everybody uses by default, decide about web search and
 * telemetry. Nothing here is not also in Settings > Models. It exists because
 * the terminal is where somebody already is when the office says it has no key.
 *
 * The decisions and the writing are in `applySetup` and the small functions
 * above it, which take answers and know nothing about prompting. The interactive
 * part is a thin shell over them, because a flow made of prompts is a flow
 * nobody can test.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildAdapters,
  loadConfig,
  type ModelInfo,
  type ProviderAdapter,
  setDefaultModel,
  setProviderKey,
  setTelemetry,
  setWebSearch,
} from "@staffroom/core";

/** What Settings offers, and what the office knows how to configure. */
export const PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic",
    secret: "key" as const,
    note: "Claude. A key from console.anthropic.com.",
  },
  {
    id: "openai",
    name: "OpenAI",
    secret: "key" as const,
    note: "GPT. A key from platform.openai.com.",
  },
  {
    id: "ollama",
    name: "Ollama",
    secret: "url" as const,
    note: "Models on this machine. The address it listens on, usually http://127.0.0.1:11434.",
  },
];

export const WEB_SEARCH = [
  { id: "none", name: "No web search", needsKey: false },
  { id: "brave", name: "Brave Search", needsKey: true },
  { id: "tavily", name: "Tavily", needsKey: true },
];

export interface SetupAnswers {
  /** One per provider being configured, in the order they were asked about. */
  providers: { id: string; secret: string }[];
  /** Full `provider/model`, or undefined to leave the roster's default alone. */
  defaultModel?: string;
  web?: { provider: string; key?: string };
  telemetry: boolean;
}

export interface SetupSummary {
  providers: string[];
  defaultModel?: string;
  web: string;
  telemetry: boolean;
  /** Providers whose key was written but did not work, with the reason. */
  failed: { id: string; reason: string }[];
}

/**
 * Six, newest first, with the provider's own recommendation pulled to the top.
 *
 * Not the whole list: OpenAI answers with over sixty ids, most of them dated
 * snapshots of the same three models, and a select with sixty rows is a select
 * nobody reads. `more` is how many were left out, so the caller can offer them
 * rather than pretending they are not there.
 */
export function modelMenu(
  models: ModelInfo[],
  recommended: string,
): { choices: { id: string; label: string }[]; more: number } {
  const sorted = [...models].sort((a, b) => {
    if (a.id === recommended) return -1;
    if (b.id === recommended) return 1;
    if (a.created === undefined && b.created === undefined) return a.id.localeCompare(b.id);
    if (a.created === undefined) return 1;
    if (b.created === undefined) return -1;
    return Date.parse(b.created) - Date.parse(a.created);
  });

  const shown = sorted.slice(0, 6);
  return {
    choices: shown.map((model) => ({
      id: model.id,
      label: model.id === recommended ? `${model.id} (recommended)` : model.id,
    })),
    more: Math.max(0, sorted.length - shown.length),
  };
}

/**
 * Asks the provider for one token, to find out whether the key works.
 *
 * Done here rather than left for the first real run because a key with a typo in
 * it fails three screens later, in the middle of somebody's first task, as a
 * provider error they have no reason to connect to what they pasted.
 *
 * A token costs nothing and the answer is thrown away.
 */
export async function testAdapter(adapter: ProviderAdapter): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const stream = adapter.complete([{ role: "user", content: "hi" }], [], {
      model: adapter.defaultModel(),
      maxTokens: 1,
      signal: controller.signal,
    });
    // One chunk is enough: the request was accepted, so the credential is good.
    for await (const _chunk of stream) return undefined;
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Writes every answer, and reports what happened.
 *
 * Keys first, then the test, then the model — in that order because the model
 * list has to come from a provider that is already configured, and because a key
 * that does not work is worth saying so about before somebody picks a model from
 * it.
 *
 * `chooseModel` is how the interactive flow gets its question in the middle of
 * that order without this function knowing what a prompt is. Left out — by a
 * script, or by a test — nothing asks and the roster's default stands.
 */
export async function applySetup(
  officeDir: string,
  answers: SetupAnswers,
  hooks: {
    test?: (adapter: ProviderAdapter) => Promise<string | undefined>;
    chooseModel?: (adapters: Map<string, ProviderAdapter>) => Promise<string | undefined>;
  } = {},
): Promise<SetupSummary> {
  const test = hooks.test ?? testAdapter;
  const written: string[] = [];

  for (const provider of answers.providers) {
    if (setProviderKey(officeDir, provider.id, provider.secret)) written.push(provider.id);
  }

  const failed: { id: string; reason: string }[] = [];
  let adapters = new Map<string, ProviderAdapter>();

  if (written.length > 0) {
    adapters = buildAdapters(loadConfig(officeDir).config).adapters;
    for (const id of written) {
      const adapter = adapters.get(id);
      if (adapter === undefined) {
        failed.push({ id, reason: "The office could not build a provider from it." });
        continue;
      }
      const reason = await test(adapter);
      if (reason !== undefined) failed.push({ id, reason });
    }
  }

  let model = answers.defaultModel;
  if (model === undefined && hooks.chooseModel !== undefined && adapters.size > 0) {
    model = await hooks.chooseModel(adapters);
  }
  if (model !== undefined) setDefaultModel(officeDir, model);

  if (answers.web !== undefined) {
    setWebSearch(officeDir, answers.web.provider, answers.web.key);
  }
  setTelemetry(officeDir, answers.telemetry);

  return {
    providers: written,
    ...(model === undefined ? {} : { defaultModel: model }),
    web: answers.web?.provider ?? "none",
    telemetry: answers.telemetry,
    failed,
  };
}

/** The last thing printed, verbatim from the spec. */
export const SAVED_LINE =
  "Saved to office/.env (a hidden file). Run npx staffroom setup again to change it.";

export function summaryLines(summary: SetupSummary): string[] {
  const lines: string[] = [""];

  if (summary.providers.length === 0) {
    lines.push("  No provider configured, so the office will keep replaying recorded work.");
  } else {
    lines.push(`  Providers: ${summary.providers.join(", ")}`);
  }
  if (summary.defaultModel !== undefined) lines.push(`  Default model: ${summary.defaultModel}`);
  lines.push(`  Web search: ${summary.web}`);
  lines.push(`  Telemetry: ${summary.telemetry ? "on" : "off"}`);

  for (const bad of summary.failed) {
    lines.push("");
    // Saved anyway. A key that failed once because the wifi dropped is not a
    // key to throw away, and the file is theirs to correct.
    lines.push(`  ${bad.id} did not answer: ${bad.reason}`);
    lines.push(`  The key is saved. Run npx staffroom setup again to replace it.`);
  }

  lines.push("");
  lines.push(`  ${SAVED_LINE}`);
  lines.push("");
  lines.push("  Now run: npx staffroom");
  lines.push("");
  return lines;
}

export interface SetupOptions {
  office?: string;
  cwd?: string;
  home?: string;
  /** Answers as flags, for a script or a container. */
  nonInteractive?: boolean;
  anthropicKey?: string;
  openaiKey?: string;
  ollamaUrl?: string;
  model?: string;
  webSearch?: string;
  webSearchKey?: string;
  telemetry?: boolean;
}

/** The flags, as the same answers the prompts would have produced. */
export function answersFromFlags(options: SetupOptions): SetupAnswers {
  const providers: { id: string; secret: string }[] = [];
  if (options.anthropicKey !== undefined)
    providers.push({ id: "anthropic", secret: options.anthropicKey });
  if (options.openaiKey !== undefined) providers.push({ id: "openai", secret: options.openaiKey });
  if (options.ollamaUrl !== undefined) providers.push({ id: "ollama", secret: options.ollamaUrl });

  return {
    providers,
    ...(options.model === undefined ? {} : { defaultModel: options.model }),
    ...(options.webSearch === undefined
      ? {}
      : {
          web: {
            provider: options.webSearch,
            ...(options.webSearchKey === undefined ? {} : { key: options.webSearchKey }),
          },
        }),
    // Off unless somebody says otherwise, here as everywhere else.
    telemetry: options.telemetry === true,
  };
}

export function officeOrThrow(dir: string): string {
  if (!existsSync(join(dir, "agents.yaml"))) {
    throw new Error(
      `There is no office at ${dir}. Run npx staffroom to make one, then npx staffroom setup.`,
    );
  }
  return dir;
}
