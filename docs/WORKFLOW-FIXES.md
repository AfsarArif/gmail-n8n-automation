# WF-0 Email Classifier — Fixes Applied (2026-06-23)

## Root Cause
WF-0 had `active: false` + multiple node compatibility issues from n8n version migration.

## Fixes Applied (in n8n SQLite DB)

### 1. Webhook Registration
- `webhookPath`: Fixed from compound path to `classify-email`
- `webhookId`: Linked to webhook node in workflow_history

### 2. Node Compatibility (n8n v2 → v3 API)
| Node | Issue | Fix |
|------|-------|-----|
| Webhook | `headerAuth` format | Changed to `none` |
| Gmail ×7 nodes | `labelNames` → `labelIds` | Updated all to v2 API |
| DeepSeek Chat Model | Credential format | Changed to `{id, name}` object |
| Basic LLM Chain | Nested `{{}}` in prompt | Single expression |
| Merge Paths | `combinationMode` removed | Changed to `append` mode |
| Set nodes ×2 | `typeVersion` 3 → 3.3 | Added `assignments` support |
| Gmail credentials | `gmailOAuth2Api` → `gmailOAuth2` | Updated nodes + credentials_entity |

### 3. Data Flow
- `Validate Category`: References upstream data via `$items()`
- `Set: Normalize`: Hardcodes account values for each branch

## Verification
End-to-end test with test payload:
```
✅ Webhook received
✅ Sender Pre-Classifier
✅ Skip AI?
✅ HTML to Plain Text
✅ DeepSeek Chat Model → classifies "review document" as "fyi"
✅ Basic LLM Chain
✅ Validate Category
✅ Set: Normalize
✅ Merge Paths
✅ Switch: Account Type
✅ Switch: Gmail Category
✅ Gmail: Add Label — FYI (fails with fake message_id as expected)
```

## Webhook URL
```
POST http://localhost:5678/webhook/classify-email
Secret: 9cd192bdd0b0608358a6021d4763d6adf7b36acac65136d245c8d8d002379479
```

## Remaining Issues
- WF-1 (Gmail Trigger) needs attention
- Real Gmail message ID needed for full E2E test
