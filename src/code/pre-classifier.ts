/**
 * Sender Pre-Classifier — WF-0 Shared Classification Sub-Workflow
 *
 * Checks the `from` address against known sender-domain rules to
 * assign a fast category and potentially skip the AI classification
 * path.  This avoids burning DeepSeek tokens on predictable emails.
 *
 * A non-null `category` return means the sender domain was matched.
 * When `category` is null the item proceeds to the DeepSeek path.
 */

import type { EmailCategory } from './webhook-schema';

// ---------------------------------------------------------------------------
// Domain rule sets
// ---------------------------------------------------------------------------

/** Social platform notification senders. */
export const SOCIAL_DOMAINS: readonly string[] = [
  'linkedin.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'reddit.com',
  'github.com',
  'discord.com',
  'meetup.com',
  'slack.com',
] as const;

/** Career / job-platform senders. */
export const CAREER_DOMAINS: readonly string[] = [
  'indeed.com',
  'glassdoor.com',
  'levels.fyi',
  'ziprecruiter.com',
  'dice.com',
  'hired.com',
  'greenhouse.io',
  'lever.co',
  'workday.com',
  'myworkdayjobs.com',
  'wellfound.com',
  'otta.com',
] as const;

/** FYI / transactional senders (receipts, shipping, account notices). */
export const FYI_DOMAINS: readonly string[] = [
  'amazon.com',
  'apple.com',
  'paypal.com',
  'stripe.com',
  'shopify.com',
  'ebay.com',
  'bestbuy.com',
  'ups.com',
  'fedex.com',
  'usps.com',
] as const;

/** Newsletter platform senders. */
export const NEWSLETTER_DOMAINS: readonly string[] = [
  'substack.com',
  'beehiiv.com',
  'convertkit.com',
  'mailchimp.com',
  'klaviyo.com',
  'sendgrid.net',
  'constantcontact.com',
] as const;

// ---------------------------------------------------------------------------
// Compiled rule list (ordered — first match wins)
// ---------------------------------------------------------------------------

type DomainRule = {
  domains: readonly string[];
  category: EmailCategory;
};

export const DOMAIN_RULES: readonly DomainRule[] = [
  { domains: SOCIAL_DOMAINS, category: 'social' },
  { domains: CAREER_DOMAINS, category: 'career' },
  { domains: FYI_DOMAINS, category: 'fyi' },
  { domains: NEWSLETTER_DOMAINS, category: 'newsletter' },
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PreClassifyResult {
  /**
   * Fast-track category when the sender domain is recognized.
   * `null` means no match — the item must go through AI classification.
   */
  category: EmailCategory | null;

  /** When `true` the caller may skip the AI classification path entirely. */
  skipAi: boolean;
}

/**
 * Classify an email by sender domain alone.
 *
 * Rules are evaluated in order (social → career → fyi → newsletter).
 * The **first** matching rule wins. If no domain matches we return
 * `{ category: null, skipAi: false }` so the caller falls through to
 * the DeepSeek path.
 *
 * @param fromAddress - The `From:` header value (case-insensitive match).
 * @returns A {@link PreClassifyResult} with the fast category (if any).
 */
export function preClassify(fromAddress: string): PreClassifyResult {
  const fromLower = fromAddress.toLowerCase().trim();

  // Empty / missing sender — can't classify, let AI handle it.
  if (fromLower.length === 0) {
    return { category: null, skipAi: false };
  }

  for (const rule of DOMAIN_RULES) {
    const matched = rule.domains.some((domain) => fromLower.includes(domain));
    if (matched) {
      return { category: rule.category, skipAi: true };
    }
  }

  return { category: null, skipAi: false };
}
