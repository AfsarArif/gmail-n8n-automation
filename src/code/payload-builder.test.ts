/**
 * Tests for payload-builder.ts
 *
 * Run with:  npx ts-node src/code/payload-builder.test.ts
 * or via:    npm test
 */

import * as assert from 'assert';
import {
  buildGmailPayload,
  buildOutlookPayload,
  isAlreadyLabeled,
  isAlreadyCategorized,
  type GmailTriggerData,
  type OutlookTriggerData,
} from './payload-builder';
import type { WebhookInputPayload } from './webhook-schema';

// ---------------------------------------------------------------------------
// isAlreadyLabeled
// ---------------------------------------------------------------------------

assert.strictEqual(
  isAlreadyLabeled(['INBOX', 'UNREAD']),
  false,
  'no AI labels → false',
);

assert.strictEqual(
  isAlreadyLabeled(['AI/Newsletter', 'INBOX']),
  true,
  'has AI/Newsletter → true',
);

assert.strictEqual(
  isAlreadyLabeled(['AI/Spam']),
  true,
  'has AI/Spam → true',
);

assert.strictEqual(
  isAlreadyLabeled([]),
  false,
  'empty array → false',
);

// ---------------------------------------------------------------------------
// isAlreadyCategorized
// ---------------------------------------------------------------------------

assert.strictEqual(
  isAlreadyCategorized([]),
  false,
  'no categories → false',
);

assert.strictEqual(
  isAlreadyCategorized(['Blue category']),
  false,
  'non-AI category → false',
);

assert.strictEqual(
  isAlreadyCategorized(['AI-Newsletter']),
  true,
  'has AI-Newsletter → true',
);

assert.strictEqual(
  isAlreadyCategorized(['AI-Action', 'AI-Spam']),
  true,
  'multiple AI categories → true',
);

// ---------------------------------------------------------------------------
// buildGmailPayload
// ---------------------------------------------------------------------------

const gmailData: GmailTriggerData = {
  id: 'msg-abc123',
  threadId: 'thread-xyz789',
  subject: 'Your weekly digest',
  snippet: 'Top stories this week: AI, crypto...',
  labelIds: ['INBOX', 'UNREAD'],
  from: {
    value: [
      {
        address: 'newsletter@example.com',
        name: 'Example Newsletter',
      },
    ],
  },
  body: {
    html: '<html><body><p>Hello world</p></body></html>',
    text: 'Hello world',
  },
};

const gmailPayload: WebhookInputPayload = buildGmailPayload(
  gmailData,
  'Gmail - test@gmail.com',
  'test@gmail.com',
);

assert.strictEqual(gmailPayload.account_type, 'gmail');
assert.strictEqual(gmailPayload.credential_name, 'Gmail - test@gmail.com');
assert.strictEqual(gmailPayload.email_address, 'test@gmail.com');
assert.strictEqual(gmailPayload.message_id, 'msg-abc123');
assert.strictEqual(gmailPayload.thread_id, 'thread-xyz789');
assert.strictEqual(gmailPayload.subject, 'Your weekly digest');
assert.strictEqual(gmailPayload.from, 'newsletter@example.com');
assert.strictEqual(
  gmailPayload.body_html,
  '<html><body><p>Hello world</p></body></html>',
);
assert.strictEqual(gmailPayload.body_text, 'Hello world');
assert.strictEqual(gmailPayload.snippet, 'Top stories this week: AI, crypto...');

// Edge: missing from.value
const gmailNoFrom: GmailTriggerData = {
  id: 'msg-no-from',
  threadId: 'thread-no-from',
  subject: 'No sender',
  snippet: '',
};
const gmailNoFromPayload = buildGmailPayload(
  gmailNoFrom,
  'Gmail - test@gmail.com',
  'test@gmail.com',
);
assert.strictEqual(gmailNoFromPayload.from, 'unknown@unknown.com');

// Edge: missing body
const gmailNoBody: GmailTriggerData = {
  id: 'msg-no-body',
  threadId: 'thread-no-body',
  subject: 'Empty body',
  snippet: '',
};
const gmailNoBodyPayload = buildGmailPayload(
  gmailNoBody,
  'Gmail - test@gmail.com',
  'test@gmail.com',
);
assert.strictEqual(gmailNoBodyPayload.body_html, '');
assert.strictEqual(gmailNoBodyPayload.body_text, '');

// ---------------------------------------------------------------------------
// buildOutlookPayload
// ---------------------------------------------------------------------------

const outlookData: OutlookTriggerData = {
  id: 'outlook-msg-001',
  conversationId: 'outlook-conv-001',
  subject: 'Meeting tomorrow',
  bodyPreview: 'Hi team, let us meet tomorrow at 10 AM...',
  categories: [],
  from: {
    emailAddress: {
      address: 'boss@company.com',
      name: 'Boss Person',
    },
  },
  body: {
    content: '<html><body><p>Hi team</p></body></html>',
    contentType: 'html',
  },
};

const outlookPayload: WebhookInputPayload = buildOutlookPayload(
  outlookData,
  'Outlook - test@hotmail.com',
  'test@hotmail.com',
);

assert.strictEqual(outlookPayload.account_type, 'outlook');
assert.strictEqual(outlookPayload.credential_name, 'Outlook - test@hotmail.com');
assert.strictEqual(outlookPayload.email_address, 'test@hotmail.com');
assert.strictEqual(outlookPayload.message_id, 'outlook-msg-001');
assert.strictEqual(outlookPayload.thread_id, 'outlook-conv-001');
assert.strictEqual(outlookPayload.subject, 'Meeting tomorrow');
assert.strictEqual(outlookPayload.from, 'boss@company.com');
assert.strictEqual(
  outlookPayload.body_html,
  '<html><body><p>Hi team</p></body></html>',
);
assert.strictEqual(
  outlookPayload.body_text,
  'Hi team, let us meet tomorrow at 10 AM...',
);
assert.strictEqual(
  outlookPayload.snippet,
  'Hi team, let us meet tomorrow at 10 AM...',
);

// Edge: missing from.emailAddress
const outlookNoFrom: OutlookTriggerData = {
  id: 'outlook-no-from',
  conversationId: 'conv-no-from',
  subject: 'No sender',
};
const outlookNoFromPayload = buildOutlookPayload(
  outlookNoFrom,
  'Outlook - test@hotmail.com',
  'test@hotmail.com',
);
assert.strictEqual(outlookNoFromPayload.from, 'unknown@unknown.com');

// Edge: missing body.content and bodyPreview
const outlookNoBody: OutlookTriggerData = {
  id: 'outlook-no-body',
  conversationId: 'conv-no-body',
  subject: 'Empty body',
};
const outlookNoBodyPayload = buildOutlookPayload(
  outlookNoBody,
  'Outlook - test@hotmail.com',
  'test@hotmail.com',
);
assert.strictEqual(outlookNoBodyPayload.body_html, '');
assert.strictEqual(outlookNoBodyPayload.body_text, '');
assert.strictEqual(outlookNoBodyPayload.snippet, '');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('✅ All payload-builder tests passed.');
