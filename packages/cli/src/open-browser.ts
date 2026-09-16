/**
 * Opening the office in a browser, when there is one to open.
 *
 * Nothing is more annoying than a CLI that tries to launch a GUI on a server. In
 * Docker or over SSH there is no browser, and attempting it either fails noisily
 * or, worse, opens something on the wrong machine.
 */
import { existsSync } from "node:fs";

export interface Environment {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  hasDockerEnv?: boolean;
}

export function canOpenBrowser(environment: Environment = {}): boolean {
  const env = environment.env ?? process.env;
  const platform = environment.platform ?? process.platform;

  if (env["STAFFROOM_NO_OPEN"] === "1") return false;
  if (env["CI"] !== undefined && env["CI"] !== "") return false;

  // Over SSH the browser would open on the wrong machine entirely.
  if (env["SSH_CONNECTION"] !== undefined || env["SSH_TTY"] !== undefined) return false;

  const inDocker = environment.hasDockerEnv ?? existsSync("/.dockerenv");
  if (inDocker) return false;

  // A Linux box with no display server has nothing to open.
  if (
    platform === "linux" &&
    (env["DISPLAY"] ?? "") === "" &&
    (env["WAYLAND_DISPLAY"] ?? "") === ""
  )
    return false;

  return true;
}

export async function openBrowser(url: string, environment: Environment = {}): Promise<boolean> {
  if (!canOpenBrowser(environment)) return false;
  try {
    const { default: open } = await import("open");
    await open(url);
    return true;
  } catch {
    // A browser that will not open is not a reason to fail the office.
    return false;
  }
}
