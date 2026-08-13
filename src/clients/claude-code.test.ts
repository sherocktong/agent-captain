import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ClaudeCodeClient } from "./claude-code.js";
import type { AgentCaptainState, HookPackage, SkillPackage } from "../types.js";

describe("ClaudeCodeClient", () => {
  let homeDir: string;
  let client: ClaudeCodeClient;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-captain-claude-"));
    process.env.CLAUDE_DIR = path.join(homeDir, ".claude");
    process.env.AGENT_CAPTAIN_HOME = path.join(homeDir, ".config", "agent-captain");
    client = new ClaudeCodeClient();
  });

  function makeSkillPkg(id: string): SkillPackage {
    const canonicalPath = path.join(homeDir, ".config", "agent-captain", "skills", id);
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
    return {
      id,
      canonicalPath: "/tmp",
      manifest: {
        id,
        name: id,
        event: "PreToolUse",
        command: `echo ${id}`,
        type: "command",
        enabled: true,
      },
    };
  }

  it("installs and removes skills", () => {
    const pkg = makeSkillPkg("skill-a");
    client.installSkill(pkg, { mode: "symlink", dryRun: false, force: false });
    expect(client.listSkills()).toContain("skill-a");

    client.removeSkill("skill-a", { dryRun: false });
    expect(client.listSkills()).not.toContain("skill-a");
  });

  it("copies skills when mode is copy", () => {
    const pkg = makeSkillPkg("skill-b");
    client.installSkill(pkg, { mode: "copy", dryRun: false, force: false });
    const installedPath = path.join(client.getPaths().skillsDir, "skill-b");
    expect(fs.existsSync(installedPath)).toBe(true);
    expect(fs.lstatSync(installedPath).isSymbolicLink()).toBe(false);
  });

  it("installs and removes hooks", () => {
    const pkg = makeHookPkg("hook-a");
    client.installHook(pkg, { mode: "symlink", dryRun: false, force: false });
    expect(client.listHooks()).toContain("hook-a");

    client.removeHook("hook-a", { dryRun: false });
    expect(client.listHooks()).not.toContain("hook-a");
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
            "claude-code": {
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
          clients: {
            "claude-code": {
              enabled: true,
              mode: "symlink",
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
  });

  it("deletes existing managed skills and hooks before syncing", () => {
    const oldSkillPkg = makeSkillPkg("old-skill");
    const oldHookPkg = makeHookPkg("old-hook");
    client.installSkill(oldSkillPkg, { mode: "symlink", dryRun: false, force: false });
    client.installHook(oldHookPkg, { mode: "symlink", dryRun: false, force: false });
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
            "claude-code": {
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
          clients: {
            "claude-code": {
              enabled: true,
              mode: "symlink",
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
    client.installHook(hookPkg, { mode: "symlink", dryRun: false, force: false });
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
            "claude-code": {
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
    client.installHook(oldHookPkg, { mode: "symlink", dryRun: false, force: false });
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
          clients: {
            "claude-code": {
              enabled: true,
              mode: "symlink",
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
