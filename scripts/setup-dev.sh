#!/usr/bin/env bash
# One-shot dev bootstrap. See docs/ONBOARDING.md for the full story.
#
# Runs: firebase login → gcloud ADC login → npm install → emulator sanity check.
# Refuses to continue if a step fails so you don't end up with a half-working repo.

set -euo pipefail

say() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()  { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }
warn(){ printf "  \033[1;33m⚠\033[0m %s\n" "$*"; }
die() { printf "  \033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

command -v node >/dev/null        || die "node not found — install Node 20 (brew install node@20)"
command -v npm  >/dev/null        || die "npm not found"
command -v firebase >/dev/null    || die "firebase CLI not found — npm install -g firebase-tools"
command -v gcloud >/dev/null      || die "gcloud not found — brew install --cask google-cloud-sdk"

node_major="$(node -v | sed 's/v//' | cut -d. -f1)"
if [[ "$node_major" -lt 20 ]]; then
  die "Node $node_major is too old; need Node 20+"
fi
ok "Node $(node -v), npm $(npm -v)"

say "Firebase login"
if firebase projects:list 2>/dev/null | grep -q profit-step; then
  ok "already logged in to Firebase"
else
  firebase login
fi

say "Google Cloud ADC"
if gcloud auth application-default print-access-token >/dev/null 2>&1; then
  ok "ADC already configured"
else
  gcloud auth application-default login
fi

say "gcloud project"
current="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "$current" != "profit-step" ]]; then
  gcloud config set project profit-step
fi
ok "project: profit-step"

say "Installing npm dependencies"
npm install
npm --prefix functions install
ok "deps installed"

say "Verifying Secret Manager access"
if gcloud secrets list --project=profit-step --limit=1 --format='value(name)' >/dev/null 2>&1; then
  ok "can read Secret Manager — IAM role in place"
else
  warn "cannot read Secret Manager. Ask Denis to grant 'Secret Manager Secret Accessor' IAM role."
fi

say "Ready"
echo ""
echo "Next steps:"
echo "  npm run emulator             # local dev (no prod secrets required)"
echo "  npm run test                 # unit tests"
echo "  npm --prefix functions run build && firebase deploy --only functions:<name>   # prod deploy (admin role required)"
echo ""
echo "Full walkthrough: docs/ONBOARDING.md"
