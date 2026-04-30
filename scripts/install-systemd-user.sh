#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
service_file="$service_dir/codex-honcho-sync.service"
bun_bin="$(command -v bun || true)"

if [[ -z "$bun_bin" ]]; then
  echo "bun is required but was not found in PATH" >&2
  exit 1
fi

"$bun_bin" install --global "$repo_dir"
global_bin_dir="$("$bun_bin" pm bin -g)"
sync_bin="$global_bin_dir/codex-honcho-sync"

mkdir -p "$service_dir"
cat > "$service_file" <<SERVICE
[Unit]
Description=Sync Codex session transcripts into Honcho
After=network-online.target

[Service]
Type=simple
ExecStart=$sync_bin --watch --recent 50
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload
systemctl --user enable --now codex-honcho-sync.service
systemctl --user status codex-honcho-sync.service --no-pager
