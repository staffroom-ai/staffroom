/**
 * Opening the office.
 *
 * The one command that matters. It has to work when the owner has done nothing
 * at all: no office, no key, no configuration. So it will make an office if there
 * is none, and it falls back to replaying recorded work rather than refusing to
 * start.
 */

import { join } from "node:path";
import { createServer } from "@staffroom/server";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { banner } from "../banner.js";
import { rememberOffice, resolveOfficeDir } from "../office-dir.js";
import { openBrowser } from "../open-browser.js";

export interface StartOptions {
  office?: string;
  port?: number;
  host?: string;
  open?: boolean;
  demo?: boolean;
  template?: string;
  /** Print the banner and stop, leaving no listener. Used by CI timing runs. */
  exitWhenReady?: boolean;
  cwd?: string;
  home?: string;
}

export interface StartResult {
  url: string;
  officeDir: string;
  close: () => Promise<void>;
}

export async function start(
  options: StartOptions,
  log: (line: string) => void = console.log,
): Promise<StartResult> {
  const resolved = resolveOfficeDir({
    flag: options.office,
    env: process.env["STAFFROOM_OFFICE"],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.home === undefined ? {} : { home: options.home }),
  });

  if (!resolved.exists) {
    log("");
    log(`  No office yet, so making one at ${resolved.dir}`);
    copyTemplate(options.template ?? "studio", resolved.dir);
  }

  const server = await createServer({
    officeDir: resolved.dir,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.demo === undefined ? {} : { demo: options.demo }),
    // Passed explicitly so demo mode still works if .staffroom/demo-runs was
    // deleted: the transcripts that ship with the package are the real source.
    demoRunsDir: join(templateDir("studio"), "demo-runs"),
    watch: true,
    open: false,
  });

  rememberOffice(resolved.dir, options.home);

  log(banner({ url: server.url, officeDir: resolved.dir }));

  if (options.exitWhenReady === true) {
    await server.close();
    return { url: server.url, officeDir: resolved.dir, close: async () => {} };
  }

  if (options.open !== false) await openBrowser(server.url);

  return {
    url: server.url,
    officeDir: resolved.dir,
    close: () => server.close(),
  };
}
