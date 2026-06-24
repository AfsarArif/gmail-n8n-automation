#!/bin/bash
# Fix WF-4: Replace with fixed version (127.0.0.1 URL instead of localhost)
# Run this: bash fix-wf4.sh
set -e

FLY="https://angafsar.fly.dev"
EMAIL="N8N_EMAIL_PLACEHOLDER"
PASS="N8N_PASSWORD_PLACEHOLDER"

echo "=== Fixing WF-4 URL (localhost -> 127.0.0.1) ==="

# Login
curl -s -c /tmp/fly_c -X POST "$FLY/rest/login" \
  -H "Content-Type: application/json" \
  -d "{\"emailOrLdapLoginId\":\"$EMAIL\",\"password\":\"$PASS\"}" > /dev/null
echo "1. Logged in"

# Fetch current WF-4
curl -s -b /tmp/fly_c "$FLY/rest/workflows/RYXfQYtii4ZheW6e" > /tmp/wf4_current.json
echo "2. Fetched WF-4"

# Check current URL
CURRENT_URL=$(python3 -c "import json; d=json.load(open('/tmp/wf4_current.json')); nodes=d.get('data',d)['nodes']; [print(n['parameters']['url']) for n in nodes if 'classify' in n.get('parameters',{}).get('url','')]")
echo "   Current URL: $CURRENT_URL"

# Try PATCH with fixed URL
python3 -c "
import json
d = json.load(open('/tmp/wf4_current.json'))
wf = d.get('data', d)
for n in wf['nodes']:
    if 'classify-email-v2' in n.get('parameters',{}).get('url',''):
        n['parameters']['url'] = 'http://127.0.0.1:5678/webhook/classify-email-v2'
        print(f'   Fixed URL in node: {n[\"name\"]}')
json.dump({'data': wf}, open('/tmp/wf4_patched.json', 'w'))
print('3. Patched locally')
"

# Send PATCH
curl -s -b /tmp/fly_c -X PATCH "$FLY/rest/workflows/RYXfQYtii4ZheW6e" \
  -H "Content-Type: application/json" \
  -d @/tmp/wf4_patched.json > /tmp/wf4_response.json
echo "4. PATCH sent"

# Verify
VERIFY_URL=$(curl -s -b /tmp/fly_c "$FLY/rest/workflows/RYXfQYtii4ZheW6e" | python3 -c "import sys,json; d=json.load(sys.stdin); nodes=d.get('data',d)['nodes']; [print(n['parameters']['url']) for n in nodes if 'classify' in n.get('parameters',{}).get('url','')]")
echo "5. URL after PATCH: $VERIFY_URL"

if echo "$VERIFY_URL" | grep -q "127.0.0.1"; then
    echo "   ✅ PATCH worked!"
else
    echo "   ❌ PATCH didn't stick. Using delete+reimport..."

    # Get current versionId for deactivation
    VID=$(curl -s -b /tmp/fly_c "$FLY/rest/workflows/RYXfQYtii4ZheW6e" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['versionId'])")

    # Deactivate old
    curl -s -b /tmp/fly_c -X POST "$FLY/rest/workflows/RYXfQYtii4ZheW6e/deactivate" \
      -H "Content-Type: application/json" \
      -d "{\"versionId\":\"$VID\"}" > /dev/null 2>&1 || true
    echo "   Deactivated old WF-4"

    # Import fixed version from exports/
    NEW_ID=$(curl -s -b /tmp/fly_c -X POST "$FLY/rest/workflows" \
      -H "Content-Type: application/json" \
      -d @/Users/afsararif/Documents/Projects/gmailn8n/exports/export-RYXfQYtii4ZheW6e.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['id'])")
    echo "   Imported as: $NEW_ID"

    # Activate
    NEW_VID=$(curl -s -b /tmp/fly_c "$FLY/rest/workflows/$NEW_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['versionId'])")
    curl -s -b /tmp/fly_c -X POST "$FLY/rest/workflows/$NEW_ID/activate" \
      -H "Content-Type: application/json" \
      -d "{\"versionId\":\"$NEW_VID\"}" > /dev/null
    echo "   Activated: $NEW_ID (versionId=$NEW_VID)"
    echo ""
    echo "   ⚠️  NEW WF-4 ID: $NEW_ID"
    echo "   ⚠️  Update finish-deploy.sh to use this new ID!"
fi

# Final E2E test
echo ""
echo "=== E2E Test ==="
curl -s -X POST "$FLY/webhook/start-cleanup" \
  -H "Content-Type: application/json" \
  -H "x-webhook-token: WEBHOOK_TOKEN_PLACEHOLDER" \
  -d '{}' | python3 -m json.tool

echo ""
echo "=== Current Workflows ==="
curl -s -b /tmp/fly_c "$FLY/rest/workflows" | python3 -c "
import sys, json
d = json.load(sys.stdin)
wfs = d.get('data', d)
if isinstance(wfs, dict): wfs = list(wfs.values())
for w in wfs:
    a = 'ACTIVE' if w.get('active') else 'OFF'
    print(f'  {a} | {w[\"id\"]} | {w[\"name\"]}')
"
