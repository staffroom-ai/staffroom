/**
 * Which markdown editor, if any, this machine has.
 *
 * The office offers "Open in editor" only when it has found one, and the reason
 * is specific: on a Mac, a `.md` file with no editor installed opens in TextEdit,
 * which in rich-text mode rewrites the file as RTF on save and destroys the front
 * matter. Offering a button that quietly corrupts the owner's notes is worse than
 * offering no button, so an undetected editor means no button at all.
 *
 * Detection is by looking for the application, never by running it. Nothing here
 * spawns anything; that only happens when the owner clicks.
 */
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface DetectedEditor {
  /** Stable id, used by `note.reveal { app }`. */
  id: string;
  /** What the button says: "Open in Obsidian". */
  label: string;
}

interface Candidate extends DetectedEditor {
  /** Absolute paths that mean it is installed. Checked in order. */
  paths: string[];
  /** The command to run, when it is not the path itself. */
  command?: string;
}

/**
 * Obsidian first, then VS Code, then Typora.
 *
 * Order is the order the spec names, and it is also the order of least surprise:
 * somebody with Obsidian installed keeps their notes in it.
 */
function candidates(): Candidate[] {
  const home = homedir();
  const os = platform();

  if (os === "darwin") {
    return [
      { id: "obsidian", label: "Obsidian", paths: ["/Applications/Obsidian.app"] },
      {
        id: "vscode",
        label: "VS Code",
        paths: ["/Applications/Visual Studio Code.app"],
      },
      { id: "typora", label: "Typora", paths: ["/Applications/Typora.app"] },
    ];
  }

  if (os === "win32") {
    const local = process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local");
    const programs = process.env["PROGRAMFILES"] ?? "C:\\Program Files";
    return [
      { id: "obsidian", label: "Obsidian", paths: [join(local, "Obsidian", "Obsidian.exe")] },
      {
        id: "vscode",
        label: "VS Code",
        paths: [
          join(local, "Programs", "Microsoft VS Code", "Code.exe"),
          join(programs, "Microsoft VS Code", "Code.exe"),
        ],
      },
      { id: "typora", label: "Typora", paths: [join(programs, "Typora", "Typora.exe")] },
    ];
  }

  // Linux: the binary on PATH is the honest signal, and PATH is what xdg would
  // use anyway. Flatpak layouts are checked too, since that is how many people
  // install these.
  const bins = ["/usr/bin", "/usr/local/bin", join(home, ".local", "bin")];
  const flatpak = "/var/lib/flatpak/exports/bin";
  return [
    {
      id: "obsidian",
      label: "Obsidian",
      paths: [...bins.map((b) => join(b, "obsidian")), join(flatpak, "md.obsidian.Obsidian")],
      command: "obsidian",
    },
    {
      id: "vscode",
      label: "VS Code",
      paths: [...bins.map((b) => join(b, "code")), join(flatpak, "com.visualstudio.code")],
      command: "code",
    },
    {
      id: "typora",
      label: "Typora",
      paths: [...bins.map((b) => join(b, "typora"))],
      command: "typora",
    },
  ];
}

/** Every editor found, in preference order. Empty means no button is offered. */
export function detectEditors(): DetectedEditor[] {
  const found: DetectedEditor[] = [];
  for (const candidate of candidates()) {
    if (!candidate.paths.some((path) => existsSync(path))) continue;
    found.push({ id: candidate.id, label: candidate.label });
  }
  return found;
}

/** How to open a file in one, or undefined when it is not installed. */
export function openCommandFor(
  editorId: string,
  path: string,
): { command: string; args: string[] } | undefined {
  const candidate = candidates().find((c) => c.id === editorId);
  if (candidate === undefined) return undefined;
  const installed = candidate.paths.find((p) => existsSync(p));
  if (installed === undefined) return undefined;

  if (platform() === "darwin") {
    // Through `open -a`, so the app is launched rather than the bundle executed.
    return { command: "open", args: ["-a", installed, path] };
  }
  return { command: installed, args: [path] };
}
