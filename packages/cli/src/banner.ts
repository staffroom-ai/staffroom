/**
 * What the owner sees when the office opens.
 *
 * Four lines, and one of them is the warning that matters: this is a program
 * running in a terminal window, and people close terminal windows. Saying so
 * here is cheaper than a support conversation about why the office "disappeared".
 */
export interface BannerFacts {
  url: string;
  officeDir: string;
}

export const KEEP_OPEN =
  "Keep this window open. Closing it stops the office. Press Ctrl+C to stop.";

export function banner(facts: BannerFacts): string {
  const lines = [
    "",
    "  Staffroom is running",
    "",
    `  ${facts.url}`,
    "",
    `  Office folder: ${facts.officeDir}`,
  ];
  // The demo explanation is boot's line, not ours. Printing it here too said the
  // same paragraph twice in a row, which reads like a bug in the program.
  lines.push("", `  ${KEEP_OPEN}`, "");
  return lines.join("\n");
}
