import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import {
  type ConfigPaths,
  getConfigPaths,
  loadConfig,
  resolveConfigPaths,
} from "../config.js";
import { getClient, getClientName } from "../clients/index.js";
import { error, info, success } from "../logger.js";
import {
  type AgentCaptainState,
  type AgentCaptainConfig,
  type HookManifest,
} from "../types.js";
import { ensureDir, removeDir } from "../utils.js";
import {
  parseClientsOption,
  parseInstallOptions,
} from "../commands/utils.js";
import {
  findHookDirectories,
  parseHookDirectory,
} from "./parser.js";

export function hookCommand(): Command {
  const command = new Command("hook").description("Manage hooks");

  command
    .command("list")
    .description("List hooks in the configured hook directory")
    .option("--source <dir>", "List hooks from a specific source directory")
    .action(async (options) => {
      const { paths } = loadContext(options);
      const root = options.source ?? paths.hooksDir;
      const hookDirs = findHookDirectories(root);
      for (const dir of hookDirs) {
        const pkg = parseHookDirectory(dir);
        const hookManifest = pkg.manifest;
        info(
          `${pkg.id}: ${hookManifest.event}` +
            (hookManifest.matcher ? ` (${hookManifest.matcher})` : "") +
            (hookManifest.enabled === false ? " [disabled]" : "")
        );
      }
    });

  command
    .command("remove")
    .description("Remove a hook from all agents and the configured hook directory")
    .argument("<id>", "Hook id")
    .option("--keep-files", "Keep the hook files in the configured hook directory")
    .action(async (id, options) => {
      const { paths } = loadContext(options);
      const hookDir = path.join(paths.hooksDir, id);
      if (!fs.existsSync(hookDir)) {
        error(`Hook not found in hook directory: ${id}`);
        process.exit(1);
      }

      if (!options.keepFiles) {
        removeDir(hookDir);
      }
      success(`Removed hook ${id}`);
    });

  command
    .command("enable")
    .description("Enable a hook on one or more agents")
    .argument("<id>", "Hook id")
    .option("--clients <clients...>", "Target agents (deprecated)")
    .action(async (id, options) => {
      await setHookEnabled(id, true, options);
    });

  command
    .command("disable")
    .description("Disable a hook on one or more agents")
    .argument("<id>", "Hook id")
    .option("--clients <clients...>", "Target agents (deprecated)")
    .action(async (id, options) => {
      await setHookEnabled(id, false, options);
    });

  command
    .command("sync")
    .description("Reconcile hooks across agents")
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

      const hookDirs = findHookDirectories(paths.hooksDir);
      const hooksById = new Map<string, ReturnType<typeof parseHookDirectory>>();
      for (const dir of hookDirs) {
        const pkg = parseHookDirectory(dir);
        hooksById.set(pkg.id, pkg);
      }

      for (const clientId of clients) {
        const client = getClient(clientId);
        const targetBefore = new Set(client.listHooks());
        const report = client.sync({
          hooks: Object.fromEntries(hooksById.entries()) as Record<string, any>,
          skills: {},
          version: 1,
        }, {
          dryRun: !!options.dryRun,
          mode: config.defaultInstallMode,
          clients,
        });
        const targetAfter = options.dryRun ? targetBefore : new Set(client.listHooks());

        info(`Synced ${client.name}:`);
        info(`  source: ${Array.from(hooksById.keys()).join(", ") || "(none)"}`);
        info(`  target before: ${Array.from(targetBefore).join(", ") || "(none)"}`);
        if (report.hooks.added.length > 0)
          info(`  added: ${report.hooks.added.join(", ")}`);
        if (report.hooks.removed.length > 0)
          info(`  removed: ${report.hooks.removed.join(", ")}`);
        if (report.hooks.enabled.length > 0)
          info(`  enabled: ${report.hooks.enabled.join(", ")}`);
        if (report.hooks.disabled.length > 0)
          info(`  disabled: ${report.hooks.disabled.join(", ")}`);
        info(`  target after: ${Array.from(targetAfter).join(", ") || "(none)"}`);
        for (const err of report.errors) error(`  error: ${err}`);
      }
    });

  return command;
}

async function setHookEnabled(
  id: string,
  enabled: boolean,
  options: Record<string, unknown>
): Promise<void> {
  const { paths, config } = loadContext(options);
  const hookDir = path.join(paths.hooksDir, id);
  if (!fs.existsSync(hookDir)) {
    error(`Hook not found in hook directory: ${id}`);
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

  const pkg = parseHookDirectory(hookDir);
  const installOptions = parseInstallOptions(options);

  for (const clientId of clients) {
    const client = getClient(clientId);
    if (enabled) {
      client.installHook(pkg, installOptions);
      success(`Enabled hook ${id} for ${getClientName(clientId)}`);
    } else {
      client.disableHook(id, { dryRun: installOptions.dryRun });
      success(`Disabled hook ${id} for ${getClientName(clientId)}`);
    }
  }

  const manifestPath = path.join(hookDir, "hook.json");
  const updatedManifest = { ...pkg.manifest, enabled } as HookManifest;
  const raw = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
    : {};
  fs.writeFileSync(manifestPath, JSON.stringify({ ...raw, ...updatedManifest }, null, 2), "utf-8");
}

function loadContext(options: Record<string, unknown>): {
  paths: ConfigPaths;
  state: AgentCaptainState;
  config: AgentCaptainConfig;
} {
  const paths = getConfigPaths(
    options.config as string | undefined
  );
  ensureDir(paths.homeDir);
  const config = loadConfig(paths);
  const effectivePaths = resolveConfigPaths(paths, config);
  ensureDir(effectivePaths.homeDir);
  return { paths: effectivePaths, state: { version: 1, skills: {}, hooks: {} }, config };
}
