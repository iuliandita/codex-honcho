# codex-honcho

Codex adapter for Honcho MCP with local transcript sync.

This repository fills a narrow gap between OpenAI Codex and Honcho:

- A stdio MCP server that exposes Honcho memory tools to Codex.
- A local transcript sync process that imports visible Codex session messages from
  `~/.codex/sessions/**/*.jsonl` into Honcho sessions.

Honcho already has an official MCP server. This project is not a replacement for it.
It is a Codex-focused companion for users who want local Codex sessions to show up in
Honcho under a `codex` peer and remain searchable across tools.

## Requirements

- Bun. The package entrypoints are TypeScript files with a Bun shebang, so Bun is
  still the runtime when launched through `npx`, `pnpm dlx`, or `bunx`.
- Codex CLI
- A Honcho API key or self-hosted Honcho endpoint

## Install

For normal MCP use, no checkout is required. Use a package runner in your MCP
configuration:

```bash
bunx --package codex-honcho codex-honcho
npx -y codex-honcho
pnpm dlx codex-honcho
```

Or install the command globally:

```bash
bun install --global codex-honcho
npm install --global codex-honcho
pnpm add --global codex-honcho
```

After a global install, the commands are:

```bash
codex-honcho
codex-honcho-mcp
codex-honcho-sync
```

Create `~/.honcho/config.json`:

```json
{
  "apiKey": "replace-with-your-honcho-api-key-or-use-HONCHO_API_KEY",
  "peerName": "your-name",
  "endpoint": {
    "baseUrl": "https://api.honcho.dev/v3"
  },
  "hosts": {
    "codex": {
      "workspace": "replace-with-your-workspace-id",
      "aiPeer": "codex"
    }
  },
  "sessionStrategy": "per-directory",
  "sessionPeerPrefix": true,
  "observationMode": "unified"
}
```

Use a stable `workspace` value for this machine or project group, for example
`laptop`, `workstation`, or `personal-codex`. You can also omit `apiKey` and set
`HONCHO_API_KEY` in the environment.

## Wire Codex MCP

Recommended `bunx` config for `~/.codex/config.toml`:

```toml
[mcp_servers.honcho]
command = "bunx"
args = ["--package", "codex-honcho", "codex-honcho"]
```

Equivalent `npx` config:

```toml
[mcp_servers.honcho]
command = "npx"
args = ["-y", "codex-honcho"]
```

Equivalent `pnpm dlx` config:

```toml
[mcp_servers.honcho]
command = "pnpm"
args = ["dlx", "codex-honcho"]
```

If you installed the package globally:

```toml
[mcp_servers.honcho]
command = "codex-honcho"
args = []
```

Restart Codex after editing the config.

## Sync Codex Transcripts

Import recent sessions once:

```bash
bunx --package codex-honcho codex-honcho-sync --recent 20
npx -y --package codex-honcho codex-honcho-sync --recent 20
pnpm dlx --package codex-honcho codex-honcho-sync --recent 20
```

Run continuously:

```bash
bunx --package codex-honcho codex-honcho-sync --watch --recent 50
npx -y --package codex-honcho codex-honcho-sync --watch --recent 50
pnpm dlx --package codex-honcho codex-honcho-sync --watch --recent 50
```

Install a user-level systemd service:

```bash
./scripts/install-systemd-user.sh
```

The importer stores dedupe state at:

```text
~/.honcho/codex-honcho/state/codex-session-sync.json
```

## How Sessions Are Named

The MCP server and sync process use the same Honcho session name:

```text
codex-<cwd-basename>
```

For example, a Codex session in `/home/me/code/my-app` becomes:

```text
codex-my-app
```

Each imported session includes the human peer from `peerName` and the Codex peer from
`hosts.codex.aiPeer`.

## MCP Tools

The MCP server exposes:

- `search`
- `create_conclusion`
- `list_conclusions`
- `delete_conclusion`
- `get_context`
- `get_representation`
- `get_config`

The server deliberately does not expose Honcho `chat`; Codex can reason locally after
retrieving Honcho context.

## Safety Notes

- Do not commit `~/.honcho/config.json`; it may contain your API key.
- The sync process imports only visible Codex `user_message` and `agent_message` events.
  It skips encrypted reasoning and base instructions.
- Very long messages are truncated before upload. Metadata records the original length.

## Development

```bash
git clone https://github.com/iuliandita/codex-honcho.git
cd codex-honcho
bun install
bun test
bun run sync -- --recent 1 --dry-run
```
