#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
service_file="$service_dir/codex-honcho-sync.service"

mkdir -p "$service_dir"
cat > "$service_file" <<SERVICE
[Unit]
Description=Sync Codex session transcripts into Honcho
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$repo_dir
ExecStart=/usr/bin/env bun run src/sync-codex-sessions.ts --watch --recent 50
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload
systemctl --user enable --now codex-honcho-sync.service
systemctl --user status codex-honcho-sync.service --no-pager
