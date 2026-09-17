/**
 * Adding one of the example tools to an office.
 *
 * The README tells people to run this and then type the tool's TRY IT line, so
 * it has to do both halves: copy the file, and wire it to somebody. A tool that
 * exists on disk but belongs to no one does nothing, and "it did not work" is
 * the only feedback you would get.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { loadAgentsFile, RosterWriter } from "@staffroom/core";
import { exampleToolsDir } from "@staffroom/templates";

export interface AddToolOptions {
  name: string;
  officeDir: string;
  /** Who may use it. Without this the file is copied and nobody is assigned. */
  forAgent?: string;
}

export function listExampleTools(): string[] {
  return readdirSync(exampleToolsDir())
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.replace(/\.ts$/, ""));
}

/** `send-sms` is the file; `send_sms` is what the tool calls itself. */
export function toolNameOf(file: string): string {
  const source = readFileSync(join(exampleToolsDir(), `${file}.ts`), "utf8");
  const found = /name:\s*"([a-z0-9_]+)"/.exec(source);
  return found?.[1] ?? file.replace(/-/g, "_");
}

/** The `// TRY IT:` line an example carries, without its comment marker. */
export function tryItLine(source: string): string | undefined {
  const found = /^\s*\*?\s*(?:\/\/)?\s*TRY IT:\s*(.+?)\s*$/m.exec(source);
  return found?.[1];
}

/**
 * The header every generated tool carries.
 *
 * Written into the file rather than into the docs, because the person who needs
 * it is looking at the file. A custom tool runs with the owner's own
 * permissions, and somebody pasting one from the internet should read this
 * before they save it, not after.
 */
export const TOOL_HEADER = `/**
 * A custom tool is a small program that runs inside Staffroom on your computer.
 * It can read any file, call any website, and use any password you put in it.
 * Agents can only call it through the input schema you declare, and every
 * \`write\` tool that leaves this computer waits for your approval before it runs.
 *
 * Only add tool files you wrote or that came from someone you trust. Do not
 * paste tool files from the internet without reading them.
 */`;

export interface NewToolOptions {
  name: string;
  officeDir: string;
  /** "read" runs without asking; "write" stops for approval every time. */
  scope?: "read" | "write";
}

/** `send-sms` on the command line becomes `send_sms` to an agent. */
export function toolIdOf(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

/**
 * Writes a tool file the owner can fill in.
 *
 * A stub rather than nothing, because the contract is the hard part: what the
 * shape of `run` is, where the schema goes, what `scope` means. Everything left
 * to do is marked, and the file compiles as it stands so the office does not
 * greet them with a load failure before they have written a line.
 */
export function newTool(options: NewToolOptions, log: (line: string) => void = console.log): void {
  const id = toolIdOf(options.name);
  const scope = options.scope ?? "read";

  const dir = join(options.officeDir, "tools");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${options.name}.ts`);

  if (existsSync(path)) {
    // Never overwritten. This is the owner's code, and a command that quietly
    // replaced an afternoon's work would be unforgivable for the sake of a stub.
    throw new Error(`tools/${options.name}.ts already exists. Delete it first, or pick a name.`);
  }

  writeFileSync(
    path,
    `${TOOL_HEADER}
//
// TRY IT: <a sentence somebody could type into the task bar>

export default {
  name: "${id}",
  description: "<what it does, in the words an agent would need to decide to use it>",

  // "read" runs without asking. "write" stops and waits for your approval every
  // time, which is what anything that changes something outside this computer
  // must be.
  scope: "${scope}",

  // true if any of the input is sent to a website or service. It is what puts
  // the red banner on the approval card.
  egress: false,

  inputSchema: {
    type: "object",
    properties: {
      // query: { type: "string", description: "..." },
    },
    required: [],
    additionalProperties: false,
  },

  async run(input, ctx) {
    // ctx.signal is aborted when the owner cancels the run. Pass it to fetch.
    throw new Error("${id} is not written yet.");
  },
};
`,
    "utf8",
  );

  log("");
  log(`  Wrote tools/${options.name}.ts`);
  log("");
  log(`  It is a ${scope} tool called ${id}. Fill in run(), then give it to somebody:`);
  log(`    npx staffroom tools add ${options.name} --for <agent>`);
  log("");
  log("  It runs on this machine with your permissions. Read it before you trust it.");
  log("");
}

export function addTool(options: AddToolOptions, log: (line: string) => void = console.log): void {
  const available = listExampleTools();
  if (!available.includes(options.name)) {
    throw new Error(
      `There is no example tool called ${options.name}. Available: ${available.join(", ")}`,
    );
  }

  const dir = join(options.officeDir, "tools");
  mkdirSync(dir, { recursive: true });
  const destination = join(dir, `${options.name}.ts`);
  if (existsSync(destination)) {
    log(`  ${options.name}.ts is already in this office.`);
  } else {
    copyFileSync(join(exampleToolsDir(), `${options.name}.ts`), destination);
    log("");
    log(`  Copied tools/${options.name}.ts`);
  }

  const tool = toolNameOf(options.name);

  if (options.forAgent === undefined) {
    // Said rather than guessed: picking somebody at random to hold a tool that
    // can send a text message is not a decision this command should make.
    const agents = loadAgentsFile(options.officeDir).agents.map((a) => a.id);
    log("");
    log(`  Nobody can use it yet. Give it to someone with:`);
    log(`    npx staffroom tools add ${options.name} --for ${agents[0] ?? "<agent>"}`);
    log("");
    log(`  Your staff: ${agents.join(", ")}`);
    log("");
    return;
  }

  const path = join(options.officeDir, "agents.yaml");
  const writer = new RosterWriter(readFileSync(path, "utf8"));
  if (!writer.addTool(options.forAgent, tool)) {
    throw new Error(
      `There is nobody called ${options.forAgent} in this office. Check office/agents.yaml.`,
    );
  }
  writeFileSync(path, writer.toString(), "utf8");

  log(`  ${options.forAgent} can now use ${tool}.`);
  log("");

  // The line itself, not directions to it. "Open the file and find the TRY IT
  // comment" is three steps where one would do, and the whole point of the
  // command is to get somebody to a working example in one go.
  const tryIt = tryItLine(readFileSync(destination, "utf8"));
  if (tryIt === undefined) {
    log(`  Open the office and give ${options.forAgent} something to do with it.`);
  } else {
    log("  Open the office, pick their department, and type:");
    log(`    ${tryIt}`);
  }
  log("");
}
