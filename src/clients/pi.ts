import fs from "node:fs";
import path from "node:path";
import {
  type SyncState,
  type AgentPaths,
  type InstallOptions,
  type SkillPackage,
  type SyncOptions,
  type SyncReport,
  type HookPackage,
  isHookInstalledItem,
  isSkillInstalledItem,
} from "../types.js";
import {
  ensureDir,
  hookDisplayId,
  renderMarkdownFile,
} from "../utils.js";
import { BaseAgentClient } from "./base.js";
import {
  listManagedHookIds,
  mergeHooksIntoSettings,
  readClaudeSettings,
} from "../hooks/merger.js";
import { installedItemToHookPackage } from "../hooks/parser.js";

export class PiClient extends BaseAgentClient {
  id = "pi" as const;
  name = "Pi";

  private getConfigDir(): string {
    return this.resolveHome("PI_CODING_AGENT_DIR", ".pi/agent");
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
      hooksDir: path.join(configDir, "extensions"),
    };
  }

  installSkill(pkg: SkillPackage, options: InstallOptions): void {
    const { skillsDir } = this.getPaths();
    const targetPath = path.join(skillsDir, pkg.id);
    if (fs.existsSync(targetPath) && !options.force) return;
    if (options.dryRun) return;

    ensureDir(targetPath);
    renderMarkdownFile(
      path.join(targetPath, "SKILL.md"),
      {
        name: pkg.manifest.name,
        description: pkg.manifest.description,
        version: pkg.manifest.version,
      },
      pkg.body
    );
  }

  removeSkill(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { skillsDir } = this.getPaths();
    const targetPath = path.join(skillsDir, id);
    if (!fs.existsSync(targetPath)) return;
    if (options.dryRun) return;
    fs.rmSync(targetPath, { recursive: true, force: true });
  }

  enableSkill(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { skillsDir } = this.getPaths();
    if (fs.existsSync(path.join(skillsDir, id))) return;
    if (options.dryRun) return;
    throw new Error(
      `Skill ${id} is not installed for Pi. Run "agent-captain skill install ${id}" first.`
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
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  installHook(pkg: HookPackage, options: InstallOptions): void {
    const { settingsFile } = this.getPaths();
    mergeHooksIntoSettings(settingsFile, [pkg], {
      dryRun: options.dryRun,
    });
  }

  removeHook(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { settingsFile } = this.getPaths();
    const settings = fs.existsSync(settingsFile)
      ? (JSON.parse(fs.readFileSync(settingsFile, "utf-8")) as Record<string, unknown>)
      : {};
    const hooks = (settings.hooks as Record<string, unknown>) ?? {};

    const updatedHooks: Record<string, unknown> = {};
    for (const [event, entries] of Object.entries(hooks)) {
      const updatedEntries = (entries as Array<{ hooks: Array<Record<string, unknown>>; matcher?: string }>)
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
    // Enable is handled by install/sync; no separate state in Pi settings.
    if (options.dryRun) return;
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
    ensureDir(skillsDir);
    const syncSkills = Object.keys(state.skills).length > 0;
    const syncHooks = Object.keys(state.hooks).length > 0;

    if (syncSkills) {
      const desiredSkills = new Map<
        string,
        { pkg: SkillPackage; enabled: boolean }
      >();
      for (const [id, rawItem] of Object.entries(state.skills)) {
        const item = isSkillInstalledItem(rawItem)
          ? rawItem
          : (rawItem as SkillPackage);
        const clientState = isSkillInstalledItem(item)
          ? item.clients?.[this.id]
          : undefined;
        const enabled = clientState?.enabled ?? true;
        desiredSkills.set(id, { pkg: item as SkillPackage, enabled });
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
        const upToDate = exists && fs.existsSync(path.join(targetPath, "SKILL.md"));
        if (upToDate) continue;

        try {
          if (exists) {
            this.removeSkill(id, { dryRun: options.dryRun });
            report.skills.removed.push(id);
          }
          this.installSkill(desired.pkg, {
            mode: "copy",
            dryRun: options.dryRun,
            force: true,
          });
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
}
