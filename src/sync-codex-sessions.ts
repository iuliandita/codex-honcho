#!/usr/bin/env bun
import { Honcho } from "@honcho-ai/sdk";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getCodexHonchoSessionName, parseCodexSessionJsonl, type CodexTranscriptEvent } from "./codex-log";

type FileConfig = {
  apiKey?: string;
  peerName?: string;
  endpoint?: { baseUrl?: string; environment?: "production" | "local" };
  hosts?: Record<string, { workspace?: string; aiPeer?: string }>;
  sessionPeerPrefix?: boolean;
};

type RuntimeConfig = {
  apiKey: string;
  baseUrl: string;
  workspace: string;
  peerName: string;
  aiPeer: string;
  sessionPeerPrefix: boolean;
};

type SyncState = {
  importedEventIds: Record<string, true>;
};

type CliOptions = {
  files: string[];
  all: boolean;
  recent: number;
  watch: boolean;
  dryRun: boolean;
  intervalMs: number;
  statePath: string;
};

const CONFIG_PATH = resolve(homedir(), ".honcho/config.json");
const DEFAULT_CODEX_SESSIONS_DIR = resolve(homedir(), ".codex/sessions");
const DEFAULT_STATE_PATH = resolve(homedir(), ".honcho/codex-honcho/state/codex-session-sync.json");
const PROD_URL = "https://api.honcho.dev/v3";
const LOCAL_URL = "http://localhost:8000/v3";
const MAX_MESSAGE_CHARS = 24000;

function loadConfig(): RuntimeConfig {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as FileConfig;
  const apiKey = process.env.HONCHO_API_KEY ?? raw.apiKey;
  if (!apiKey) throw new Error(`Missing HONCHO_API_KEY or apiKey in ${CONFIG_PATH}`);

  const codexBlock = raw.hosts?.codex ?? {};
  return {
    apiKey,
    baseUrl: raw.endpoint?.baseUrl ?? (raw.endpoint?.environment === "local" ? LOCAL_URL : PROD_URL),
    workspace: codexBlock.workspace ?? "machine",
    peerName: raw.peerName ?? process.env.USER ?? "user",
    aiPeer: codexBlock.aiPeer ?? "codex",
    sessionPeerPrefix: raw.sessionPeerPrefix !== false,
  };
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    files: [],
    all: false,
    recent: 20,
    watch: false,
    dryRun: false,
    intervalMs: 5000,
    statePath: DEFAULT_STATE_PATH,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      options.files.push(resolve(argv[++i]));
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--recent") {
      options.recent = Number.parseInt(argv[++i] ?? "", 10);
    } else if (arg === "--watch") {
      options.watch = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--interval-ms") {
      options.intervalMs = Number.parseInt(argv[++i] ?? "", 10);
    } else if (arg === "--state") {
      options.statePath = resolve(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.recent) || options.recent < 1) options.recent = 20;
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1000) options.intervalMs = 5000;
  return options;
}

function walkJsonlFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

function loadState(path: string): SyncState {
  if (!existsSync(path)) return { importedEventIds: {} };
  return JSON.parse(readFileSync(path, "utf-8")) as SyncState;
}

function saveState(path: string, state: SyncState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const body = (error as any).body ? ` body=${JSON.stringify((error as any).body)}` : "";
    return `${error.name}: ${error.message}${body}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function eventPeer(event: CodexTranscriptEvent, cfg: RuntimeConfig): string {
  return event.role === "user" ? cfg.peerName : cfg.aiPeer;
}

function truncateForHoncho(content: string): { content: string; truncated: boolean; originalLength: number } {
  if (content.length <= MAX_MESSAGE_CHARS) {
    return { content, truncated: false, originalLength: content.length };
  }

  return {
    content: `${content.slice(0, MAX_MESSAGE_CHARS)}\n\n[truncated by codex-honcho-sync; original length: ${content.length} chars]`,
    truncated: true,
    originalLength: content.length,
  };
}

async function syncFile(
  honcho: Honcho,
  cfg: RuntimeConfig,
  state: SyncState,
  filePath: string,
  dryRun: boolean,
): Promise<number> {
  const parsed = parseCodexSessionJsonl(readFileSync(filePath, "utf-8"), filePath);
  if (!parsed.meta?.cwd || parsed.events.length === 0) return 0;

  const newEvents = parsed.events.filter((event) => !state.importedEventIds[event.eventId]);
  if (newEvents.length === 0) return 0;

  const sessionName = getCodexHonchoSessionName(parsed.meta.cwd, cfg.aiPeer, cfg.sessionPeerPrefix);
  if (dryRun) {
    console.log(`[dry-run] ${filePath}: would import ${newEvents.length} messages into ${sessionName}`);
    return newEvents.length;
  }

  const userPeer = await honcho.peer(cfg.peerName);
  const aiPeer = await honcho.peer(cfg.aiPeer);
  const session = await honcho.session(sessionName);
  await session.addPeers([userPeer, aiPeer]);
  await session.setMetadata({
    source: "codex-session-jsonl",
    codex_session_id: parsed.meta.id,
    codex_cwd: parsed.meta.cwd,
    codex_cli_version: parsed.meta.cliVersion,
    codex_originator: parsed.meta.originator,
    codex_model_provider: parsed.meta.modelProvider,
  });

  const messages = newEvents.map((event) => {
    const peer = event.role === "user" ? userPeer : aiPeer;
    const normalized = truncateForHoncho(event.content);
    return peer.message(normalized.content, {
      createdAt: event.createdAt,
      metadata: {
        ...event.metadata,
        codex_role: event.role,
        codex_peer: eventPeer(event, cfg),
        codex_truncated: normalized.truncated,
        codex_original_length: normalized.originalLength,
      },
    });
  });

  const batchSize = 25;
  for (let i = 0; i < messages.length; i += batchSize) {
    await session.addMessages(messages.slice(i, i + batchSize));
  }

  for (const event of newEvents) {
    state.importedEventIds[event.eventId] = true;
  }

  console.log(`${filePath}: imported ${newEvents.length} messages into ${sessionName}`);
  return newEvents.length;
}

async function runOnce(options: CliOptions): Promise<number> {
  const cfg = loadConfig();
  const honcho = new Honcho({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl,
    workspaceId: cfg.workspace,
    timeout: 60000,
    maxRetries: 1,
  });
  const state = loadState(options.statePath);
  const files =
    options.files.length > 0
      ? options.files
      : walkJsonlFiles(DEFAULT_CODEX_SESSIONS_DIR).slice(0, options.all ? undefined : options.recent);

  let imported = 0;
  for (const file of files) {
    try {
      imported += await syncFile(honcho, cfg, state, file, options.dryRun);
    } catch (error) {
      console.error(`${file}: ${formatError(error)}`);
    } finally {
      if (!options.dryRun) saveState(options.statePath, state);
    }
  }
  return imported;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  do {
    try {
      const imported = await runOnce(options);
      if (imported === 0 && !options.watch) console.log("No new Codex messages to import.");
    } catch (error) {
      console.error(formatError(error));
      if (!options.watch) process.exitCode = 1;
    }

    if (!options.watch) return;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, options.intervalMs));
  } while (true);
}

await main();
