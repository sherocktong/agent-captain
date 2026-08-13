import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { ClaudeCodeClient } from "./claude-code.js";
import type { HookPackage, SkillPackage } from "../types.js";

const distPath = path.join(process.cwd(), "dist", "index.js");

describe("agent command", () => {
  let homeDir: string;
  let originalClaudeDir: string | undefined;
  let originalCursorDir: string | undefined;
  let client: ClaudeCodeClient;

  beforeEach(() => {
    originalClaudeDir = process.env.CLAUDE_DIR;
    originalCursorDir = process.env.CURSOR_DIR;
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-captain-agent-cmd-"));
    process.env.CLAUDE_DIR = path.join(homeDir, ".claude");
    process.env.CURSOR_DIR = path.join(homeDir, ".cursor");
    client = new ClaudeCodeClient();
  });

  afterEach(() => {
    process.env.CLAUDE_DIR = originalClaudeDir;
    process.env.CURSOR_DIR = originalCursorDir;
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function makeSkillPkg(id: string): SkillPackage {
    const canonicalPath = path.join(homeDir, ".agents", "skills", id);
    fs.mkdirSync(canonicalPath, { recursive: true });
    fs.writeFileSync(
      path.join(canonicalPath, "SKILL.md"),
      `---\nname: ${id}\ndescription: test\n---\n\nbody\n`
    );
    return {
      id,
      canonicalPath,
      manifest: { name: id, description: "test" },
      body: "body",
      extras: [],
    };
  }

  function makeHookPkg(id: string): HookPackage {
    const canonicalPath = path.join(homeDir, ".agents", "hooks", id);
    fs.mkdirSync(canonicalPath, { recursive: true });
    fs.writeFileSync(
      path.join(canonicalPath, "hook.sh"),
      "#!/bin/sh\necho hello\n"
    );
    fs.writeFileSync(
      path.join(canonicalPath, "hook.json"),
      JSON.stringify({
        id,
        name: id,
        event: "PreToolUse",
        type: "command",
      })
    );
    return {
      id,
      canonicalPath,
      manifest: {
        id,
        name: id,
        event: "PreToolUse",
        type: "command",
        enabled: true,
      },
      scriptPath: path.join(canonicalPath, "hook.sh"),
    };
  }

  function run(args: string): string {
    return execSync(`node "${distPath}" ${args}`, {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: process.env.PATH,
        CLAUDE_DIR: process.env.CLAUDE_DIR,
        CURSOR_DIR: process.env.CURSOR_DIR,
      },
    });
  }

  it("views a specific agent", () => {
    const skillPkg = makeSkillPkg("viewed-skill");
    const hookPkg = makeHookPkg("viewed-hook");
    client.installSkill(skillPkg, { mode: "symlink", dryRun: false, force: false });
    client.installHook(hookPkg, { mode: "symlink", dryRun: false, force: false });

    const output = run("agent view claude-code");
    expect(output).toContain("Claude Code (claude-code)");
    expect(output).toContain("viewed-skill");
    expect(output).toContain("viewed-hook");
  });

  it("reports no skills or hooks when empty", () => {
    const output = run("agent view claude-code");
    expect(output).toContain("skills:       (none)");
    expect(output).toContain("hooks:        (none)");
  });

  it("exits with an error for an invalid agent id", () => {
    expect(() => run("agent view not-an-agent")).toThrow();
  });
});
