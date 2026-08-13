# agent-captain

Cross-agent package manager for skills and hooks.

`agent-captain` manages reusable instructions (skills) and lifecycle rules (hooks) across AI agent clients such as Claude Code, Codex CLI, Cursor, OpenCode, and Pi. Configuration lives under `~/.config/agent-captain/`; skills and hooks live under `~/.agents/` by default. The CLI projects each skill/hook into the native format expected by each client.

## Supported clients

- `claude-code`
- `codex-cli`
- `cursor`
- `opencode`
- `pi`

## Installation

```bash
npm install
npm run build
npm link
```

Or run directly without linking:

```bash
node dist/index.js --help
```

## Quick start

```bash
# 1. Add a skill under ~/.agents/skills
agent-captain skill add ./path/to/my-skill

# 2. Enable it on one or more agents
agent-captain skill enable my-skill --clients claude-code codex-cli

# 3. Put a hook under ~/.agents/hooks (copy or create the directory manually)
cp -r ./path/to/my-hook ~/.agents/hooks/my-hook

# 4. Enable it on one or more agents
agent-captain hook enable my-hook --clients claude-code codex-cli
```

## Skill format

A skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does
version: 0.1.0
---

# My Skill

Instructions for the agent.
```

The skill id is derived from `name` (kebab-case) or set explicitly with `--id`.

## Hook format

A hook is a directory containing a shell script. The preferred script name is `hook.sh`; legacy names `script.sh`, `script.py`, `script.js`, and `script` are also accepted.

```
~/.agents/hooks/
  my-hook/
    hook.sh       # required executable shell script
    hook.json     # optional metadata manifest
```

`hook.json` is optional. When present it provides unified parameters that apply to every client:

```json
{
  "id": "my-hook",
  "name": "My Hook",
  "event": "PreToolUse",
  "matcher": "Bash",
  "type": "command",
  "async": false,
  "enabled": true
}
```

Field derivation when `hook.json` is omitted:

| Field | Default |
|---|---|
| `id` | folder basename (or `--id` override) |
| `name` | `id` |
| `event` | `PreToolUse` |
| `type` | `command` when a script exists |
| `enabled` | `true` |

If `hook.json` provides a `command`, it is used; otherwise client adapters fall back to executing the script file.

You can also include a `script.sh`, `script.py`, `script.js`, or `script` file in the hook directory as a backward-compatible alternative to `hook.sh`.

## How each client receives skills and hooks

| Client | Skill | Hook |
|---|---|---|
| Claude Code | `~/.claude/skills/<id>/` | merged into `~/.claude/settings.json` with `_source: "agent-captain"` tags |
| Codex CLI | `~/.codex/skills/<id>/` | `~/.codex/rules/agent-captain-<id>.rules` (Starlark) |
| Cursor | `~/.cursor/skills/<id>/` | `~/.cursor/hooks.json` with scripts in `~/.cursor/hooks/<id>/` |
| OpenCode | `~/.config/opencode/skills/<id>.md` | not supported (OpenCode uses plugins) |
| Pi | `~/.pi/agent/skills/<id>/SKILL.md` | merged into `~/.pi/agent/settings.json` with `_source: "agent-captain"` tags |

## Commands

### Global options

```text
-c, --config <path>   Path to config file
-d, --dry-run         Show what would change without making changes
-v, --verbose         Enable verbose logging
```

### `agent`

```bash
agent-captain agent list                    # list detected agents and their paths
agent-captain agent view claude-code        # show skills and hooks installed for claude-code
```

### `skill`

```bash
agent-captain skill list                     # list skills in configured skillsDir
agent-captain skill list --source ./skills   # list skills from a directory
agent-captain skill add ./my-skill           # add skill under configured skillsDir
agent-captain skill add ./my-skill --id foo  # add with explicit id
agent-captain skill remove my-skill          # remove from configured skillsDir and clients
agent-captain skill install my-skill --clients claude-code codex-cli
agent-captain skill enable my-skill --clients claude-code
agent-captain skill disable my-skill --clients claude-code
agent-captain skill sync claude-code codex-cli  # reconcile skills across clients
agent-captain skill show my-skill            # show parsed SKILL.md frontmatter
```

### `hook`

```bash
agent-captain hook list                      # list hooks in configured hooksDir
agent-captain hook list --source ./hooks     # list hooks from a directory
agent-captain hook remove my-hook            # remove from configured hooksDir
agent-captain hook enable my-hook --clients claude-code
agent-captain hook disable my-hook --clients claude-code
agent-captain hook sync claude-code codex-cli  # reconcile hooks across clients
```

## Configuration

`~/.config/agent-captain/config.json`:

```json
{
  "activeClients": ["claude-code", "codex-cli"],
  "defaultInstallMode": "symlink",
  "sources": [],
  "logLevel": "INFO",
  "skillsDir": "~/.agents/skills",
  "hooksDir": "~/.agents/hooks"
}
```

- `activeClients`: clients used when `--clients` is omitted
- `defaultInstallMode`: `symlink` or `copy`
- `sources`: directories to scan with `skill list --source`
- `logLevel`: `DEBUG`, `INFO`, `WARN`, or `ERROR`
- `skillsDir`: directory containing skill folders (default: `~/.agents/skills`)
- `hooksDir`: directory containing hook folders (default: `~/.agents/hooks`)

Relative paths in `skillsDir`/`hooksDir` are resolved relative to the directory containing `config.json`.

## Environment variables

- `AC_SKILL_HOME` — override the default skills directory (`~/.agents/skills`)
- `AC_HOOK_HOME` — override the default hooks directory (`~/.agents/hooks`)
- `AGENT_CAPTAIN_HOME` — override `~/.config/agent-captain` directory
- `AGENT_CAPTAIN_CONFIG` — override config file path
- `CURSOR_DIR` — override Cursor config dir (default `~/.cursor`)
- `CLAUDE_DIR` — override Claude Code config dir (default `~/.claude`)
- `CODEX_HOME` — override Codex CLI config dir (default `~/.codex`)
- `OPENCODE_CONFIG` — override OpenCode config dir (default `~/.config/opencode`)
- `PI_CODING_AGENT_DIR` — override Pi config dir (default `~/.pi/agent`)

## Shell autocompletion

`agent-captain` can generate completion scripts for bash, zsh, fish, PowerShell, and Clink (Windows Command Prompt).

### Zsh (default on macOS)

```zsh
# Place the completion file in a directory in your $fpath
agent-captain completion zsh > /usr/local/share/zsh/site-functions/_agent-captain
# Then restart zsh or run: compinit
```

### Bash

```bash
# Temporary for the current shell (use eval because bash 3.2's source <(...) doesn't persist functions)
eval "$(agent-captain completion bash)"

# Permanent — append the script to ~/.bashrc so it is sourced normally
agent-captain completion bash >> ~/.bashrc
```

### Fish

```fish
agent-captain completion fish > ~/.config/fish/completions/agent-captain.fish
```

### PowerShell

```powershell
# Add to your profile
agent-captain completion powershell | Out-String | Invoke-Expression
```

### Clink (Windows Command Prompt)

```cmd
agent-captain completion clink > "%LOCALAPPDATA%\clink\agent-captain.lua"
```

## Development

```bash
npm run dev      # watch mode
npm run build    # production build
npm test         # run tests
npm run typecheck
```

## Project structure

- `src/index.ts` — CLI entrypoint
- `src/clients/` — agent client adapters
- `src/skills/` — skill parser and commands
- `src/hooks/` — hook merger and commands
