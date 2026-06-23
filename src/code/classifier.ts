/**
 * DeepSeek Classification Prompt Builder — WF-0 Shared Classification Sub-Workflow
 *
 * Builds the system + user prompts sent to the DeepSeek Basic LLM Chain
 * node (model: deepseek-chat, temperature: 0).  Also exports validation
 * helpers used after the JSON Parser node to guard against hallucinated
 * categories.
 */

import type { EmailCategory } from './webhook-schema';

// ---------------------------------------------------------------------------
// Valid category set
// ---------------------------------------------------------------------------

/**
 * All categories the classifier may return.
 *
 * Used to validate the raw JSON output from DeepSeek — if the model
 * hallucinates a category outside this set we fall back to `'fyi'`.
 */
export const VALID_CATEGORIES: readonly EmailCategory[] = [
  'newsletter',
  'action',
  'social',
  'promotions',
  'career',
  'fyi',
  'spam',
] as const;

const VALID_SET: ReadonlySet<string> = new Set(VALID_CATEGORIES);

// ---------------------------------------------------------------------------
// Classification prompts
// ---------------------------------------------------------------------------

/**
 * System prompt sent to DeepSeek.
 *
 * Instructs the model to return **only** raw JSON with no markdown fences,
 * no explanation, and no extra text.  This keeps the output parseable by
 * the N8N JSON Parser node.
 */
export const CLASSIFICATION_SYSTEM_PROMPT = [
  'You are an email classifier. Return valid JSON only — no markdown, no explanation, no extra text.',
  '',
  'Classify the email into exactly one category:',
  '',
  '- "newsletter":   Blog digests, editorial content, curated reading lists, publication emails',
  '- "action":       Requires a direct reply or response (questions, requests, meeting invites, tasks)',
  '- "social":       Notifications from social platforms (LinkedIn, Twitter/X, Facebook, Instagram, Reddit, GitHub, Discord)',
  '- "promotions":   Sales, discount codes, limited-time offers, marketing campaigns, product launches',
  '- "career":       Job postings, recruiter outreach, interview requests, application updates, job alerts',
  '- "fyi":          Receipts, order confirmations, shipping updates, account notifications, no reply needed',
  '- "spam":         Junk mail, phishing, irrelevant unsolicited bulk mail',
  '',
  'Return exactly this JSON:',
  '{',
  '  "category": "newsletter|action|social|promotions|career|fyi|spam"',
  '}',
].join('\n');

/**
 * Build the user prompt for the DeepSeek classification request.
 *
 * N8N uses this prompt in the Basic LLM Chain node with three input
 * variables: `from`, `subject`, and `bodyPreview`.
 *
 * @param from         - Sender email address.
 * @param subject      - Email subject line.
 * @param bodyPreview  - First ~300 characters of the plain-text body.
 * @returns The user prompt string.
 */
export function buildClassificationPrompt(
  from: string,
  subject: string,
  bodyPreview: string,
): string {
  return [
    `From: ${from}`,
    `Subject: ${subject}`,
    `Body preview: ${bodyPreview}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Validation / normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw category string from DeepSeek into a valid
 * {@link EmailCategory}.
 *
 * - Trims whitespace and lowercases the input.
 * - If the result matches a valid category it is returned as-is.
 * - Otherwise the safe fallback `'fyi'` is returned.
 *
 * This function should be called in the "Validate Category" code node
 * that sits between the JSON Parser and the final Set / Normalize node.
 *
 * @param rawCategory - The raw `category` field parsed from DeepSeek JSON.
 * @returns A validated {@link EmailCategory}.
 */
export function normalizeCategory(rawCategory: string): EmailCategory {
  const cleaned = rawCategory.trim().toLowerCase();

  if (VALID_SET.has(cleaned)) {
    return cleaned as EmailCategory;
  }

  // Hallucinated or missing category — safe fallback.
  return 'fyi';
}
