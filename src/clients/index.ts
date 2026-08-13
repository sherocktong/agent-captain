import { type AgentClient, type AgentClientId } from "../types.js";
import { ClaudeCodeClient } from "./claude-code.js";
import { CodexCliClient } from "./codex-cli.js";
import { CursorClient } from "./cursor.js";
import { OpencodeClient } from "./opencode.js";
import { PiClient } from "./pi.js";

export * from "./base.js";
export { ClaudeCodeClient } from "./claude-code.js";
export { CodexCliClient } from "./codex-cli.js";
export { CursorClient } from "./cursor.js";
export { OpencodeClient } from "./opencode.js";
export { PiClient } from "./pi.js";

export function getClient(id: AgentClientId): AgentClient {
  switch (id) {
    case "claude-code":
      return new ClaudeCodeClient();
    case "codex-cli":
      return new CodexCliClient();
    case "cursor":
      return new CursorClient();
    case "opencode":
      return new OpencodeClient();
    case "pi":
      return new PiClient();
    default:
      throw new Error(`Unsupported agent client: ${id}`);
  }
}

export function getAllClients(): AgentClient[] {
  return [
    new ClaudeCodeClient(),
    new CodexCliClient(),
    new CursorClient(),
    new OpencodeClient(),
    new PiClient(),
  ];
}

export function getClientName(id: AgentClientId): string {
  try {
    return getClient(id).name;
  } catch {
    return id;
  }
}
