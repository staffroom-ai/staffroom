// A local run of the office, for looking at it in a real browser.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "@staffroom/server";
import { copyTemplate } from "@staffroom/templates";

const officeDir = process.argv[2] ?? join(process.cwd(), "..", "..", "office");
if (process.env.FRESH === "1" && existsSync(officeDir))
  rmSync(officeDir, { recursive: true, force: true });
if (!existsSync(join(officeDir, "agents.yaml"))) copyTemplate("studio", officeDir);

const server = await createServer({ officeDir, port: 4242, watch: true });
console.log("\n  Staffroom is running\n");
console.log(`  ${server.url}\n`);
console.log(`  Office folder: ${officeDir}`);
console.log("  Stop it with: pkill -f staffroom-serve\n");
