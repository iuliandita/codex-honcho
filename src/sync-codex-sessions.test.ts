import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  syncFile,
  type RuntimeConfig,
  type SyncState,
} from "./sync-codex-sessions";

function makeTranscript(eventCount: number): string {
  const lines = [
    JSON.stringify({
      timestamp: "2026-04-30T10:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "session-1",
        cwd: "/home/me/code/my-app",
      },
    }),
  ];

  for (let i = 0; i < eventCount; i += 1) {
    lines.push(
      JSON.stringify({
        timestamp: `2026-04-30T10:00:${String(i + 1).padStart(2, "0")}.000Z`,
        type: "event_msg",
        payload: {
          type: i % 2 === 0 ? "user_message" : "agent_message",
          message: `message ${i + 1}`,
        },
      }),
    );
  }

  return lines.join("\n");
}

function makeConfig(): RuntimeConfig {
  return {
    apiKey: "test",
    baseUrl: "http://localhost:8000/v3",
    workspace: "test",
    peerName: "user",
    aiPeer: "codex",
    sessionPeerPrefix: true,
  };
}

describe("syncFile", () => {
  test("marks each successful batch as imported before a later batch failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-honcho-sync-"));
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, makeTranscript(26));

    const state: SyncState = { importedEventIds: {} };
    const userPeer = {
      message: (content: string, options: unknown) => ({
        content,
        options,
        peer: "user",
      }),
    };
    const aiPeer = {
      message: (content: string, options: unknown) => ({
        content,
        options,
        peer: "codex",
      }),
    };
    const session = {
      id: "honcho-session-id",
      addPeers: async () => undefined,
      setMetadata: async () => undefined,
      addMessages: async (messages: unknown[]) => {
        if (messages.length === 1) throw new Error("second batch failed");
      },
    };
    const honcho = {
      peer: async (name: string) => (name === "codex" ? aiPeer : userPeer),
      session: async () => session,
    };

    await expect(
      syncFile(honcho as never, makeConfig(), state, filePath, false),
    ).rejects.toThrow("second batch failed");

    expect(Object.keys(state.importedEventIds)).toHaveLength(25);
    expect(state.importedEventIds["session-1:2:user"]).toBe(true);
    expect(state.importedEventIds["session-1:26:user"]).toBe(true);
    expect(state.importedEventIds["session-1:27:assistant"]).toBeUndefined();
  });
});
