import fs from "node:fs";
import path from "node:path";
import type { HookManifest, HookPackage } from "../types.js";
import {
  atomicWriteFile,
  backupFile,
  ensureDir,
  readJsonFile,
  restoreFile,
} from "../utils.js";

export const MANAGED_SOURCE_TAG = "agent-captain";

export interface ClaudeHookEntry {
  matcher?: string;
  if?: string;
  hooks: Array<Record<string, unknown>>;
}

export interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookEntry[]>;
  [key: string]: unknown;
}

export function readClaudeSettings(settingsPath: string): ClaudeSettings {
  if (!fs.existsSync(settingsPath)) return {};
  return (readJsonFile(settingsPath) ?? {}) as ClaudeSettings;
}

export function writeClaudeSettings(
  settingsPath: string,
  settings: ClaudeSettings
): void {
  ensureDir(path.dirname(settingsPath));
  atomicWriteFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

export function isManagedHook(handler: Record<string, unknown>): boolean {
  return handler._source === MANAGED_SOURCE_TAG && typeof handler._id === "string";
}

export function getManagedHookId(handler: Record<string, unknown>): string {
  return handler._id as string;
}

function handlerToClaude(
  manifest: HookManifest,
  scriptPath?: string
): Record<string, unknown> {
  const handler: Record<string, unknown> = {
    _source: MANAGED_SOURCE_TAG,
    _id: manifest.id,
  };

  if (manifest.type) {
    handler.type = manifest.type;
  } else if (manifest.command || scriptPath) {
    handler.type = "command";
  }

  if (manifest.command) {
    handler.command = manifest.command;
  } else if (scriptPath) {
    handler.command = scriptPath;
  }

  if (manifest.async) handler.async = true;

  return handler;
}

export function buildManagedHooks(
  hooks: HookPackage[]
): Record<string, ClaudeHookEntry[]> {
  const result: Record<string, ClaudeHookEntry[]> = {};

  for (const hook of hooks) {
    if (!hook.manifest.enabled) continue;
    const event = hook.manifest.event;
    const entry: ClaudeHookEntry = {
      hooks: [handlerToClaude(hook.manifest, hook.scriptPath)],
    };
    if (hook.manifest.matcher) entry.matcher = hook.manifest.matcher;
    result[event] = result[event] ?? [];
    result[event].push(entry);
  }

  return result;
}

export function mergeHooksIntoSettings(
  settingsPath: string,
  enabledHooks: HookPackage[],
  options: { dryRun: boolean }
): { backupPath?: string; changed: boolean } {
  const settings = readClaudeSettings(settingsPath);
  const managedHooks = buildManagedHooks(enabledHooks);

  // Preserve existing non-managed hooks.
  const cleanedHooks: Record<string, ClaudeHookEntry[]> = {};
  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    for (const entry of entries) {
      const nonManagedHandlers = entry.hooks.filter(
        (handler) => !isManagedHook(handler)
      );
      if (nonManagedHandlers.length === 0) continue;
      const cleanedEntry: ClaudeHookEntry = { hooks: nonManagedHandlers };
      if (entry.matcher) cleanedEntry.matcher = entry.matcher;
      if (entry.if) cleanedEntry.if = entry.if;
      cleanedHooks[event] = cleanedHooks[event] ?? [];
      cleanedHooks[event].push(cleanedEntry);
    }
  }

  // Merge managed hooks.
  const mergedHooks: Record<string, ClaudeHookEntry[]> = { ...cleanedHooks };
  for (const [event, entries] of Object.entries(managedHooks)) {
    mergedHooks[event] = mergedHooks[event] ?? [];
    mergedHooks[event].push(...entries);
  }

  const changed =
    JSON.stringify(settings.hooks ?? {}) !== JSON.stringify(mergedHooks);

  if (!changed || options.dryRun) {
    return { changed };
  }

  const backupPath = backupFile(settingsPath);
  const newSettings: ClaudeSettings = { ...settings, hooks: mergedHooks };
  try {
    writeClaudeSettings(settingsPath, newSettings);
    return { backupPath, changed };
  } catch (err) {
    restoreFile(settingsPath, backupPath);
    throw err;
  }
}

export function listManagedHookIds(settingsPath: string): string[] {
  const settings = readClaudeSettings(settingsPath);
  const ids = new Set<string>();
  for (const entries of Object.values(settings.hooks ?? {})) {
    for (const entry of entries) {
      for (const handler of entry.hooks) {
        if (isManagedHook(handler)) {
          ids.add(getManagedHookId(handler));
        }
      }
    }
  }
  return Array.from(ids);
}
