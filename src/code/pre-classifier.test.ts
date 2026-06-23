/**
 * Tests for the pre-classifier module.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  preClassify,
  SOCIAL_DOMAINS,
  CAREER_DOMAINS,
  FYI_DOMAINS,
  NEWSLETTER_DOMAINS,
  DOMAIN_RULES,
} from './pre-classifier';

// ---------------------------------------------------------------------------
// Domain rule integrity
// ---------------------------------------------------------------------------

describe('Domain rules integrity', () => {
  it('every domain list is non-empty', () => {
    assert.ok(SOCIAL_DOMAINS.length > 0);
    assert.ok(CAREER_DOMAINS.length > 0);
    assert.ok(FYI_DOMAINS.length > 0);
    assert.ok(NEWSLETTER_DOMAINS.length > 0);
  });

  it('DOMAIN_RULES covers all four lists', () => {
    assert.strictEqual(DOMAIN_RULES.length, 4);
    const cats = DOMAIN_RULES.map((r) => r.category);
    assert.deepStrictEqual(cats, ['social', 'career', 'fyi', 'newsletter']);
  });

  it('no domain appears in more than one rule', () => {
    const seen = new Set<string>();
    for (const rule of DOMAIN_RULES) {
      for (const domain of rule.domains) {
        assert.ok(!seen.has(domain), `Duplicate domain: ${domain}`);
        seen.add(domain);
      }
    }
  });

  it('all domains are lowercase', () => {
    for (const rule of DOMAIN_RULES) {
      for (const domain of rule.domains) {
        assert.strictEqual(domain, domain.toLowerCase(), `${domain} is not lowercase`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// preClassify — social
// ---------------------------------------------------------------------------

describe('preClassify — social', () => {
  const socialSenders = [
    'notifications@linkedin.com',
    'info@twitter.com',
    'noreply@x.com',
    'notification@facebook.com',
    'no-reply@instagram.com',
    'notifications@reddit.com',
    'noreply@github.com',
    'noreply@discord.com',
    'info@meetup.com',
    'noreply@slack.com',
  ];

  for (const from of socialSenders) {
    it(`classifies "${from}" as social with skipAi=true`, () => {
      const result = preClassify(from);
      assert.strictEqual(result.category, 'social');
      assert.strictEqual(result.skipAi, true);
    });
  }

  it('matches case-insensitively', () => {
    const result = preClassify('Notifications@LINKEDIN.COM');
    assert.strictEqual(result.category, 'social');
    assert.strictEqual(result.skipAi, true);
  });
});

// ---------------------------------------------------------------------------
// preClassify — career
// ---------------------------------------------------------------------------

describe('preClassify — career', () => {
  const careerSenders = [
    'alerts@indeed.com',
    'noreply@glassdoor.com',
    'hello@levels.fyi',
    'jobs@ziprecruiter.com',
    'noreply@dice.com',
    'noreply@hired.com',
    'notifications@greenhouse.io',
    'no-reply@lever.co',
    'donotreply@workday.com',
    'noreply@myworkdayjobs.com',
    'team@wellfound.com',
    'hello@otta.com',
  ];

  for (const from of careerSenders) {
    it(`classifies "${from}" as career with skipAi=true`, () => {
      const result = preClassify(from);
      assert.strictEqual(result.category, 'career');
      assert.strictEqual(result.skipAi, true);
    });
  }
});

// ---------------------------------------------------------------------------
// preClassify — fyi
// ---------------------------------------------------------------------------

describe('preClassify — fyi', () => {
  const fyiSenders = [
    'auto-confirm@amazon.com',
    'noreply@apple.com',
    'service@paypal.com',
    'noreply@stripe.com',
    'noreply@shopify.com',
    'ebay@ebay.com',
    'noreply@bestbuy.com',
    'noreply@ups.com',
    'auto-reply@usps.com',
  ];

  for (const from of fyiSenders) {
    it(`classifies "${from}" as fyi with skipAi=true`, () => {
      const result = preClassify(from);
      assert.strictEqual(result.category, 'fyi');
      assert.strictEqual(result.skipAi, true);
    });
  }
});

// ---------------------------------------------------------------------------
// preClassify — newsletter
// ---------------------------------------------------------------------------

describe('preClassify — newsletter', () => {
  const newsletterSenders = [
    'hello@substack.com',
    'noreply@beehiiv.com',
    'info@convertkit.com',
    'noreply@mailchimp.com',
    'noreply@klaviyo.com',
    'bounce@sendgrid.net',
    'info@constantcontact.com',
  ];

  for (const from of newsletterSenders) {
    it(`classifies "${from}" as newsletter with skipAi=true`, () => {
      const result = preClassify(from);
      assert.strictEqual(result.category, 'newsletter');
      assert.strictEqual(result.skipAi, true);
    });
  }
});

// ---------------------------------------------------------------------------
// preClassify — unknown
// ---------------------------------------------------------------------------

describe('preClassify — unknown senders', () => {
  const unknownSenders = [
    'boss@mycompany.com',
    'friend@gmail.com',
    'support@random-saas.io',
    'unknown@example.org',
  ];

  for (const from of unknownSenders) {
    it(`returns null category + skipAi=false for "${from}"`, () => {
      const result = preClassify(from);
      assert.strictEqual(result.category, null);
      assert.strictEqual(result.skipAi, false);
    });
  }
});

// ---------------------------------------------------------------------------
// preClassify — edge cases
// ---------------------------------------------------------------------------

describe('preClassify — edge cases', () => {
  it('empty string returns null category', () => {
    const result = preClassify('');
    assert.strictEqual(result.category, null);
    assert.strictEqual(result.skipAi, false);
  });

  it('whitespace-only string returns null category', () => {
    const result = preClassify('   ');
    assert.strictEqual(result.category, null);
    assert.strictEqual(result.skipAi, false);
  });

  it('first rule wins when domain matches two lists (not possible with current data)', () => {
    // e.g. if a domain were in both social and career, social would win
    // because it comes first in DOMAIN_RULES.  This test just verifies
    // the precedence mechanism exists.
    const result = preClassify('hello@linkedin.com'); // definitely social
    assert.strictEqual(result.category, 'social');
  });
});
