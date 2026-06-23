/**
 * Payload builder module for WF-1x (Gmail) and WF-2x (Outlook) trigger workflows.
 *
 * Maps raw provider-specific trigger output into the canonical WebhookInputPayload
 * shape consumed by WF-0 /webhook/classify-email.
 */

import type { WebhookInputPayload } from './webhook-schema';

// ---------------------------------------------------------------------------
// Raw trigger data shapes (subset of what N8N emits)
// ---------------------------------------------------------------------------

/** Shape emitted by the N8N Gmail Trigger (Message Received event). */
export interface GmailTriggerData {
  id: string;
  threadId: string;
  subject: string;
  snippet: string;
  labelIds?: string[];
  from?: {
    value?: Array<{ address?: string; name?: string }>;
  };
  body?: {
    html?: string;
    text?: string;
  };
  [key: string]: unknown;
}

/** Shape emitted by the N8N Microsoft Outlook Trigger (Message Received event). */
export interface OutlookTriggerData {
  id: string;
  conversationId: string;
  subject: string;
  bodyPreview?: string;
  categories?: string[];
  from?: {
    emailAddress?: {
      address?: string;
      name?: string;
    };
  };
  body?: {
    content?: string;
    contentType?: string;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Dedup guards
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the message has *any* label whose ID starts with
 * `AI/` — meaning it was already classified and should be skipped.
 */
export function isAlreadyLabeled(labelIds: string[]): boolean {
  return labelIds.some((l) => l.startsWith('AI/'));
}

/**
 * Returns `true` when the message has *any* category whose name starts
 * with `AI-` — meaning it was already classified and should be skipped.
 */
export function isAlreadyCategorized(categories: string[]): boolean {
  return categories.some((c) => c.startsWith('AI-'));
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

/**
 * Build a WF-0 payload from raw Gmail trigger output.
 *
 * @param data       Raw item from the Gmail Trigger node.
 * @param credential Human-readable N8N credential name, e.g. "Gmail - personal@gmail.com".
 * @param email      The account email address.
 */
export function buildGmailPayload(
  data: GmailTriggerData,
  credential: string,
  email: string,
): WebhookInputPayload {
  const fromAddress =
    data.from?.value?.[0]?.address ?? 'unknown@unknown.com';

  return {
    account_type: 'gmail',
    credential_name: credential,
    email_address: email,
    message_id: data.id,
    thread_id: data.threadId,
    subject: data.subject ?? '',
    from: fromAddress,
    body_html: data.body?.html ?? '',
    body_text: data.body?.text ?? '',
    snippet: data.snippet ?? '',
  };
}

/**
 * Build a WF-0 payload from raw Outlook trigger output.
 *
 * @param data       Raw item from the Microsoft Outlook Trigger node.
 * @param credential Human-readable N8N credential name, e.g. "Outlook - myname@hotmail.com".
 * @param email      The account email address.
 */
export function buildOutlookPayload(
  data: OutlookTriggerData,
  credential: string,
  email: string,
): WebhookInputPayload {
  const fromAddress =
    data.from?.emailAddress?.address ?? 'unknown@unknown.com';

  return {
    account_type: 'outlook',
    credential_name: credential,
    email_address: email,
    message_id: data.id,
    thread_id: data.conversationId,
    subject: data.subject ?? '',
    from: fromAddress,
    body_html: data.body?.content ?? '',
    body_text: data.bodyPreview ?? '',
    snippet: data.bodyPreview ?? '',
  };
}
