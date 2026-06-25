#!/bin/bash
# cleanup-all.sh — Run full cleanup via the deployed EmailBot API
# Usage: EMAILBOT_API_URL=https://emailbot.fly.dev API_SECRET=... ./cleanup-all.sh

set -euo pipefail

API_URL="${EMAILBOT_API_URL:-https://emailbot.fly.dev}"
API_SECRET="${API_SECRET:-}"

if [ -z "$API_SECRET" ]; then
    echo "❌ API_SECRET is not set. Set it before running:"
    echo "   export API_SECRET=\$(fly ssh console -a emailbot -C 'printenv API_SECRET' 2>&1 | tail -1)"
    exit 1
fi

echo "🔍 Starting full cleanup via $API_URL ..."
echo "   This will process ALL unlabeled emails in batches of 500."
echo "   Press Ctrl+C to stop."

result=$(curl -sf -X POST "$API_URL/api/cleanup" -H "X-API-Secret: $API_SECRET")
processed=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processed', 0))")

echo ""
echo "✅ Cleanup complete: $processed emails classified."
