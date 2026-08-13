import fs from "node:fs";
import path from "node:path";
import {
  type SyncState,
  type AgentPaths,
  type HookPackage,
  type InstalledItem,
  type InstallOptions,
  type SkillPackage,
  type SyncOptions,
  type SyncReport,
  isSkillInstalledItem,
} from "../types.js";
import { ensureDir, renderMarkdownFile } from "../utils.js";
import { BaseAgentClient } from "./base.js";

function isInstalledSkillItem(
  item: SkillPackage | InstalledItem
): item is InstalledItem {
  return isSkillInstalledItem(item);
}

export class OpencodeClient extends BaseAgentClient {
  id = "opencode" as const;
  name = "OpenCode";

  private getConfigDir(): string {
    return this.resolveHome("OPENCODE_CONFIG", ".config/opencode");
  }

  isAvailable(): boolean {
    return fs.existsSync(this.getConfigDir());
  }

  getPaths(): AgentPaths {
    const configDir = this.getConfigDir();
    return {
      configDir,
      settingsFile: path.join(configDir, "opencode.json"),
      skillsDir: path.join(configDir, "skills"),
      hooksDir: path.join(configDir, "plugins"),
    };
  }

  installSkill(pkg: SkillPackage, options: InstallOptions): void {
    const { skillsDir } = this.getPaths();
    const targetPath = path.join(skillsDir, `${pkg.id}.md`);
    if (fs.existsSync(targetPath) && !options.force) return;
    if (options.dryRun) return;

    renderMarkdownFile(
      targetPath,
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
    const targetPath = path.join(skillsDir, `${id}.md`);
    if (!fs.existsSync(targetPath)) return;
    if (options.dryRun) return;
    fs.unlinkSync(targetPath);
  }

  enableSkill(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { skillsDir } = this.getPaths();
    if (fs.existsSync(path.join(skillsDir, `${id}.md`))) return;
    if (options.dryRun) return;
    throw new Error(
      `Skill ${id} is not installed for OpenCode. Run "agent-captain skill install ${id}" first.`
    );
  }

  disableSkill(id: string, options: Pick<InstallOptions, "dryRun">): void {
    this.removeSkill(id, options);
  }

  listSkills(): string[] {
    const { skillsDir } = this.getPaths();
    if (!fs.existsSync(skillsDir)) return [];
    return fs
      .readdirSync(skillsDir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.slice(0, -".md".length));
  }

  installHook(_pkg: HookPackage, _options: InstallOptions): void {
    // Hook sync is not supported for OpenCode.
  }

  removeHook(_id: string, _options: Pick<InstallOptions, "dryRun">): void {
    // Hook sync is not supported for OpenCode.
  }

  enableHook(_id: string, _options: Pick<InstallOptions, "dryRun">): void {
    // Hook sync is not supported for OpenCode.
  }

  disableHook(_id: string, _options: Pick<InstallOptions, "dryRun">): void {
    // Hook sync is not supported for OpenCode.
  }

  listHooks(): string[] {
    return [];
  }

  listAllHooks(): string[] {
    return [];
  }

  sync(state: SyncState, options: SyncOptions): SyncReport {
    const report: SyncReport = {
      clientId: this.id,
      skills: { added: [], removed: [], enabled: [], disabled: [] },
      hooks: { added: [], removed: [], enabled: [], disabled: [] },
      errors: [],
    };

    const { skillsDir } = this.getPaths();
    ensureDir(skillsDir);
    const syncSkills = Object.keys(state.skills).length > 0;

    if (syncSkills) {
      const desiredSkills = new Map<
        string,
        { pkg: SkillPackage; enabled: boolean }
      >();
      for (const [id, rawItem] of Object.entries(state.skills)) {
        const item = isInstalledSkillItem(rawItem)
          ? rawItem
          : (rawItem as SkillPackage);
        const enabled =
          !isInstalledSkillItem(item) ||
          ((item as InstalledItem).clients?.[this.id]?.enabled ?? true);
        desiredSkills.set(id, { pkg: item as unknown as SkillPackage, enabled });
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
        const targetPath = path.join(skillsDir, `${id}.md`);
        const exists = currentSkills.has(id);
        const upToDate = exists && fs.existsSync(targetPath);
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

    // Hooks are not supported for OpenCode; the permission field is a structured
    // object, not an array of hook rules. Avoid touching config.permission.

    return report;
  }
}
