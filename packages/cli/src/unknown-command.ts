/**
 * A typo should say so.
 *
 * `start` is the default command and takes no arguments, so commander read
 * `npx staffroom setup` as an argument to it and answered "too many arguments
 * for 'start'. Expected 0 arguments but got 1: setup." — naming a command the
 * person did not type, for a command they meant to. Every mistyped subcommand
 * landed there.
 *
 * Its own file so a test can import it without running the program: index.ts
 * starts the CLI the moment it is loaded.
 */

/**
 * The message for a word that is not one of the commands.
 *
 * Returns undefined for anything that is fine, including no arguments at all,
 * which is the commonest way to run this and means `start`.
 */
export function unknownCommand(args: string[], known: string[]): string | undefined {
  const first = args[0];
  if (first === undefined || first.startsWith("-")) return undefined;
  if (known.includes(first)) return undefined;

  return [
    "",
    `  There is no command called ${first}.`,
    "",
    `  There is: ${known.join(", ")}.`,
    "  Run npx staffroom --help to see what each one does.",
    "",
  ].join("\n");
}
