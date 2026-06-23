/**
 * Webhook Input Payload — WF-0 Shared Classification Sub-Workflow
 *
 * Every account trigger (WF-1x for Gmail, WF-2x for Outlook) sends
 * this JSON payload via POST to the WF-0 /classify-email webhook.
 */

/** Supported email account providers. */
export type AccountType = 'gmail' | 'outlook';

/** Valid classification categories produced by the classifier. */
export type EmailCategory =
  | 'newsletter'
  | 'action'
  | 'social'
  | 'promotions'
  | 'career'
  | 'fyi'
  | 'spam';

/**
 * Payload shape received by the WF-0 webhook trigger.
 *
 * All fields are provided by the calling account trigger workflow.
 * `body_html`, `body_text`, and `snippet` may be empty strings if the
 * upstream provider did not populate them.
 */
export interface WebhookInputPayload {
  /** The email provider: "gmail" or "outlook". */
  account_type: AccountType;

  /** N8N credential name (e.g. "Gmail - personal@gmail.com"). */
  credential_name: string;

  /** The email address of the account that received the message. */
  email_address: string;

  /** Provider-specific message ID. */
  message_id: string;

  /** Provider-specific thread/conversation ID. */
  thread_id: string;

  /** Email subject line. */
  subject: string;

  /** Sender address (the From: header value). */
  from: string;

  /** Full HTML body of the email. */
  body_html: string;

  /** Plain-text body of the email (fallback when HTML is unavailable). */
  body_text: string;

  /** Short preview / snippet of the email body. */
  snippet: string;
}

/**
 * Pre-classifier result attached to the item before entering the AI path.
 */
export interface PreClassifiedItem extends WebhookInputPayload {
  /** Set by the pre-classifier when the sender domain is recognized. */
  fast_category: EmailCategory | null;

  /** When true the AI classification path is skipped entirely. */
  skip_ai: boolean;
}

/**
 * Item shape after classification and normalization, before routing to
 * the account-type and category switches.
 */
export interface ClassifiedItem {
  account_type: AccountType;
  credential_name: string;
  email_address: string;
  message_id: string;
  thread_id: string;
  subject: string;
  from: string;
  body_html: string;
  body_text: string;
  snippet: string;
  fast_category: EmailCategory | null;
  skip_ai: boolean;

  /** Final normalized category used for label / category application. */
  final_category: EmailCategory;
}

/**
 * JSON Schema for the webhook node — validates incoming payloads.
 *
 * This is embedded directly in the N8N webhook node parameters so N8N
 * can reject malformed requests before they reach the code nodes.
 */
export const WEBHOOK_INPUT_SCHEMA: object = {
  type: 'object',
  required: [
    'account_type',
    'credential_name',
    'email_address',
    'message_id',
    'thread_id',
    'subject',
    'from',
    'body_html',
    'body_text',
    'snippet',
  ],
  properties: {
    account_type: {
      type: 'string',
      enum: ['gmail', 'outlook'],
      description: 'Email provider: gmail or outlook',
    },
    credential_name: {
      type: 'string',
      description: 'N8N credential name for this account',
    },
    email_address: {
      type: 'string',
      format: 'email',
      description: 'Email address of the receiving account',
    },
    message_id: {
      type: 'string',
      description: 'Provider-specific message ID',
    },
    thread_id: {
      type: 'string',
      description: 'Provider-specific thread/conversation ID',
    },
    subject: {
      type: 'string',
      description: 'Email subject line',
    },
    from: {
      type: 'string',
      description: 'Sender email address (From header)',
    },
    body_html: {
      type: 'string',
      description: 'Full HTML body of the email',
    },
    body_text: {
      type: 'string',
      description: 'Plain-text body fallback',
    },
    snippet: {
      type: 'string',
      description: 'Short preview/snippet of the email body',
    },
  },
  additionalProperties: false,
};
