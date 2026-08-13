import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setLogLevel } from "./logger.js";
import { agentCommand } from "./clients/commands.js";
import { skillCommand } from "./skills/commands.js";
import { hookCommand } from "./hooks/commands.js";

import { completionCommand } from "./commands/completion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("agent-captain")
  .description("Cross-agent package manager for skills and hooks")
  .version(getVersion())
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --dry-run", "Show what would change without making changes")
  .option("-v, --verbose", "Enable verbose logging")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setLogLevel("DEBUG");
    }
  });

program.addCommand(agentCommand());
program.addCommand(skillCommand());
program.addCommand(hookCommand());
program.addCommand(completionCommand());

program.parse();
