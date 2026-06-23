/**
 * Tests for the classifier module (prompt builder + validation).
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VALID_CATEGORIES,
  CLASSIFICATION_SYSTEM_PROMPT,
  buildClassificationPrompt,
  normalizeCategory,
} from './classifier';

// ---------------------------------------------------------------------------
// VALID_CATEGORIES
// ---------------------------------------------------------------------------

describe('VALID_CATEGORIES', () => {
  it('contains exactly 7 categories', () => {
    assert.strictEqual(VALID_CATEGORIES.length, 7);
  });

  it('contains all expected values', () => {
    const expected = ['newsletter', 'action', 'social', 'promotions', 'career', 'fyi', 'spam'];
    assert.deepStrictEqual([...VALID_CATEGORIES].sort(), [...expected].sort());
  });

  it('has no duplicates', () => {
    assert.strictEqual(new Set(VALID_CATEGORIES).size, VALID_CATEGORIES.length);
  });
});

// ---------------------------------------------------------------------------
// CLASSIFICATION_SYSTEM_PROMPT
// ---------------------------------------------------------------------------

describe('CLASSIFICATION_SYSTEM_PROMPT', () => {
  it('is non-empty', () => {
    assert.ok(CLASSIFICATION_SYSTEM_PROMPT.length > 0);
  });

  it('mentions every valid category', () => {
    for (const cat of VALID_CATEGORIES) {
      assert.ok(
        CLASSIFICATION_SYSTEM_PROMPT.includes(`"${cat}"`),
        `System prompt missing category: ${cat}`,
      );
    }
  });

  it('instructs JSON-only output (no markdown)', () => {
    assert.ok(CLASSIFICATION_SYSTEM_PROMPT.includes('valid JSON only'));
    assert.ok(CLASSIFICATION_SYSTEM_PROMPT.includes('no markdown'));
  });

  it('contains the expected JSON shape', () => {
    assert.ok(CLASSIFICATION_SYSTEM_PROMPT.includes('"category"'));
  });
});

// ---------------------------------------------------------------------------
// buildClassificationPrompt
// ---------------------------------------------------------------------------

describe('buildClassificationPrompt', () => {
  it('includes the From, Subject and Body preview fields', () => {
    const prompt = buildClassificationPrompt(
      'sender@example.com',
      'Hello World',
      'This is a test email body.',
    );

    assert.ok(prompt.includes('From: sender@example.com'));
    assert.ok(prompt.includes('Subject: Hello World'));
    assert.ok(prompt.includes('Body preview: This is a test email body.'));
  });

  it('handles empty fields gracefully', () => {
    const prompt = buildClassificationPrompt('', '', '');
    assert.ok(prompt.includes('From: '));
    assert.ok(prompt.includes('Subject: '));
    assert.ok(prompt.includes('Body preview: '));
  });

  it('returns a string with exactly 3 lines', () => {
    const prompt = buildClassificationPrompt('a', 'b', 'c');
    const lines = prompt.split('\n');
    assert.strictEqual(lines.length, 3);
  });
});

// ---------------------------------------------------------------------------
// normalizeCategory
// ---------------------------------------------------------------------------

describe('normalizeCategory', () => {
  for (const cat of VALID_CATEGORIES) {
    it(`returns "${cat}" unchanged for exact match`, () => {
      assert.strictEqual(normalizeCategory(cat), cat);
    });
  }

  it('trims and lowercases the input', () => {
    assert.strictEqual(normalizeCategory('  ACTION  '), 'action');
    assert.strictEqual(normalizeCategory('Newsletter'), 'newsletter');
    assert.strictEqual(normalizeCategory('Spam'), 'spam');
  });

  it('falls back to fyi for invalid categories', () => {
    assert.strictEqual(normalizeCategory('INVALID'), 'fyi');
    assert.strictEqual(normalizeCategory(''), 'fyi');
    assert.strictEqual(normalizeCategory('banana'), 'fyi');
  });

  it('falls back to fyi for empty/whitespace input', () => {
    assert.strictEqual(normalizeCategory(''), 'fyi');
    assert.strictEqual(normalizeCategory('   '), 'fyi');
  });

  it('handles categories with unexpected casing', () => {
    assert.strictEqual(normalizeCategory('PROMOTIONS'), 'promotions');
    assert.strictEqual(normalizeCategory('CAREER'), 'career');
  });

  it('falls back to fyi for near-miss strings', () => {
    // "spammy" is not a valid category
    assert.strictEqual(normalizeCategory('spammy'), 'fyi');
    // "actions" (plural) is not valid
    assert.strictEqual(normalizeCategory('actions'), 'fyi');
  });
});
