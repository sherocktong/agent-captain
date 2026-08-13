import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  type ConfigPaths,
  getConfigPaths,
  loadConfig,
  resolveConfigPaths,
} from "../config.js";
import { getClient, getClientName } from "../clients/index.js";
import { error, info, success, warn } from "../logger.js";
import {
  type AgentCaptainConfig,
} from "../types.js";
import { copyDir, ensureDir, removeDir } from "../utils.js";
import {
  parseClientsOption,
  parseInstallOptions,
} from "../commands/utils.js";
import { findSkillDirectories, parseSkillDirectory } from "./parser.js";

export function skillCommand(): Command {
  const command = new Command("skill").description("Manage skills");

  command
    .command("list")
    .description("List skills in the configured skills directory or a source directory")
    .option("--source <dir>", "List skills from a specific source directory")
    .action(async (options) => {
      const { paths } = loadContext(options);
      if (options.source) {
        const dirs = findSkillDirectories(options.source);
        for (const dir of dirs) {
          const pkg = parseSkillDirectory(dir);
          info(`${pkg.id}: ${pkg.manifest.description}`);
        }
      } else {
        const dirs = findSkillDirectories(paths.skillsDir);
        for (const dir of dirs) {
          const pkg = parseSkillDirectory(dir);
          info(`${pkg.id}: ${pkg.manifest.description}`);
        }
      }
    });

  command
    .command("add")
    .description("Add a skill to the configured skills directory")
    .argument("<path>", "Path to the skill directory")
    .option("--id <id>", "Override the skill id")
    .action(async (sourcePath, options) => {
      const { paths } = loadContext(options);
      const resolvedPath = path.resolve(sourcePath);
      if (!fs.existsSync(resolvedPath)) {
        error(`Path not found: ${resolvedPath}`);
        process.exit(1);
      }

      const pkg = parseSkillDirectory(resolvedPath, options.id);
      const canonicalPath = path.join(paths.skillsDir, pkg.id);

      if (fs.existsSync(canonicalPath)) {
        warn(`Skill ${pkg.id} already exists in skills directory; overwriting`);
        removeDir(canonicalPath);
      }

      copyDir(resolvedPath, canonicalPath);
      success(`Added skill ${pkg.id} to skills directory`);
    });

  command
    .command("remove")
    .description("Remove a skill from the configured skills directory")
    .argument("<id>", "Skill id")
    .option("--force", "Skip confirmation")
    .action(async (id, options) => {
      const { paths } = loadContext(options);
      const skillDir = path.join(paths.skillsDir, id);
      if (!fs.existsSync(skillDir)) {
        error(`Skill not found: ${id}`);
        process.exit(1);
      }

      removeDir(skillDir);
      success(`Removed skill ${id}`);
    });

  command
    .command("install")
    .description("Install a skill to one or more agents")
    .argument("<id>", "Skill id")
    .option("--clients <clients...>", "Target agents (deprecated)")
    .option("--copy", "Copy instead of symlink")
    .option("--symlink", "Symlink instead of copy")
    .action(async (id, options) => {
      const { paths, config } = loadContext(options);
      const skillDir = path.join(paths.skillsDir, id);
      if (!fs.existsSync(skillDir)) {
        error(`Skill not found: ${id}`);
        process.exit(1);
      }

      const clients = parseClientsOption(options, config.activeClients);
      if (clients.length === 0) {
        error("No target agents specified and no active agents configured");
        process.exit(1);
      }

      const installOptions = parseInstallOptions(options);
      const pkg = parseSkillDirectory(skillDir);

      for (const clientId of clients) {
        const client = getClient(clientId);
        client.installSkill(pkg, installOptions);
        success(`Installed skill ${id} for ${getClientName(clientId)}`);
      }
    });

  command
    .command("enable")
    .description("Enable a skill on one or more agents")
    .argument("<id>", "Skill id")
    .option("--clients <clients...>", "Target agents (deprecated)")
    .option("--copy", "Copy instead of symlink")
    .option("--symlink", "Symlink instead of copy")
    .action(async (id, options) => {
      await setSkillEnabled(id, true, options);
    });

  command
    .command("disable")
    .description("Disable a skill on one or more agents")
    .argument("<id>", "Skill id")
    .option("--clients <clients...>", "Target agents (deprecated)")
    .action(async (id, options) => {
      await setSkillEnabled(id, false, options);
    });

  command
    .command("sync")
    .description("Reconcile skills across agents")
    .argument("<agents...>", "Target agents")
    .option("--clients <clients...>", "Target agents (deprecated)")
    .option("--dry-run", "Show what would change")
    .action(async (agents: string[], options) => {
      const { paths, config } = loadContext({ ...options, agents });
      const clients = parseClientsOption({ ...options, agents }, config.activeClients);
      if (clients.length === 0) {
        error("No target agents specified");
        process.exit(1);
      }

      const skillDirs = findSkillDirectories(paths.skillsDir);
      const skillsById = new Map<string, ReturnType<typeof parseSkillDirectory>>();
      for (const dir of skillDirs) {
        const pkg = parseSkillDirectory(dir);
        skillsById.set(pkg.id, pkg);
      }

      for (const clientId of clients) {
        const client = getClient(clientId);
        const targetBefore = new Set(client.listSkills());
        const report = client.sync({
          skills: Object.fromEntries(skillsById.entries()) as Record<string, any>,
          hooks: {},
          version: 1,
        }, {
          dryRun: !!options.dryRun,
          mode: config.defaultInstallMode,
          clients,
        });
        const targetAfter = options.dryRun ? targetBefore : new Set(client.listSkills());

        info(`Synced ${client.name}:`);
        info(`  source: ${Array.from(skillsById.keys()).join(", ") || "(none)"}`);
        info(`  target before: ${Array.from(targetBefore).join(", ") || "(none)"}`);
        if (report.skills.added.length > 0)
          info(`  added: ${report.skills.added.join(", ")}`);
        if (report.skills.removed.length > 0)
          info(`  removed: ${report.skills.removed.join(", ")}`);
        if (report.skills.enabled.length > 0)
          info(`  enabled: ${report.skills.enabled.join(", ")}`);
        if (report.skills.disabled.length > 0)
          info(`  disabled: ${report.skills.disabled.join(", ")}`);
        info(`  target after: ${Array.from(targetAfter).join(", ") || "(none)"}`);
        for (const err of report.errors) error(`  error: ${err}`);
      }
    });

  command
    .command("show")
    .description("Show parsed SKILL.md frontmatter")
    .argument("<id>", "Skill id")
    .action(async (id, options) => {
      const { paths } = loadContext(options);
      const skillDir = path.join(paths.skillsDir, id);
      if (!fs.existsSync(skillDir)) {
        error(`Skill not found: ${id}`);
        process.exit(1);
      }
      const pkg = parseSkillDirectory(skillDir);
      info(JSON.stringify(pkg.manifest, null, 2));
    });

  return command;
}

async function setSkillEnabled(
  id: string,
  enabled: boolean,
  options: Record<string, unknown>
): Promise<void> {
  const { paths, config } = loadContext(options);
  const skillDir = path.join(paths.skillsDir, id);
  if (!fs.existsSync(skillDir)) {
    error(`Skill not found: ${id}`);
    process.exit(1);
  }

  const clients = parseClientsOption(
    options as { clients?: string[] },
    config.activeClients
  );
  if (clients.length === 0) {
    error("No target agents specified and no active agents configured");
    process.exit(1);
  }

  const installOptions = parseInstallOptions(options);
  const pkg = parseSkillDirectory(skillDir);

  for (const clientId of clients) {
    const client = getClient(clientId);
    if (enabled) {
      client.installSkill(pkg, installOptions);
      success(`Enabled skill ${id} for ${getClientName(clientId)}`);
    } else {
      client.disableSkill(id, { dryRun: installOptions.dryRun });
      success(`Disabled skill ${id} for ${getClientName(clientId)}`);
    }
  }
}

function loadContext(options: Record<string, unknown>): {
  paths: ConfigPaths;
  config: AgentCaptainConfig;
} {
  const paths = getConfigPaths(
    options.config as string | undefined
  );
  ensureDir(paths.homeDir);
  const config = loadConfig(paths);
  const effectivePaths = resolveConfigPaths(paths, config);
  ensureDir(effectivePaths.homeDir);
  return { paths: effectivePaths, config };
}
