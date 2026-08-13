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
  removeDir,
  symlinkDir,
} from "../utils.js";
import { BaseAgentClient } from "./base.js";
import { installedItemToHookPackage } from "../hooks/parser.js";

const MANAGED_ID_PREFIX = "agent-captain";

export class CodexCliClient extends BaseAgentClient {
  id = "codex-cli" as const;
  name = "Codex CLI";

  private getConfigDir(): string {
    return this.resolveHome("CODEX_HOME", ".codex");
  }

  private ensurePaths(): { configDir: string; skillsDir: string; hooksDir: string; settingsFile: string } {
    const configDir = this.getConfigDir();
    return {
      configDir,
      skillsDir: path.join(configDir, "skills"),
      hooksDir: path.join(configDir, "rules"),
      settingsFile: path.join(configDir, "config.toml"),
    };
  }

  isAvailable(): boolean {
    return fs.existsSync(this.getConfigDir());
  }

  getPaths(): AgentPaths {
    const { configDir, skillsDir, hooksDir, settingsFile } = this.ensurePaths();
    return {
      configDir,
      settingsFile,
      skillsDir,
      hooksDir,
    };
  }

  installSkill(pkg: SkillPackage, options: InstallOptions): void {
    const { skillsDir } = this.ensurePaths();
    const targetPath = path.join(skillsDir, pkg.id);

    if (fs.existsSync(targetPath)) {
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(targetPath);
        if (existingTarget === pkg.canonicalPath) return;
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
    const { skillsDir } = this.ensurePaths();
    const targetPath = path.join(skillsDir, id);
    if (!fs.existsSync(targetPath)) return;
    if (options.dryRun) return;
    removeDir(targetPath);
  }

  enableSkill(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { skillsDir } = this.ensurePaths();
    if (fs.existsSync(path.join(skillsDir, id))) return;
    if (options.dryRun) return;
    throw new Error(
      `Skill ${id} is not installed for Codex CLI. Run "agent-captain skill install ${id}" first.`
    );
  }

  disableSkill(id: string, options: Pick<InstallOptions, "dryRun">): void {
    this.removeSkill(id, options);
  }

  listSkills(): string[] {
    const { skillsDir } = this.ensurePaths();
    if (!fs.existsSync(skillsDir)) return [];
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  }

  installHook(pkg: HookPackage, options: InstallOptions): void {
    const { hooksDir } = this.ensurePaths();
    const targetPath = path.join(hooksDir, `${MANAGED_ID_PREFIX}-${pkg.id}.rules`);
    if (fs.existsSync(targetPath) && !options.force) return;
    if (options.dryRun) return;

    ensureDir(hooksDir);
    const rule = this.hookToStarlark(pkg);
    fs.writeFileSync(targetPath, rule, "utf-8");
  }

  removeHook(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { hooksDir } = this.ensurePaths();
    const targetPath = path.join(hooksDir, `${MANAGED_ID_PREFIX}-${id}.rules`);
    if (!fs.existsSync(targetPath)) return;
    if (options.dryRun) return;
    fs.unlinkSync(targetPath);
  }

  enableHook(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { hooksDir } = this.ensurePaths();
    const disabledPath = path.join(
      hooksDir,
      `${MANAGED_ID_PREFIX}-${id}.rules.disabled`
    );
    const targetPath = path.join(hooksDir, `${MANAGED_ID_PREFIX}-${id}.rules`);
    if (!fs.existsSync(disabledPath)) return;
    if (options.dryRun) return;
    fs.renameSync(disabledPath, targetPath);
  }

  disableHook(id: string, options: Pick<InstallOptions, "dryRun">): void {
    const { hooksDir } = this.ensurePaths();
    const targetPath = path.join(hooksDir, `${MANAGED_ID_PREFIX}-${id}.rules`);
    const disabledPath = path.join(
      hooksDir,
      `${MANAGED_ID_PREFIX}-${id}.rules.disabled`
    );
    if (!fs.existsSync(targetPath)) return;
    if (options.dryRun) return;
    fs.renameSync(targetPath, disabledPath);
  }

  listHooks(): string[] {
    const { hooksDir } = this.ensurePaths();
    if (!fs.existsSync(hooksDir)) return [];
    return fs
      .readdirSync(hooksDir)
      .filter((name) => name.startsWith(`${MANAGED_ID_PREFIX}-`) && name.endsWith(".rules"))
      .map((name) => name.slice(`${MANAGED_ID_PREFIX}-`.length, -".rules".length));
  }

  listAllHooks(): string[] {
    const { hooksDir } = this.ensurePaths();
    if (!fs.existsSync(hooksDir)) return [];
    return fs
      .readdirSync(hooksDir)
      .filter((name) => name.endsWith(".rules"))
      .map((name) => {
        if (name.startsWith(`${MANAGED_ID_PREFIX}-`) && name.endsWith(".rules")) {
          return name.slice(`${MANAGED_ID_PREFIX}-`.length, -".rules".length);
        }
        return name.slice(0, -".rules".length);
      });
  }

  sync(state: SyncState, options: SyncOptions): SyncReport {
    const report: SyncReport = {
      clientId: this.id,
      skills: { added: [], removed: [], enabled: [], disabled: [] },
      hooks: { added: [], removed: [], enabled: [], disabled: [] },
      errors: [],
    };

    const { skillsDir, hooksDir } = this.ensurePaths();
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
      const desiredHooks = new Map<
        string,
        { pkg: HookPackage; enabled: boolean }
      >();
      for (const [id, rawItem] of Object.entries(state.hooks)) {
        const pkg = installedItemToHookPackage(rawItem);
        const clientState = isHookInstalledItem(rawItem)
          ? rawItem.clients?.[this.id]
          : undefined;
        const enabled =
          pkg.manifest.enabled !== false && (clientState?.enabled ?? true);
        desiredHooks.set(id, { pkg, enabled });
      }

      const currentHooks = new Set(this.listHooks());

      for (const id of currentHooks) {
        const desired = desiredHooks.get(id);
        if (!desired || !desired.enabled) {
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

      for (const [id, desired] of desiredHooks) {
        if (!desired.enabled) continue;
        const targetPath = path.join(
          hooksDir,
          `${MANAGED_ID_PREFIX}-${id}.rules`
        );
        const exists = currentHooks.has(id);
        const upToDate =
          exists && this.isHookUpToDate(targetPath, desired.pkg);
        if (upToDate) continue;

        try {
          if (exists) {
            this.removeHook(id, { dryRun: options.dryRun });
            report.hooks.removed.push(id);
          }
          this.installHook(desired.pkg, {
            mode: "copy",
            dryRun: options.dryRun,
            force: true,
          });
          report.hooks.added.push(id);
        } catch (err) {
          report.errors.push(
            `hook ${id}: ${err instanceof Error ? err.message : String(err)}`
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

  private isHookUpToDate(targetPath: string, pkg: HookPackage): boolean {
    if (!fs.existsSync(targetPath)) return false;
    return fs.readFileSync(targetPath, "utf-8") === this.hookToStarlark(pkg);
  }

  private hookToStarlark(pkg: HookPackage): string {
    const manifest = pkg.manifest;
    const lines: string[] = [
      `# Managed by agent-captain: ${manifest.id}`,
      `# Event: ${manifest.event}`,
    ];

    if (manifest.matcher) {
      lines.push(`prefix_rule(`);
      lines.push(`  pattern = ["${manifest.matcher}"],`);
      lines.push(`  decision = "prompt",`);
      lines.push(`  justification = "${manifest.description ?? manifest.name}"`);
      lines.push(`)`);
    }

    return lines.join("\n") + "\n";
  }
}
