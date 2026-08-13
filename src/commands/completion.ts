import { Command } from "commander";
import { error } from "../logger.js";

export function completionCommand(): Command {
  return new Command("completion")
    .description("Generate shell completion script")
    .argument("<shell>", "Shell: bash, zsh, fish, powershell, or clink")
    .action(async (shell: string) => {
      const script = generateCompletionScript(shell);
      if (!script) {
        error(`Unsupported shell: ${shell}`);
        error("Supported shells: bash, zsh, fish, powershell, clink");
        process.exit(1);
      }
      console.log(script);
    });
}

function generateCompletionScript(shell: string): string | undefined {
  switch (shell) {
    case "bash":
      return bashCompletion();
    case "zsh":
      return zshCompletion();
    case "fish":
      return fishCompletion();
    case "powershell":
      return powershellCompletion();
    case "clink":
      return clinkCompletion();
    default:
      return undefined;
  }
}

function bashCompletion(): string {
  return `#!/usr/bin/env bash
# agent-captain bash completion
# Load with: eval "$(agent-captain completion bash)"
# (\`source <(...)\` does not persist functions in bash 3.2, the default on macOS.)

_agent_captain_completion() {
  local cur prev words cword
  if declare -F _init_completion >/dev/null 2>&1; then
    _init_completion || return
  else
    words=("\${COMP_WORDS[@]}")
    cword="\${COMP_CWORD}"
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
  fi

  # bash-completion's _init_completion may or may not include the command word
  # in \`words\`. Normalize so we always scan subcommands starting after it.
  local start_idx=0
  if [[ "\${words[0]}" == "agent-captain" ]]; then
    start_idx=1
  fi

  local commands="agent skill hook completion help"
  local global_opts="--config --dry-run --verbose --version --help"

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "$global_opts" -- "$cur") )
    return 0
  fi

  local cmd=""
  local i="$start_idx"
  while [[ $i -lt \${#words[@]} ]]; do
    local w="\${words[$i]}"
    case "$w" in
      agent|skill|hook|completion|help)
        cmd="$w"
        break
        ;;
      -*)
        ;;
    esac
    i=$((i+1))
  done

  if [[ -z "$cmd" ]]; then
    COMPREPLY=( $(compgen -W "$commands $global_opts" -- "$cur") )
    return 0
  fi

  case "$cmd" in
    agent)
      COMPREPLY=( $(compgen -W "list view" -- "$cur") )
      ;;
    skill)
      local skill_cmds="list add remove install enable disable sync show"
      COMPREPLY=( $(compgen -W "$skill_cmds" -- "$cur") )
      ;;
    hook)
      local hook_cmds="list remove enable disable sync"
      COMPREPLY=( $(compgen -W "$hook_cmds" -- "$cur") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish powershell clink" -- "$cur") )
      ;;
    *)
      COMPREPLY=()
      ;;
  esac
}

complete -F _agent_captain_completion agent-captain
`;
}

function zshCompletion(): string {
  return `#compdef agent-captain
# agent-captain zsh completion
# Place in $fpath, e.g. /usr/local/share/zsh/site-functions/_agent-captain
# Then run: compinit
#
# Do not add a trailing call to _agent-captain; compinit invokes the function
# via #compdef when completion is requested.

_agent-captain() {
  local curcontext="$curcontext" state line
  typeset -A opt_args

  _arguments -C \\
    '(-c --config)'{-c,--config}'[Path to config file]:config file:_files' \\
    '(-d --dry-run)'{-d,--dry-run}'[Show what would change without making changes]' \\
    '(-v --verbose)'{-v,--verbose}'[Enable verbose logging]' \\
    '(-V --version)'{-V,--version}'[Show version]' \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '1: :->command' \\
    '*:: :->args'

  case "$state" in
    command)
      _values 'agent-captain command' \\
        'agent[Manage agents]' \\
        'skill[Manage skills]' \\
        'hook[Manage hooks]' \\
        'completion[Generate shell completion script]' \\
        'help[Show help]'
      ;;
    args)
      case "$line[1]" in
        agent)
          _values 'agent command' 'list' 'view'
          ;;
        skill)
          _values 'skill command' 'list' 'add' 'remove' 'install' 'enable' 'disable' 'sync' 'show'
          ;;
        hook)
          _values 'hook command' 'list' 'remove' 'enable' 'disable' 'sync'
          ;;
        completion)
          _values 'shell' 'bash' 'zsh' 'fish' 'powershell' 'clink'
          ;;
      esac
      ;;
  esac
}
`;
}

function fishCompletion(): string {
  return `# agent-captain fish completion
# Save to ~/.config/fish/completions/agent-captain.fish

# Global options
complete -c agent-captain -s c -l config -d "Path to config file" -r
complete -c agent-captain -s d -l dry-run -d "Show what would change"
complete -c agent-captain -s v -l verbose -d "Enable verbose logging"
complete -c agent-captain -s V -l version -d "Show version"
complete -c agent-captain -s h -l help -d "Show help"

# Top-level commands
complete -c agent-captain -f -n "__fish_use_subcommand" -a agent -d "Manage agents"
complete -c agent-captain -f -n "__fish_use_subcommand" -a skill -d "Manage skills"
complete -c agent-captain -f -n "__fish_use_subcommand" -a hook -d "Manage hooks"
complete -c agent-captain -f -n "__fish_use_subcommand" -a completion -d "Generate shell completion"
complete -c agent-captain -f -n "__fish_use_subcommand" -a help -d "Show help"

# agent subcommands
complete -c agent-captain -f -n "__fish_seen_subcommand_from agent; and not __fish_seen_subcommand_from list view" -a list -d "List agents"
complete -c agent-captain -f -n "__fish_seen_subcommand_from agent; and not __fish_seen_subcommand_from list view" -a view -d "View agent"

# skill subcommands
complete -c agent-captain -f -n "__fish_seen_subcommand_from skill; and not __fish_seen_subcommand_from list add remove install enable disable sync show" -a list -d "List skills"
complete -c agent-captain -f -n "__fish_seen_subcommand_from skill; and not __fish_seen_subcommand_from list add remove install enable disable sync show" -a add -d "Add skill"
complete -c agent-captain -f -n "__fish_seen_subcommand_from skill; and not __fish_seen_subcommand_from list add remove install enable disable sync show" -a remove -d "Remove skill"
complete -c agent-captain -f -n "__fish_seen_subcommand_from skill; and not __fish_seen_subcommand_from list add remove install enable disable sync show" -a install -d "Install skill"
complete -c agent-captain -f -n "__fish_seen_subcommand_from skill; and not __fish_seen_subcommand_from list add remove install enable disable sync show" -a enable -d "Enable skill"
complete -c agent-captain -f -n "__fish_seen_subcommand_from skill; and not __fish_seen_subcommand_from list add remove install enable disable sync show" -a disable -d "Disable skill"
complete -c agent-captain -f -n "__fish_seen_subcommand_from skill; and not __fish_seen_subcommand_from list add remove install enable disable sync show" -a sync -d "Sync skills"
complete -c agent-captain -f -n "__fish_seen_subcommand_from skill; and not __fish_seen_subcommand_from list add remove install enable disable sync show" -a show -d "Show skill"

# hook subcommands
complete -c agent-captain -f -n "__fish_seen_subcommand_from hook; and not __fish_seen_subcommand_from list remove enable disable sync" -a list -d "List hooks"
complete -c agent-captain -f -n "__fish_seen_subcommand_from hook; and not __fish_seen_subcommand_from list remove enable disable sync" -a remove -d "Remove hook"
complete -c agent-captain -f -n "__fish_seen_subcommand_from hook; and not __fish_seen_subcommand_from list remove enable disable sync" -a enable -d "Enable hook"
complete -c agent-captain -f -n "__fish_seen_subcommand_from hook; and not __fish_seen_subcommand_from list remove enable disable sync" -a disable -d "Disable hook"
complete -c agent-captain -f -n "__fish_seen_subcommand_from hook; and not __fish_seen_subcommand_from list remove enable disable sync" -a sync -d "Sync hooks"

# completion shell
complete -c agent-captain -f -n "__fish_seen_subcommand_from completion" -a "bash zsh fish powershell clink"
`;
}

function powershellCompletion(): string {
  return `# agent-captain PowerShell completion
# Add to your profile: agent-captain completion powershell | Out-String | Invoke-Expression

$script:AgentCaptainCommands = @('agent', 'skill', 'hook', 'completion', 'help')
$script:AgentCaptainSkillCommands = @('list', 'add', 'remove', 'install', 'enable', 'disable', 'sync', 'show')
$script:AgentCaptainHookCommands = @('list', 'remove', 'enable', 'disable', 'sync')
$script:AgentCaptainShells = @('bash', 'zsh', 'fish', 'powershell', 'clink')

Register-ArgumentCompleter -Native -CommandName agent-captain -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $tokens = $commandAst.CommandElements | ForEach-Object { $_.ToString() }
  $tokens = $tokens | Where-Object { $_ -notmatch '^-' }

  $completions = @()

  if ($tokens.Count -le 1) {
    $completions = $script:AgentCaptainCommands
  } else {
    switch ($tokens[1]) {
      'agent' {
        $completions = @('list', 'view')
      }
      'skill' {
        if ($tokens.Count -eq 2 -or ($tokens.Count -eq 3 -and $wordToComplete)) {
          $completions = $script:AgentCaptainSkillCommands
        }
      }
      'hook' {
        if ($tokens.Count -eq 2 -or ($tokens.Count -eq 3 -and $wordToComplete)) {
          $completions = $script:AgentCaptainHookCommands
        }
      }
      'completion' {
        $completions = $script:AgentCaptainShells
      }
      default {
        $completions = $script:AgentCaptainCommands
      }
    }
  }

  if ($wordToComplete -match '^-') {
    $completions = @('--config', '--dry-run', '--verbose', '--version', '--help')
  }

  $completions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`;
}

function clinkCompletion(): string {
  return `-- agent-captain Clink completion for Windows Command Prompt
-- Save to a file and load with: clink inject lua.load "path\\to\\agent-captain.lua"
-- Or place in %LOCALAPPDATA%\\clink

local agent_captain_commands = { "agent", "skill", "hook", "completion", "help" }
local skill_commands = { "list", "add", "remove", "install", "enable", "disable", "sync", "show" }
local hook_commands = { "list", "remove", "enable", "disable", "sync" }
local shells = { "bash", "zsh", "fish", "powershell", "clink" }

local function match_prefix(word, candidates)
  local matches = {}
  for _, candidate in ipairs(candidates) do
    if string.sub(candidate, 1, string.len(word)) == word then
      table.insert(matches, candidate)
    end
  end
  return matches
end

local function complete_agent_captain()
  local line = rl_state.line_buffer
  local words = {}
  for word in string.gmatch(line, "%S+") do
    table.insert(words, word)
  end

  -- Remove current partial word if present
  local partial = ""
  if #words > 0 and not string.match(line, "%s$") then
    partial = words[#words]
    table.remove(words)
  end

  local matches = {}

  if #words <= 1 then
    matches = agent_captain_commands
  else
    local cmd = words[2]
    if cmd == "agent" then
      matches = { "list", "view" }
    elseif cmd == "skill" then
      matches = skill_commands
    elseif cmd == "hook" then
      matches = hook_commands
    elseif cmd == "completion" then
      matches = shells
    else
      matches = agent_captain_commands
    end
  end

  if string.sub(partial, 1, 1) == "-" then
    matches = { "--config", "--dry-run", "--verbose", "--version", "--help" }
  end

  for _, match in ipairs(match_prefix(partial, matches)) do
    clink.add_match(match)
  end
end

clink.register_match_generator(complete_agent_captain, 1)
`;
}
