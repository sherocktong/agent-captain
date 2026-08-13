import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readJsonFile<T = unknown>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const content = fs.readFileSync(filePath, "utf-8");
  if (!content.trim()) return undefined;
  try {
    return JSON.parse(content) as T;
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  fs.renameSync(tempPath, filePath);
}

export function atomicWriteFile(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, content, "utf-8");
  fs.renameSync(tempPath, filePath);
}

export function backupFile(filePath: string): string {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) return filePath;
  const backupPath = `${filePath}.backup.${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

export function restoreFile(filePath: string, backupPath: string): void {
  fs.copyFileSync(backupPath, filePath);
}

export function removeDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function copyDir(src: string, dest: string): void {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function symlinkDir(target: string, linkPath: string): void {
  ensureDir(path.dirname(linkPath));
  if (fs.existsSync(linkPath)) {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(linkPath);
    }
  }
  fs.symlinkSync(target, linkPath, "dir");
}

export function removeFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

export function renderMarkdownFile(
  filePath: string,
  frontmatter: Record<string, unknown>,
  body: string
): void {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  lines.push("");
  atomicWriteFile(filePath, lines.join("\n") + body.trim() + "\n");
}

export function renderMarkerBlock(
  content: string,
  id: string,
  block: string
): string {
  const beginMarker = `<!-- agent-captain:${id}:begin -->`;
  const endMarker = `<!-- agent-captain:${id}:end -->`;
  const escapedBegin = beginMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `\\n?${escapedBegin}[\\s\\S]*?${escapedEnd}\\n?`,
    "g"
  );
  const cleaned = content.replace(regex, "\n");
  return cleaned.trimEnd() + "\n\n" + beginMarker + "\n" + block.trim() + "\n" + endMarker + "\n";
}

export function removeMarkerBlock(content: string, id: string): string {
  const beginMarker = `<!-- agent-captain:${id}:begin -->`;
  const endMarker = `<!-- agent-captain:${id}:end -->`;
  const escapedBegin = beginMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `\\n?${escapedBegin}[\\s\\S]*?${escapedEnd}\\n?`,
    "g"
  );
  return content.replace(regex, "\n").trim() + "\n";
}

export function hasMarkerBlock(content: string, id: string): boolean {
  return content.includes(`<!-- agent-captain:${id}:begin -->`);
}

export function isSubdir(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function kebabCase(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function hookDisplayId(
  event: string,
  command: string | undefined,
  index: number
): string {
  if (!command) return `${event}:hook-${index}`;
  const firstToken = command.trim().split(/\s+/)[0];
  const isScriptLike =
    /[\\/]/.test(firstToken) || /\.(sh|py|js|ts|bash|zsh)$/i.test(firstToken);
  if (isScriptLike) {
    return `${event}:${path.basename(firstToken)}`;
  }
  return `${event}:hook-${index}`;
}
