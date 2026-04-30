import { describe, expect, test } from "bun:test";
import { getCodexHonchoSessionName, parseCodexSessionJsonl } from "./codex-log";

describe("parseCodexSessionJsonl", () => {
  test("extracts user and assistant event messages without base instructions", () => {
    const parsed = parseCodexSessionJsonl(
      [
        JSON.stringify({
          timestamp: "2026-04-30T10:00:24.531Z",
          type: "session_meta",
          payload: {
            id: "session-1",
            cwd: "/home/id/work/code/toolkit-environment",
            cli_version: "0.125.0",
            base_instructions: { text: "do not import this" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-30T10:01:00.000Z",
          type: "event_msg",
          payload: { type: "user_message", message: "hello [Image #1]", local_images: ["/tmp/a.png"] },
        }),
        JSON.stringify({
          timestamp: "2026-04-30T10:01:02.000Z",
          type: "response_item",
          payload: { type: "reasoning", encrypted_content: "ignore" },
        }),
        JSON.stringify({
          timestamp: "2026-04-30T10:01:03.000Z",
          type: "event_msg",
          payload: { type: "agent_message", message: "hi", phase: "final" },
        }),
      ].join("\n"),
      "/tmp/session.jsonl",
    );

    expect(parsed.meta?.id).toBe("session-1");
    expect(parsed.meta?.cwd).toBe("/home/id/work/code/toolkit-environment");
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toMatchObject({
      role: "user",
      content: "hello [Image #1]",
      createdAt: "2026-04-30T10:01:00.000Z",
      lineNumber: 2,
    });
    expect(parsed.events[0].metadata.codex_local_images).toEqual(["/tmp/a.png"]);
    expect(parsed.events[1]).toMatchObject({
      role: "assistant",
      content: "hi",
    });
    expect(parsed.events[1].metadata.codex_phase).toBe("final");
  });

  test("skips malformed lines and empty messages", () => {
    const parsed = parseCodexSessionJsonl(
      [
        "{not json",
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "token_count", message: "ignore" } }),
      ].join("\n"),
    );

    expect(parsed.skippedLines).toBe(1);
    expect(parsed.events).toHaveLength(0);
  });
});

describe("getCodexHonchoSessionName", () => {
  test("uses the codex peer prefix and sanitized cwd basename", () => {
    expect(getCodexHonchoSessionName("/home/id/work/code/toolkit-environment", "codex")).toBe(
      "codex-toolkit-environment",
    );
    expect(getCodexHonchoSessionName("/tmp/a repo!", "codex")).toBe("codex-a-repo");
  });
});
