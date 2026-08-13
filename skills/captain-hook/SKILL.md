---
name: captain-hook
description: Add agent-captain hooks from the current working directory or a provided path, following the agent-captain hook format and CLI rules.
---

# Captain Hook

When the user asks to add hooks for agent-captain, scan the current working directory (or the provided path) for hook directories.

## Hook directory rules

A valid hook directory must contain an executable shell script. The preferred script name is `hook.sh`. Legacy names `script.sh`, `script.py`, `script.js`, and `script` are also accepted for backward compatibility.

```
my-hook/
  hook.sh       # required executable shell script
  hook.json     # optional metadata manifest
```

## Metadata rules

- If `hook.json` exists, use it as the source of truth for id, name, event, matcher, type, async, conditions, and enabled.
- If `hook.json` is missing, derive metadata:
  - `id`: directory basename (or `--id` override)
  - `name`: `id`
  - `event`: `PreToolUse`
  - `type`: `command`
  - `enabled`: `true`
- If normalizing a hook, ensure the script is named `hook.sh`.

## Determining the hooks directory

The configured hooks directory is resolved in this priority order:

1. `hooksDir` in `~/.config/agent-captain/config.json`
2. `AC_HOOK_HOME` environment variable
3. Default: `~/.agents/hooks`

To check the current hooks directory, read `~/.config/agent-captain/config.json` or run:

```bash
agent-captain agent list   # shows detected config paths
```

You may also set `AC_HOOK_HOME` for the current command:

```bash
AC_HOOK_HOME=/path/to/hooks agent-captain hook list
```

## Adding hooks

The CLI no longer has a `hook add` command. Copy hook directories into the configured hooks directory manually, then enable them on target agents:

```bash
cp -r ./my-hook ~/.agents/hooks/my-hook
agent-captain hook enable my-hook --clients claude-code pi
```

For multiple hooks, copy each directory and then run `agent-captain hook sync <agents...>`:

```bash
agent-captain hook sync claude-code pi
```

## What not to do

- Do not install or enable hooks on clients unless explicitly asked.
- Do not rename or move the original source directories unless asked.
- Do not report success until the hook is present in the configured hooks directory.

## Reporting

Report which hooks were added, their ids, and any errors encountered. If no hook directories are found, say so clearly.
