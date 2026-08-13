import path from "node:path";
import {
  type SyncState,
  type AgentClient,
  type AgentClientId,
  type AgentPaths,
  type HookPackage,
  type InstallOptions,
  type SkillPackage,
  type SyncOptions,
  type SyncReport,
} from "../types.js";

export abstract class BaseAgentClient implements AgentClient {
  abstract id: AgentClientId;
  abstract name: string;

  abstract isAvailable(): boolean;
  abstract getPaths(): AgentPaths;

  abstract installSkill(pkg: SkillPackage, options: InstallOptions): void;
  abstract removeSkill(
    id: string,
    options: Pick<InstallOptions, "dryRun">
  ): void;
  abstract enableSkill(
    id: string,
    options: Pick<InstallOptions, "dryRun">
  ): void;
  abstract disableSkill(
    id: string,
    options: Pick<InstallOptions, "dryRun">
  ): void;
  abstract listSkills(): string[];

  abstract installHook(pkg: HookPackage, options: InstallOptions): void;
  abstract removeHook(
    id: string,
    options: Pick<InstallOptions, "dryRun">
  ): void;
  abstract enableHook(
    id: string,
    options: Pick<InstallOptions, "dryRun">
  ): void;
  abstract disableHook(
    id: string,
    options: Pick<InstallOptions, "dryRun">
  ): void;
  abstract listHooks(): string[];

  abstract sync(state: SyncState, options: SyncOptions): SyncReport;

  protected resolveHome(homeEnvVar: string, defaultSubdir: string): string {
    const envValue = process.env[homeEnvVar];
    if (envValue) return path.resolve(envValue);
    return path.join(process.env.HOME ?? "/", defaultSubdir);
  }
}
