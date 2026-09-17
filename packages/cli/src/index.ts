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
import { exportOffice } from "./commands/export.js";
import { initOffice, templateChoices } from "./commands/init.js";
import { migrateCommand } from "./commands/migrate.js";
import { start } from "./commands/start.js";
import { templateApply, templateList } from "./commands/template.js";
import { addTool, listExampleTools, newTool } from "./commands/tools.js";
import { resolveOfficeDir } from "./office-dir.js";

const VERSION = "0.2.0";

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

  tools
    .command("new <name>")
    .description("Write a tool file of your own to fill in")
    .option("--office <dir>", "Which office folder to write it into")
    .option("--scope <scope>", "read runs without asking; write stops for approval", "read")
    .action((name, options) => {
      const resolved = resolveOfficeDir({
        flag: options.office,
        env: process.env["STAFFROOM_OFFICE"],
      });
      if (options.scope !== "read" && options.scope !== "write") {
        throw new Error("--scope is read or write.");
      }
      newTool({ officeDir: resolved.dir, name, scope: options.scope });
    });

  const template = program
    .command("template")
    .description("See the offices you can start from, or lay one down");
  template
    .command("list")
    .description("Every template, with what it is for")
    .action(() => {
      templateList();
    });
  template
    .command("apply <id>")
    .description("Copy a template into a folder")
    .requiredOption("--into <dir>", "Where to put it")
    .option("--include-tools", "Also copy the example tools, which run on this machine")
    .action((id, options) => {
      templateApply({
        id,
        into: options.into,
        ...(options.includeTools === undefined ? {} : { includeTools: options.includeTools }),
      });
    });

  program
    .command("export")
    .description("Put the whole office in one file you can read without Staffroom")
    .option("--office <dir>", "Which office folder to export")
    .option("--out <file>", "Where to write it", "office-export.zip")
    .action(async (options) => {
      const resolved = resolveOfficeDir({
        flag: options.office,
        env: process.env["STAFFROOM_OFFICE"],
      });
      await exportOffice({ officeDir: resolved.dir, out: options.out });
    });

  program
    .command("migrate")
    .description("Bring this office's files up to date after a Staffroom update")
    .option("--office <dir>", "Which office folder to migrate")
    .option("--dry-run", "Say what would change, and write nothing")
    .action((options) => {
      const resolved = resolveOfficeDir({
        flag: options.office,
        env: process.env["STAFFROOM_OFFICE"],
      });
      const result = migrateCommand({
        officeDir: resolved.dir,
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      });
      // A file from the future is the one case where nothing can be done here,
      // so the exit code says so for whatever is scripting this.
      if (result.tooNew) process.exitCode = 1;
    });

  /*
   * Named by two doctor checks and by NO_MODEL_CONFIGURED, which is why it
   * exists. Somebody told to run a command should find it there.
   */
  program
    .command("setup")
    .description("Set up your model keys, the default model, web search and telemetry")
    .option("--office <dir>", "Which office folder to set up")
    .option("--non-interactive", "Take every answer from the flags below and ask nothing")
    .option("--anthropic-key <key>", "Anthropic key")
    .option("--openai-key <key>", "OpenAI key")
    .option("--ollama-url <url>", "Ollama address")
    .option("--model <provider/model>", "The model everybody uses by default")
    .option("--web-search <provider>", "none, brave or tavily")
    .option("--web-search-key <key>", "Key for the web search provider")
    .option("--telemetry", "Send anonymous usage counts. Off unless you pass this")
    .action(async (options) => {
      /*
       * Imported here rather than at the top of the file.
       *
       * @inquirer/prompts is only needed by this one command, and every other
       * run of the CLI — including `start`, which is the one with an install
       * time budget on it — would otherwise pay to load a prompt library it
       * never uses.
       */
      const { setup } = await import("./commands/setup-prompts.js");
      await setup(options);
    });

  program
    .command("doctor")
    .description("Check the office over and say what to do about anything wrong")
    .option("--office <dir>", "Which office folder to check")
    .option("--json", "Print the result as JSON")
    .option("--fix", "Apply the fixes that are safe to apply")
    .option(
      "--bundle [file]",
      "Also write a support bundle, with every secret replaced by its name",
    )
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
