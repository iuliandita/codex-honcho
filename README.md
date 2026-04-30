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

- Bun
- Codex CLI
- A Honcho API key or self-hosted Honcho endpoint

## Install

For normal MCP use, no fixed checkout location is required. Configure Codex to run the
package directly from npm with Bun.

If you want to work on the source or run the systemd installer script, clone the repo
wherever you keep local source:

```bash
git clone https://github.com/iuliandita/codex-honcho.git
cd codex-honcho
bun install
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

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.honcho]
command = "bunx"
args = ["codex-honcho"]
```

The equivalent npm runner form is:

```toml
[mcp_servers.honcho]
command = "npx"
args = ["-y", "codex-honcho"]
```

Restart Codex after editing the config.

## Sync Codex Transcripts

Import recent sessions once:

```bash
bunx --package codex-honcho codex-honcho-sync --recent 20
```

Run continuously:

```bash
bunx --package codex-honcho codex-honcho-sync --watch --recent 50
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

The sync process imports Codex session JSONL files into Honcho sessions named:

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
bun install
bun test
bun run sync -- --recent 1 --dry-run
```

## Publish

The package name `codex-honcho` publishes to npm. One npm publish makes it available
through `npm install`, `npx`, `bun add`, and `bunx`.

```bash
npm login
bun run prepublishOnly
npm pack --dry-run
npm publish
```

Publishing requires an npm account with 2FA or a granular publish token. After publish,
users can run:

```bash
bunx codex-honcho
npx -y codex-honcho
```
