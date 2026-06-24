/**
 * initial-cleanup.test.ts — Tests for the WF-4 Initial Cleanup module.
 *
 * Run:  ts-node src/code/initial-cleanup.test.ts
 *   or: npm run test:initial-cleanup
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildGmailUnlabeledQuery,
  buildOutlookUnlabeledFilter,
  buildSummaryReport,
  payloadBuilderNodeJs,
  summaryNodeJs,
  buildCleanupWorkflow,
  DEFAULT_BATCH_SIZE,
  GMAIL_PAGE_SIZE,
  BATCH_DELAY_MS,
  CleanupStats,
  CleanupSummary,
  CleanupWorkflowConfig,
} from './initial-cleanup';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Constants', () => {
  it('DEFAULT_BATCH_SIZE is a positive integer', () => {
    assert.ok(Number.isInteger(DEFAULT_BATCH_SIZE));
    assert.ok(DEFAULT_BATCH_SIZE > 0);
  });

  it('GMAIL_PAGE_SIZE is a positive integer', () => {
    assert.ok(Number.isInteger(GMAIL_PAGE_SIZE));
    assert.ok(GMAIL_PAGE_SIZE > 0);
  });

  it('BATCH_DELAY_MS is a positive integer', () => {
    assert.ok(Number.isInteger(BATCH_DELAY_MS));
    assert.ok(BATCH_DELAY_MS > 0);
  });
});

// ---------------------------------------------------------------------------
// buildGmailUnlabeledQuery
// ---------------------------------------------------------------------------

describe('buildGmailUnlabeledQuery', () => {
  it('returns a non-empty string', () => {
    const q = buildGmailUnlabeledQuery();
    assert.ok(typeof q === 'string');
    assert.ok(q.length > 0);
  });

  it('includes "in:inbox"', () => {
    assert.ok(buildGmailUnlabeledQuery().includes('in:inbox'));
  });

  it('excludes all 7 AI/* labels', () => {
    const q = buildGmailUnlabeledQuery();
    const labels = [
      'AI/Newsletter',
      'AI/Action-Required',
      'AI/Social',
      'AI/Promotions',
      'AI/Career',
      'AI/FYI',
      'AI/Spam',
    ];
    for (const label of labels) {
      assert.ok(q.includes(`-label:${label}`), `Expected to exclude "${label}"`);
    }
  });

  it('does NOT exclude labels outside AI/*', () => {
    const q = buildGmailUnlabeledQuery();
    assert.ok(!q.includes('-label:INBOX'));
    assert.ok(!q.includes('-label:UNREAD'));
  });

  it('is deterministic', () => {
    assert.strictEqual(buildGmailUnlabeledQuery(), buildGmailUnlabeledQuery());
  });
});

// ---------------------------------------------------------------------------
// buildOutlookUnlabeledFilter
// ---------------------------------------------------------------------------

describe('buildOutlookUnlabeledFilter', () => {
  it('returns a non-empty string', () => {
    const f = buildOutlookUnlabeledFilter();
    assert.ok(typeof f === 'string');
    assert.ok(f.length > 0);
  });

  it('filters out categories starting with AI-', () => {
    const f = buildOutlookUnlabeledFilter();
    assert.ok(f.includes("startswith(c,'AI-')"));
  });

  it('uses "not" to negate the any clause', () => {
    const f = buildOutlookUnlabeledFilter();
    assert.ok(f.startsWith('not '));
  });

  it('is deterministic', () => {
    assert.strictEqual(
      buildOutlookUnlabeledFilter(),
      buildOutlookUnlabeledFilter(),
    );
  });
});

// ---------------------------------------------------------------------------
// buildSummaryReport
// ---------------------------------------------------------------------------

describe('buildSummaryReport', () => {
  it('returns a valid summary from an empty results array', () => {
    const summary = buildSummaryReport([]);
    assert.strictEqual(summary.total_accounts, 0);
    assert.strictEqual(summary.total_fetched, 0);
    assert.strictEqual(summary.total_classified, 0);
    assert.strictEqual(summary.total_errors, 0);
    assert.strictEqual(summary.duration_seconds, 0);
    assert.ok(Array.isArray(summary.accounts));
    assert.strictEqual(summary.accounts.length, 0);
    assert.ok(new Date(summary.timestamp).toISOString() === summary.timestamp);
  });

  it('sums counters correctly across multiple results', () => {
    const results: CleanupStats[] = [
      {
        account_type: 'gmail',
        email_address: 'a@gmail.com',
        credential_name: 'Gmail - a@gmail.com',
        total_fetched: 50,
        total_classified: 48,
        total_errors: 2,
        categories: { newsletter: 10, action: 5, fyi: 20, social: 8, spam: 5 },
        started_at: '2026-06-23T10:00:00.000Z',
        completed_at: '2026-06-23T10:05:00.000Z',
      },
      {
        account_type: 'gmail',
        email_address: 'b@gmail.com',
        credential_name: 'Gmail - b@gmail.com',
        total_fetched: 30,
        total_classified: 30,
        total_errors: 0,
        categories: { promotions: 15, career: 5, fyi: 10 },
        started_at: '2026-06-23T10:02:00.000Z',
        completed_at: '2026-06-23T10:04:00.000Z',
      },
    ];

    const summary = buildSummaryReport(results);
    assert.strictEqual(summary.total_accounts, 2);
    assert.strictEqual(summary.total_fetched, 80);
    assert.strictEqual(summary.total_classified, 78);
    assert.strictEqual(summary.total_errors, 2);
    assert.strictEqual(summary.accounts.length, 2);
  });

  it('merges category counts across accounts', () => {
    const results: CleanupStats[] = [
      {
        account_type: 'gmail',
        email_address: 'a@gmail.com',
        credential_name: 'Gmail - a@gmail.com',
        total_fetched: 10,
        total_classified: 10,
        total_errors: 0,
        categories: { newsletter: 3, spam: 2 },
        started_at: '2026-06-23T10:00:00.000Z',
        completed_at: '2026-06-23T10:01:00.000Z',
      },
      {
        account_type: 'gmail',
        email_address: 'b@gmail.com',
        credential_name: 'Gmail - b@gmail.com',
        total_fetched: 10,
        total_classified: 10,
        total_errors: 0,
        categories: { newsletter: 4, action: 1 },
        started_at: '2026-06-23T10:00:00.000Z',
        completed_at: '2026-06-23T10:01:00.000Z',
      },
    ];

    const summary = buildSummaryReport(results);
    assert.strictEqual(summary.categories['newsletter'], 7);
    assert.strictEqual(summary.categories['spam'], 2);
    assert.strictEqual(summary.categories['action'], 1);
  });

  it('includes error information in the summary', () => {
    const results: CleanupStats[] = [
      {
        account_type: 'gmail',
        email_address: 'fail@gmail.com',
        credential_name: 'Gmail - fail@gmail.com',
        total_fetched: 100,
        total_classified: 0,
        total_errors: 100,
        categories: {},
        started_at: '2026-06-23T10:00:00.000Z',
        completed_at: null,
      },
    ];

    const summary = buildSummaryReport(results);
    assert.strictEqual(summary.total_accounts, 1);
    assert.strictEqual(summary.total_classified, 0);
    assert.strictEqual(summary.total_errors, 100);
    assert.strictEqual(summary.accounts[0].completed_at, null);
  });

  it('computes duration from earliest start to latest completion', () => {
    const results: CleanupStats[] = [
      {
        account_type: 'gmail',
        email_address: 'a@gmail.com',
        credential_name: 'Gmail - a@gmail.com',
        total_fetched: 10,
        total_classified: 10,
        total_errors: 0,
        categories: { fyi: 10 },
        started_at: '2026-06-23T10:00:00.000Z',
        completed_at: '2026-06-23T10:02:00.000Z',
      },
      {
        account_type: 'gmail',
        email_address: 'b@gmail.com',
        credential_name: 'Gmail - b@gmail.com',
        total_fetched: 10,
        total_classified: 10,
        total_errors: 0,
        categories: { fyi: 10 },
        started_at: '2026-06-23T09:59:00.000Z',
        completed_at: '2026-06-23T10:03:00.000Z',
      },
    ];

    const summary = buildSummaryReport(results);
    // 09:59 to 10:03 = 4 minutes = 240 seconds
    assert.strictEqual(summary.duration_seconds, 240);
  });

  it('is deterministic for the same input', () => {
    const results: CleanupStats[] = [
      {
        account_type: 'gmail',
        email_address: 'test@gmail.com',
        credential_name: 'Gmail - test@gmail.com',
        total_fetched: 5,
        total_classified: 5,
        total_errors: 0,
        categories: { action: 3, fyi: 2 },
        started_at: '2026-06-23T10:00:00.000Z',
        completed_at: '2026-06-23T10:01:00.000Z',
      },
    ];

    const s1 = buildSummaryReport(results);
    const s2 = buildSummaryReport(results);
    assert.strictEqual(s1.total_accounts, s2.total_accounts);
    assert.strictEqual(s1.total_fetched, s2.total_fetched);
    assert.strictEqual(s1.total_classified, s2.total_classified);
    assert.strictEqual(s1.duration_seconds, s2.duration_seconds);
  });

  it('handles results with null completed_at gracefully', () => {
    const results: CleanupStats[] = [
      {
        account_type: 'gmail',
        email_address: 'a@gmail.com',
        credential_name: 'Gmail - a@gmail.com',
        total_fetched: 10,
        total_classified: 0,
        total_errors: 10,
        categories: {},
        started_at: '2026-06-23T10:00:00.000Z',
        completed_at: null,
      },
    ];

    const summary = buildSummaryReport(results);
    assert.strictEqual(summary.total_classified, 0);
    assert.strictEqual(summary.total_errors, 10);
    // Duration should be 0 when no completions
    assert.strictEqual(summary.duration_seconds, 0);
  });
});

// ---------------------------------------------------------------------------
// payloadBuilderNodeJs
// ---------------------------------------------------------------------------

describe('payloadBuilderNodeJs', () => {
  it('returns a non-empty string', () => {
    const js = payloadBuilderNodeJs();
    assert.ok(typeof js === 'string');
    assert.ok(js.length > 0);
  });

  it('contains $input.first() usage', () => {
    assert.ok(payloadBuilderNodeJs().includes('$input.first()'));
  });

  it('contains WebhookInputPayload field mappings', () => {
    const js = payloadBuilderNodeJs();
    assert.ok(js.includes('account_type'));
    assert.ok(js.includes('email_address'));
    assert.ok(js.includes('message_id'));
    assert.ok(js.includes('thread_id'));
    assert.ok(js.includes('subject'));
    assert.ok(js.includes('from'));
    assert.ok(js.includes('body_html'));
    assert.ok(js.includes('body_text'));
    assert.ok(js.includes('snippet'));
    assert.ok(js.includes('credential_name'));
  });

  it('returns valid JavaScript (parseable with Function constructor)', () => {
    const js = payloadBuilderNodeJs();
    // Should not throw
    new Function(js);
  });
});

// ---------------------------------------------------------------------------
// summaryNodeJs
// ---------------------------------------------------------------------------

describe('summaryNodeJs', () => {
  it('returns a non-empty string', () => {
    const js = summaryNodeJs();
    assert.ok(typeof js === 'string');
    assert.ok(js.length > 0);
  });

  it('contains $input.all() usage', () => {
    assert.ok(summaryNodeJs().includes('$input.all()'));
  });

  it('tracks key CleanupStats fields', () => {
    const js = summaryNodeJs();
    assert.ok(js.includes('total_classified'));
    assert.ok(js.includes('total_errors'));
    assert.ok(js.includes('total_fetched'));
    assert.ok(js.includes('categories'));
  });

  it('returns valid JavaScript (parseable with Function constructor)', () => {
    const js = summaryNodeJs();
    new Function(js);
  });
});

// ---------------------------------------------------------------------------
// buildCleanupWorkflow
// ---------------------------------------------------------------------------

describe('buildCleanupWorkflow', () => {
  const config: CleanupWorkflowConfig = {
    credentialName: 'Gmail - test@gmail.com',
    emailAddress: 'test@gmail.com',
    n8nBaseUrl: 'http://localhost:5678',
    wf0Token: 'test-token-123',
  };

  it('returns a valid N8NWorkflow object', () => {
    const wf = buildCleanupWorkflow(config);
    assert.ok(typeof wf === 'object');
    assert.ok(typeof wf.name === 'string');
    assert.ok(Array.isArray(wf.nodes));
    assert.ok(typeof wf.connections === 'object');
    assert.ok(typeof wf.settings === 'object');
  });

  it('has the correct workflow name including email address', () => {
    const wf = buildCleanupWorkflow(config);
    assert.ok(wf.name.includes('WF-4'));
    assert.ok(wf.name.includes('Initial Cleanup'));
    assert.ok(wf.name.includes(config.emailAddress));
  });

  it('contains exactly 6 nodes', () => {
    const wf = buildCleanupWorkflow(config);
    assert.strictEqual(wf.nodes.length, 6);
  });

  it('includes a Webhook trigger node', () => {
    const wf = buildCleanupWorkflow(config);
    const node = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
    assert.ok(node, 'Expected a Webhook trigger node');
    assert.strictEqual(node!.typeVersion, 2);
  });

  it('includes a Gmail node with getMany operation', () => {
    const wf = buildCleanupWorkflow(config);
    const node = wf.nodes.find((n) => n.type === 'n8n-nodes-base.gmail');
    assert.ok(node, 'Expected a Gmail node');
    assert.strictEqual(node!.parameters.operation, 'getMany');
    assert.strictEqual(node!.parameters.resource, 'message');
  });

  it('Gmail node uses the correct credential', () => {
    const wf = buildCleanupWorkflow(config);
    const node = wf.nodes.find((n) => n.type === 'n8n-nodes-base.gmail')!;
    assert.ok(node.credentials);
    assert.strictEqual(
      node.credentials!.gmailOAuth2.name,
      config.credentialName,
    );
  });

  it('Gmail node query excludes AI/* labels', () => {
    const wf = buildCleanupWorkflow(config);
    const node = wf.nodes.find((n) => n.type === 'n8n-nodes-base.gmail')!;
    const query: string = node.parameters.query as string;
    assert.ok(query.includes('-label:AI/Newsletter'));
    assert.ok(query.includes('-label:AI/Spam'));
    assert.ok(query.includes('in:inbox'));
  });

  it('Gmail node has simple: true for flat response format', () => {
    const wf = buildCleanupWorkflow(config);
    const node = wf.nodes.find((n) => n.type === 'n8n-nodes-base.gmail')!;
    assert.strictEqual(node.parameters.simple, true);
  });

  it('includes a Split In Batches node', () => {
    const wf = buildCleanupWorkflow(config);
    const node = wf.nodes.find(
      (n) => n.type === 'n8n-nodes-base.splitInBatches',
    );
    assert.ok(node, 'Expected a Split In Batches node');
    assert.strictEqual(node!.parameters.batchSize, DEFAULT_BATCH_SIZE);
  });

  it('respects custom batchSize config', () => {
    const wf = buildCleanupWorkflow({ ...config, batchSize: 25 });
    const node = wf.nodes.find(
      (n) => n.type === 'n8n-nodes-base.splitInBatches',
    )!;
    assert.strictEqual(node.parameters.batchSize, 25);
  });

  it('includes two Code nodes', () => {
    const wf = buildCleanupWorkflow(config);
    const codeNodes = wf.nodes.filter(
      (n) => n.type === 'n8n-nodes-base.code',
    );
    assert.strictEqual(codeNodes.length, 2);
  });

  it('first Code node is Build WF-0 Payload', () => {
    const wf = buildCleanupWorkflow(config);
    const codeNodes = wf.nodes.filter(
      (n) => n.type === 'n8n-nodes-base.code',
    );
    assert.ok(codeNodes[0].name.includes('Build WF-0 Payload'));
    assert.ok(codeNodes[0].parameters.jsCode);
  });

  it('second Code node is Build Summary', () => {
    const wf = buildCleanupWorkflow(config);
    const codeNodes = wf.nodes.filter(
      (n) => n.type === 'n8n-nodes-base.code',
    );
    assert.ok(codeNodes[1].name.includes('Build Summary'));
    assert.ok(codeNodes[1].parameters.jsCode);
  });

  it('includes an HTTP Request node', () => {
    const wf = buildCleanupWorkflow(config);
    const node = wf.nodes.find(
      (n) => n.type === 'n8n-nodes-base.httpRequest',
    );
    assert.ok(node, 'Expected an HTTP Request node');
    assert.strictEqual(node!.parameters.method, 'POST');
  });

  it('HTTP Request node targets WF-0 webhook URL', () => {
    const wf = buildCleanupWorkflow(config);
    const node = wf.nodes.find(
      (n) => n.type === 'n8n-nodes-base.httpRequest',
    )!;
    const url: string = node.parameters.url as string;
    assert.ok(url.includes('/webhook/classify-email'));
    assert.ok(url.includes('localhost:5678'));
  });

  it('has all required connections', () => {
    const wf = buildCleanupWorkflow(config);
    const conns = wf.connections;
    assert.ok(Object.keys(conns).length >= 5, 'Expected at least 5 connections');
  });

  it('uses $env defaults when n8nBaseUrl and wf0Token are omitted', () => {
    const wf = buildCleanupWorkflow({
      credentialName: 'Gmail - test@gmail.com',
      emailAddress: 'test@gmail.com',
    });
    const node = wf.nodes.find(
      (n) => n.type === 'n8n-nodes-base.httpRequest',
    )!;
    const url: string = node.parameters.url as string;
    assert.ok(url.includes('$env.N8N_BASE_URL'));
  });
});

// ---------------------------------------------------------------------------
// Type conformance
// ---------------------------------------------------------------------------

describe('CleanupStats type', () => {
  it('conforms to the expected shape', () => {
    const stats: CleanupStats = {
      account_type: 'gmail',
      email_address: 'test@gmail.com',
      credential_name: 'Gmail - test@gmail.com',
      total_fetched: 100,
      total_classified: 98,
      total_errors: 2,
      categories: { newsletter: 30, action: 10, fyi: 50, spam: 8 },
      started_at: '2026-06-23T10:00:00.000Z',
      completed_at: '2026-06-23T10:05:00.000Z',
    };

    assert.strictEqual(stats.account_type, 'gmail');
    assert.strictEqual(stats.total_fetched, 100);
    assert.ok(stats.categories['spam'] === 8);
  });

  it('supports outlook account_type', () => {
    const stats: CleanupStats = {
      account_type: 'outlook',
      email_address: 'test@hotmail.com',
      credential_name: 'Outlook - test@hotmail.com',
      total_fetched: 50,
      total_classified: 50,
      total_errors: 0,
      categories: {},
      started_at: '2026-06-23T10:00:00.000Z',
      completed_at: '2026-06-23T10:02:00.000Z',
    };

    assert.strictEqual(stats.account_type, 'outlook');
  });
});

describe('CleanupSummary type', () => {
  it('aggregates correctly from CleanupStats array', () => {
    const summary: CleanupSummary = buildSummaryReport([]);
    assert.ok(typeof summary.timestamp === 'string');
    assert.ok(typeof summary.total_accounts === 'number');
    assert.ok(typeof summary.total_fetched === 'number');
    assert.ok(typeof summary.total_classified === 'number');
    assert.ok(typeof summary.total_errors === 'number');
    assert.ok(typeof summary.duration_seconds === 'number');
    assert.ok(Array.isArray(summary.accounts));
    assert.ok(typeof summary.categories === 'object');
  });
});
