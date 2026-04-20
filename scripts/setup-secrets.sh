#!/usr/bin/env bash
# Provision or refresh secrets in Google Secret Manager from functions/.env.
#
# Usage:
#   scripts/setup-secrets.sh          # interactive: prompts before overwriting
#   scripts/setup-secrets.sh --force  # non-interactive: always create new version
#
# Requires:
#   - firebase CLI logged in with project admin rights
#   - functions/.env containing the current secret values
#   - secretmanager.googleapis.com API enabled on the Firebase project
#
# This script reads each secret listed in SECRETS below from functions/.env,
# and either creates the secret in GSM (if missing) or adds a new version.
# It never prints secret values to stdout or logs.

set -euo pipefail

# Resolve env file: explicit ENV_FILE override takes precedence, else use
# functions/.env relative to current working directory (so the script works
# from any worktree as long as you `cd` to the main repo or a copy that has
# the real `.env` locally).
ENV_FILE="${ENV_FILE:-$PWD/functions/.env}"
FORCE=0

if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ $ENV_FILE not found. Cannot bootstrap secrets without local values." >&2
  exit 1
fi

# Canonical list of secrets that functions/src/config/secrets.ts declares.
# Keep in sync with that file. Non-secret env vars (EMAIL_HOST, OWNER_UID, etc.)
# are NOT included — those live in .env and are prokcidied as function env vars,
# not Secret Manager.
SECRETS=(
  WORKER_BOT_TOKEN
  COSTS_BOT_TOKEN
  TELEGRAM_TOKEN
  TELEGRAM_BOT_TOKEN
  WORKER_PASSWORD
  GEMINI_API_KEY
  ANTHROPIC_API_KEY
  OPENAI_API_KEY
  AGENT_API_KEY
  EMAIL_PASSWORD
  BREVO_API_KEY
)

# Read a single value from .env without exporting/leaking to environment.
read_env_value() {
  local key="$1"
  awk -F= -v k="^${key}=" '$0 ~ k { sub(k, ""); gsub(/^["[:space:]]+|["[:space:]]+$/, ""); print; exit }' "$ENV_FILE"
}

secret_exists() {
  local name="$1"
  firebase functions:secrets:access "$name" >/dev/null 2>&1
}

created=0
updated=0
skipped=0

for name in "${SECRETS[@]}"; do
  value="$(read_env_value "$name")"
  if [[ -z "$value" ]]; then
    echo "⚠️  $name: no value in $ENV_FILE — skipping"
    skipped=$((skipped + 1))
    continue
  fi

  if secret_exists "$name"; then
    if [[ "$FORCE" -eq 0 ]]; then
      read -r -p "ℹ️  $name exists in Secret Manager. Add new version? [y/N] " ans
      if [[ ! "$ans" =~ ^[Yy]$ ]]; then
        echo "⏭  $name: kept existing version"
        skipped=$((skipped + 1))
        continue
      fi
    fi
    # pipe value via stdin to avoid leaking into history
    printf "%s" "$value" | firebase functions:secrets:set "$name" --data-file=- >/dev/null
    echo "🔁 $name: new version added"
    updated=$((updated + 1))
  else
    printf "%s" "$value" | firebase functions:secrets:set "$name" --data-file=- >/dev/null
    echo "✨ $name: created in Secret Manager"
    created=$((created + 1))
  fi
done

echo ""
echo "Summary: $created created, $updated updated, $skipped skipped"
