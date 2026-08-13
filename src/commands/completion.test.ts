import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "..", "..", "dist", "index.js");

function runCompletion(shell: string): string {
  return execSync(`node "${distPath}" completion ${shell}`, {
    encoding: "utf-8",
    cwd: path.join(__dirname, "..", ".."),
  });
}

function bashCompletions(script: string, words: string[], cword: number): string {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-bash-test-"));
  const scriptPath = path.join(tmpDir, "completion.bash");
  writeFileSync(scriptPath, script, "utf-8");
  const wordArray = words.map((w) => `"${w}"`).join(" ");
  const result = execSync(
    `bash -c 'source "${scriptPath}"; COMP_WORDS=(${wordArray}); COMP_CWORD=${cword}; _agent_captain_completion; printf "%s\\n" "\${COMPREPLY[@]}"'`,
    { encoding: "utf-8" }
  );
  return result.trim();
}

describe("completion command", () => {
  it("generates a bash completion script", () => {
    const script = runCompletion("bash");
    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain("_agent_captain_completion");
    expect(script).toContain("complete -F _agent_captain_completion agent-captain");
  });

  it("bash completion returns top-level commands", () => {
    const script = runCompletion("bash");
    const reply = bashCompletions(script, ["agent-captain", ""], 1);
    expect(reply).toContain("agent");
    expect(reply).toContain("skill");
    expect(reply).toContain("hook");
    expect(reply).toContain("completion");
  });

  it("bash completion returns agent subcommands", () => {
    const script = runCompletion("bash");
    const reply = bashCompletions(script, ["agent-captain", "agent", ""], 2);
    expect(reply).toContain("list");
    expect(reply).toContain("view");
  });

  it("generates a zsh completion script", () => {
    const script = runCompletion("zsh");
    expect(script).toContain("#compdef agent-captain");
    expect(script).toContain("_agent-captain");
  });

  it("generates a fish completion script", () => {
    const script = runCompletion("fish");
    expect(script).toContain("complete -c agent-captain");
    expect(script).toContain("__fish_use_subcommand");
  });

  it("generates a PowerShell completion script", () => {
    const script = runCompletion("powershell");
    expect(script).toContain("Register-ArgumentCompleter");
    expect(script).toContain("agent-captain");
  });

  it("generates a Clink completion script", () => {
    const script = runCompletion("clink");
    expect(script).toContain("clink.register_match_generator");
    expect(script).toContain("agent_captain_commands");
  });
});
