import { getCodexHonchoSessionName } from "./codex-log";

export type ServerSessionConfig = {
  aiPeer: string;
  sessionPeerPrefix: boolean;
};

export function getServerSessionName(
  cwd: string,
  cfg: ServerSessionConfig,
): string {
  return getCodexHonchoSessionName(cwd, cfg.aiPeer, cfg.sessionPeerPrefix);
}
