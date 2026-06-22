/**
 * env.ts
 *
 * Typed, validated configuration loader for the gmail-n8n-automation
 * project.  Reads from process.env (populated by dotenv or similar at
 * startup) and returns a fully validated `AppConfig` object.
 *
 * Any missing required field or invalid value throws early so the
 * application fails fast rather than misbehaving silently.
 */

// ---------------------------------------------------------------------------
// AppConfig interface
// ---------------------------------------------------------------------------

export interface AppConfig {
  /** N8N instance base URL, e.g. https://n8n.example.com */
  n8nBaseUrl: string;
  /** Shared secret token for webhook authentication (WF-0). */
  wf0SecretToken: string;

  // --- DeepSeek -----------------------------------------------------------
  /** Model identifier, e.g. "deepseek-chat". */
  deepseekModel: string;
  /** API key for the DeepSeek OpenAI-compatible endpoint. */
  deepseekApiKey: string;
  /** Base URL for the DeepSeek API (defaults to https://api.deepseek.com/v1). */
  deepseekBaseUrl: string;
  /** LLM temperature (0-2). */
  deepseekTemperature: number;
  /** Maximum completion tokens. */
  deepseekMaxTokens: number;

  // --- Gmail accounts -----------------------------------------------------
  /** Comma-separated list of Gmail addresses. */
  gmailAccounts: string[];
  /** Comma-separated list of corresponding N8N credential names. */
  gmailCredentialNames: string[];

  // --- Outlook / Hotmail accounts -----------------------------------------
  /** Comma-separated list of Outlook/Hotmail addresses. */
  outlookAccounts: string[];
  /** Comma-separated list of corresponding N8N credential names. */
  outlookCredentialNames: string[];

  // --- Classification -----------------------------------------------------
  /** Whether the sender-domain pre-classifier is enabled. */
  preClassifierEnabled: boolean;
  /** Default category when classification fails. */
  defaultFallbackCategory: string;
  /** Skip AI call when an AI/* label already exists on the message. */
  skipAiIfLabeled: boolean;

  // --- Spam deletion schedule ---------------------------------------------
  /** Cron expression for daily spam-deletion run. */
  spamDeleteScheduleCron: string;
  /** Number of messages to delete per batch. */
  spamDeleteBatchSize: number;
  /** Only delete spam older than this many days. */
  spamOlderThanDays: number;

  // --- Polling ------------------------------------------------------------
  /** Poll interval in minutes for Gmail triggers. */
  gmailPollIntervalMinutes: number;
  /** Poll interval in minutes for Outlook triggers. */
  outlookPollIntervalMinutes: number;

  // --- Rate limits (informational — used by rate-limiter module) ----------
  /** Gmail quota units per second. */
  gmailRateLimitQps: number;
  /** Microsoft Graph requests per 10-minute window. */
  outlookRateLimitPer10Min: number;

  // --- Retry --------------------------------------------------------------
  /** Maximum retry attempts for transient failures. */
  maxRetries: number;
  /** Delay between retries in milliseconds. */
  retryDelayMs: number;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set([
  'newsletter',
  'action',
  'social',
  'promotions',
  'career',
  'fyi',
  'spam',
]);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function parseUrl(name: string): string {
  const value = required(name);
  try {
    new URL(value);
  } catch {
    throw new Error(
      `Invalid URL for ${name}: "${value}". Must be a valid absolute URL.`,
    );
  }
  return value;
}

function parseNumber(
  name: string,
  min: number,
  max: number,
  defaultValue?: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required numeric environment variable: ${name}`);
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${name}: "${raw}"`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(
      `${name} must be between ${min} and ${max}, got ${parsed}`,
    );
  }
  return parsed;
}

function parseBoolean(name: string, defaultValue?: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required boolean environment variable: ${name}`);
  }
  const lower = raw.trim().toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  throw new Error(`Invalid boolean for ${name}: "${raw}". Use true/false.`);
}

function parseList(name: string): string[] {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Configuration loader
// ---------------------------------------------------------------------------

/**
 * Read, parse, and validate all configuration from `process.env`.
 *
 * Throws on the first invalid field with a descriptive message so the
 * operator can fix the problem immediately.
 */
export function getConfig(): AppConfig {
  const n8nBaseUrl = parseUrl('N8N_BASE_URL');
  const wf0SecretToken = required('WF0_SECRET_TOKEN');

  const deepseekModel = required('DEEPSEEK_MODEL');
  const deepseekApiKey = required('DEEPSEEK_API_KEY');
  const deepseekBaseUrl = process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/v1';
  const deepseekTemperature = parseNumber('DEEPSEEK_TEMPERATURE', 0, 2, 0);
  const deepseekMaxTokens = parseNumber('DEEPSEEK_MAX_TOKENS', 1, 8192, 50);

  const gmailAccounts = parseList('GMAIL_ACCOUNTS');
  const gmailCredentialNames = parseList('GMAIL_CREDENTIAL_NAMES');
  if (gmailAccounts.length !== gmailCredentialNames.length) {
    throw new Error(
      `GMAIL_ACCOUNTS (${gmailAccounts.length} entries) and GMAIL_CREDENTIAL_NAMES (${gmailCredentialNames.length} entries) must have the same length`,
    );
  }

  const outlookAccounts = parseList('OUTLOOK_ACCOUNTS');
  const outlookCredentialNames = parseList('OUTLOOK_CREDENTIAL_NAMES');
  if (outlookAccounts.length !== outlookCredentialNames.length) {
    throw new Error(
      `OUTLOOK_ACCOUNTS (${outlookAccounts.length} entries) and OUTLOOK_CREDENTIAL_NAMES (${outlookCredentialNames.length} entries) must have the same length`,
    );
  }

  const preClassifierEnabled = parseBoolean('PRE_CLASSIFIER_ENABLED', true);
  const defaultFallbackCategory = process.env.DEFAULT_FALLBACK_CATEGORY?.trim() || 'fyi';
  if (!VALID_CATEGORIES.has(defaultFallbackCategory)) {
    throw new Error(
      `DEFAULT_FALLBACK_CATEGORY "${defaultFallbackCategory}" is not a valid category. Must be one of: ${[...VALID_CATEGORIES].join(', ')}`,
    );
  }
  const skipAiIfLabeled = parseBoolean('SKIP_AI_IF_LABELED', true);

  const spamDeleteScheduleCron =
    process.env.SPAM_DELETE_SCHEDULE_CRON?.trim() || '59 23 * * *';
  const spamDeleteBatchSize = parseNumber('SPAM_DELETE_BATCH_SIZE', 1, 500, 50);
  const spamOlderThanDays = parseNumber('SPAM_OLDER_THAN_DAYS', 0, 365, 1);

  const gmailPollIntervalMinutes = parseNumber('GMAIL_POLL_INTERVAL_MINUTES', 1, 60, 1);
  const outlookPollIntervalMinutes = parseNumber('OUTLOOK_POLL_INTERVAL_MINUTES', 1, 60, 1);

  const gmailRateLimitQps = parseNumber('GMAIL_RATE_LIMIT_QPS', 1, 1000, 250);
  const outlookRateLimitPer10Min = parseNumber('OUTLOOK_RATE_LIMIT_PER_10MIN', 1, 50000, 10000);

  const maxRetries = parseNumber('MAX_RETRIES', 0, 10, 3);
  const retryDelayMs = parseNumber('RETRY_DELAY_MS', 100, 60_000, 2000);

  return {
    n8nBaseUrl,
    wf0SecretToken,
    deepseekModel,
    deepseekApiKey,
    deepseekBaseUrl,
    deepseekTemperature,
    deepseekMaxTokens,
    gmailAccounts,
    gmailCredentialNames,
    outlookAccounts,
    outlookCredentialNames,
    preClassifierEnabled,
    defaultFallbackCategory,
    skipAiIfLabeled,
    spamDeleteScheduleCron,
    spamDeleteBatchSize,
    spamOlderThanDays,
    gmailPollIntervalMinutes,
    outlookPollIntervalMinutes,
    gmailRateLimitQps,
    outlookRateLimitPer10Min,
    maxRetries,
    retryDelayMs,
  };
}
