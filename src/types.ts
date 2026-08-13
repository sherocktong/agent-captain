import { z } from "zod";

export const agentClientIds = [
  "claude-code",
  "codex-cli",
  "cursor",
  "cline",
  "opencode",
  "pi",
] as const;

export type AgentClientId = (typeof agentClientIds)[number];

export const skillManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().optional(),
  "argument-hint": z.string().optional(),
  "allowed-tools": z.array(z.string()).optional(),
  triggers: z.array(z.string()).optional(),
  "disable-model-invocation": z.boolean().optional(),
});

export type SkillManifest = z.infer<typeof skillManifestSchema>;

export interface SkillPackage {
  id: string;
  manifest: SkillManifest;
  body: string;
  canonicalPath: string;
  sourcePath?: string;
  extras: string[];
}

export const hookTypeSchema = z.enum([
  "command",
  "http",
  "mcp_tool",
  "prompt",
  "agent",
]);

export type HookType = z.infer<typeof hookTypeSchema>;

export const hookConditionSchema = z.object({
  field: z.string(),
  operator: z.string(),
  pattern: z.string(),
});

export type HookCondition = z.infer<typeof hookConditionSchema>;

export const hookManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  event: z.string().min(1),
  matcher: z.string().optional(),
  command: z.string().optional(),
  type: hookTypeSchema.optional(),
  async: z.boolean().optional(),
  conditions: z.array(hookConditionSchema).optional(),
  enabled: z.boolean().default(true),
});

export type HookManifest = z.infer<typeof hookManifestSchema>;

export interface HookPackage {
  id: string;
  manifest: HookManifest;
  scriptPath?: string;
  canonicalPath: string;
}

export interface InstallOptions {
  mode: "copy" | "symlink";
  dryRun: boolean;
  force: boolean;
}

export interface SyncOptions {
  dryRun: boolean;
  mode?: "copy" | "symlink";
  clients?: AgentClientId[];
}

export interface AgentPaths {
  configDir: string;
  settingsFile: string;
  skillsDir: string;
  hooksDir: string;
}

export interface SyncReport {
  clientId: AgentClientId;
  skills: { added: string[]; removed: string[]; enabled: string[]; disabled: string[] };
  hooks: { added: string[]; removed: string[]; enabled: string[]; disabled: string[] };
  errors: string[];
}

export interface AgentClient {
  id: AgentClientId;
  name: string;
  isAvailable(): boolean;
  getPaths(): AgentPaths;

  installSkill(pkg: SkillPackage, options: InstallOptions): void;
  removeSkill(id: string, options: Pick<InstallOptions, "dryRun">): void;
  enableSkill(id: string, options: Pick<InstallOptions, "dryRun">): void;
  disableSkill(id: string, options: Pick<InstallOptions, "dryRun">): void;
  listSkills(): string[];

  installHook(pkg: HookPackage, options: InstallOptions): void;
  removeHook(id: string, options: Pick<InstallOptions, "dryRun">): void;
  enableHook(id: string, options: Pick<InstallOptions, "dryRun">): void;
  disableHook(id: string, options: Pick<InstallOptions, "dryRun">): void;
  listHooks(): string[];

  sync(state: SyncState, options: SyncOptions): SyncReport;
}

export interface SyncState {
  version: number;
  skills: Record<string, InstalledItem | SkillPackage>;
  hooks: Record<string, InstalledItem | HookPackage>;
}

export interface ClientInstallation {
  enabled: boolean;
  mode: "copy" | "symlink";
  installedPath: string;
  installedAt: string;
  updatedAt: string;
}

export interface InstalledItem {
  id: string;
  type: "skill" | "hook";
  canonicalPath: string;
  manifest: SkillManifest | HookManifest;
  scriptPath?: string;
  clients: Partial<Record<AgentClientId, ClientInstallation>>;
}

export function isSkillInstalledItem(
  item: SkillPackage | InstalledItem
): item is InstalledItem {
  return "clients" in item;
}

export function isHookInstalledItem(
  item: HookPackage | InstalledItem
): item is InstalledItem {
  return "clients" in item;
}

export interface AgentCaptainState {
  version: number;
  skills: Record<string, InstalledItem>;
  hooks: Record<string, InstalledItem>;
}

export const agentCaptainConfigSchema = z.object({
  activeClients: z.array(z.enum(agentClientIds)).default([]),
  defaultInstallMode: z.enum(["copy", "symlink"]).default("symlink"),
  sources: z.array(z.string()).default([]),
  logLevel: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO"),
  hooksDir: z.string().optional(),
  skillsDir: z.string().optional(),
});

export type AgentCaptainConfig = z.infer<typeof agentCaptainConfigSchema>;

export const defaultState: AgentCaptainState = {
  version: 1,
  skills: {},
  hooks: {},
};

export const defaultConfig: AgentCaptainConfig = {
  activeClients: [],
  defaultInstallMode: "symlink",
  sources: [],
  logLevel: "INFO",
};
