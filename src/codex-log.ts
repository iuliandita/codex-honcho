import { basename } from "node:path";

export type CodexRole = "user" | "assistant";

export type CodexSessionMeta = {
  id: string;
  cwd: string;
  startedAt?: string;
  cliVersion?: string;
  modelProvider?: string;
  originator?: string;
};

export type CodexTranscriptEvent = {
  eventId: string;
  role: CodexRole;
  content: string;
  createdAt: string;
  lineNumber: number;
  metadata: Record<string, unknown>;
};

export type ParsedCodexSession = {
  meta: CodexSessionMeta | null;
  events: CodexTranscriptEvent[];
  skippedLines: number;
};

type RawCodexRecord = {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
};

export function sanitizeForSessionName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "session";
}

export function getCodexHonchoSessionName(cwd: string, aiPeer: string, withPrefix = true): string {
  const repo = sanitizeForSessionName(basename(cwd));
  const peer = sanitizeForSessionName(aiPeer);
  return withPrefix ? `${peer}-${repo}` : repo;
}

export function parseCodexSessionJsonl(content: string, sourcePath = ""): ParsedCodexSession {
  let meta: CodexSessionMeta | null = null;
  let skippedLines = 0;
  const events: CodexTranscriptEvent[] = [];

  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: RawCodexRecord;
    try {
      record = JSON.parse(trimmed) as RawCodexRecord;
    } catch {
      skippedLines += 1;
      continue;
    }

    if (record.type === "session_meta" && record.payload) {
      const payload = record.payload as any;
      meta = {
        id: String(payload.id ?? ""),
        cwd: String(payload.cwd ?? ""),
        startedAt: payload.timestamp ?? record.timestamp,
        cliVersion: payload.cli_version,
        modelProvider: payload.model_provider,
        originator: payload.originator,
      };
      continue;
    }

    if (record.type !== "event_msg" || !record.payload) continue;

    const payload = record.payload as any;
    const payloadType = payload.type;
    const contentValue = payloadType === "user_message" ? payload.message : payload.message;
    if (typeof contentValue !== "string" || contentValue.trim().length === 0) continue;

    const role: CodexRole | null =
      payloadType === "user_message"
        ? "user"
        : payloadType === "agent_message"
          ? "assistant"
          : null;
    if (!role) continue;

    const sessionId = meta?.id || "unknown-session";
    const eventId = `${sessionId}:${lineNumber}:${role}`;
    events.push({
      eventId,
      role,
      content: contentValue,
      createdAt: record.timestamp ?? new Date().toISOString(),
      lineNumber,
      metadata: {
        source: "codex-session-jsonl",
        codex_session_id: sessionId,
        codex_event_id: eventId,
        codex_line_number: lineNumber,
        codex_payload_type: payloadType,
        codex_phase: payload.phase,
        codex_log_path: sourcePath,
        codex_local_images: payload.local_images ?? [],
      },
    });
  }

  return { meta, events, skippedLines };
}
