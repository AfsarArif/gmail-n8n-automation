/**
 * Label / Category Mapper — WF-0 Shared Classification Sub-Workflow
 *
 * Maps the unified `EmailCategory` values to provider-specific label
 * names (Gmail) and category names (Outlook).  Also exports behavioural
 * helpers for mark-as-read and archive rules.
 */

import type { EmailCategory } from './webhook-schema';

// ---------------------------------------------------------------------------
// Provider-specific mappings
// ---------------------------------------------------------------------------

/**
 * Maps a unified email category to its Gmail label name.
 *
 * These labels must be pre-created in each Gmail account:
 *   AI/Newsletter, AI/Action-Required, AI/Social, AI/Promotions,
 *   AI/Career, AI/FYI, AI/Spam
 */
export const CATEGORY_TO_GMAIL_LABEL: Readonly<Record<EmailCategory, string>> = {
  newsletter: 'AI/Newsletter',
  action: 'AI/Action-Required',
  social: 'AI/Social',
  promotions: 'AI/Promotions',
  career: 'AI/Career',
  fyi: 'AI/FYI',
  spam: 'AI/Spam',
} as const;

/**
 * Maps a unified email category to its Outlook category name.
 *
 * These categories must be pre-created in each Outlook account.
 * Outlook uses hyphens instead of slashes (slashes are not supported in
 * Outlook category names).
 */
export const CATEGORY_TO_OUTLOOK_CATEGORY: Readonly<Record<EmailCategory, string>> = {
  newsletter: 'AI-Newsletter',
  action: 'AI-Action',
  social: 'AI-Social',
  promotions: 'AI-Promotions',
  career: 'AI-Career',
  fyi: 'AI-FYI',
  spam: 'AI-Spam',
} as const;

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Return the Gmail label name for a given category.
 *
 * @example
 *   getGmailLabel('newsletter')  // => 'AI/Newsletter'
 */
export function getGmailLabel(category: EmailCategory): string {
  return CATEGORY_TO_GMAIL_LABEL[category];
}

/**
 * Return the Outlook category name for a given category.
 *
 * @example
 *   getOutlookCategory('career')  // => 'AI-Career'
 */
export function getOutlookCategory(category: EmailCategory): string {
  return CATEGORY_TO_OUTLOOK_CATEGORY[category];
}

// ---------------------------------------------------------------------------
// Behaviour helpers
// ---------------------------------------------------------------------------

/**
 * Should the email be marked as read after classification?
 *
 * Returns `true` for all categories **except** `'action'` and `'career'`,
 * which the user needs to see and act on.
 */
export function shouldMarkRead(category: EmailCategory): boolean {
  // Keep unread for action-required and career emails.
  return category !== 'action' && category !== 'career';
}

/**
 * Should the email be archived (removed from inbox) after classification?
 *
 * Returns `true` **only** for `'promotions'` — promotional emails are
 * labelled and then moved out of the inbox automatically.
 */
export function shouldArchive(category: EmailCategory): boolean {
  return category === 'promotions';
}
