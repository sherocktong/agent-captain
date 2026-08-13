import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  findHookDirectories,
  installedItemToHookPackage,
  isHookDirectory,
  parseHookDirectory,
} from "./parser.js";
import type { HookManifest, InstalledItem } from "../types.js";

describe("hook parser", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ac-hook-parser-"));
  });

  function makeHookDir(id: string, files: Record<string, string>): string {
    const dir = path.join(tmpDir, id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content, "utf-8");
    }
    return dir;
  }

  it("parses a hook directory with hook.json and hook.sh", () => {
    const dir = makeHookDir("my-hook", {
      "hook.json": JSON.stringify({
        id: "my-hook",
        name: "My Hook",
        event: "PreToolUse",
        matcher: "Bash",
      }),
      "hook.sh": "#!/bin/sh\necho 'hello'",
    });

    const pkg = parseHookDirectory(dir);
    expect(pkg.id).toBe("my-hook");
    expect(pkg.manifest.name).toBe("My Hook");
    expect(pkg.manifest.event).toBe("PreToolUse");
    expect(pkg.manifest.matcher).toBe("Bash");
    expect(pkg.manifest.type).toBe("command");
    expect(pkg.scriptPath).toBe(path.join(dir, "hook.sh"));
  });

  it("parses a hook directory with only hook.sh using defaults", () => {
    const dir = makeHookDir("simple-hook", {
      "hook.sh": "#!/bin/sh\necho 'simple'",
    });

    const pkg = parseHookDirectory(dir);
    expect(pkg.id).toBe("simple-hook");
    expect(pkg.manifest.name).toBe("simple-hook");
    expect(pkg.manifest.event).toBe("PreToolUse");
    expect(pkg.manifest.type).toBe("command");
    expect(pkg.manifest.enabled).toBe(true);
    expect(pkg.scriptPath).toBe(path.join(dir, "hook.sh"));
  });

  it("respects --id override", () => {
    const dir = makeHookDir("folder-name", {
      "hook.json": JSON.stringify({ id: "json-id", name: "JSON Hook", event: "PreToolUse" }),
      "hook.sh": "#!/bin/sh",
    });

    const pkg = parseHookDirectory(dir, "override-id");
    expect(pkg.id).toBe("override-id");
    expect(pkg.manifest.id).toBe("override-id");
  });

  it("falls back to legacy script.sh", () => {
    const dir = makeHookDir("legacy-hook", {
      "hook.json": JSON.stringify({ id: "legacy-hook", name: "Legacy", event: "PostToolUse" }),
      "script.sh": "#!/bin/sh\necho legacy",
    });

    const pkg = parseHookDirectory(dir);
    expect(pkg.scriptPath).toBe(path.join(dir, "script.sh"));
    expect(pkg.manifest.event).toBe("PostToolUse");
  });

  it("prefers hook.sh over script.sh", () => {
    const dir = makeHookDir("both-scripts", {
      "hook.sh": "#!/bin/sh\necho modern",
      "script.sh": "#!/bin/sh\necho legacy",
    });

    const pkg = parseHookDirectory(dir);
    expect(pkg.scriptPath).toBe(path.join(dir, "hook.sh"));
  });

  it("throws for a directory without a supported script", () => {
    const dir = makeHookDir("empty-hook", {
      "README.md": "# No script here",
    });

    expect(() => parseHookDirectory(dir)).toThrow();
  });

  it("finds hook directories", () => {
    makeHookDir("hook-a", { "hook.sh": "#!/bin/sh" });
    makeHookDir("hook-b", { "hook.json": JSON.stringify({ id: "hook-b" }), "hook.sh": "#!/bin/sh" });
    fs.mkdirSync(path.join(tmpDir, "not-a-hook"));
    fs.writeFileSync(path.join(tmpDir, "not-a-hook", "README.md"), "# noop");

    const dirs = findHookDirectories(tmpDir);
    expect(dirs.length).toBe(2);
    expect(dirs.map((d) => path.basename(d)).sort()).toEqual(["hook-a", "hook-b"]);
  });

  it("isHookDirectory returns true only for directories with scripts", () => {
    const hookDir = makeHookDir("real", { "hook.sh": "#!/bin/sh" });
    const emptyDir = path.join(tmpDir, "empty");
    fs.mkdirSync(emptyDir);
    expect(isHookDirectory(hookDir)).toBe(true);
    expect(isHookDirectory(emptyDir)).toBe(false);
  });

  it("installedItemToHookPackage derives scriptPath from canonicalPath", () => {
    const hookDir = makeHookDir("state-hook", {
      "hook.json": JSON.stringify({ id: "state-hook", name: "State Hook", event: "PreToolUse" }),
      "hook.sh": "#!/bin/sh",
    });

    const item: InstalledItem = {
      id: "state-hook",
      type: "hook",
      canonicalPath: hookDir,
      manifest: {
        id: "state-hook",
        name: "State Hook",
        event: "PreToolUse",
        enabled: true,
      } as HookManifest,
      clients: {},
    };

    const pkg = installedItemToHookPackage(item);
    expect(pkg.id).toBe("state-hook");
    expect(pkg.scriptPath).toBe(path.join(hookDir, "hook.sh"));
  });
});
