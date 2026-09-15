/**
 * The office's terminal output.
 *
 * One place, so "does the server print anything" has a single answer and a test or
 * an embedder can replace it. Everything user-facing goes through here; nothing
 * here is for debugging.
 */
export type LogLine = (line: string) => void;

// biome-ignore lint/suspicious/noConsole: the banner is the server's terminal interface.
export const printToTerminal: LogLine = (line) => console.log(line);

let sink: LogLine = printToTerminal;

/** Replaced by tests and by anything embedding the server. */
export function setLogSink(next: LogLine): void {
  sink = next;
}

export function say(line: string): void {
  sink(line);
}
