#!/bin/bash
# One-time: Link telegramId to Denis's user doc
# Uses firebase CLI access token

set -e

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-profit-step}"
USER_ID="mxtAppmSHNgDAVWVBNAfHKZ2e172"
TELEGRAM_ID="5844328957"

# Get access token from firebase tools config
ACCESS_TOKEN=$(python3 -c "
import json
with open('$HOME/.config/configstore/firebase-tools.json') as f:
    config = json.load(f)
print(config['tokens']['access_token'])
")

echo "🔍 Fetching user doc..."

# GET current doc
RESPONSE=$(curl -s \
  "https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${USER_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

# Check if telegramId already exists
CURRENT_TG=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    doc = json.load(sys.stdin)
    fields = doc.get('fields', {})
    tg = fields.get('telegramId', {}).get('stringValue', '(not set)')
    print(tg)
except: print('ERROR')
" 2>/dev/null)

echo "Current telegramId: $CURRENT_TG"

if [ "$CURRENT_TG" = "$TELEGRAM_ID" ]; then
    echo "✅ telegramId already set correctly. Nothing to do."
    exit 0
fi

echo "📝 Updating telegramId to $TELEGRAM_ID..."

# PATCH to update just telegramId field
curl -s -X PATCH \
  "https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${USER_ID}?updateMask.fieldPaths=telegramId" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"telegramId\": {
        \"stringValue\": \"${TELEGRAM_ID}\"
      }
    }
  }" | python3 -c "
import sys, json
doc = json.load(sys.stdin)
if 'error' in doc:
    print('❌ Error:', doc['error']['message'])
else:
    tg = doc.get('fields', {}).get('telegramId', {}).get('stringValue', 'unknown')
    print(f'✅ Updated! telegramId = {tg}')
"
