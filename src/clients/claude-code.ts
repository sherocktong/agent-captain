import fs from "node:fs";
import path from "node:path";
import {
  type AgentClientId,
  type AgentPaths,
  type HookPackage,
  type InstallOptions,
  type SkillPackage,
  type SyncOptions,
  type SyncReport,
  type SyncState,
  isHookInstalledItem,
  isSkillInstalledItem,
} from "../types.js";
import {
  copyDir,
  ensureDir,
  hookDisplayId,
  readJsonFile,
  removeDir,
  symlinkDir,
} from "../utils.js";
import { BaseAgentClient } from "./base.js";
import {
  listManagedHookIds,
  mergeHooksIntoSettings,
  readClaudeSettings,
} from "../hooks/merger.js";
import { installedItemToHookPackage } from "../hooks/parser.js";

export class ClaudeCodeClient extends BaseAgentClient {
  id: AgentClientId = "claude-code";
  name = "Claude Code";

  private getConfigDir(): string {
    return this.resolveHome("CLAUDE_DIR", ".claude");
  }

  isAvailable(): boolean {
    return fs.existsSync(this.getConfigDir());
  }

  getPaths(): AgentPaths {
    const configDir = this.getConfigDir();
    return {
      configDir,
      settingsFile: path.join(configDir, "settings.json"),
      skillsDir: path.join(configDir, "skills"),
      hooksDir: path.join(configDir, "hooks"),
    };
  }

  installSkill(pkg: SkillPackage, options: InstallOptions): void {
    const { skillsDir } = this.getPaths();
    const targetPath = path.join(skillsDir, pkg.id);

    if (fs.existsSync(targetPath)) {
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(targetPath);
        if (existingTarget === pkg.canonicalPath) {
          return; // Already correctly installed.
        }
      }
      if (!options.force) {
        throw new Error(
          `Skill ${pkg.id} already installed at ${targetPath}. Use --force to overwrite.`
        );
      }
      removeDir(targetPath);
    }

    if (options.dryRun) return;

    if (options.mode === "symlink") {
      symlinkDir(pkg.canonicalPath, targetPath);
    } else {
      copyDir(pkg.canonicalPath, targetPath);
    }
  }

  removeSkill(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { skillsDir } = this.getPaths();
    const targetPath = path.join(skillsDir, id);
    if (!fs.existsSync(targetPath)) return;
    if (options.dryRun) return;
    removeDir(targetPath);
  }

  enableSkill(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { skillsDir } = this.getPaths();
    const targetPath = path.join(skillsDir, id);
    if (fs.existsSync(targetPath)) return;
    if (options.dryRun) return;
    throw new Error(
      `Skill ${id} is not installed for Claude Code. Run "agent-captain skill install ${id}" first.`
    );
  }

  disableSkill(id: string, options: Pick<InstallOptions, "dryRun">): void {
    this.removeSkill(id, options);
  }

  listSkills(): string[] {
    const { skillsDir } = this.getPaths();
    if (!fs.existsSync(skillsDir)) return [];
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  }

  installHook(pkg: HookPackage, options: InstallOptions): void {
    const { settingsFile } = this.getPaths();
    const enabledHooks = [pkg];
    mergeHooksIntoSettings(settingsFile, enabledHooks, {
      dryRun: options.dryRun,
    });
  }

  removeHook(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { settingsFile } = this.getPaths();
    const settings = readJsonFile<Record<string, unknown>>(settingsFile) ?? {};
    const hooks = (settings.hooks as Record<string, unknown>) ?? {};

    const updatedHooks: Record<string, unknown> = {};
    for (const [event, entries] of Object.entries(hooks)) {
      const updatedEntries = (entries as Array<{ hooks: Array<Record<string, unknown>>; matcher?: string; if?: string }>)
        .map((entry) => ({
          ...entry,
          hooks: entry.hooks.filter(
            (handler) => !(handler._source === "agent-captain" && handler._id === id)
          ),
        }))
        .filter((entry) => entry.hooks.length > 0);
      if (updatedEntries.length > 0) {
        updatedHooks[event] = updatedEntries;
      }
    }

    if (options.dryRun) return;

    const newSettings = { ...settings, hooks: updatedHooks };
    ensureDir(path.dirname(settingsFile));
    fs.writeFileSync(settingsFile, JSON.stringify(newSettings, null, 2) + "\n", "utf-8");
  }

  enableHook(_id: string, options: Pick<InstallOptions, "dryRun">): void {
    if (options.dryRun) return;
    // Managed hooks are enabled when they exist in state as enabled.
    // The actual settings.json update happens via install/sync.
  }

  disableHook(id: string, options: Pick<InstallOptions, "dryRun">): void {
    this.removeHook(id, options);
  }

  listHooks(): string[] {
    const { settingsFile } = this.getPaths();
    return listManagedHookIds(settingsFile);
  }

  listAllHooks(): string[] {
    const { settingsFile } = this.getPaths();
    const settings = readClaudeSettings(settingsFile);
    const ids = new Set<string>();
    for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
      for (const entry of entries) {
        let index = 1;
        for (const handler of entry.hooks) {
          if (handler._source === "agent-captain" && typeof handler._id === "string") {
            ids.add(handler._id as string);
          } else if (typeof handler.command === "string") {
            ids.add(hookDisplayId(event, handler.command, index++));
          } else {
            ids.add(`${event}:hook-${index++}`);
          }
        }
      }
    }
    return Array.from(ids);
  }

  sync(state: SyncState, options: SyncOptions): SyncReport {
    const report: SyncReport = {
      clientId: this.id,
      skills: { added: [], removed: [], enabled: [], disabled: [] },
      hooks: { added: [], removed: [], enabled: [], disabled: [] },
      errors: [],
    };

    const { skillsDir, settingsFile } = this.getPaths();
    const syncSkills = Object.keys(state.skills).length > 0;
    const syncHooks = Object.keys(state.hooks).length > 0;

    if (syncSkills) {
      const desiredSkills = new Map<
        string,
        { pkg: SkillPackage; mode: string; enabled: boolean }
      >();
      for (const [id, rawItem] of Object.entries(state.skills)) {
        const item = isSkillInstalledItem(rawItem)
          ? rawItem
          : (rawItem as SkillPackage);
        const clientState = isSkillInstalledItem(item)
          ? item.clients?.[this.id]
          : undefined;
        const enabled = clientState?.enabled ?? true;
        const mode = clientState?.mode ?? options.mode ?? "symlink";
        desiredSkills.set(id, { pkg: item as SkillPackage, mode, enabled });
      }

      const currentSkills = new Set(this.listSkills());

      for (const id of currentSkills) {
        const desired = desiredSkills.get(id);
        if (!desired || !desired.enabled) {
          try {
            this.removeSkill(id, { dryRun: options.dryRun });
            report.skills.removed.push(id);
          } catch (err) {
            report.errors.push(
              `skill ${id}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }

      for (const [id, desired] of desiredSkills) {
        if (!desired.enabled) continue;
        const targetPath = path.join(skillsDir, id);
        const exists = currentSkills.has(id);
        const upToDate =
          exists && this.isSkillUpToDate(targetPath, desired.pkg, desired.mode);
        if (upToDate) continue;

        try {
          if (exists) {
            this.removeSkill(id, { dryRun: options.dryRun });
            report.skills.removed.push(id);
          }
          if (desired.mode === "symlink") {
            symlinkDir(desired.pkg.canonicalPath, targetPath);
          } else {
            copyDir(desired.pkg.canonicalPath, targetPath);
          }
          report.skills.added.push(id);
        } catch (err) {
          report.errors.push(
            `skill ${id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    if (syncHooks) {
      const desiredHooks = new Map<string, HookPackage>();
      for (const [id, rawItem] of Object.entries(state.hooks)) {
        const pkg = installedItemToHookPackage(rawItem);
        const clientState = isHookInstalledItem(rawItem)
          ? rawItem.clients?.[this.id]
          : undefined;
        const enabled =
          pkg.manifest.enabled !== false && (clientState?.enabled ?? true);
        if (enabled) desiredHooks.set(id, pkg);
      }

      const beforeHooks = new Set(this.listHooks());
      const enabledHooks = Array.from(desiredHooks.values());

      try {
        mergeHooksIntoSettings(settingsFile, enabledHooks, {
          dryRun: options.dryRun,
        });
      } catch (err) {
        report.errors.push(
          `hooks: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      const afterHooks = options.dryRun
        ? new Set(enabledHooks.map((h) => h.id))
        : new Set(this.listHooks());

      for (const id of beforeHooks) {
        if (!afterHooks.has(id)) report.hooks.removed.push(id);
      }
      for (const id of afterHooks) {
        if (!beforeHooks.has(id)) report.hooks.added.push(id);
      }
    }

    return report;
  }

  private isSkillUpToDate(
    targetPath: string,
    pkg: SkillPackage,
    mode: string
  ): boolean {
    if (!fs.existsSync(targetPath)) return false;
    if (mode === "symlink") {
      const stat = fs.lstatSync(targetPath);
      if (!stat.isSymbolicLink()) return false;
      return fs.readlinkSync(targetPath) === pkg.canonicalPath;
    }
    return fs.statSync(targetPath).isDirectory();
  }
}
