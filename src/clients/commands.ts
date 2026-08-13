import { Command } from "commander";
import { getAllClients, getClient } from "../clients/index.js";
import { agentClientIds, type AgentClientId } from "../types.js";
import { error, info } from "../logger.js";

export function agentCommand(): Command {
  const command = new Command("agent").description("Manage agents");

  command
    .command("list")
    .description("List detected agents and their paths")
    .action(async () => {
      for (const agent of getAllClients()) {
        const detected = agent.isAvailable();
        info(`${agent.id}: ${agent.name}`);
        if (detected) {
          const paths = agent.getPaths();
          info(`  config dir:   ${paths.configDir}`);
          info(`  settings:     ${paths.settingsFile}`);
          info(`  skills dir:   ${paths.skillsDir}`);
          info(`  hooks dir:    ${paths.hooksDir}`);
        }
      }
    });

  command
    .command("view")
    .description("Show skills and hooks installed for an agent")
    .argument("<agent-id>", "Agent ID")
    .action(async (agentId) => {
      validateAgentId(agentId);
      const client = getClient(agentId);
      const available = client.isAvailable();
      const paths = client.getPaths();
      const skills = client.listSkills();
      const hooks = client.listHooks();

      info(`${client.name} (${client.id})`);
      info(`  available:    ${available ? "yes" : "no"}`);
      info(`  config dir:   ${paths.configDir}`);
      info(`  settings:     ${paths.settingsFile}`);
      info(`  skills dir:   ${paths.skillsDir}`);
      info(`  hooks dir:    ${paths.hooksDir}`);
      info(`  skills:       ${skills.length > 0 ? skills.join(", ") : "(none)"}`);
      info(`  hooks:        ${hooks.length > 0 ? hooks.join(", ") : "(none)"}`);
    });

  return command;
}

export function validateAgentId(id: string): asserts id is AgentClientId {
  if (!agentClientIds.includes(id as AgentClientId)) {
    error(
      `Unknown agent: ${id}. Valid agents: ${agentClientIds.join(", ")}`
    );
    process.exit(1);
  }
}
