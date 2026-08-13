import { describe, it, expect } from "vitest";
import { parseSkillMarkdown, parseSkillDirectory } from "./parser.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("parseSkillMarkdown", () => {
  it("parses valid SKILL.md frontmatter and body", () => {
    const markdown = `---
name: test-skill
description: A test skill
version: 1.0.0
---

# Test Skill

Some body.
`;
    const result = parseSkillMarkdown(markdown, "test-skill");
    expect(result.id).toBe("test-skill");
    expect(result.manifest.name).toBe("test-skill");
    expect(result.manifest.description).toBe("A test skill");
    expect(result.manifest.version).toBe("1.0.0");
    expect(result.body.trim()).toBe("# Test Skill\n\nSome body.");
  });

  it("derives id from name when not provided", () => {
    const markdown = `---
name: My Great Skill
description: A skill
---

Body.
`;
    const result = parseSkillMarkdown(markdown);
    expect(result.id).toBe("my-great-skill");
  });

  it("throws when frontmatter is missing", () => {
    expect(() => parseSkillMarkdown("No frontmatter")).toThrow();
  });

  it("throws when required fields are missing", () => {
    const markdown = `---
name: only-name
---

Body.
`;
    expect(() => parseSkillMarkdown(markdown)).toThrow();
  });
});

describe("parseSkillDirectory", () => {
  it("parses a skill directory and lists extras", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-captain-skill-"));
    fs.mkdirSync(path.join(tmpDir, "scripts"));
    fs.mkdirSync(path.join(tmpDir, "references"));
    fs.writeFileSync(
      path.join(tmpDir, "SKILL.md"),
      `---
name: dir-skill
description: From directory
---

Body.
`
    );

    const result = parseSkillDirectory(tmpDir);
    expect(result.id).toBe("dir-skill");
    expect(result.extras).toContain("scripts");
    expect(result.extras).toContain("references");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
