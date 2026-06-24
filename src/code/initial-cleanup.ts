/**
 * initial-cleanup.ts — WF-4 Initial Cleanup (One-Time)
 *
 * Processes ALL existing inbox emails (not just new ones) through the WF-0
 * classification webhook, applying AI/* labels. Spam is labeled as AI/Spam
 * and left for WF-3's nightly deletion.
 *
 * Exports:
 * - Pure TypeScript functions (unit-testable query builders, summary builder)
 * - N8N Code node JavaScript generators (return JS strings for workflow JSON)
 * - Workflow generator (programmatically builds the complete WF-4 N8NWorkflow)
 */

import type { EmailCategory } from './webhook-schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-account cleanup result emitted after processing one account. */
export interface CleanupStats {
  account_type: 'gmail' | 'outlook';
  email_address: string;
  credential_name: string;
  /** Total unlabeled messages found in inbox. */
  total_fetched: number;
  /** Number successfully classified and labeled by WF-0. */
  total_classified: number;
  /** Number of failed classifications (includes WF-0 errors + network errors). */
  total_errors: number;
  /** Per-category counts for classified emails. */
  categories: Partial<Record<EmailCategory | 'unknown', number>>;
  /** ISO-8601 timestamp when processing started. */
  started_at: string;
  /** ISO-8601 timestamp when processing completed. */
  completed_at: string | null;
}

/** Aggregate summary returned by the final node in WF-4. */
export interface CleanupSummary {
  /** ISO-8601 timestamp of summary generation. */
  timestamp: string;
  /** Number of accounts processed. */
  total_accounts: number;
  /** Sum of all fetched emails across accounts. */
  total_fetched: number;
  /** Sum of all successfully classified emails. */
  total_classified: number;
  /** Sum of all errors. */
  total_errors: number;
  /** Merged per-category counts across all accounts. */
  categories: Partial<Record<EmailCategory | 'unknown', number>>;
  /** Total wall-clock duration in seconds. */
  duration_seconds: number;
  /** Per-account detail records. */
  accounts: CleanupStats[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of emails per HTTP batch to WF-0. */
export const DEFAULT_BATCH_SIZE = 10;

/** Gmail API max page size for message listing. */
export const GMAIL_PAGE_SIZE = 500;

/** Delay in ms between batches to respect API rate limits. */
export const BATCH_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Gmail query builder
// ---------------------------------------------------------------------------

/**
 * Build a Gmail search query that selects inbox messages WITHOUT any AI/*
 * label, so only unclassified emails are returned.
 *
 * The query explicitly excludes each of the 7 AI/* labels used by the
 * classifier. Gmail does NOT support wildcard label exclusion, hence the
 * verbose explicit form.
 *
 * @example
 *   buildGmailUnlabeledQuery()
 *   // "-label:AI/Newsletter -label:AI/Action-Required ... -label:AI/Spam in:inbox"
 */
export function buildGmailUnlabeledQuery(): string {
  const labels = [
    'AI/Newsletter',
    'AI/Action-Required',
    'AI/Social',
    'AI/Promotions',
    'AI/Career',
    'AI/FYI',
    'AI/Spam',
  ];
  const exclusions = labels.map((l) => `-label:${l}`).join(' ');
  return `${exclusions} in:inbox`;
}

// ---------------------------------------------------------------------------
// Outlook query builder
// ---------------------------------------------------------------------------

/**
 * Build a Microsoft Graph `$filter` OData expression that selects inbox
 * messages whose categories do NOT start with "AI-".
 *
 * The filter uses a `not` wrapper around `any` with `startswith` because
 * Graph does not support a negated `any` directly.
 *
 * @example
 *   buildOutlookUnlabeledFilter()
 *   // "not categories/any(c:startswith(c,'AI-'))"
 */
export function buildOutlookUnlabeledFilter(): string {
  return "not categories/any(c:startswith(c,'AI-'))";
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

/**
 * Aggregate per-account cleanup results into a single summary object
 * suitable for the final node in WF-4.
 *
 * @param results - Array of {@link CleanupStats}, one per account.
 * @returns A {@link CleanupSummary} with merged counters and categories.
 */
export function buildSummaryReport(results: CleanupStats[]): CleanupSummary {
  const total_fetched = results.reduce((sum, r) => sum + r.total_fetched, 0);
  const total_classified = results.reduce(
    (sum, r) => sum + r.total_classified,
    0,
  );
  const total_errors = results.reduce((sum, r) => sum + r.total_errors, 0);

  // Merge per-category counts
  const categories: Partial<Record<EmailCategory | 'unknown', number>> = {};
  for (const r of results) {
    const cats = r.categories;
    if (!cats) continue;
    for (const [key, count] of Object.entries(cats)) {
      const k = key as EmailCategory | 'unknown';
      categories[k] = (categories[k] ?? 0) + (count as number);
    }
  }

  // Compute duration from earliest start to latest completion
  let duration_seconds = 0;
  const starts = results
    .map((r) => r.started_at)
    .filter(Boolean)
    .sort();
  const ends = results
    .map((r) => r.completed_at)
    .filter((e): e is string => e !== null)
    .sort();
  if (starts.length > 0 && ends.length > 0) {
    duration_seconds = Math.round(
      (new Date(ends[ends.length - 1]).getTime() -
        new Date(starts[0]).getTime()) /
        1000,
    );
  }

  return {
    timestamp: new Date().toISOString(),
    total_accounts: results.length,
    total_fetched,
    total_classified,
    total_errors,
    categories,
    duration_seconds,
    accounts: results,
  };
}

// ---------------------------------------------------------------------------
// N8N Code node JavaScript generators
// ---------------------------------------------------------------------------

/**
 * Return the JavaScript source for the "Build WF-0 Payload" Code node.
 *
 * This node sits between the Split In Batches node and the HTTP Request
 * node. It receives one item (a single Gmail message from "Get Many") and
 * transforms it into the canonical {@link WebhookInputPayload} shape that
 * WF-0 expects.
 *
 * The field mapping mirrors {@link ../code/payload-builder.ts:buildGmailPayload}.
 */
export function payloadBuilderNodeJs(): string {
  return `// Build WF-0 Payload — maps a Gmail "Get Many" item to the WF-0 webhook shape.
// Mirrors the mapping in src/code/payload-builder.ts → buildGmailPayload().
//
// Gmail Get Many with simple=true returns a flat object:
//   { id, threadId, subject, from (string), text, html, snippet, ... }

const first = $input.first();
if (!first || !first.json) {
  // No items — Gmail returned zero unlabeled messages, or batch is empty.
  // Output a single no-op item so the pipeline continues to the Summary node.
  return [{ json: { _no_emails: true } }];
}

const msg = first.json;

// Extract sender address — with simple=true, msg.from is a string
// like "Sender Name <email@example.com>" or just "email@example.com"
let fromAddress = 'unknown@unknown.com';
if (typeof msg.from === 'string' && msg.from.length > 0) {
  fromAddress = msg.from;
}

// Build the WF-0 payload
const payload = {
  account_type: 'gmail',
  credential_name: msg._credential_name || ($env.GMAIL_CREDENTIAL_NAMES || '').split(',')[0]?.trim() || '',
  email_address: msg._email_address || ($env.GMAIL_ACCOUNTS || '').split(',')[0]?.trim() || '',
  message_id: msg.id || '',
  thread_id: msg.threadId || msg.id || '',
  subject: msg.subject || '',
  from: fromAddress,
  body_html: msg.html || '',
  body_text: msg.text || '',
  snippet: msg.snippet || '',
};

return [{ json: payload }];`;
}

/**
 * Return the JavaScript source for the "Build Summary" Code node.
 *
 * This is the final node in WF-4. It receives all accumulated items from
 * the HTTP Request node (one per batch iteration) and builds a single
 * {@link CleanupSummary} object.
 */
export function summaryNodeJs(): string {
  return `// Build Summary — aggregates all WF-0 classification results into a
// single CleanupSummary object for the final workflow output.

const items = $input.all();
if (!items || items.length === 0) {
  // No items — nothing was processed
  return [{
    json: {
      account_type: 'gmail',
      email_address: '',
      credential_name: '',
      total_fetched: 0,
      total_classified: 0,
      total_errors: 0,
      categories: {},
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }
  }];
}

// Accumulate stats
const stats = {
  account_type: 'gmail',
  email_address: '',
  credential_name: '',
  total_fetched: 0,
  total_classified: 0,
  total_errors: 0,
  categories: {},
  started_at: new Date().toISOString(),
  completed_at: null,
};

const categories = {};
let lastFetchCount = 0;

for (const item of items) {
  const json = item.json;

  // WF-0 response — successful classification includes final_category
  if (json.final_category) {
    stats.total_classified++;
    const cat = json.final_category;
    categories[cat] = (categories[cat] || 0) + 1;
  } else if (json.message || json.error) {
    // WF-0 returned an error
    stats.total_errors++;
  }

  // Capture account info from first item
  if (!stats.email_address && json.email_address) {
    stats.email_address = json.email_address;
  }
  if (!stats.credential_name && json.credential_name) {
    stats.credential_name = json.credential_name;
  }

  // Track fetch count from WF-0's payload echo
  if (json.message_id) {
    lastFetchCount++;
  }
}

stats.total_fetched = items.length;
stats.categories = categories;
stats.completed_at = new Date().toISOString();

return [{ json: stats }];`;
}

// ---------------------------------------------------------------------------
// Workflow generator
// ---------------------------------------------------------------------------

import type { N8NWorkflow, N8NNode, N8NConnections } from '../utils/n8n-templates';
import {
  createWebhookNode,
  createGmailNode,
  createSplitInBatchesNode,
  createCodeNode,
  createHttpRequestNode,
  connect,
  createN8NWorkflow,
} from '../utils/n8n-templates';

/** Configuration for generating a single-account WF-4 workflow. */
export interface CleanupWorkflowConfig {
  /** N8N credential name, e.g. "Gmail - personal@gmail.com". */
  credentialName: string;
  /** Email address of the Gmail account. */
  emailAddress: string;
  /** N8N base URL (defaults to $env.N8N_BASE_URL in the workflow). */
  n8nBaseUrl?: string;
  /** Secret token for WF-0 webhook auth. */
  wf0Token?: string;
  /** Batch size for Split In Batches node. */
  batchSize?: number;
}

/**
 * Programmatically generate the complete WF-4: Initial Cleanup workflow
 * for a single Gmail account.
 *
 * Workflow structure:
 * ```
 * Manual Trigger → Gmail: Get Many → Split In Batches (10) → Code: Build Payload → HTTP POST WF-0 → Code: Summary
 * ```
 *
 * @param config - Account credentials and workflow tuning.
 * @returns A complete {@link N8NWorkflow} ready for JSON serialization.
 */
export function buildCleanupWorkflow(
  config: CleanupWorkflowConfig,
): N8NWorkflow {
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const n8nBaseUrl = config.n8nBaseUrl ?? '{{ $env.N8N_BASE_URL }}';
  const wf0Token = config.wf0Token ?? '{{ $env.WF0_SECRET_TOKEN }}';

  const nodes: N8NNode[] = [];
  const connections: N8NConnections = {};

  // ── Node 0: Webhook Trigger ────────────────────────────────────────
  const webhookTrigger = createWebhookNode({
    name: 'Webhook: Start Cleanup',
    position: [250, 300],
    httpMethod: 'POST',
    path: 'start-cleanup',
    authentication: 'none',
    responseMode: 'lastNode',
  });
  nodes.push(webhookTrigger);

  // ── Node 1: Gmail Get Many ─────────────────────────────────────────
  const gmailGetMany = createGmailNode({
    name: 'Gmail: Get Unlabeled Emails',
    position: [500, 300],
    resource: 'message',
    operation: 'getMany',
    credentialName: config.credentialName,
    parameters: {
      resource: 'message',
      operation: 'getMany',
      returnAll: true,
      query: buildGmailUnlabeledQuery(),
      simple: true,
      options: {
        maxResults: GMAIL_PAGE_SIZE,
      },
    },
  });
  nodes.push(gmailGetMany);
  connect(connections, { node: webhookTrigger.name }, { node: gmailGetMany.name });

  // ── Node 2: Split In Batches ──────────────────────────────────────
  const splitBatches = createSplitInBatchesNode({
    name: 'Split In Batches',
    position: [750, 300],
    batchSize,
  });
  nodes.push(splitBatches);
  connect(connections, { node: gmailGetMany.name }, { node: splitBatches.name });

  // ── Node 3: Code — Build WF-0 Payload ─────────────────────────────
  const buildPayload = createCodeNode({
    name: 'Build WF-0 Payload',
    position: [1000, 300],
    jsCode: payloadBuilderNodeJs(),
  });
  nodes.push(buildPayload);
  connect(connections, { node: splitBatches.name }, { node: buildPayload.name });

  // ── Node 4: HTTP Request — POST to WF-0 ───────────────────────────
  const httpRequest = createHttpRequestNode({
    name: 'POST to WF-0 Classifier',
    position: [1250, 300],
    method: 'POST',
    url: `${n8nBaseUrl}/webhook/classify-email`,
    headers: {
      token: wf0Token,
      'Content-Type': 'application/json',
    },
    parameters: {
      method: 'POST',
      url: `${n8nBaseUrl}/webhook/classify-email`,
      authentication: 'none',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'token', value: wf0Token },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      bodyParameters: {
        parameters: [],
      },
      options: {
        redirect: { follow: true },
        response: { response: { responseFormat: 'json' } },
      },
    },
  });
  httpRequest.continueOnFail = true;
  nodes.push(httpRequest);
  connect(connections, { node: buildPayload.name }, { node: httpRequest.name });

  // ── Node 5: Code — Build Summary ──────────────────────────────────
  const summary = createCodeNode({
    name: 'Build Summary',
    position: [1500, 300],
    jsCode: summaryNodeJs(),
  });
  nodes.push(summary);
  connect(connections, { node: httpRequest.name }, { node: summary.name });

  // ── Assemble ──────────────────────────────────────────────────────
  return createN8NWorkflow(
    `WF-4: Initial Cleanup — ${config.emailAddress}`,
    nodes,
    connections,
    {
      timezone: 'UTC',
      saveExecutionProgress: true,
      executionOrder: 'v1',
      callerPolicy: 'workflowsFromSameOwner',
    },
  );
}
