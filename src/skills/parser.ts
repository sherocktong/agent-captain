import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  type SkillManifest,
  type SkillPackage,
  skillManifestSchema,
} from "../types.js";
import { kebabCase } from "../utils.js";

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

export function parseSkillDirectory(dirPath: string, id?: string): SkillPackage {
  const skillFile = path.join(dirPath, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    throw new Error(`SKILL.md not found in ${dirPath}`);
  }

  const content = fs.readFileSync(skillFile, "utf-8");
  let parsed: Omit<SkillPackage, "canonicalPath" | "extras">;
  try {
    parsed = parseSkillMarkdown(content, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${skillFile}: ${message}`);
  }

  const extras = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);

  return {
    ...parsed,
    canonicalPath: path.resolve(dirPath),
    extras,
  };
}

export function parseSkillMarkdown(
  content: string,
  id?: string
): Omit<SkillPackage, "canonicalPath" | "extras"> {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) {
    throw new Error("SKILL.md must start with YAML frontmatter delimited by ---");
  }

  const frontmatter = match[1];
  const body = match[2];

  let rawManifest: unknown;
  try {
    rawManifest = YAML.parse(frontmatter);
  } catch (err) {
    throw new Error(
      `Invalid YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const parsed = skillManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    throw new Error(`Invalid SKILL.md frontmatter: ${parsed.error.message}`);
  }

  const manifest: SkillManifest = parsed.data;
  const skillId = id ?? kebabCase(manifest.name);

  return {
    id: skillId,
    manifest,
    body,
    sourcePath: undefined,
  };
}

export function findSkillDirectories(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(root, entry.name, "SKILL.md"))
    )
    .map((entry) => path.join(root, entry.name));
}
