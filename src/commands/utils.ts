import type { OptionValues } from "commander";
import type { AgentClientId } from "../types.js";

export function parseClientsOption(
  options: OptionValues,
  activeClients: AgentClientId[]
): AgentClientId[] {
  const agents =
    options.agents && Array.isArray(options.agents) && options.agents.length > 0
      ? options.agents
      : options.clients && Array.isArray(options.clients) && options.clients.length > 0
        ? options.clients
        : [];
  if (agents.length > 0) {
    return agents as AgentClientId[];
  }
  return activeClients;
}

export function parseModeOption(options: OptionValues): "copy" | "symlink" {
  if (options.copy) return "copy";
  if (options.symlink) return "symlink";
  return "symlink";
}

export function parseInstallOptions(options: OptionValues): {
  mode: "copy" | "symlink";
  dryRun: boolean;
  force: boolean;
} {
  return {
    mode: parseModeOption(options),
    dryRun: !!options.dryRun,
    force: !!options.force,
  };
}

export function formatDate(date = new Date()): string {
  return date.toISOString();
}
