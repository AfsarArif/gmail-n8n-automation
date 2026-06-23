/**
 * gmail-n8n-automation — Barrel export
 *
 * Re-exports every public API surface from the code modules so that
 * consumers can import from a single entry point:
 *
 *   import { preClassify, normalizeCategory, getGmailLabel } from 'gmail-n8n-automation';
 */

// Types
export type {
  AccountType,
  EmailCategory,
  WebhookInputPayload,
  PreClassifiedItem,
  ClassifiedItem,
} from './webhook-schema';

export { WEBHOOK_INPUT_SCHEMA } from './webhook-schema';

// Pre-classifier
export {
  SOCIAL_DOMAINS,
  CAREER_DOMAINS,
  FYI_DOMAINS,
  NEWSLETTER_DOMAINS,
  DOMAIN_RULES,
  preClassify,
} from './pre-classifier';

export type { PreClassifyResult } from './pre-classifier';

// Classifier
export {
  VALID_CATEGORIES,
  CLASSIFICATION_SYSTEM_PROMPT,
  buildClassificationPrompt,
  normalizeCategory,
} from './classifier';

// Label mapper
export {
  CATEGORY_TO_GMAIL_LABEL,
  CATEGORY_TO_OUTLOOK_CATEGORY,
  getGmailLabel,
  getOutlookCategory,
  shouldMarkRead,
  shouldArchive,
} from './label-mapper';
