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
import type { ConfigError, Office } from "@staffroom/core";
import { type FSWatcher, watch } from "chokidar";

export type WatchEvent =
  | { type: "config.reloaded"; file: "agents.yaml" | "config.yaml" | ".env" | "approvals.yaml" }
  | { type: "config.error"; errors: ConfigError[] }
  | { type: "tools.reloaded"; file: string; ok: boolean; message?: string }
  | { type: "brain.changed"; path: string };

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
        [join(officeDir, "agents.yaml"), join(officeDir, "config.yaml"), join(officeDir, ".env")],
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
        : (".env" as const);

    this.debounce(path, 100, () => {
      try {
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

  private onToolChange(path: string): void {
    this.debounce(path, 200, () => {
      this.options.onEvent({
        type: "tools.reloaded",
        file: path.split(/[/\\]/).pop() ?? path,
        ok: true,
      });
    });
  }

  private onBrainChange(path: string, removed = false): void {
    if (!path.endsWith(".md")) return;
    this.debounce(path, this.options.debounceMs ?? BRAIN_DEBOUNCE_MS, () => {
      // An editor writing a file produces several events; only the last matters.
      if (removed) this.options.office.brain.removeFile(path);
      else this.options.office.brain.reindexFile(path);
      this.options.onEvent({ type: "brain.changed", path });
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
