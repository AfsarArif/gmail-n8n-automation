# Gmailn8n Recovery & E2E Validation Plan

## Current State (2026-06-24)

| Component | Status |
|-----------|--------|
| Local n8n | ✅ Running, 4 active workflows, 38 total, E2E pipeline works |
| Fly.io n8n | ⚠️ Boots but DB has 0 workflows (version mismatch with raw DB copy) |
| Gmail OAuth | ❌ Likely expired — API returns zero messages even with broad query |
| E2E Pipeline | ⚠️ Code is correct, can't test (no unlabeled emails + OAuth issue) |
| Stale Workflows | ⚠️ ~30 duplicates/temps to delete |

---

## Phase 1: Fix Gmail OAuth (Prerequisite)

**Problem**: The Gmail credential `GMAIL_CRED_ID_LOCAL_PLACEHOLDER` appears expired. Every Gmail node returns `_no_emails: true`, even with a broad `in:inbox` query.

**Steps**:
1. Open local n8n: http://localhost:5678
2. Navigate to **Credentials** → **Gmail - N8N_EMAIL_PLACEHOLDER**
3. Click **Reconnect** (or delete and re-create if reconnect isn't available)
4. Go through Google OAuth flow — authorize n8n to access Gmail
5. **Verify**: In the n8n editor, open WF-4, click the Gmail node, and use "Test step" or "Fetch test event" to confirm emails are returned

**Success criteria**: Gmail node returns real email data (not `_no_emails`).

---

## Phase 2: Create Test Email & Validate E2E Locally

**Problem**: No unlabeled emails exist in the inbox for E2E testing.

**Steps**:
1. **Option A** (easiest): From any other email account (personal, work, etc.), send an email to `N8N_EMAIL_PLACEHOLDER` with this content:
   ```
   Subject: Your Weekly Newsletter — Tech Updates
   Body: Welcome to our weekly roundup. AI tools, cloud computing, and more.
   Click here to subscribe. To unsubscribe, visit our website.
   ```
   This should be classified as **newsletter** or **promotions** by DeepSeek.

2. **Option B** (if no other account available): After Gmail auth is fixed, use n8n to create a quick Manual Trigger → Gmail Send workflow to email yourself.

3. **Run E2E test**:
   ```bash
   curl -X POST http://localhost:5678/webhook/start-cleanup \
     -H "Content-Type: application/json" \
     -H "x-webhook-token: WEBHOOK_TOKEN_PLACEHOLDER" \
     -d '{}'
   ```
4. **Verify**: Check Gmail — the test email should now have an AI/ label (e.g., `AI/Newsletter`, `AI/Promotions`).

**Success criteria**:
- WF-4 returns `total_fetched: 1, total_classified: 1` with a valid category (not `unknown`)
- Email has correct Gmail label applied

---

## Phase 3: Fix Fly.io Deployment

**Problem**: n8n runs on Fly.io but has 0 workflows. Raw database copy causes n8n to hang (version mismatch between local n8n and `n8nio/n8n:latest`).

**Solution**: Use n8n API import instead of raw DB copy.

**Steps**:
1. **Export workflows from local n8n**:
   ```bash
   # Login to local n8n
   curl -c /tmp/cookies -X POST http://localhost:5678/rest/login \
     -H "Content-Type: application/json" \
     -d '{"emailOrLdapLoginId":"N8N_EMAIL_PLACEHOLDER","password":"N8N_PASSWORD_PLACEHOLDER"}'
   
   # Export each active workflow
   for id in Zreh7ckPNiNYpbju RYXfQYtii4ZheW6e wfdf03924d1afc wf53e3ea8abf28; do
     curl -b /tmp/cookies "http://localhost:5678/rest/workflows/$id" \
       | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['data']))" \
       > "export-$id.json"
   done
   ```

2. **Reset Fly database**:
   ```bash
   fly ssh console -a angafsar --machine 3d8d5d20b55608 \
     -C 'sh -c "rm /home/node/.n8n/database.sqlite* && echo cleaned"'
   fly machines restart 3d8d5d20b55608 -a angafsar --force
   ```
   This forces n8n to create a fresh database with the correct schema version.

3. **Wait for Fly n8n to be ready** (n8n will create fresh DB on startup):
   ```bash
   until curl -s -o /dev/null -w "%{http_code}" https://angafsar.fly.dev/healthz | grep -q 200; do
     sleep 3
   done
   echo "Fly n8n ready"
   ```

4. **Import workflows to Fly**:
   ```bash
   # Login to Fly n8n
   curl -c /tmp/fly_cookies -X POST https://angafsar.fly.dev/rest/login \
     -H "Content-Type: application/json" \
     -d '{"emailOrLdapLoginId":"N8N_EMAIL_PLACEHOLDER","password":"N8N_PASSWORD_PLACEHOLDER"}'
   
   # Import each workflow
   for f in export-Zreh7ckPNiNYpbju.json export-RYXfQYtii4ZheW6e.json \
           export-wfdf03924d1afc.json export-wf53e3ea8abf28.json; do
     curl -b /tmp/fly_cookies -X POST https://angafsar.fly.dev/rest/workflows \
       -H "Content-Type: application/json" \
       -d @"$f"
   done
   ```

5. **Re-create Gmail credential on Fly**:
   - After OAuth is fixed locally (Phase 1), go to the Fly n8n UI at https://angafsar.fly.dev
   - Add Gmail OAuth2 credential with the same account
   - Update each imported workflow's Gmail node to use the new credential ID

6. **Activate workflows**: Toggle each workflow active in the Fly n8n UI.

7. **Verify**: Run E2E test against Fly webhook:
   ```bash
   curl -X POST https://angafsar.fly.dev/webhook/start-cleanup \
     -H "Content-Type: application/json" \
     -H "x-webhook-token: WEBHOOK_TOKEN_PLACEHOLDER" \
     -d '{}'
   ```

**Success criteria**:
- Fly n8n shows all 4 active workflows
- E2E test via Fly webhook classifies and labels emails correctly

---

## Phase 4: Clean Up Stale Workflows

**Problem**: ~30 stale/duplicate workflows in local n8n.

**Steps**:
1. Open local n8n: http://localhost:5678
2. Go to **Workflows** page
3. Identify stale workflows — anything that is NOT one of:
   - `wfdf03924d1afc` — WF-3: Daily Spam Deletion
   - `wf53e3ea8abf28` — WF-1: Gmail Trigger
   - `Zreh7ckPNiNYpbju` — WF-0: Shared Classification
   - `RYXfQYtii4ZheW6e` — WF-4: Initial Cleanup
4. For each stale workflow: click **⋮** → **Delete** (n8n UI handles archive automatically)
5. Also clean up stale workflows on Fly.io after import (if duplicates were imported)

**Success criteria**: Only 4 workflows remain (one per workflow function).

---

## Phase 5: Fix Fly Console Machine

**Problem**: A leftover console machine `48e2572f9500d8` (delicate-frost-8630) from `fly console` is still running.

**Steps**:
```bash
fly machines stop 48e2572f9500d8 -a angafsar
fly machines destroy 48e2572f9500d8 -a angafsar --force
```

---

## Quick Reference

### Credentials
| Item | Value |
|------|-------|
| N8N email | `N8N_EMAIL_PLACEHOLDER` |
| N8N password | `N8N_PASSWORD_PLACEHOLDER` |
| Webhook token | `WEBHOOK_TOKEN_PLACEHOLDER` |
| Gmail credential ID | `GMAIL_CRED_ID_LOCAL_PLACEHOLDER` (may need re-auth) |
| DeepSeek credential ID | `DEEPSEEK_CRED_ID_PLACEHOLDER` |

### Webhooks
| Workflow | URL |
|----------|-----|
| WF-0 (local) | `http://localhost:5678/webhook/classify-email-v2` |
| WF-4 (local) | `http://localhost:5678/webhook/start-cleanup` |
| WF-0 (Fly) | `https://angafsar.fly.dev/webhook/classify-email-v2` |
| WF-4 (Fly) | `https://angafsar.fly.dev/webhook/start-cleanup` |

### Label Mapping (DeepSeek → Gmail)
| Category | Label ID | Label Name |
|----------|----------|------------|
| action | `Label_1` | AI/Action-Required |
| newsletter | `Label_2` | AI/Newsletter |
| social | `Label_3` | AI/Social |
| promotions | `Label_4` | AI/Promotions |
| career | `Label_5` | AI/Career |
| fyi | `Label_6` | AI/FYI |
| spam | `Label_7` | AI/Spam |

### Fly.io
| Item | Value |
|------|-------|
| App | `angafsar` |
| URL | `https://angafsar.fly.dev` |
| Machine ID | `3d8d5d20b55608` (iad) |
| Volume | `vol_re10w009lz899do4` (n8n_data, 10GB) |
| Console machine | `48e2572f9500d8` — **DELETE THIS** |

---

## Execution Order

```
Phase 1 (Gmail OAuth) ── prerequisite for everything else
    │
    ├── Phase 2 (E2E local) ── validates pipeline works end-to-end
    │
    ├── Phase 3 (Fly.io) ── after Gmail auth fixed, deploy to production
    │
    ├── Phase 4 (Cleanup) ── optional, can do anytime via n8n UI
    │
    └── Phase 5 (Console machine) ── quick CLI cleanup
```
