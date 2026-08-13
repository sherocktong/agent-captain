import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CursorClient } from "./cursor.js";
import type { AgentCaptainState, HookPackage, SkillPackage } from "../types.js";
import { ensureDir } from "../utils.js";

describe("CursorClient", () => {
  let homeDir: string;
  let originalCursorDir: string | undefined;
  let client: CursorClient;

  beforeEach(() => {
    originalCursorDir = process.env.CURSOR_DIR;
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-captain-cursor-"));
    process.env.CURSOR_DIR = path.join(homeDir, ".cursor");
    client = new CursorClient();
  });

  afterEach(() => {
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

  it("reports correct paths", () => {
    const configDir = path.join(homeDir, ".cursor");
    const paths = client.getPaths();
    expect(paths.configDir).toBe(configDir);
    expect(paths.settingsFile).toBe(path.join(configDir, "hooks.json"));
    expect(paths.skillsDir).toBe(path.join(configDir, "skills"));
    expect(paths.hooksDir).toBe(path.join(configDir, "hooks"));
  });

  it("installs and removes skills via symlink", () => {
    const pkg = makeSkillPkg("skill-a");
    client.installSkill(pkg, { mode: "symlink", dryRun: false, force: false });
    expect(client.listSkills()).toContain("skill-a");

    const installedPath = path.join(client.getPaths().skillsDir, "skill-a");
    expect(fs.lstatSync(installedPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(installedPath)).toBe(pkg.canonicalPath);

    client.removeSkill("skill-a", { dryRun: false });
    expect(client.listSkills()).not.toContain("skill-a");
  });

  it("copies skills when mode is copy", () => {
    const pkg = makeSkillPkg("skill-b");
    client.installSkill(pkg, { mode: "copy", dryRun: false, force: false });
    const installedPath = path.join(client.getPaths().skillsDir, "skill-b");
    expect(fs.existsSync(installedPath)).toBe(true);
    expect(fs.lstatSync(installedPath).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(installedPath, "SKILL.md"))).toBe(true);
  });

  it("installs and removes hooks", () => {
    const pkg = makeHookPkg("hook-a");
    client.installHook(pkg, { mode: "copy", dryRun: false, force: false });
    expect(client.listHooks()).toContain("hook-a");

    const hookDir = path.join(client.getPaths().hooksDir, "hook-a");
    expect(fs.existsSync(hookDir)).toBe(true);
    expect(fs.existsSync(path.join(hookDir, "hook.sh"))).toBe(true);

    const config = JSON.parse(fs.readFileSync(client.getPaths().settingsFile, "utf-8"));
    expect(config.version).toBe(1);
    expect(config.hooks.PreToolUse).toHaveLength(1);
    expect(config.hooks.PreToolUse[0]._source).toBe("agent-captain");
    expect(config.hooks.PreToolUse[0]._id).toBe("hook-a");
    expect(config.hooks.PreToolUse[0].command).toBe("./hooks/hook-a/hook.sh");
    expect(config.hooks.PreToolUse[0].type).toBe("command");

    client.removeHook("hook-a", { dryRun: false });
    expect(client.listHooks()).not.toContain("hook-a");
    expect(fs.existsSync(hookDir)).toBe(false);
  });

  it("preserves non-managed hooks when installing managed hooks", () => {
    const { settingsFile, hooksDir } = client.getPaths();
    ensureDir(hooksDir);
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({
        version: 1,
        hooks: {
          PreToolUse: [
            {
              command: "./hooks/user-hook/user.sh",
              type: "command",
            },
          ],
        },
      }, null, 2)
    );

    const pkg = makeHookPkg("managed-hook");
    client.installHook(pkg, { mode: "copy", dryRun: false, force: false });

    const config = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
    expect(config.hooks.PreToolUse).toHaveLength(2);
    expect(config.hooks.PreToolUse.some((entry: Record<string, unknown>) => entry.command === "./hooks/user-hook/user.sh")).toBe(true);
    expect(config.hooks.PreToolUse.some((entry: Record<string, unknown>) => entry._id === "managed-hook")).toBe(true);
  });

  it("syncs state to filesystem", () => {
    const skillPkg = makeSkillPkg("skill-sync");
    const hookPkg = makeHookPkg("hook-sync");
    const state: AgentCaptainState = {
      version: 1,
      skills: {
        "skill-sync": {
          id: "skill-sync",
          type: "skill",
          canonicalPath: skillPkg.canonicalPath,
          manifest: skillPkg.manifest,
          clients: {
            cursor: {
              enabled: true,
              mode: "symlink",
              installedPath: path.join(client.getPaths().skillsDir, "skill-sync"),
              installedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        },
      },
      hooks: {
        "hook-sync": {
          id: "hook-sync",
          type: "hook",
          canonicalPath: hookPkg.canonicalPath,
          manifest: hookPkg.manifest,
          scriptPath: hookPkg.scriptPath,
          clients: {
            cursor: {
              enabled: true,
              mode: "copy",
              installedPath: client.getPaths().settingsFile,
              installedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        },
      },
    };

    const report = client.sync(state, { dryRun: false, mode: "symlink" });
    expect(report.skills.added).toContain("skill-sync");
    expect(report.hooks.added).toContain("hook-sync");
    expect(client.listSkills()).toContain("skill-sync");
    expect(client.listHooks()).toContain("hook-sync");

    const config = JSON.parse(fs.readFileSync(client.getPaths().settingsFile, "utf-8"));
    expect(config.hooks.PreToolUse[0]._id).toBe("hook-sync");
  });

  it("deletes existing managed skills and hooks before syncing", () => {
    const oldSkillPkg = makeSkillPkg("old-skill");
    const oldHookPkg = makeHookPkg("old-hook");
    client.installSkill(oldSkillPkg, { mode: "symlink", dryRun: false, force: false });
    client.installHook(oldHookPkg, { mode: "copy", dryRun: false, force: false });
    expect(client.listSkills()).toContain("old-skill");
    expect(client.listHooks()).toContain("old-hook");

    const newSkillPkg = makeSkillPkg("new-skill");
    const newHookPkg = makeHookPkg("new-hook");
    const state: AgentCaptainState = {
      version: 1,
      skills: {
        "new-skill": {
          id: "new-skill",
          type: "skill",
          canonicalPath: newSkillPkg.canonicalPath,
          manifest: newSkillPkg.manifest,
          clients: {
            cursor: {
              enabled: true,
              mode: "symlink",
              installedPath: path.join(client.getPaths().skillsDir, "new-skill"),
              installedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        },
      },
      hooks: {
        "new-hook": {
          id: "new-hook",
          type: "hook",
          canonicalPath: newHookPkg.canonicalPath,
          manifest: newHookPkg.manifest,
          scriptPath: newHookPkg.scriptPath,
          clients: {
            cursor: {
              enabled: true,
              mode: "copy",
              installedPath: client.getPaths().settingsFile,
              installedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        },
      },
    };

    const report = client.sync(state, { dryRun: false, mode: "symlink" });
    expect(report.skills.removed).toContain("old-skill");
    expect(report.hooks.removed).toContain("old-hook");
    expect(report.skills.added).toContain("new-skill");
    expect(report.hooks.added).toContain("new-hook");
    expect(client.listSkills()).not.toContain("old-skill");
    expect(client.listHooks()).not.toContain("old-hook");
    expect(client.listSkills()).toContain("new-skill");
    expect(client.listHooks()).toContain("new-hook");
  });

  it("does not delete hooks when syncing only skills", () => {
    const oldSkillPkg = makeSkillPkg("old-skill");
    const hookPkg = makeHookPkg("preserved-hook");
    client.installSkill(oldSkillPkg, { mode: "symlink", dryRun: false, force: false });
    client.installHook(hookPkg, { mode: "copy", dryRun: false, force: false });
    expect(client.listSkills()).toContain("old-skill");
    expect(client.listHooks()).toContain("preserved-hook");

    const newSkillPkg = makeSkillPkg("new-skill");
    const state: AgentCaptainState = {
      version: 1,
      skills: {
        "new-skill": {
          id: "new-skill",
          type: "skill",
          canonicalPath: newSkillPkg.canonicalPath,
          manifest: newSkillPkg.manifest,
          clients: {
            cursor: {
              enabled: true,
              mode: "symlink",
              installedPath: path.join(client.getPaths().skillsDir, "new-skill"),
              installedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        },
      },
      hooks: {},
    };

    const report = client.sync(state, { dryRun: false, mode: "symlink" });
    expect(report.skills.removed).toContain("old-skill");
    expect(report.skills.added).toContain("new-skill");
    expect(report.hooks.removed).toEqual([]);
    expect(report.hooks.added).toEqual([]);
    expect(client.listSkills()).not.toContain("old-skill");
    expect(client.listSkills()).toContain("new-skill");
    expect(client.listHooks()).toContain("preserved-hook");
  });

  it("does not delete skills when syncing only hooks", () => {
    const skillPkg = makeSkillPkg("preserved-skill");
    const oldHookPkg = makeHookPkg("old-hook");
    client.installSkill(skillPkg, { mode: "symlink", dryRun: false, force: false });
    client.installHook(oldHookPkg, { mode: "copy", dryRun: false, force: false });
    expect(client.listSkills()).toContain("preserved-skill");
    expect(client.listHooks()).toContain("old-hook");

    const newHookPkg = makeHookPkg("new-hook");
    const state: AgentCaptainState = {
      version: 1,
      skills: {},
      hooks: {
        "new-hook": {
          id: "new-hook",
          type: "hook",
          canonicalPath: newHookPkg.canonicalPath,
          manifest: newHookPkg.manifest,
          scriptPath: newHookPkg.scriptPath,
          clients: {
            cursor: {
              enabled: true,
              mode: "copy",
              installedPath: client.getPaths().settingsFile,
              installedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        },
      },
    };

    const report = client.sync(state, { dryRun: false, mode: "symlink" });
    expect(report.hooks.removed).toContain("old-hook");
    expect(report.hooks.added).toContain("new-hook");
    expect(report.skills.removed).toEqual([]);
    expect(report.skills.added).toEqual([]);
    expect(client.listHooks()).not.toContain("old-hook");
    expect(client.listHooks()).toContain("new-hook");
    expect(client.listSkills()).toContain("preserved-skill");
  });
});
