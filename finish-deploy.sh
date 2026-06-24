#!/bin/bash
# Finalize gmailn8n Fly deployment — run after Gmail OAuth on Fly is complete
# Usage: bash finish-deploy.sh
#
# Lessons learned (2026-06-24):
# 1. PATCH /workflows/{id} silently ignores node/connection changes on this n8n version.
#    For structural changes, use DELETE + re-import (POST /workflows).
# 2. Activation MUST use POST /workflows/{id}/activate with {"versionId": "..."}.
#    Setting active:true via PATCH is silently ignored.
# 3. Credential patching via PATCH DOES work — keep {"data": {...}} wrapper.
# 4. WF-3 references sub-workflow kZGCUvNzGdR1lcD2 (Sub: Gmail Delete Spam).

set -e

FLY_URL="https://angafsar.fly.dev"
EMAIL="N8N_EMAIL_PLACEHOLDER"
PASSWORD="N8N_PASSWORD_PLACEHOLDER"
TOKEN="WEBHOOK_TOKEN_PLACEHOLDER"
NEW_GMAIL_CRED="GMAIL_CRED_ID_FLY_PLACEHOLDER"  # Updated by user after OAuth
OLD_GMAIL_CRED="GMAIL_CRED_ID_OLD_PLACEHOLDER"

# Workflow IDs on Fly
WF0="Zreh7ckPNiNYpbju"    # WF-0: Shared Classification Sub-Workflow
WF4="U6SIYMZFTATwuyma"    # WF-4: Initial Cleanup (re-imported 2026-06-24, fixed 127.0.0.1 URL)
WF1="wf53e3ea8abf28"       # WF-1: Gmail Trigger
WF3="o5eAKJZl5BjY2DZ8"     # WF-3: Daily Spam Deletion (re-imported 2026-06-24)
SUB_SPAM="kZGCUvNzGdR1lcD2" # Sub: Gmail Delete Spam

echo "=== 1. Login to Fly n8n ==="
curl -s -c /tmp/fly_c -X POST "$FLY_URL/rest/login" \
  -H "Content-Type: application/json" \
  -d "{\"emailOrLdapLoginId\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" > /dev/null
echo "Logged in"

echo ""
echo "=== 2. Patch Gmail credential references in workflows ==="
# Credential PATCH works fine — just keep the {"data": {...}} wrapper
for WID in $WF0 $WF4 $WF1; do
  # Fetch workflow
  WORKFLOW=$(curl -s -b /tmp/fly_c "$FLY_URL/rest/workflows/$WID")
  # Apply sed substitution on the raw JSON
  UPDATED=$(echo "$WORKFLOW" | sed "s/$OLD_GMAIL_CRED/$NEW_GMAIL_CRED/g")
  # PATCH back with data wrapper intact
  echo "$UPDATED" | curl -s -b /tmp/fly_c -X PATCH "$FLY_URL/rest/workflows/$WID" \
    -H "Content-Type: application/json" \
    -d @- > /dev/null
  echo "  $WID: credential patched"
done

echo ""
echo "=== 3. Activate workflows via POST /activate ==="
# IMPORTANT: PATCH with active:true is silently ignored!
# Must use POST /workflows/{id}/activate with {"versionId": "..."}
for WID in $WF0 $WF4 $WF1 $WF3; do
  # Fetch current versionId
  VID=$(curl -s -b /tmp/fly_c "$FLY_URL/rest/workflows/$WID" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['versionId'])")
  # Activate
  curl -s -b /tmp/fly_c -X POST "$FLY_URL/rest/workflows/$WID/activate" \
    -H "Content-Type: application/json" \
    -d "{\"versionId\":\"$VID\"}" > /dev/null
  echo "  $WID: activated (versionId=$VID)"
done

echo ""
echo "=== 4. Verify activation status ==="
curl -s -b /tmp/fly_c "$FLY_URL/rest/workflows" | python3 -c "
import sys, json
d = json.load(sys.stdin)
wf = d.get('data', d)
if isinstance(wf, dict): wf = list(wf.values())
active = 0
for w in wf:
    a = 'ACTIVE' if w.get('active') else 'OFF'
    print(f'  {a} | {w.get(\"id\")} | {w.get(\"name\")}')
    if w.get('active'): active += 1
print(f'  ---')
print(f'  Total active: {active}/4 core workflows')
"

echo ""
echo "=== 5. E2E test on Fly ==="
curl -s -X POST "$FLY_URL/webhook/start-cleanup" \
  -H "Content-Type: application/json" \
  -H "x-webhook-token: $TOKEN" \
  -d '{}' | python3 -m json.tool

echo ""
echo "=== Done! ==="
