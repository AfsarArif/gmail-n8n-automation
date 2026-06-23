/**
 * Tests for account-config.ts
 *
 * Run with:  npx ts-node src/code/account-config.test.ts
 * or via:    npm test
 */

import * as assert from 'assert';
import { getAccounts, getGmailAccounts, getOutlookAccounts } from './account-config';
import type { AccountConfig } from './account-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
  }
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Empty / no env
// ---------------------------------------------------------------------------

withEnv(
  {
    GMAIL_ACCOUNTS: undefined,
    GMAIL_CREDENTIAL_NAMES: undefined,
    OUTLOOK_ACCOUNTS: undefined,
    OUTLOOK_CREDENTIAL_NAMES: undefined,
  },
  () => {
    const all = getAccounts();
    assert.deepStrictEqual(all, [], 'no env → empty accounts');

    const gmail = getGmailAccounts();
    assert.deepStrictEqual(gmail, [], 'no env → empty gmail');

    const outlook = getOutlookAccounts();
    assert.deepStrictEqual(outlook, [], 'no env → empty outlook');
  },
);

// ---------------------------------------------------------------------------
// Single Gmail account
// ---------------------------------------------------------------------------

withEnv(
  {
    GMAIL_ACCOUNTS: 'personal@gmail.com',
    GMAIL_CREDENTIAL_NAMES: 'Gmail - personal@gmail.com',
    OUTLOOK_ACCOUNTS: undefined,
    OUTLOOK_CREDENTIAL_NAMES: undefined,
  },
  () => {
    const gmail = getGmailAccounts();
    assert.strictEqual(gmail.length, 1);
    assert.deepStrictEqual(gmail[0], {
      accountType: 'gmail',
      credentialName: 'Gmail - personal@gmail.com',
      emailAddress: 'personal@gmail.com',
    });

    const all = getAccounts();
    assert.strictEqual(all.length, 1);
  },
);

// ---------------------------------------------------------------------------
// Multiple Gmail + Outlook accounts
// ---------------------------------------------------------------------------

withEnv(
  {
    GMAIL_ACCOUNTS: 'personal@gmail.com,work@gmail.com',
    GMAIL_CREDENTIAL_NAMES:
      'Gmail - personal@gmail.com,Gmail - work@gmail.com',
    OUTLOOK_ACCOUNTS: 'myname@hotmail.com',
    OUTLOOK_CREDENTIAL_NAMES: 'Outlook - myname@hotmail.com',
  },
  () => {
    const all = getAccounts();
    assert.strictEqual(all.length, 3, '2 Gmail + 1 Outlook = 3');

    const gmail = getGmailAccounts();
    assert.strictEqual(gmail.length, 2);
    assert.strictEqual(gmail[0].emailAddress, 'personal@gmail.com');
    assert.strictEqual(gmail[1].emailAddress, 'work@gmail.com');

    const outlook = getOutlookAccounts();
    assert.strictEqual(outlook.length, 1);
    assert.strictEqual(outlook[0].accountType, 'outlook');
    assert.strictEqual(outlook[0].emailAddress, 'myname@hotmail.com');
  },
);

// ---------------------------------------------------------------------------
// Whitespace trimming
// ---------------------------------------------------------------------------

withEnv(
  {
    GMAIL_ACCOUNTS: '  a@b.com , c@d.com  ',
    GMAIL_CREDENTIAL_NAMES: 'Cred A, Cred C',
    OUTLOOK_ACCOUNTS: undefined,
    OUTLOOK_CREDENTIAL_NAMES: undefined,
  },
  () => {
    const gmail = getGmailAccounts();
    assert.strictEqual(gmail.length, 2);
    assert.strictEqual(gmail[0].emailAddress, 'a@b.com');
    assert.strictEqual(gmail[1].emailAddress, 'c@d.com');
  },
);

// ---------------------------------------------------------------------------
// Mismatch error
// ---------------------------------------------------------------------------

withEnv(
  {
    GMAIL_ACCOUNTS: 'a@b.com,c@d.com',
    GMAIL_CREDENTIAL_NAMES: 'Only One Cred',
    OUTLOOK_ACCOUNTS: undefined,
    OUTLOOK_CREDENTIAL_NAMES: undefined,
  },
  () => {
    assert.throws(
      () => getGmailAccounts(),
      /Mismatched gmail account config/,
      'mismatched counts should throw',
    );
  },
);

// ---------------------------------------------------------------------------
// Empty strings treated as no accounts
// ---------------------------------------------------------------------------

withEnv(
  {
    GMAIL_ACCOUNTS: '',
    GMAIL_CREDENTIAL_NAMES: '',
    OUTLOOK_ACCOUNTS: '',
    OUTLOOK_CREDENTIAL_NAMES: '',
  },
  () => {
    const all = getAccounts();
    assert.deepStrictEqual(all, [], 'empty strings → empty');
  },
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('✅ All account-config tests passed.');
