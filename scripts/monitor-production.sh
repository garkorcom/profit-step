#!/bin/bash
# Production Monitoring Script for Anti-Loop Protection
# Run this daily for 48 hours after deployment
# Usage: ./scripts/monitor-production.sh

# Don't exit on error for log commands
set +e

echo "═══════════════════════════════════════════════════════════════"
echo "  🛡️  Anti-Loop Protection Monitoring Dashboard"
echo "═══════════════════════════════════════════════════════════════"
echo ""
date
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo -e "${RED}❌ Firebase CLI not found. Install: npm install -g firebase-tools${NC}"
    exit 1
fi

# Check if logged in to Firebase
firebase projects:list &> /dev/null
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  Not logged in to Firebase. Run: firebase login${NC}"
    echo ""
    echo "   Showing manual monitoring instructions instead..."
    echo ""
    echo "───────────────────────────────────────────────────────────────"
    echo "   📋 Manual Monitoring Checklist:"
    echo "───────────────────────────────────────────────────────────────"
    echo ""
    echo "   1. Check Firebase Console Logs:"
    echo "      https://console.firebase.google.com/project/profit-step/functions/logs"
    echo ""
    echo "   2. Look for 'incrementLoginCount' function"
    echo "   3. Verify you see '⏩ Skipping' messages (Guards working)"
    echo ""
    echo "   4. Check Billing:"
    echo "      https://console.cloud.google.com/billing/reports"
    echo ""
    echo "   5. Expected costs: < $10/month (normal)"
    echo ""
    echo "───────────────────────────────────────────────────────────────"
    exit 0
fi

echo "1️⃣  Checking incrementLoginCount Guards (The $174 Bug)..."
echo "───────────────────────────────────────────────────────────────"
LOGS=$(firebase functions:log --only incrementLoginCount --limit 20 2>&1)

# Count "Skipping" messages (Guard working)
SKIP_COUNT=$(echo "$LOGS" | grep -c "Skipping" || echo "0")
# Count "incremented" messages (Actual updates)
INCREMENT_COUNT=$(echo "$LOGS" | grep -c "incremented" || echo "0")

echo "   Skipping messages (Guards active): $SKIP_COUNT"
echo "   Incremented messages (Actual updates): $INCREMENT_COUNT"

if [ "$SKIP_COUNT" -gt 0 ]; then
    echo -e "   ${GREEN}✅ Guards are WORKING! Protection active.${NC}"
else
    if [ "$INCREMENT_COUNT" -gt 5 ]; then
        echo -e "   ${RED}🚨 WARNING: No 'Skipping' messages found!${NC}"
        echo -e "   ${RED}   Potential infinite loop detected!${NC}"
        echo ""
        echo "   Recent logs:"
        echo "$LOGS" | tail -10
        echo ""
        echo -e "   ${YELLOW}ACTION REQUIRED: Check Firebase Console immediately!${NC}"
    else
        echo -e "   ${YELLOW}⚠️  Low activity (normal if no logins recently)${NC}"
    fi
fi

echo ""
echo "2️⃣  Checking All Functions Invocations..."
echo "───────────────────────────────────────────────────────────────"

# Get recent logs for all functions
ALL_LOGS=$(firebase functions:log --limit 50 2>&1)

# Check for errors
ERROR_COUNT=$(echo "$ALL_LOGS" | grep -c "Error" || echo "0")
echo "   Error count in last 50 logs: $ERROR_COUNT"

if [ "$ERROR_COUNT" -gt 5 ]; then
    echo -e "   ${RED}🚨 WARNING: High error rate detected!${NC}"
    echo "   Recent errors:"
    echo "$ALL_LOGS" | grep "Error" | tail -5
else
    echo -e "   ${GREEN}✅ Error rate acceptable${NC}"
fi

echo ""
echo "3️⃣  Functions Status Summary..."
echo "───────────────────────────────────────────────────────────────"

# Extract unique function names from logs
FUNCTIONS=$(echo "$ALL_LOGS" | grep -oE "Function: [a-zA-Z]+" | cut -d' ' -f2 | sort -u || echo "")

if [ -n "$FUNCTIONS" ]; then
    echo "   Active functions in last 50 logs:"
    echo "$FUNCTIONS" | head -10 | sed 's/^/     - /'
else
    echo -e "   ${YELLOW}⚠️  No recent function activity${NC}"
fi

echo ""
echo "4️⃣  Quick Links..."
echo "───────────────────────────────────────────────────────────────"
PROJECT_ID=$(firebase projects:list 2>/dev/null | grep profit-step | awk '{print $1}' || echo "profit-step")

echo "   📊 Firebase Console:"
echo "      https://console.firebase.google.com/project/$PROJECT_ID/functions/logs"
echo ""
echo "   💰 Billing Dashboard:"
echo "      https://console.cloud.google.com/billing/$PROJECT_ID/reports"
echo ""
echo "   🔍 Cloud Functions Metrics:"
echo "      https://console.cloud.google.com/functions/list?project=$PROJECT_ID"
echo ""

echo "5️⃣  Next Steps..."
echo "───────────────────────────────────────────────────────────────"
echo "   [ ] Check billing dashboard (should be < $10/month)"
echo "   [ ] Verify Budget Alert is set up"
echo "   [ ] Add FIREBASE_TOKEN to GitHub Secrets (if not done)"
echo "   [ ] Run this script again in 12 hours"
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "  Monitoring Complete - $(date)"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "💡 TIP: Run this script daily for 48 hours after any deployment"
echo ""
