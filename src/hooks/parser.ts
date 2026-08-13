import fs from "node:fs";
import path from "node:path";
import {
  type HookManifest,
  type HookPackage,
  type InstalledItem,
  hookManifestSchema,
} from "../types.js";
import { readJsonFile } from "../utils.js";

const HOOK_SCRIPT_CANDIDATES = [
  "hook.sh",
  "script.sh",
  "script.py",
  "script.js",
  "script",
];

export function isHookDirectory(dirPath: string): boolean {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return false;
  }
  return HOOK_SCRIPT_CANDIDATES.some((candidate) =>
    fs.existsSync(path.join(dirPath, candidate))
  );
}

export function findHookDirectories(root: string): string[] {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(root, entry.name))
    .filter(isHookDirectory);
}

export function findScriptPath(dirPath: string): string | undefined {
  for (const candidate of HOOK_SCRIPT_CANDIDATES) {
    const candidatePath = path.join(dirPath, candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  return undefined;
}

export function parseHookJson(
  filePath: string,
  idOverride?: string
): HookManifest {
  const raw = readJsonFile(filePath);
  if (!raw) {
    throw new Error(`Empty or missing hook file: ${filePath}`);
  }
  const parsed = hookManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid hook manifest: ${parsed.error.message}`);
  }
  if (idOverride) {
    return { ...parsed.data, id: idOverride };
  }
  return parsed.data;
}

export function parseHookDirectory(
  dirPath: string,
  idOverride?: string
): HookPackage {
  const resolvedPath = path.resolve(dirPath);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`Hook directory not found: ${resolvedPath}`);
  }

  const hookJsonPath = path.join(resolvedPath, "hook.json");
  const hasHookJson = fs.existsSync(hookJsonPath);

  const folderId = path.basename(resolvedPath);
  const scriptPath = findScriptPath(resolvedPath);
  if (!scriptPath) {
    throw new Error(
      `Hook directory ${resolvedPath} must contain a supported script file (hook.sh, script.sh, script.py, script.js, or script)`
    );
  }

  let manifest: HookManifest;
  if (hasHookJson) {
    manifest = parseHookJson(hookJsonPath, idOverride);
  } else {
    manifest = {
      id: idOverride ?? folderId,
      name: folderId,
      event: "PreToolUse",
      enabled: true,
    };
  }

  // Ensure fallback values for fields that may be missing.
  if (!manifest.name) {
    manifest = { ...manifest, name: manifest.id };
  }
  if (!manifest.event) {
    manifest = { ...manifest, event: "PreToolUse" };
  }
  if (!manifest.type && scriptPath) {
    manifest = { ...manifest, type: "command" };
  }

  return {
    id: manifest.id,
    manifest,
    canonicalPath: resolvedPath,
    scriptPath,
  };
}

export function installedItemToHookPackage(item: InstalledItem | HookPackage): HookPackage {
  if ("manifest" in item && !("type" in item)) {
    return item as HookPackage;
  }
  const installedItem = item as InstalledItem;
  const manifest = installedItem.manifest as HookManifest;
  const scriptPath =
    installedItem.scriptPath ?? findScriptPath(installedItem.canonicalPath);
  return {
    id: installedItem.id,
    manifest,
    canonicalPath: installedItem.canonicalPath,
    scriptPath,
  };
}
