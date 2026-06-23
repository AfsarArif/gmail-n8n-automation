/**
 * Account configuration module.
 *
 * Reads a flat list of accounts from environment variables so N8N workflow
 * instances can be generated or validated programmatically.
 *
 * Environment variables expected:
 *   GMAIL_ACCOUNTS            comma-separated email addresses
 *   GMAIL_CREDENTIAL_NAMES    comma-separated N8N credential names (1:1 order)
 *   OUTLOOK_ACCOUNTS          comma-separated email addresses
 *   OUTLOOK_CREDENTIAL_NAMES  comma-separated N8N credential names (1:1 order)
 *
 * Example:
 *   GMAIL_ACCOUNTS=personal@gmail.com,work@gmail.com
 *   GMAIL_CREDENTIAL_NAMES=Gmail - personal@gmail.com,Gmail - work@gmail.com
 */

export interface AccountConfig {
  accountType: 'gmail' | 'outlook';
  credentialName: string;
  emailAddress: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseAccounts(
  accountType: 'gmail' | 'outlook',
  emailsEnv: string | undefined,
  credentialsEnv: string | undefined,
): AccountConfig[] {
  const emails = parseCsv(emailsEnv);
  const credentials = parseCsv(credentialsEnv);

  if (emails.length !== credentials.length) {
    throw new Error(
      `Mismatched ${accountType} account config: ` +
        `${emails.length} email(s) but ${credentials.length} credential name(s). ` +
        `Check ${accountType.toUpperCase()}_ACCOUNTS and ${accountType.toUpperCase()}_CREDENTIAL_NAMES.`,
    );
  }

  return emails.map((email, i) => ({
    accountType,
    credentialName: credentials[i],
    emailAddress: email,
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns every configured account (Gmail + Outlook combined).
 *
 * Environment variables read:
 * - GMAIL_ACCOUNTS, GMAIL_CREDENTIAL_NAMES
 * - OUTLOOK_ACCOUNTS, OUTLOOK_CREDENTIAL_NAMES
 */
export function getAccounts(): AccountConfig[] {
  return [
    ...parseAccounts(
      'gmail',
      process.env.GMAIL_ACCOUNTS,
      process.env.GMAIL_CREDENTIAL_NAMES,
    ),
    ...parseAccounts(
      'outlook',
      process.env.OUTLOOK_ACCOUNTS,
      process.env.OUTLOOK_CREDENTIAL_NAMES,
    ),
  ];
}

/** Convenience: only Gmail accounts. */
export function getGmailAccounts(): AccountConfig[] {
  return parseAccounts(
    'gmail',
    process.env.GMAIL_ACCOUNTS,
    process.env.GMAIL_CREDENTIAL_NAMES,
  );
}

/** Convenience: only Outlook accounts. */
export function getOutlookAccounts(): AccountConfig[] {
  return parseAccounts(
    'outlook',
    process.env.OUTLOOK_ACCOUNTS,
    process.env.OUTLOOK_CREDENTIAL_NAMES,
  );
}
