/**
 * error-handler.ts
 *
 * Centralised error classification and retry-configuration for the
 * gmail-n8n-automation project.  Every piece of code that can fail should
 * funnel through `classifyError` so we get consistent handling of transient
 * vs permanent failures.
 */

// ---------------------------------------------------------------------------
// Error category enum
// ---------------------------------------------------------------------------

export enum ErrorCategory {
  /** DeepSeek API timed out (transient). */
  DEEPSEEK_TIMEOUT = 'DEEPSEEK_TIMEOUT',
  /** DeepSeek returned a response that could not be parsed as valid JSON. */
  DEEPSEEK_INVALID_JSON = 'DEEPSEEK_INVALID_JSON',
  /** Gmail API 429 or quota-exceeded response (transient). */
  GMAIL_RATE_LIMIT = 'GMAIL_RATE_LIMIT',
  /** Outlook OAuth2 token has expired and needs refresh. */
  OUTLOOK_AUTH_EXPIRED = 'OUTLOOK_AUTH_EXPIRED',
  /** Deduplication logic failed (likely configuration). */
  DEDUP_FAILED = 'DEDUP_FAILED',
  /** Generic network error (DNS, connection refused, etc.). */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** Catch-all for uncategorised errors. */
  UNKNOWN = 'UNKNOWN',
}

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

export interface RetryConfig {
  maxRetries: number;
  delayMs: number;
}

/**
 * Retryable categories — transient failures that may succeed on a retry.
 */
const RETRYABLE_CATEGORIES = new Set<ErrorCategory>([
  ErrorCategory.DEEPSEEK_TIMEOUT,
  ErrorCategory.GMAIL_RATE_LIMIT,
  ErrorCategory.NETWORK_ERROR,
]);

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify an arbitrary thrown value into an `ErrorCategory`.
 *
 * The function inspects error messages, HTTP status codes, and known
 * property shapes to determine the most specific category.
 */
export function classifyError(error: unknown): ErrorCategory {
  // Normalise to a string we can pattern-match against.
  const msg: string = extractMessage(error);

  // --- DeepSeek-specific ---
  if (/(timed?\s*out|ETIMEDOUT|ECONNABORTED)/i.test(msg)) {
    return ErrorCategory.DEEPSEEK_TIMEOUT;
  }
  if (/invalid\s*json/i.test(msg) || /JSON\s*(parse|parser)/i.test(msg)) {
    return ErrorCategory.DEEPSEEK_INVALID_JSON;
  }

  // --- Gmail rate limit ---
  if (
    /429|rate.?limit|quota.?exceeded|user-rate-limit-exceeded/i.test(msg)
  ) {
    return ErrorCategory.GMAIL_RATE_LIMIT;
  }

  // --- Outlook auth ---
  if (
    /(oauth|auth).*expire|token.*expire|401.*unauthorized|invalid_grant/i.test(msg)
  ) {
    // Be conservative — only classify as OUTLOOK_AUTH_EXPIRED if the word
    // "outlook" or "microsoft" appears, otherwise fall through to NETWORK.
    if (/outlook|microsoft/i.test(msg)) {
      return ErrorCategory.OUTLOOK_AUTH_EXPIRED;
    }
  }

  // --- Dedup failure ---
  if (/dedup|duplicate|already\s*labeled|categorized/i.test(msg)) {
    return ErrorCategory.DEDUP_FAILED;
  }

  // --- Network ---
  if (
    /(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed)/i.test(
      msg,
    )
  ) {
    return ErrorCategory.NETWORK_ERROR;
  }

  // --- Inspect status code on error-like objects ---
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (err.status === 429 || err.statusCode === 429) {
      return ErrorCategory.GMAIL_RATE_LIMIT;
    }
    if (
      (err.status === 401 || err.statusCode === 401)
      && /outlook|microsoft/i.test(extractMessage(err))
    ) {
      return ErrorCategory.OUTLOOK_AUTH_EXPIRED;
    }
  }

  return ErrorCategory.UNKNOWN;
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

/** Check whether a category represents a transient (retryable) failure. */
export function isRetryable(category: ErrorCategory): boolean {
  return RETRYABLE_CATEGORIES.has(category);
}

/** Build a typed RetryConfig from numeric values. */
export function buildRetryConfig(
  maxRetries: number,
  delayMs: number,
): RetryConfig {
  return { maxRetries, delayMs };
}

/**
 * Sleep for `delayMs` milliseconds.  Convenience wrapper so callers don't
 * need to inline `setTimeout` boilerplate.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/**
 * Log a classified error with context.  In production this could be wired to
 * an external service; for now it writes structured JSON to stderr.
 */
export function logError(
  context: string,
  error: unknown,
  category: ErrorCategory,
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    context,
    category,
    message: extractMessage(error),
    stack: extractStack(error),
    retryable: isRetryable(category),
  };
  process.stderr.write(JSON.stringify(payload) + '\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    return String(err.message ?? err.error ?? err.statusText ?? JSON.stringify(error));
  }
  return String(error);
}

function extractStack(error: unknown): string | undefined {
  if (error instanceof Error) return error.stack;
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (typeof err.stack === 'string') return err.stack;
  }
  return undefined;
}
