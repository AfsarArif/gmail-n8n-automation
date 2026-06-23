/**
 * spam-deleter.test.ts — Tests for the WF-3 spam deletion utilities.
 *
 * Run:  node --test --loader ts-node/esm src/code/spam-deleter.test.ts
 *   or: npm test  (once integrated into the project test runner)
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  ACCOUNTS_CONFIG,
  buildGmailSpamQuery,
  buildSummaryReport,
  accountsConfigForN8N,
  AccountType,
  SpamAccount,
  DeleteResult,
  SpamDeleteSummary,
} from './spam-deleter';

// ---------------------------------------------------------------------------
// ACCOUNTS_CONFIG
// ---------------------------------------------------------------------------

describe('ACCOUNTS_CONFIG', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(ACCOUNTS_CONFIG));
    assert.ok(ACCOUNTS_CONFIG.length > 0);
  });

  it('every account has a known account_type', () => {
    const validTypes: AccountType[] = ['gmail', 'outlook'];
    for (const account of ACCOUNTS_CONFIG) {
      assert.ok(validTypes.includes(account.account_type));
    }
  });

  it('every account has a non-empty credential_name', () => {
    for (const account of ACCOUNTS_CONFIG) {
      assert.ok(typeof account.credential_name === 'string');
      assert.ok(account.credential_name.length > 0);
    }
  });

  it('every account has a non-empty email', () => {
    for (const account of ACCOUNTS_CONFIG) {
      assert.ok(typeof account.email === 'string');
      assert.ok(account.email.length > 0);
    }
  });

  it('contains at least one Gmail and one Outlook account', () => {
    const types = ACCOUNTS_CONFIG.map((a) => a.account_type);
    assert.ok(types.includes('gmail'));
    assert.ok(types.includes('outlook'));
  });
});

// ---------------------------------------------------------------------------
// buildGmailSpamQuery
// ---------------------------------------------------------------------------

describe('buildGmailSpamQuery', () => {
  it('builds a query for 1 day', () => {
    assert.strictEqual(buildGmailSpamQuery(1), 'label:spam older_than:1d');
  });

  it('builds a query for 7 days', () => {
    assert.strictEqual(buildGmailSpamQuery(7), 'label:spam older_than:7d');
  });

  it('builds a query for 30 days', () => {
    assert.strictEqual(buildGmailSpamQuery(30), 'label:spam older_than:30d');
  });

  it('builds a query for 0 days (today only)', () => {
    assert.strictEqual(buildGmailSpamQuery(0), 'label:spam older_than:0d');
  });

  it('handles large day values', () => {
    const q = buildGmailSpamQuery(365);
    assert.ok(q.startsWith('label:spam older_than:'));
    assert.ok(q.endsWith('d'));
  });
});

// ---------------------------------------------------------------------------
// buildSummaryReport
// ---------------------------------------------------------------------------

describe('buildSummaryReport', () => {
  it('returns a valid summary from an empty results array', () => {
    const summary = buildSummaryReport([]);
    assert.strictEqual(summary.total_accounts, 0);
    assert.strictEqual(summary.total_deleted, 0);
    assert.ok(Array.isArray(summary.accounts));
    assert.strictEqual(summary.accounts.length, 0);
    // timestamp should be a valid ISO date
    assert.ok(new Date(summary.timestamp).toISOString() === summary.timestamp);
  });

  it('sums deleted_count correctly across multiple results', () => {
    const results: DeleteResult[] = [
      {
        account_type: 'gmail',
        credential_name: 'Gmail - personal@gmail.com',
        email: 'personal@gmail.com',
        deleted_count: 12,
        error: null,
      },
      {
        account_type: 'gmail',
        credential_name: 'Gmail - work@gmail.com',
        email: 'work@gmail.com',
        deleted_count: 0,
        error: null,
      },
      {
        account_type: 'outlook',
        credential_name: 'Outlook - myname@hotmail.com',
        email: 'myname@hotmail.com',
        deleted_count: 5,
        error: null,
      },
    ];

    const summary = buildSummaryReport(results);
    assert.strictEqual(summary.total_accounts, 3);
    assert.strictEqual(summary.total_deleted, 17);
    assert.strictEqual(summary.accounts.length, 3);
    assert.ok(new Date(summary.timestamp).toISOString() === summary.timestamp);
  });

  it('includes error information in the summary', () => {
    const results: DeleteResult[] = [
      {
        account_type: 'gmail',
        credential_name: 'Gmail - personal@gmail.com',
        email: 'personal@gmail.com',
        deleted_count: 0,
        error: 'Rate limit exceeded',
      },
    ];

    const summary = buildSummaryReport(results);
    assert.strictEqual(summary.total_accounts, 1);
    assert.strictEqual(summary.total_deleted, 0);
    assert.strictEqual(summary.accounts[0].error, 'Rate limit exceeded');
  });

  it('is deterministic for the same input', () => {
    const results: DeleteResult[] = [
      {
        account_type: 'gmail',
        credential_name: 'Gmail - personal@gmail.com',
        email: 'personal@gmail.com',
        deleted_count: 3,
        error: null,
      },
    ];

    const s1 = buildSummaryReport(results);
    const s2 = buildSummaryReport(results);
    assert.strictEqual(s1.total_accounts, s2.total_accounts);
    assert.strictEqual(s1.total_deleted, s2.total_deleted);
    assert.strictEqual(s1.accounts.length, s2.accounts.length);
  });
});

// ---------------------------------------------------------------------------
// accountsConfigForN8N
// ---------------------------------------------------------------------------

describe('accountsConfigForN8N', () => {
  it('returns one item per ACCOUNTS_CONFIG entry', () => {
    const items = accountsConfigForN8N();
    assert.strictEqual(items.length, ACCOUNTS_CONFIG.length);
  });

  it('each item has a { json } wrapper', () => {
    const items = accountsConfigForN8N();
    for (const item of items) {
      assert.ok('json' in item);
      assert.ok(typeof item.json === 'object');
      assert.ok('account_type' in item.json);
      assert.ok('credential_name' in item.json);
      assert.ok('email' in item.json);
    }
  });

  it('items match ACCOUNTS_CONFIG order and values', () => {
    const items = accountsConfigForN8N();
    for (let i = 0; i < ACCOUNTS_CONFIG.length; i++) {
      assert.deepStrictEqual(items[i].json, ACCOUNTS_CONFIG[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// SpamAccount interface
// ---------------------------------------------------------------------------

describe('SpamAccount', () => {
  it('conforms to the expected shape', () => {
    const account: SpamAccount = {
      account_type: 'gmail',
      credential_name: 'Gmail - test@gmail.com',
      email: 'test@gmail.com',
    };

    assert.strictEqual(account.account_type, 'gmail');
    assert.strictEqual(account.credential_name, 'Gmail - test@gmail.com');
    assert.strictEqual(account.email, 'test@gmail.com');
  });
});

// ---------------------------------------------------------------------------
// DeleteResult / SpamDeleteSummary
// ---------------------------------------------------------------------------

describe('DeleteResult and SpamDeleteSummary types', () => {
  it('DeleteResult supports error:null for success', () => {
    const r: DeleteResult = {
      account_type: 'outlook',
      credential_name: 'Outlook - test@hotmail.com',
      email: 'test@hotmail.com',
      deleted_count: 8,
      error: null,
    };
    assert.strictEqual(r.error, null);
  });

  it('DeleteResult supports an error string', () => {
    const r: DeleteResult = {
      account_type: 'outlook',
      credential_name: 'Outlook - test@hotmail.com',
      email: 'test@hotmail.com',
      deleted_count: 0,
      error: 'Authentication failed',
    };
    assert.strictEqual(r.error, 'Authentication failed');
  });

  it('SpamDeleteSummary aggregates correctly', () => {
    const summary: SpamDeleteSummary = buildSummaryReport([]);
    assert.ok(typeof summary.timestamp === 'string');
    assert.ok(typeof summary.total_accounts === 'number');
    assert.ok(typeof summary.total_deleted === 'number');
    assert.ok(Array.isArray(summary.accounts));
  });
});
