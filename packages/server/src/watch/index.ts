/**
 * Watching the office folder.
 *
 * The owner edits agents.yaml in a text editor and expects the office to notice.
 * Every watcher follows the same rule: a good edit is applied and announced, a
 * broken one is reported and the last good state keeps running. An office that
 * stops working because someone mistyped a line is an office nobody trusts to
 * leave open.
 */

import { join } from "node:path";
import { type ConfigError, loadCustomTools, type Office } from "@staffroom/core";
import { type FSWatcher, watch } from "chokidar";

export type WatchEvent =
  | { type: "config.reloaded"; file: "agents.yaml" | "config.yaml" | ".env" | "approvals.yaml" }
  | { type: "config.error"; errors: ConfigError[] }
  | {
      type: "tools.reloaded";
      file: string;
      ok: boolean;
      /** Why it would not load, in the compiler's own words. */
      message?: string;
      /** Where, when the compiler said. 1-based. */
      line?: number;
      /** Names of the tools this file defines, when it loaded. */
      tools?: string[];
      /** The tool this file defines, when the card is about one tool. */
      name?: string;
      /** The author left `scope` out, so it will ask about every call. */
      warning?: "no_scope";
      /** Nobody may use it yet. The card asks who should. */
      unassigned?: boolean;
      /** Everyone who could be given it, for the card's checkboxes. */
      agents?: { id: string; name: string }[];
    }
  /**
   * `removed` matters: the office pushes a different message either way, and the
   * one for a deleted note has to be sent after it has left the index so the
   * links that now dangle are real rather than predicted.
   */
  | { type: "brain.changed"; path: string; noteId: string; removed: boolean };

export interface WatchOptions {
  officeDir: string;
  office: Office;
  onEvent: (event: WatchEvent) => void;
  /** Overridable so tests do not wait 300 ms per file. */
  debounceMs?: number;
}

const BRAIN_DEBOUNCE_MS = 300;

export class OfficeWatchers {
  private readonly watchers: FSWatcher[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly options: WatchOptions;

  constructor(options: WatchOptions) {
    this.options = options;
  }

  start(): void {
    const { officeDir, office } = this.options;
    // Polling on Windows: its file events are unreliable enough that an editor's
    // save can go unnoticed entirely.
    const usePolling = process.platform === "win32";

    this.watchers.push(
      watch(
        [
          join(officeDir, "agents.yaml"),
          join(officeDir, "config.yaml"),
          join(officeDir, ".env"),
          // Deleting a row here takes a permission back, and should not need a
          // restart to do it.
          join(officeDir, "approvals.yaml"),
        ],
        {
          ignoreInitial: true,
          usePolling,
        },
      ).on("change", (path) => this.onConfigChange(path)),
    );

    this.watchers.push(
      watch(join(officeDir, office.config.tools.custom_dir), {
        ignoreInitial: true,
        usePolling,
        depth: 1,
      })
        .on("add", (path) => this.onToolChange(path))
        .on("change", (path) => this.onToolChange(path))
        .on("unlink", (path) => this.onToolChange(path)),
    );

    this.watchers.push(
      watch(join(officeDir, office.config.brain.dir), {
        ignoreInitial: true,
        usePolling,
        ignored: (p: string) => p.includes("_attachments") || p.includes("/.") || p.includes("\\."),
      })
        .on("add", (path) => this.onBrainChange(path))
        .on("change", (path) => this.onBrainChange(path))
        .on("unlink", (path) => this.onBrainChange(path, true)),
    );
  }

  private onConfigChange(path: string): void {
    const file = path.endsWith("agents.yaml")
      ? ("agents.yaml" as const)
      : path.endsWith("config.yaml")
        ? ("config.yaml" as const)
        : path.endsWith("approvals.yaml")
          ? ("approvals.yaml" as const)
          : (".env" as const);

    this.debounce(path, 100, () => {
      try {
        // Permissions are read from the file on every check, so re-reading it is
        // all that taking one back requires.
        if (file === "approvals.yaml") this.options.office.whitelist.reload();
        // Reloading is core's job; this only decides what to tell the office.
        this.options.onEvent({ type: "config.reloaded", file });
      } catch (error) {
        const errors = (error as { errors?: ConfigError[] }).errors;
        this.options.onEvent({
          type: "config.error",
          errors: errors ?? [
            {
              code: "YAML_PARSE",
              file,
              path: "(file)",
              message: error instanceof Error ? error.message : "could not be read",
              hint: "The office is still running on the last version that worked.",
            },
          ],
        });
      }
    });
  }

  /**
   * A changed tool file is actually loaded before it is announced.
   *
   * This used to report `ok: true` without opening the file at all, so a tool
   * with a syntax error looked exactly like one that worked and the owner found
   * out only when an agent tried to use it. One bad file never stops the others,
   * and a failure leaves whatever was already registered running.
   */
  private onToolChange(path: string): void {
    const file = path.split(/[/\\]/).pop() ?? path;

    this.debounce(path, 200, () => {
      const { office, officeDir } = this.options;
      const dir = join(officeDir, office.config.tools.custom_dir);

      loadCustomTools({ dir })
        .then((result) => {
          const failure = result.failures.find((f) => f.file.endsWith(file));
          if (failure !== undefined) {
            this.options.onEvent({
              type: "tools.reloaded",
              file,
              ok: false,
              message: failure.message,
              ...(failure.line === undefined ? {} : { line: failure.line }),
            });
            return;
          }

          // Register anything new. Re-registering an existing name throws, and
          // that is not a failure worth reporting: it just means nothing changed
          // about which tools exist.
          const names: string[] = [];
          let assumedScope = false;
          for (const { tool, file: from } of result.tools) {
            if (!from.endsWith(file)) continue;
            names.push(tool.name);
            if (tool.scopeAssumed === true) assumedScope = true;
            try {
              office.tools.register(tool);
            } catch {
              // Already registered under this name.
            }
          }

          /*
           * One event, not three.
           *
           * The spec lists the no-scope warning and the who-may-use-it question
           * as separate card payloads, but one file can easily be both — a new
           * tool with no scope that nobody has been given — and pushing two
           * events for one save would put two cards in the feed about the same
           * file. The fields are set independently and the card decides what to
           * say.
           */
          const name = names[0];
          const unassigned =
            name !== undefined &&
            office.agentsFile.agents.every((agent) => !(agent.tools ?? []).includes(name));

          this.options.onEvent({
            type: "tools.reloaded",
            file,
            ok: true,
            tools: names,
            ...(name === undefined ? {} : { name }),
            ...(assumedScope ? { warning: "no_scope" as const } : {}),
            ...(unassigned
              ? {
                  unassigned: true,
                  agents: office.agentsFile.agents.map((agent) => ({
                    id: agent.id,
                    name: agent.name ?? agent.id,
                  })),
                }
              : {}),
          });
        })
        .catch((error: unknown) => {
          this.options.onEvent({
            type: "tools.reloaded",
            file,
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    });
  }

  private onBrainChange(path: string, removed = false): void {
    if (!path.endsWith(".md")) return;
    this.debounce(path, this.options.debounceMs ?? BRAIN_DEBOUNCE_MS, () => {
      // An editor writing a file produces several events; only the last matters.
      const noteId = this.options.office.brain.idFor(path);
      if (removed) this.options.office.brain.removeFile(path);
      else this.options.office.brain.reindexFile(path);
      this.options.onEvent({ type: "brain.changed", path, noteId, removed });
    });
  }

  private debounce(key: string, ms: number, run: () => void): void {
    const existing = this.timers.get(key);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      run();
    }, ms);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.all(this.watchers.map((w) => w.close()));
    this.watchers.length = 0;
  }
}
