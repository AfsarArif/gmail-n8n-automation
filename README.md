# Multi-Account Email Auto-Label & Spam Cleanup

**N8N + DeepSeek — Gmail & Outlook/Hotmail**

Automatically classify and label incoming emails across multiple Gmail and Outlook/Hotmail accounts using DeepSeek AI. Delete spam/junk daily across all accounts. One shared classification engine, multiple account triggers.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-216%20passing-green)]()

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        EMAIL ACCOUNTS                               │
│  [Gmail #1]   [Gmail #2]   [Gmail #3]   [Outlook/Hotmail #1] ...   │
└──────┬──────────────┬───────────────┬──────────────┬───────────────┘
       │              │               │              │
  Gmail Trigger  Gmail Trigger  Gmail Trigger   Outlook Trigger
  (WF-1a)        (WF-1b)        (WF-1c)         (WF-2a)
       │              │               │              │
       └──────────────┴───────────────┴──────────────┘
                                │
                    HTTP POST /webhook/classify-email
                                │
                                ▼
          ┌─────────────────────────────────────────┐
          │   WORKFLOW 0: SHARED CLASSIFICATION      │
          │   (called by ALL account triggers)       │
          │                                          │
          │  [Webhook]   POST /classify-email        │
          │       │                                   │
          │  [Sender Pre-Classifier]                 │
          │       │              │                   │
          │  known domain    unknown                 │
          │  (skip AI)           │                   │
          │       │         [DeepSeek Classify]      │
          │       └──────┬───────┘                   │
          │         [Switch: category]               │
          │         /    |    |    |    \            │
          │     [NL] [Action][Social][Promo][Career] │
          │       │      │      │      │       │     │
          │   Apply label based on account_type:     │
          │   Gmail  → Gmail Label node              │
          │   Outlook→ Microsoft Outlook node        │
          └─────────────────────────────────────────┘

          ┌─────────────────────────────────────────┐
          │   WORKFLOW 3: DAILY SPAM DELETION        │
          │   (loops through all registered accounts)│
          │                                          │
          │  [Schedule: 11:59 PM]                    │
          │       │                                  │
          │  [Loop: accounts config]                 │
          │       │                                  │
          │  [IF Gmail]     [IF Outlook]             │
          │       │               │                  │
          │  Gmail delete    Outlook delete          │
          └─────────────────────────────────────────┘
```

**Key Design Decisions:**
- **One classification sub-workflow (WF-0)** shared by all accounts — update prompts or labels in one place, applies everywhere
- **Separate triggers per account** — each account needs its own trigger workflow (N8N limitation: triggers tied to one credential)
- **Account type flag** (`gmail` vs `outlook`) passed to WF-0 so the correct label-apply node is used
- **Gmail labels** are native Gmail labels; **Outlook uses categories** (the Outlook equivalent of labels)

### Workflow Inventory

| Workflow | Name | Trigger | Credential |
|---|---|---|---|
| **WF-0** | Shared Classifier | Webhook (POST) | DeepSeek + all Gmail/Outlook |
| **WF-1x** | Gmail Trigger (per account) | Gmail Message Received | Gmail OAuth2 |
| **WF-2x** | Outlook Trigger (per account) | MS Outlook Message Received | MS Outlook OAuth2 |
| **WF-3** | Daily Spam Deletion | Schedule (8:00 AM) | All accounts |
| **WF-4** | Initial Cleanup (one-time) | Manual Trigger | Gmail OAuth2 (per account) |

---

## Classification Categories

| Category | Gmail Label | Outlook Category | Behavior |
|---|---|---|---|
| `newsletter` | `AI/Newsletter` | `AI-Newsletter` | Mark read, stay in inbox |
| `action` | `AI/Action-Required` | `AI-Action` | Keep unread, stay in inbox |
| `social` | `AI/Social` | `AI-Social` | Mark read, stay in inbox |
| `promotions` | `AI/Promotions` | `AI-Promotions` | Mark read + Archive |
| `career` | `AI/Career` | `AI-Career` | Keep unread, stay in inbox |
| `fyi` | `AI/FYI` | `AI-FYI` | Mark read, stay in inbox |
| `otp` | `AI/OTP` | `AI-OTP` | Keep unread, stay in inbox |
| `spam` | `AI/Spam` | `AI-Spam` | Deleted nightly by WF-3 |

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/YOUR_USER/gmail-n8n-automation.git
cd gmail-n8n-automation
npm install

# Configure environment
cp .env.example .env
# → Edit .env with your N8N_BASE_URL, DeepSeek API key, and account lists

# Run all tests (216 tests, 39 suites)
npm test

# TypeScript check
npx tsc --noEmit

# Validate workflow JSON files
npm run validate:workflows

# Generate initial cleanup workflow (one-time historical email processing)
npm run generate:cleanup-workflow
```

---

## Project Structure

```
gmailn8n/
├── docs/
│   └── implementation-plan.md        # Full architecture & design document
├── src/
│   ├── code/                          # Business logic modules
│   │   ├── index.ts                   # Barrel export
│   │   ├── webhook-schema.ts          # WF-0 input payload types & JSON Schema
│   │   ├── pre-classifier.ts          # Sender domain pre-classification
│   │   ├── classifier.ts              # DeepSeek prompt builder + validation
│   │   ├── label-mapper.ts            # Category ↔ Gmail/Outlook label mapping
│   │   ├── payload-builder.ts         # Gmail/Outlook trigger → WF-0 payload builder
│   │   ├── account-config.ts          # Account list from env vars
│   │   ├── spam-deleter.ts            # Spam query builder + summary
│   │   ├── initial-cleanup.ts         # WF-4: batch cleanup logic + workflow generator
│   │   └── *.test.ts                  # 166 tests, 30 suites
│   │
│   ├── utils/                         # Shared utilities
│   │   ├── index.ts                   # Barrel export
│   │   ├── n8n-templates.ts           # N8N workflow generation helpers
│   │   ├── validate-workflows.ts      # CLI workflow validator
│   │   ├── error-handler.ts           # Error classification + retry logic
│   │   ├── rate-limiter.ts            # Sliding-window rate limit tracker
│   │   ├── env.ts                     # Typed env config loader
│   │   └── *.test.ts                  # 37 tests, 10 suites
│   │
│   ├── generate-cleanup-workflow.ts   # CLI: generate WF-4 JSON from .env
│   │
│   └── workflows/                     # N8N workflow JSON exports
│       ├── wf0-shared-classifier.json          # WF-0: 40 nodes, 53 connections
│       ├── wf1-gmail-trigger-template.json     # Template for Gmail triggers
│       ├── wf1-gmail-trigger-instance-1.json   # Example: personal@gmail.com
│       ├── wf2-outlook-trigger-template.json   # Template for Outlook triggers
│       ├── wf2-outlook-trigger-instance-1.json # Example: myname@hotmail.com
│       ├── wf3-spam-deletion.json              # Main orchestrator
│       ├── wf3-spam-deletion-gmail-sub.json    # Gmail sub-workflow
│       ├── wf3-spam-deletion-outlook-sub.json  # Outlook sub-workflow
│       └── wf4-initial-cleanup.json            # WF-4: one-time historical cleanup
│
├── .env.example                       # All config vars documented
├── .gitignore                         # Ignores secrets, n8n data, temp files
├── tsconfig.json                      # Strict TypeScript config
├── package.json                       # Scripts: test, build, validate:workflows, generate:cleanup-workflow
└── README.md
```

---

## Initial Setup — One-Time Cleanup (WF-4)

**When you first set up this automation, your inbox already has hundreds or thousands of unlabeled emails.** WF-4 is a one-time cleanup workflow that processes ALL existing emails through the classifier, applying AI/* labels and marking spam. After running once, the live automation (WF-0 through WF-3) handles all new emails.

### How It Works

```
Manual Trigger
  → Gmail: Get Many (all unlabeled inbox emails)
    → Split In Batches (10 emails at a time)
      → Code: Build WF-0 Payload
        → HTTP POST to WF-0 Classifier (classify + label)
          → Code: Summary Report
```

WF-4 fetches every inbox email that does NOT already have an AI/* label, sends each batch to WF-0 for classification, and WF-0 applies the correct label. Spam receives the `AI/Spam` label — **it is NOT deleted** (WF-3 handles deletion nightly).

### Running the Initial Cleanup

```bash
# 1. Generate the WF-4 workflow for your Gmail account(s)
npm run generate:cleanup-workflow
# → Creates src/workflows/wf4-initial-cleanup.json

# 2. Import into N8N
#    N8N → Workflows → Import from File → select wf4-initial-cleanup.json

# 3. Open the imported workflow and verify:
#    - "Gmail: Get Unlabeled Emails" shows your correct credential
#    - "POST to WF-0 Classifier" points to your N8N instance

# 4. Execute the workflow manually (click "Execute Workflow")
#    The workflow will process all unlabeled inbox emails.

# 5. Check Gmail — emails should now have AI/* labels applied.
```

### What to Expect

- **Idempotent**: Re-running processes zero emails (all already labeled). Safe to run again anytime.
- **Rate-limited**: Batch size of 10 with built-in delays respects Gmail API quotas.
- **Multi-account**: For multiple Gmail accounts, set `GMAIL_ACCOUNTS` and `GMAIL_CREDENTIAL_NAMES` in `.env` before generating. One workflow JSON is created per account.
- **Outlook**: Outlook initial cleanup is not yet implemented (Outlook uses a different API). Configure Outlook credentials and WF-2 will handle new emails automatically.
- **Spam**: Labeled `AI/Spam`, then deleted by WF-3 on its nightly run (8:00 AM daily).

---

## Prerequisites — Credentials Setup

### Gmail OAuth2 (one per Gmail account)

1. Go to [Google Cloud Console](https://console.cloud.google.com) → create a project
2. **APIs & Services → Library** → enable **Gmail API**
3. **OAuth consent screen** → External → add your Gmail addresses as test users
4. **Credentials → Create OAuth 2.0 Client ID** → Web application
5. Redirect URI: `https://<your-n8n-domain>/rest/oauth2-credential/callback`
6. In N8N: **Credentials → New → Gmail OAuth2 API** → paste Client ID + Secret
7. Name distinctly: `Gmail - yourname@gmail.com`

### Outlook/Hotmail OAuth2 (one per Outlook account)

1. Go to [Azure Portal](https://portal.azure.com) → **App registrations** → New
2. Supported account types: "Any organizational directory AND personal Microsoft accounts"
3. Same redirect URI as Gmail above
4. **Certificates & secrets → New client secret** → copy the value
5. **API permissions → Microsoft Graph → Delegated**:
   - `Mail.ReadWrite` | `Mail.Send` | `offline_access` ← critical!
6. In N8N: **Credentials → New → Microsoft Outlook OAuth2 API**
7. Name distinctly: `Outlook - yourname@hotmail.com`

### DeepSeek API

1. Go to [platform.deepseek.com](https://platform.deepseek.com) → API Keys
2. In N8N: **Credentials → New → OpenAI API**
   - Base URL: `https://api.deepseek.com/v1`
   - Name: `DeepSeek API`

### Pre-Create Labels (Gmail) & Categories (Outlook)

**Gmail** — log into each Gmail account and create:
```
AI/Newsletter   AI/Action-Required   AI/Social   AI/Promotions
AI/Career       AI/FYI               AI/OTP     AI/Spam
```

**Outlook** — Outlook web → Categorize → Manage categories → New:
```
AI-Newsletter   AI-Action   AI-Social   AI-Promotions
AI-Career       AI-FYI       AI-OTP     AI-Spam
```

---

## Cost Optimization — Sender Pre-Classifier

The pre-classifier in WF-0 routes ~35% of emails without using any DeepSeek tokens by checking the sender domain against known lists:

- **social**: linkedin.com, twitter.com, x.com, facebook.com, instagram.com, reddit.com, github.com, discord.com, meetup.com, slack.com
- **career**: indeed.com, glassdoor.com, levels.fyi, ziprecruiter.com, dice.com, hired.com, greenhouse.io, lever.co, workday.com, myworkdayjobs.com, wellfound.com, otta.com
- **fyi**: amazon.com, apple.com, paypal.com, stripe.com, shopify.com, ebay.com, bestbuy.com, ups.com, fedex.com, usps.com
- **newsletter**: substack.com, beehiiv.com, convertkit.com, mailchimp.com, klaviyo.com, sendgrid.net, constantcontact.com

Extend these lists in `src/code/pre-classifier.ts` to match your inbox patterns.

### Estimated Costs (DeepSeek deepseek-chat, all accounts)

| Daily Emails | Monthly AI Calls | Monthly Cost |
|---|---|---|
| 20 | ~390 | ~$0.07 |
| 50 | ~975 | ~$0.19 |
| 100 | ~1,950 | ~$0.38 |
| 200 | ~3,900 | ~$0.76 |
| 300 | ~5,850 | ~$1.14 |

---

## Node Reference

| Node | Workflow | Purpose |
|---|---|---|
| `Gmail Trigger` | WF-1x | Watch Gmail inbox per account |
| `Microsoft Outlook Trigger` | WF-2x | Watch Outlook inbox per account |
| `IF` | WF-1x, WF-2x | Dedup guard |
| `Set` | WF-1x, WF-2x, WF-0 | Build payloads + normalize category |
| `HTTP Request` | WF-1x, WF-2x | Fire-and-forget POST to WF-0 |
| `Webhook` | WF-0 | Receive classification requests |
| `Code` | WF-0, WF-3 | Pre-classifier logic + accounts config |
| `Markdown` | WF-0 | Strip HTML → plain text |
| `OpenAI Chat Model` | WF-0 | DeepSeek API connection |
| `Basic LLM Chain` | WF-0 | Run classification prompt |
| `JSON Parser` | WF-0 | Parse DeepSeek JSON output |
| `Switch` | WF-0, WF-3 | Route by account type + category |
| `Gmail` (Add Label) | WF-0 | Apply AI/* label on Gmail |
| `Gmail` (Modify) | WF-0 | Mark read / archive on Gmail |
| `Microsoft Outlook` (Update) | WF-0 | Apply AI- category on Outlook |
| `Microsoft Outlook` (Move) | WF-0 | Move promotions to Archive |
| `Schedule Trigger` | WF-3 | 11:59 PM daily |
| `Split In Batches` | WF-3 | Loop accounts + batch deletes |
| `Gmail` (Delete) | WF-3 | Permanent spam delete |
| `Microsoft Outlook` (Delete) | WF-3 | Permanent junk delete |
| `Manual Trigger` | WF-4 | One-time manual execution |
| `Gmail` (Get Many) | WF-4 | Fetch all unlabeled inbox emails |
| `HTTP Request` | WF-4 | POST each email to WF-0 for classification |
| `Code` | WF-4 | Build WF-0 payloads + aggregate summary |

---

## Environment Variables

See `.env.example` for the complete list. Key variables:

| Variable | Required | Description |
|---|---|---|
| `N8N_BASE_URL` | Yes | Your N8N instance URL (e.g. `http://localhost:5678`) |
| `WF0_SECRET_TOKEN` | Yes | Secret to secure WF-0 webhook |
| `DEEPSEEK_API_KEY` | Yes | DeepSeek API key |
| `GMAIL_ACCOUNTS` | Yes | Comma-separated Gmail addresses |
| `GMAIL_CREDENTIAL_NAMES` | Yes | Matching N8N credential names (one per Gmail) |
| `OUTLOOK_ACCOUNTS` | No | Comma-separated Outlook addresses |
| `OUTLOOK_CREDENTIAL_NAMES` | No | Matching N8N credential names (one per Outlook) |

---

## Error Handling

| Scenario | Handling |
|---|---|
| DeepSeek timeout | Retry 3x with 2s delay |
| DeepSeek invalid JSON | Fallback to `fyi` category |
| Duplicate classification | Gmail: `-label:AI/*` filter in trigger query. Outlook: IF guard checks `$json.categories` |
| Outlook OAuth token expiry | Re-authorize credential in N8N; verify `offline_access` in Azure permissions |
| Gmail rate limit (250 qps) | Batch size 50 for deletions; 1-min poll interval |
| Outlook rate limit (10K/10min) | Batch size 50; single-account 1-min poll well within limits |

---

## Adding a New Account

**Gmail:**
1. Add address as a test user in Google Cloud Console OAuth consent screen
2. Create a new Gmail OAuth2 credential in N8N → sign in with the new account
3. Duplicate `wf1-gmail-trigger-template.json` → update `credential_name` and `email_address`
4. Import into N8N and activate

**Outlook/Hotmail:**
1. Create a new MS Outlook OAuth2 credential in N8N (reuse the same Azure App Client ID + Secret)
2. Duplicate `wf2-outlook-trigger-template.json` → update credential and email
3. Create AI- categories in the new Outlook account
4. Import into N8N and activate

---

## Testing

```bash
npm test                    # All 216 tests (code + utils)
npm run test:code           # Code modules only (166 tests, 30 suites)
npm run test:utils          # Utils only (37 tests, 10 suites)
npm run test:initial-cleanup # WF-4 initial cleanup tests only (47 tests, 9 suites)
```

---

## Deployment Checklist

### Phase 0 — Initial Cleanup (One-Time)
- [ ] Run `npm run generate:cleanup-workflow` to create WF-4 JSON
- [ ] Import **WF-4** (Initial Cleanup) into N8N
- [ ] Execute WF-4 manually to label all existing inbox emails
- [ ] Verify AI/* labels appear on old emails in Gmail
- [ ] Re-execute WF-4 to confirm idempotency (0 emails processed)

### Phase 1 — Credentials
- [ ] Gmail API project created in Google Cloud Console
- [ ] All Gmail accounts added as test users in OAuth consent screen
- [ ] Gmail OAuth2 credentials created in N8N (one per account, named clearly)
- [ ] Azure App Registration created
- [ ] `offline_access` + `Mail.ReadWrite` + `Mail.Send` added and consented
- [ ] MS Outlook OAuth2 credentials created in N8N (one per account)
- [ ] DeepSeek API key added as OpenAI-compatible credential in N8N
- [ ] All Gmail AI/* labels created in each Gmail account
- [ ] All Outlook AI- categories created in each Outlook account

### Phase 2 — Build Order
1. [ ] Run `npm run generate:cleanup-workflow` → import **WF-4** (Initial Cleanup)
2. [ ] Execute WF-4 manually to label all historical emails
3. [ ] Import **WF-0** (Shared Classifier) → test with manual webhook POST
4. [ ] Import **WF-1a** (first Gmail trigger) → verify labels apply
5. [ ] Duplicate WF-1a for remaining Gmail accounts
6. [ ] Import **WF-2a** (first Outlook trigger) → verify categories apply
7. [ ] Duplicate WF-2a for remaining Outlook accounts
8. [ ] Import **WF-3** (Spam deletion) → run manually first, verify

### Phase 3 — Testing
- [ ] Manual POST to WF-0 webhook → verify label applied
- [ ] Send test emails → verify correct account's label applied
- [ ] Promotional email → verify archived + labeled
- [ ] Move emails to Spam/Junk → run WF-3 manually → verify deleted
- [ ] Ambiguous email → verify fallback to `fyi`

### Phase 4 — Go Live
- [ ] Activate all workflows in N8N
- [ ] Monitor for 48h — check classifications and Outlook auth
- [ ] Expand pre-classifier domain lists based on real inbox patterns

---

## License

MIT
