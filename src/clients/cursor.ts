import fs from "node:fs";
import path from "node:path";
import {
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
  writeJsonFile,
} from "../utils.js";
import { BaseAgentClient } from "./base.js";
import { findScriptPath, installedItemToHookPackage } from "../hooks/parser.js";
import { MANAGED_SOURCE_TAG } from "../hooks/merger.js";

export class CursorClient extends BaseAgentClient {
  id = "cursor" as const;
  name = "Cursor";

  private getConfigDir(): string {
    return this.resolveHome("CURSOR_DIR", ".cursor");
  }

  isAvailable(): boolean {
    if (process.platform === "darwin") {
      return fs.existsSync("/Applications/Cursor.app");
    }
    if (process.platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData && fs.existsSync(path.join(localAppData, "Programs", "cursor", "Cursor.exe"))) {
        return true;
      }
      return fs.existsSync(path.join("C:\\Program Files", "Cursor", "Cursor.exe"));
    }
    // Linux: common install locations
    return (
      fs.existsSync("/usr/bin/cursor") ||
      fs.existsSync("/usr/local/bin/cursor") ||
      fs.existsSync(path.join(process.env.HOME ?? "", ".local", "bin", "cursor"))
    );
  }

  getPaths(): AgentPaths {
    const configDir = this.getConfigDir();
    return {
      configDir,
      settingsFile: path.join(configDir, "hooks.json"),
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
      `Skill ${id} is not installed for Cursor. Run "agent-captain skill install ${id}" first.`
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
    const { hooksDir } = this.getPaths();
    const hookDirPath = path.join(hooksDir, pkg.id);

    if (fs.existsSync(hookDirPath)) {
      const stat = fs.lstatSync(hookDirPath);
      if (stat.isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(hookDirPath);
        if (existingTarget !== pkg.canonicalPath) {
          if (!options.force) {
            throw new Error(
              `Hook ${pkg.id} already installed at ${hookDirPath}. Use --force to overwrite.`
            );
          }
          removeDir(hookDirPath);
        }
      } else if (!options.force) {
        throw new Error(
          `Hook ${pkg.id} already installed at ${hookDirPath}. Use --force to overwrite.`
        );
      } else {
        removeDir(hookDirPath);
      }
    }

    if (!options.dryRun) {
      ensureDir(hooksDir);
      if (options.mode === "symlink") {
        symlinkDir(pkg.canonicalPath, hookDirPath);
      } else {
        copyDir(pkg.canonicalPath, hookDirPath);
      }
    }

    const config = this.readHooksJson();
    const hooks = this.removeManagedHookEntries(config.hooks, pkg.id);
    const entry = this.buildHookEntry(pkg);
    const event = pkg.manifest.event;
    hooks[event] = hooks[event] ?? [];
    hooks[event].push(entry);

    if (options.dryRun) return;
    this.writeHooksJson({ version: 1, hooks });
  }

  removeHook(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { hooksDir } = this.getPaths();
    const hookDirPath = path.join(hooksDir, id);
    if (fs.existsSync(hookDirPath) && !options.dryRun) {
      removeDir(hookDirPath);
    }

    const config = this.readHooksJson();
    if (!config.hooks || Object.keys(config.hooks).length === 0) return;

    const hooks = this.removeManagedHookEntries(config.hooks, id);
    if (options.dryRun) return;
    this.writeHooksJson({ version: 1, hooks });
  }

  enableHook(_id: string, options: Pick<InstallOptions, "dryRun">): void {
    // Managed hooks are enabled by their presence in state; sync reconciles the files.
    if (options.dryRun) return;
  }

  disableHook(id: string, options: Pick<InstallOptions, "dryRun">): void {
    this.removeHook(id, options);
  }

  listHooks(): string[] {
    const config = this.readHooksJson();
    return this.listManagedHookIdsFromJson(config.hooks);
  }

  listAllHooks(): string[] {
    const config = this.readHooksJson();
    const ids = new Set<string>();
    for (const [event, entries] of Object.entries(config.hooks ?? {})) {
      let index = 1;
      for (const entry of entries) {
        if (typeof entry !== "object" || entry === null) continue;
        const handler = entry as Record<string, unknown>;
        if (handler._source === MANAGED_SOURCE_TAG && typeof handler._id === "string") {
          ids.add(handler._id as string);
        } else if (typeof handler.command === "string") {
          ids.add(hookDisplayId(event, handler.command, index++));
        } else {
          ids.add(`${event}:hook-${index++}`);
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

    const { skillsDir } = this.getPaths();
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

      for (const id of beforeHooks) {
        if (!desiredHooks.has(id)) {
          try {
            this.removeHook(id, { dryRun: options.dryRun });
            report.hooks.removed.push(id);
          } catch (err) {
            report.errors.push(
              `hook ${id}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }

      for (const pkg of enabledHooks) {
        const exists = beforeHooks.has(pkg.id);
        const upToDate = exists && this.isHookUpToDate(pkg);
        if (upToDate) continue;

        try {
          if (exists) {
            this.removeHook(pkg.id, { dryRun: options.dryRun });
            report.hooks.removed.push(pkg.id);
          }
          this.installHook(pkg, {
            mode: "copy",
            dryRun: options.dryRun,
            force: true,
          });
          report.hooks.added.push(pkg.id);
        } catch (err) {
          report.errors.push(
            `hook ${pkg.id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
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

  private isHookUpToDate(pkg: HookPackage): boolean {
    const { hooksDir } = this.getPaths();
    const hookDirPath = path.join(hooksDir, pkg.id);
    if (!fs.existsSync(hookDirPath)) return false;
    const config = this.readHooksJson();
    const entries = config.hooks[pkg.manifest.event] ?? [];
    return entries.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>)._source === MANAGED_SOURCE_TAG &&
        (entry as Record<string, unknown>)._id === pkg.id
    );
  }

  private readHooksJson(): { version: number; hooks: Record<string, unknown[]> } {
    const { settingsFile } = this.getPaths();
    return (
      readJsonFile<{ version: number; hooks: Record<string, unknown[]> }>(settingsFile) ?? {
        version: 1,
        hooks: {},
      }
    );
  }

  private writeHooksJson(data: { version: number; hooks: Record<string, unknown[]> }): void {
    const { settingsFile } = this.getPaths();
    writeJsonFile(settingsFile, data);
  }

  private listManagedHookIdsFromJson(
    hooks: Record<string, unknown[]> | undefined
  ): string[] {
    if (!hooks) return [];
    const ids = new Set<string>();
    for (const entries of Object.values(hooks)) {
      for (const entry of entries) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>)._source === MANAGED_SOURCE_TAG &&
          typeof (entry as Record<string, unknown>)._id === "string"
        ) {
          ids.add((entry as Record<string, unknown>)._id as string);
        }
      }
    }
    return Array.from(ids);
  }

  private removeManagedHookEntries(
    hooks: Record<string, unknown[]> | undefined,
    id: string
  ): Record<string, unknown[]> {
    if (!hooks) return {};
    const result: Record<string, unknown[]> = {};
    for (const [event, entries] of Object.entries(hooks)) {
      const filtered = entries.filter((entry) => {
        if (
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>)._source === MANAGED_SOURCE_TAG &&
          (entry as Record<string, unknown>)._id === id
        ) {
          return false;
        }
        return true;
      });
      if (filtered.length > 0) {
        result[event] = filtered;
      }
    }
    return result;
  }

  private buildHookEntry(pkg: HookPackage): Record<string, unknown> {
    const entry: Record<string, unknown> = {
      _source: MANAGED_SOURCE_TAG,
      _id: pkg.id,
    };

    if (pkg.manifest.type === "prompt") {
      entry.type = "prompt";
    } else {
      entry.type = "command";
    }

    if (pkg.manifest.command) {
      entry.command = pkg.manifest.command;
    } else {
      const scriptPath = pkg.scriptPath ?? findScriptPath(pkg.canonicalPath);
      if (scriptPath) {
        entry.command = `./hooks/${pkg.id}/${path.basename(scriptPath)}`;
      }
    }

    if (pkg.manifest.matcher) entry.matcher = pkg.manifest.matcher;
    if (pkg.manifest.async) entry.async = true;

    return entry;
  }
}
