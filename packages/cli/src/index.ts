#!/usr/bin/env node
/**
 * The Staffroom command line.
 *
 * Every string here says `npx staffroom <sub>`, because that is how the audience
 * for this product will have arrived and what they will paste into a terminal
 * again tomorrow. Nobody is going to have installed it globally.
 */
import { checkNodeVersion } from "@staffroom/server";
import { Command } from "commander";
import { importIntoBrain, reindexBrain } from "./commands/brain.js";
import { doctor } from "./commands/doctor.js";
import { initOffice, templateChoices } from "./commands/init.js";
import { start } from "./commands/start.js";
import { addTool, listExampleTools } from "./commands/tools.js";
import { resolveOfficeDir } from "./office-dir.js";

const VERSION = "0.1.1";

async function run(): Promise<void> {
  const nodeProblem = checkNodeVersion();
  if (nodeProblem !== undefined) {
    console.error(nodeProblem);
    process.exitCode = 1;
    return;
  }

  const program = new Command();
  program
    .name("staffroom")
    .description("Your AI staff, in an office you can watch.")
    .version(VERSION, "-v, --version", "Print the version and exit");

  program
    .command("start", { isDefault: true })
    .description("Open the office")
    .option("--office <dir>", "Which office folder to open")
    .option("--port <number>", "Port to listen on", (value) => Number.parseInt(value, 10))
    .option("--host <host>", "Host to bind to")
    .option("--no-open", "Do not open a browser")
    .option("--demo", "Replay recorded work instead of calling a model")
    .option("--template <id>", "Template to use if there is no office yet")
    .option("--exit-when-ready", "Print the banner and exit, without serving")
    .action(async (options) => {
      const result = await start(options);
      if (options.exitWhenReady === true) return;
      // Ctrl+C is the documented way to stop, so make it a clean stop rather
      // than letting the process die with the port still held.
      const stop = (): void => {
        void result.close().then(() => process.exit(0));
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });

  program
    .command("demo")
    .description("Open the office in demo mode")
    .option("--office <dir>", "Which office folder to open")
    .option("--port <number>", "Port to listen on", (value) => Number.parseInt(value, 10))
    .option("--no-open", "Do not open a browser")
    .option("--exit-when-ready", "Print the banner and exit, without serving")
    .action(async (options) => {
      const result = await start({ ...options, demo: true });
      if (options.exitWhenReady === true) return;
      const stop = (): void => {
        void result.close().then(() => process.exit(0));
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });

  program
    .command("init")
    .description("Make a new office folder")
    .option("--template <id>", "Which template to start from")
    .option("--dir <dir>", "Where to put it", "office")
    .option("--tools", "Also copy the example tools")
    .addHelpText("after", `\nTemplates:\n${templateChoices()}\n`)
    .action((options) => {
      initOffice(options);
    });

  const tools = program.command("tools").description("Add one of the example tools");
  tools
    .command("add <name>")
    .description("Copy an example tool into your office and give it to someone")
    .option("--office <dir>", "Which office folder to add it to")
    .option("--for <agent>", "Who may use it")
    .addHelpText("after", `\nAvailable: ${listExampleTools().join(", ")}\n`)
    .action((name, options) => {
      const resolved = resolveOfficeDir({
        flag: options.office,
        env: process.env["STAFFROOM_OFFICE"],
      });
      addTool({
        name,
        officeDir: resolved.dir,
        ...(options.for === undefined ? {} : { forAgent: options.for }),
      });
    });

  const brain = program.command("brain").description("Bring notes in, or index them again");
  brain
    .command("import <path>")
    .description("Copy a folder of notes, or an Obsidian vault, into this office")
    .option("--office <dir>", "Which office folder to import into")
    .option("--move", "Move the files instead of copying them")
    .option("--area <area>", "Where they land", "90-archive")
    .option("--include-tools", "Also bring a tools/ folder, which runs on this machine")
    .action((path, options) => {
      const resolved = resolveOfficeDir({
        flag: options.office,
        env: process.env["STAFFROOM_OFFICE"],
      });
      importIntoBrain({
        officeDir: resolved.dir,
        source: path,
        ...(options.move === undefined ? {} : { move: options.move }),
        ...(options.area === undefined ? {} : { area: options.area }),
        ...(options.includeTools === undefined ? {} : { includeTools: options.includeTools }),
      });
    });

  brain
    .command("reindex")
    .description("Read every note again, from the files")
    .option("--office <dir>", "Which office folder to reindex")
    .option("--embeddings", "Not in this version yet")
    .action((options) => {
      const resolved = resolveOfficeDir({
        flag: options.office,
        env: process.env["STAFFROOM_OFFICE"],
      });
      reindexBrain({
        officeDir: resolved.dir,
        ...(options.embeddings === undefined ? {} : { embeddings: options.embeddings }),
      });
    });

  program
    .command("doctor")
    .description("Check the office over and say what to do about anything wrong")
    .option("--office <dir>", "Which office folder to check")
    .option("--json", "Print the result as JSON")
    .option("--fix", "Apply the fixes that are safe to apply")
    .action(async (options) => {
      const healthy = await doctor(options);
      if (!healthy) process.exitCode = 1;
    });

  await program.parseAsync(process.argv);
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
