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
  log(`  Try it: open the office and type the TRY IT line from tools/${options.name}.ts`);
  log("");
}
