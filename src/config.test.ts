import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { getConfigPaths, resolveConfigPaths } from "./config.js";
import { defaultConfig } from "./types.js";

describe("config paths", () => {
  it("defaults skillsDir and hooksDir to ~/.agents", () => {
    delete process.env.AC_SKILL_HOME;
    delete process.env.AC_HOOK_HOME;
    const paths = getConfigPaths();
    expect(paths.homeDir).toBe(path.join(os.homedir(), ".config", "agent-captain"));
    expect(paths.skillsDir).toBe(path.join(os.homedir(), ".agents", "skills"));
    expect(paths.hooksDir).toBe(path.join(os.homedir(), ".agents", "hooks"));
  });

  it("respects AGENT_CAPTAIN_HOME for config home", () => {
    const customHome = path.join(os.tmpdir(), "ac-home-test");
    process.env.AGENT_CAPTAIN_HOME = customHome;
    delete process.env.AC_SKILL_HOME;
    delete process.env.AC_HOOK_HOME;
    const paths = getConfigPaths();
    expect(paths.homeDir).toBe(customHome);
    expect(paths.configFile).toBe(path.join(customHome, "config.json"));
    // skills/hooks defaults stay under ~/.agents unless configured.
    expect(paths.skillsDir).toBe(path.join(os.homedir(), ".agents", "skills"));
    expect(paths.hooksDir).toBe(path.join(os.homedir(), ".agents", "hooks"));
    delete process.env.AGENT_CAPTAIN_HOME;
  });

  it("resolveConfigPaths applies absolute configured directories", () => {
    const base = getConfigPaths();
    const resolved = resolveConfigPaths(base, {
      ...defaultConfig,
      skillsDir: "/custom/skills",
      hooksDir: "/custom/hooks",
    });
    expect(resolved.skillsDir).toBe("/custom/skills");
    expect(resolved.hooksDir).toBe("/custom/hooks");
  });

  it("resolveConfigPaths resolves relative paths against config directory", () => {
    const base = getConfigPaths();
    const resolved = resolveConfigPaths(base, {
      ...defaultConfig,
      skillsDir: "./skills",
      hooksDir: "../hooks",
    });
    expect(resolved.skillsDir).toBe(path.join(path.dirname(base.configFile), "skills"));
    expect(resolved.hooksDir).toBe(path.join(path.dirname(base.configFile), "..", "hooks"));
  });

  it("respects AC_SKILL_HOME and AC_HOOK_HOME over defaults", () => {
    process.env.AC_SKILL_HOME = "/custom/env/skills";
    process.env.AC_HOOK_HOME = "~/custom/env/hooks";
    const paths = getConfigPaths();
    expect(paths.skillsDir).toBe("/custom/env/skills");
    expect(paths.hooksDir).toBe(path.join(os.homedir(), "custom", "env", "hooks"));
    delete process.env.AC_SKILL_HOME;
    delete process.env.AC_HOOK_HOME;
  });

  it("config file overrides take precedence over env vars", () => {
    process.env.AC_SKILL_HOME = "/env/skills";
    process.env.AC_HOOK_HOME = "/env/hooks";
    const base = getConfigPaths();
    const resolved = resolveConfigPaths(base, {
      ...defaultConfig,
      skillsDir: "/config/skills",
      hooksDir: "/config/hooks",
    });
    expect(resolved.skillsDir).toBe("/config/skills");
    expect(resolved.hooksDir).toBe("/config/hooks");
    delete process.env.AC_SKILL_HOME;
    delete process.env.AC_HOOK_HOME;
  });

  it("resolveConfigPaths expands tilde to the user home", () => {
    const base = getConfigPaths();
    const resolved = resolveConfigPaths(base, {
      ...defaultConfig,
      skillsDir: "~/custom/skills",
    });
    expect(resolved.skillsDir).toBe(path.join(os.homedir(), "custom", "skills"));
  });

  it("resolveConfigPaths keeps defaults when keys are absent", () => {
    const base = getConfigPaths();
    const resolved = resolveConfigPaths(base, defaultConfig);
    expect(resolved.skillsDir).toBe(base.skillsDir);
    expect(resolved.hooksDir).toBe(base.hooksDir);
  });
});
