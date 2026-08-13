import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  mergeHooksIntoSettings,
  readClaudeSettings,
  listManagedHookIds,
} from "./merger.js";
import type { HookPackage } from "../types.js";

function makeHookPkg(id: string, event = "PreToolUse"): HookPackage {
  return {
    id,
    canonicalPath: "/tmp",
    manifest: {
      id,
      name: id,
      event,
      matcher: "Bash",
      command: `echo ${id}`,
      type: "command",
      enabled: true,
    },
  };
}

describe("mergeHooksIntoSettings", () => {
  let settingsPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-captain-hooks-"));
    settingsPath = path.join(tmpDir, "settings.json");
  });

  it("adds managed hooks to an empty settings file", () => {
    mergeHooksIntoSettings(settingsPath, [makeHookPkg("hook-a")], {
      dryRun: false,
    });
    const settings = readClaudeSettings(settingsPath);
    expect(settings.hooks?.PreToolUse).toHaveLength(1);
    const handler = settings.hooks?.PreToolUse?.[0].hooks[0];
    expect(handler?._source).toBe("agent-captain");
    expect(handler?._id).toBe("hook-a");
  });

  it("preserves non-managed hooks", () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [{ type: "command", command: "echo user" }],
            },
          ],
        },
      })
    );

    mergeHooksIntoSettings(settingsPath, [makeHookPkg("hook-a")], {
      dryRun: false,
    });
    const settings = readClaudeSettings(settingsPath);
    expect(settings.hooks?.PreToolUse).toHaveLength(2);
  });

  it("replaces managed hooks with the same id", () => {
    mergeHooksIntoSettings(settingsPath, [makeHookPkg("hook-a")], {
      dryRun: false,
    });
    const updated = makeHookPkg("hook-a");
    updated.manifest.command = "echo updated";
    mergeHooksIntoSettings(settingsPath, [updated], { dryRun: false });
    const settings = readClaudeSettings(settingsPath);
    const handler = settings.hooks?.PreToolUse?.[0].hooks[0];
    expect(handler?.command).toBe("echo updated");
    expect(listManagedHookIds(settingsPath)).toEqual(["hook-a"]);
  });

  it("does not write in dry-run mode", () => {
    mergeHooksIntoSettings(settingsPath, [makeHookPkg("hook-a")], {
      dryRun: true,
    });
    expect(fs.existsSync(settingsPath)).toBe(false);
  });
});
