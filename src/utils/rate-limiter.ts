/**
 * rate-limiter.ts
 *
 * Sliding-window rate-limit tracker for Gmail (250 quota units / second)
 * and Microsoft Graph / Outlook (10 000 requests per 10 minutes).
 *
 * Does NOT actually block — it answers the question "am I allowed to make
 * this request right now?" so callers can decide to wait, throttle, or fail.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccountType = 'gmail' | 'outlook';

interface WindowConfig {
  /** Maximum requests allowed in the window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

const CONFIG: Record<AccountType, WindowConfig> = {
  gmail: {
    maxRequests: 250,
    windowMs: 1_000, // 1 second
  },
  outlook: {
    maxRequests: 10_000,
    windowMs: 10 * 60 * 1_000, // 10 minutes
  },
};

// ---------------------------------------------------------------------------
// RateLimiter class
// ---------------------------------------------------------------------------

export class RateLimiter {
  /** Timestamps (ms) of recent requests, oldest first. */
  private readonly windows = new Map<AccountType, number[]>();

  constructor() {
    this.windows.set('gmail', []);
    this.windows.set('outlook', []);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Check whether a request of the given account type can be made right now
   * without exceeding the rate limit.
   */
  checkLimit(accountType: AccountType): boolean {
    this.prune(accountType);
    const timestamps = this.windows.get(accountType)!;
    const { maxRequests } = CONFIG[accountType];
    return timestamps.length < maxRequests;
  }

  /** Record a successful request for the given account type. */
  recordRequest(accountType: AccountType): void {
    this.prune(accountType);
    this.windows.get(accountType)!.push(Date.now());
  }

  /**
   * If the limit is already reached, wait until the oldest request in the
   * window expires, then return.  If under the limit, return immediately.
   */
  async waitIfNeeded(accountType: AccountType): Promise<void> {
    while (!this.checkLimit(accountType)) {
      const timestamps = this.windows.get(accountType)!;
      const oldest = timestamps[0];
      const { windowMs } = CONFIG[accountType];
      const waitMs = Math.max(0, oldest + windowMs - Date.now() + 10); // +10 ms buffer
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      this.prune(accountType);
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** Remove timestamps that have fallen outside the sliding window. */
  private prune(accountType: AccountType): void {
    const now = Date.now();
    const { windowMs } = CONFIG[accountType];
    const timestamps = this.windows.get(accountType)!;

    // Keep only timestamps within the window.
    const cutoff = now - windowMs;
    let start = 0;
    while (start < timestamps.length && timestamps[start] <= cutoff) {
      start++;
    }
    if (start > 0) {
      this.windows.set(accountType, timestamps.slice(start));
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
