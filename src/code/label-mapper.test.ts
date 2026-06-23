/**
 * Tests for the label-mapper module.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getGmailLabel,
  getOutlookCategory,
  shouldMarkRead,
  shouldArchive,
  CATEGORY_TO_GMAIL_LABEL,
  CATEGORY_TO_OUTLOOK_CATEGORY,
} from './label-mapper';

import type { EmailCategory } from './webhook-schema';

// ---------------------------------------------------------------------------
// Gmail labels
// ---------------------------------------------------------------------------

describe('Gmail label mapping', () => {
  const cases: [EmailCategory, string][] = [
    ['newsletter', 'AI/Newsletter'],
    ['action', 'AI/Action-Required'],
    ['social', 'AI/Social'],
    ['promotions', 'AI/Promotions'],
    ['career', 'AI/Career'],
    ['fyi', 'AI/FYI'],
    ['spam', 'AI/Spam'],
  ];

  for (const [cat, expected] of cases) {
    it(`category "${cat}" → label "${expected}"`, () => {
      assert.strictEqual(getGmailLabel(cat), expected);
      assert.strictEqual(CATEGORY_TO_GMAIL_LABEL[cat], expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Outlook categories
// ---------------------------------------------------------------------------

describe('Outlook category mapping', () => {
  const cases: [EmailCategory, string][] = [
    ['newsletter', 'AI-Newsletter'],
    ['action', 'AI-Action'],
    ['social', 'AI-Social'],
    ['promotions', 'AI-Promotions'],
    ['career', 'AI-Career'],
    ['fyi', 'AI-FYI'],
    ['spam', 'AI-Spam'],
  ];

  for (const [cat, expected] of cases) {
    it(`category "${cat}" → Outlook category "${expected}"`, () => {
      assert.strictEqual(getOutlookCategory(cat), expected);
      assert.strictEqual(CATEGORY_TO_OUTLOOK_CATEGORY[cat], expected);
    });
  }

  it('Outlook categories use hyphens (not slashes)', () => {
    for (const name of Object.values(CATEGORY_TO_OUTLOOK_CATEGORY)) {
      assert.ok(!name.includes('/'), `"${name}" contains a slash`);
      assert.ok(name.includes('-'), `"${name}" missing hyphen`);
    }
  });
});

// ---------------------------------------------------------------------------
// shouldMarkRead
// ---------------------------------------------------------------------------

describe('shouldMarkRead', () => {
  it('returns true for newsletter, social, promotions, fyi, spam', () => {
    const markRead = ['newsletter', 'social', 'promotions', 'fyi', 'spam'] as EmailCategory[];
    for (const c of markRead) {
      assert.strictEqual(shouldMarkRead(c), true, `shouldMarkRead(${c}) should be true`);
    }
  });

  it('returns false for action and career (keep unread)', () => {
    assert.strictEqual(shouldMarkRead('action'), false);
    assert.strictEqual(shouldMarkRead('career'), false);
  });
});

// ---------------------------------------------------------------------------
// shouldArchive
// ---------------------------------------------------------------------------

describe('shouldArchive', () => {
  it('returns true only for promotions', () => {
    assert.strictEqual(shouldArchive('promotions'), true);
  });

  it('returns false for all other categories', () => {
    const others: EmailCategory[] = ['newsletter', 'action', 'social', 'career', 'fyi', 'spam'];
    for (const c of others) {
      assert.strictEqual(shouldArchive(c), false, `shouldArchive(${c}) should be false`);
    }
  });
});
