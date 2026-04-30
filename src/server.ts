#!/usr/bin/env bun
// Stdio MCP shim that wires OpenAI Codex into the same self-hosted Honcho
// backend as the Claude Code claude-honcho plugin. Mirrors most of the
// plugin's tool surface (search, create_conclusion, list_conclusions,
// delete_conclusion, get_context, get_representation, get_config) but
// deliberately omits `chat`. Codex already has its own LLM (the OpenAI
// model running the agent loop); routing reasoning through Honcho's
// server-side dialectic adds a 30-60s cross-provider hop with no benefit
// over fetching the user's representation/context and reasoning locally.
// Removing `chat` means agents augment their own prompts via get_context
// /get_representation, which is faster, billed against the agent's own
// model budget, and avoids a hard dependency on Honcho's dialectic uptime.
//
// Single source of truth for credentials/endpoint is ~/.honcho/config.json.
// Reads hosts.codex from there so writes attribute to peer "codex".
// Defaults to "unified" observation mode (matches plugin default): all
// peer-scoped operations go through the user peer ("id"), so conclusions and
// representations live at id.conclusionsOf(id) and merge cleanly with what
// the Claude Code plugin writes.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Honcho } from "@honcho-ai/sdk";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, basename } from "node:path";

const CONFIG_PATH = resolve(homedir(), ".honcho/config.json");

type FileConfig = {
  apiKey?: string;
  peerName?: string;
  endpoint?: { baseUrl?: string; environment?: "production" | "local" };
  hosts?: Record<string, { workspace?: string; aiPeer?: string }>;
  sessionStrategy?: "per-directory" | "chat-instance" | "git-branch";
  sessionPeerPrefix?: boolean;
  observationMode?: "unified" | "directional";
  reasoningLevel?: "minimal" | "low" | "medium" | "high" | "max";
};

const PROD_URL = "https://api.honcho.dev/v3";
const LOCAL_URL = "http://localhost:8000/v3";

function loadConfig(): {
  apiKey: string;
  baseUrl: string;
  workspace: string;
  peerName: string;
  aiPeer: string;
  observationMode: "unified" | "directional";
  reasoningLevel: string;
  sessionPeerPrefix: boolean;
} {
  let raw: FileConfig = {};
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as FileConfig;
  } catch (e) {
    console.error(`[codex-honcho] cannot read ${CONFIG_PATH}: ${(e as Error).message}`);
    process.exit(1);
  }

  const apiKey = process.env.HONCHO_API_KEY ?? raw.apiKey;
  if (!apiKey) {
    console.error("[codex-honcho] missing HONCHO_API_KEY (env or config.apiKey)");
    process.exit(1);
  }

  const baseUrl =
    raw.endpoint?.baseUrl ??
    (raw.endpoint?.environment === "local" ? LOCAL_URL : PROD_URL);

  const codexBlock = raw.hosts?.codex ?? {};
  const workspace = codexBlock.workspace ?? "default";
  const aiPeer = codexBlock.aiPeer ?? "codex";
  const peerName = raw.peerName ?? process.env.USER ?? "user";

  return {
    apiKey,
    baseUrl,
    workspace,
    peerName,
    aiPeer,
    observationMode: raw.observationMode ?? "unified",
    reasoningLevel: raw.reasoningLevel ?? "medium",
    sessionPeerPrefix: raw.sessionPeerPrefix !== false,
  };
}

function sanitizeForSessionName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "session";
}

function getSessionName(cwd: string, peerName: string, withPrefix: boolean): string {
  const repo = sanitizeForSessionName(basename(cwd));
  const peer = sanitizeForSessionName(peerName);
  return withPrefix ? `${peer}-${repo}` : repo;
}

const cfg = loadConfig();

// Timeout: 60s. The plugin's 8s default is fine for reads (search, list, get)
// but starves chat/dialectic, which hits an LLM round-trip via OpenRouter
// (kimi-k2.6 / deepseek-v4-pro per honcho-config.yaml) and routinely takes
// 10-30s. One global ceiling keeps the shim simple; reads return fast anyway.
const honcho = new Honcho({
  apiKey: cfg.apiKey,
  baseURL: cfg.baseUrl,
  workspaceId: cfg.workspace,
  timeout: 60000,
  maxRetries: 1,
});

const TOOLS = [
  {
    name: "search",
    description:
      "Search across messages using semantic search. Defaults to the current session; use scope='workspace' to search across all sessions.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default 10)" },
        scope: {
          type: "string",
          enum: ["session", "workspace"],
          description: "Search scope (default 'session')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "create_conclusion",
    description: "Save a key insight or biographical detail about the user to Honcho's memory",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The insight or fact to remember" },
      },
      required: ["content"],
    },
  },
  {
    name: "list_conclusions",
    description:
      "List conclusions Honcho has saved about the user. Use this to review what is remembered before creating duplicates, or to find IDs for deletion.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number", description: "Page number (1-indexed, default 1)" },
        size: { type: "number", description: "Results per page (max 100, default 20)" },
      },
    },
  },
  {
    name: "delete_conclusion",
    description: "Delete a conclusion from Honcho's memory by ID. Use list_conclusions to find the ID first.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Conclusion ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_context",
    description:
      "Retrieve the full context object (representation + peer card) from Honcho for the current user. Scoped by observation mode.",
    inputSchema: {
      type: "object",
      properties: {
        max_conclusions: { type: "number", description: "Max conclusions to include (default 25)" },
      },
    },
  },
  {
    name: "get_representation",
    description: "Retrieve the user's representation string from Honcho. Lighter-weight than get_context.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_config",
    description: "Get the current codex-honcho shim configuration (read-only).",
    inputSchema: { type: "object", properties: {} },
  },
];

const server = new Server(
  { name: "codex-honcho", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  // Configure once per call, mirroring plugin's per-call resolution.
  const userPeer = await honcho.peer(cfg.peerName);
  const aiPeer =
    cfg.observationMode === "directional" ? await honcho.peer(cfg.aiPeer) : null;
  const activePeer = cfg.observationMode === "unified" ? userPeer : aiPeer!;
  const chatTarget = cfg.observationMode === "unified" ? undefined : cfg.peerName;
  const contextTarget = chatTarget;

  // Peer-only tools (no session needed).
  if (name === "list_conclusions" || name === "delete_conclusion") {
    try {
      const scopePeer =
        cfg.observationMode === "unified" ? userPeer : await honcho.peer(cfg.aiPeer);
      const conclusionScope = scopePeer.conclusionsOf(cfg.peerName);

      if (name === "list_conclusions") {
        const page = (args.page as number) ?? 1;
        const size = Math.min((args.size as number) ?? 20, 100);
        const result = await conclusionScope.list({ page, size });
        const items = (result.items ?? []).map((c: any) => ({
          id: c.id,
          content: c.content,
          createdAt: c.createdAt ?? c.created_at,
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { items, total: result.total, page: result.page, pages: result.pages },
                null,
                2,
              ),
            },
          ],
        };
      }

      const id = args.id as string;
      await conclusionScope.delete(id);
      return { content: [{ type: "text", text: `Deleted conclusion ${id}` }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === "get_config") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              workspace: cfg.workspace,
              peerName: cfg.peerName,
              aiPeer: cfg.aiPeer,
              observationMode: cfg.observationMode,
              endpoint: { type: "custom", url: cfg.baseUrl },
              shim: "codex-honcho",
              shimVersion: "0.1.0",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // Session-scoped tools.
  const sessionName = getSessionName(process.cwd(), cfg.peerName, cfg.sessionPeerPrefix);

  try {
    const session = await honcho.session(sessionName);

    switch (name) {
      case "search": {
        const query = args.query as string;
        const limit = (args.limit as number) ?? 10;
        const scope = (args.scope as string) ?? "session";
        const messages =
          scope === "workspace"
            ? await honcho.search(query, { limit })
            : await session.search(query, { limit });
        const results = (messages as any[]).map((msg) => ({
          content: msg.content,
          peerId: msg.peer ?? msg.peer_id,
          createdAt: msg.createdAt ?? msg.created_at,
        }));
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "create_conclusion": {
        const content = args.content as string;
        const conclusions = await activePeer.conclusionsOf(cfg.peerName).create({
          content,
          sessionId: session.id,
        });
        const saved =
          Array.isArray(conclusions) && conclusions.length > 0
            ? conclusions[0]!.content
            : content;
        return { content: [{ type: "text", text: `Saved conclusion: ${saved}` }] };
      }

      case "get_context": {
        const maxConclusions = (args.max_conclusions as number) ?? 25;
        const ctx = await activePeer.context({
          ...(contextTarget ? { target: contextTarget } : {}),
          maxConclusions,
          includeMostFrequent: true,
        } as any);
        return { content: [{ type: "text", text: JSON.stringify(ctx, null, 2) }] };
      }

      case "get_representation": {
        const rep = await activePeer.representation(
          contextTarget ? ({ target: contextTarget } as any) : undefined,
        );
        const text = typeof rep === "string" ? rep : JSON.stringify(rep, null, 2);
        return { content: [{ type: "text", text }] };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
