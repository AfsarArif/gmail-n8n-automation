/**
 * spam-deleter.ts — Shared utilities for WF-3 Daily Spam Deletion
 *
 * Provides account configuration, Gmail spam query builders, and
 * summary report generation consumed by the N8N workflows and tests.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported email account providers. */
export type AccountType = 'gmail' | 'outlook';

/** A single account registered for spam deletion. */
export interface SpamAccount {
  account_type: AccountType;
  /** N8N credential name — must match exactly the credential label in N8N. */
  credential_name: string;
  email: string;
}

/** Per-account deletion result emitted after processing one account. */
export interface DeleteResult {
  account_type: AccountType;
  credential_name: string;
  email: string;
  /** Number of messages permanently deleted. */
  deleted_count: number;
  /** Whether any error occurred for this account. */
  error: string | null;
}

/** Aggregate summary returned by the final Code / Set node in WF-3. */
export interface SpamDeleteSummary {
  timestamp: string;
  total_accounts: number;
  total_deleted: number;
  accounts: DeleteResult[];
}

// ---------------------------------------------------------------------------
// Account Configuration
// ---------------------------------------------------------------------------

/**
 * Registered accounts for daily spam deletion.
 *
 * IMPORTANT — The `credential_name` value must match the N8N credential
 * label exactly. Update these whenever accounts are added or removed.
 */
export const ACCOUNTS_CONFIG: SpamAccount[] = [
  {
    account_type: 'gmail',
    credential_name: 'Gmail - personal@gmail.com',
    email: 'personal@gmail.com',
  },
  {
    account_type: 'gmail',
    credential_name: 'Gmail - work@gmail.com',
    email: 'work@gmail.com',
  },
  {
    account_type: 'outlook',
    credential_name: 'Outlook - myname@hotmail.com',
    email: 'myname@hotmail.com',
  },
];

// ---------------------------------------------------------------------------
// Gmail Spam Query Builder
// ---------------------------------------------------------------------------

/**
 * Build a Gmail search query that selects spam messages older than the given
 * number of days.
 *
 * N8N Gmail node query examples:
 *   buildGmailSpamQuery(1)  → "label:spam older_than:1d"
 *   buildGmailSpamQuery(3)  → "label:spam older_than:3d"
 */
export function buildGmailSpamQuery(olderThanDays: number): string {
  return `label:spam older_than:${olderThanDays}d`;
}

// ---------------------------------------------------------------------------
// Summary Report Builder
// ---------------------------------------------------------------------------

/**
 * Aggregate per-account deletion results into a single summary object
 * suitable for the final node in WF-3.
 */
export function buildSummaryReport(results: DeleteResult[]): SpamDeleteSummary {
  const total_deleted = results.reduce((sum, r) => sum + r.deleted_count, 0);

  return {
    timestamp: new Date().toISOString(),
    total_accounts: results.length,
    total_deleted,
    accounts: results,
  };
}

// ---------------------------------------------------------------------------
// Helpers for N8N Code nodes (mirrors what is pasted into the workflow)
// ---------------------------------------------------------------------------

/**
 * Returns the accounts config as an array of items suitable for the
 * "Code → Accounts Config" node output in N8N.
 *
 * Each item is `{ json: SpamAccount }` so the Split In Batches and
 * downstream nodes receive the account object at `$json`.
 */
export function accountsConfigForN8N(): Array<{ json: SpamAccount }> {
  return ACCOUNTS_CONFIG.map((account) => ({ json: account }));
}
