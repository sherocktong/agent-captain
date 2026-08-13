import os from "node:os";
import path from "node:path";
import {
  type AgentCaptainConfig,
  agentCaptainConfigSchema,
  defaultConfig,
} from "./types.js";
import { ensureDir, readJsonFile } from "./utils.js";

export interface ConfigPaths {
  homeDir: string;
  configFile: string;
  skillsDir: string;
  hooksDir: string;
}

export function getConfigPaths(configPath?: string): ConfigPaths {
  const homeDir = process.env.AGENT_CAPTAIN_HOME
    ? path.resolve(process.env.AGENT_CAPTAIN_HOME)
    : path.join(os.homedir(), ".config", "agent-captain");

  const configFile =
    configPath ?? process.env.AGENT_CAPTAIN_CONFIG
      ? path.resolve(
          configPath ?? (process.env.AGENT_CAPTAIN_CONFIG as string)
        )
      : path.join(homeDir, "config.json");

  const skillsDir = resolveDir(
    process.env.AC_SKILL_HOME,
    path.join(os.homedir(), ".agents", "skills")
  );

  const hooksDir = resolveDir(
    process.env.AC_HOOK_HOME,
    path.join(os.homedir(), ".agents", "hooks")
  );

  return {
    homeDir,
    configFile,
    skillsDir,
    hooksDir,
  };
}

export function resolveConfigPaths(
  basePaths: ConfigPaths,
  config: AgentCaptainConfig
): ConfigPaths {
  const configDir = path.dirname(basePaths.configFile);
  return {
    ...basePaths,
    skillsDir: config.skillsDir
      ? path.resolve(configDir, expandTilde(config.skillsDir))
      : basePaths.skillsDir,
    hooksDir: config.hooksDir
      ? path.resolve(configDir, expandTilde(config.hooksDir))
      : basePaths.hooksDir,
  };
}

function expandTilde(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === "~") {
    return os.homedir();
  }
  return input;
}

function resolveDir(
  envValue: string | undefined,
  defaultPath: string
): string {
  return envValue ? path.resolve(expandTilde(envValue)) : defaultPath;
}

export function loadConfig(paths: ConfigPaths): AgentCaptainConfig {
  const raw = readJsonFile<Record<string, unknown>>(paths.configFile);
  const parsed = agentCaptainConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new Error(
      `Invalid config at ${paths.configFile}: ${parsed.error.message}`
    );
  }
  return { ...defaultConfig, ...parsed.data };
}

export function ensureCanonicalDirs(paths: ConfigPaths): void {
  ensureDir(paths.skillsDir);
  ensureDir(paths.hooksDir);
}
