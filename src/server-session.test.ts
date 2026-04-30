import { describe, expect, test } from "bun:test";
import { getServerSessionName } from "./server-session";

describe("getServerSessionName", () => {
  test("matches the Codex transcript sync session name", () => {
    expect(
      getServerSessionName("/home/me/code/my-app", {
        aiPeer: "codex",
        sessionPeerPrefix: true,
      }),
    ).toBe("codex-my-app");
  });

  test("uses aiPeer rather than the human peer for the session prefix", () => {
    expect(
      getServerSessionName("/home/me/code/my-app", {
        aiPeer: "assistant-peer",
        sessionPeerPrefix: true,
      }),
    ).toBe("assistant-peer-my-app");
  });
});
