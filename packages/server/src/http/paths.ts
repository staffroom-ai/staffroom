/**
 * Resolving a path the browser asked for into a file inside the brain.
 *
 * Everything here exists to make one guarantee: a request can never read a file
 * outside brain/. `../` tricks, absolute paths, null bytes and symlinks pointing
 * out are all the same answer, 404, because telling the caller which one it was
 * would help them find the one that works.
 */
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

const ALLOWED_EXTENSIONS = [".md", ".txt", ".png", ".jpg", ".jpeg", ".pdf"];

export function resolveBrainPath(brainDir: string, requested: string): string | undefined {
  if (requested.length === 0) return undefined;
  if (requested.includes("\0")) return undefined;
  if (requested.startsWith("/") || requested.startsWith("\\")) return undefined;

  const normalised = requested.split("\\").join("/");
  if (normalised.split("/").includes("..")) return undefined;
  if (!ALLOWED_EXTENSIONS.some((ext) => normalised.toLowerCase().endsWith(ext))) return undefined;

  const target = resolve(brainDir, normalised);
  const root = resolve(brainDir);
  if (!target.startsWith(root + sep)) return undefined;

  // A symlink inside brain/ pointing outside it would otherwise slip through.
  try {
    const real = realpathSync(target);
    if (!realpathSync(root) || !real.startsWith(realpathSync(root) + sep)) return undefined;
    return real;
  } catch {
    return undefined;
  }
}
