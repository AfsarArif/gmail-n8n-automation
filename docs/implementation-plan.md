# Multi-Account Email Auto-Label & Spam Cleanup
## N8N + DeepSeek — Gmail & Outlook/Hotmail
**Claude Code Implementation Plan**

> **Goal:** Automatically classify and label incoming emails across multiple Gmail accounts and Outlook/Hotmail accounts using DeepSeek AI. Delete spam/junk daily across all accounts. One shared classification engine, multiple account triggers.

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites & Setup](#2-prerequisites--setup)
3. [Workflow Design Strategy](#3-workflow-design-strategy)
4. [Workflow 0 — Shared Classification Sub-Workflow](#4-workflow-0--shared-classification-sub-workflow)
5. [Workflow 1 — Gmail Account Triggers (one per Gmail)](#5-workflow-1--gmail-account-triggers-one-per-gmail)
6. [Workflow 2 — Outlook/Hotmail Account Triggers (one per Outlook)](#6-workflow-2--outlookhotmail-account-triggers-one-per-outlook)
7. [Workflow 3 — Daily Spam Deletion (all accounts)](#7-workflow-3--daily-spam-deletion-all-accounts)
8. [Node-by-Node Configuration Reference](#8-node-by-node-configuration-reference)
9. [DeepSeek Classification Prompt](#9-deepseek-classification-prompt)
10. [Cost Optimization — Sender Pre-Classifier](#10-cost-optimization--sender-pre-classifier)
11. [Error Handling](#11-error-handling)
12. [Deployment Checklist](#12-deployment-checklist)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        EMAIL ACCOUNTS                               │
│                                                                     │
│  [Gmail #1]   [Gmail #2]   [Gmail #3]   [Outlook/Hotmail #1] ...   │
└──────┬──────────────┬───────────────┬──────────────┬───────────────┘
       │              │               │              │
  Gmail Trigger  Gmail Trigger  Gmail Trigger   Outlook Trigger
  (WF-1a)        (WF-1b)        (WF-1c)         (WF-2a)
       │              │               │              │
       └──────────────┴───────────────┴──────────────┘
                                │
                    HTTP Request (POST with email data
                    + account_type + credential_id)
                                │
                                ▼
          ┌─────────────────────────────────────────┐
          │   WORKFLOW 0: SHARED CLASSIFICATION      │
          │   (called by ALL account triggers)       │
          │                                          │
          │  [Webhook Trigger]                       │
          │       │                                  │
          │  [Sender Pre-Classifier]                 │
          │       │              │                   │
          │  known domain    unknown                 │
          │  (skip AI)           │                   │
          │       │         [DeepSeek Classify]      │
          │       └──────┬───────┘                   │
          │          [Switch: category]              │
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
          │  [IF Gmail]  OR  [IF Outlook]            │
          │       │               │                  │
          │  Gmail delete    Outlook delete          │
          └─────────────────────────────────────────┘
```

**Key Design Decisions:**
- **One classification sub-workflow (WF-0)** shared by all accounts — update prompts or labels in one place, applies everywhere
- **Separate triggers per account** — each Gmail/Outlook account needs its own trigger workflow (N8N limitation: triggers are tied to one credential)
- **Account type flag** (`gmail` vs `outlook`) is passed to WF-0 so the correct label-apply node is used
- **Outlook/Hotmail uses OAuth2 via Microsoft Azure** — IMAP is deprecated by Microsoft and cannot be used
- **Gmail labels** are native Gmail labels; **Outlook uses categories** (the Outlook equivalent of labels)

---

## 2. Prerequisites & Setup

### 2.1 Credentials Required

| Account Type | Credential in N8N | Auth Method | Setup Location |
|---|---|---|---|
| Gmail (each account) | `Gmail OAuth2 API` | OAuth2 | Google Cloud Console |
| Outlook/Hotmail (each account) | `Microsoft Outlook OAuth2 API` | OAuth2 | Microsoft Azure Portal |
| DeepSeek | `OpenAI API` (compatible) | API Key | platform.deepseek.com |

### 2.2 Gmail OAuth2 Setup (repeat for each Gmail account)

```
1. Go to console.cloud.google.com
2. Create one project (e.g., "N8N Email Bot") — reuse for all Gmail accounts
3. Enable: Gmail API
4. OAuth consent screen:
   - User Type: External
   - Add ALL Gmail addresses as test users
5. Credentials → Create OAuth 2.0 Client ID
   - Type: Web application
   - Redirect URI: https://<your-n8n-domain>/rest/oauth2-credential/callback
6. In N8N: Credentials → New → Gmail OAuth2 API
   - Paste Client ID + Secret
   - Click "Sign in with Google" → authenticate with Gmail Account #1
   - Name it: "Gmail - personal@gmail.com"
7. Repeat step 6 for each Gmail account, naming each distinctly:
   - "Gmail - work@gmail.com"
   - "Gmail - side@gmail.com"
```

### 2.3 Outlook/Hotmail OAuth2 Setup (Azure App Registration)

Microsoft requires an Azure App Registration — a free Azure account works for personal Hotmail/Outlook accounts.

```
1. Go to portal.azure.com (sign in with your Microsoft/Hotmail account)
2. Search "App registrations" → New registration
   Name: "N8N Email Bot"
   Supported account types: "Accounts in any organizational directory
                             AND personal Microsoft accounts"
                             (this enables Hotmail/Outlook.com access)
   Redirect URI: Web → https://<your-n8n-domain>/rest/oauth2-credential/callback
3. Click Register → copy the Application (client) ID

4. Certificates & secrets → New client secret
   Description: n8n
   Expires: 24 months (or custom)
   Copy the SECRET VALUE (not the secret ID)

5. API permissions → Add a permission → Microsoft Graph → Delegated:
   - Mail.ReadWrite
   - Mail.Send
   - offline_access  ← CRITICAL: without this, auth expires after 1 hour
   Click "Grant admin consent" if prompted

6. In N8N: Credentials → New → Microsoft Outlook OAuth2 API
   - Client ID: <from step 3>
   - Client Secret: <value from step 4>
   - Click "Sign in with Microsoft" → authenticate with Outlook Account #1
   - Name it: "Outlook - myname@hotmail.com"
7. Repeat step 6 for each Outlook/Hotmail account
```

> ⚠️ **IMAP does NOT work for Outlook/Hotmail.** Microsoft deprecated Basic Auth for IMAP in Exchange Online and Outlook.com. The Microsoft Outlook node with OAuth2 is the only supported method.

### 2.4 DeepSeek Setup

```
1. platform.deepseek.com → API Keys → Create key
2. N8N: Credentials → New → OpenAI API
   - API Key: <your key>
   - Base URL: https://api.deepseek.com/v1
   - Name: "DeepSeek API"
```

### 2.5 Gmail Labels to Pre-Create (each Gmail account)

Log into each Gmail account and create:
```
AI/Newsletter
AI/Action-Required
AI/Social
AI/Promotions
AI/Career
AI/FYI
AI/Spam
```

### 2.6 Outlook Categories to Pre-Create (each Outlook account)

Outlook uses "categories" instead of labels. Create these in each Outlook account:
**Outlook web → Right-click any email → Categorize → Manage categories → New**
```
AI-Newsletter    (color: Blue)
AI-Action        (color: Red)
AI-Social        (color: Purple)
AI-Promotions    (color: Yellow)
AI-Career        (color: Green)
AI-FYI           (color: Gray)
AI-Spam          (color: Orange)
```
> Note: Outlook categories use hyphens, not slashes (slashes not supported in Outlook category names)

---

## 3. Workflow Design Strategy

### The Multi-Account Pattern

N8N does not support dynamic credential switching within a single trigger node. The correct architecture is:

```
Option A — Separate trigger workflow per account (RECOMMENDED)
  ✅ Simple to debug per account
  ✅ Each account is independently activatable/pausable
  ✅ Scales cleanly — just duplicate the trigger workflow for new accounts
  ✅ Classification logic is centralized in WF-0

Option B — Single workflow with multiple Gmail Trigger nodes
  ⚠️ Works but becomes cluttered
  ⚠️ Hard to add/remove accounts
  ❌ Does not scale beyond ~3 accounts cleanly
```

**This plan uses Option A.**

### Workflow Inventory

| Workflow | Name | One per... | Trigger |
|---|---|---|---|
| WF-0 | Shared Classifier | (single shared) | Webhook |
| WF-1a | Gmail Trigger #1 | Gmail account | Gmail Trigger |
| WF-1b | Gmail Trigger #2 | Gmail account | Gmail Trigger |
| WF-1n | Gmail Trigger #N | Gmail account | Gmail Trigger |
| WF-2a | Outlook Trigger #1 | Outlook account | MS Outlook Trigger |
| WF-2n | Outlook Trigger #N | Outlook account | MS Outlook Trigger |
| WF-3 | Daily Spam Deletion | (single shared) | Schedule |

---

## 4. Workflow 0 — Shared Classification Sub-Workflow

**Purpose:** Receives email data from any account trigger, runs DeepSeek classification, applies the correct label/category back to the originating account.

**Trigger:** Webhook (called by all account trigger workflows)

### Node Flow

```
[Webhook: POST /classify-email]
    → [Code: Sender Pre-Classifier]
        ├── known domain → [Set: category = fast_category]
        └── unknown      → [Markdown: HTML → Plain Text]
                               → [DeepSeek: Classify]
    → [Merge paths]
    → [Set: normalize final_category]
    → [Switch: account_type]
        ├── "gmail"   → [Switch: category] → [Gmail: Add Label]
        │                                  → [Gmail: Mark Read / Archive]
        └── "outlook" → [Switch: category] → [MS Outlook: Add Category]
                                           → [MS Outlook: Mark Read / Move]
```

### Webhook Input Schema

Every account trigger sends this JSON payload to WF-0:

```json
{
  "account_type": "gmail",
  "credential_name": "Gmail - personal@gmail.com",
  "email_address": "personal@gmail.com",
  "message_id": "18f3a2c...",
  "thread_id": "18f3a2c...",
  "subject": "Weekly digest from TechCrunch",
  "from": "newsletters@techcrunch.com",
  "body_html": "<html>...</html>",
  "body_text": "Plain text fallback...",
  "snippet": "First 200 chars of email..."
}
```

### Node Configurations

**Node 1: Webhook Trigger**
```
HTTP Method: POST
Path: /classify-email
Authentication: Header Auth (add secret header X-N8N-Token for security)
Response Mode: Immediately
```

**Node 2: Code — Sender Pre-Classifier**
```javascript
const from = ($input.first().json.from || '').toLowerCase();

const rules = [
  {
    domains: ['linkedin.com','twitter.com','x.com','facebook.com','instagram.com',
              'reddit.com','github.com','discord.com','meetup.com','slack.com'],
    category: 'social'
  },
  {
    domains: ['indeed.com','glassdoor.com','levels.fyi','ziprecruiter.com','dice.com',
              'hired.com','greenhouse.io','lever.co','workday.com','myworkdayjobs.com',
              'wellfound.com','otta.com'],
    category: 'career'
  },
  {
    domains: ['amazon.com','apple.com','paypal.com','stripe.com','shopify.com',
              'ebay.com','bestbuy.com','ups.com','fedex.com','usps.com'],
    category: 'fyi'
  },
  {
    domains: ['substack.com','beehiiv.com','convertkit.com','mailchimp.com',
              'klaviyo.com','sendgrid.net','constantcontact.com'],
    category: 'newsletter'
  },
];

for (const rule of rules) {
  if (rule.domains.some(d => from.includes(d))) {
    return [{ json: { ...$input.first().json, fast_category: rule.category, skip_ai: true } }];
  }
}

return [{ json: { ...$input.first().json, fast_category: null, skip_ai: false } }];
```

**Node 3: IF — Skip AI?**
```
Condition: {{ $json.skip_ai }} equals true
True  → Set node (category = fast_category) → Merge
False → Markdown node → DeepSeek → Merge
```

**Node 4: Markdown — HTML to Plain Text**
```
Input:  {{ $json.body_html || $json.body_text || $json.snippet }}
Output: cleaned_body
```

**Node 5: DeepSeek — Basic LLM Chain**
```
Model: OpenAI Chat Model (DeepSeek API credential)
  Model: deepseek-chat
  Temperature: 0
Prompt: See Section 9 — Classification Prompt
Variables:
  from:         {{ $json.from }}
  subject:      {{ $json.subject }}
  body_preview: {{ ($json.cleaned_body || $json.snippet || '').slice(0, 300) }}
Output Parser: JSON Parser → field: category
```

**Node 6: Set — Normalize**
```
final_category: {{ $json.fast_category || $json.category || 'fyi' }}
account_type:   {{ $json.account_type }}
message_id:     {{ $json.message_id }}
thread_id:      {{ $json.thread_id }}
```

**Node 7: Switch — Account Type**
```
Rule 1: {{ $json.account_type }} equals "gmail"
Rule 2: {{ $json.account_type }} equals "outlook"
```

---

### Gmail Label Branch (account_type = gmail)

**Node 8a: Switch — Gmail Category**
```
Rule 1: final_category = "newsletter"
Rule 2: final_category = "action"
Rule 3: final_category = "social"
Rule 4: final_category = "promotions"
Rule 5: final_category = "career"
Rule 6: final_category = "fyi"
Default: spam
```

**Node 9a: Gmail — Add Label**
```
Resource: Message
Operation: Add Label
Message ID: {{ $json.message_id }}
Label Name: AI/Newsletter  (or whichever branch)

⚠️ CREDENTIAL NOTE:
Each Gmail node in WF-0 must use a dynamic credential.
Use the "Run As" pattern: the trigger workflow passes the
credential_name and the Gmail node in WF-0 uses that to
select the right credential via the "Credentials" expression field.

Practical approach: use separate Gmail sub-workflow per account
(see Section 3 note on credential limitation).
```

**Node 10a: Gmail — Mark as Read**
```
Applies to: newsletter, social, promotions, fyi, spam branches
Operation: Modify → Mark as Read: true
```

**Node 11a: Gmail — Archive (promotions only)**
```
Operation: Modify → Remove Label: INBOX
```

---

### Outlook Category Branch (account_type = outlook)

**Node 8b: Switch — Outlook Category**
```
Same rules as Gmail branch above
```

**Node 9b: Microsoft Outlook — Update Message**
```
Resource: Message
Operation: Update
Message ID: {{ $json.message_id }}
Categories: ["AI-Newsletter"]  (or whichever category name)
```

**Node 10b: Microsoft Outlook — Mark as Read**
```
Resource: Message
Operation: Update
Message ID: {{ $json.message_id }}
Is Read: true
```

**Node 11b: Microsoft Outlook — Move to Folder (promotions)**
```
Resource: Message
Operation: Move
Message ID: {{ $json.message_id }}
Destination Folder: Archive
```

---

## 5. Workflow 1 — Gmail Account Triggers (one per Gmail)

**Duplicate this workflow for each Gmail account. Change only the Gmail credential.**

### Node Flow

```
[Gmail Trigger — Account-specific credential]
    → [IF: already labeled?]  ← dedup guard
        ├── yes → stop
        └── no  → [Set: build payload]
                      → [HTTP Request: POST to WF-0 webhook]
```

### Node Configurations

**Node 1: Gmail Trigger**
```
Credential: "Gmail - personal@gmail.com"  ← CHANGE PER ACCOUNT
Resource: Message
Event: Message Received
Query Filter: -label:AI/Newsletter -label:AI/Action-Required -label:AI/Social
              -label:AI/Promotions -label:AI/Career -label:AI/FYI -label:AI/Spam
Poll Interval: Every 1 Minute
```

**Node 2: IF — Already Labeled?**
```javascript
// Dedup: skip if any AI/* label already exists
const labels = $json.labelIds || [];
return !labels.some(l => l.startsWith('AI/'));
// True = not yet labeled → proceed
// False = already labeled → stop
```

**Node 3: Set — Build WF-0 Payload**
```
Fields:
  account_type:    "gmail"
  credential_name: "Gmail - personal@gmail.com"  ← CHANGE PER ACCOUNT
  email_address:   "personal@gmail.com"           ← CHANGE PER ACCOUNT
  message_id:      {{ $json.id }}
  thread_id:       {{ $json.threadId }}
  subject:         {{ $json.subject }}
  from:            {{ $json.from.value[0].address }}
  body_html:       {{ $json.body.html }}
  body_text:       {{ $json.body.text }}
  snippet:         {{ $json.snippet }}
```

**Node 4: HTTP Request — Call WF-0**
```
Method: POST
URL: {{ $env.N8N_BASE_URL }}/webhook/classify-email
Headers:
  X-N8N-Token: {{ $env.WF0_SECRET_TOKEN }}
  Content-Type: application/json
Body: {{ JSON.stringify($json) }}
Response: Ignore (fire and forget)
```

---

## 6. Workflow 2 — Outlook/Hotmail Account Triggers (one per Outlook)

**Duplicate for each Outlook/Hotmail account. Change only the credential.**

### Node Flow

```
[Microsoft Outlook Trigger — Account-specific credential]
    → [IF: already categorized?]
        ├── yes → stop
        └── no  → [Set: build payload]
                      → [HTTP Request: POST to WF-0 webhook]
```

### Node Configurations

**Node 1: Microsoft Outlook Trigger**
```
Credential: "Outlook - myname@hotmail.com"  ← CHANGE PER ACCOUNT
Event: Message Received
Filters:
  - Folder: Inbox
  - (Optional) Only unread: true
Poll Interval: Every 1 Minute
```

**Node 2: IF — Already Categorized?**
```javascript
// Check if any AI- category already applied
const categories = $json.categories || [];
return !categories.some(c => c.startsWith('AI-'));
```

**Node 3: Set — Build WF-0 Payload**
```
Fields:
  account_type:    "outlook"
  credential_name: "Outlook - myname@hotmail.com"  ← CHANGE PER ACCOUNT
  email_address:   "myname@hotmail.com"             ← CHANGE PER ACCOUNT
  message_id:      {{ $json.id }}
  thread_id:       {{ $json.conversationId }}
  subject:         {{ $json.subject }}
  from:            {{ $json.from.emailAddress.address }}
  body_html:       {{ $json.body.content }}
  body_text:       {{ $json.bodyPreview }}
  snippet:         {{ $json.bodyPreview }}
```

**Node 4: HTTP Request — Call WF-0**
```
Method: POST
URL: {{ $env.N8N_BASE_URL }}/webhook/classify-email
Headers:
  X-N8N-Token: {{ $env.WF0_SECRET_TOKEN }}
  Content-Type: application/json
Body: {{ JSON.stringify($json) }}
```

---

## 7. Workflow 3 — Daily Spam Deletion (All Accounts)

**Purpose:** Permanently delete spam/junk across all Gmail and Outlook accounts every night.
**AI tokens used:** Zero.

### Node Flow

```
[Schedule: 11:59 PM daily]
    → [Code: accounts config list]
    → [Split In Batches: one account at a time]
    → [Switch: account_type]
        ├── gmail   → [Gmail: Get Messages — label:spam]
        │              → [Split In Batches: 50]
        │              → [Gmail: Delete]
        └── outlook → [MS Outlook: Get Messages — isJunk:true, older_than:1d]
                       → [Split In Batches: 50]
                       → [MS Outlook: Delete]
```

### Node Configurations

**Node 1: Schedule Trigger**
```
Trigger at: 23:59 daily
```

**Node 2: Code — Accounts Config**
```javascript
// List all your registered accounts here
// credential_name must match exactly what you named the credential in N8N
return [
  { json: { account_type: 'gmail',   credential_name: 'Gmail - personal@gmail.com',   email: 'personal@gmail.com' } },
  { json: { account_type: 'gmail',   credential_name: 'Gmail - work@gmail.com',        email: 'work@gmail.com' } },
  { json: { account_type: 'gmail',   credential_name: 'Gmail - side@gmail.com',        email: 'side@gmail.com' } },
  { json: { account_type: 'outlook', credential_name: 'Outlook - myname@hotmail.com',  email: 'myname@hotmail.com' } },
  // Add more accounts here
];
```

**Node 3: Split In Batches**
```
Batch Size: 1 (process one account at a time)
```

**Node 4: Switch — Account Type**
```
Rule 1: {{ $json.account_type }} equals "gmail"
Rule 2: {{ $json.account_type }} equals "outlook"
```

**Node 5a: Gmail — Get Spam**
```
Credential: dynamically reference $json.credential_name
  (use Execute Workflow pattern — see note below)
Operation: Get Many
Query: label:spam older_than:1d
Return All: true
Limit: 500
```

**Node 5b: Microsoft Outlook — Get Junk**
```
Credential: dynamically reference $json.credential_name
Resource: Message
Operation: Get Many
Folder: Junk Email
Filters: receivedDateTime older than 1 day
Return All: true
```

**Node 6a/6b: Split In Batches (50)**
```
Batch Size: 50
(rate limit protection)
```

**Node 7a: Gmail — Delete**
```
Resource: Message
Operation: Delete  ← permanent (skip trash)
Message ID: {{ $json.id }}
```

**Node 7b: Microsoft Outlook — Delete**
```
Resource: Message
Operation: Delete
Message ID: {{ $json.id }}
```

> ⚠️ **Dynamic Credential Pattern for Spam Deletion:**
> Because N8N ties credentials statically to nodes, the cleanest approach for multi-account deletion is to use separate **Execute Workflow** nodes for each account, passing the account type. Create one "Gmail Delete Spam" sub-workflow and one "Outlook Delete Spam" sub-workflow, each hardcoded to their own credential. WF-3 loops through accounts and calls the right sub-workflow.

---

## 8. Node-by-Node Configuration Reference

### 8.1 All Nodes Used

| Node | Workflow | Purpose |
|---|---|---|
| `Gmail Trigger` | WF-1x | Watch Gmail inbox per account |
| `Microsoft Outlook Trigger` | WF-2x | Watch Outlook inbox per account |
| `IF` | WF-1x, WF-2x | Dedup guard |
| `Set` | WF-1x, WF-2x | Build WF-0 payload |
| `HTTP Request` | WF-1x, WF-2x | Fire-and-forget call to WF-0 |
| `Webhook` | WF-0 | Receive classification requests |
| `Code` | WF-0, WF-3 | Pre-classifier + accounts config |
| `Markdown` | WF-0 | Strip HTML |
| `OpenAI Chat Model` | WF-0 | DeepSeek connection |
| `Basic LLM Chain` | WF-0 | Run classification prompt |
| `JSON Parser` | WF-0 | Parse DeepSeek output |
| `Set` | WF-0 | Normalize category + metadata |
| `Switch` | WF-0 | Route by account type + category |
| `Gmail` (Add Label) | WF-0 | Apply AI/* label on Gmail |
| `Gmail` (Modify) | WF-0 | Mark read / archive on Gmail |
| `Microsoft Outlook` (Update) | WF-0 | Apply AI- category on Outlook |
| `Microsoft Outlook` (Move) | WF-0 | Move promotions to Archive |
| `Schedule Trigger` | WF-3 | 11:59 PM daily |
| `Split In Batches` | WF-3 | Loop accounts + batch deletes |
| `Gmail` (Delete) | WF-3 | Permanent spam delete |
| `Microsoft Outlook` (Delete) | WF-3 | Permanent junk delete |

### 8.2 Environment Variables

```bash
N8N_BASE_URL=https://your-n8n-domain.com
WF0_SECRET_TOKEN=your-random-secret-here   # used to secure WF-0 webhook
DEEPSEEK_MODEL=deepseek-chat
```

### 8.3 Label/Category Mapping

| Category | Gmail Label | Outlook Category | Behavior |
|---|---|---|---|
| `newsletter` | `AI/Newsletter` | `AI-Newsletter` | Mark read, stay in inbox |
| `action` | `AI/Action-Required` | `AI-Action` | Keep unread, stay in inbox |
| `social` | `AI/Social` | `AI-Social` | Mark read, stay in inbox |
| `promotions` | `AI/Promotions` | `AI-Promotions` | Mark read + Archive/Move |
| `career` | `AI/Career` | `AI-Career` | Keep unread, stay in inbox |
| `fyi` | `AI/FYI` | `AI-FYI` | Mark read, stay in inbox |
| `spam` | `AI/Spam` | `AI-Spam` | Mark read, deleted nightly |

---

## 9. DeepSeek Classification Prompt

```
SYSTEM:
You are an email classifier. Return valid JSON only — no markdown, no explanation, no extra text.

Classify the email into exactly one category:

- "newsletter":   Blog digests, editorial content, curated reading lists, publication emails
- "action":       Requires a direct reply or response (questions, requests, meeting invites, tasks)
- "social":       Notifications from social platforms (LinkedIn, Twitter/X, Facebook, Instagram, Reddit, GitHub, Discord)
- "promotions":   Sales, discount codes, limited-time offers, marketing campaigns, product launches
- "career":       Job postings, recruiter outreach, interview requests, application updates, job alerts
- "fyi":          Receipts, order confirmations, shipping updates, account notifications, no reply needed
- "spam":         Junk mail, phishing, irrelevant unsolicited bulk mail

Return exactly this JSON:
{
  "category": "newsletter|action|social|promotions|career|fyi|spam"
}

USER:
From: {{from}}
Subject: {{subject}}
Body preview: {{body_preview}}
```

---

## 10. Cost Optimization — Sender Pre-Classifier

The pre-classifier in WF-0 routes ~35% of emails without using any DeepSeek tokens. Extend the domain lists to match your inboxes:

```javascript
// Add to the rules array in Node 2 of WF-0:

// E-commerce receipts → fyi
{ domains: ['amazon.com','apple.com','paypal.com','stripe.com','shopify.com','ebay.com','bestbuy.com'], category: 'fyi' },

// Shipping → fyi
{ domains: ['ups.com','fedex.com','usps.com','dhl.com'], category: 'fyi' },

// Newsletter platforms → newsletter
{ domains: ['substack.com','beehiiv.com','convertkit.com','ghost.io'], category: 'newsletter' },

// More career platforms → career
{ domains: ['wellfound.com','otta.com','simplyhired.com','monster.com'], category: 'career' },

// More social → social
{ domains: ['notion.so','figma.com','trello.com','atlassian.com'], category: 'social' },
```

### Cost Estimates (DeepSeek `deepseek-chat`, all accounts combined)

~380 tokens per email. With pre-classifier, ~65% of emails hit DeepSeek.

| Total Daily Emails (all accounts) | Monthly AI Emails | Monthly Cost |
|---|---|---|
| 20 | ~390 | **~$0.07** |
| 50 | ~975 | **~$0.19** |
| 100 | ~1,950 | **~$0.38** |
| 200 | ~3,900 | **~$0.76** |
| 300 | ~5,850 | **~$1.14** |

*DeepSeek pricing: $0.27/1M input + $1.10/1M output tokens.*

---

## 11. Error Handling

### 11.1 DeepSeek Invalid JSON → Fallback to FYI

```javascript
// After JSON Parser in WF-0
const validCategories = ['newsletter','action','social','promotions','career','fyi','spam'];
const cat = $json.category;
if (!validCategories.includes(cat)) {
  return [{ json: { ...$json, final_category: 'fyi' } }]; // safe fallback
}
return $input.all();
```

### 11.2 Dedup — Already Labeled

- Gmail: filter in trigger query with `-label:AI/*`
- Outlook: IF node checks `$json.categories` for any `AI-` prefix

### 11.3 Retry on DeepSeek Timeout

```
OpenAI Chat Model node:
  Retry on Fail: true
  Max Tries: 3
  Wait: 2000ms between tries
```

### 11.4 Outlook OAuth Token Expiry

The most common Outlook issue — token expires after 1 hour if `offline_access` scope was not included. Fix:
- Re-authorize the credential in N8N
- Verify `offline_access` is in the Azure app permissions (see Section 2.3 step 5)

### 11.5 Rate Limits

- Gmail: 250 quota units/second. One email per trigger fire is safe. Batch deletion uses groups of 50.
- Microsoft Graph: 10,000 requests per 10 min per app. Single-account polling at 1-min intervals is well within limits.

---

## 12. Deployment Checklist

### Phase 1 — Credentials
- [ ] Gmail API project created in Google Cloud Console
- [ ] All Gmail accounts added as test users in OAuth consent screen
- [ ] Gmail OAuth2 credential created in N8N for each Gmail account (named clearly)
- [ ] Azure App Registration created (free Azure account is sufficient)
- [ ] `offline_access` + `Mail.ReadWrite` + `Mail.Send` permissions added and consented in Azure
- [ ] Microsoft Outlook OAuth2 credential created in N8N for each Outlook/Hotmail account
- [ ] DeepSeek API key added as OpenAI-compatible credential in N8N
- [ ] All Gmail AI/* labels created in each Gmail account
- [ ] All Outlook AI- categories created in each Outlook account

### Phase 2 — Build Order
1. [ ] Build **WF-0** (Shared Classifier) — test with a manual webhook POST
2. [ ] Build **WF-1a** (first Gmail trigger) — test with one account, verify labels apply
3. [ ] Duplicate WF-1a → **WF-1b, WF-1c...** for remaining Gmail accounts
4. [ ] Build **WF-2a** (first Outlook trigger) — test with one account, verify categories apply
5. [ ] Duplicate WF-2a → **WF-2b...** for remaining Outlook accounts
6. [ ] Build **WF-3** (Spam deletion) — run manually first, verify deletes work

### Phase 3 — Testing
- [ ] Manually POST a test payload to WF-0 webhook → verify label is applied to correct account
- [ ] Send test email to Gmail #1 → verify correct AI/* label applied
- [ ] Send test email to Gmail #2 → verify correct account's label applied (not Gmail #1's)
- [ ] Send test email to Outlook → verify AI- category applied
- [ ] Send promotional email → verify archived + labeled across account types
- [ ] Move emails to Spam/Junk manually → run WF-3 manually → verify deleted
- [ ] Test fallback: ambiguous email → should default to AI/FYI or AI-FYI

### Phase 4 — Go Live
- [ ] Activate WF-0 (webhook always listening)
- [ ] Activate all WF-1x triggers
- [ ] Activate all WF-2x triggers
- [ ] Activate WF-3 schedule (11:59 PM daily)
- [ ] Monitor for 48h — check for misclassifications and Outlook auth issues
- [ ] Expand pre-classifier domain lists based on your real inbox senders

---

## Appendix A — Useful N8N Expressions

```javascript
// Gmail sender address
{{ $json.from.value[0].address }}

// Outlook sender address
{{ $json.from.emailAddress.address }}

// Gmail body (prefer HTML, fallback chain)
{{ $json.body.html || $json.body.text || $json.snippet }}

// Outlook body
{{ $json.body.content || $json.bodyPreview }}

// Truncate to 300 chars for DeepSeek
{{ ($json.cleaned_body || $json.snippet || '').slice(0, 300) }}

// Check Gmail already labeled
{{ ($json.labelIds || []).some(l => l.startsWith('AI/')) }}

// Check Outlook already categorized
{{ ($json.categories || []).some(c => c.startsWith('AI-')) }}
```

## Appendix B — Adding a New Account (Ongoing)

**To add a new Gmail account:**
1. Add the Gmail address as a test user in Google Cloud Console OAuth consent
2. Create a new Gmail OAuth2 credential in N8N → sign in with the new account
3. Duplicate any existing WF-1x workflow
4. In the duplicate: change the Gmail Trigger credential + update the Set node `credential_name` and `email_address`
5. Activate the new workflow

**To add a new Outlook/Hotmail account:**
1. Create a new Microsoft Outlook OAuth2 credential in N8N → sign in with the new account (reuse the same Azure App Client ID + Secret)
2. Duplicate any existing WF-2x workflow
3. In the duplicate: change the Outlook Trigger credential + update the Set node fields
4. Create AI- categories in the new Outlook account
5. Activate the new workflow

---

*Multi-account, two email providers, one classification engine. Ready for Claude Code implementation.*
